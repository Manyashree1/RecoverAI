const { RecoveryExecutionService } = require('../services/recoveryExecutionService');

function createRecoveryActionController({ executionService = new RecoveryExecutionService() } = {}) {
  return {
    async execute(req, res, next) {
      try {
        const result = await executionService.execute({ merchantId: req.auth.merchantId, actionId: req.params.id });
        const status = result.outcome === 'EXECUTED' ? 201 : result.outcome === 'IN_PROGRESS' ? 202 : 200;
        return res.status(status).json(result);
      } catch (error) {
        return next(error);
      }
    }
  };
}

module.exports = { createRecoveryActionController };
