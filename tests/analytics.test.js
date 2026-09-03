const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connectDatabase } = require('../src/config/database');
const { AuthService } = require('../src/services/authService');
const Merchant = require('../src/models/Merchant');
const MerchantUser = require('../src/models/MerchantUser');
const { RecoveryPolicy } = require('../src/models/RecoveryPolicy');
const Payment = require('../src/models/Payment');
const RecoveryCase = require('../src/models/RecoveryCase');
const RecoveryAction = require('../src/models/RecoveryAction');
const AuditEvent = require('../src/models/AuditEvent');
const Customer = require('../src/models/Customer');
const { createAnalyticsController } = require('../src/controllers/analyticsController');

let merchantId;
let otherMerchantId;

function createTestController() {
  return createAnalyticsController({});
}

function mockRes() {
  const capture = { responseData: undefined, responseStatus: undefined, errors: [] };
  const res = {
    status: (code) => ({ json: (data) => { capture.responseData = data; capture.responseStatus = code } }),
    json: (data) => { capture.responseData = data; capture.responseStatus = 200 }
  };
  return { res, getData: () => capture.responseData, getStatus: () => capture.responseStatus, errors: () => capture.errors };
}

test.before(async () => {
  await connectDatabase();
  await Merchant.deleteMany({});
  await MerchantUser.deleteMany({});
  await mongoose.connection.db.collection('customers').deleteMany({});
  await mongoose.connection.db.collection('payments').deleteMany({});
  await mongoose.connection.db.collection('recoverycases').deleteMany({});
  await mongoose.connection.db.collection('recoveryactions').deleteMany({});
  await mongoose.connection.db.collection('recoverypolicies').deleteMany({});
  await mongoose.connection.db.collection('auditevents').deleteMany({});

  const authService = new AuthService();
  const merchant = await Merchant.create({ name: 'Analytics Test Merchant', status: 'ACTIVE' });
  merchantId = String(merchant._id);
  const otherMerchant = await Merchant.create({ name: 'Other Merchant', status: 'ACTIVE' });
  otherMerchantId = String(otherMerchant._id);

  const passwordHash = await authService.hashPassword('password123');
  await MerchantUser.create({ merchant: merchant._id, email: 'analytics@test.com', passwordHash, role: 'MERCHANT_ADMIN', status: 'ACTIVE' });
  await MerchantUser.create({ merchant: otherMerchant._id, email: 'other-analytics@test.com', passwordHash, role: 'MERCHANT_ADMIN', status: 'ACTIVE' });
});

test.beforeEach(async () => {
  await mongoose.connection.db.collection('auditevents').deleteMany({ merchant: new mongoose.Types.ObjectId(merchantId) });
  await mongoose.connection.db.collection('recoverypolicies').deleteMany({ merchant: new mongoose.Types.ObjectId(merchantId) });
  await mongoose.connection.db.collection('recoveryactions').deleteMany({ merchant: new mongoose.Types.ObjectId(merchantId) });
  await mongoose.connection.db.collection('payments').deleteMany({ merchant: new mongoose.Types.ObjectId(merchantId) });
  await mongoose.connection.db.collection('recoverycases').deleteMany({ merchant: new mongoose.Types.ObjectId(merchantId) });
  await mongoose.connection.db.collection('customers').deleteMany({ merchant: new mongoose.Types.ObjectId(merchantId) });
});

test.after(async () => {
  await mongoose.disconnect();
});

test('Analytics: outcomes returns action effectiveness metrics', async () => {
  const customer = await Customer.create({ merchant: merchantId, email: 'outcome-customer@test.com', name: 'Outcome Customer', externalCustomerId: 'outcome-cust-1' });
  const policy = await RecoveryPolicy.findOneAndUpdate({ merchant: merchantId }, { allowedActions: ['CUSTOMER_REMINDER', 'RETRY_PAYMENT'] }, { new: true, upsert: true });
  const payment = await Payment.create({ merchant: merchantId, customer: customer._id, amount: 5000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
  const recoveryCase = await RecoveryCase.create({ merchant: merchantId, payment: payment._id, status: 'RECOVERED', recoveredAmount: 5000, resolvedAt: new Date() });

  const action = await RecoveryAction.create({
    merchant: merchantId,
    payment: payment._id,
    recoveryCase: recoveryCase._id,
    type: 'CUSTOMER_REMINDER',
    status: 'EXECUTED',
    recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Test' },
    policyDecision: { decision: 'ALLOWED', reason: 'Test' },
    execution: { providerReference: 'ref-1', executedAt: new Date() },
    idempotencyKey: 'outcome-1'
  });

  await AuditEvent.create({
    merchant: merchantId,
    recoveryCase: recoveryCase._id,
    recoveryAction: action._id,
    type: 'RECOVERY_COMPLETED',
    actor: 'RAZORPAY',
    providerEventId: 'outcome-event-1'
  });

  const controller = createTestController();
  const { res, getData, getStatus } = mockRes();
  const req = { auth: { merchantId }, get: () => undefined };

  await controller.outcomes(req, res, () => {});

  assert.equal(getStatus(), 200);
  const data = getData().data;
  assert.ok(data.outcomes);
  assert.ok(data.outcomes.CUSTOMER_REMINDER);
  assert.equal(data.outcomes.CUSTOMER_REMINDER.recovered, 1);
});

test('Analytics: performance returns time-series and summary', async () => {
  const customer = await Customer.create({ merchant: merchantId, email: 'perf-customer@test.com', name: 'Perf Customer', externalCustomerId: 'perf-cust-1' });
  const policy = await RecoveryPolicy.findOneAndUpdate({ merchant: merchantId }, { allowedActions: ['CUSTOMER_REMINDER'] }, { new: true, upsert: true });
  const payment = await Payment.create({ merchant: merchantId, customer: customer._id, amount: 3000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
  const recoveryCase = await RecoveryCase.create({ merchant: merchantId, payment: payment._id, status: 'RECOVERED', recoveredAmount: 3000, resolvedAt: new Date() });

  const action = await RecoveryAction.create({
    merchant: merchantId,
    payment: payment._id,
    recoveryCase: recoveryCase._id,
    type: 'CUSTOMER_REMINDER',
    status: 'EXECUTED',
    recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Test' },
    policyDecision: { decision: 'ALLOWED', reason: 'Test' },
    execution: { providerReference: 'ref-perf', executedAt: new Date() },
    idempotencyKey: 'perf-1'
  });

  await AuditEvent.create({
    merchant: merchantId,
    recoveryCase: recoveryCase._id,
    recoveryAction: action._id,
    type: 'RECOVERY_COMPLETED',
    actor: 'RAZORPAY',
    providerEventId: 'perf-event-1'
  });

  const controller = createTestController();
  const { res, getData, getStatus } = mockRes();
  const next = (error) => { if (error) throw error; };

  await controller.performance({ auth: { merchantId }, get: () => undefined }, res, next);

  assert.equal(getStatus(), 200);
  const data = getData().data;
  assert.ok(data.summary);
  assert.ok(Array.isArray(data.series));
  assert.equal(data.summary.totalRecovered, 1);
});

test('Analytics: outcomes is merchant isolated', async () => {
  const controller = createTestController();
  const { res, getData, getStatus } = mockRes();
  const req = { auth: { merchantId }, get: () => undefined };

  await controller.outcomes(req, res, () => {});

  assert.equal(getStatus(), 200);
  assert.equal(getData().data.outcomes.CUSTOMER_REMINDER.recovered, 0);
});

test('Analytics: performance is merchant isolated', async () => {
  const controller = createTestController();
  const { res, getData, getStatus } = mockRes();
  const req = { auth: { merchantId }, get: () => undefined };

  await controller.performance(req, res, () => {});

  assert.equal(getStatus(), 200);
  assert.equal(getData().data.summary.totalRecovered, 0);
});

test('Analytics invariant: no recovered cases produces zero recovered revenue and zero recovery rate', async () => {
  const customer = await Customer.create({ merchant: merchantId, email: 'invariant-customer@test.com', name: 'Invariant Customer', externalCustomerId: 'invariant-cust-1' });
  const policy = await RecoveryPolicy.findOneAndUpdate({ merchant: merchantId }, { allowedActions: ['CUSTOMER_REMINDER'] }, { new: true, upsert: true });
  const payment = await Payment.create({ merchant: merchantId, customer: customer._id, amount: 5000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
  await RecoveryCase.create({ merchant: merchantId, payment: payment._id, status: 'DETECTED', retryCount: 0, customerContactAttempts: 0 });

  const controller = createTestController();
  const { res, getData, getStatus } = mockRes();
  const next = (error) => { if (error) throw error; };

  await controller.overview({ auth: { merchantId }, get: () => undefined }, res, next);
  assert.equal(getStatus(), 200);
  const overview = getData().data;

  assert.equal(overview.recoveredRevenue, 0);
  assert.equal(overview.recoveryRate, 0);
  assert.equal(overview.recoveryValueRate, 0);
  assert.equal(overview.successfulRecoveries, 0);
});

test('Analytics invariant: recovery rate uses total recovery opportunities, not just currently open cases', async () => {
  const customer = await Customer.create({ merchant: merchantId, email: 'rate-customer@test.com', name: 'Rate Customer', externalCustomerId: 'rate-cust-1' });
  const policy = await RecoveryPolicy.findOneAndUpdate({ merchant: merchantId }, { allowedActions: ['CUSTOMER_REMINDER'] }, { new: true, upsert: true });
  const payment1 = await Payment.create({ merchant: merchantId, customer: customer._id, amount: 5000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
  const payment2 = await Payment.create({ merchant: merchantId, customer: customer._id, amount: 3000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
  const case1 = await RecoveryCase.create({ merchant: merchantId, payment: payment1._id, status: 'RECOVERED', recoveredAmount: 5000, resolvedAt: new Date() });
  const case2 = await RecoveryCase.create({ merchant: merchantId, payment: payment2._id, status: 'DETECTED', retryCount: 0, customerContactAttempts: 0 });

  const rateAction = await RecoveryAction.create({ merchant: merchantId, payment: payment1._id, recoveryCase: case1._id, type: 'CUSTOMER_REMINDER', status: 'EXECUTED', recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Test' }, policyDecision: { decision: 'ALLOWED', reason: 'Test' }, execution: { providerReference: 'ref-rate-1', executedAt: new Date() }, idempotencyKey: 'rate-1' });
  await AuditEvent.create({ merchant: merchantId, recoveryCase: case1._id, recoveryAction: rateAction._id, type: 'RECOVERY_COMPLETED', actor: 'RAZORPAY', providerEventId: 'rate-event-1' });

  const controller = createTestController();
  const { res, getData, getStatus } = mockRes();
  const next = (error) => { if (error) throw error; };

  await controller.overview({ auth: { merchantId }, get: () => undefined }, res, next);
  assert.equal(getStatus(), 200);
  const overview = getData().data;

  assert.equal(overview.recoveryOpportunities, 2);
  assert.equal(overview.successfulRecoveries, 1);
  assert.equal(overview.recoveryRate, 0.5);
  assert.ok(overview.recoveryRate <= 1);
});

test('Analytics: action-level recovery attribution links to the specific action that produced provider-confirmed recovery', async () => {
  const customer = await Customer.create({ merchant: merchantId, email: 'attribution-customer@test.com', name: 'Attribution Customer', externalCustomerId: 'attribution-cust-1' });
  const policy = await RecoveryPolicy.findOneAndUpdate({ merchant: merchantId }, { allowedActions: ['CUSTOMER_REMINDER', 'RETRY_PAYMENT'] }, { new: true, upsert: true });
  const payment = await Payment.create({ merchant: merchantId, customer: customer._id, amount: 10000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
  const recoveryCase = await RecoveryCase.create({ merchant: merchantId, payment: payment._id, status: 'RECOVERED', recoveredAmount: 10000, resolvedAt: new Date() });

  const blockedRetry = await RecoveryAction.create({
    merchant: merchantId,
    payment: payment._id,
    recoveryCase: recoveryCase._id,
    type: 'RETRY_PAYMENT',
    status: 'POLICY_BLOCKED',
    recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Blocked retry.' },
    policyDecision: { decision: 'BLOCKED', reason: 'Test block.' },
    idempotencyKey: 'attribution-blocked'
  });

  const executedReminder = await RecoveryAction.create({
    merchant: merchantId,
    payment: payment._id,
    recoveryCase: recoveryCase._id,
    type: 'CUSTOMER_REMINDER',
    status: 'EXECUTED',
    recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Executed reminder.' },
    policyDecision: { decision: 'ALLOWED', reason: 'Test allow.' },
    execution: { providerReference: 'ref-attribution', executedAt: new Date() },
    idempotencyKey: 'attribution-executed'
  });

  await AuditEvent.create({ merchant: merchantId, recoveryCase: recoveryCase._id, recoveryAction: executedReminder._id, type: 'RECOVERY_COMPLETED', actor: 'RAZORPAY', providerEventId: 'attribution-event-1' });

  const controller = createTestController();
  const { res, getData, getStatus } = mockRes();
  const next = (error) => { if (error) throw error; };

  await controller.outcomes({ auth: { merchantId }, get: () => undefined }, res, next);
  assert.equal(getStatus(), 200);
  const data = getData().data;

  assert.equal(data.outcomes.RETRY_PAYMENT.recovered, 0, 'Blocked RETRY_PAYMENT must not be counted as recovered');
  assert.equal(data.outcomes.RETRY_PAYMENT.averageRecoveredAmount, 0);
  assert.equal(data.outcomes.CUSTOMER_REMINDER.recovered, 1, 'Executed CUSTOMER_REMINDER with provider evidence must be counted as recovered');
  assert.equal(data.outcomes.CUSTOMER_REMINDER.averageRecoveredAmount, 10000);
});
test('Analytics invariant: recovered amount equals provider-confirmed amount, not action count', async () => {
  const customer = await Customer.create({ merchant: merchantId, email: 'avg-customer@test.com', name: 'Avg Customer', externalCustomerId: 'avg-cust-1' });
  const policy = await RecoveryPolicy.findOneAndUpdate({ merchant: merchantId }, { allowedActions: ['CUSTOMER_REMINDER', 'RETRY_PAYMENT'] }, { new: true, upsert: true });
  const payment1 = await Payment.create({ merchant: merchantId, customer: customer._id, amount: 10000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
  const payment2 = await Payment.create({ merchant: merchantId, customer: customer._id, amount: 5000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
  const recoveredCase = await RecoveryCase.create({ merchant: merchantId, payment: payment1._id, status: 'RECOVERED', recoveredAmount: 10000, resolvedAt: new Date() });
  const unrecoveredCase = await RecoveryCase.create({ merchant: merchantId, payment: payment2._id, status: 'DETECTED', retryCount: 0, customerContactAttempts: 0 });

  const reminderAction = await RecoveryAction.create({ merchant: merchantId, payment: payment1._id, recoveryCase: recoveredCase._id, type: 'CUSTOMER_REMINDER', status: 'EXECUTED', recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Test' }, policyDecision: { decision: 'ALLOWED', reason: 'Test' }, execution: { providerReference: 'ref-avg-1', executedAt: new Date() }, idempotencyKey: 'avg-1' });
  await RecoveryAction.create({ merchant: merchantId, payment: payment2._id, recoveryCase: unrecoveredCase._id, type: 'RETRY_PAYMENT', status: 'POLICY_ALLOWED', recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Test' }, policyDecision: { decision: 'ALLOWED', reason: 'Test' }, idempotencyKey: 'avg-2' });
  await AuditEvent.create({ merchant: merchantId, recoveryCase: recoveredCase._id, recoveryAction: reminderAction._id, type: 'RECOVERY_COMPLETED', actor: 'RAZORPAY', providerEventId: 'avg-event-1' });

  const controller = createTestController();
  const { res, getData, getStatus } = mockRes();
  const next = (error) => { if (error) throw error; };

  await controller.outcomes({ auth: { merchantId }, get: () => undefined }, res, next);
  assert.equal(getStatus(), 200);
  const data = getData().data;

  assert.equal(data.outcomes.CUSTOMER_REMINDER.recovered, 1);
  assert.equal(data.outcomes.CUSTOMER_REMINDER.averageRecoveredAmount, 10000);
  assert.equal(data.outcomes.RETRY_PAYMENT.recovered, 0);
  assert.equal(data.outcomes.RETRY_PAYMENT.averageRecoveredAmount, 0);
});

test('Analytics invariant: provider-confirmed recovery counted exactly once', async () => {
  const customer = await Customer.create({ merchant: merchantId, email: 'idempotent-customer@test.com', name: 'Idempotent Customer', externalCustomerId: 'idempotent-cust-1' });
  const policy = await RecoveryPolicy.findOneAndUpdate({ merchant: merchantId }, { allowedActions: ['CUSTOMER_REMINDER'] }, { new: true, upsert: true });
  const payment = await Payment.create({ merchant: merchantId, customer: customer._id, amount: 5000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
  const recoveryCase = await RecoveryCase.create({ merchant: merchantId, payment: payment._id, status: 'RECOVERED', recoveredAmount: 5000, resolvedAt: new Date() });

  const action = await RecoveryAction.create({ merchant: merchantId, payment: payment._id, recoveryCase: recoveryCase._id, type: 'CUSTOMER_REMINDER', status: 'EXECUTED', recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Test' }, policyDecision: { decision: 'ALLOWED', reason: 'Test' }, execution: { providerReference: 'ref-idem-1', executedAt: new Date() }, idempotencyKey: 'idem-1' });

  await AuditEvent.create({ merchant: merchantId, recoveryCase: recoveryCase._id, recoveryAction: action._id, type: 'RECOVERY_COMPLETED', actor: 'RAZORPAY', providerEventId: 'idem-event-1' });
  try {
    await AuditEvent.create({ merchant: merchantId, recoveryCase: recoveryCase._id, recoveryAction: action._id, type: 'RECOVERY_COMPLETED', actor: 'RAZORPAY', providerEventId: 'idem-event-1' });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }

  const controller = createTestController();
  const { res, getData, getStatus } = mockRes();
  const next = (error) => { if (error) throw error; };

  await controller.overview({ auth: { merchantId }, get: () => undefined }, res, next);
  assert.equal(getStatus(), 200);
  const overview = getData().data;

  assert.equal(overview.successfulRecoveries, 1);
  assert.equal(overview.recoveredRevenue, 5000);
});
