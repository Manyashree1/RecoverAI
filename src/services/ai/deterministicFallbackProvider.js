const { analyzeRecoveryCase } = require('../recoveryIntelligenceService');

const DIAGNOSIS_BY_CATEGORY = Object.freeze({
  TEMPORARY: 'Likely a temporary payment failure that may succeed on retry.',
  PAYMENT_METHOD_ISSUE: 'The payment method itself appears to be the problem (expired, declined, or blocked).',
  RISK: 'The failure carries a risk or fraud signal and needs human review.',
  UNKNOWN: 'The failure reason could not be classified from the available data.'
});

/**
 * Wraps the existing, pure `recoveryIntelligenceService` so it can stand in
 * for an AI provider behind the same `analyzeRecoveryCase(context)`
 * interface. This is the safety baseline: deterministic, fully explainable,
 * and always available, whether it is running because no AI provider is
 * configured or because the AI provider just failed.
 *
 * It is explicitly labeled `deterministic-fallback` rather than pretending
 * to be an AI result -- the audit trail and RecoveryAction record must
 * always be able to say which one actually produced a recommendation.
 */
class DeterministicFallbackProvider {
  constructor({ analyze = analyzeRecoveryCase } = {}) {
    this.analyze = analyze;
    this.name = 'deterministic-fallback';
    this.model = null;
  }

  // eslint-disable-next-line require-await
  async analyzeRecoveryCase(context) {
    const result = this.analyze({ payment: context.payment, recoveryCase: context.recoveryCase, policy: context.policy });
    const category = extractCategory(result.factors);
    return {
      action: result.action,
      confidence: result.confidence,
      diagnosis: DIAGNOSIS_BY_CATEGORY[category] || DIAGNOSIS_BY_CATEGORY.UNKNOWN,
      reason: result.reason,
      factors: result.factors,
      requiresHumanReview: result.requiresHumanReview,
      provider: this.name,
      model: this.model
    };
  }
}

function extractCategory(factors) {
  const factor = factors.find((f) => f.startsWith('FAILURE_CATEGORY:'));
  return factor ? factor.split(':')[1] : 'UNKNOWN';
}

module.exports = { DeterministicFallbackProvider };
