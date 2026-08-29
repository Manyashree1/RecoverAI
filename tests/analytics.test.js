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
  const capture = { responseData: undefined, responseStatus: undefined };
  const res = {
    status: (code) => ({ json: (data) => { capture.responseData = data; capture.responseStatus = code } }),
    json: (data) => { capture.responseData = data; capture.responseStatus = 200 }
  };
  return { res, getData: () => capture.responseData, getStatus: () => capture.responseStatus };
}

test.before(async () => {
  await connectDatabase();
  await Merchant.deleteMany({});
  await MerchantUser.deleteMany({});
  await mongoose.connection.db.collection('customers').deleteMany({});
  await mongoose.connection.db.collection('payments').deleteMany({});
  await mongoose.connection.db.collection('recoverycases').deleteMany({});
  await mongoose.connection.db.collection('recoveryactions').deleteMany({});
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
  await mongoose.connection.db.collection('auditevents').deleteMany({});
  await mongoose.connection.db.collection('recoverypolicies').deleteMany({ merchant: merchantId });
  await mongoose.connection.db.collection('recoveryactions').deleteMany({ merchant: merchantId });
  await mongoose.connection.db.collection('payments').deleteMany({ merchant: merchantId });
  await mongoose.connection.db.collection('recoverycases').deleteMany({ merchant: merchantId });
  await mongoose.connection.db.collection('customers').deleteMany({ merchant: merchantId });
});

test.after(async () => {
  await mongoose.disconnect();
});

test('Analytics: outcomes returns action effectiveness metrics', async () => {
  const customer = await Customer.create({ merchant: merchantId, email: 'outcome-customer@test.com', name: 'Outcome Customer', externalCustomerId: 'outcome-cust-1' });
  const policy = await RecoveryPolicy.findOneAndUpdate({ merchant: merchantId }, { allowedActions: ['CUSTOMER_REMINDER', 'RETRY_PAYMENT'] }, { new: true, upsert: true });
  const payment = await Payment.create({ merchant: merchantId, customer: customer._id, amount: 5000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
  const recoveryCase = await RecoveryCase.create({ merchant: merchantId, payment: payment._id, status: 'RECOVERED', recoveredAmount: 5000, resolvedAt: new Date() });

  await RecoveryAction.create({
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
    recoveryAction: recoveryCase.recoveryActions?.[0]?._id || new mongoose.Types.ObjectId(),
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

  await RecoveryAction.create({
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
    recoveryAction: recoveryCase.recoveryActions?.[0]?._id || new mongoose.Types.ObjectId(),
    type: 'RECOVERY_COMPLETED',
    actor: 'RAZORPAY',
    providerEventId: 'perf-event-1'
  });

  const controller = createTestController();
  const { res, getData, getStatus } = mockRes();
  const req = { auth: { merchantId }, get: () => undefined };

  await controller.performance(req, res, () => {});

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
