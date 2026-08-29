const test = require('node:test');
const assert = require('node:assert/strict');
const { computeRecoveryScore, SCORE_BOUNDS, classifyScore } = require('../src/services/recoveryScoreService');

test('computeRecoveryScore returns bounded score', () => {
  const result = computeRecoveryScore({
    payment: { failure: { code: 'insufficient_funds' }, amount: 5000 },
    recoveryCase: { status: 'DETECTED', retryCount: 1, customerContactAttempts: 0, diagnosis: { explanation: 'Temp fail' } },
    policy: { allowedActions: ['CUSTOMER_REMINDER', 'RETRY_PAYMENT'], maxAutomaticRetries: 3, maxCustomerContactAttempts: 2 }
  });
  assert.ok(result.score >= SCORE_BOUNDS.min);
  assert.ok(result.score <= SCORE_BOUNDS.max);
});

test('computeRecoveryScore classifies high potential', () => {
  const result = computeRecoveryScore({
    payment: { failure: { code: 'insufficient_funds' }, amount: 5000 },
    recoveryCase: { status: 'DETECTED', retryCount: 0, customerContactAttempts: 0, diagnosis: { explanation: 'Temp fail' } },
    policy: { allowedActions: ['CUSTOMER_REMINDER', 'RETRY_PAYMENT'], maxAutomaticRetries: 5, maxCustomerContactAttempts: 5 }
  });
  assert.equal(result.classification, 'HIGH_RECOVERY_POTENTIAL');
});

test('computeRecoveryScore classifies low potential for terminal case', () => {
  const result = computeRecoveryScore({
    payment: { failure: { code: 'fraud_suspected' }, amount: 5000 },
    recoveryCase: { status: 'CLOSED', retryCount: 0, customerContactAttempts: 0 },
    policy: { allowedActions: ['CUSTOMER_REMINDER'], maxAutomaticRetries: 3, maxCustomerContactAttempts: 2 }
  });
  assert.equal(result.classification, 'NOT_ELIGIBLE');
  assert.equal(result.score, 0);
});

test('computeRecoveryScore returns deterministic factors', () => {
  const result = computeRecoveryScore({
    payment: { failure: { code: 'insufficient_funds' }, amount: 5000 },
    recoveryCase: { status: 'DETECTED', retryCount: 1, customerContactAttempts: 0, diagnosis: { explanation: 'Temp fail' } },
    policy: { allowedActions: ['CUSTOMER_REMINDER'], maxAutomaticRetries: 5, maxCustomerContactAttempts: 5 }
  });
  assert.ok(Array.isArray(result.factors));
  assert.ok(result.factors.length > 0);
  assert.ok(result.explanation.components.length > 0);
});

test('computeRecoveryScore confidence is bounded', () => {
  const result = computeRecoveryScore({
    payment: { failure: { code: 'insufficient_funds' }, amount: 5000 },
    recoveryCase: { status: 'DETECTED', retryCount: 0, customerContactAttempts: 0, diagnosis: { explanation: 'Temp fail' } },
    policy: { allowedActions: ['RETRY_PAYMENT'], maxAutomaticRetries: 5, maxCustomerContactAttempts: 5 }
  });
  assert.ok(result.confidence >= 0);
  assert.ok(result.confidence <= 1);
});

test('classifyScore thresholds are correct', () => {
  assert.equal(classifyScore(70), 'HIGH_RECOVERY_POTENTIAL');
  assert.equal(classifyScore(40), 'MEDIUM_RECOVERY_POTENTIAL');
  assert.equal(classifyScore(39), 'LOW_RECOVERY_POTENTIAL');
});
