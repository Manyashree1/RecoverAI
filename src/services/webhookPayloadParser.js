const { AppError } = require('../utils/AppError');
const { getPaymentStatusForEvent } = require('./paymentStateMachine');

function parseRazorpayPaymentWebhook(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError('Malformed webhook payload.', 400);
  }

  const eventType = payload.event;
  const targetStatus = getPaymentStatusForEvent(eventType);
  if (!targetStatus) return { supported: false, eventType };

  const payment = payload.payload?.payment?.entity;
  if (!payment || typeof payment !== 'object' || Array.isArray(payment)) {
    throw new AppError('Webhook payload does not contain payment information.', 400);
  }

  if (!isNonEmptyString(payload.account_id) || !isNonEmptyString(payment.id)) {
    throw new AppError('Webhook payload is missing a provider account or payment identifier.', 400);
  }

  if (!Number.isSafeInteger(payment.amount) || payment.amount < 1 || !isNonEmptyString(payment.currency)) {
    throw new AppError('Webhook payload has invalid payment amount or currency.', 400);
  }

  return {
    supported: true,
    providerAccountId: payload.account_id,
    eventType,
    targetStatus,
    eventOccurredAt: unixTimestampToDate(payload.created_at),
    payment: {
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      orderId: payment.order_id || undefined,
      customerId: payment.customer_id || undefined,
      email: payment.email || undefined,
      contact: payment.contact || undefined,
      failureCode: payment.error_code || undefined,
      failureDescription: payment.error_description || payment.error_reason || undefined,
      occurredAt: unixTimestampToDate(payment.created_at) || unixTimestampToDate(payload.created_at)
    }
  };
}

function unixTimestampToDate(value) {
  if (!Number.isSafeInteger(value) || value < 0) return undefined;
  return new Date(value * 1000);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

module.exports = { parseRazorpayPaymentWebhook };

