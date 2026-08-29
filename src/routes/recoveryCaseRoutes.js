const express = require('express');
const { createRecoveryCaseController } = require('../controllers/recoveryCaseController');
const { createRecoveryScoreController } = require('../controllers/recoveryScoreController');
const { createAuthMiddleware } = require('../middleware/authMiddleware');

function createRecoveryCaseRouter({ controller = createRecoveryCaseController(), scoreController = createRecoveryScoreController(), requireAuth = createAuthMiddleware() } = {}) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.post('/:id/recommendations', controller.createRecommendation);
  router.post('/:id/recovery-attempts', controller.createRecoveryAttempt);
  router.get('/:id/score', scoreController.getScore);
  return router;
}

module.exports = { createRecoveryCaseRouter };
