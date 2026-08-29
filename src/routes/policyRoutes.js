const express = require('express');
const { createPolicyController } = require('../controllers/policyController');
const { createAuthMiddleware } = require('../middleware/authMiddleware');

function createPolicyRouter({ controller = createPolicyController(), requireAuth = createAuthMiddleware() } = {}) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/', controller.get);
  router.put('/', controller.update);
  return router;
}

module.exports = { createPolicyRouter };
