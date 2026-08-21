const express = require('express');
const { createRecoveryCaseController } = require('../controllers/recoveryCaseController');
const { createAuthMiddleware } = require('../middleware/authMiddleware');

function createRecoveryCaseRouter({ controller = createRecoveryCaseController(), requireAuth = createAuthMiddleware() } = {}) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.post('/:id/recommendations', controller.createRecommendation);
  return router;
}

module.exports = { createRecoveryCaseRouter };
