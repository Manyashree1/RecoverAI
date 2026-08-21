const express = require('express');
const { createAuditEventController } = require('../controllers/auditEventController');
const { createAuthMiddleware } = require('../middleware/authMiddleware');

function createAuditEventRouter({ controller = createAuditEventController(), requireAuth = createAuthMiddleware() } = {}) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/', controller.list);
  return router;
}

module.exports = { createAuditEventRouter };
