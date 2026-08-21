const { ReadRepository } = require('../repositories/readRepository');
const { toPublicJSON } = require('../utils/serialize');
const { parsePagination } = require('../utils/pagination');

function createAuditEventController({ repository = new ReadRepository() } = {}) {
  return {
    async list(req, res, next) {
      try {
        const { page, limit } = parsePagination(req.query);
        const { items, pagination } = await repository.listAuditEvents(req.auth.merchantId, {
          payment: req.query.payment,
          recoveryCase: req.query.recoveryCase,
          page,
          limit
        });
        return res.status(200).json({ data: items.map(toPublicJSON), pagination });
      } catch (error) {
        return next(error);
      }
    }
  };
}

module.exports = { createAuditEventController };
