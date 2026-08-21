const express = require('express');
const { createRazorpayWebhookController } = require('../controllers/razorpayWebhookController');

function createRazorpayWebhookRouter({ controller = createRazorpayWebhookController() } = {}) {
  const router = express.Router();
  // Signature verification requires the unmodified bytes, so this must run
  // before the application's JSON parser.
  router.post('/razorpay', express.raw({ type: 'application/json', limit: '100kb' }), controller);
  return router;
}

module.exports = { createRazorpayWebhookRouter };

