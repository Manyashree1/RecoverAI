const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { RazorpayWebhookVerifier } = require('../src/services/razorpay/razorpayWebhookVerifier');
const { createRazorpayWebhookController } = require('../src/controllers/razorpayWebhookController');
const { createApp } = require('../src/app');

test('webhook verifier accepts only a HMAC generated over the raw body', () => {
  const secret = 'test_webhook_secret';
  const rawBody = Buffer.from('{"event":"payment.failed"}', 'utf8');
  const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const verifier = new RazorpayWebhookVerifier({ webhookSecret: secret });

  assert.equal(verifier.verify(rawBody, signature), true);
  assert.equal(verifier.verify(Buffer.from('{"event":"payment.captured"}', 'utf8'), signature), false);
});

test('invalid Razorpay signature is rejected by the HTTP endpoint before ingestion', async (t) => {
  const controller = createRazorpayWebhookController({
    verifier: new RazorpayWebhookVerifier({ webhookSecret: 'test_webhook_secret' }),
    ingestionService: { ingestRazorpayPaymentEvent: async () => assert.fail('ingestion must not run') }
  });
  const app = createApp({ razorpayWebhookController: controller });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': '0'.repeat(64),
      'x-razorpay-event-id': 'evt_invalid_signature'
    },
    body: '{"event":"payment.failed"}'
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: { message: 'Invalid webhook signature.' } });
});

