const express = require('express');
const { env } = require('./config/env');
const { healthRouter } = require('./routes/healthRoutes');
const { createRazorpayWebhookRouter } = require('./routes/razorpayWebhookRoutes');
const { createAuthRouter } = require('./routes/authRoutes');
const { createPaymentRouter } = require('./routes/paymentRoutes');
const { createRecoveryCaseRouter } = require('./routes/recoveryCaseRoutes');
const { createAuditEventRouter } = require('./routes/auditEventRoutes');
const { createRecoveryActionRouter } = require('./routes/recoveryActionRoutes');
const { createAnalyticsRouter } = require('./routes/analyticsRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

// Deployment-only CORS gate. No origins configured -> behaves exactly as
// before (same-origin/proxied setups). When CORS_ORIGIN lists the deployed
// frontend URL(s), browser requests from that origin are allowed. Server-to-
// server callers (Razorpay webhooks) are unaffected either way.
function deploymentCors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && env.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).end();
  }
  return next();
}

function createApp({
  razorpayWebhookController,
  authRouter,
  paymentRouter,
  recoveryCaseRouter,
  auditEventRouter,
  recoveryActionRouter,
  analyticsRouter
} = {}) {
  const app = express();

  // Signature verification needs the raw body, so the webhook route is
  // registered before the JSON body parser applies to anything below it.
  app.use('/api/webhooks', createRazorpayWebhookRouter({ controller: razorpayWebhookController }));
  app.use(deploymentCors);
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter || createAuthRouter());
  app.use('/api/payments', paymentRouter || createPaymentRouter());
  app.use('/api/recovery-cases', recoveryCaseRouter || createRecoveryCaseRouter());
  app.use('/api/audit-events', auditEventRouter || createAuditEventRouter());
  app.use('/api/recovery-actions', recoveryActionRouter || createRecoveryActionRouter());
  app.use('/api/analytics', analyticsRouter || createAnalyticsRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

const app = createApp();

module.exports = { app, createApp };
