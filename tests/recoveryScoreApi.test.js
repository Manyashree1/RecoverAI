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
const Customer = require('../src/models/Customer');
const { createRecoveryScoreController } = require('../src/controllers/recoveryScoreController');
const AuditEvent = require('../src/models/AuditEvent');
const RecoveryAction = require('../src/models/RecoveryAction');

let merchantId;
let otherMerchantId;

function createTestScoreController() {
  return createRecoveryScoreController({});
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

  const authService = new AuthService();
  const merchant = await Merchant.create({ name: 'Score Test Merchant', status: 'ACTIVE' });
  merchantId = String(merchant._id);
  const otherMerchant = await Merchant.create({ name: 'Other Merchant', status: 'ACTIVE' });
  otherMerchantId = String(otherMerchant._id);

  const passwordHash = await authService.hashPassword('password123');
  await MerchantUser.create({ merchant: merchant._id, email: 'score@test.com', passwordHash, role: 'MERCHANT_ADMIN', status: 'ACTIVE' });
  await MerchantUser.create({ merchant: otherMerchant._id, email: 'other-score@test.com', passwordHash, role: 'MERCHANT_ADMIN', status: 'ACTIVE' });
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

test('Recovery Score: returns score for open case', async () => {
  const customer = await Customer.create({ merchant: merchantId, email: 'score-customer@test.com', name: 'Score Customer', externalCustomerId: 'score-cust-1' });
  const policy = await RecoveryPolicy.create({ merchant: merchantId, maxAutomaticRetries: 3, maxCustomerContactAttempts: 2, allowedActions: ['CUSTOMER_REMINDER', 'RETRY_PAYMENT'] });
  const payment = await Payment.create({ merchant: merchantId, customer: customer._id, amount: 5000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
  const recoveryCase = await RecoveryCase.create({ merchant: merchantId, payment: payment._id, status: 'DETECTED', retryCount: 0, customerContactAttempts: 0, diagnosis: { category: 'TEMPORARY', explanation: 'Insufficient funds', confidence: 0.9 } });

  const controller = createTestScoreController();
  const { res, getData, getStatus } = mockRes();
  const req = { auth: { merchantId }, params: { id: String(recoveryCase._id) }, get: () => undefined };

  await controller.getScore(req, res, () => {});

  assert.equal(getStatus(), 200);
  const data = getData().data;
  assert.ok(data.score >= 0 && data.score <= 100);
  assert.ok(['HIGH_RECOVERY_POTENTIAL', 'MEDIUM_RECOVERY_POTENTIAL', 'LOW_RECOVERY_POTENTIAL', 'NOT_ELIGIBLE'].includes(data.classification));
  assert.ok(data.confidence >= 0 && data.confidence <= 1);
});

test('Recovery Score: returns 404 for missing case', async () => {
  const controller = createTestScoreController();
  const errors = [];
  const { res } = mockRes();
  const req = { auth: { merchantId }, params: { id: new mongoose.Types.ObjectId().toHexString() }, get: () => undefined };

  await controller.getScore(req, res, (err) => { errors.push(err); });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].statusCode, 404);
});

test('Recovery Score: cannot score another merchant case', async () => {
  const customer = await Customer.create({ merchant: otherMerchantId, email: 'other-customer@test.com', name: 'Other Customer', externalCustomerId: 'other-cust-1' });
  const payment = await Payment.create({ merchant: otherMerchantId, customer: customer._id, amount: 5000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
  const recoveryCase = await RecoveryCase.create({ merchant: otherMerchantId, payment: payment._id, status: 'DETECTED', retryCount: 0, customerContactAttempts: 0 });

  const controller = createTestScoreController();
  const errors = [];
  const { res } = mockRes();
  const req = { auth: { merchantId }, params: { id: String(recoveryCase._id) }, get: () => undefined };

  await controller.getScore(req, res, (err) => { errors.push(err); });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].statusCode, 404);
});

test('Recovery Score: terminal case returns NOT_ELIGIBLE', async () => {
  const customer = await Customer.create({ merchant: merchantId, email: 'terminal-customer@test.com', name: 'Terminal Customer', externalCustomerId: 'terminal-cust-1' });
  const payment = await Payment.create({ merchant: merchantId, customer: customer._id, amount: 5000, currency: 'INR', status: 'FAILED', failure: { code: 'insufficient_funds' } });
  const recoveryCase = await RecoveryCase.create({ merchant: merchantId, payment: payment._id, status: 'RECOVERED', retryCount: 0, customerContactAttempts: 0 });

  const controller = createTestScoreController();
  const { res, getData, getStatus } = mockRes();
  const req = { auth: { merchantId }, params: { id: String(recoveryCase._id) }, get: () => undefined };

  await controller.getScore(req, res, () => {});

  assert.equal(getStatus(), 200);
  assert.equal(getData().data.classification, 'NOT_ELIGIBLE');
  assert.equal(getData().data.score, 0);
});
