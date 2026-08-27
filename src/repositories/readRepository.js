const MerchantUser = require('../models/MerchantUser');
const Payment = require('../models/Payment');
const RecoveryCase = require('../models/RecoveryCase');
const AuditEvent = require('../models/AuditEvent');
const RecoveryAction = require('../models/RecoveryAction');
const { OPEN_RECOVERY_CASE_STATUSES, PAYMENT_STATUS, AUDIT_EVENT_TYPE } = require('../constants/enums');

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
    const { items, pagination } = await paginate(RecoveryCase, query, { page, limit, sort: { createdAt: -1 } });

    // Read-only relationship evidence for list consumers: the provider payment
    // IDs (e.g. Razorpay pay_*) produced by each case's executed recovery
    // actions. execution.providerPaymentId is written only after a verified
    // payment_link.paid webhook confirmation, so its presence proves the
    // provider payment belongs to this recovery journey. Clients use this to
    // represent a journey once instead of duplicating its provider payment as
    // a second standalone payment row. No documents are created or modified.
    const caseIds = items.map((item) => item._id);
    const actions = caseIds.length ? await RecoveryAction.find({
      merchant: merchantId,
      recoveryCase: { $in: caseIds },
      'execution.providerPaymentId': { $exists: true, $nin: [null, ''] }
    }).select('recoveryCase execution.providerPaymentId').lean() : [];

    const providerPaymentIdsByCase = new Map();
    for (const action of actions) {
      const caseKey = String(action.recoveryCase);
      const providerPaymentIds = providerPaymentIdsByCase.get(caseKey) || [];
      if (!providerPaymentIds.includes(action.execution.providerPaymentId)) providerPaymentIds.push(action.execution.providerPaymentId);
      providerPaymentIdsByCase.set(caseKey, providerPaymentIds);
    }

    return {
      items: items.map((item) => ({ ...item, recoveryProviderPaymentIds: providerPaymentIdsByCase.get(String(item._id)) || [] })),
      pagination
    };
  }

  async findRecoveryCaseById(merchantId, recoveryCaseId) {
    const recoveryCase = await RecoveryCase.findOne({ _id: recoveryCaseId, merchant: merchantId }).populate('payment').lean();
    if (!recoveryCase) return null;

    const recoveryActions = await RecoveryAction.find({ merchant: merchantId, recoveryCase: recoveryCaseId }).sort({ createdAt: -1 }).lean();
    const actionIds = recoveryActions.map((action) => action._id);

    const payment = recoveryCase.payment;

    // The original-trigger view is derived from persisted evidence (a
    // PAYMENT_FAILED audit event or a non-empty payment.failure.code) and
    // therefore is independent of the current Payment.status. This is the
    // view the Recovery Case UI binds to so the "original payment was
    // Failed" narrative survives any later mutation of the Payment document
    // (e.g. the historical conflation bug, or a late capture of the same
    // provider id). The Payment page, by contrast, continues to read
    // recoveryCase.payment directly to represent its current persisted state.
    recoveryCase.originalPayment = payment
      ? buildOriginalPaymentView(payment, recoveryCase.createdAt, await AuditEvent.find({
          merchant: merchantId,
          payment: payment._id,
          type: AUDIT_EVENT_TYPE.PAYMENT_FAILED
        }).sort({ createdAt: 1 }).lean())
      : null;

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

    recoveryCase.recoveryActions = recoveryActions.map((action) => buildPaymentLinkView(action, {
      completion: completedByAction.get(String(action._id)),
      confirmation: recoveryCompletedByAction.get(String(action._id))
    }));

    // Concise evidence summary for the case-page sidebar. Backs the UI's
    // "Evidence log" card with counts and the most recent key events so the
    // case page does not have to render the full forensic timeline. The full
    // timeline is still available via /api/audit-events?recoveryCase=...
    // and linked to from the case page.
    const summaryEvents = await AuditEvent.find({
      merchant: merchantId,
      recoveryCase: recoveryCaseId
    }).sort({ createdAt: -1 }).lean();
    recoveryCase.evidenceSummary = buildEvidenceSummary(summaryEvents);

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

  /**
   * Merchant-scoped read-only operations ledger. Builds a denormalized view
   * of every RecoveryAction for the merchant so the Recovery Actions page
   * can show a real ledger without an extra hop per case. The shape is
   * derived entirely from existing relationships; no duplicate domain model,
   * no execution semantics are introduced or altered.
   */
  async listRecoveryActions(merchantId, { page, limit } = {}) {
    const actions = await RecoveryAction.find({ merchant: merchantId })
      .sort({ createdAt: -1 })
      .lean();
    const caseIds = [...new Set(actions.map((action) => action.recoveryCase).filter(Boolean))];
    const paymentIds = [...new Set(actions.map((action) => action.payment).filter(Boolean))];

    const [cases, payments, completionEvents] = await Promise.all([
      caseIds.length ? RecoveryCase.find({ _id: { $in: caseIds } }).select('_id status payment recoveredAmount resolvedAt').lean() : [],
      paymentIds.length ? Payment.find({ _id: { $in: paymentIds } }).select('_id razorpayPaymentId amount currency').lean() : [],
      actions.length ? AuditEvent.find({
        merchant: merchantId,
        recoveryAction: { $in: actions.map((a) => a._id) },
        type: { $in: ['ACTION_EXECUTION_COMPLETED', 'RECOVERY_COMPLETED'] }
      }).lean() : []
    ]);

    const caseById = new Map(cases.map((c) => [String(c._id), c]));
    const paymentById = new Map(payments.map((p) => [String(p._id), p]));
    const completionByAction = new Map();
    const confirmationByAction = new Map();
    for (const event of completionEvents) {
      if (event.type === 'ACTION_EXECUTION_COMPLETED') completionByAction.set(String(event.recoveryAction), event);
      else if (event.type === 'RECOVERY_COMPLETED') confirmationByAction.set(String(event.recoveryAction), event);
    }

    const items = actions.map((action) => {
      const recoveryCase = caseById.get(String(action.recoveryCase));
      const payment = paymentById.get(String(action.payment));
      const completion = completionByAction.get(String(action._id));
      const confirmation = confirmationByAction.get(String(action._id));
      const linkView = buildPaymentLinkView(action, { completion, confirmation });
      return {
        id: String(action._id),
        type: action.type,
        status: action.status,
        recommendation: action.recommendation,
        policyDecision: action.policyDecision,
        execution: action.execution,
        paymentLink: linkView.paymentLink,
        createdAt: action.createdAt,
        updatedAt: action.updatedAt,
        recoveryCase: recoveryCase ? {
          id: String(recoveryCase._id),
          status: recoveryCase.status,
          recoveredAmount: recoveryCase.recoveredAmount,
          resolvedAt: recoveryCase.resolvedAt,
          payment: recoveryCase.payment ? { id: String(recoveryCase.payment) } : null
        } : null,
        payment: payment ? {
          id: String(payment._id),
          razorpayPaymentId: payment.razorpayPaymentId,
          amount: payment.amount,
          currency: payment.currency
        } : null
      };
    });

    return paginateInline(items, { page, limit });
  }
}

/**
 * Pure read-model derivation of the case's "original payment" view. Sourced
 * from the original-trigger evidence (NOT the current Payment.status) so the
 * Recovery Case UI can always render the original "Failed" narrative even
 * when the Payment document's status was changed later in its lifecycle
 * (e.g. by the historical conflation bug, or by a later provider capture
 * of the same razorpayPaymentId). The Payment page, which represents the
 * CURRENT persisted state, continues to read recoveryCase.payment directly.
 *
 * Evidence sources, in priority order:
 *   1. Earliest PAYMENT_FAILED audit event for this payment (any actor)
 *      — the canonical "this payment was observed failing" record.
 *   2. A persisted payment.failure.code on the document itself — used by
 *      deterministic demo seed which bypasses webhook ingestion.
 *   3. Otherwise: falls back to the current Payment.status verbatim and
 *      sets triggerEvidenceAvailable=false so the UI can show
 *      "Trigger state unknown" instead of inventing a status.
 */
function buildOriginalPaymentView(payment, caseCreatedAt, failureEvents = []) {
  const earliestFailureEvent = (failureEvents || [])
    .filter((event) => event && event.type === AUDIT_EVENT_TYPE.PAYMENT_FAILED)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];

  const triggerFromEvent = Boolean(earliestFailureEvent);
  const triggerFromDoc = Boolean(payment?.failure?.code);
  const triggerEvidenceAvailable = triggerFromEvent || triggerFromDoc;

  let status = payment?.status || null;
  let failure = null;
  let detectedAt = caseCreatedAt || payment?.createdAt || null;

  if (triggerFromEvent) {
    status = PAYMENT_STATUS.FAILED;
    failure = {
      code: earliestFailureEvent.error || earliestFailureEvent.metadata?.code || payment.failure?.code || null,
      description: earliestFailureEvent.reason || earliestFailureEvent.metadata?.description || payment.failure?.description || null,
      occurredAt: earliestFailureEvent.createdAt || payment.failure?.occurredAt || null
    };
    detectedAt = earliestFailureEvent.createdAt || detectedAt;
  } else if (triggerFromDoc) {
    status = PAYMENT_STATUS.FAILED;
    failure = {
      code: payment.failure.code,
      description: payment.failure.description || null,
      occurredAt: payment.failure.occurredAt || payment.createdAt || null
    };
    detectedAt = payment.failure.occurredAt || payment.createdAt || detectedAt;
  } else if (status === PAYMENT_STATUS.FAILED) {
    detectedAt = payment.createdAt || detectedAt;
  }

  return {
    paymentId: payment ? String(payment._id) : null,
    razorpayPaymentId: payment?.razorpayPaymentId || null,
    amount: payment?.amount ?? null,
    currency: payment?.currency || null,
    status,
    failure,
    detectedAt,
    triggerEvidenceAvailable
  };
}

/**
 * Pure view builder for a compact evidence summary used by the case page
 * sidebar. Counts events by type and surfaces only the few events that are
 * meaningful to a recovery story (failure trigger, payment-link creation,
 * policy verdict, recovery confirmation). The full timeline is still
 * available via the dedicated /api/audit-events endpoint.
 */
function buildEvidenceSummary(events = []) {
  const counts = {};
  let failureRecordedAt = null;
  let policyEvaluatedAt = null;
  let paymentLinkCreatedAt = null;
  let recoveryCompletedAt = null;
  let lastEventAt = null;

  for (const event of events) {
    if (!event) continue;
    counts[event.type] = (counts[event.type] || 0) + 1;
    const at = event.createdAt || null;
    if (at && (!lastEventAt || new Date(at).getTime() > new Date(lastEventAt).getTime())) lastEventAt = at;
    if (event.type === AUDIT_EVENT_TYPE.PAYMENT_FAILED) failureRecordedAt = failureRecordedAt || at;
    if (event.type === AUDIT_EVENT_TYPE.POLICY_EVALUATED) policyEvaluatedAt = policyEvaluatedAt || at;
    if (event.type === AUDIT_EVENT_TYPE.ACTION_EXECUTION_STARTED) paymentLinkCreatedAt = paymentLinkCreatedAt || at;
    if (event.type === AUDIT_EVENT_TYPE.ACTION_EXECUTION_COMPLETED) paymentLinkCreatedAt = paymentLinkCreatedAt || at;
    if (event.type === AUDIT_EVENT_TYPE.RECOVERY_COMPLETED) recoveryCompletedAt = recoveryCompletedAt || at;
  }

  const keyEvents = [];
  if (failureRecordedAt) keyEvents.push({ type: AUDIT_EVENT_TYPE.PAYMENT_FAILED, at: failureRecordedAt });
  if (policyEvaluatedAt) keyEvents.push({ type: AUDIT_EVENT_TYPE.POLICY_EVALUATED, at: policyEvaluatedAt });
  if (paymentLinkCreatedAt) keyEvents.push({ type: 'PAYMENT_LINK_CREATED', at: paymentLinkCreatedAt });
  if (recoveryCompletedAt) keyEvents.push({ type: AUDIT_EVENT_TYPE.RECOVERY_COMPLETED, at: recoveryCompletedAt });

  return {
    total: events.length,
    counts,
    keyEvents,
    lastEventAt
  };
}

/**
 * Pure view builder for one recovery action's Payment Link card. The hosted
 * link URL is ONLY the persisted execution.shortUrl (or its Razorpay-authored
 * audit metadata fallback). It is never reconstructed from the payment-link
 * ID: Razorpay short URLs are provider-issued and must be used verbatim.
 */
function buildPaymentLinkView(action, { completion, confirmation } = {}) {
  // In the in-memory test repository `recoveryActions` may carry the read
  // shape already; keep it resilient to either representation.
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

/**
 * In-memory pagination for denormalized views built from an already-fetched
 * list. Mirrors the shape produced by paginate() above.
 */
function paginateInline(items, { page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = {}) {
  const safePage = Math.max(1, Number.isFinite(page) ? page : DEFAULT_PAGE);
  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limit) ? limit : DEFAULT_LIMIT));
  const start = (safePage - 1) * safeLimit;
  return {
    items: items.slice(start, start + safeLimit),
    pagination: { page: safePage, limit: safeLimit, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / safeLimit)) }
  };
}

module.exports = { ReadRepository, buildPaymentLinkView, buildOriginalPaymentView, buildEvidenceSummary, paginateInline, DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT };
