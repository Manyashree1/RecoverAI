const Merchant = require('../models/Merchant');
const Customer = require('../models/Customer');
const Payment = require('../models/Payment');
const RecoveryCase = require('../models/RecoveryCase');
const AuditEvent = require('../models/AuditEvent');
const WebhookEvent = require('../models/WebhookEvent');
const { WEBHOOK_EVENT_STATUS } = require('../constants/enums');

class RazorpayWebhookRepository {
  async findMerchantByAccountId(accountId, session) {
    return Merchant.findOne({ razorpayAccountId: accountId, status: 'ACTIVE' }).session(session);
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
