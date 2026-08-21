const test = require('node:test');
const assert = require('node:assert/strict');
const { AiRecoveryAnalysisService, RECOMMENDATION_SOURCE } = require('../src/services/ai/aiRecoveryAnalysisService');
const { DeterministicFallbackProvider } = require('../src/services/ai/deterministicFallbackProvider');
const { FakeAiProvider, timeoutProvider, networkErrorProvider, malformedResponseProvider, validResponseProvider } = require('./helpers/fakeAiProviders');
const { buildPayment, buildRecoveryCase, buildPolicy } = require('./helpers/fixtures');

function scenario() {
  return { payment: buildPayment({ amount: 800000 }), recoveryCase: buildRecoveryCase({ retryCount: 0 }), policy: buildPolicy() };
}

test('no primary provider configured uses the deterministic fallback directly, with no AI attempt recorded', async () => {
  const service = new AiRecoveryAnalysisService({ primaryProvider: null });
  const result = await service.analyze(scenario());

  assert.equal(result.source, RECOMMENDATION_SOURCE.DETERMINISTIC_FALLBACK);
  assert.equal(result.provider, 'deterministic-fallback');
  assert.deepEqual(
    result.auditEvents.map((e) => e.type),
    ['AI_FALLBACK_USED']
  );
});

test('a valid AI response is accepted as-is, with an analysis-started and generated audit trail', async () => {
  const provider = validResponseProvider();
  const service = new AiRecoveryAnalysisService({ primaryProvider: provider });
  const result = await service.analyze(scenario());

  assert.equal(result.source, RECOMMENDATION_SOURCE.AI);
  assert.equal(result.recommendation.action, 'RETRY_PAYMENT');
  assert.equal(result.provider, 'fake-ai');
  assert.deepEqual(
    result.auditEvents.map((e) => e.type),
    ['AI_ANALYSIS_STARTED', 'AI_RECOMMENDATION_GENERATED']
  );
  // The context handed to the provider never carries ids, customer PII, or secrets.
  const [sentContext] = provider.calls.map((c) => c.context);
  assert.equal(sentContext.payment.amount, 800000);
  assert.equal(sentContext.customer, undefined);
  assert.equal(sentContext.merchant, undefined);
});

test('an AI response with an invalid action is rejected and the deterministic fallback is used instead', async () => {
  const provider = validResponseProvider({ action: 'DO_ANYTHING_I_WANT' });
  const service = new AiRecoveryAnalysisService({ primaryProvider: provider });
  const result = await service.analyze(scenario());

  assert.equal(result.source, RECOMMENDATION_SOURCE.DETERMINISTIC_FALLBACK);
  const types = result.auditEvents.map((e) => e.type);
  assert.deepEqual(types, ['AI_ANALYSIS_STARTED', 'AI_PROVIDER_FAILED', 'AI_FALLBACK_USED']);
  const failedEvent = result.auditEvents.find((e) => e.type === 'AI_PROVIDER_FAILED');
  assert.equal(failedEvent.metadata.reason, 'SCHEMA_VALIDATION_FAILED');
});

test('an AI response with an invalid confidence is rejected and the fallback is used', async () => {
  const provider = validResponseProvider({ confidence: 42 });
  const service = new AiRecoveryAnalysisService({ primaryProvider: provider });
  const result = await service.analyze(scenario());

  assert.equal(result.source, RECOMMENDATION_SOURCE.DETERMINISTIC_FALLBACK);
});

test('a malformed provider response triggers the fallback without crashing', async () => {
  const service = new AiRecoveryAnalysisService({ primaryProvider: malformedResponseProvider() });
  const result = await service.analyze(scenario());

  assert.equal(result.source, RECOMMENDATION_SOURCE.DETERMINISTIC_FALLBACK);
  const failedEvent = result.auditEvents.find((e) => e.type === 'AI_PROVIDER_FAILED');
  assert.equal(failedEvent.metadata.reason, 'INVALID_RESPONSE');
});

test('a provider timeout triggers the fallback and does not throw', async () => {
  const service = new AiRecoveryAnalysisService({ primaryProvider: timeoutProvider() });
  const result = await service.analyze(scenario());

  assert.equal(result.source, RECOMMENDATION_SOURCE.DETERMINISTIC_FALLBACK);
  const failedEvent = result.auditEvents.find((e) => e.type === 'AI_PROVIDER_FAILED');
  assert.equal(failedEvent.metadata.reason, 'TIMEOUT');
});

test('a provider that is unreachable (network error) triggers the fallback', async () => {
  const service = new AiRecoveryAnalysisService({ primaryProvider: networkErrorProvider() });
  const result = await service.analyze(scenario());

  assert.equal(result.source, RECOMMENDATION_SOURCE.DETERMINISTIC_FALLBACK);
  const failedEvent = result.auditEvents.find((e) => e.type === 'AI_PROVIDER_FAILED');
  assert.equal(failedEvent.metadata.reason, 'NETWORK_ERROR');
});

test('the fallback recommendation is always explicitly labeled, never mistaken for an AI result', async () => {
  const service = new AiRecoveryAnalysisService({ primaryProvider: networkErrorProvider(), fallbackProvider: new DeterministicFallbackProvider() });
  const result = await service.analyze(scenario());

  assert.equal(result.provider, 'deterministic-fallback');
  assert.notEqual(result.source, RECOMMENDATION_SOURCE.AI);
});
