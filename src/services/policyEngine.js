const {
  RECOVERY_ACTION_TYPE,
  POLICY_DECISION
} = require('../constants/enums');

/**
 * Pure, deterministic gate for a recommendation. It deliberately does not call
 * an LLM or Razorpay, so every result can be tested and audited before execution.
 */
function evaluateRecoveryAction({ policy, payment, recoveryCase, recommendation }) {
  const action = recommendation.type;
  const confidence = recommendation.confidence;

  if (!policy.allowedActions.includes(action)) {
    return blocked('The merchant policy does not allow this recovery action.');
  }

  if (confidence < policy.minimumRecoveryConfidence) {
    return blocked('The recommendation confidence is below the merchant minimum.');
  }

  if (payment.amount > policy.maxTransactionAmount) {
    return blocked('The payment amount exceeds the automatic recovery limit.');
  }

  if (action === RECOVERY_ACTION_TYPE.RETRY_PAYMENT && recoveryCase.retryCount >= policy.maxAutomaticRetries) {
    return blocked('Maximum automatic retry count reached.');
  }

  if (
    action === RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER &&
    recoveryCase.customerContactAttempts >= policy.maxCustomerContactAttempts
  ) {
    return blocked('Maximum customer contact attempt count reached.');
  }

  return {
    decision: POLICY_DECISION.ALLOWED,
    allowed: true,
    reason: 'The recommendation satisfies the merchant recovery policy.'
  };
}

function blocked(reason) {
  return { decision: POLICY_DECISION.BLOCKED, allowed: false, reason };
}

module.exports = { evaluateRecoveryAction };

