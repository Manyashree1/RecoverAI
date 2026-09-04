const dotenv = require('dotenv');

dotenv.config();

function resolveTestMongoUri(baseUri) {
  if (!baseUri) return 'mongodb://127.0.0.1:27017/recoverai_test';
  const match = baseUri.match(/^(mongodb:\/\/[^/]+\/)([^?]+)(\?.*)?$/);
  if (match) {
    return `${match[1]}${match[2]}_test${match[3] || ''}`;
  }
  return `${baseUri}_test`;
}

const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/recoverai',
  testMongoUri: resolveTestMongoUri(process.env.MONGODB_URI),
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  razorpayAccountId: process.env.RAZORPAY_ACCOUNT_ID,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  // Comma-separated browser origins allowed to call this API from a deployed
  // frontend, e.g. "https://recoverai.netlify.app". Empty by default, which
  // keeps local same-origin/proxied behavior unchanged.
  corsOrigins: String(process.env.CORS_ORIGIN || '').split(',').map((value) => value.trim()).filter(Boolean),
  // Signs merchant-admin session tokens. Development/test may use a default,
  // but production MUST provide a long random secret or the app will refuse
  // to start. Obviously weak values (short, common, or placeholder strings)
  // are rejected in production.
  jwtSecret: resolveJwtSecret(process.env.JWT_SECRET, process.env.NODE_ENV),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',

  // Optional public webhook URL for the current tunnel/proxy exposing this
  // backend. Used only for the read-only /api/health/webhook-info endpoint.
  // Do not set this to an invented value; leave it unset if the URL is unknown.
  publicWebhookUrl: process.env.PUBLIC_WEBHOOK_URL || undefined,
  // AI-assisted recommendation stage. All optional: when AI_PROVIDER or
  // AI_API_KEY is unset, the application uses the deterministic fallback
  // provider only and never attempts an outbound AI call.
  aiProvider: process.env.AI_PROVIDER || undefined,
  aiApiKey: process.env.AI_API_KEY || undefined,
  aiModel: process.env.AI_MODEL || undefined,
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS || 8000)
});

module.exports = { env };

function resolveJwtSecret(rawSecret, nodeEnv) {
  if (nodeEnv === 'production') {
    if (!rawSecret) {
      throw new Error('JWT_SECRET is required in production.');
    }
    if (isWeakSecret(rawSecret)) {
      throw new Error('JWT_SECRET is too weak for production. Use a long random value.');
    }
    return rawSecret;
  }
  return rawSecret || 'dev_insecure_jwt_secret_change_me';
}

const WEAK_SECRET_PATTERNS = [
  /^dev_insecure/,
  /^change_me/,
  /^secret$/i,
  /^password$/i,
  /^123456/,
  /^abcdef/i,
  /^test$/i,
  /^changeme$/i,
  /^.{1,15}$/
];

function isWeakSecret(secret) {
  if (!secret || typeof secret !== 'string') return true;
  return WEAK_SECRET_PATTERNS.some((pattern) => pattern.test(secret));
}
