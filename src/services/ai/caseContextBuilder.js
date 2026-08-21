/**
 * Builds the minimum case context sent to an AI provider (or the
 * deterministic fallback, which reads the same shape). Deliberately
 * excludes: document ids, customer PII (email/phone), merchant identity,
 * and anything security-sensitive (tokens, secrets, headers). The AI never
 * sees more than it needs to classify a failure and recommend an action.
 */
function buildCaseContext({ payment, recoveryCase, policy }) {
  return {
    payment: {
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      attemptCount: payment.attemptCount,
      failure: {
        code: payment.failure?.code || null,
        description: truncate(payment.failure?.description, 200)
      }
    },
    recoveryCase: {
      status: recoveryCase.status,
      retryCount: recoveryCase.retryCount,
      customerContactAttempts: recoveryCase.customerContactAttempts
    },
    policy: {
      allowedActions: policy.allowedActions,
      maxAutomaticRetries: policy.maxAutomaticRetries,
      maxTransactionAmount: policy.maxTransactionAmount,
      minimumRecoveryConfidence: policy.minimumRecoveryConfidence,
      maxCustomerContactAttempts: policy.maxCustomerContactAttempts
    }
  };
}

function truncate(value, maxLength) {
  if (typeof value !== 'string') return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

module.exports = { buildCaseContext };
