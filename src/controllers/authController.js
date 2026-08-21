const { AppError } = require('../utils/AppError');
const { AuthService } = require('../services/authService');
const { ReadRepository } = require('../repositories/readRepository');

function createAuthController({ authService = new AuthService(), repository = new ReadRepository() } = {}) {
  return {
    async login(req, res, next) {
      try {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!email || !password) {
          throw new AppError('Email and password are required.', 400);
        }

        const user = await repository.findMerchantUserByEmail(email);
        // Compare against a fixed hash even when no user exists, so login
        // timing does not reveal which emails are registered.
        const passwordHash = user?.passwordHash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
        const passwordMatches = await authService.verifyPassword(password, passwordHash);

        if (!user || user.status !== 'ACTIVE' || !passwordMatches) {
          throw new AppError('Invalid email or password.', 401);
        }

        const token = authService.signSessionToken({ userId: user._id, merchantId: user.merchant, role: user.role });
        return res.status(200).json({
          token,
          user: { id: String(user._id), email: user.email, role: user.role, merchantId: String(user.merchant) }
        });
      } catch (error) {
        return next(error);
      }
    }
  };
}

module.exports = { createAuthController };
