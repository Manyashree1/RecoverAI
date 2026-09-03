const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { AuthService } = require('../src/services/authService');
const { createAuthMiddleware } = require('../src/middleware/authMiddleware');
const { createAuthController } = require('../src/controllers/authController');
const { createAuthRouter } = require('../src/routes/authRoutes');
const { createStore, InMemoryReadRepository } = require('./helpers/inMemoryAppRepositories');

function createInMemoryWebhookRepository() {
  const state = { webhookEvents: [] };
  return {
    async listRecentEvents(merchantId) {
      return state.webhookEvents
        .filter((event) => String(event.merchant) === String(merchantId))
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .slice(0, 20);
    },
    async createWebhookEvent(data) {
      const event = { _id: `webhook_${state.webhookEvents.length + 1}`, ...data };
      state.webhookEvents.push(event);
      return event;
    }
  };
}

async function startTestServer() {
  const store = createStore();
  const authService = new AuthService({ jwtSecret: 'test_jwt_secret', jwtExpiresIn: '1h' });
  const readRepository = new InMemoryReadRepository(store);
  const requireAuth = createAuthMiddleware({ authService, repository: readRepository });
  const webhookRepository = createInMemoryWebhookRepository();
  const { createRazorpayWebhookRouter } = require('../src/routes/razorpayWebhookRoutes');

  const app = createApp({
    authRouter: createAuthRouter({ controller: createAuthController({ authService, repository: readRepository }) }),
    razorpayWebhookRouter: createRazorpayWebhookRouter({ repository: webhookRepository, requireAuth })
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return { server, baseUrl, authService, webhookRepository, store };
}

async function seedMerchantWithUser(store, authService, { merchantId, email, password }) {
  const passwordHash = await authService.hashPassword(password);
  store.merchantUsers.push({ _id: `user_${merchantId}`, merchant: merchantId, email, passwordHash, role: 'MERCHANT_ADMIN', status: 'ACTIVE' });
}

function tokenFor(authService, { userId, merchantId, role = 'MERCHANT_ADMIN' }) {
  return authService.signSessionToken({ userId, merchantId, role });
}

test('webhook events endpoint rejects unauthenticated requests', async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/api/webhooks/razorpay/events`);
  assert.equal(response.status, 401);
});

test('webhook events endpoint returns only events for the authenticated merchant', async (t) => {
  const { server, baseUrl, authService, webhookRepository, store } = await startTestServer();
  t.after(() => server.close());

  await seedMerchantWithUser(store, authService, { merchantId: 'merchant_1', email: 'm1@example.com', password: 'password 1' });
  await seedMerchantWithUser(store, authService, { merchantId: 'merchant_2', email: 'm2@example.com', password: 'password 2' });

  await webhookRepository.createWebhookEvent({ provider: 'RAZORPAY', providerEventId: 'evt_m1_1', providerEventType: 'payment.failed', merchant: 'merchant_1', status: 'RECEIVED', createdAt: new Date() });
  await webhookRepository.createWebhookEvent({ provider: 'RAZORPAY', providerEventId: 'evt_m2_1', providerEventType: 'payment.failed', merchant: 'merchant_2', status: 'RECEIVED', createdAt: new Date() });

  const token1 = tokenFor(authService, { userId: 'user_merchant_1', merchantId: 'merchant_1' });
  const token2 = tokenFor(authService, { userId: 'user_merchant_2', merchantId: 'merchant_2' });

  const response1 = await fetch(`${baseUrl}/api/webhooks/razorpay/events`, {
    headers: { authorization: `Bearer ${token1}` }
  });
  assert.equal(response1.status, 200);
  const body1 = await response1.json();
  assert.equal(body1.data.length, 1);
  assert.equal(body1.data[0].merchant, 'merchant_1');

  const response2 = await fetch(`${baseUrl}/api/webhooks/razorpay/events`, {
    headers: { authorization: `Bearer ${token2}` }
  });
  assert.equal(response2.status, 200);
  const body2 = await response2.json();
  assert.equal(body2.data.length, 1);
  assert.equal(body2.data[0].merchant, 'merchant_2');
});
