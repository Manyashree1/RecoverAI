const { PAYMENT_STATUS } = require('../constants/enums');

const EVENT_TO_STATUS = Object.freeze({
  'payment.failed': PAYMENT_STATUS.FAILED,
  'payment.authorized': PAYMENT_STATUS.AUTHORIZED,
  'payment.captured': PAYMENT_STATUS.CAPTURED
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [PAYMENT_STATUS.CREATED]: [PAYMENT_STATUS.ATTEMPTED, PAYMENT_STATUS.AUTHORIZED, PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.FAILED],
  [PAYMENT_STATUS.ATTEMPTED]: [PAYMENT_STATUS.AUTHORIZED, PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.FAILED],
  [PAYMENT_STATUS.AUTHORIZED]: [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.FAILED],
  // Razorpay may later emit payment.captured after payment.failed. Do not allow
  // a delayed authorized snapshot to downgrade a failed payment.
  [PAYMENT_STATUS.FAILED]: [PAYMENT_STATUS.CAPTURED],
  [PAYMENT_STATUS.CAPTURED]: []
});

function getPaymentStatusForEvent(eventType) {
  return EVENT_TO_STATUS[eventType];
}

function canTransitionPayment(currentStatus, nextStatus) {
  return currentStatus === nextStatus || ALLOWED_TRANSITIONS[currentStatus]?.includes(nextStatus) === true;
}

module.exports = { getPaymentStatusForEvent, canTransitionPayment };

