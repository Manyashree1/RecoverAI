const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSourcePath = path.join(__dirname, '..', 'frontend', 'src', 'App.jsx');
const appSource = fs.readFileSync(appSourcePath, 'utf8');

// REGRESSION: a successful recovery payment must never make the UI present
// the ORIGINAL failed payment as CAPTURED. The original payment and the
// recovery payment are two distinct Razorpay records; only the recovery
// payment is PAID/CAPTURED and it is represented by execution.providerPaymentId.

test('UI does not label the original failed payment as CAPTURED because recovery succeeded', () => {
  assert.ok(
    !appSource.includes('now captured as part of the recovery journey'),
    'The "original payment is now captured" narrative must not return.'
  );
  assert.ok(!/payment\.status === 'CAPTURED' \?/.test(appSource), 'Original-payment copy must not switch on CAPTURED status.');
  assert.ok(
    appSource.includes('The original payment failed. The recovery outcome below is a separate customer payment, confirmed independently by Razorpay.'),
    'The corrected historical-failure narrative must be present.'
  );
});

test('"Open payment link" navigates using ONLY the persisted execution.shortUrl', () => {
  assert.ok(
    appSource.includes('href={itemAction.paymentLink.url}'),
    'The anchor must bind href to the persisted paymentLink.url from the API.'
  );
  assert.ok(!appSource.includes("href={`https://"), 'No Razorpay URL may be constructed in JSX.');
  assert.ok(!appSource.includes('rzp.io/'), 'No Razorpay short-URL may be fabricated client-side.');
});
