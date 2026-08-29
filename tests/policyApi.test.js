const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connectDatabase } = require('../src/config/database');
const { AuthService } = require('../src/services/authService');
const Merchant = require('../src/models/Merchant');
const MerchantUser = require('../src/models/MerchantUser');
const { RecoveryPolicy } = require('../src/models/RecoveryPolicy');
const { MongoTransactionRunner } = require('../src/services/mongoTransactionRunner');
const { createPolicyController } = require('../src/controllers/policyController');
const AuditEvent = require('../src/models/AuditEvent');
const RecoveryAction = require('../src/models/RecoveryAction');

let merchantId;
let otherMerchantId;

test.before(async () => {
  await connectDatabase();
  await Merchant.deleteMany({});
  await MerchantUser.deleteMany({});
  await mongoose.connection.db.collection('recoverypolicies').deleteMany({});
  await mongoose.connection.db.collection('recoveryactions').deleteMany({});
  await mongoose.connection.db.collection('auditevents').deleteMany({});

  const authService = new AuthService();

  const merchant = await Merchant.create({ name: 'Policy Test Merchant', status: 'ACTIVE' });
  merchantId = String(merchant._id);

  const otherMerchant = await Merchant.create({ name: 'Other Merchant', status: 'ACTIVE' });
  otherMerchantId = String(otherMerchant._id);

  const passwordHash = await authService.hashPassword('password123');
  await MerchantUser.create({
    merchant: merchant._id,
    email: 'policy@test.com',
    passwordHash,
    role: 'MERCHANT_ADMIN',
    status: 'ACTIVE'
  });
  await MerchantUser.create({
    merchant: otherMerchant._id,
    email: 'other@test.com',
    passwordHash,
    role: 'MERCHANT_ADMIN',
    status: 'ACTIVE'
  });
});

test.beforeEach(async () => {
  await mongoose.connection.db.collection('auditevents').deleteMany({});
  await mongoose.connection.db.collection('recoverypolicies').deleteMany({ merchant: merchantId });
  await mongoose.connection.db.collection('recoveryactions').deleteMany({ merchant: merchantId });
});

test.after(async () => {
  await mongoose.disconnect();
});

async function seedPolicy(overrides = {}) {
  await RecoveryPolicy.deleteMany({ merchant: merchantId });
  return RecoveryPolicy.create({
    merchant: merchantId,
    maxAutomaticRetries: 2,
    maxCustomerContactAttempts: 1,
    cooldownMinutes: 60,
    escalationCooldownMinutes: 1440,
    allowedActions: ['CUSTOMER_REMINDER'],
    version: 0,
    ...overrides
  });
}

function createTestTransactionRunner() {
  return {
    async run(work) {
      return work(null);
    }
  };
}

function createTestPolicyController() {
  return createPolicyController({ transactionRunner: createTestTransactionRunner() });
}

function mockRes() {
  const capture = { responseData: undefined, responseStatus: undefined };
  const res = {
    status: (code) => ({ json: (data) => { capture.responseData = data; capture.responseStatus = code } }),
    json: (data) => { capture.responseData = data; capture.responseStatus = 200 }
  };
  return {
    res,
    getData: () => capture.responseData,
    getStatus: () => capture.responseStatus
  };
}

test('Policy API: GET returns existing policy for merchant', async () => {
  await seedPolicy({ maxAutomaticRetries: 3, maxCustomerContactAttempts: 2, cooldownMinutes: 120, escalationCooldownMinutes: 2880, allowedActions: ['CUSTOMER_REMINDER', 'RETRY_PAYMENT'], version: 5 });

  const controller = createTestPolicyController();
  const { res, getData, getStatus } = mockRes();
  const req = { auth: { merchantId }, params: {}, query: {}, body: {}, get: () => undefined };

  await controller.get(req, res, () => {});

  assert.equal(getStatus(), 200);
  assert.equal(getData().data.maxAutomaticRetries, 3);
  assert.equal(getData().data.maxCustomerContactAttempts, 2);
  assert.equal(getData().data.cooldownMinutes, 120);
  assert.equal(getData().data.escalationCooldownMinutes, 2880);
  assert.deepEqual(getData().data.allowedActions, ['CUSTOMER_REMINDER', 'RETRY_PAYMENT']);
  assert.equal(getData().data.version, 5);
});

test('Policy API: GET creates default policy if none exists', async () => {
  await RecoveryPolicy.deleteMany({ merchant: merchantId });

  const controller = createTestPolicyController();
  const { res, getData, getStatus } = mockRes();
  const req = { auth: { merchantId }, params: {}, query: {}, body: {}, get: () => undefined };

  await controller.get(req, res, () => {});

  assert.equal(getStatus(), 200);
  assert.equal(getData().data.maxAutomaticRetries, 2);
  assert.equal(getData().data.maxCustomerContactAttempts, 1);
  assert.equal(getData().data.cooldownMinutes, 60);
  assert.equal(getData().data.escalationCooldownMinutes, 1440);
  assert.ok(getData().data.allowedActions.includes('CUSTOMER_REMINDER'));
  assert.equal(getData().data.version, 0);
});

test('Policy API: PUT updates policy and creates audit event', async () => {
  await seedPolicy();

  const controller = createTestPolicyController();
  const { res, getData, getStatus } = mockRes();
  const req = {
    auth: { merchantId },
    params: {},
    query: {},
    body: {
      maxAutomaticRetries: 4,
      maxCustomerContactAttempts: 3,
      cooldownMinutes: 90,
      escalationCooldownMinutes: 2880,
      allowedActions: ['CUSTOMER_REMINDER', 'RETRY_PAYMENT'],
      expectedVersion: 0
    },
    get: () => undefined
  };

  await controller.update(req, res, () => {});

  assert.equal(getStatus(), 200);
  assert.equal(getData().data.maxAutomaticRetries, 4);
  assert.equal(getData().data.maxCustomerContactAttempts, 3);
  assert.equal(getData().data.cooldownMinutes, 90);
  assert.equal(getData().data.escalationCooldownMinutes, 2880);
  assert.deepEqual(getData().data.allowedActions, ['CUSTOMER_REMINDER', 'RETRY_PAYMENT']);
  assert.equal(getData().data.version, 1);

  const auditEvents = await AuditEvent.find({ merchant: merchantId, type: 'POLICY_UPDATED' }).lean();
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].actor, 'MERCHANT_ADMIN');
  assert.equal(auditEvents[0].metadata.previous.maxAutomaticRetries, 2);
  assert.equal(auditEvents[0].metadata.current.maxAutomaticRetries, 4);
  assert.ok(auditEvents[0].metadata.changedFields.includes('maxAutomaticRetries'));
});

test('Policy API: PUT rejects invalid action values', async () => {
  await seedPolicy();

  const controller = createTestPolicyController();
  let error;
  const req = { auth: { merchantId }, params: {}, query: {}, body: { allowedActions: ['INVALID_ACTION'] }, get: () => undefined };

  await controller.update(req, { status: () => ({ json: () => {} }), json: () => {} }, (err) => { error = err; });

  assert.ok(error);
  assert.equal(error.statusCode, 400);
  assert.ok(error.details.some((d) => d.includes('unsupported values')));
});

test('Policy API: PUT rejects negative values', async () => {
  await seedPolicy();

  const controller = createTestPolicyController();
  let error;
  const req = { auth: { merchantId }, params: {}, query: {}, body: { maxAutomaticRetries: -1 }, get: () => undefined };

  await controller.update(req, { status: () => ({ json: () => {} }), json: () => {} }, (err) => { error = err; });

  assert.ok(error);
  assert.equal(error.statusCode, 400);
  assert.ok(error.details.some((d) => d.includes('maxAutomaticRetries')));
});

test('Policy API: PUT rejects duplicate actions', async () => {
  await seedPolicy();

  const controller = createTestPolicyController();
  let error;
  const req = { auth: { merchantId }, params: {}, query: {}, body: { allowedActions: ['CUSTOMER_REMINDER', 'CUSTOMER_REMINDER'] }, get: () => undefined };

  await controller.update(req, { status: () => ({ json: () => {} }), json: () => {} }, (err) => { error = err; });

  assert.ok(error);
  assert.equal(error.statusCode, 400);
  assert.ok(error.details.some((d) => d.includes('duplicates')));
});

test('Policy API: PUT rejects empty allowedActions', async () => {
  await seedPolicy();

  const controller = createTestPolicyController();
  let error;
  const req = { auth: { merchantId }, params: {}, query: {}, body: { allowedActions: [] }, get: () => undefined };

  await controller.update(req, { status: () => ({ json: () => {} }), json: () => {} }, (err) => { error = err; });

  assert.ok(error);
  assert.equal(error.statusCode, 400);
  assert.ok(error.details.some((d) => d.includes('non-empty')));
});

test('Policy API: PUT rejects unknown fields', async () => {
  await seedPolicy();

  const controller = createTestPolicyController();
  let error;
  const req = { auth: { merchantId }, params: {}, query: {}, body: { unknownField: 'value' }, get: () => undefined };

  await controller.update(req, { status: () => ({ json: () => {} }), json: () => {} }, (err) => { error = err; });

  assert.ok(error);
  assert.equal(error.statusCode, 400);
  assert.ok(error.details.some((d) => d.includes('Unknown field')));
});

test('Policy API: PUT rejects stale version (optimistic concurrency)', async () => {
  await seedPolicy({ version: 3 });

  const controller = createTestPolicyController();
  let error;
  const req = { auth: { merchantId }, params: {}, query: {}, body: { maxAutomaticRetries: 5, expectedVersion: 1 }, get: () => undefined };

  await controller.update(req, { status: () => ({ json: () => {} }), json: () => {} }, (err) => { error = err; });

  assert.ok(error);
  assert.equal(error.statusCode, 409);
  assert.equal(error.details.currentVersion, 3);
});

test('Policy API: PUT rejects excessive values', async () => {
  await seedPolicy();

  const controller = createTestPolicyController();
  let error;
  const req = { auth: { merchantId }, params: {}, query: {}, body: { maxAutomaticRetries: 999 }, get: () => undefined };

  await controller.update(req, { status: () => ({ json: () => {} }), json: () => {} }, (err) => { error = err; });

  assert.ok(error);
  assert.equal(error.statusCode, 400);
  assert.ok(error.details.some((d) => d.includes('maxAutomaticRetries')));
});

test('Policy API: PUT rejects malformed payload', async () => {
  await seedPolicy();

  const controller = createTestPolicyController();
  let error;
  const req = { auth: { merchantId }, params: {}, query: {}, body: 'not-an-object', get: () => undefined };

  await controller.update(req, { status: () => ({ json: () => {} }), json: () => {} }, (err) => { error = err; });

  assert.ok(error);
  assert.equal(error.statusCode, 400);
});

test('Policy API: merchant cannot read another merchant policy', async () => {
  await RecoveryPolicy.deleteMany({ merchant: otherMerchantId });
  await RecoveryPolicy.create({ merchant: otherMerchantId, maxAutomaticRetries: 99, version: 0 });

  const controller = createTestPolicyController();
  const { res, getData, getStatus } = mockRes();
  const req = { auth: { merchantId }, params: {}, query: {}, body: {}, get: () => undefined };

  await controller.get(req, res, () => {});

  assert.equal(getStatus(), 200);
  assert.notEqual(getData().data.maxAutomaticRetries, 99);
  assert.equal(getData().data.maxAutomaticRetries, 2);
});

test('Policy API: merchant cannot update another merchant policy', async () => {
  await RecoveryPolicy.deleteMany({ merchant: otherMerchantId });
  await RecoveryPolicy.create({ merchant: otherMerchantId, maxAutomaticRetries: 5, version: 0 });

  const controller = createTestPolicyController();
  const { res, getStatus } = mockRes();
  const req = { auth: { merchantId }, params: {}, query: {}, body: { maxAutomaticRetries: 1, expectedVersion: 0 }, get: () => undefined };

  await controller.update(req, res, () => {});

  assert.equal(getStatus(), 200);

  const otherPolicy = await RecoveryPolicy.findOne({ merchant: otherMerchantId }).lean();
  assert.equal(otherPolicy.maxAutomaticRetries, 5);
});

test('Policy API: changed allowedActions affects future recommendations', async () => {
  const policy = await seedPolicy({ allowedActions: ['CUSTOMER_REMINDER'] });

  const { evaluateRecoveryAction } = require('../src/services/policyEngine');

  const resultBefore = evaluateRecoveryAction({
    policy,
    payment: { status: 'FAILED', amount: 1000 },
    recoveryCase: { status: 'DETECTED', retryCount: 0, customerContactAttempts: 0 },
    recommendation: { type: 'RETRY_PAYMENT', confidence: 0.9 }
  });

  assert.equal(resultBefore.allowed, false);
  assert.match(resultBefore.reason, /merchant policy/);

  policy.allowedActions = ['CUSTOMER_REMINDER', 'RETRY_PAYMENT'];
  const resultAfter = evaluateRecoveryAction({
    policy,
    payment: { status: 'FAILED', amount: 1000 },
    recoveryCase: { status: 'DETECTED', retryCount: 0, customerContactAttempts: 0 },
    recommendation: { type: 'RETRY_PAYMENT', confidence: 0.9 }
  });

  assert.equal(resultAfter.allowed, true);
});

test('Policy API: historical RecoveryAction is not rewritten after policy change', async () => {
  const policy = await seedPolicy({ allowedActions: ['RETRY_PAYMENT'] });

  const action = await RecoveryAction.create({
    merchant: merchantId,
    payment: new mongoose.Types.ObjectId(),
    recoveryCase: new mongoose.Types.ObjectId(),
    type: 'RETRY_PAYMENT',
    status: 'POLICY_ALLOWED',
    recommendation: { source: 'SYSTEM', confidence: 0.9, rationale: 'Historical action.' },
    policyDecision: { decision: 'ALLOWED', reason: 'Historical decision.', evaluatedAt: new Date() },
    idempotencyKey: 'historical-test'
  });

  policy.allowedActions = ['CUSTOMER_REMINDER'];
  policy.version = 1;
  await policy.save();

  const historicalAction = await RecoveryAction.findById(action._id).lean();
  assert.equal(historicalAction.status, 'POLICY_ALLOWED');
  assert.equal(historicalAction.policyDecision.decision, 'ALLOWED');
});

test('Policy API: audit event cannot be modified', async () => {
  await seedPolicy();

  const controller = createTestPolicyController();
  const req = {
    auth: { merchantId },
    params: {},
    query: {},
    body: { maxAutomaticRetries: 5, expectedVersion: 0 },
    get: () => undefined
  };

  await controller.update(req, { status: () => ({ json: () => {} }), json: () => {} }, () => {});

  const auditEvent = await AuditEvent.findOne({ merchant: merchantId, type: 'POLICY_UPDATED' });
  assert.ok(auditEvent);

  await assert.rejects(
    async () => {
      auditEvent.reason = 'mutated';
      await auditEvent.save();
    },
    /append-only/
  );
});

test('Policy API: two rapid policy updates do not produce duplicate audit event providerEventId', async () => {
  await seedPolicy();

  const controller = createTestPolicyController();

  const req1 = {
    auth: { merchantId },
    params: {},
    query: {},
    body: { maxAutomaticRetries: 3, expectedVersion: 0 },
    get: () => undefined
  };
  const req2 = {
    auth: { merchantId },
    params: {},
    query: {},
    body: { maxAutomaticRetries: 4, expectedVersion: 1 },
    get: () => undefined
  };

  const res = { status: () => ({ json: () => {} }), json: () => {} };

  await controller.update(req1, res, () => {});
  await controller.update(req2, res, () => {});

  const events = await AuditEvent.find({ merchant: merchantId, type: 'POLICY_UPDATED' }).lean();
  assert.equal(events.length, 2);

  const providerEventIds = events.map((e) => e.providerEventId);
  const uniqueIds = new Set(providerEventIds);
  assert.equal(uniqueIds.size, providerEventIds.length, 'providerEventId values must be unique');
});

test('Policy API: optimistic concurrency - only one concurrent update succeeds', async () => {
  await seedPolicy({ version: 0 });

  const runner = new MongoTransactionRunner({ fallbackToDirect: true });
  const controller = createPolicyController({ transactionRunner: runner });

  const makeReq = (retries) => ({
    auth: { merchantId },
    params: {},
    query: {},
    body: { maxAutomaticRetries: retries, expectedVersion: 0 },
    get: () => undefined
  });

  const results = [];
  const errors = [];

  const res1 = { status: () => ({ json: () => { results.push(1); } }), json: () => { results.push(1); } };
  const res2 = { status: () => ({ json: () => { results.push(2); } }), json: () => { results.push(2); } };

  await Promise.all([
    controller.update(makeReq(1), res1, (err) => { if (err) errors.push(err); }),
    controller.update(makeReq(2), res2, (err) => { if (err) errors.push(err); })
  ]);

  assert.equal(results.length, 1, 'exactly one update should succeed');
  assert.equal(errors.length, 1, 'exactly one update should fail');
  assert.equal(errors[0].statusCode, 409);

  const finalPolicy = await RecoveryPolicy.findOne({ merchant: merchantId }).lean();
  assert.ok(finalPolicy, 'policy should exist after concurrent updates');
  assert.equal(finalPolicy.version, 1);

  const auditEvents = await AuditEvent.find({ merchant: merchantId, type: 'POLICY_UPDATED' }).lean();
  assert.equal(auditEvents.length, 1, 'only one audit event should be created');
});

test('Policy API: mass assignment - internal fields cannot be set via API', async () => {
  await seedPolicy();

  const controller = createTestPolicyController();
  let error;
  const req = {
    auth: { merchantId },
    params: {},
    query: {},
    body: { maxAutomaticRetries: 3, __v: 99, _id: 'malicious', version: 100 },
    get: () => undefined
  };

  await controller.update(req, { status: () => ({ json: () => {} }), json: () => {} }, (err) => { error = err; });

  assert.ok(error);
  assert.equal(error.statusCode, 400);
  assert.ok(error.details.some((d) => d.includes('Unknown field')));

  const policy = await RecoveryPolicy.findOne({ merchant: merchantId }).lean();
  assert.ok(policy, 'policy should exist');
  assert.equal(policy.version, 0, 'version should not have been modified');
  assert.equal(policy.maxAutomaticRetries, 2, 'maxAutomaticRetries should not have been modified');
});

test('Policy API: transaction fallback - works without replica set', async () => {
  await seedPolicy();

  const fallbackRunner = new MongoTransactionRunner({ fallbackToDirect: true });
  const testController = createPolicyController({ transactionRunner: fallbackRunner });

  const { res, getStatus } = mockRes();
  const req = {
    auth: { merchantId },
    params: {},
    query: {},
    body: { maxAutomaticRetries: 5, expectedVersion: 0 },
    get: () => undefined
  };

  await testController.update(req, res, () => {});

  assert.equal(getStatus(), 200);

  const auditEvents = await AuditEvent.find({ merchant: merchantId, type: 'POLICY_UPDATED' }).lean();
  assert.equal(auditEvents.length, 1);
  assert.ok(auditEvents[0].providerEventId.includes('policy:'));
});

test('Policy API: changed retry limit affects future stopping-rule evaluation', async () => {
  const policy = await seedPolicy({ maxAutomaticRetries: 1 });

  const { evaluateStoppingRules } = require('../src/services/stoppingRulesEngine');
  const { RECOVERY_ACTION_TYPE, RECOVERY_CASE_STATUS } = require('../src/constants/enums');

  const resultBefore = evaluateStoppingRules({
    policy,
    payment: { status: 'FAILED', amount: 1000 },
    recoveryCase: { status: RECOVERY_CASE_STATUS.DETECTED, retryCount: 1 },
    action: RECOVERY_ACTION_TYPE.RETRY_PAYMENT,
    existingActions: []
  });

  assert.equal(resultBefore.decision, 'ESCALATE');
  assert.equal(resultBefore.rule, 'MAX_RETRIES_EXHAUSTED');

  policy.maxAutomaticRetries = 3;
  const resultAfter = evaluateStoppingRules({
    policy,
    payment: { status: 'FAILED', amount: 1000 },
    recoveryCase: { status: RECOVERY_CASE_STATUS.DETECTED, retryCount: 1 },
    action: RECOVERY_ACTION_TYPE.RETRY_PAYMENT,
    existingActions: []
  });

  assert.equal(resultAfter.decision, 'ALLOW');
  assert.equal(resultAfter.rule, 'NONE');
});
