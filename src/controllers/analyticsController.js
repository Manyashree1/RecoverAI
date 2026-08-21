const { AnalyticsService } = require('../services/analyticsService');

function createAnalyticsController({ analyticsService = new AnalyticsService() } = {}) {
  return { async overview(req, res, next) { try { return res.status(200).json({ data: await analyticsService.overview(req.auth.merchantId) }); } catch (error) { return next(error); } } };
}
module.exports = { createAnalyticsController };
