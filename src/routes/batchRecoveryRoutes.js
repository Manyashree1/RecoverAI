const express = require('express');
const { createBatchRecoveryController } = require('../controllers/batchRecoveryController');
const { createAuthMiddleware } = require('../middleware/authMiddleware');

function createBatchRecoveryRouter({
  controller = createBatchRecoveryController(),
  requireAuth = createAuthMiddleware()
} = {}) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/status', controller.getStatus);
  router.post('/run', controller.runBatch);
  return router;
}

module.exports = { createBatchRecoveryRouter };
