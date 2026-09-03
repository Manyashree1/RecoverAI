const express = require('express');
const { createRazorpayWebhookController } = require('../controllers/razorpayWebhookController');
const { RazorpayWebhookRepository } = require('../repositories/razorpayWebhookRepository');
const { createAuthMiddleware } = require('../middleware/authMiddleware');

function createRazorpayWebhookRouter({ controller = createRazorpayWebhookController(), repository = new RazorpayWebhookRepository(), requireAuth = createAuthMiddleware() } = {}) {
  const router = express.Router();
  router.post('/razorpay', express.raw({ type: 'application/json', limit: '100kb' }), controller);
  router.get('/razorpay/events', requireAuth, async (req, res, next) => {
    try {
      const events = await repository.listRecentEvents(req.auth.merchantId);
      res.status(200).json({ data: events });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

module.exports = { createRazorpayWebhookRouter };

