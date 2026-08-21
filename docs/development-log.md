# RecoverAI Development Log

A concise, chronological record of each development increment: what changed, why, and what's next. Intended to make project history easy to reconstruct later (e.g. for interview prep) without re-reading every diff.

---

## Increment 01 — Foundation

Express + MongoDB/Mongoose project skeleton: environment config, centralized enums, error handling, and the domain models (`Merchant`, `Customer`, `Payment`, `RecoveryCase`, `RecoveryAction`, `RecoveryPolicy`, `AuditEvent`, `WebhookEvent`). Established the money-as-integer-subunits convention and the append-only-style `AuditEvent` schema.

## Increment 02 — Razorpay webhook ingestion

`POST /api/webhooks/razorpay`: raw-body HMAC signature verification, provider-event-ID idempotency, payload validation, a payment state machine (`CREATED → FAILED/AUTHORIZED/CAPTURED`, `FAILED → CAPTURED`, never downgrading `CAPTURED`), and transactional creation of `Payment` / `RecoveryCase` / `AuditEvent` records. Deliberately does not execute recovery actions. Full detail in `docs/INCREMENT-02-WEBHOOK-INGESTION.md`.

## Increment 03 — Recovery case intelligence + merchant-scoped read API

**Goal:** turn a raw `RecoveryCase` into something a future AI agent and frontend can work with, and give a merchant a way to read their own data.

**Part A — Auth + merchant-scoped reads.**
- Added `MerchantUser` (email, bcrypt hash, `MERCHANT_ADMIN` role, one merchant per user) and `AuthService` (bcryptjs + jsonwebtoken).
- Added `POST /api/auth/login` and a `requireAuth` middleware that verifies the JWT and re-checks the user/merchant against the database on every request (not just the signature), so revocation takes effect immediately.
- Added `ReadRepository` and `GET /api/payments`, `GET /api/payments/:id`, `GET /api/recovery-cases`, `GET /api/recovery-cases/:id` (payment populated), `GET /api/audit-events` — every query filters on `req.auth.merchantId`, derived only from the verified token, never from a route/query/body value.
- Added `scripts/seedMerchantAdmin.js` for local merchant/user creation; there is intentionally no public self-registration endpoint.

**Part B — Deterministic recovery intelligence.**
- Added `recoveryIntelligenceService.analyzeRecoveryCase()`: a pure, deterministic function (no LLM, no I/O) that classifies the payment's failure code into `TEMPORARY` / `PAYMENT_METHOD_ISSUE` / `RISK` / `UNKNOWN`, applies the merchant's retry/contact limits, and factors in payment value to produce `{action, confidence, reason, factors, requiresHumanReview}`.
- Added `recoveryRecommendationService`, which calls the intelligence service, evaluates the result through the **existing, unmodified** `policyEngine.evaluateRecoveryAction`, and persists a `RecoveryAction` (status `POLICY_ALLOWED`/`POLICY_BLOCKED` only — never an execution status) plus `ACTION_RECOMMENDED` and `POLICY_EVALUATED` audit events, all in one transaction. An idempotency key (`caseId:action:retryN:contactN`) prevents duplicate recommendations for an unchanged case.
- Added `POST /api/recovery-cases/:id/recommendations` to trigger this pipeline. It never calls the Razorpay client and cannot reach `QUEUED`/`EXECUTING`/`EXECUTED`/`FAILED` on the `RecoveryAction`.

**Design decisions worth remembering:**
- The recommendation's `{action, confidence, reason, factors, requiresHumanReview}` shape is the seam an LLM-backed implementation will plug into next; nothing downstream (policy engine, endpoint, audit shape) should need to change when that happens.
- Policy evaluation reuses `policyEngine.js` rather than a second engine — the deterministic authorization boundary stays singular.
- API responses go through a `toPublicJSON` serializer so Mongoose/Mongo internals (`__v`, raw `ObjectId`s) never leak.
- A malformed `:id` now maps to `404` via a `CastError` check in the shared error handler, instead of leaking a `500`.

**Tests:** 20 new tests (7 pure intelligence unit tests, 13 HTTP-level merchant-scoping/recommendation tests using in-memory repositories — no live MongoDB required). All 11 pre-existing webhook tests untouched and passing. `npm test`: 33/33. `npm run check`: clean.

**Next increment:** Replace/extend the deterministic recommendation with an LLM call behind the same interface; then design bounded, idempotent execution against Razorpay TEST payment links with its own stopping rules and execution audit events.

## Increment 04 — AI-assisted recovery recommendation

**Goal:** make the recommendation stage genuinely AI-assisted while keeping the deterministic safety architecture (policy engine, RecoveryAction, audit trail) completely unchanged and authoritative.

**AI provider abstraction (`src/services/ai/`).**
- One interface, `analyzeRecoveryCase(context, options)`, with two implementations: `AnthropicAiProvider` (real LLM call over `fetch` to the Anthropic Messages API, used only when `AI_PROVIDER=anthropic` and `AI_API_KEY` are set) and `DeterministicFallbackProvider` (wraps the existing, unmodified `recoveryIntelligenceService.analyzeRecoveryCase`, always self-identifies as `provider: "deterministic-fallback"`).
- `aiProviderFactory.createPrimaryAiProvider()` reads env config and returns `null` when unconfigured, or a stub that fails safely with reason `UNSUPPORTED_PROVIDER` if `AI_PROVIDER` names something we don't implement -- neither case crashes the app.
- `AiRecoveryAnalysisService` orchestrates provider selection, calls the primary provider if one exists, validates its response, and falls back to the deterministic provider on any failure -- returning the same `{recommendation, source, provider, model, promptVersion, auditEvents}` shape regardless of which path ran.

**Structured-output safety.**
- `recommendationSchema.validateAiRecommendation` is the single point where a provider's raw output is trusted. It rejects any action outside the existing `RecoveryAction` enum, any confidence outside `[0,1]`, missing/empty reason or diagnosis, non-array factors, and non-boolean `requiresHumanReview` -- and, regardless of validity, **copies only those known fields into a brand-new object**, so an invented monetary amount, executable instruction, or unrecognized field from the model can never reach the policy engine or the database.
- `caseContextBuilder.buildCaseContext` is the only thing sent to a provider: payment amount/currency/status/attempt count/failure code, case status/retry/contact counts, and merchant policy limits. No ids, no customer PII, no secrets, no tokens.
- `prompt.js` centralizes `SYSTEM_PROMPT` and a `PROMPT_VERSION` constant (`recovery-agent-v1`), explicitly instructing the model it cannot execute payments, must not invent payment data, must not claim money was recovered or an action executed, and must return the allowed-action set only.

**Failure handling.** Every external-dependency failure mode (unconfigured, unsupported provider, timeout, network error, non-2xx, 429, unparseable response, schema validation failure) is caught, classified with a reason code, and routed to the deterministic fallback -- the HTTP request still completes normally. Nothing is ever silently retried against the AI, and the server never crashes because the AI is unavailable.

**Recommendation service integration.** `recoveryRecommendationService` was modified minimally: the single line that called `analyzeRecoveryCase` directly now calls `aiAnalysisService.analyze(...)` instead, and the recommendation object it gets back has the exact same fields the policy engine already expected (`action`, `confidence`). Everything else -- the policy engine call, the idempotency key/dedup logic, the `RecoveryAction` write, the `ACTION_RECOMMENDED`/`POLICY_EVALUATED` audit events -- is unchanged. The AI stage's own audit events (`AI_ANALYSIS_STARTED`, `AI_RECOMMENDATION_GENERATED` or `AI_PROVIDER_FAILED` + `AI_FALLBACK_USED`) are written in the same transaction, before those two.

**Audit trail additions.** Four new `AUDIT_EVENT_TYPE` values (`AI_ANALYSIS_STARTED`, `AI_RECOMMENDATION_GENERATED`, `AI_PROVIDER_FAILED`, `AI_FALLBACK_USED`) with metadata limited to provider/model/promptVersion/confidence/reason-code -- never a prompt, an API key, or unnecessary customer data.

**Design decisions worth remembering:**
- The AI is architecturally incapable of authorizing money movement: it can only produce a recommendation object with no execution field, and `policyEngine.evaluateRecoveryAction` (untouched) is still the only ALLOW/BLOCK boundary.
- The deterministic fallback is not a "worse AI" -- it's the same trusted logic from Increment 03, now reachable both as the default (no provider configured) and as the safety net (provider configured but failing), and it is never mislabeled as an AI result.
- `RecoveryAction.recommendation.source` becomes `AI_AGENT` only when a validated AI response was actually used; every fallback path writes `SYSTEM`, matching the pre-existing enum with no schema change needed.

**Tests:** 30 new tests across 5 files -- `recommendationSchema.test.js` (whitelist/rejection behavior, 8 tests), `aiRecoveryAnalysisService.test.js` (provider selection, fallback triggers, audit drafts, 8 tests), `anthropicAiProvider.test.js` (HTTP-level error classification against a fake `fetch`, 9 tests), `aiRecommendationFlow.test.js` (end-to-end: valid AI recommendation, policy-blocked AI recommendation, no-execution guarantee, timeout fallback, idempotency with AI configured, 5 tests). All 33 pre-existing tests unchanged and passing (two assertions updated for the new `AI_FALLBACK_USED` audit event that now appears whenever no provider is configured, which is the case for every existing test). `npm test`: **63/63 passing.** `npm run check`: clean (extended with every new AI source file).

**Next increment:** Design bounded, idempotent execution against Razorpay TEST payment links (`POST /api/recovery-actions/:id/execute`), acting only on a `POLICY_ALLOWED` `RecoveryAction`, with its own stopping rules (max attempts, cooldown) and `ACTION_EXECUTION_STARTED`/`_COMPLETED`/`_FAILED` audit events.

## Increment 05 — Bounded Razorpay TEST execution

Added `POST /api/recovery-actions/:id/execute`. Only `CUSTOMER_REMINDER` executes, by creating a Razorpay TEST Standard Payment Link. This is a new payment opportunity, never a retry of the original payment or a recovery claim.

The server reloads merchant-owned context, reruns the deterministic policy gate, checks terminal states and contact limits, then atomically reserves `POLICY_ALLOWED -> EXECUTING` using a unique execution key before calling Razorpay. Success records the payment-link reference, increments the contact counter, moves the case to `ACTION_PENDING`, and writes execution audit events. Provider failure/timeout becomes `FAILED` without automatic retry. Unsupported actions are blocked. See `docs/recovery-execution.md`.

## Increment 06 — Measurement

Added `GET /api/analytics/overview`, authenticated and scoped only by the merchant in the verified JWT. It derives metrics and breakdowns directly from persisted payments, cases, actions, and audit events. Recovery value is intentionally zero unless a recovered case has a positive amount, an executed provider-referenced action, and a Razorpay `RECOVERY_COMPLETED` audit event. The deterministic development seed creates useful non-recovered scenarios only. See `docs/analytics-and-measurement.md`.
