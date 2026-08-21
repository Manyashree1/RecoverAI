const { AppError } = require('../utils/AppError');
const { AuthService } = require('../services/authService');
const { ReadRepository } = require('../repositories/readRepository');

/**
 * Verifies the bearer session token and re-checks the user/merchant against
 * the database on every request (not just the token signature) so a
 * deactivated user or merchant loses access immediately rather than at
 * token expiry. `req.auth.merchantId` is the ONLY source of merchant
 * identity for downstream handlers -- routes must never read a merchant id
 * from params, query, or body for authorization purposes.
 */
function createAuthMiddleware({ authService = new AuthService(), repository = new ReadRepository() } = {}) {
  return async function requireAuth(req, res, next) {
    try {
      const header = req.get('authorization') || '';
      const [scheme, token] = header.split(' ');
      if (scheme !== 'Bearer' || !token) {
        throw new AppError('Authentication is required.', 401);
      }

      const claims = authService.verifySessionToken(token);
      if (!claims) throw new AppError('Invalid or expired session token.', 401);

      const user = await repository.findMerchantUserById(claims.userId);
      if (!user || user.status !== 'ACTIVE' || String(user.merchant) !== String(claims.merchantId)) {
        throw new AppError('Invalid or expired session token.', 401);
      }

      req.auth = { merchantId: String(user.merchant), userId: String(user._id), role: user.role };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createAuthMiddleware };
