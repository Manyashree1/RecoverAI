// Shared fixture builders for recovery-intelligence and merchant-scoped API
// tests. Kept separate from tests/fixtures/razorpayPaymentEvents.js, which
// builds raw Razorpay webhook payloads rather than domain documents.

function RECOVERY_POLICY_DEFAULTS() {
  return {
    maxAutomaticRetries: 2,
    maxTransactionAmount: 1000000,
    allowedActions: ['RETRY_PAYMENT', 'PAYMENT_METHOD_UPDATE', 'CUSTOMER_REMINDER', 'ESCALATE_TO_HUMAN', 'NO_ACTION'],
    minimumRecoveryConfidence: 0.7,
    maxCustomerContactAttempts: 1
  };
}

function buildPayment(overrides = {}) {
  return {
    _id: overrides._id || 'payment_1',
    merchant: overrides.merchant || 'merchant_1',
    customer: overrides.customer || 'customer_1',
    amount: 200000,
    currency: 'INR',
    status: 'FAILED',
    failure: { code: 'insufficient_funds', description: 'Insufficient funds in account.' },
    attemptCount: 1,
    ...overrides
  };
}

function buildRecoveryCase(overrides = {}) {
  return {
    _id: overrides._id || 'case_1',
    merchant: overrides.merchant || 'merchant_1',
    payment: overrides.payment || 'payment_1',
    status: 'DETECTED',
    retryCount: 0,
    customerContactAttempts: 0,
    recoveredAmount: 0,
    ...overrides
  };
}

function buildPolicy(overrides = {}) {
  return { _id: overrides._id || 'policy_1', merchant: overrides.merchant || 'merchant_1', ...RECOVERY_POLICY_DEFAULTS(), ...overrides };
}

module.exports = { RECOVERY_POLICY_DEFAULTS, buildPayment, buildRecoveryCase, buildPolicy };
