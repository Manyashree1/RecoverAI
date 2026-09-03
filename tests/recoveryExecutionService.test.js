const test = require('node:test');
const assert = require('node:assert/strict');
const { RecoveryExecutionService } = require('../src/services/recoveryExecutionService');

function make({ action = {}, payment = {}, recoveryCase = {}, policy = {}, provider } = {}) {
  const store = { action: { _id: 'a1', merchant: 'm1', payment: 'p1', recoveryCase: 'c1', type: 'CUSTOMER_REMINDER', status: 'POLICY_ALLOWED', recommendation: { confidence: 0.9 }, execution: {}, ...action }, payment: { _id: 'p1', merchant: 'm1', amount: 50000, currency: 'INR', status: 'FAILED', ...payment }, recoveryCase: { _id: 'c1', merchant: 'm1', status: 'DETECTED', retryCount: 0, customerContactAttempts: 0, ...recoveryCase }, customer: { _id: 'u1', merchant: 'm1', email: 'customer@example.test', phone: '+919900000001' }, policy: { merchant: 'm1', maxAutomaticRetries: 2, maxTransactionAmount: 1000000, allowedActions: ['CUSTOMER_REMINDER'], minimumRecoveryConfidence: 0.7, maxCustomerContactAttempts: 1, ...policy }, audits: [] };
  const repository = new FakeRepository(store);
  return { store, service: new RecoveryExecutionService({ repository, transactionRunner: new FakeTransactionRunner(store), razorpayClient: provider || successProvider() }) };
}
class FakeRepository {
  constructor(store) { this.store = store; }
  async findActionContext(m, id) { return m === 'm1' && id === 'a1' ? { action: this.store.action, payment: this.store.payment, recoveryCase: this.store.recoveryCase, customer: this.store.customer } : null; }
  async findActionContextByPaymentLink({ merchantId, referenceId, paymentLinkId }) {
    if (merchantId !== 'm1' || referenceId !== 'ra_a1' || paymentLinkId !== 'plink_1') return null;
    return { action: this.store.action, payment: this.store.payment, recoveryCase: this.store.recoveryCase, customer: this.store.customer };
  }
  async findOrCreatePolicy() { return this.store.policy; }
  async claimExecution({ executionKey }) { if (this.store.action.status !== 'POLICY_ALLOWED' || this.store.action.execution.idempotencyKey) return null; Object.assign(this.store.action, { status: 'EXECUTING', execution: { provider: 'RAZORPAY_TEST', idempotencyKey: executionKey } }); return this.store.action; }
  async markExecuted({ executionKey, providerReference }) { if (this.store.action.status !== 'EXECUTING' || this.store.action.execution.idempotencyKey !== executionKey) return null; Object.assign(this.store.action, { status: 'EXECUTED', execution: { ...this.store.action.execution, providerReference, result: 'PAYMENT_LINK_CREATED' } }); return this.store.action; }
  async confirmRecovery({ merchantId, actionId, providerPaymentId, amount, currency }) {
    if (merchantId !== 'm1' || actionId !== 'a1' || !providerPaymentId) return { confirmed: false };
    Object.assign(this.store.action, { status: 'EXECUTED', execution: { ...this.store.action.execution, providerPaymentId, result: 'PAYMENT_CONFIRMED', confirmedAt: new Date() } });
    Object.assign(this.store.recoveryCase, { status: 'RECOVERED', recoveredAmount: amount, resolvedAt: new Date() });
    return { confirmed: true, action: this.store.action, recoveryCase: this.store.recoveryCase, currency };
  }
  async markFailed({ executionKey, error }) { if (this.store.action.status !== 'EXECUTING' || this.store.action.execution.idempotencyKey !== executionKey) return null; Object.assign(this.store.action, { status: 'FAILED', execution: { ...this.store.action.execution, error, result: 'PROVIDER_FAILURE' } }); return this.store.action; }
  async blockAction({ reason }) { if (this.store.action.status !== 'POLICY_ALLOWED') return null; Object.assign(this.store.action, { status: 'BLOCKED', policyDecision: { decision: 'BLOCKED', reason } }); return this.store.action; }
  async updateCaseAfterPaymentLink() { Object.assign(this.store.recoveryCase, { status: 'ACTION_PENDING', customerContactAttempts: this.store.recoveryCase.customerContactAttempts + 1 }); return this.store.recoveryCase; }
  async createAuditEvent(event) { this.store.audits.push(event); return event; }
}
class FakeTransactionRunner { constructor(store) { this.store = store; } async run(work) { const snapshot = structuredClone(this.store); try { return await work({}); } catch (e) { Object.assign(this.store, snapshot); throw e; } } }
function successProvider() { return { calls: 0, async createRecoveryPaymentLink() { this.calls += 1; return { providerReference: 'plink_1', shortUrl: 'https://rzp.io/i/test', status: 'created' }; } }; }
function failingProvider() { return { calls: 0, async createRecoveryPaymentLink() { this.calls += 1; throw new Error('network'); } }; }

test('policy-allowed customer reminder creates a Razorpay payment-link execution record', async () => { const { store, service } = make(); const result = await service.execute({ merchantId: 'm1', actionId: 'a1' }); assert.equal(result.outcome, 'EXECUTED'); assert.equal(store.action.status, 'EXECUTED'); assert.equal(store.recoveryCase.status, 'ACTION_PENDING'); assert.equal(store.recoveryCase.customerContactAttempts, 1); assert.equal(store.payment.status, 'FAILED'); assert.deepEqual(store.audits.map((e) => e.type), ['ACTION_EXECUTION_STARTED', 'ACTION_EXECUTION_COMPLETED']); });
test('policy-blocked action cannot execute', async () => { const { store, service } = make({ action: { status: 'POLICY_BLOCKED' } }); const result = await service.execute({ merchantId: 'm1', actionId: 'a1' }); assert.equal(result.outcome, 'BLOCKED'); assert.equal(store.action.status, 'POLICY_BLOCKED'); });
test('executed action returns existing result without another provider call', async () => { const provider = successProvider(); const { service } = make({ provider, action: { status: 'EXECUTED', execution: { providerReference: 'plink_1' } } }); assert.equal((await service.execute({ merchantId: 'm1', actionId: 'a1' })).outcome, 'DUPLICATE'); assert.equal(provider.calls, 0); });
test('concurrent duplicate sees IN_PROGRESS and cannot call provider twice', async () => { const provider = successProvider(); const { store, service } = make({ provider }); store.action.status = 'EXECUTING'; store.action.execution = { idempotencyKey: 'payment-link:a1' }; assert.equal((await service.execute({ merchantId: 'm1', actionId: 'a1' })).outcome, 'IN_PROGRESS'); assert.equal(provider.calls, 0); });
test('captured payment blocks execution', async () => { const { service } = make({ payment: { status: 'CAPTURED' } }); assert.equal((await service.execute({ merchantId: 'm1', actionId: 'a1' })).outcome, 'BLOCKED'); });
test('contact limit prevents payment-link reminder', async () => { const { service } = make({ recoveryCase: { customerContactAttempts: 1 }, policy: { maxCustomerContactAttempts: 1 } }); assert.equal((await service.execute({ merchantId: 'm1', actionId: 'a1' })).outcome, 'BLOCKED'); });
test('unsupported Razorpay action is safely blocked', async () => { const { service } = make({ action: { type: 'RETRY_PAYMENT' }, policy: { allowedActions: ['RETRY_PAYMENT'] } }); assert.equal((await service.execute({ merchantId: 'm1', actionId: 'a1' })).outcome, 'BLOCKED'); });
test('provider failure is marked failed and audited', async () => { const { store, service } = make({ provider: failingProvider() }); assert.equal((await service.execute({ merchantId: 'm1', actionId: 'a1' })).outcome, 'FAILED'); assert.equal(store.action.status, 'FAILED'); assert.equal(store.audits.at(-1).type, 'ACTION_EXECUTION_FAILED'); });
test('already-paid payment link is reconciled into the existing recovery flow without creating a second payment', async () => {
  const provider = {
    calls: 0,
    async fetchPaymentLink({ paymentLinkId }) {
      this.calls += 1;
      assert.equal(paymentLinkId, 'plink_1');
      return { id: 'plink_1', referenceId: 'ra_a1', amountPaid: 50000, currency: 'INR', status: 'paid', providerPaymentId: 'pay_link_paid_123' };
    }
  };
  const { store, service } = make({ provider, action: { status: 'EXECUTED', execution: { provider: 'RAZORPAY_TEST', providerReference: 'plink_1', result: 'PAYMENT_LINK_CREATED' } } });

  const result = await service.reconcileAlreadyPaidLink({ merchantId: 'm1', paymentLinkId: 'plink_1' });

  assert.equal(result.outcome, 'RECOVERED');
  assert.equal(store.recoveryCase.status, 'RECOVERED');
  assert.equal(store.recoveryCase.recoveredAmount, 50000);
  assert.equal(store.action.execution.providerPaymentId, 'pay_link_paid_123');
  assert.equal(store.audits.at(-1).type, 'RECOVERY_COMPLETED');
  assert.equal(provider.calls, 1);
});
test('merchant A cannot execute merchant B action', async () => { const { service } = make(); await assert.rejects(service.execute({ merchantId: 'm2', actionId: 'a1' }), (e) => e.statusCode === 404); });
test('changed merchant policy is re-evaluated before execution', async () => { const { service } = make({ policy: { allowedActions: [] } }); assert.equal((await service.execute({ merchantId: 'm1', actionId: 'a1' })).outcome, 'BLOCKED'); });
test('recovered case blocks execution', async () => { const { service } = make({ recoveryCase: { status: 'RECOVERED' } }); assert.equal((await service.execute({ merchantId: 'm1', actionId: 'a1' })).outcome, 'BLOCKED'); });
