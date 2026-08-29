const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateStoppingRules, STOPPING_DECISION } = require('../src/services/stoppingRulesEngine');
const { RECOVERY_ACTION_TYPE, RECOVERY_CASE_STATUS } = require('../src/constants/enums');
const { buildRecoveryCase, buildPolicy } = require('./helpers/fixtures');

function buildPayment(overrides = {}) {
  return { _id: 'p1', merchant: 'm1', amount: 50000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' }, ...overrides };
}

function buildExistingActions(overrides = []) {
  return overrides;
}

test('evaluateStoppingRules allows action when no rules are triggered', () => {
  const result = evaluateStoppingRules({
    policy: buildPolicy(),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ retryCount: 0, customerContactAttempts: 0, status: RECOVERY_CASE_STATUS.DETECTED }),
    action: RECOVERY_ACTION_TYPE.RETRY_PAYMENT,
    existingActions: buildExistingActions()
  });

  assert.equal(result.decision, STOPPING_DECISION.ALLOW);
  assert.equal(result.rule, 'NONE');
});

test('evaluateStoppingRules blocks when case is in terminal RECOVERED state', () => {
  const result = evaluateStoppingRules({
    policy: buildPolicy(),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ status: RECOVERY_CASE_STATUS.RECOVERED }),
    action: RECOVERY_ACTION_TYPE.RETRY_PAYMENT,
    existingActions: buildExistingActions()
  });

  assert.equal(result.decision, STOPPING_DECISION.BLOCK);
  assert.equal(result.rule, 'TERMINAL_STATE');
  assert.ok(result.evidence.caseStatus);
});

test('evaluateStoppingRules blocks when case is CLOSED', () => {
  const result = evaluateStoppingRules({
    policy: buildPolicy(),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ status: RECOVERY_CASE_STATUS.CLOSED }),
    action: RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER,
    existingActions: buildExistingActions()
  });

  assert.equal(result.decision, STOPPING_DECISION.BLOCK);
  assert.equal(result.rule, 'TERMINAL_STATE');
});

test('evaluateStoppingRules blocks when payment is already captured', () => {
  const result = evaluateStoppingRules({
    policy: buildPolicy(),
    payment: buildPayment({ status: 'CAPTURED' }),
    recoveryCase: buildRecoveryCase({ status: RECOVERY_CASE_STATUS.DETECTED }),
    action: RECOVERY_ACTION_TYPE.RETRY_PAYMENT,
    existingActions: buildExistingActions()
  });

  assert.equal(result.decision, STOPPING_DECISION.BLOCK);
  assert.equal(result.rule, 'PAYMENT_CAPTURED');
});

test('evaluateStoppingRules escalates when max retries exhausted for RETRY_PAYMENT', () => {
  const result = evaluateStoppingRules({
    policy: buildPolicy({ maxAutomaticRetries: 2 }),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ retryCount: 2, status: RECOVERY_CASE_STATUS.DETECTED }),
    action: RECOVERY_ACTION_TYPE.RETRY_PAYMENT,
    existingActions: buildExistingActions()
  });

  assert.equal(result.decision, STOPPING_DECISION.ESCALATE);
  assert.equal(result.rule, 'MAX_RETRIES_EXHAUSTED');
  assert.equal(result.evidence.retryCount, 2);
  assert.equal(result.evidence.maxRetries, 2);
});

test('evaluateStoppingRules escalates on contact fatigue for CUSTOMER_REMINDER', () => {
  const result = evaluateStoppingRules({
    policy: buildPolicy({ maxCustomerContactAttempts: 1 }),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ customerContactAttempts: 1, status: RECOVERY_CASE_STATUS.DETECTED }),
    action: RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER,
    existingActions: buildExistingActions()
  });

  assert.equal(result.decision, STOPPING_DECISION.ESCALATE);
  assert.equal(result.rule, 'CONTACT_FATIGUE');
});

test('evaluateStoppingRules blocks during cooldown period', () => {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const result = evaluateStoppingRules({
    policy: buildPolicy({ cooldownMinutes: 60 }),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ status: RECOVERY_CASE_STATUS.DETECTED }),
    action: RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER,
    existingActions: buildExistingActions([{ createdAt: tenMinutesAgo }])
  });

  assert.equal(result.decision, STOPPING_DECISION.BLOCK);
  assert.equal(result.rule, 'COOLDOWN');
  assert.ok(result.evidence.remainingMinutes > 0);
});

test('evaluateStoppingRules allows after cooldown period elapses', () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const result = evaluateStoppingRules({
    policy: buildPolicy({ cooldownMinutes: 60 }),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ status: RECOVERY_CASE_STATUS.DETECTED }),
    action: RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER,
    existingActions: buildExistingActions([{ createdAt: twoHoursAgo }])
  });

  assert.notEqual(result.decision, STOPPING_DECISION.BLOCK);
});

test('evaluateStoppingRules escalates when all automation channels exhausted', () => {
  const result = evaluateStoppingRules({
    policy: buildPolicy({ maxAutomaticRetries: 2, maxCustomerContactAttempts: 1 }),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ retryCount: 2, customerContactAttempts: 1, status: RECOVERY_CASE_STATUS.DETECTED }),
    action: RECOVERY_ACTION_TYPE.ESCALATE_TO_HUMAN,
    existingActions: buildExistingActions()
  });

  assert.equal(result.decision, STOPPING_DECISION.ESCALATE);
  assert.equal(result.rule, 'AUTOMATION_EXHAUSTED');
});

test('evaluateStoppingRules ESCALATE takes priority over BLOCK', () => {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const result = evaluateStoppingRules({
    policy: buildPolicy({ maxAutomaticRetries: 2, cooldownMinutes: 60 }),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ retryCount: 2, status: RECOVERY_CASE_STATUS.DETECTED }),
    action: RECOVERY_ACTION_TYPE.RETRY_PAYMENT,
    existingActions: buildExistingActions([{ createdAt: tenMinutesAgo }])
  });

  assert.equal(result.decision, STOPPING_DECISION.ESCALATE);
});

test('evaluateStoppingRules BLOCK takes priority over ALLOW', () => {
  const result = evaluateStoppingRules({
    policy: buildPolicy({ maxAutomaticRetries: 5 }),
    payment: buildPayment(),
    recoveryCase: buildRecoveryCase({ retryCount: 0, status: RECOVERY_CASE_STATUS.RECOVERED }),
    action: RECOVERY_ACTION_TYPE.RETRY_PAYMENT,
    existingActions: buildExistingActions()
  });

  assert.equal(result.decision, STOPPING_DECISION.BLOCK);
});
