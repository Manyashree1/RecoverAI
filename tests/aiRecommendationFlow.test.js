const test = require('node:test');
const assert = require('node:assert/strict');
const { RecoveryRecommendationService } = require('../src/services/recoveryRecommendationService');
const { AiRecoveryAnalysisService } = require('../src/services/ai/aiRecoveryAnalysisService');
const { validResponseProvider, timeoutProvider } = require('./helpers/fakeAiProviders');
const {
  createStore,
  InMemoryRecoveryRecommendationRepository,
  InMemoryTransactionRunner
} = require('./helpers/inMemoryAppRepositories');
const { buildPayment, buildRecoveryCase, buildPolicy } = require('./helpers/fixtures');

function createService({ primaryProvider }) {
  const store = createStore();
  const repository = new InMemoryRecoveryRecommendationRepository(store);
  const service = new RecoveryRecommendationService({
    repository,
    transactionRunner: new InMemoryTransactionRunner(repository),
    aiAnalysisService: new AiRecoveryAnalysisService({ primaryProvider })
  });
  return { store, service };
}

test('an AI provider returning a valid recommendation results in an accepted RecoveryAction', async () => {
  const { store, service } = createService({ primaryProvider: validResponseProvider() });
  store.payments.push(buildPayment({ _id: 'p1', merchant: 'm1', amount: 800000 }));
  store.recoveryCases.push(buildRecoveryCase({ _id: 'c1', merchant: 'm1', payment: 'p1', retryCount: 0 }));

  const result = await service.generateRecommendation({ merchantId: 'm1', recoveryCaseId: 'c1' });

  assert.equal(result.source, 'AI');
  assert.equal(result.recommendation.action, 'RETRY_PAYMENT');
  assert.equal(result.recoveryAction.status, 'POLICY_ALLOWED');
  assert.equal(result.recoveryAction.recommendation.source, 'AI_AGENT');
});

test('an AI-recommended action the merchant policy disallows is blocked, not executed', async () => {
  const { store, service } = createService({ primaryProvider: validResponseProvider({ action: 'RETRY_PAYMENT' }) });
  store.policies.push(buildPolicy({ _id: 'policy_restricted', merchant: 'm1', allowedActions: ['ESCALATE_TO_HUMAN', 'NO_ACTION'] }));
  store.payments.push(buildPayment({ _id: 'p2', merchant: 'm1', amount: 800000 }));
  store.recoveryCases.push(buildRecoveryCase({ _id: 'c2', merchant: 'm1', payment: 'p2', retryCount: 0 }));

  const result = await service.generateRecommendation({ merchantId: 'm1', recoveryCaseId: 'c2' });

  assert.equal(result.recommendation.action, 'RETRY_PAYMENT');
  assert.equal(result.policyDecision.decision, 'BLOCKED');
  assert.equal(result.recoveryAction.status, 'POLICY_BLOCKED');
});

test('an AI recommendation never results in a financial action being executed', async () => {
  const { store, service } = createService({ primaryProvider: validResponseProvider() });
  store.payments.push(buildPayment({ _id: 'p3', merchant: 'm1', amount: 800000 }));
  store.recoveryCases.push(buildRecoveryCase({ _id: 'c3', merchant: 'm1', payment: 'p3', retryCount: 0 }));

  const result = await service.generateRecommendation({ merchantId: 'm1', recoveryCaseId: 'c3' });

  assert.equal(result.recoveryAction.execution, undefined);
  assert.notEqual(result.recoveryAction.status, 'EXECUTED');
  assert.notEqual(result.recoveryAction.status, 'QUEUED');
  assert.notEqual(result.recoveryAction.status, 'EXECUTING');
});

test('when the AI provider times out, a safe deterministic recommendation is still produced', async () => {
  const { store, service } = createService({ primaryProvider: timeoutProvider() });
  store.payments.push(buildPayment({ _id: 'p4', merchant: 'm1', amount: 800000 }));
  store.recoveryCases.push(buildRecoveryCase({ _id: 'c4', merchant: 'm1', payment: 'p4', retryCount: 0 }));

  const result = await service.generateRecommendation({ merchantId: 'm1', recoveryCaseId: 'c4' });

  assert.equal(result.source, 'DETERMINISTIC_FALLBACK');
  assert.ok(result.recoveryAction.id);
});

test('repeated recommendation requests for an unchanged case remain idempotent with an AI provider configured', async () => {
  const { store, service } = createService({ primaryProvider: validResponseProvider() });
  store.payments.push(buildPayment({ _id: 'p5', merchant: 'm1', amount: 800000 }));
  store.recoveryCases.push(buildRecoveryCase({ _id: 'c5', merchant: 'm1', payment: 'p5', retryCount: 0 }));

  const first = await service.generateRecommendation({ merchantId: 'm1', recoveryCaseId: 'c5' });
  const second = await service.generateRecommendation({ merchantId: 'm1', recoveryCaseId: 'c5' });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.recoveryAction.id, second.recoveryAction.id);
  assert.equal(store.recoveryActions.length, 1);
});
