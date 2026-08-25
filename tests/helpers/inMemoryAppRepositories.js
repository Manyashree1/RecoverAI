const { RECOVERY_POLICY_DEFAULTS } = require('./fixtures');

/**
 * In-memory stand-ins for ReadRepository / RecoveryRecommendationRepository,
 * mirroring the same method names as the Mongoose-backed implementations
 * (the same pattern tests/helpers/inMemoryWebhookRepository.js already uses
 * for the webhook flow) so the API and service layers can be exercised
 * end-to-end without a running MongoDB instance.
 */
function createStore() {
  return {
    merchantUsers: [],
    payments: [],
    recoveryCases: [],
    recoveryActions: [],
    auditEvents: [],
    policies: []
  };
}

class InMemoryReadRepository {
  constructor(store) {
    this.store = store;
  }

  async findMerchantUserByEmail(email) {
    return this.store.merchantUsers.find((u) => u.email === email.trim().toLowerCase()) || null;
  }

  async findMerchantUserById(userId) {
    return this.store.merchantUsers.find((u) => String(u._id) === String(userId)) || null;
  }

  async listPayments(merchantId, { status, page = 1, limit = 20 } = {}) {
    let items = this.store.payments.filter((p) => String(p.merchant) === String(merchantId));
    if (status) items = items.filter((p) => p.status === status);
    return paginate(items, page, limit);
  }

  async findPaymentById(merchantId, paymentId) {
    return this.store.payments.find((p) => String(p.merchant) === String(merchantId) && String(p._id) === String(paymentId)) || null;
  }

  async listRecoveryCases(merchantId, { status, page = 1, limit = 20 } = {}) {
    let items = this.store.recoveryCases.filter((c) => String(c.merchant) === String(merchantId));
    if (status === 'OPEN') items = items.filter((c) => !['RECOVERED', 'UNRECOVERED', 'CLOSED'].includes(c.status));
    else if (status) items = items.filter((c) => c.status === status);
    return paginate(items, page, limit);
  }

  async findRecoveryCaseById(merchantId, recoveryCaseId) {
    const recoveryCase = this.store.recoveryCases.find(
      (c) => String(c.merchant) === String(merchantId) && String(c._id) === String(recoveryCaseId)
    );
    if (!recoveryCase) return null;
    const payment = this.store.payments.find((p) => String(p._id) === String(recoveryCase.payment));
    return { ...recoveryCase, payment };
  }

  async listAuditEvents(merchantId, { payment, recoveryCase, page = 1, limit = 20 } = {}) {
    let items = this.store.auditEvents.filter((e) => String(e.merchant) === String(merchantId));
    if (payment) items = items.filter((e) => String(e.payment) === String(payment));
    if (recoveryCase) items = items.filter((e) => String(e.recoveryCase) === String(recoveryCase));
    return paginate(items, page, limit);
  }
}

class InMemoryRecoveryRecommendationRepository {
  constructor(store) {
    this.store = store;
    this.sequence = 0;
  }

  nextId(prefix) {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }

  async findRecoveryCaseWithPayment(merchantId, recoveryCaseId) {
    const recoveryCase = this.store.recoveryCases.find(
      (c) => String(c.merchant) === String(merchantId) && String(c._id) === String(recoveryCaseId)
    );
    if (!recoveryCase) return null;
    const payment = this.store.payments.find((p) => String(p._id) === String(recoveryCase.payment));
    return { recoveryCase, payment };
  }

  async findOrCreatePolicy(merchantId) {
    let policy = this.store.policies.find((p) => String(p.merchant) === String(merchantId));
    if (!policy) {
      policy = { _id: this.nextId('policy'), merchant: merchantId, ...RECOVERY_POLICY_DEFAULTS() };
      this.store.policies.push(policy);
    }
    return policy;
  }

  async findRecoveryActionByIdempotencyKey(idempotencyKey) {
    return this.store.recoveryActions.find((a) => a.idempotencyKey === idempotencyKey) || null;
  }

  async findRecoveryActionsByCase(merchantId, recoveryCaseId) {
    return this.store.recoveryActions.filter(
      (action) => String(action.merchant) === String(merchantId) && String(action.recoveryCase) === String(recoveryCaseId)
    );
  }

  async createRecoveryAction(data) {
    if (await this.findRecoveryActionByIdempotencyKey(data.idempotencyKey)) throw duplicateKeyError();
    const action = { _id: this.nextId('action'), ...data };
    this.store.recoveryActions.push(action);
    return action;
  }

  async createAuditEvent(data) {
    const event = { _id: this.nextId('audit'), ...data };
    this.store.auditEvents.push(event);
    return event;
  }
}

class InMemoryTransactionRunner {
  constructor(repository) {
    this.repository = repository;
  }

  async run(work) {
    const snapshot = structuredClone(this.repository.store);
    const sequence = this.repository.sequence;
    try {
      return await work({});
    } catch (error) {
      this.repository.store = snapshot;
      this.repository.sequence = sequence;
      throw error;
    }
  }
}

function paginate(items, page, limit) {
  const start = (page - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    pagination: { page, limit, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / limit)) }
  };
}

function duplicateKeyError() {
  const error = new Error('Duplicate key');
  error.code = 11000;
  return error;
}

module.exports = {
  createStore,
  InMemoryReadRepository,
  InMemoryRecoveryRecommendationRepository,
  InMemoryTransactionRunner
};
