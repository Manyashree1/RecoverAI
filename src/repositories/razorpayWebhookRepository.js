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
const { env } = require('../config/env');

class RazorpayWebhookRepository {
  async findMerchantByAccountId(accountId, session) {
    const exactMatch = await Merchant.findOne({ razorpayAccountId: accountId, status: 'ACTIVE' }).session(session);
    if (exactMatch || env.nodeEnv === 'production') return exactMatch;

    // Local TEST Mode has one intentionally designated demo merchant and a
    // shared webhook secret, so its provider account ID may be unavailable
    // until the dashboard exposes it. Never use this fallback in production.
    const demoMerchants = await Merchant.find({ name: 'RecoverAI Demo Merchant', status: 'ACTIVE' }).session(session);
    return demoMerchants.length === 1 && !demoMerchants[0].razorpayAccountId ? demoMerchants[0] : null;
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
    const payment = await Payment.findOneAndUpdate(
      { _id: action.payment, merchant: merchantId, status: { $ne: 'CAPTURED' } },
      { $set: { status: 'CAPTURED', amount, currency } },
      { new: true, session, runValidators: true }
    );
    if (!payment) throw new Error('Payment could not be completed for the confirmed payment link.');
    const recoveryCase = await RecoveryCase.findOneAndUpdate(
      { _id: action.recoveryCase, merchant: merchantId, status: { $nin: ['RECOVERED', 'CLOSED'] }, recoveredAmount: 0 },
      { $set: { status: 'RECOVERED', recoveredAmount: amount, resolvedAt: new Date() } },
      { new: true, session, runValidators: true }
    );
    if (!recoveryCase) throw new Error('Recovery case could not be completed for the confirmed payment.');
    return { confirmed: true, action, recoveryCase, payment, currency };
  }

  async reconcileConfirmedRecovery({ merchantId, actionId, providerPaymentId, amount, currency }, session) {
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
    const payment = await Payment.findOneAndUpdate(
      { _id: action.payment, merchant: merchantId, status: { $ne: 'CAPTURED' } },
      { $set: { status: 'CAPTURED', amount, currency } },
      { new: true, session, runValidators: true }
    );
    return { reconciled: Boolean(payment), payment: payment || await Payment.findOne({ _id: action.payment, merchant: merchantId }).session(session) };
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

  async findRecoveryCaseByPayment(paymentId, session) {
    return RecoveryCase.findOne({ payment: paymentId }).session(session);
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

module.exports = { RazorpayWebhookRepository };
