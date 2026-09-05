# RecoverAI

Policy-gated AI revenue recovery for failed payments. RecoverAI detects failed payments, diagnoses failure causes, generates AI-assisted recovery recommendations, enforces deterministic merchant policy, executes bounded Razorpay TEST MODE payment-link reminders, and only counts revenue as recovered when Razorpay provider-confirms it.

## Track 03 — AI Revenue Recovery

RecoverAI targets the revenue lost between a payment failure and a genuine customer repayment. The system does not invent recoveries: every rupee of recovered revenue must be backed by persisted Razorpay provider evidence.

## The Problem

When a payment fails, the revenue is at risk. Traditional retries are not always possible or appropriate:

* A one-time failed payment cannot be generically retried through the Payments API.
* Customers need reminders, payment-method updates, or human review depending on the failure cause.
* Merchants need policy control over what automation is allowed.
* Without evidence-based measurement, it is impossible to distinguish real recovery from noise.

## What RecoverAI Does

RecoverAI turns failed payments into structured recovery opportunities with a full audit trail:

1. **Detect** — Razorpay webhooks create failed payments and open recovery cases.
2. **Diagnose** — Failure codes are classified as temporary, payment-method, risk, or unknown.
3. **Decide** — AI (or deterministic fallback) recommends an action with confidence and rationale.
4. **Gate** — Deterministic policy engine evaluates the recommendation against merchant limits.
5. **Act** — Bounded executor creates a Razorpay TEST payment link for allowed `CUSTOMER_REMINDER` actions.
6. **Measure** — Analytics calculate truthful recovery metrics from persisted evidence only.
7. **Audit** — Every stage is recorded in an append-only audit trail.

**AI advises. Policy decides. Executor revalidates. Provider confirms recovery. Audit records evidence.**

## Architecture

```text
Razorpay webhook -> Payment -> RecoveryCase -> AI recommendation (non-authoritative)

                                                     |
                                                     v
                                          Policy engine (deterministic, authoritative)
                                                     |
                                                     v
                                          RecoveryAction + AuditEvent
                                                     |
                                                     v
                                       Razorpay TEST adapter (bounded execution)
                                                     |
                                                     v
                                          Provider-confirmed recovery
                                                     |
                                                     v
                                          Merchant-scoped analytics
```

Application code — not the AI — owns policy validation, idempotency, execution permission, provider calls, and audit logging.

## AI Advises. Policy Decides.

The AI provider (Anthropic) or deterministic fallback produces a recommendation:

`{action, confidence, diagnosis, reason, factors, requiresHumanReview}`

It has no authority to:

* Execute financial actions
* Mark revenue as recovered
* Override policy limits
* Access Razorpay directly

The deterministic policy engine is the sole authorization boundary. It checks:

* Merchant-allowed actions
* Minimum recommendation confidence
* Maximum transaction amount
* Retry limits for `RETRY_PAYMENT`
* Contact-attempt limits for `CUSTOMER_REMINDER`

Stopping rules enforce terminal states, cooldowns, contact fatigue, and escalation priority before any execution can proceed.

## Recovery Actions

| Action                  | Behavior                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `CUSTOMER_REMINDER`     | Executable: creates a Razorpay TEST Standard Payment Link. Recovery is confirmed only after a verified `payment_link.paid` webhook. |
| `RETRY_PAYMENT`         | Recommendation-only with the current Razorpay TEST MODE adapter. The generic Payments API cannot retry a failed one-time payment.   |
| `PAYMENT_METHOD_UPDATE` | Recommendation-only; requires customer interaction outside the current adapter.                                                     |
| `ESCALATE_TO_HUMAN`     | Human workflow; no automatic provider execution.                                                                                    |
| `NO_ACTION`             | Explicit no-op recommendation.                                                                                                      |

**Important distinctions:**

* **Recommended** ≠ **Policy Allowed** ≠ **Executed** ≠ **Recovered**
* A payment link being created is **not** recovered revenue.
* Only provider-confirmed payment evidence marks money as recovered.

## Recovery Truth / Provider Confirmation

A recovery case becomes `RECOVERED` only when all of the following are true:

* `RecoveryCase.status = RECOVERED`
* `RecoveryCase.recoveredAmount > 0` from provider-confirmed payment data
* An executed `RecoveryAction` with a `providerReference`
* A Razorpay-authored `RECOVERY_COMPLETED` audit event

No seeded value, API response, or frontend action can manufacture recovery.

## Live Razorpay TEST MODE Proof

RecoverAI has been validated end-to-end using a genuine Razorpay TEST MODE recovery.

The live validation demonstrated:

* A failed recovery case
* Bounded `CUSTOMER_REMINDER` execution
* Razorpay TEST MODE payment-link creation
* Customer payment through the generated link
* `payment_link.paid` webhook delivery
* HMAC verification
* Provider-confirmed payment correlation
* `RECOVERY_COMPLETED` audit persistence
* Recovery case transition to `RECOVERED`
* Provider payment ID and recovered amount persistence
* Analytics attribution to the executed recovery action

This is **Razorpay TEST MODE** — not real production revenue. The live payment is evidence that the recovery pipeline works with the provider; it is not part of the repository's seeded database state.

## Analytics + Auditability

`GET /api/analytics/overview` returns merchant-scoped metrics calculated from persisted records:

* Revenue at risk
* Eligible recovery cases
* Recovery attempts
* Successful recoveries (provider-confirmed only)
* Recovery rate
* Recovery value rate
* Blocked actions
* Failed executions
* AI fallbacks

Recovered revenue is attributed to the specific executed recovery action that produced provider-confirmed evidence. Merchant isolation is enforced at the repository layer.

The audit trail is append-only and records every stage: webhook ingestion, diagnosis, recommendation, policy evaluation, execution attempts, and provider confirmations.

## Demo Portfolio

The repository seeds exactly **21 recovery cases** for the deterministic demo merchant (`recoverai-demo`).

The 21 cases cover a representative range of recovery scenarios:

* Temporary payment failures
* Payment-method issues
* Fraud and risk cases
* Retry-limit scenarios
* Contact-fatigue scenarios
* Network errors
* Unknown failures
* Cooldown scenarios
* High-value policy restrictions
* Policy-blocked recovery scenarios
* Executable customer-reminder opportunities

A fresh clone followed by demo seeding starts with **₹0 recovered revenue**. The seeded portfolio contains no fabricated recovery evidence.

A genuine recovery can be demonstrated separately through the Razorpay TEST MODE payment flow. Only provider-confirmed payment evidence can change recovered revenue.

## Running Locally

### Prerequisites

* Node.js 20+
* MongoDB 6+ (single-node replica set recommended for transactions)
* Razorpay TEST MODE account (optional for recommendations; required for execution)

### Setup

```bash
# 1. Install dependencies

npm install

cd frontend && npm install && cd ..

# 2. Configure environment

cp .env.example .env

# Edit .env with your settings

# 3. Start MongoDB as a single-node replica set (for transactions)

mongod --replSet rs0 --dbpath C:\data\db --port 27017

mongosh --eval "rs.initiate()"

# 4. Seed demo data (development only)

set DEMO_ADMIN_PASSWORD=<your-password>

node scripts/seedDemoData.js

# 5. Start backend

npm run dev

# 6. Start frontend (another terminal)

cd frontend

npm run dev

# 7. Open http://localhost:5173/login
#    Login: demo@recoverai.test
#    Password: <your DEMO_ADMIN_PASSWORD>
```

### Verify transactions

```text
GET http://localhost:3000/api/health/transactions
```

Should return `{ "transactionsSupported": true }` when MongoDB is running as a replica set.

## Environment Variables

| Variable                  | Required | Purpose                                                                                 |
| ------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `NODE_ENV`                | No       | `development` (default) or `test`. Tests automatically use a `_test`-suffixed database. |
| `PORT`                    | No       | Backend port (default `3000`).                                                          |
| `MONGODB_URI`             | Yes      | MongoDB connection string. Include `?replicaSet=rs0` for transactions.                  |
| `JWT_SECRET`              | Yes      | Long random string for session token signing.                                           |
| `JWT_EXPIRES_IN`          | No       | Token expiry (default `12h`).                                                           |
| `RAZORPAY_KEY_ID`         | No       | Razorpay TEST key (`rzp_test_...`). Required for execution.                             |
| `RAZORPAY_KEY_SECRET`     | No       | Razorpay TEST secret. Required for execution.                                           |
| `RAZORPAY_WEBHOOK_SECRET` | No       | Webhook verification secret from Razorpay Dashboard.                                    |
| `RAZORPAY_ACCOUNT_ID`     | No       | Optional; non-secret account ID from webhook payloads.                                  |
| `CORS_ORIGIN`             | No       | Comma-separated browser origins for production deployment.                              |
| `DEMO_ADMIN_PASSWORD`     | No       | Password for the demo merchant admin user.                                              |
| `AI_PROVIDER`             | No       | `anthropic` for AI recommendations; unset for deterministic fallback.                   |
| `AI_API_KEY`              | No       | API key for the configured AI provider. Never logged.                                   |
| `AI_MODEL`                | No       | Model name (default `claude-sonnet-4-6`).                                               |
| `AI_TIMEOUT_MS`           | No       | AI request timeout in milliseconds (default `8000`).                                    |

## API Surface

| Route                                                       | Purpose                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /api/health`                                           | Service health check.                                                                            |
| `POST /api/webhooks/razorpay`                               | Verify and ingest Razorpay TEST payment and Payment Link webhooks.                               |
| `POST /api/auth/login`                                      | Exchange merchant-admin email + password for a session token.                                    |
| `GET /api/payments?status=FAILED&page=&limit=`              | List merchant payments at risk.                                                                  |
| `GET /api/payments/:id`                                     | Payment detail.                                                                                  |
| `GET /api/recovery-cases?status=OPEN&page=&limit=`          | List recovery cases. `status=OPEN` matches any non-terminal status.                              |
| `GET /api/recovery-cases/:id`                               | Recovery case detail, with the associated payment populated.                                     |
| `POST /api/recovery-cases/:id/recommendations`              | Run AI-assisted (or deterministic fallback) recovery intelligence + policy gate; never executes. |
| `GET /api/recovery-actions?page=&limit=`                    | List merchant recovery actions.                                                                  |
| `GET /api/recovery-actions/:id`                             | Recovery action detail.                                                                          |
| `POST /api/recovery-actions/:id/execute`                    | Create a bounded Razorpay TEST payment-link reminder after policy revalidation.                  |
| `POST /api/recovery-actions/:id/reconcile-paid-link`        | Reconcile an already-paid payment link into the recovery flow.                                   |
| `GET /api/audit-events?payment=&recoveryCase=&page=&limit=` | Read the merchant's event timeline.                                                              |
| `GET /api/analytics/overview`                               | Merchant-scoped truthful recovery measurement and breakdowns.                                    |
| `GET /api/recovery-policy`                                  | Read the merchant's recovery policy.                                                             |
| `PUT /api/recovery-policy`                                  | Update the merchant's recovery policy (optimistic concurrency).                                  |
| `GET /api/recovery-batch/status`                            | Get batch configuration (max limit).                                                             |
| `POST /api/recovery-batch/run`                              | Run a bounded batch recovery operation.                                                          |

All routes above except `/health` and `/webhooks/razorpay` require `Authorization: Bearer <token>` from `/api/auth/login`, and are scoped to the authenticated merchant only.

## Domain Schema

| Entity         | Essential relationships and purpose                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Merchant       | Owns all merchant-scoped data.                                                                         |
| Customer       | Belongs to a Merchant and is referenced by payments.                                                   |
| Payment        | Merchant + Customer, external Razorpay IDs, amount in smallest currency unit, status, failure context. |
| RecoveryCase   | Exactly one per failed Payment; owns the recovery state, diagnosis and counters.                       |
| RecoveryAction | A recommendation/execution record with policy result and unique idempotency key.                       |
| RecoveryPolicy | One policy per Merchant with retry, amount, action, confidence and contact limits.                     |
| AuditEvent     | Append-only-style event record connecting merchant, payment, case and action.                          |
| WebhookEvent   | Provider delivery ledger used to deduplicate Razorpay events.                                          |

All money is stored as integer currency subunits (for example, `499900` for INR 4,999.00), never floats.

## Recovery State Machine

```text
FAILED Payment

  -> DETECTED

  -> DIAGNOSED

  -> RECOMMENDED

  -> POLICY_ALLOWED -> ACTION_PENDING -> ACTION_EXECUTING -> RECOVERED | UNRECOVERED -> CLOSED

  -> POLICY_BLOCKED -----------------------------------------------------> CLOSED
```

Webhook ingestion enforces Payment transitions `CREATED → FAILED/AUTHORIZED/CAPTURED`, `FAILED → CAPTURED`, and never downgrades `CAPTURED`. A captured payment closes any existing recovery case without claiming recovered revenue or executing an action.

## Razorpay TEST Webhook Ingestion

`POST /api/webhooks/razorpay` accepts these event types:

* `payment.failed` — creates/updates a failed Payment and creates one RecoveryCase when needed.
* `payment.authorized` — records an authorized Payment; it does not create a RecoveryCase.
* `payment.captured` — records a captured Payment; it does not create a RecoveryCase and closes an existing one if a later capture follows a failure.
* `payment_link.paid` — confirms a payment made through a RecoverAI-created Payment Link and marks only the correlated recovery execution/case as recovered.

Other verified Razorpay events are acknowledged as `ignored`; no business data is created for them.

### Security and idempotency

The route is registered before the JSON parser with `express.raw()`. Razorpay sends `X-Razorpay-Signature`, which is HMAC-SHA256 over the exact request bytes using `RAZORPAY_WEBHOOK_SECRET`. The verifier uses a constant-time comparison. Parsed or re-serialized JSON is never used to calculate the signature.

`x-razorpay-event-id` is mandatory and is stored as `WebhookEvent.providerEventId`. The compound unique index `{ provider, providerEventId }` is the primary delivery-idempotency guard. A duplicate-key error is re-read as an already processed event and acknowledged with success, so Razorpay retries cannot create another payment, recovery case, or audit timeline.

Additional database guards are:

* `Payment.razorpayPaymentId` is unique.
* `RecoveryCase.payment` is unique.
* `{ AuditEvent.providerEventId, type }` is unique when a provider event ID is present.

The webhook ledger, Payment, Customer (if needed), RecoveryCase, AuditEvent records, and processed marker are written in one MongoDB transaction when transactions are supported. A safe direct-write fallback is used when transactions are unavailable.

The raw payload and request headers are intentionally not stored or logged. The webhook ledger holds only provider identifiers, event type, references, and processing state.

## Testing

```bash
npm test
```

Runs all tests covering webhook security, idempotency, state transitions, policy enforcement, recovery execution, analytics truth, AI fallback, and database safety.

```bash
npm run check
```

Syntax-checks all source and script files.

```bash
cd frontend && npm run build
```

Produces a production bundle in `frontend/dist/`.

Tests use a dedicated `recoverai_test` database and include a safety guard that prevents destructive cleanup against any database whose name does not end with `_test`.

## Security

* **JWT authentication** with database reload on every request — revoked users lose access immediately.
* **bcrypt** password hashing with fixed-time comparison for invalid logins.
* **Merchant scoping** — every list/detail query filters on `req.auth.merchantId`, never on client input.
* **Webhook HMAC verification** — constant-time comparison over raw request body.
* **Idempotency** — unique indexes on payment IDs, recovery action keys, and provider event IDs.
* **No credentials in source** — all secrets via environment variables; `.env` is gitignored.
* **API response sanitization** — `toPublicJSON` strips internal fields before responses leave the server.

## Known Limitations

* The AI (or fallback) is invoked even when a repeat request for an unchanged case will be deduplicated by the idempotency key. A future optimization could short-circuit on a cheap pre-check.

* Only one real AI provider (`anthropic`) is implemented; the abstraction supports more.

* Standard Razorpay webhooks can be delayed, duplicated, or out of order. The service guards supported state transitions but does not yet monitor unprocessed delivery failures.

* MongoDB transactions require a replica set. The application supports a safe direct-write fallback when transactions are unavailable.

## Future Work


* Add monitoring for unprocessed webhook delivery failures.

* Support additional AI providers beyond Anthropic.
