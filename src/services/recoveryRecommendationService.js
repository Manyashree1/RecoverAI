const { AppError } = require('../utils/AppError');
const { RecoveryRecommendationRepository } = require('../repositories/recoveryRecommendationRepository');
const { MongoTransactionRunner } = require('./mongoTransactionRunner');
const { AiRecoveryAnalysisService, RECOMMENDATION_SOURCE } = require('./ai/aiRecoveryAnalysisService');
const { evaluateRecoveryAction } = require('./policyEngine');
const { RECOVERY_ACTION_STATUS, ACTOR_TYPE, AUDIT_EVENT_TYPE, POLICY_DECISION, OPEN_RECOVERY_CASE_STATUSES } = require('../constants/enums');

/**
 * Orchestrates the pipeline described in docs/architecture.md:
 *
 *   RecoveryCase -> case context -> AI provider (or deterministic fallback)
 *                 -> validated recommendation
 *                 -> Deterministic Policy Engine -> ALLOW/BLOCK
 *                 -> RecoveryAction -> Audit trail
 *
 * It stops there. Neither the AI stage nor `evaluateRecoveryAction` ever
 * calls the Razorpay client, and this service never marks a RecoveryAction
 * executed -- `evaluateRecoveryAction` only records whether the
 * recommendation *would* be authorized. Bounded execution remains a
 * separate, later increment by design (see README).
 */
class RecoveryRecommendationService {
  constructor({
    repository = new RecoveryRecommendationRepository(),
    transactionRunner = new MongoTransactionRunner(),
    aiAnalysisService = new AiRecoveryAnalysisService()
  } = {}) {
    this.repository = repository;
    this.transactionRunner = transactionRunner;
    this.aiAnalysisService = aiAnalysisService;
  }

  async generateRecommendation({ merchantId, recoveryCaseId, newAttempt = false }) {
    try {
      return await this.transactionRunner.run((session) => this.#generateInTransaction(merchantId, recoveryCaseId, session, newAttempt));
    } catch (error) {
      // Two concurrent requests can both pass the idempotency-key read
      // before either has written; the loser's transaction aborts with a
      // duplicate-key error instead of creating a second RecoveryAction.
      if (isDuplicateKeyError(error)) {
        const idempotencyKey = error.keyValue?.idempotencyKey;
        const existingAction = idempotencyKey
          ? await this.repository.findRecoveryActionByIdempotencyKey(idempotencyKey)
          : null;
        if (existingAction) {
          return {
            duplicate: true,
            recoveryCaseId: String(existingAction.recoveryCase),
            paymentId: String(existingAction.payment),
            policyDecision: { decision: existingAction.policyDecision.decision, reason: existingAction.policyDecision.reason },
            recoveryAction: serializeAction(existingAction)
          };
        }
      }
      throw error;
    }
  }

  async #generateInTransaction(merchantId, recoveryCaseId, session, newAttempt) {
    const context = await this.repository.findRecoveryCaseWithPayment(merchantId, recoveryCaseId, session);
    if (!context || !context.payment) {
      throw new AppError('Recovery case not found.', 404);
    }
    const { recoveryCase, payment } = context;

    // A terminal case (already recovered, unrecoverable, or explicitly
    // closed) must not receive a fresh recommendation, and must never be
    // re-analyzed into a NO_ACTION/ESCALATE_TO_HUMAN + POLICY_BLOCKED
    // RecoveryAction that contradicts the historical outcome. The UI uses
    // this as the authoritative "not actionable" signal.
    if (!OPEN_RECOVERY_CASE_STATUSES.includes(recoveryCase.status)) {
      const priorActions = await this.repository.findRecoveryActionsByCase(merchantId, recoveryCaseId, session);
      return {
        duplicate: true,
        notActionable: true,
        recoveryCaseId: String(recoveryCase._id),
        paymentId: String(payment._id),
        reason: `Recovery case is ${recoveryCase.status}; it is no longer open for recovery and no new recommendation can be generated.`,
        recoveryAction: null,
        history: priorActions.map(serializeAction)
      };
    }

    const policy = await this.repository.findOrCreatePolicy(merchantId, session);

    const aiOutcome = await this.aiAnalysisService.analyze({ payment, recoveryCase, policy });
    const recommendation = aiOutcome.recommendation;

    const priorActions = await this.repository.findRecoveryActionsByCase(merchantId, recoveryCaseId, session);

    const policyResult = evaluateRecoveryAction({
      policy,
      payment,
      recoveryCase,
      recommendation: { type: recommendation.action, confidence: recommendation.confidence },
      existingActions: priorActions
    });

    if (policyResult.escalate) {
      const escalationAction = await this.repository.createRecoveryAction(
        {
          merchant: merchantId,
          payment: payment._id,
          recoveryCase: recoveryCase._id,
          type: 'ESCALATE_TO_HUMAN',
          status: RECOVERY_ACTION_STATUS.POLICY_BLOCKED,
          recommendation: {
            source: aiOutcome.source === RECOMMENDATION_SOURCE.AI ? 'AI_AGENT' : 'SYSTEM',
            confidence: recommendation.confidence,
            rationale: policyResult.reason,
            model: aiOutcome.model || aiOutcome.provider
          },
          policyDecision: { decision: POLICY_DECISION.BLOCKED, reason: policyResult.reason, evaluatedAt: new Date() },
          idempotencyKey: `escalate:${recoveryCase._id}:${Date.now()}`
        },
        session
      );

      for (const event of aiOutcome.auditEvents) {
        await this.repository.createAuditEvent(
          {
            merchant: merchantId,
            payment: payment._id,
            recoveryCase: recoveryCase._id,
            providerEventId: internalAuditEventId(escalationAction.idempotencyKey, event.type),
            ...event
          },
          session
        );
      }

      await this.repository.createAuditEvent(
        {
          merchant: merchantId,
          payment: payment._id,
          recoveryCase: recoveryCase._id,
          recoveryAction: escalationAction._id,
          providerEventId: internalAuditEventId(escalationAction.idempotencyKey, AUDIT_EVENT_TYPE.ACTION_RECOMMENDED),
          type: AUDIT_EVENT_TYPE.ACTION_RECOMMENDED,
          actor: ACTOR_TYPE.SYSTEM,
          reason: policyResult.reason,
          action: 'ESCALATE_TO_HUMAN',
          result: 'ESCALATED_TO_HUMAN',
          metadata: {
            confidence: recommendation.confidence,
            source: aiOutcome.source,
            provider: aiOutcome.provider,
            model: aiOutcome.model,
            stoppingRule: policyResult.stoppingRule,
            stoppingEvidence: policyResult.stoppingEvidence,
            originalRecommendation: recommendation.action,
            escalationReason: policyResult.reason
          }
        },
        session
      );

      await this.repository.createAuditEvent(
        {
          merchant: merchantId,
          payment: payment._id,
          recoveryCase: recoveryCase._id,
          recoveryAction: escalationAction._id,
          providerEventId: internalAuditEventId(escalationAction.idempotencyKey, AUDIT_EVENT_TYPE.POLICY_EVALUATED),
          type: AUDIT_EVENT_TYPE.POLICY_EVALUATED,
          actor: ACTOR_TYPE.SYSTEM,
          reason: policyResult.reason,
          policyDecision: 'BLOCKED',
          action: 'ESCALATE_TO_HUMAN'
        },
        session
      );

      return {
        duplicate: false,
        escalated: true,
        recoveryCaseId: String(recoveryCase._id),
        paymentId: String(payment._id),
        recommendation,
        source: aiOutcome.source,
        policyDecision: { decision: POLICY_DECISION.BLOCKED, reason: policyResult.reason },
        stoppingRule: policyResult.stoppingRule,
        stoppingEvidence: policyResult.stoppingEvidence,
        recoveryAction: serializeAction(escalationAction)
      };
    }

    const priorMatchingAction = priorActions
      .filter((action) => action.type === recommendation.action)
      .sort((left, right) => attemptNumber(right) - attemptNumber(left))[0];
    if (newAttempt && priorMatchingAction && priorMatchingAction.status !== RECOVERY_ACTION_STATUS.FAILED) {
      return {
        duplicate: true,
        recoveryCaseId: String(recoveryCase._id),
        paymentId: String(payment._id),
        recommendation,
        policyDecision: { decision: priorMatchingAction.policyDecision.decision, reason: priorMatchingAction.policyDecision.reason },
        recoveryAction: serializeAction(priorMatchingAction)
      };
    }
    if (newAttempt && !priorMatchingAction) {
      throw new AppError('A new recovery attempt requires a failed prior action of the same type.', 409);
    }
    const attempt = newAttempt ? nextAttemptNumber(priorActions, recommendation.action) : null;
    const idempotencyKey = buildIdempotencyKey({ recoveryCase, action: recommendation.action, attempt });

    const existingAction = await this.repository.findRecoveryActionByIdempotencyKey(idempotencyKey, session);
    if (existingAction) {
      return {
        duplicate: true,
        recoveryCaseId: String(recoveryCase._id),
        paymentId: String(payment._id),
        recommendation,
        policyDecision: { decision: existingAction.policyDecision.decision, reason: existingAction.policyDecision.reason },
        recoveryAction: serializeAction(existingAction)
      };
    }

    const recoveryAction = await this.repository.createRecoveryAction(
      {
        merchant: merchantId,
        payment: payment._id,
        recoveryCase: recoveryCase._id,
        type: recommendation.action,
        status: policyResult.allowed ? RECOVERY_ACTION_STATUS.POLICY_ALLOWED : RECOVERY_ACTION_STATUS.POLICY_BLOCKED,
        recommendation: {
          source: aiOutcome.source === RECOMMENDATION_SOURCE.AI ? 'AI_AGENT' : 'SYSTEM',
          confidence: recommendation.confidence,
          rationale: recommendation.reason,
          model: aiOutcome.model || aiOutcome.provider
        },
        policyDecision: { decision: policyResult.decision, reason: policyResult.reason, evaluatedAt: new Date() },
        idempotencyKey
      },
      session
    );

    // Persist the AI stage's own audit trail first (analysis started,
    // generated/failed, fallback used), then the recommendation + policy
    // events, so the timeline reads in the order things actually happened.
    for (const event of aiOutcome.auditEvents) {
      await this.repository.createAuditEvent(
        {
          merchant: merchantId,
          payment: payment._id,
          recoveryCase: recoveryCase._id,
          providerEventId: internalAuditEventId(idempotencyKey, event.type),
          ...event
        },
        session
      );
    }

    await this.repository.createAuditEvent(
      {
        merchant: merchantId,
        payment: payment._id,
        recoveryCase: recoveryCase._id,
        recoveryAction: recoveryAction._id,
        providerEventId: internalAuditEventId(idempotencyKey, AUDIT_EVENT_TYPE.ACTION_RECOMMENDED),
        type: AUDIT_EVENT_TYPE.ACTION_RECOMMENDED,
        actor: ACTOR_TYPE.SYSTEM,
        reason: recommendation.reason,
        action: recommendation.action,
        result: 'RECOMMENDED_NOT_EXECUTED',
        metadata: {
          confidence: recommendation.confidence,
          diagnosis: recommendation.diagnosis,
          factors: recommendation.factors,
          requiresHumanReview: recommendation.requiresHumanReview,
          source: aiOutcome.source,
          provider: aiOutcome.provider,
          model: aiOutcome.model,
          promptVersion: aiOutcome.promptVersion
        }
      },
      session
    );

    await this.repository.createAuditEvent(
      {
        merchant: merchantId,
        payment: payment._id,
        recoveryCase: recoveryCase._id,
        recoveryAction: recoveryAction._id,
        providerEventId: internalAuditEventId(idempotencyKey, AUDIT_EVENT_TYPE.POLICY_EVALUATED),
        type: AUDIT_EVENT_TYPE.POLICY_EVALUATED,
        actor: ACTOR_TYPE.SYSTEM,
        reason: policyResult.reason,
        policyDecision: policyResult.decision === POLICY_DECISION.ALLOWED ? 'ALLOWED' : 'BLOCKED',
        action: recommendation.action
      },
      session
    );

    return {
      duplicate: false,
      recoveryCaseId: String(recoveryCase._id),
      paymentId: String(payment._id),
      recommendation,
      source: aiOutcome.source,
      policyDecision: { decision: policyResult.decision, reason: policyResult.reason },
      recoveryAction: serializeAction(recoveryAction)
    };
  }
}

function buildIdempotencyKey({ recoveryCase, action, attempt }) {
  const base = `${recoveryCase._id}:${action}:retry${recoveryCase.retryCount}:contact${recoveryCase.customerContactAttempts}`;
  return attempt === null ? base : `${base}:attempt${attempt}`;
}

function nextAttemptNumber(actions, actionType) {
  const attemptNumbers = actions
    .filter((action) => action.type === actionType)
    .map(attemptNumber);
  return Math.max(...attemptNumbers, 0) + 1;
}

function attemptNumber(action) {
  return Number(action.idempotencyKey.match(/:attempt(\d+)$/)?.[1] || 0);
}

function internalAuditEventId(idempotencyKey, eventType) {
  return `recoverai:${idempotencyKey}:${eventType}`;
}

function isDuplicateKeyError(error) {
  return error?.code === 11000 || error?.code === 11001;
}

function serializeAction(action) {
  return {
    id: String(action._id),
    type: action.type,
    status: action.status,
    recommendation: action.recommendation,
    policyDecision: action.policyDecision
  };
}

module.exports = { RecoveryRecommendationService };
