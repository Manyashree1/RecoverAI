const { buildCaseContext } = require('./caseContextBuilder');
const { validateAiRecommendation } = require('./recommendationSchema');
const { DeterministicFallbackProvider } = require('./deterministicFallbackProvider');
const { createPrimaryAiProvider } = require('./aiProviderFactory');
const { SYSTEM_PROMPT, PROMPT_VERSION } = require('./prompt');
const { AI_PROVIDER_FAILURE_REASONS } = require('./aiProviderError');
const { AUDIT_EVENT_TYPE, ACTOR_TYPE } = require('../../constants/enums');

const RECOMMENDATION_SOURCE = Object.freeze({ AI: 'AI', DETERMINISTIC_FALLBACK: 'DETERMINISTIC_FALLBACK' });

/**
 * The AI stage of the pipeline:
 *
 *   RecoveryCase -> case context -> AI provider -> validate -> recommendation
 *                                         | (unavailable/invalid)
 *                                         v
 *                                   deterministic fallback -> recommendation
 *
 * This service NEVER touches the database and NEVER calls the policy
 * engine or Razorpay -- it only produces a validated recommendation plus a
 * list of audit-event drafts describing how it got there, for the caller
 * (RecoveryRecommendationService) to persist inside its own transaction.
 */
class AiRecoveryAnalysisService {
  constructor({
    primaryProvider = createPrimaryAiProvider(),
    fallbackProvider = new DeterministicFallbackProvider(),
    systemPrompt = SYSTEM_PROMPT,
    promptVersion = PROMPT_VERSION
  } = {}) {
    this.primaryProvider = primaryProvider;
    this.fallbackProvider = fallbackProvider;
    this.systemPrompt = systemPrompt;
    this.promptVersion = promptVersion;
  }

  async analyze({ payment, recoveryCase, policy }) {
    const context = buildCaseContext({ payment, recoveryCase, policy });
    const auditEvents = [];

    if (!this.primaryProvider) {
      auditEvents.push(
        draft(AUDIT_EVENT_TYPE.AI_FALLBACK_USED, 'No AI provider is configured; using the deterministic recommendation engine.', {
          reason: AI_PROVIDER_FAILURE_REASONS.NOT_CONFIGURED
        })
      );
      return this.#runFallback(context, auditEvents);
    }

    auditEvents.push(
      draft(AUDIT_EVENT_TYPE.AI_ANALYSIS_STARTED, 'Requesting an AI recovery recommendation.', {
        provider: this.primaryProvider.name,
        model: this.primaryProvider.model,
        promptVersion: this.promptVersion
      })
    );

    try {
      const raw = await this.primaryProvider.analyzeRecoveryCase(context, { systemPrompt: this.systemPrompt, promptVersion: this.promptVersion });
      const validation = validateAiRecommendation(raw);
      if (!validation.valid) {
        const error = new Error('AI response failed structured-output validation.');
        error.reason = AI_PROVIDER_FAILURE_REASONS.SCHEMA_VALIDATION_FAILED;
        error.details = validation.errors;
        throw error;
      }

      auditEvents.push(
        draft(AUDIT_EVENT_TYPE.AI_RECOMMENDATION_GENERATED, validation.value.reason, {
          provider: this.primaryProvider.name,
          model: this.primaryProvider.model,
          promptVersion: this.promptVersion,
          action: validation.value.action,
          confidence: validation.value.confidence
        })
      );

      return {
        recommendation: validation.value,
        source: RECOMMENDATION_SOURCE.AI,
        provider: this.primaryProvider.name,
        model: this.primaryProvider.model,
        promptVersion: this.promptVersion,
        auditEvents
      };
    } catch (error) {
      auditEvents.push(
        draft(AUDIT_EVENT_TYPE.AI_PROVIDER_FAILED, describeFailure(error), {
          reason: error.reason || AI_PROVIDER_FAILURE_REASONS.UNKNOWN_ERROR,
          provider: this.primaryProvider.name
        })
      );
      auditEvents.push(
        draft(AUDIT_EVENT_TYPE.AI_FALLBACK_USED, 'Falling back to the deterministic recommendation engine.', {
          reason: error.reason || AI_PROVIDER_FAILURE_REASONS.UNKNOWN_ERROR
        })
      );
      return this.#runFallback(context, auditEvents);
    }
  }

  async #runFallback(context, auditEvents) {
    const raw = await this.fallbackProvider.analyzeRecoveryCase(context);
    const validation = validateAiRecommendation(raw);
    // The deterministic provider's own output is trusted code, not
    // untrusted model output, but it is still run through the same
    // validator so the recommendation shape has exactly one source of
    // truth and a bug there cannot silently produce a malformed record.
    if (!validation.valid) {
      throw new Error(`Deterministic fallback produced an invalid recommendation: ${validation.errors.join(' ')}`);
    }
    return {
      recommendation: validation.value,
      source: RECOMMENDATION_SOURCE.DETERMINISTIC_FALLBACK,
      provider: raw.provider,
      model: raw.model || null,
      promptVersion: null,
      auditEvents
    };
  }
}

function draft(type, reason, metadata) {
  return { type, actor: ACTOR_TYPE.SYSTEM, reason, metadata };
}

function describeFailure(error) {
  if (error.reason === AI_PROVIDER_FAILURE_REASONS.SCHEMA_VALIDATION_FAILED) {
    return 'The AI response failed structured-output validation.';
  }
  return error.message || 'The AI provider failed.';
}

module.exports = { AiRecoveryAnalysisService, RECOMMENDATION_SOURCE };
