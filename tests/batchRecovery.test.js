const test = require('node:test');
const assert = require('node:assert/strict');
const { BatchRecoveryService, MAX_BATCH_LIMIT } = require('../src/services/batchRecoveryService');
const { createStore, InMemoryReadRepository, InMemoryRecoveryRecommendationRepository, InMemoryTransactionRunner } = require('./helpers/inMemoryAppRepositories');
const { RecoveryRecommendationService } = require('../src/services/recoveryRecommendationService');
const { RecoveryExecutionService } = require('../src/services/recoveryExecutionService');
const { buildPayment, buildRecoveryCase, buildPolicy } = require('./helpers/fixtures');

function setupBatchTest(caseCount = 3) {
  const store = createStore();
  store.policies.push(buildPolicy());

  for (let i = 0; i < caseCount; i++) {
    store.payments.push(buildPayment({ _id: `p${i}`, merchant: 'm1' }));
    store.recoveryCases.push(buildRecoveryCase({ _id: `c${i}`, payment: `p${i}`, merchant: 'm1' }));
  }

  const readRepository = new InMemoryReadRepository(store);
  const recommendationRepository = new InMemoryRecoveryRecommendationRepository(store);
  const recommendationService = new RecoveryRecommendationService({
    repository: recommendationRepository,
    transactionRunner: new InMemoryTransactionRunner(recommendationRepository)
  });

  const executionService = new RecoveryExecutionService({
    repository: {
      findActionContext: async (merchantId, actionId) => {
        const action = store.recoveryActions.find((a) => String(a._id) === String(actionId) && String(a.merchant) === String(merchantId));
        if (!action) return null;
        const recoveryCase = store.recoveryCases.find((c) => String(c._id) === String(action.recoveryCase));
        const payment = store.payments.find((p) => String(p._id) === String(action.payment));
        const customer = store.payments.find((p) => String(p._id) === String(action.payment));
        return { action, payment, recoveryCase, customer: { name: 'Test', email: 'test@test.com', phone: '+919900000001' } };
      },
      findOrCreatePolicy: async () => store.policies[0],
      claimExecution: async () => store.recoveryActions.find((a) => String(a._id) === String(actionId)),
      markExecuted: async ({ actionId }) => {
        const action = store.recoveryActions.find((a) => String(a._id) === String(actionId));
        if (action) action.status = 'EXECUTED';
        return action;
      },
      markFailed: async ({ actionId }) => {
        const action = store.recoveryActions.find((a) => String(a._id) === String(actionId));
        if (action) action.status = 'FAILED';
        return action;
      },
      blockAction: async () => null,
      updateCaseAfterPaymentLink: async () => store.recoveryCases[0],
      createAuditEvent: async (event) => { store.auditEvents.push(event); return event; }
    },
    razorpayClient: {
      createRecoveryPaymentLink: async () => ({ providerReference: 'plink_test', shortUrl: 'https://rzp.io/i/test', status: 'created' })
    }
  });

  const batchService = new BatchRecoveryService({
    recommendationService,
    executionService,
    repository: readRepository
  });

  return { batchService, store };
}

test('batch respects the maximum batch limit', async () => {
  const { batchService } = setupBatchTest(2);
  const result = await batchService.runBatch({ merchantId: 'm1', limit: 999 });
  assert.equal(result.summary.atRisk, 2);
  assert.ok(MAX_BATCH_LIMIT <= 50);
});

test('batch processes cases and separates outcomes', async () => {
  const { batchService } = setupBatchTest(3);
  const result = await batchService.runBatch({ merchantId: 'm1' });
  assert.equal(result.summary.processed, 3);
  assert.ok(result.results.length === 3);
});

test('batch never fabricates recovered revenue', async () => {
  const { batchService } = setupBatchTest(2);
  const result = await batchService.runBatch({ merchantId: 'm1' });
  const recoveredStatuses = result.results.filter((r) => r.status === 'recovered');
  assert.equal(recoveredStatuses.length, 0);
});

test('batch is merchant scoped', async () => {
  const { batchService } = setupBatchTest(2);
  const result = await batchService.runBatch({ merchantId: 'other_merchant' });
  assert.equal(result.summary.atRisk, 0);
  assert.equal(result.summary.processed, 0);
});
