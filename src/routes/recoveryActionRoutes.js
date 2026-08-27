const express = require('express');
const { createRecoveryActionController } = require('../controllers/recoveryActionController');
const { createAuthMiddleware } = require('../middleware/authMiddleware');

function createRecoveryActionRouter({ controller = createRecoveryActionController(), requireAuth = createAuthMiddleware() } = {}) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/', controller.list);
  router.post('/:id/execute', controller.execute);
  return router;
}

module.exports = { createRecoveryActionRouter };
