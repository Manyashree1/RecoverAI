const test = require('node:test');
const assert = require('node:assert/strict');
const { selectUnboundDemoMerchant } = require('../src/repositories/razorpayWebhookRepository');

test('selects the sole unbound demo merchant as the HMAC-verified fallback', () => {
  const merchant = { _id: 'm1', slug: 'recoverai-demo', name: 'RecoverAI Demo Merchant', status: 'ACTIVE' };
  assert.equal(selectUnboundDemoMerchant([merchant]), merchant);
});

test('returns null when there are no demo merchants', () => {
  assert.equal(selectUnboundDemoMerchant([]), null);
});

test('returns null when there is more than one demo merchant', () => {
  assert.equal(selectUnboundDemoMerchant([{ _id: 'm1' }, { _id: 'm2' }]), null);
});

test('returns null when the sole demo merchant already has a bound razorpayAccountId', () => {
  const merchant = { _id: 'm1', razorpayAccountId: 'acc_test_bound' };
  assert.equal(selectUnboundDemoMerchant([merchant]), null);
});

test('returns null for a non-array input', () => {
  assert.equal(selectUnboundDemoMerchant(undefined), null);
  assert.equal(selectUnboundDemoMerchant(null), null);
});