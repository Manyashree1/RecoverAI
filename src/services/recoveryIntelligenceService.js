const { RECOVERY_ACTION_TYPE, PAYMENT_STATUS, OPEN_RECOVERY_CASE_STATUSES } = require('../constants/enums');

/**
 * Deterministic, rule-based first-stage recovery intelligence.
 *
 * This intentionally contains no LLM call and no probabilistic model. The
 * project is establishing a reliable, fully-explainable decision pipeline
 * first; an AI-generated recommendation can later replace or extend this
 * module's output without any other layer changing, because callers only
 * depend on the shape returned by `analyzeRecoveryCase`.
 *
 * Every branch below is a plain, named rule so the recommendation can be
 * explained factor-by-factor, and so each rule is independently testable.
 */

// A payment at or above this amount (in smallest currency subunits, e.g.
// paise for INR) is treated as "high value" for recommendation confidence.
const HIGH_VALUE_THRESHOLD = 500000; // e.g. INR 5,000.00

const FAILURE_CATEGORY = Object.freeze({
  TEMPORARY: 'TEMPORARY',
  PAYMENT_METHOD_ISSUE: 'PAYMENT_METHOD_ISSUE',
  RISK: 'RISK',
  UNKNOWN: 'UNKNOWN'
});

const TEMPORARY_FAILURE_CODES = new Set([
  'insufficient_funds',
  'payment_timeout',
  'gateway_error',
  'network_error',
  'bank_declined_temporary'
]);

const PAYMENT_METHOD_FAILURE_CODES = new Set(['card_declined', 'expired_card', 'invalid_card', 'card_blocked']);

const RISK_FAILURE_CODES = new Set(['fraud_suspected', 'risk_declined']);

/**
 * @param {object} input
 * @param {object} input.payment - Payment document (amount, status, failure).
 * @param {object} input.recoveryCase - RecoveryCase document (status, retryCount, customerContactAttempts).
 * @param {object} input.policy - Merchant's RecoveryPolicy document.
 * @returns {{action: string, confidence: number, reason: string, factors: string[], requiresHumanReview: boolean}}
 */
function analyzeRecoveryCase({ payment, recoveryCase, policy }) {
  const factors = [];

  if (payment.status !== PAYMENT_STATUS.FAILED || !OPEN_RECOVERY_CASE_STATUSES.includes(recoveryCase.status)) {
    factors.push('NOT_ELIGIBLE_FOR_RECOVERY');
    return finalize({
      action: RECOVERY_ACTION_TYPE.NO_ACTION,
      confidence: 1,
      factors,
      requiresHumanReview: false,
      policy,
      reasonOverride: 'The payment is not in a failed state that is still open for recovery.'
    });
  }

  const failureCategory = classifyFailure(payment.failure?.code);
  factors.push(`FAILURE_CATEGORY:${failureCategory}`);

  if (failureCategory === FAILURE_CATEGORY.RISK) {
    factors.push('RISK_OR_FRAUD_SIGNAL');
    return finalize({
      action: RECOVERY_ACTION_TYPE.ESCALATE_TO_HUMAN,
      confidence: 0.95,
      factors,
      requiresHumanReview: true,
      policy
    });
  }

  const retryLimitReached = recoveryCase.retryCount >= policy.maxAutomaticRetries;
  if (retryLimitReached) {
    factors.push('RETRY_LIMIT_REACHED');
    const contactLimitReached = recoveryCase.customerContactAttempts >= policy.maxCustomerContactAttempts;
    const action =
      failureCategory === FAILURE_CATEGORY.TEMPORARY && !contactLimitReached
        ? RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER
        : RECOVERY_ACTION_TYPE.ESCALATE_TO_HUMAN;
    if (contactLimitReached) factors.push('CONTACT_LIMIT_REACHED');
    return finalize({
      action,
      confidence: 0.6,
      factors,
      requiresHumanReview: action === RECOVERY_ACTION_TYPE.ESCALATE_TO_HUMAN,
      policy
    });
  }

  factors.push('RETRY_ATTEMPTS_AVAILABLE');
  const highValue = payment.amount >= HIGH_VALUE_THRESHOLD;
  if (highValue) factors.push('HIGH_VALUE_PAYMENT');

  if (failureCategory === FAILURE_CATEGORY.TEMPORARY) {
    const confidence = clampConfidence(0.9 - recoveryCase.retryCount * 0.05);
    return finalize({ action: RECOVERY_ACTION_TYPE.RETRY_PAYMENT, confidence, factors, requiresHumanReview: false, policy });
  }

  if (failureCategory === FAILURE_CATEGORY.PAYMENT_METHOD_ISSUE) {
    return finalize({
      action: RECOVERY_ACTION_TYPE.PAYMENT_METHOD_UPDATE,
      confidence: 0.8,
      factors,
      requiresHumanReview: false,
      policy
    });
  }

  // Unknown failure reason: recommend the low-risk option, and only ask for
  // human review if that recommendation would fall below the merchant's own
  // confidence bar.
  const confidence = 0.5;
  const action = confidence >= policy.minimumRecoveryConfidence ? RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER : RECOVERY_ACTION_TYPE.ESCALATE_TO_HUMAN;
  factors.push('UNKNOWN_FAILURE_REASON');
  return finalize({ action, confidence, factors, requiresHumanReview: action === RECOVERY_ACTION_TYPE.ESCALATE_TO_HUMAN, policy });
}

function classifyFailure(failureCode) {
  if (!failureCode) return FAILURE_CATEGORY.UNKNOWN;
  const normalized = String(failureCode).trim().toLowerCase();
  if (RISK_FAILURE_CODES.has(normalized)) return FAILURE_CATEGORY.RISK;
  if (TEMPORARY_FAILURE_CODES.has(normalized)) return FAILURE_CATEGORY.TEMPORARY;
  if (PAYMENT_METHOD_FAILURE_CODES.has(normalized)) return FAILURE_CATEGORY.PAYMENT_METHOD_ISSUE;
  return FAILURE_CATEGORY.UNKNOWN;
}

function clampConfidence(value) {
  return Math.min(0.95, Math.max(0.5, Number(value.toFixed(2))));
}

function finalize({ action, confidence, factors, requiresHumanReview, policy, reasonOverride }) {
  const belowMerchantConfidenceBar = confidence < policy.minimumRecoveryConfidence;
  if (belowMerchantConfidenceBar) factors.push('BELOW_MERCHANT_CONFIDENCE_THRESHOLD');

  return {
    action,
    confidence,
    reason: reasonOverride || buildReason(action, factors),
    factors,
    requiresHumanReview: requiresHumanReview || belowMerchantConfidenceBar
  };
}

function buildReason(action, factors) {
  return `Recommending ${action} based on: ${factors.join(', ')}.`;
}

module.exports = {
  analyzeRecoveryCase,
  classifyFailure,
  FAILURE_CATEGORY,
  HIGH_VALUE_THRESHOLD
};
