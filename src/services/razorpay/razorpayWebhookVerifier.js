const crypto = require('crypto');
const { AppError } = require('../../utils/AppError');

class RazorpayWebhookVerifier {
  constructor({ webhookSecret }) {
    this.webhookSecret = webhookSecret;
  }

  verify(rawBody, signature) {
    if (!Buffer.isBuffer(rawBody)) {
      throw new AppError('Webhook body must be supplied as raw bytes.', 400);
    }

    if (!this.webhookSecret) {
      throw new AppError('Webhook verification is not configured.', 503);
    }

    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
      return false;
    }

    const expected = crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const received = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');

    return received.length === expectedBuffer.length && crypto.timingSafeEqual(received, expectedBuffer);
  }
}

module.exports = { RazorpayWebhookVerifier };

