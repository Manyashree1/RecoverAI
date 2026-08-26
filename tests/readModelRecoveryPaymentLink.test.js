const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPaymentLinkView } = require('../src/repositories/readRepository');

// Regression coverage for the production recovered case:
//   payment link plink_TTznOLe15Q67Sq -> pay_TU6At77aVl9YKm
// The "Open payment link" URL must be the persisted execution.shortUrl,
// verbatim — never a Razorpay URL constructed from the payment-link ID.

test('payment link URL is exactly the persisted execution.shortUrl', () => {
  const action = {
    _id: 'action_live_001',
    type: 'CUSTOMER_REMINDER',
    status: 'EXECUTED',
    execution: {
      provider: 'RAZORPAY_TEST',
      providerReference: 'plink_TTznOLe15Q67Sq',
      shortUrl: 'https://rzp.io/i/TznOLe15Q67SqTEST',
      result: 'PAYMENT_CONFIRMED',
      providerPaymentId: 'pay_TU6At77aVl9YKm'
    }
  };

  const view = buildPaymentLinkView(action);

  assert.equal(view.paymentLink.id, 'plink_TTznOLe15Q67Sq');
  assert.equal(view.paymentLink.url, 'https://rzp.io/i/TznOLe15Q67SqTEST');
  assert.equal(view.paymentLink.providerPaymentId, 'pay_TU6At77aVl9YKm');
  assert.equal(view.paymentLink.status, 'PAID');
});

test('payment link URL falls back only to audit metadata shortUrl, never the link ID', () => {
  const action = {
    _id: 'action_audit_001',
    type: 'CUSTOMER_REMINDER',
    status: 'EXECUTED',
    execution: { provider: 'RAZORPAY_TEST', providerReference: 'plink_from_action', result: 'PAYMENT_LINK_CREATED' }
  };
  const completion = {
    type: 'ACTION_EXECUTION_COMPLETED',
    metadata: { provider: 'RAZORPAY_TEST', providerReference: 'plink_from_action', shortUrl: 'https://rzp.io/i/auditFallback', status: 'created' }
  };

  const view = buildPaymentLinkView(action, { completion });

  assert.equal(view.paymentLink.url, 'https://rzp.io/i/auditFallback');
  assert.notEqual(view.paymentLink.url, `https://rzp.io/i/${view.paymentLink.id}`);
});

test('without any persisted short URL the read model exposes no URL to construct', () => {
  const action = {
    _id: 'action_nourl_001',
    type: 'CUSTOMER_REMINDER',
    status: 'EXECUTED',
    execution: { provider: 'RAZORPAY_TEST', providerReference: 'plink_no_url', result: 'PAYMENT_LINK_CREATED' }
  };

  const view = buildPaymentLinkView(action, {});

  assert.equal(view.paymentLink.id, 'plink_no_url');
  assert.equal(view.paymentLink.url, undefined);
});
