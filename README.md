# RecoverAI

RecoverAI is a merchant-facing, policy-gated recovery service for failed payments. This repository contains the backend foundation plus AI-assisted recommendations, bounded Razorpay TEST MODE execution, truthful persisted-state measurement, and a React merchant console.

## What exists

- Express + MongoDB/Mongoose foundation with a health endpoint and verified Razorpay webhook ingestion.
- Domain models for Merchant, Customer, Payment, RecoveryCase, RecoveryAction, RecoveryPolicy, MerchantUser, and append-only-style AuditEvent.
- Central status/action enums, so business states are not scattered as ad-hoc strings.
- Merchant authentication (`MerchantUser` + JWT) and merchant-scoped read APIs for payments, recovery cases, and audit events.
- An AI-assisted recovery recommendation stage with a pluggable provider abstraction and an always-available deterministic fallback (see [AI-assisted recovery recommendation](#ai-assisted-recovery-recommendation) below).
- A pure deterministic policy evaluator that gates every recommendation before execution.
- A Razorpay TEST MODE adapter boundary for bounded Payment Link recovery execution.
- Merchant-scoped analytics derived from persisted payments, recovery cases, actions, and audit evidence.
- A Vite + React merchant console for the command center, payment operations, recovery cases, actions, and audit trail.
- A raw-body, HMAC-verified Razorpay payment webhook endpoint with a durable event ledger and atomic payment/case/audit updates.

## Minimal V1 architecture

See `docs/architecture.md` for the current, detailed diagram. Summary:

```
Razorpay webhook -> Payment -> RecoveryCase -> AI recommendation (non-authoritative)
                                                        |
                                                 Policy engine (deterministic, authoritative)
                                                        |
                                            RecoveryAction + AuditEvent
                                                        |
                                            Razorpay TEST adapter (future: execution)
```

Application code — not the AI — owns policy validation, idempotency, permission to execute, provider calls, and audit logging.

## Proposed API surface

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Service health check. |
| `POST /api/webhooks/razorpay` | Verify and ingest Razorpay TEST payment webhooks. |
| `POST /api/auth/login` | Exchange merchant-admin email + password for a session token. |
| `GET /api/payments?status=FAILED&page=&limit=` | List merchant payments at risk. |
| `GET /api/payments/:id` | Payment detail. |
| `GET /api/recovery-cases?status=OPEN&page=&limit=` | List recovery cases. `status=OPEN` matches any non-terminal status. |
| `GET /api/recovery-cases/:id` | Recovery case detail, with the associated payment populated. |
| `POST /api/recovery-cases/:id/recommendations` | Run the AI-assisted (or deterministic fallback) recovery intelligence + policy gate and record a typed recommendation; never executes. |
| `GET /api/audit-events?payment=&recoveryCase=&page=&limit=` | Read the merchant's event timeline. |
| `POST /api/recovery-actions/:id/execute` | Create a bounded Razorpay TEST payment-link reminder after policy revalidation. |
| `GET /api/analytics/overview` | Merchant-scoped truthful recovery measurement and breakdowns. |

Not yet implemented: `GET/PUT /api/recovery-policy` (policy management UI) and payment-link outcome ingestion.

All routes above except `/health` and `/webhooks/razorpay` require `Authorization: Bearer <token>` from `/api/auth/login`, and are scoped to the authenticated merchant only.

## Domain schema

| Entity | Essential relationships and purpose |
| --- | --- |
| Merchant | Owns all merchant-scoped data. |
| Customer | Belongs to a Merchant and is referenced by payments. |
| Payment | Merchant + Customer, external Razorpay IDs, amount in smallest currency unit, status, failure context. |
| RecoveryCase | Exactly one per failed Payment; owns the recovery state, diagnosis and counters. |
| RecoveryAction | A recommendation/execution record with policy result and unique idempotency key. |
| RecoveryPolicy | One policy per Merchant with retry, amount, action, confidence and contact limits. |
| AuditEvent | Append-only-style event record connecting merchant, payment, case and action. |
| WebhookEvent | Provider delivery ledger used to deduplicate Razorpay events. |

All money is stored as integer currency subunits (for example, `499900` for INR 4,999.00), never floats.

## Recovery state machine

```
FAILED Payment
  -> DETECTED
  -> DIAGNOSED
  -> RECOMMENDED
  -> POLICY_ALLOWED -> ACTION_PENDING -> ACTION_EXECUTING -> RECOVERED | UNRECOVERED -> CLOSED
  -> POLICY_BLOCKED -----------------------------------------------------> CLOSED
```

Webhook ingestion enforces the Payment transitions `CREATED → FAILED/AUTHORIZED/CAPTURED`, `FAILED → CAPTURED`, and never downgrades `CAPTURED`. A captured payment closes any existing recovery case without claiming recovered revenue or executing an action.

## Razorpay TEST webhook ingestion

`POST /api/webhooks/razorpay` accepts these event types:

- `payment.failed` — creates/updates a failed Payment and creates one RecoveryCase when needed.
- `payment.authorized` — records an authorized Payment; it does not create a RecoveryCase.
- `payment.captured` — records a captured Payment; it does not create a RecoveryCase and closes an existing one if a later capture follows a failure.

Other verified Razorpay events are acknowledged as `ignored`; no business data is created for them.

### Security and idempotency

The route is registered *before* the JSON parser with `express.raw()`. Razorpay sends `X-Razorpay-Signature`, which is HMAC-SHA256 over the exact request bytes using `RAZORPAY_WEBHOOK_SECRET`. The verifier uses a constant-time comparison. Parsed or re-serialized JSON is never used to calculate the signature.

`x-razorpay-event-id` is mandatory and is stored as `WebhookEvent.providerEventId`. The compound unique index `{ provider, providerEventId }` is the primary delivery-idempotency guard. A duplicate-key error is re-read as an already processed event and acknowledged with success, so Razorpay retries cannot create another payment, recovery case, or audit timeline.

Additional database guards are:

- `Payment.razorpayPaymentId` is unique.
- `RecoveryCase.payment` is unique.
- `{ AuditEvent.providerEventId, type }` is unique when a provider event ID is present.

The webhook ledger, Payment, Customer (if needed), RecoveryCase, AuditEvent records, and processed marker are written in one MongoDB transaction. This prevents a partially-ingested failed payment from being treated as recoverable. Run MongoDB as a replica set, including locally, because standalone MongoDB does not support multi-document transactions.

The raw payload and request headers are intentionally not stored or logged. The webhook ledger holds only provider identifiers, event type, references, and processing state.

### Configure and test locally

1. Start MongoDB as a single-node replica set and set `MONGODB_URI` in `.env`.
2. Set a merchant's `razorpayAccountId` to the Razorpay Test account ID delivered as `account_id` in its webhook payload.
3. Set a long `RAZORPAY_WEBHOOK_SECRET` in `.env`; this is a webhook secret, not `RAZORPAY_KEY_SECRET`.
4. Run `npm run dev` and expose `http://localhost:3000` with a public HTTPS tunnel accepted by Razorpay (their documentation suggests zrok because some common tunnels may be blocked).
5. In the Razorpay Dashboard **Test Mode**, create a webhook using `https://<public-host>/api/webhooks/razorpay`, set the same secret, and subscribe to `payment.failed`, `payment.authorized`, and `payment.captured`.
6. Make a Test Mode payment and select the failure or success flow. Razorpay will deliver a signed event. The Test Dashboard uses OTP `754081` when managing webhooks.
7. Run `npm test` for fixture-based security, idempotency, state, conflict, and rollback tests without a Razorpay account or network.

Razorpay’s validation guidance requires using the raw body and its `x-razorpay-event-id` header for idempotency. See [Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/) and [Payments Webhook Events](https://razorpay.com/docs/webhooks/payments/).

## Deterministic policy gate

`evaluateRecoveryAction` returns only `ALLOWED` or `BLOCKED`, with a durable reason. It checks:

- merchant-allowed actions;
- minimum recommendation confidence;
- maximum transaction amount;
- retry cap for `RETRY_PAYMENT`;
- contact-attempt cap for `CUSTOMER_REMINDER`.

Any future executor must persist the decision and write an AuditEvent before provider execution.

## AI-assisted recovery recommendation

`POST /api/recovery-cases/:id/recommendations` runs a small pipeline: build a minimal case context → ask an AI provider (if configured) to analyze it → strictly validate the response → hand the validated recommendation to the **unmodified** deterministic policy gate above → persist a `RecoveryAction` and an audit trail. The AI is advisory only; see `docs/architecture.md` for the annotated diagram.

### Provider abstraction

`src/services/ai/` defines one interface, `analyzeRecoveryCase(context, options)`, implemented by:

- `src/services/ai/providers/anthropicAiProvider.js` — calls the Anthropic Messages API over `fetch` when `AI_PROVIDER=anthropic` and `AI_API_KEY` are set. This is the only file that knows the LLM's wire format; adding another provider means adding another class with the same method, not touching the orchestrator.
- `src/services/ai/deterministicFallbackProvider.js` — wraps the existing, unmodified `recoveryIntelligenceService.analyzeRecoveryCase` behind the same interface, and always reports itself as `provider: "deterministic-fallback"` rather than pretending to be an AI result.

`src/services/ai/aiRecoveryAnalysisService.js` orchestrates the two: if no provider is configured, it goes straight to the fallback; if a provider is configured, it tries the AI call first and only falls back on failure. Either path returns the exact same shape, so nothing downstream (policy engine, `RecoveryAction`, API response) needs to know or care which one ran.

### Fallback behavior

The AI provider is an external dependency and is handled defensively. Every one of these is caught, classified, and routed to the deterministic fallback instead of crashing the request:

| Failure | Reason code | 
| --- | --- |
| No `AI_PROVIDER`/`AI_API_KEY` configured | `NOT_CONFIGURED` |
| `AI_PROVIDER` names an unsupported provider | `UNSUPPORTED_PROVIDER` |
| Request exceeds `AI_TIMEOUT_MS` | `TIMEOUT` |
| `fetch` throws (DNS, connection reset, etc.) | `NETWORK_ERROR` |
| Non-2xx HTTP response | `PROVIDER_ERROR` |
| HTTP 429 | `RATE_LIMITED` |
| Response has no parseable JSON text | `INVALID_RESPONSE` |
| Parsed JSON fails schema validation | `SCHEMA_VALIDATION_FAILED` |

Each failure writes an `AI_PROVIDER_FAILED` audit event with its reason code, then an `AI_FALLBACK_USED` audit event, before the deterministic recommendation is generated and the request completes normally with a `200`/`201` — the caller never sees a 5xx just because the AI was unavailable.

### Structured-output validation (never trust arbitrary LLM output)

`src/services/ai/recommendationSchema.js` is the only place a provider's raw output is trusted. It:

- rejects any `action` not in the existing `RecoveryAction` enum (`RETRY_PAYMENT`, `PAYMENT_METHOD_UPDATE`, `CUSTOMER_REMINDER`, `ESCALATE_TO_HUMAN`, `NO_ACTION`);
- rejects a non-numeric or out-of-`[0,1]` `confidence`;
- rejects a missing/empty `reason` or `diagnosis`, or a non-array `factors`;
- rejects a non-boolean `requiresHumanReview`;
- **copies only these known fields into a brand-new object** — any extra field the model invents (a monetary amount, an executable instruction, an unrecognized key) is silently dropped, never passed through. The system prompt also explicitly forbids the model from stating a payment amount at all, since the case context it receives never includes one for it to restate.

A failed validation is treated exactly like any other provider failure: fallback, with `reason: "SCHEMA_VALIDATION_FAILED"` recorded in the audit trail.

### Prompt versioning

`src/services/ai/prompt.js` exports a single `SYSTEM_PROMPT` and a `PROMPT_VERSION` constant (currently `recovery-agent-v1`). The prompt tells the model it is a non-executing recommendation agent, lists the exact allowed actions, forbids inventing payment information or claiming money was recovered or a Razorpay action executed, and requires JSON-only output. Every `AI_ANALYSIS_STARTED`/`AI_RECOMMENDATION_GENERATED` audit event records the `promptVersion` that was active, so a later prompt change can be correlated with a shift in recommendation behavior.

### What the model receives (and never receives)

`src/services/ai/caseContextBuilder.js` builds the only object sent to a provider: payment amount/currency/status/attempt count/failure code+truncated description, the recovery case's status/retry count/contact attempts, and the merchant's policy limits. It never includes document ids, merchant identity, customer PII (email/phone), or anything security-sensitive (JWTs, API keys, webhook secrets, authorization headers) — those simply aren't present on the object to begin with, not filtered out after the fact.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | No | Currently only `anthropic` is supported. Unset (or any other value) means "no AI provider" / "unsupported", both of which fail safely into the deterministic fallback. |
| `AI_API_KEY` | No | API key for the configured provider. Never logged; not present in audit metadata. |
| `AI_MODEL` | No | Model name passed to the provider (e.g. `claude-sonnet-4-6`). |
| `AI_TIMEOUT_MS` | No | Request timeout in milliseconds (default `8000`). |

If `AI_PROVIDER`/`AI_API_KEY` are unset, the application works exactly as before this increment, using only the deterministic engine — this is also how every automated test runs, so tests never depend on a real LLM.

### Testing approach

Tests inject fake providers implementing the same `analyzeRecoveryCase(context)` interface (`tests/helpers/fakeAiProviders.js`) — nothing in the test suite calls a real AI API. Coverage includes: a valid AI response being accepted; an AI-recommended action the merchant policy disallows being blocked; invalid action/confidence/malformed/timeout/network-error/rate-limit responses all safely triggering the fallback without throwing; the AI stage's own request (`AnthropicAiProvider`) tested against a fake `fetch` for its HTTP-level error classification; and the existing recommendation-idempotency behavior verified to still hold with an AI provider configured.

### Known limitations

- The AI (or fallback) is still invoked even when a repeat request for an unchanged case will end up deduplicated by the idempotency key — the dedup check happens after analysis, not before, to keep this increment's diff minimal. A future pass could short-circuit on a cheap pre-check.
- Only one real provider (`anthropic`) is implemented; the abstraction supports more, but no second provider has been added yet.
- `RecoveryCase.diagnosis` (category/explanation/confidence) is not yet populated from the AI/fallback `diagnosis` field — the diagnosis currently only appears in the `ACTION_RECOMMENDED` audit event's metadata and the recommendation API response, not persisted onto the case record itself.

## Razorpay TEST MODE reality

- **Fetch payment details:** feasible through the Payments API.
- **Capture an authorized payment:** feasible, but only when Razorpay has already authorized it; it is not a retry of a failed payment.
- **Create a Standard Payment Link:** feasible in test mode and is the most realistic recovery action: issue a new customer payment opportunity, optionally using Razorpay notification. Test mode currently limits accounts to 30 links.
- **Customer reminder:** can be represented through a payment-link notification/resend workflow once link creation and webhook verification are implemented.
- **Retry failed one-time payment:** not exposed as a generic Payments API operation. Treat as a controlled workflow or payment-link recovery, never claim the original payment was retried.
- **Payment-method update:** no generic one-time-payment API action. Represent it as a customer recovery workflow; do not simulate a payment update as a transaction.
- **UPI Payment Links:** Razorpay documentation states they are not supported in test mode.

Sources: [Payments API](https://razorpay.com/docs/api/payments/), [standard payment-link API](https://razorpay.com/docs/api/payments/payment-links/create-standard/), and [test payment-link flow](https://razorpay.com/docs/payments/payment-links/create/).

## Run locally

1. Install Node.js 20+ and run `npm install`.
2. Copy `.env.example` to `.env` and set `MONGODB_URI` and `RAZORPAY_WEBHOOK_SECRET`.
3. Run `npm run dev`.
4. Request `GET http://localhost:3000/api/health`.

Recommendation-only use does not require Razorpay API credentials. To execute a payment-link reminder, set `RAZORPAY_KEY_ID` (only an `rzp_test_` key) and `RAZORPAY_KEY_SECRET`; never commit `.env` or use production credentials.

## Analytics and demo data

`GET /api/analytics/overview` returns merchant-scoped revenue-at-risk, eligibility, execution, recovery, policy, fallback, and action/failure/status breakdown metrics. Recovered revenue is counted only when a case has a positive `recoveredAmount`, an executed action with a provider reference, and a Razorpay-authored `RECOVERY_COMPLETED` audit event. Payment Link creation alone is never recovery evidence.

For development-only deterministic demo data, set `DEMO_ADMIN_PASSWORD` and run `node scripts/seedDemoData.js`. The seed uses stable upsert keys, hashes the password through `AuthService`, and deliberately seeds no recovered revenue because provider-confirmed Payment Link outcome ingestion is not implemented.

## React merchant console

The frontend lives in `frontend/` and consumes the existing merchant-scoped APIs. Run the backend in one terminal with `npm run dev`, then run the console in another with `cd frontend` and `npm run dev`. Open `http://localhost:5173/login`; Vite proxies `/api` requests to the backend at `http://localhost:3000`.

See [docs/frontend.md](docs/frontend.md) for the screen map, authentication flow, API dependencies, and demo path.

## Next increment

A later provider-outcome ingestion increment can add genuine recovered-revenue records without changing the measurement rules.

## Current technical risks / unknowns

- Standard Razorpay webhooks can be delayed, duplicated, or out of order. This service guards supported Payment state transitions but should eventually have monitoring for unprocessed delivery failures.
- A one-time failed payment cannot be safely "retried" through the general Payments API; recovery must use a new collection flow.
- Webhook delivery can repeat or arrive out of order; signature verification, a stored provider event ID, and transition guards are needed next.
- MongoDB transactions need a replica set. The first increment should avoid requiring multi-document atomicity, or run the local database as a single-node replica set before adding transactional workflows.

## Development Progress

### What was implemented in this increment

- **Merchant authentication.** A `MerchantUser` model (email, bcrypt password hash, `MERCHANT_ADMIN` role, one merchant per user), an `AuthService` (bcryptjs hashing, JWT issuance/verification), `POST /api/auth/login`, and a `requireAuth` middleware that verifies the token *and* re-checks the user/merchant against the database on every request.
- **Merchant-scoped read APIs.** `GET /api/payments`, `GET /api/payments/:id`, `GET /api/recovery-cases`, `GET /api/recovery-cases/:id` (with the payment populated), and `GET /api/audit-events`, all filtered on `req.auth.merchantId` and never on a client-supplied identifier. All support pagination; payments and recovery cases support a `status` filter, and recovery cases additionally accept `status=OPEN` as a convenience filter across every non-terminal status.
- **Deterministic recovery intelligence.** `recoveryIntelligenceService.analyzeRecoveryCase()` — a pure function with no I/O — classifies the payment's failure code (temporary / payment-method / risk / unknown), checks the merchant's retry and contact limits, and factors in payment value to produce `{action, confidence, reason, factors, requiresHumanReview}`. No LLM is involved.
- **Recommendation endpoint.** `POST /api/recovery-cases/:id/recommendations` runs the intelligence service, evaluates the result against the **existing, unmodified** `policyEngine.evaluateRecoveryAction`, and persists a `RecoveryAction` (status `POLICY_ALLOWED` or `POLICY_BLOCKED`, never an execution status) plus `ACTION_RECOMMENDED` and `POLICY_EVALUATED` audit events, all inside one MongoDB transaction. Re-requesting a recommendation for a case whose retry/contact counters haven't changed returns the original record instead of creating a duplicate.
- **Seed script.** `scripts/seedMerchantAdmin.js` creates/updates a Merchant and its first `MerchantUser`, since there is intentionally no public self-registration endpoint.

### Why merchant-scoped APIs are necessary

RecoverAI holds another business's payment, customer, and revenue-recovery data. Without server-verified merchant scoping, any authenticated caller could read (or, later, act on) a different merchant's failed payments and recovery cases. Every list/detail query filters on `req.auth.merchantId`, which is derived only from a verified session token — never from a route param, query string, or request body — so a forged or guessed identifier in the URL cannot cross a merchant boundary.

### Why the deterministic recovery baseline exists before the LLM

An LLM-generated recommendation is probabilistic and can be wrong or inconsistent between runs. Building the deterministic baseline first gives the project: a known-correct reference implementation to validate the policy gate and audit trail against; a reasoning interface (`{action, confidence, reason, factors, requiresHumanReview}`) that an AI-backed implementation can later drop into without changing the policy engine, the API, or the audit logic; and a fallback recommendation source if the AI stage is unavailable or low-confidence. This matches the project's core principle that deterministic backend code — not the model — controls financial authorization.

### How the recommendation differs from execution

`POST /api/recovery-cases/:id/recommendations` calls `recoveryIntelligenceService` and `policyEngine.evaluateRecoveryAction`, then stops. It never calls the Razorpay TEST client, and it can only leave a `RecoveryAction` in `POLICY_ALLOWED` or `POLICY_BLOCKED` — the `QUEUED`, `EXECUTING`, `EXECUTED`, and `FAILED` statuses defined on the model are not reachable from this code path. The corresponding audit event's `result` field is explicitly set to `RECOMMENDED_NOT_EXECUTED`. Bounded execution is intentionally deferred to a later increment, per the task instructions and the Razorpay TEST-mode realities already documented below (a one-time failed payment cannot be generically retried through the Payments API).

### Important security decisions

- Session tokens are signed JWTs, but authorization never trusts the token's claims alone: `requireAuth` reloads the `MerchantUser` from the database on every request and checks it is still `ACTIVE` and still belongs to the claimed merchant, so a revoked user or deactivated merchant loses access immediately rather than at token expiry.
- Login compares the submitted password against a fixed dummy bcrypt hash when no matching user exists, so the response timing for "wrong password" and "no such account" is not distinguishable.
- There is no public registration endpoint. Merchant/user creation is an operational action (`scripts/seedMerchantAdmin.js`), not something an unauthenticated client can trigger.
- API responses are built from repository-returned plain objects via `toPublicJSON`, which strips `__v` and converts `_id`/ObjectId fields to plain string `id`s, so Mongoose/MongoDB internals are never leaked in a response body.
- A malformed `:id` path parameter (not a valid ObjectId) is now mapped to a `404` in the shared error handler instead of a raw Mongoose `CastError` surfacing as a `500`.
- The recommendation endpoint's `idempotencyKey` (`caseId:action:retryN:contactN`) means a second identical request for an unchanged case cannot create a second `RecoveryAction` or duplicate the audit trail — including under a race, via the model's unique index and a duplicate-key fallback read.

### Tests added

- `tests/recoveryIntelligenceService.test.js` — 7 pure unit tests covering the high-value/low-retry retry recommendation, the retry-limit safe fallback, risk/fraud escalation, payment-method-issue detection, terminal-case ineligibility, low-confidence human-review flagging, and confidence bounds.
- `tests/merchantScopedApi.test.js` — 13 HTTP-level tests (in-memory repositories, no live MongoDB needed, same pattern as the existing webhook tests) covering: login success/failure, unauthenticated rejection, merchant-scoped payment listing and cross-merchant 404s, merchant-scoped recovery case listing and detail (with populated payment), recommendation generation, the retry-limit safe recommendation, policy-blocked recommendations, the audit trail for a recommendation, recommendation idempotency, and a 404 for a nonexistent case.
- All 11 pre-existing webhook/security tests are unchanged and still pass.
- `npm test`: **33/33 passing.** `npm run check`: clean (extended to include every new source file).

### What the next increment should be

Add the bounded AI recommendation layer: an LLM call that produces the same `{action, confidence, reason, factors, requiresHumanReview}` shape `recoveryIntelligenceService` returns today, so it can sit behind (or beside, as a comparison) the deterministic baseline without touching the policy engine, the recommendation endpoint, or the audit design. After that, design bounded, idempotent execution against Razorpay TEST payment links, with its own stopping rules (max attempts, cooldown) and `ACTION_EXECUTION_STARTED` / `_COMPLETED` / `_FAILED` audit events.
