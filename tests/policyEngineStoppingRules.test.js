const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRecoveryAction } = require('../src/services/policyEngine');
const { buildRecoveryCase, buildPolicy } = require('./helpers/fixtures');
const { RECOVERY_ACTION_TYPE, RECOVERY_CASE_STATUS, POLICY_DECISION } = require('../src/constants/enums');

function buildPayment(overrides = {}) {
  return { _id: 'p1', merchant: 'm1', amount: 50000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' }, ...overrides };
}

test('evaluateRecoveryAction returns escalate=true when stopping rule triggers ESCALATE', () => {
  const result = evaluateRecoveryAction({
    policy: buildPolicy({ maxAutomaticRetries: 2 }),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ retryCount: 2, status: RECOVERY_CASE_STATUS.DETECTED }),
    recommendation: { type: RECOVERY_ACTION_TYPE.RETRY_PAYMENT, confidence: 0.95 },
    existingActions: []
  });

  assert.equal(result.allowed, false);
  assert.equal(result.escalate, true);
  assert.equal(result.decision, POLICY_DECISION.BLOCKED);
  assert.ok(result.reason.includes('retry') || result.reason.includes('escalat'));
});

test('evaluateRecoveryAction returns escalate=false when stopping rule triggers BLOCK', () => {
  const result = evaluateRecoveryAction({
    policy: buildPolicy(),
    payment: buildPayment({ status: 'CAPTURED' }),
    recoveryCase: buildRecoveryCase({ status: RECOVERY_CASE_STATUS.DETECTED }),
    recommendation: { type: RECOVERY_ACTION_TYPE.RETRY_PAYMENT, confidence: 0.95 },
    existingActions: []
  });

  assert.equal(result.allowed, false);
  assert.equal(result.escalate, false);
  assert.equal(result.decision, POLICY_DECISION.BLOCKED);
});

test('evaluateRecoveryAction AI high confidence does not bypass terminal state stopping rule', () => {
  const result = evaluateRecoveryAction({
    policy: buildPolicy(),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ status: RECOVERY_CASE_STATUS.RECOVERED }),
    recommendation: { type: RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER, confidence: 0.99 },
    existingActions: []
  });

  assert.equal(result.allowed, false);
  assert.equal(result.decision, POLICY_DECISION.BLOCKED);
});

test('evaluateRecoveryAction AI high confidence does not bypass cooldown stopping rule', () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const result = evaluateRecoveryAction({
    policy: buildPolicy({ cooldownMinutes: 60 }),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ status: RECOVERY_CASE_STATUS.DETECTED }),
    recommendation: { type: RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER, confidence: 0.99 },
    existingActions: [{ createdAt: fiveMinutesAgo }]
  });

  assert.equal(result.allowed, false);
  assert.equal(result.decision, POLICY_DECISION.BLOCKED);
  assert.equal(result.stoppingRule, 'COOLDOWN');
});

test('evaluateRecoveryAction allows when all rules pass', () => {
  const result = evaluateRecoveryAction({
    policy: buildPolicy(),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ retryCount: 0, customerContactAttempts: 0, status: RECOVERY_CASE_STATUS.DETECTED }),
    recommendation: { type: RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER, confidence: 0.9 },
    existingActions: []
  });

  assert.equal(result.allowed, true);
  assert.equal(result.escalate, false);
  assert.equal(result.decision, POLICY_DECISION.ALLOWED);
});

test('evaluateRecoveryAction provides stopping rule and evidence in result', () => {
  const result = evaluateRecoveryAction({
    policy: buildPolicy({ maxAutomaticRetries: 1 }),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ retryCount: 1, status: RECOVERY_CASE_STATUS.DETECTED }),
    recommendation: { type: RECOVERY_ACTION_TYPE.RETRY_PAYMENT, confidence: 0.95 },
    existingActions: []
  });

  assert.ok(result.stoppingRule);
  assert.ok(result.stoppingEvidence);
});

test('evaluateRecoveryAction sets escalate=true only for ESCALATE stopping decision', () => {
  const escalateResult = evaluateRecoveryAction({
    policy: buildPolicy({ maxAutomaticRetries: 0 }),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ retryCount: 1, status: RECOVERY_CASE_STATUS.DETECTED }),
    recommendation: { type: RECOVERY_ACTION_TYPE.RETRY_PAYMENT, confidence: 0.95 },
    existingActions: []
  });
  assert.equal(escalateResult.escalate, true);

  const blockResult = evaluateRecoveryAction({
    policy: buildPolicy({ allowedActions: ['CUSTOMER_REMINDER'] }),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ retryCount: 0, status: RECOVERY_CASE_STATUS.DETECTED }),
    recommendation: { type: RECOVERY_ACTION_TYPE.RETRY_PAYMENT, confidence: 0.95 },
    existingActions: []
  });
  assert.equal(blockResult.escalate, false);
});
