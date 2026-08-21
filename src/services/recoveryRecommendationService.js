const { AppError } = require('../utils/AppError');
const { RecoveryRecommendationRepository } = require('../repositories/recoveryRecommendationRepository');
const { MongoTransactionRunner } = require('./mongoTransactionRunner');
const { AiRecoveryAnalysisService, RECOMMENDATION_SOURCE } = require('./ai/aiRecoveryAnalysisService');
const { evaluateRecoveryAction } = require('./policyEngine');
const { RECOVERY_ACTION_STATUS, ACTOR_TYPE, AUDIT_EVENT_TYPE, POLICY_DECISION } = require('../constants/enums');

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

  async generateRecommendation({ merchantId, recoveryCaseId }) {
    try {
      return await this.transactionRunner.run((session) => this.#generateInTransaction(merchantId, recoveryCaseId, session));
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

  async #generateInTransaction(merchantId, recoveryCaseId, session) {
    const context = await this.repository.findRecoveryCaseWithPayment(merchantId, recoveryCaseId, session);
    if (!context || !context.payment) {
      throw new AppError('Recovery case not found.', 404);
    }
    const { recoveryCase, payment } = context;

    const policy = await this.repository.findOrCreatePolicy(merchantId, session);

    const aiOutcome = await this.aiAnalysisService.analyze({ payment, recoveryCase, policy });
    const recommendation = aiOutcome.recommendation;

    const policyResult = evaluateRecoveryAction({
      policy,
      payment,
      recoveryCase,
      recommendation: { type: recommendation.action, confidence: recommendation.confidence }
    });

    // Re-analyzing an unchanged case (same retry/contact counters) produces
    // the same key, so it returns the earlier recommendation instead of
    // writing a duplicate RecoveryAction + audit trail -- including the
    // AI-stage audit events collected above, which are simply discarded.
    const idempotencyKey = buildIdempotencyKey({ recoveryCase, action: recommendation.action });
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
        { merchant: merchantId, payment: payment._id, recoveryCase: recoveryCase._id, ...event },
        session
      );
    }

    await this.repository.createAuditEvent(
      {
        merchant: merchantId,
        payment: payment._id,
        recoveryCase: recoveryCase._id,
        recoveryAction: recoveryAction._id,
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

function buildIdempotencyKey({ recoveryCase, action }) {
  return `${recoveryCase._id}:${action}:retry${recoveryCase.retryCount}:contact${recoveryCase.customerContactAttempts}`;
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
