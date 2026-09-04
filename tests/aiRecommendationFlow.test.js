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

test('a failed action can create one new policy-gated recovery attempt without changing the old action', async () => {
  const { store, service } = createService({ primaryProvider: null });
  store.payments.push(buildPayment({ _id: 'p6', merchant: 'm1', amount: 75000 }));
  store.recoveryCases.push(buildRecoveryCase({ _id: 'c6', merchant: 'm1', payment: 'p6', retryCount: 2 }));
  store.policies.push(buildPolicy({ merchant: 'm1', allowedActions: ['CUSTOMER_REMINDER'], minimumRecoveryConfidence: 0.6 }));
  store.recoveryActions.push({
    _id: 'old_action', merchant: 'm1', payment: 'p6', recoveryCase: 'c6', type: 'CUSTOMER_REMINDER', status: 'FAILED',
    recommendation: { source: 'SYSTEM', confidence: 0.6, rationale: 'Previous provider failure.' },
    policyDecision: { decision: 'ALLOWED', reason: 'Previously allowed.' },
    idempotencyKey: 'c6:CUSTOMER_REMINDER:retry2:contact0'
  });

  const result = await service.generateRecommendation({ merchantId: 'm1', recoveryCaseId: 'c6', newAttempt: true });

  assert.equal(result.duplicate, false);
  assert.equal(result.recommendation.action, 'CUSTOMER_REMINDER');
  assert.equal(result.recommendation.confidence, 0.6);
  assert.equal(result.policyDecision.decision, 'ALLOWED');
  assert.equal(result.recoveryAction.status, 'POLICY_ALLOWED');
  assert.match(result.recoveryAction.id, /^action_/);
  assert.match(store.recoveryActions.at(-1).idempotencyKey, /:attempt1$/);
  assert.equal(store.recoveryActions[0].status, 'FAILED');
});

test('a repeated new recovery attempt is idempotent and unsupported actions remain blocked', async () => {
  const { store, service } = createService({ primaryProvider: null });
  store.payments.push(buildPayment({ _id: 'p7', merchant: 'm1', amount: 75000 }));
  store.recoveryCases.push(buildRecoveryCase({ _id: 'c7', merchant: 'm1', payment: 'p7', retryCount: 2 }));
  store.policies.push(buildPolicy({ merchant: 'm1', allowedActions: ['CUSTOMER_REMINDER'], minimumRecoveryConfidence: 0.6 }));
  store.recoveryActions.push({ _id: 'old7', merchant: 'm1', payment: 'p7', recoveryCase: 'c7', type: 'CUSTOMER_REMINDER', status: 'FAILED', recommendation: { confidence: 0.6 }, policyDecision: { decision: 'ALLOWED', reason: 'Previous' }, idempotencyKey: 'old7' });

  const first = await service.generateRecommendation({ merchantId: 'm1', recoveryCaseId: 'c7', newAttempt: true });
  const second = await service.generateRecommendation({ merchantId: 'm1', recoveryCaseId: 'c7', newAttempt: true });

  assert.equal(second.duplicate, true);
  assert.equal(second.recoveryAction.id, first.recoveryAction.id);
  assert.equal(store.recoveryActions.length, 2);
  assert.equal(require('../src/services/policyEngine').evaluateRecoveryAction({ policy: store.policies[0], payment: store.payments[0], recoveryCase: store.recoveryCases[0], recommendation: { type: 'RETRY_PAYMENT', confidence: 0.95 } }).decision, 'BLOCKED');
});

test('a valid recommendation persists diagnosis onto the recovery case and emits AI_DIAGNOSIS_RECORDED', async () => {
  const { store, service } = createService({ primaryProvider: validResponseProvider() });
  store.payments.push(buildPayment({ _id: 'p_diag', merchant: 'm_diag', amount: 50000, failure: { code: 'insufficient_funds' } }));
  store.recoveryCases.push(buildRecoveryCase({ _id: 'c_diag', merchant: 'm_diag', payment: 'p_diag', retryCount: 0 }));

  const result = await service.generateRecommendation({ merchantId: 'm_diag', recoveryCaseId: 'c_diag' });

  assert.equal(result.duplicate, false);
  const updatedCase = store.recoveryCases.find((c) => String(c._id) === 'c_diag');
  assert.ok(updatedCase.diagnosis, 'RecoveryCase.diagnosis must be persisted');
  assert.equal(updatedCase.diagnosis.category, 'TEMPORARY');
  assert.equal(updatedCase.diagnosis.explanation, 'Likely a temporary payment failure.');
  assert.equal(updatedCase.diagnosis.confidence, 0.9);

  const diagnosisEvent = store.auditEvents.find((e) => e.type === 'AI_DIAGNOSIS_RECORDED' && String(e.recoveryCase) === 'c_diag');
  assert.ok(diagnosisEvent, 'AI_DIAGNOSIS_RECORDED audit event must be created');
  assert.equal(diagnosisEvent.actor, 'SYSTEM');
  assert.equal(diagnosisEvent.result, 'DIAGNOSED');
});

test('a recommendation without diagnosis falls back to deterministic and still persists diagnosis', async () => {
  const { store, service } = createService({ primaryProvider: validResponseProvider({ diagnosis: undefined }) });
  store.payments.push(buildPayment({ _id: 'p_nodiag', merchant: 'm_nodiag', amount: 50000, failure: { code: 'insufficient_funds' } }));
  store.recoveryCases.push(buildRecoveryCase({ _id: 'c_nodiag', merchant: 'm_nodiag', payment: 'p_nodiag', retryCount: 0 }));

  await service.generateRecommendation({ merchantId: 'm_nodiag', recoveryCaseId: 'c_nodiag' });

  const updatedCase = store.recoveryCases.find((c) => String(c._id) === 'c_nodiag');
  assert.ok(updatedCase.diagnosis, 'RecoveryCase.diagnosis must be persisted from fallback');
  assert.equal(updatedCase.diagnosis.category, 'TEMPORARY');

  const diagnosisEvent = store.auditEvents.find((e) => e.type === 'AI_DIAGNOSIS_RECORDED' && String(e.recoveryCase) === 'c_nodiag');
  assert.ok(diagnosisEvent, 'AI_DIAGNOSIS_RECORDED audit event must be created from fallback');
  assert.equal(diagnosisEvent.actor, 'SYSTEM');
  assert.equal(diagnosisEvent.result, 'DIAGNOSED');
});
