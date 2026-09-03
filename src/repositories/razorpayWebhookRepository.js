const Merchant = require('../models/Merchant');
const Customer = require('../models/Customer');
const Payment = require('../models/Payment');
const RecoveryCase = require('../models/RecoveryCase');
const RecoveryAction = require('../models/RecoveryAction');
const AuditEvent = require('../models/AuditEvent');
const WebhookEvent = require('../models/WebhookEvent');
const { WEBHOOK_EVENT_STATUS } = require('../constants/enums');
const { RECOVERY_ACTION_TYPE, RECOVERY_ACTION_STATUS } = require('../constants/enums');
const mongoose = require('mongoose');

class RazorpayWebhookRepository {
  async findMerchantByAccountId(accountId, session) {
    const exactMatch = await Merchant.findOne({ razorpayAccountId: accountId, status: 'ACTIVE' }).session(session);
    if (exactMatch) return exactMatch;

    // HMAC-secured single-account TEST resolution, identical in local dev and
    // production. The webhook controller verifies the Razorpay HMAC signature
    // against the deployment's RAZORPAY_WEBHOOK_SECRET before ingestion, so a
    // verified event is known to come from the configured Razorpay TEST
    // account. Razorpay TEST webhooks do carry `account_id`, but that value is
    // not exposed by any Razorpay API this deployment can call and cannot be
    // assumed equal to the dashboard display Merchant ID. Until an operational
    // razorpayAccountId is configured on the merchant, resolve the single
    // designated demo merchant. This preserves merchant scoping: it applies
    // only when exactly one RecoverAI Demo Merchant exists, that merchant has
    // no razorpayAccountId bound, and every downstream correlation query stays
    // merchant-scoped. Once razorpayAccountId is configured (e.g. via
    // RAZORPAY_ACCOUNT_ID + seed), the exact match above is authoritative and
    // this fallback stops applying.
    const demoMerchants = await Merchant.find({ name: 'RecoverAI Demo Merchant', status: 'ACTIVE' }).session(session);
    return selectUnboundDemoMerchant(demoMerchants);
  }

  async findWebhookEvent(providerEventId) {
    return WebhookEvent.findOne({ provider: 'RAZORPAY', providerEventId });
  }

  async createWebhookEvent(data, session) {
    const [event] = await WebhookEvent.create([data], { session });
    return event;
  }

  async markWebhookEventProcessed(eventId, paymentId, session) {
    return WebhookEvent.findByIdAndUpdate(
      eventId,
      { status: WEBHOOK_EVENT_STATUS.PROCESSED, payment: paymentId, processedAt: new Date() },
      { new: true, session }
    );
  }

  async findPaymentByRazorpayPaymentId(razorpayPaymentId, session) {
    return Payment.findOne({ razorpayPaymentId }).session(session);
  }

  async findRecoveryActionByReference({ merchantId, referenceId, paymentLinkId }, session) {
    const actionId = referenceId.startsWith('ra_') ? referenceId.slice(3) : '';
    if (!mongoose.isValidObjectId(actionId)) return null;
    const action = await RecoveryAction.findOne({
      _id: actionId,
      merchant: merchantId,
      type: RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER,
      status: RECOVERY_ACTION_STATUS.EXECUTED,
      'execution.provider': 'RAZORPAY_TEST',
      'execution.providerReference': paymentLinkId
    }).session(session);
    if (!action) return null;
    const [recoveryCase, payment] = await Promise.all([
      RecoveryCase.findOne({ _id: action.recoveryCase, merchant: merchantId }).session(session),
      Payment.findOne({ _id: action.payment, merchant: merchantId }).session(session)
    ]);
    return { action, recoveryCase, payment };
  }

  async confirmRecovery({ merchantId, actionId, providerPaymentId, amount, currency }, session) {
    const action = await RecoveryAction.findOneAndUpdate(
      { _id: actionId, merchant: merchantId, status: RECOVERY_ACTION_STATUS.EXECUTED, 'execution.result': 'PAYMENT_LINK_CREATED', 'execution.providerPaymentId': { $exists: false } },
      { $set: { 'execution.providerPaymentId': providerPaymentId, 'execution.result': 'PAYMENT_CONFIRMED', 'execution.confirmedAt': new Date() } },
      { new: true, session, runValidators: true }
    );
    if (!action) return { confirmed: false };
    // The recovery provider payment is a SEPARATE Razorpay payment. It is
    // represented by execution.providerPaymentId on the action above and,
    // when Razorpay also emits a captured event for it, by its own Payment
    // record via the generic ingestion path. The ORIGINAL failed payment that
    // triggered this case must keep its historical FAILED status and failure
    // signal; recovery confirmation never rewrites that record.
    const recoveryCase = await RecoveryCase.findOneAndUpdate(
      { _id: action.recoveryCase, merchant: merchantId, status: { $nin: ['RECOVERED', 'CLOSED'] }, recoveredAmount: 0 },
      { $set: { status: 'RECOVERED', recoveredAmount: amount, resolvedAt: new Date() } },
      { new: true, session, runValidators: true }
    );
    if (!recoveryCase) throw new Error('Recovery case could not be completed for the confirmed payment.');
    return { confirmed: true, action, recoveryCase, currency };
  }

  async listRecentEvents(merchantId) {
    return WebhookEvent.find({ merchant: merchantId }).sort({ createdAt: -1 }).limit(20).select('providerEventId providerEventType status payment createdAt processedAt').lean();
  }

  async reconcileConfirmedRecovery({ merchantId, actionId, providerPaymentId }, session) {
    const action = await RecoveryAction.findOne({
      _id: actionId,
      merchant: merchantId,
      type: RECOVERY_ACTION_TYPE.CUSTOMER_REMINDER,
      status: RECOVERY_ACTION_STATUS.EXECUTED,
      'execution.provider': 'RAZORPAY_TEST',
      'execution.result': 'PAYMENT_CONFIRMED',
      'execution.providerPaymentId': providerPaymentId
    }).session(session);
    if (!action) return { reconciled: false };
    // Idempotent replay of an already-confirmed action: the provider payment
    // evidence already lives on execution.providerPaymentId. The original
    // failed payment is historical evidence and is never rewritten here.
    return { reconciled: true };
  }

  async createPayment(data, session) {
    const [payment] = await Payment.create([data], { session });
    return payment;
  }

  async updatePayment(paymentId, update, session) {
    return Payment.findByIdAndUpdate(paymentId, update, { new: true, session, runValidators: true });
  }

  async resolveCustomer(merchantId, paymentEntity, session) {
    const customerId = paymentEntity.customerId;
    const email = paymentEntity.email?.trim().toLowerCase();
    const phone = paymentEntity.contact?.trim();

    let customer;
    if (customerId) customer = await Customer.findOne({ merchant: merchantId, externalCustomerId: customerId }).session(session);
    if (!customer && email) customer = await Customer.findOne({ merchant: merchantId, email }).session(session);
    if (!customer && phone) customer = await Customer.findOne({ merchant: merchantId, phone }).session(session);

    if (customer) return customer;

    const [createdCustomer] = await Customer.create(
      [{ merchant: merchantId, externalCustomerId: customerId, email, phone }],
      { session }
    );
    return createdCustomer;
  }

  async findRecoveryCaseByPayment(paymentId, merchantId, session) {
    return RecoveryCase.findOne({ payment: paymentId, merchant: merchantId }).session(session);
  }

  async createRecoveryCase(data, session) {
    const [recoveryCase] = await RecoveryCase.create([data], { session });
    return recoveryCase;
  }

  async closeRecoveryCase(recoveryCaseId, session) {
    return RecoveryCase.findByIdAndUpdate(
      recoveryCaseId,
      { status: 'CLOSED', resolvedAt: new Date() },
      { new: true, session, runValidators: true }
    );
  }

  async createAuditEvent(data, session) {
    const [auditEvent] = await AuditEvent.create([data], { session });
    return auditEvent;
  }
}

/**
 * Selects the sole RecoverAI Demo Merchant that has not yet been bound to a
 * Razorpay account id. Returns null unless there is exactly one candidate and
 * it has no razorpayAccountId -- never guesses between multiple merchants.
 */
function selectUnboundDemoMerchant(demoMerchants) {
  if (!Array.isArray(demoMerchants) || demoMerchants.length !== 1) return null;
  const [merchant] = demoMerchants;
  return merchant && !merchant.razorpayAccountId ? merchant : null;
}

module.exports = { RazorpayWebhookRepository, selectUnboundDemoMerchant };
