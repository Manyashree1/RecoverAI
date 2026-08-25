const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRecoveryAction } = require('../src/services/policyEngine');
const { analyzeRecoveryCase } = require('../src/services/recoveryIntelligenceService');
const { DEMO_POLICY_CONFIG, DEMO_SCENARIOS } = require('../scripts/seedDemoData');

test('demo seed configures a bounded reminder-only policy at the deterministic confidence floor', () => {
  assert.deepEqual(DEMO_POLICY_CONFIG.allowedActions, ['CUSTOMER_REMINDER']);
  assert.equal(DEMO_POLICY_CONFIG.minimumRecoveryConfidence, 0.6);
  assert.equal(DEMO_POLICY_CONFIG.maxAutomaticRetries, 2);
  assert.equal(DEMO_POLICY_CONFIG.maxCustomerContactAttempts, 1);
});

test('demo policy allows only the retry-limit customer reminder recommendation', () => {
  const policy = { ...DEMO_POLICY_CONFIG };
  const scenarios = DEMO_SCENARIOS.map((scenario) => {
    const payment = { amount: scenario.amount, status: 'FAILED', failure: { code: scenario.code } };
    const recoveryCase = { status: 'DETECTED', retryCount: scenario.id === 'limit' ? 2 : 0, customerContactAttempts: 0 };
    const recommendation = analyzeRecoveryCase({ payment, recoveryCase, policy });
    const decision = evaluateRecoveryAction({ payment, recoveryCase, policy, recommendation: { type: recommendation.action, confidence: recommendation.confidence } });
    return { id: scenario.id, action: recommendation.action, decision: decision.decision };
  });

  assert.deepEqual(scenarios, [
    { id: 'temporary', action: 'RETRY_PAYMENT', decision: 'BLOCKED' },
    { id: 'blocked', action: 'PAYMENT_METHOD_UPDATE', decision: 'BLOCKED' },
    { id: 'limit', action: 'CUSTOMER_REMINDER', decision: 'ALLOWED' },
    { id: 'failed', action: 'RETRY_PAYMENT', decision: 'BLOCKED' }
  ]);
});

test('demo policy keeps unsupported automatic actions blocked', () => {
  const policy = { ...DEMO_POLICY_CONFIG };
  const payment = { amount: 75000, status: 'FAILED' };
  const recoveryCase = { status: 'DETECTED', retryCount: 0, customerContactAttempts: 0 };

  assert.equal(evaluateRecoveryAction({ policy, payment, recoveryCase, recommendation: { type: 'RETRY_PAYMENT', confidence: 0.95 } }).decision, 'BLOCKED');
  assert.equal(evaluateRecoveryAction({ policy, payment, recoveryCase, recommendation: { type: 'PAYMENT_METHOD_UPDATE', confidence: 0.95 } }).decision, 'BLOCKED');
});

test('demo seed scenarios use stable unique selectors for repeatable upserts', () => {
  const firstRunKeys = DEMO_SCENARIOS.map((scenario) => `demo:${scenario.id}`);
  const secondRunKeys = DEMO_SCENARIOS.map((scenario) => `demo:${scenario.id}`);

  assert.deepEqual(firstRunKeys, secondRunKeys);
  assert.equal(new Set(firstRunKeys).size, DEMO_SCENARIOS.length);
  assert.deepEqual(DEMO_SCENARIOS.map((scenario) => scenario.id), ['temporary', 'blocked', 'limit', 'failed']);
});