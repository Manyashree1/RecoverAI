const MerchantUser = require('../models/MerchantUser');
const Payment = require('../models/Payment');
const RecoveryCase = require('../models/RecoveryCase');
const AuditEvent = require('../models/AuditEvent');
const { OPEN_RECOVERY_CASE_STATUSES } = require('../constants/enums');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Read-only, merchant-scoped queries backing the Part A APIs. Every method
 * takes the authenticated merchantId as its first argument and filters on
 * it directly in the query -- callers never build a query that could return
 * another merchant's documents.
 */
class ReadRepository {
  async findMerchantUserByEmail(email) {
    return MerchantUser.findOne({ email: email.trim().toLowerCase() });
  }

  async findMerchantUserById(userId) {
    return MerchantUser.findById(userId);
  }

  async listPayments(merchantId, { status, page, limit } = {}) {
    const query = { merchant: merchantId };
    if (status) query.status = status;
    return paginate(Payment, query, { page, limit, sort: { createdAt: -1 } });
  }

  async findPaymentById(merchantId, paymentId) {
    return Payment.findOne({ _id: paymentId, merchant: merchantId }).lean();
  }

  async listRecoveryCases(merchantId, { status, page, limit } = {}) {
    const query = { merchant: merchantId };
    if (status === 'OPEN') query.status = { $in: OPEN_RECOVERY_CASE_STATUSES };
    else if (status) query.status = status;
    return paginate(RecoveryCase, query, { page, limit, sort: { createdAt: -1 } });
  }

  async findRecoveryCaseById(merchantId, recoveryCaseId) {
    return RecoveryCase.findOne({ _id: recoveryCaseId, merchant: merchantId }).populate('payment').lean();
  }

  async listAuditEvents(merchantId, { payment, recoveryCase, page, limit } = {}) {
    const query = { merchant: merchantId };
    if (payment) query.payment = payment;
    if (recoveryCase) query.recoveryCase = recoveryCase;
    return paginate(AuditEvent, query, { page, limit, sort: { createdAt: -1 } });
  }
}

async function paginate(Model, query, { page = DEFAULT_PAGE, limit = DEFAULT_LIMIT, sort } = {}) {
  const safePage = Math.max(1, Number.isFinite(page) ? page : DEFAULT_PAGE);
  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limit) ? limit : DEFAULT_LIMIT));

  const [items, total] = await Promise.all([
    Model.find(query)
      .sort(sort)
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    Model.countDocuments(query)
  ]);

  return {
    items,
    pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.max(1, Math.ceil(total / safeLimit)) }
  };
}

module.exports = { ReadRepository, DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT };
