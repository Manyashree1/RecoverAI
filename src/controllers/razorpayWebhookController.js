const { AppError } = require('../utils/AppError');
const { WebhookIngestionService } = require('../services/webhookIngestionService');
const { RazorpayWebhookVerifier } = require('../services/razorpay/razorpayWebhookVerifier');
const { env } = require('../config/env');

function createRazorpayWebhookController({
  ingestionService = new WebhookIngestionService(),
  verifier = new RazorpayWebhookVerifier({ webhookSecret: env.razorpayWebhookSecret })
} = {}) {
  return async function handleRazorpayWebhook(req, res, next) {
    try {
      const signature = req.get('x-razorpay-signature');
      const providerEventId = req.get('x-razorpay-event-id');
      if (!verifier.verify(req.body, signature)) {
        throw new AppError('Invalid webhook signature.', 401);
      }
      if (!providerEventId) {
        throw new AppError('Webhook event identifier is required.', 400);
      }

      let payload;
      try {
        payload = JSON.parse(req.body.toString('utf8'));
      } catch {
        throw new AppError('Malformed webhook payload.', 400);
      }

      const result = await ingestionService.ingestRazorpayPaymentEvent({ providerEventId, payload });
      return res.status(200).json({ received: true, ...result });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createRazorpayWebhookController };

