require('dotenv').config();

const { env } = require('../src/config/env');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

console.log(`
${CYAN}╔══════════════════════════════════════════════════════════════╗
║                    RecoverAI — Demo Setup                    ║
╚══════════════════════════════════════════════════════════════╝${RESET}
`);

const missing = [];
if (!env.mongoUri) missing.push('MONGODB_URI');
if (!env.razorpayWebhookSecret) missing.push('RAZORPAY_WEBHOOK_SECRET');

if (missing.length > 0) {
  console.log(`${YELLOW}⚠ Missing configuration:${RESET}`);
  for (const m of missing) console.log(`  - ${m}`);
  console.log(`\n  Copy .env.example to .env and set the required values.\n`);
  process.exit(1);
}

console.log(`${GREEN}✓ Configuration verified${RESET}`);

console.log(`
${CYAN}── Next steps ──────────────────────────────────────────────${RESET}

  1. Seed demo data:
     ${GREEN}npm run seed:demo${RESET}
     (set DEMO_ADMIN_PASSWORD first)

  2. Start the backend:
     ${GREEN}npm run dev${RESET}

  3. In another terminal, start the frontend:
     ${GREEN}cd frontend && npm run dev${RESET}

  4. Open ${GREEN}http://localhost:5173/login${RESET}
     Login: ${GREEN}demo@recoverai.test${RESET}
     Password: (the DEMO_ADMIN_PASSWORD you set)

${CYAN}── Recovery journey ────────────────────────────────────────${RESET}

  Overview → Recovery Cases → Case Detail → Generate Recommendation
  → Policy Decision → Execute → Razorpay TEST Payment Link
  → Customer pays → Webhook → RECOVERED

${CYAN}── Key distinction ─────────────────────────────────────────${RESET}

  ${YELLOW}At risk${RESET}    = failed payment exposure
  ${YELLOW}Pending${RESET}    = payment link created, awaiting customer payment
  ${GREEN}Recovered${RESET}  = only after Razorpay confirms payment via webhook

  A payment link being created is NOT recovered revenue.
  Only provider-confirmed payment counts as recovery.

${CYAN}── AI mode ────────────────────────────────────────────────${RESET}

  Deterministic fallback is used when AI_API_KEY is unset.
  To enable real AI: set AI_PROVIDER=anthropic and AI_API_KEY=...

${CYAN}───────────────────────────────────────────────────────────${RESET}
`);
