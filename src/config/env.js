const dotenv = require('dotenv');

dotenv.config();

const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/recoverai',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  // Signs merchant-admin session tokens. The insecure fallback only exists so
  // `npm run dev` boots without setup; production must set a long random value.
  jwtSecret: process.env.JWT_SECRET || 'dev_insecure_jwt_secret_change_me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',

  // AI-assisted recommendation stage. All optional: when AI_PROVIDER or
  // AI_API_KEY is unset, the application uses the deterministic fallback
  // provider only and never attempts an outbound AI call.
  aiProvider: process.env.AI_PROVIDER || undefined,
  aiApiKey: process.env.AI_API_KEY || undefined,
  aiModel: process.env.AI_MODEL || undefined,
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS || 8000)
});

module.exports = { env };
