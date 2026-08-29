const express = require('express');
const { createRecoveryScoreController } = require('../controllers/recoveryScoreController');
const { createAuthMiddleware } = require('../middleware/authMiddleware');

function createRecoveryScoreRouter({ controller = createRecoveryScoreController(), requireAuth = createAuthMiddleware() } = {}) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/:id/score', controller.getScore);
  return router;
}

module.exports = { createRecoveryScoreRouter };
