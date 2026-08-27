const test = require('node:test');
const assert = require('node:assert/strict');
const { isConflationDamagedPayment } = require('../scripts/repairRecoveredOriginalPayments');

// Shape of the KNOWN damaged production case: the original payment was
// created with its failure signal on the document (no PAYMENT_FAILED audit
// event exists for demo-seeded payments), then flipped to CAPTURED by the old
// recovery confirmation, while the verified recovery payment (pay_...) lives
// on the executed action.
const damagedOriginal = {
  _id: 'payment_original',
  razorpayPaymentId: 'demo_limit',
  status: 'CAPTURED',
  failure: { code: 'insufficient_funds' }
};

test('recognizes the conflation-damaged original payment from persisted failure signal alone', () => {
  assert.equal(isConflationDamagedPayment(damagedOriginal, {
    hasFailureEvidence: true,
    hasGenuineCaptureEvidence: false,
    conflatingProviderPaymentIds: ['pay_TU6At77aVl9YKm']
  }), true);
});

test('does not repair a payment whose own provider id was genuinely captured', () => {
  assert.equal(isConflationDamagedPayment({ ...damagedOriginal, razorpayPaymentId: 'pay_real_capture' }, {
    hasFailureEvidence: true,
    hasGenuineCaptureEvidence: true,
    conflatingProviderPaymentIds: []
  }), false);
});

test('does not repair without any failure history', () => {
  assert.equal(isConflationDamagedPayment({ ...damagedOriginal, failure: undefined }, {
    hasFailureEvidence: false,
    hasGenuineCaptureEvidence: false,
    conflatingProviderPaymentIds: ['pay_TU6At77aVl9YKm']
  }), false);
});

test('does not repair when no verified recovery provider payment differs from its own', () => {
  assert.equal(isConflationDamagedPayment(damagedOriginal, {
    hasFailureEvidence: true,
    hasGenuineCaptureEvidence: false,
    conflatingProviderPaymentIds: []
  }), false);
});

test('does not touch payments that are not CAPTURED', () => {
  assert.equal(isConflationDamagedPayment({ ...damagedOriginal, status: 'FAILED' }, {
    hasFailureEvidence: true,
    hasGenuineCaptureEvidence: false,
    conflatingProviderPaymentIds: ['pay_TU6At77aVl9YKm']
  }), false);
});

test('does not repair when the recovery action reused the same provider payment id', () => {
  assert.equal(isConflationDamagedPayment({ ...damagedOriginal, razorpayPaymentId: 'pay_TU6At77aVl9YKm' }, {
    hasFailureEvidence: true,
    hasGenuineCaptureEvidence: false,
    // Same id as the payment itself -> this was a genuine capture of THIS
    // payment, not conflation from a separate recovery payment.
    conflatingProviderPaymentIds: []
  }), false);
});
