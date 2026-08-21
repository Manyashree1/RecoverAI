const express = require('express');
const { createPaymentController } = require('../controllers/paymentController');
const { createAuthMiddleware } = require('../middleware/authMiddleware');

function createPaymentRouter({ controller = createPaymentController(), requireAuth = createAuthMiddleware() } = {}) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  return router;
}

module.exports = { createPaymentRouter };
