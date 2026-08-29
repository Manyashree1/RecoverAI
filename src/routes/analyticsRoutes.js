const express = require('express');
const { createAnalyticsController } = require('../controllers/analyticsController');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
function createAnalyticsRouter({ controller = createAnalyticsController(), requireAuth = createAuthMiddleware() } = {}) { const router = express.Router(); router.use(requireAuth); router.get('/overview', controller.overview); router.get('/outcomes', controller.outcomes); router.get('/performance', controller.performance); return router; }
module.exports = { createAnalyticsRouter };
