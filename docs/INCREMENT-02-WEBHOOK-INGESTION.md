# RecoverAI Increment 02 — Razorpay Webhook Ingestion

## 1. What we built

This increment receives Razorpay TEST MODE payment webhooks and records payment outcomes safely. It does not execute recovery actions, call an AI model, create metrics, or expose a frontend.

The flow is:

```text
Razorpay webhook
  -> raw request body retained
  -> HMAC signature verification
  -> provider event ID idempotency check
  -> payload validation and event-to-status mapping
  -> transactional Payment persistence
  -> RecoveryCase creation for a failed payment only
  -> append-only AuditEvent records
  -> successful acknowledgement
```

The endpoint is `POST /api/webhooks/razorpay`.

## 2. Why each component exists

- **Webhook:** Razorpay notifies the server about payment outcomes independently of the checkout browser flow.
- **Raw body:** An HMAC signature is calculated over the exact bytes Razorpay sent. Parsing and serialising JSON before verification can change those bytes and invalidate the signature.
- **HMAC signature:** `X-Razorpay-Signature` proves that a request was generated with knowledge of the configured webhook secret.
- **Event ID:** `x-razorpay-event-id` identifies one Razorpay delivery and is required for idempotency.
- **Idempotency:** Razorpay may retry a delivery. The same event must not create another Payment, RecoveryCase, AuditEvent, or future recovery action.
- **Unique database constraints:** Application checks can race; unique MongoDB indexes make duplicates impossible even under concurrent deliveries.
- **MongoDB transaction:** The event ledger, customer if needed, payment, recovery case, audit records, and processed marker either commit together or roll back together.
- **State machine:** Webhooks can arrive out of order. Explicit transitions stop a stale event from downgrading a captured payment.
- **Audit event:** A timeline of payment failure, case creation, capture, and case closure is retained for merchant review and future debugging.

## 3. Files and responsibilities

| File | Responsibility |
| --- | --- |
| `src/app.js` | Mounts the webhook route before the global JSON parser. |
| `src/routes/razorpayWebhookRoutes.js` | Applies `express.raw()` only to the Razorpay webhook route. |
| `src/controllers/razorpayWebhookController.js` | Performs HTTP-level verification, JSON parsing, and safe responses. |
| `src/services/razorpay/razorpayWebhookVerifier.js` | HMAC-SHA256 verification and constant-time comparison. |
| `src/services/webhookPayloadParser.js` | Validates required payment webhook fields and maps them into internal values. |
| `src/services/paymentStateMachine.js` | Defines supported Razorpay event types and valid status transitions. |
| `src/services/webhookIngestionService.js` | Orchestrates the transaction and business rules without HTTP concerns. |
| `src/services/mongoTransactionRunner.js` | Starts, commits, aborts, and closes MongoDB sessions. |
| `src/repositories/razorpayWebhookRepository.js` | Keeps Mongoose queries separate from ingestion business logic. |
| `src/models/WebhookEvent.js` | Durable Razorpay delivery ledger. |
| `src/models/Payment.js` | Provider payment identity, amount, status, and failure context. |
| `src/models/RecoveryCase.js` | One potential recovery opportunity per failed Payment. |
| `src/models/AuditEvent.js` | Append-only-style event timeline. |
| `tests/*.test.js` | Fixture-based security, idempotency, transition, and rollback verification. |

## 4. Database behavior

| Razorpay event | Payment | RecoveryCase | Audit events |
| --- | --- | --- | --- |
| `payment.failed` | Creates or moves a Payment to `FAILED`; stores provider failure code/description when provided. | Creates one `DETECTED` case if none exists. | `PAYMENT_FAILED`, `RECOVERY_CASE_CREATED`. |
| `payment.authorized` | Creates or moves a Payment to `AUTHORIZED`. | None. | `PAYMENT_AUTHORIZED`. |
| `payment.captured` | Creates or moves a Payment to `CAPTURED`. | None for a new captured payment. If a previous failed case exists, it is closed without executing recovery. | `PAYMENT_CAPTURED`; also `RECOVERY_CASE_CLOSED` when applicable. |

The supported transitions allow `FAILED -> CAPTURED`, because Razorpay documents that a failed event can later be followed by a captured event. A captured payment is never downgraded by a delayed failed or authorized webhook.

Database uniqueness guards:

- `WebhookEvent(provider, providerEventId)` is unique.
- `Payment.razorpayPaymentId` is unique.
- `RecoveryCase.payment` is unique.
- `AuditEvent(providerEventId, type)` is unique when a provider event ID is present.
- `Merchant.razorpayAccountId` is unique when configured.

## 5. Failure handling

- **Invalid signature:** The controller returns `401` before payload parsing or database access.
- **Malformed payload:** The parser returns a controlled `400` before a transaction starts, so no records are written.
- **Duplicate event:** The duplicate event ledger key triggers a duplicate-key error. The service re-reads the known provider event and returns a safe acknowledgement without duplicating business records.
- **Database operation failure:** The exception propagates to the error handler. The MongoDB transaction aborts, so the event, payment, case, and audit records are not partially committed.
- **Out-of-order events:** The state machine only permits known forward transitions. A capture after failure closes the case; stale events cannot move a captured Payment backwards.

## 6. Security decisions

`RAZORPAY_WEBHOOK_SECRET` is read from the environment and is not hard-coded. It is distinct from the Razorpay API key secret. The code never logs webhook secrets, API keys, authorization headers, raw request bodies, or stack traces to the client.

Signature verification happens before JSON parsing and before service invocation. This prevents unauthenticated requests from reaching persistence or recovery-related logic. The HMAC digests are compared with `crypto.timingSafeEqual` to avoid ordinary timing comparison behavior.

## 7. Testing

Commands executed during this verification:

```powershell
npm.cmd test
npm.cmd run check
```

Actual results:

- `npm.cmd test`: **11 tests passed, 0 failed, 0 skipped, 0 cancelled**.
- `npm.cmd run check`: completed successfully with **no syntax errors or warnings**.

The test suite covers:

- a valid `payment.failed` event creating Payment, RecoveryCase, and both required audit events;
- duplicate event acknowledgement without duplicate records;
- valid and invalid HMAC signatures, including HTTP rejection before ingestion;
- `payment.authorized` without a recovery case;
- `payment.captured` without a new recovery case;
- `payment.failed` followed by `payment.captured`, closing the existing case without recovery execution;
- malformed payload rejection with no state created;
- duplicate-key/idempotency conflict handling;
- rollback after an audit-write failure; and
- avoiding accidental suppression of unrelated duplicate-key errors.

The tests use fixtures and an in-memory transaction-capable repository. They do not require a Razorpay account or network connection. A real MongoDB replica-set test and a Razorpay Dashboard end-to-end check remain deployment verification tasks.

## 8. Razorpay limitations

### Supported now

- Receiving signed Razorpay TEST MODE `payment.failed`, `payment.authorized`, and `payment.captured` events.
- Recording payment state and a failed-payment recovery opportunity.
- Detecting duplicate Razorpay deliveries with `x-razorpay-event-id`.

### Not supported / not implemented

- Retrying a failed one-time payment through the generic Razorpay Payments API. That API can retrieve payments and capture an already-authorized payment; it does not provide a generic failed-payment retry operation.
- AI diagnosis or action recommendation.
- Payment Link creation, customer notification, payment-method update, recovery action execution, or recovered-revenue metrics.
- Production credentials or production webhook configuration.

### TEST MODE local delivery procedure

1. Start MongoDB as a single-node replica set; transactions do not work on standalone MongoDB.
2. Set `MONGODB_URI` and `RAZORPAY_WEBHOOK_SECRET` in `.env`.
3. Create/configure the corresponding merchant with the Razorpay Test account ID from webhook `account_id` as `razorpayAccountId`.
4. Run `npm.cmd run dev`.
5. Expose `http://localhost:3000` through a public HTTPS tunnel accepted by Razorpay. Razorpay documentation suggests zrok because some common tunnel domains can be blocked.
6. In the Razorpay Dashboard in **Test Mode**, configure `https://<public-host>/api/webhooks/razorpay`, enter the same webhook secret, and subscribe to the three supported payment events.
7. Complete a Razorpay Test Mode checkout with a success or failure path and inspect the database/audit records. Dashboard webhook setup in Test Mode uses OTP `754081` where prompted.

Razorpay references: [Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/) and [Payments Webhook Events](https://razorpay.com/docs/webhooks/payments/).

## 9. Interview concepts

**Concept:** Raw webhook body  
**Why we used it:** Razorpay signs raw bytes, not an application-created JSON representation.  
**Interview:** “We preserve the raw body so our HMAC calculation matches the exact payload Razorpay signed.”

**Concept:** HMAC webhook verification  
**Why we used it:** The endpoint is public and must reject untrusted callers.  
**Interview:** “We verify Razorpay’s HMAC signature with a server-only webhook secret before parsing or persisting the event.”

**Concept:** Idempotency  
**Why we used it:** Webhooks can be delivered more than once.  
**Interview:** “We use a durable provider event ID plus database uniqueness so duplicate webhook deliveries cannot create duplicate recovery records.”

**Concept:** Database uniqueness constraints  
**Why we used it:** Concurrent requests can bypass an application-only duplicate check.  
**Interview:** “The database is the final authority for deduplication because a unique index protects us even when duplicate webhooks arrive concurrently.”

**Concept:** MongoDB transaction  
**Why we used it:** Payment, case, ledger, and audit data form one business outcome.  
**Interview:** “The transaction prevents a failed payment from being marked recoverable unless its corresponding audit trail and idempotency record also commit.”

**Concept:** Explicit state machine  
**Why we used it:** Razorpay events may be delayed or arrive out of order.  
**Interview:** “Explicit transitions ensure a stale failed event cannot overwrite a later captured payment state.”

**Concept:** Audit trail  
**Why we used it:** A future merchant needs traceability for every recovery decision.  
**Interview:** “We store immutable-style audit events so the system can explain how a failed payment became a recovery case or why that case was later closed.”

**Concept:** Provider boundary  
**Why we used it:** Razorpay-specific parsing and persistence details should not leak into the rest of the product.  
**Interview:** “The controller only handles HTTP; a dedicated service and repository isolate Razorpay webhook behavior from application business logic.”

## 10. Next increment

Add authenticated, merchant-scoped read APIs for Payments, RecoveryCases, and AuditEvents so a merchant admin can inspect the safely-ingested data before any AI recommendation or recovery execution is introduced.
