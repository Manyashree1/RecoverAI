const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { AuthService } = require('../src/services/authService');
const { createAuthMiddleware } = require('../src/middleware/authMiddleware');
const { createAuthController } = require('../src/controllers/authController');
const { createAuthRouter } = require('../src/routes/authRoutes');
const { createPaymentController } = require('../src/controllers/paymentController');
const { createPaymentRouter } = require('../src/routes/paymentRoutes');
const { createRecoveryCaseController } = require('../src/controllers/recoveryCaseController');
const { createRecoveryCaseRouter } = require('../src/routes/recoveryCaseRoutes');
const { createAuditEventController } = require('../src/controllers/auditEventController');
const { createAuditEventRouter } = require('../src/routes/auditEventRoutes');
const { createAnalyticsController } = require('../src/controllers/analyticsController');
const { createAnalyticsRouter } = require('../src/routes/analyticsRoutes');
const { RecoveryRecommendationService } = require('../src/services/recoveryRecommendationService');
const {
  createStore,
  InMemoryReadRepository,
  InMemoryRecoveryRecommendationRepository,
  InMemoryTransactionRunner
} = require('./helpers/inMemoryAppRepositories');
const { buildPayment, buildRecoveryCase, buildPolicy } = require('./helpers/fixtures');

async function startTestServer() {
  const store = createStore();
  const authService = new AuthService({ jwtSecret: 'test_jwt_secret', jwtExpiresIn: '1h' });
  const readRepository = new InMemoryReadRepository(store);
  const recommendationRepository = new InMemoryRecoveryRecommendationRepository(store);
  const requireAuth = createAuthMiddleware({ authService, repository: readRepository });

  const recommendationService = new RecoveryRecommendationService({
    repository: recommendationRepository,
    transactionRunner: new InMemoryTransactionRunner(recommendationRepository)
  });

  const app = createApp({
    authRouter: createAuthRouter({ controller: createAuthController({ authService, repository: readRepository }) }),
    paymentRouter: createPaymentRouter({ controller: createPaymentController({ repository: readRepository }), requireAuth }),
    recoveryCaseRouter: createRecoveryCaseRouter({
      controller: createRecoveryCaseController({ repository: readRepository, recommendationService }),
      requireAuth
    }),
    auditEventRouter: createAuditEventRouter({ controller: createAuditEventController({ repository: readRepository }), requireAuth }),
    analyticsRouter: createAnalyticsRouter({
      controller: createAnalyticsController({
        analyticsService: {
          overview: async (merchantId) => {
            const { calculateOverview } = require('../src/services/analyticsService');
            return calculateOverview({
              payments: store.payments.filter((payment) => payment.merchant === merchantId),
              recoveryCases: store.recoveryCases.filter((recoveryCase) => recoveryCase.merchant === merchantId),
              recoveryActions: store.recoveryActions.filter((action) => action.merchant === merchantId),
              auditEvents: store.auditEvents.filter((event) => event.merchant === merchantId)
            });
          }
        }
      }),
      requireAuth
    })
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return { server, baseUrl, store, authService };
}

async function seedMerchantWithUser(store, authService, { merchantId, email, password }) {
  const passwordHash = await authService.hashPassword(password);
  store.merchantUsers.push({ _id: `user_${merchantId}`, merchant: merchantId, email, passwordHash, role: 'MERCHANT_ADMIN', status: 'ACTIVE' });
}

function tokenFor(authService, { userId, merchantId, role = 'MERCHANT_ADMIN' }) {
  return authService.signSessionToken({ userId, merchantId, role });
}

test('merchant-scoped payments and recovery cases', async (t) => {
  const { server, baseUrl, store, authService } = await startTestServer();
  t.after(() => server.close());

  await seedMerchantWithUser(store, authService, { merchantId: 'merchant_1', email: 'admin1@example.com', password: 'correct horse 1' });
  await seedMerchantWithUser(store, authService, { merchantId: 'merchant_2', email: 'admin2@example.com', password: 'correct horse 2' });

  store.payments.push(buildPayment({ _id: 'payment_m1', merchant: 'merchant_1' }));
  store.payments.push(buildPayment({ _id: 'payment_m2', merchant: 'merchant_2' }));
  store.recoveryCases.push(buildRecoveryCase({ _id: 'case_m1', merchant: 'merchant_1', payment: 'payment_m1' }));

  const token1 = tokenFor(authService, { userId: 'user_merchant_1', merchantId: 'merchant_1' });

  await t.test('login issues a session token for correct credentials', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin1@example.com', password: 'correct horse 1' })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.token);
    assert.equal(body.user.merchantId, 'merchant_1');
  });

  await t.test('login rejects an incorrect password', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin1@example.com', password: 'wrong password' })
    });
    assert.equal(response.status, 401);
  });

  await t.test('a request without a token is rejected', async () => {
    const response = await fetch(`${baseUrl}/api/payments`);
    assert.equal(response.status, 401);
  });

  await t.test('merchant can retrieve only their own payments', async () => {
    const response = await fetch(`${baseUrl}/api/payments`, { headers: { authorization: `Bearer ${token1}` } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].id, 'payment_m1');
  });

  await t.test('merchant cannot retrieve another merchant\'s payment by id', async () => {
    const response = await fetch(`${baseUrl}/api/payments/payment_m2`, { headers: { authorization: `Bearer ${token1}` } });
    assert.equal(response.status, 404);
  });

  await t.test('merchant can retrieve their own recovery cases', async () => {
    const response = await fetch(`${baseUrl}/api/recovery-cases`, { headers: { authorization: `Bearer ${token1}` } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].id, 'case_m1');
  });

  await t.test('recovery case detail includes the associated payment', async () => {
    const response = await fetch(`${baseUrl}/api/recovery-cases/case_m1`, { headers: { authorization: `Bearer ${token1}` } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.payment.id, 'payment_m1');
    assert.equal(body.data.payment.amount, 200000);
  });
});

test('recovery case list exposes provider payment evidence for journeys', async (t) => {
  const { server, baseUrl, store, authService } = await startTestServer();
  t.after(() => server.close());

  await seedMerchantWithUser(store, authService, { merchantId: 'merchant_1', email: 'journey1@example.com', password: 'correct horse 1' });
  await seedMerchantWithUser(store, authService, { merchantId: 'merchant_2', email: 'journey2@example.com', password: 'correct horse 2' });

  // Merchant 1: an original failed payment whose journey was recovered through
  // a Razorpay payment link. The provider payment also exists as its own
  // Payment record (as ingested from provider webhooks), so clients can tell
  // it apart from an independent payment only through the relationship:
  // RecoveryAction.execution.providerPaymentId on the case's executed action.
  store.payments.push(buildPayment({ _id: 'payment_original_m1', merchant: 'merchant_1' }));
  store.payments.push(buildPayment({ _id: 'payment_provider_m1', merchant: 'merchant_1', razorpayPaymentId: 'pay_provider_m1', status: 'CAPTURED' }));
  store.recoveryCases.push(buildRecoveryCase({ _id: 'case_recovered_m1', merchant: 'merchant_1', payment: 'payment_original_m1', status: 'RECOVERED', recoveredAmount: 200000 }));
  store.recoveryActions.push({
    _id: 'action_confirmed_m1',
    merchant: 'merchant_1',
    payment: 'payment_original_m1',
    recoveryCase: 'case_recovered_m1',
    type: 'CUSTOMER_REMINDER',
    status: 'EXECUTED',
    execution: { provider: 'RAZORPAY_TEST', providerReference: 'plink_confirmed_m1', result: 'PAYMENT_CONFIRMED', providerPaymentId: 'pay_provider_m1' }
  });

  // A second merchant-1 case whose executed action has no provider payment yet
  // (the link was created but no verified payment_link.paid arrived).
  store.payments.push(buildPayment({ _id: 'payment_open_m1', merchant: 'merchant_1', customer: 'customer_2' }));
  store.recoveryCases.push(buildRecoveryCase({ _id: 'case_open_m1', merchant: 'merchant_1', payment: 'payment_open_m1' }));
  store.recoveryActions.push({
    _id: 'action_unconfirmed_m1',
    merchant: 'merchant_1',
    payment: 'payment_open_m1',
    recoveryCase: 'case_open_m1',
    type: 'CUSTOMER_REMINDER',
    status: 'EXECUTED',
    execution: { provider: 'RAZORPAY_TEST', providerReference: 'plink_unconfirmed_m1', result: 'PAYMENT_LINK_CREATED' }
  });

  // Another merchant's confirmed provider payment must never leak across scope.
  store.recoveryActions.push({
    _id: 'action_other_merchant',
    merchant: 'merchant_2',
    payment: 'payment_other_merchant',
    recoveryCase: 'case_other_merchant',
    type: 'CUSTOMER_REMINDER',
    status: 'EXECUTED',
    execution: { provider: 'RAZORPAY_TEST', providerReference: 'plink_other', result: 'PAYMENT_CONFIRMED', providerPaymentId: 'pay_provider_other' }
  });

  const response = await fetch(`${baseUrl}/api/recovery-cases`, {
    headers: { authorization: `Bearer ${tokenFor(authService, { userId: 'user_merchant_1', merchantId: 'merchant_1' })}` }
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  const byId = new Map(body.data.map((item) => [item.id, item]));

  // The recovered journey exposes exactly its own provider payment evidence.
  assert.deepEqual(byId.get('case_recovered_m1').recoveryProviderPaymentIds, ['pay_provider_m1']);
  // An unconfirmed journey claims no provider payment.
  assert.deepEqual(byId.get('case_open_m1').recoveryProviderPaymentIds, []);
  // No other merchant's provider payment appears anywhere in the response.
  assert.ok(!body.data.some((item) => (item.recoveryProviderPaymentIds || []).includes('pay_provider_other')));
});

test('merchant-scoped analytics excludes another merchant data', async (t) => {
  const { server, baseUrl, store, authService } = await startTestServer();
  t.after(() => server.close());

  await seedMerchantWithUser(store, authService, { merchantId: 'merchant_1', email: 'analytics1@example.com', password: 'correct horse 1' });
  await seedMerchantWithUser(store, authService, { merchantId: 'merchant_2', email: 'analytics2@example.com', password: 'correct horse 2' });
  store.payments.push(buildPayment({ _id: 'analytics_payment_1', merchant: 'merchant_1', amount: 10000 }));
  store.payments.push(buildPayment({ _id: 'analytics_payment_2', merchant: 'merchant_2', amount: 90000 }));
  store.recoveryCases.push(buildRecoveryCase({ _id: 'analytics_case_1', merchant: 'merchant_1', payment: 'analytics_payment_1' }));
  store.recoveryCases.push(buildRecoveryCase({ _id: 'analytics_case_2', merchant: 'merchant_2', payment: 'analytics_payment_2' }));

  const response = await fetch(`${baseUrl}/api/analytics/overview`, {
    headers: { authorization: `Bearer ${tokenFor(authService, { userId: 'user_merchant_1', merchantId: 'merchant_1' })}` }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      revenueAtRisk: 10000,
      eligibleRecoveryCases: 1,
      recoveryAttempts: 0,
      successfulRecoveries: 0,
      recoveredRevenue: 0,
      recoveryRate: 0,
      recoveryValueRate: 0,
      blockedActions: 0,
      failedExecutions: 0,
      aiFallbacks: 0,
      breakdown: {
        recoveryAction: {},
        failureCategory: { TEMPORARY: 1 },
        recoveryStatus: { DETECTED: 1 }
      }
    }
  });
});

test('recovery recommendation generation', async (t) => {
  const { server, baseUrl, store, authService } = await startTestServer();
  t.after(() => server.close());

  await seedMerchantWithUser(store, authService, { merchantId: 'merchant_1', email: 'admin@example.com', password: 'correct horse battery' });
  const token = tokenFor(authService, { userId: 'user_merchant_1', merchantId: 'merchant_1' });

  await t.test('produces a valid recommendation that does not execute a financial action', async () => {
    store.payments.push(buildPayment({ _id: 'payment_recommend_1', merchant: 'merchant_1', amount: 800000 }));
    store.recoveryCases.push(buildRecoveryCase({ _id: 'case_recommend_1', merchant: 'merchant_1', payment: 'payment_recommend_1', retryCount: 0 }));

    const response = await fetch(`${baseUrl}/api/recovery-cases/case_recommend_1/recommendations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 201);
    const body = await response.json();

    assert.equal(body.recommendation.action, 'RETRY_PAYMENT');
    assert.ok(body.recommendation.confidence > 0 && body.recommendation.confidence <= 1);
    assert.equal(body.recoveryAction.status, 'POLICY_ALLOWED');
    // No execution ever occurs: the model has no `execution.result`/`executedAt`
    // populated, and the status is never one of the execution states.
    assert.equal(body.recoveryAction.execution, undefined);
    assert.notEqual(body.recoveryAction.status, 'EXECUTED');
    assert.notEqual(body.recoveryAction.status, 'EXECUTING');
  });

  await t.test('a case at the retry limit gets a safe recommendation, not another retry', async () => {
    store.payments.push(buildPayment({ _id: 'payment_retry_limit', merchant: 'merchant_1' }));
    store.recoveryCases.push(
      buildRecoveryCase({ _id: 'case_retry_limit', merchant: 'merchant_1', payment: 'payment_retry_limit', retryCount: 5 })
    );

    const response = await fetch(`${baseUrl}/api/recovery-cases/case_retry_limit/recommendations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` }
    });
    const body = await response.json();

    assert.notEqual(body.recommendation.action, 'RETRY_PAYMENT');
  });

  await t.test('a policy that disallows the recommended action blocks it, and it is never executable', async () => {
    // A default policy was auto-created for merchant_1 by the first subtest
    // (findOrCreatePolicy). Mutate that same record rather than pushing a
    // second one, since a merchant has exactly one RecoveryPolicy.
    const existingPolicy = store.policies.find((p) => String(p.merchant) === 'merchant_1');
    if (existingPolicy) existingPolicy.allowedActions = ['CUSTOMER_REMINDER', 'ESCALATE_TO_HUMAN', 'NO_ACTION'];
    else {
      store.policies.push(
        buildPolicy({ _id: 'policy_no_retry', merchant: 'merchant_1', allowedActions: ['CUSTOMER_REMINDER', 'ESCALATE_TO_HUMAN', 'NO_ACTION'] })
      );
    }
    store.payments.push(buildPayment({ _id: 'payment_blocked', merchant: 'merchant_1', amount: 800000 }));
    store.recoveryCases.push(buildRecoveryCase({ _id: 'case_blocked', merchant: 'merchant_1', payment: 'payment_blocked', retryCount: 0 }));

    const response = await fetch(`${baseUrl}/api/recovery-cases/case_blocked/recommendations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` }
    });
    const body = await response.json();

    assert.equal(body.recommendation.action, 'RETRY_PAYMENT');
    assert.equal(body.policyDecision.decision, 'BLOCKED');
    assert.equal(body.recoveryAction.status, 'POLICY_BLOCKED');
  });

  await t.test('the audit trail records the recommendation and the policy decision', async () => {
    store.payments.push(buildPayment({ _id: 'payment_audit', merchant: 'merchant_1', amount: 800000 }));
    store.recoveryCases.push(buildRecoveryCase({ _id: 'case_audit', merchant: 'merchant_1', payment: 'payment_audit', retryCount: 0 }));

    await fetch(`${baseUrl}/api/recovery-cases/case_audit/recommendations`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });

    const response = await fetch(`${baseUrl}/api/audit-events?recoveryCase=case_audit`, { headers: { authorization: `Bearer ${token}` } });
    const body = await response.json();
    const types = body.data.map((event) => event.type).sort();
    assert.deepEqual(types, ['ACTION_RECOMMENDED', 'AI_FALLBACK_USED', 'POLICY_EVALUATED']);
  });

  await t.test('re-generating a recommendation for an unchanged case is idempotent', async () => {
    store.payments.push(buildPayment({ _id: 'payment_idem', merchant: 'merchant_1', amount: 800000 }));
    store.recoveryCases.push(buildRecoveryCase({ _id: 'case_idem', merchant: 'merchant_1', payment: 'payment_idem', retryCount: 0 }));

    const first = await fetch(`${baseUrl}/api/recovery-cases/case_idem/recommendations`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    const second = await fetch(`${baseUrl}/api/recovery-cases/case_idem/recommendations`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });

    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    assert.equal(secondBody.duplicate, true);
    assert.equal(firstBody.recoveryAction.id, secondBody.recoveryAction.id);

    const auditResponse = await fetch(`${baseUrl}/api/audit-events?recoveryCase=case_idem`, { headers: { authorization: `Bearer ${token}` } });
    const auditBody = await auditResponse.json();
    assert.equal(auditBody.data.length, 3); // no duplicate audit trail on the repeat call
  });

  await t.test('requesting a recommendation for a nonexistent case returns 404', async () => {
    const response = await fetch(`${baseUrl}/api/recovery-cases/does_not_exist/recommendations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 404);
  });
});
