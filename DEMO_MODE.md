# RecoverAI — Demo Mode

## Quick start

```bash
# 1. Configure
cp .env.example .env
# Set MONGODB_URI, RAZORPAY_WEBHOOK_SECRET, DEMO_ADMIN_PASSWORD

# 2. Seed demo data
npm run seed:demo

# 3. Start backend
npm run dev

# 4. Start frontend (another terminal)
cd frontend && npm run dev

# 5. Open http://localhost:5173/login
#    Login: demo@recoverai.test
#    Password: (your DEMO_ADMIN_PASSWORD)
```

## Full recovery journey

```
FAILED PAYMENT
  → DETECT (webhook creates RecoveryCase)
  → DIAGNOSE (failure classified: temporary/payment-method/risk/unknown)
  → RECOVERY SCORE (deterministic intelligence)
  → AI/FALLBACK RECOMMENDATION (action + confidence + rationale + factors)
  → POLICY DECISION (ALLOWED or BLOCKED)
  → STOPPING RULE (terminal state / retries / contacts / cooldown)
  → EXECUTE (Razorpay TEST Payment Link created)
  → CUSTOMER ACTUALLY PAYS (manual step in Razorpay TEST mode)
  → payment_link.paid WEBHOOK (HMAC verified)
  → PROVIDER CONFIRMATION (provider payment ID recorded)
  → RECOVERY_COMPLETED (audit event)
  → RECOVERED (case status updated, recoveredAmount from provider)
  → ANALYTICS (dashboard reflects genuine recovery)
  → AUDIT TRAIL (complete evidence chain)
```

## What the seed creates

The demo seed (`scripts/seedDemoData.js`) creates **21 deterministic recovery opportunities** covering:

| Scenario type | Examples |
|--------------|----------|
| Temporary failure | insufficient_funds (various amounts) |
| Payment method issue | expired_card, card_declined |
| Fraud/risk | fraud_suspected |
| Retry limit reached | retry_count >= max |
| Contact fatigue | customerContactAttempts >= max |
| Network failure | network_error |
| Unknown failure | unknown code |
| Cooldown | insufficient_funds (cooldown scenario) |
| High-value | INR 85,000.00 |
| Policy-blocked | card_declined (not in allowedActions) |

## Critical truth rules

- **Seeded recovered revenue = ₹0** — no recovery is fabricated
- A **payment link being created is NOT recovered revenue**
- **Only provider-confirmed payment counts as recovery**
- The dashboard honestly starts at ₹0 recovered

## AI vs deterministic fallback

When `AI_API_KEY` is unset (default), the application uses the **deterministic fallback** and honestly labels it as such in the UI and audit trail.

To enable real AI:
```bash
AI_PROVIDER=anthropic
AI_API_KEY=your_key_here
```

## Batch recovery

The `/recovery-batch` screen allows processing multiple recovery opportunities at once:

1. Opens with status check (no automatic execution)
2. User manually triggers batch run
3. Each case flows through: recommendation → policy → stopping rules → execution
4. Results clearly separate: at risk / pending / recovered

## Genuine recovery path

A real recovery requires:
1. A Razorpay TEST payment link is created
2. A customer actually completes the TEST payment
3. Razorpay sends a signed `payment_link.paid` webhook
4. The signature is verified (HMAC-SHA256)
5. Provider confirmation is persisted
6. Only then does the case become `RECOVERED`

No seeded data, API response, or frontend action can manufacture recovery.
