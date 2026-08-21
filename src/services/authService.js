const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');

const SALT_ROUNDS = 12;

/**
 * Thin boundary around password hashing and session-token issuance. Kept
 * separate from the repository/controller so the hashing cost and token
 * shape are defined in exactly one place.
 */
class AuthService {
  constructor({ jwtSecret = env.jwtSecret, jwtExpiresIn = env.jwtExpiresIn } = {}) {
    this.jwtSecret = jwtSecret;
    this.jwtExpiresIn = jwtExpiresIn;
  }

  async hashPassword(plainTextPassword) {
    return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
  }

  async verifyPassword(plainTextPassword, passwordHash) {
    return bcrypt.compare(plainTextPassword, passwordHash);
  }

  signSessionToken({ userId, merchantId, role }) {
    return jwt.sign({ merchantId: String(merchantId), role }, this.jwtSecret, {
      subject: String(userId),
      expiresIn: this.jwtExpiresIn
    });
  }

  /**
   * Returns the decoded claims, or null for any invalid/expired/tampered
   * token. Callers must not distinguish the failure reason to the client.
   */
  verifySessionToken(token) {
    try {
      const claims = jwt.verify(token, this.jwtSecret);
      return { userId: claims.sub, merchantId: claims.merchantId, role: claims.role };
    } catch {
      return null;
    }
  }
}

module.exports = { AuthService };
