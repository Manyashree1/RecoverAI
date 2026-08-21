const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeRecoveryCase } = require('../src/services/recoveryIntelligenceService');
const { buildPayment, buildRecoveryCase, buildPolicy } = require('./helpers/fixtures');

test('high-value payment with low retry count and a temporary failure recommends a retry', () => {
  const payment = buildPayment({ amount: 800000, failure: { code: 'insufficient_funds' } });
  const recoveryCase = buildRecoveryCase({ retryCount: 0 });
  const policy = buildPolicy();

  const recommendation = analyzeRecoveryCase({ payment, recoveryCase, policy });

  assert.equal(recommendation.action, 'RETRY_PAYMENT');
  assert.equal(recommendation.requiresHumanReview, false);
  assert.ok(recommendation.confidence >= policy.minimumRecoveryConfidence);
  assert.ok(recommendation.factors.includes('HIGH_VALUE_PAYMENT'));
});

test('reaching the merchant retry limit produces a safe, non-retry recommendation', () => {
  const payment = buildPayment({ failure: { code: 'insufficient_funds' } });
  const recoveryCase = buildRecoveryCase({ retryCount: 2 }); // policy.maxAutomaticRetries === 2
  const policy = buildPolicy();

  const recommendation = analyzeRecoveryCase({ payment, recoveryCase, policy });

  assert.notEqual(recommendation.action, 'RETRY_PAYMENT');
  assert.ok(recommendation.factors.includes('RETRY_LIMIT_REACHED'));
});

test('a suspected-fraud failure always escalates to a human, regardless of retry count', () => {
  const payment = buildPayment({ failure: { code: 'fraud_suspected' } });
  const recoveryCase = buildRecoveryCase({ retryCount: 0 });
  const policy = buildPolicy();

  const recommendation = analyzeRecoveryCase({ payment, recoveryCase, policy });

  assert.equal(recommendation.action, 'ESCALATE_TO_HUMAN');
  assert.equal(recommendation.requiresHumanReview, true);
});

test('a payment-method failure recommends a payment method update', () => {
  const payment = buildPayment({ failure: { code: 'expired_card' } });
  const recoveryCase = buildRecoveryCase({ retryCount: 0 });
  const policy = buildPolicy();

  const recommendation = analyzeRecoveryCase({ payment, recoveryCase, policy });

  assert.equal(recommendation.action, 'PAYMENT_METHOD_UPDATE');
});

test('a case that already recovered is not eligible for a new recommendation', () => {
  const payment = buildPayment({ status: 'CAPTURED' });
  const recoveryCase = buildRecoveryCase({ status: 'RECOVERED' });
  const policy = buildPolicy();

  const recommendation = analyzeRecoveryCase({ payment, recoveryCase, policy });

  assert.equal(recommendation.action, 'NO_ACTION');
  assert.ok(recommendation.factors.includes('NOT_ELIGIBLE_FOR_RECOVERY'));
});

test('a low-confidence recommendation is always flagged for human review', () => {
  const payment = buildPayment({ failure: { code: 'some_unmapped_gateway_code' } });
  const recoveryCase = buildRecoveryCase({ retryCount: 0 });
  const policy = buildPolicy({ minimumRecoveryConfidence: 0.9 });

  const recommendation = analyzeRecoveryCase({ payment, recoveryCase, policy });

  assert.ok(recommendation.confidence < policy.minimumRecoveryConfidence);
  assert.equal(recommendation.requiresHumanReview, true);
});

test('confidence is always a probability between 0 and 1', () => {
  const policy = buildPolicy();
  const scenarios = [
    { code: 'insufficient_funds', retryCount: 0 },
    { code: 'insufficient_funds', retryCount: 5 },
    { code: 'card_declined', retryCount: 0 },
    { code: 'fraud_suspected', retryCount: 0 },
    { code: undefined, retryCount: 0 }
  ];

  for (const scenario of scenarios) {
    const recommendation = analyzeRecoveryCase({
      payment: buildPayment({ failure: { code: scenario.code } }),
      recoveryCase: buildRecoveryCase({ retryCount: scenario.retryCount }),
      policy
    });
    assert.ok(recommendation.confidence >= 0 && recommendation.confidence <= 1, `confidence out of range for ${JSON.stringify(scenario)}`);
  }
});
