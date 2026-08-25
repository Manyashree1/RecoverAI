const MerchantUser = require('../models/MerchantUser');
const Payment = require('../models/Payment');
const RecoveryCase = require('../models/RecoveryCase');
const AuditEvent = require('../models/AuditEvent');
const RecoveryAction = require('../models/RecoveryAction');
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
    const recoveryCase = await RecoveryCase.findOne({ _id: recoveryCaseId, merchant: merchantId }).populate('payment').lean();
    if (!recoveryCase) return null;

    const recoveryActions = await RecoveryAction.find({ merchant: merchantId, recoveryCase: recoveryCaseId }).sort({ createdAt: -1 }).lean();
    const actionIds = recoveryActions.map((action) => action._id);

    // Load the completion evidence used by the executed-action card, so the
    // UI never has to guess whether a CUSTOMER_REMINDER actually produced a
    // Razorpay payment link. The provider payment id is only present after a
    // verified payment_link.paid webhook confirmation (RECOVERY_COMPLETED).
    const completionEvents = await AuditEvent.find({
      merchant: merchantId,
      recoveryAction: { $in: actionIds },
      type: { $in: ['ACTION_EXECUTION_COMPLETED', 'RECOVERY_COMPLETED'] }
    }).lean();
    const completedByAction = new Map(completionEvents
      .filter((event) => event.type === 'ACTION_EXECUTION_COMPLETED')
      .map((event) => [String(event.recoveryAction), event]));
    const recoveryCompletedByAction = new Map(completionEvents
      .filter((event) => event.type === 'RECOVERY_COMPLETED')
      .map((event) => [String(event.recoveryAction), event]));

    recoveryCase.recoveryActions = recoveryActions.map((action) => {
      const completion = completedByAction.get(String(action._id));
      const confirmation = recoveryCompletedByAction.get(String(action._id));
      // In the in-memory test repository `recoveryActions` may carry the
      // read shape already; keep it resilient to either representation.
      const execution = action.execution || {};
      const metadata = completion?.metadata || {};
      const providerReference = execution.providerReference || metadata.providerReference;
      const shortUrl = execution.shortUrl || metadata.shortUrl;
      const providerStatus = execution.providerStatus || metadata.status;
      const providerPaymentId = execution.providerPaymentId || confirmation?.metadata?.providerPaymentId;

      return {
        ...action,
        paymentLink: providerReference || shortUrl ? {
          id: providerReference,
          url: shortUrl,
          status: providerPaymentId ? 'PAID' : (providerStatus || 'created'),
          provider: 'RAZORPAY_TEST',
          providerPaymentId
        } : undefined
      };
    });

    // First-class "confirmed recovery" evidence (case -> provider-confirmed
    // executed action). This is the historical/terminal outcome the UI uses
    // to highlight the successful CUSTOMER_REMINDER without relying on the
    // user reading raw audit events.
    const confirmedAction = recoveryCase.recoveryActions.find((action) =>
      action.type === 'CUSTOMER_REMINDER' &&
      action.status === 'EXECUTED' &&
      action.execution?.result === 'PAYMENT_CONFIRMED'
    );
    if (confirmedAction) {
      recoveryCase.confirmedRecovery = {
        actionId: String(confirmedAction._id),
        recoveredAt: recoveryCase.resolvedAt,
        providerPaymentId: confirmedAction.paymentLink?.providerPaymentId || confirmedAction.execution?.providerPaymentId,
        providerLinkId: confirmedAction.paymentLink?.id || confirmedAction.execution?.providerReference,
        amount: recoveryCase.recoveredAmount
      };
    }

    return recoveryCase;
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
