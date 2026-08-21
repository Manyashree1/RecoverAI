# Bounded recovery execution

`POST /api/recovery-actions/:id/execute` completes RecoverAI's ACT stage without giving the AI payment authority. It requires a merchant-admin JWT and always scopes the action to that merchant.

## What executes

Only a `CUSTOMER_REMINDER` action that is already `POLICY_ALLOWED` can execute. RecoverAI calls Razorpay TEST MODE `POST /v1/payment_links` to create a **Standard Payment Link** with a unique reference ID. This is a new payment opportunity, not a retry of the original Razorpay payment and not evidence of recovered revenue.

`RETRY_PAYMENT`, `PAYMENT_METHOD_UPDATE`, `ESCALATE_TO_HUMAN`, and `NO_ACTION` are deliberately blocked by the executor. The generic Payments API cannot retry a failed one-time payment.

## Lifecycle

```text
POLICY_ALLOWED -> atomic reservation (EXECUTING + execution idempotency key)
  -> Razorpay TEST payment-link request
  -> EXECUTED + ACTION_PENDING case
     OR FAILED
```

The service emits `ACTION_EXECUTION_STARTED`, `ACTION_EXECUTION_BLOCKED`, `ACTION_EXECUTION_COMPLETED`, or `ACTION_EXECUTION_FAILED`. A re-request after `EXECUTED`/`FAILED` returns the stored action; a concurrent request sees `IN_PROGRESS` and never calls Razorpay again.

## Guardrails and idempotency

The backend reloads the action, case, payment, customer, and current merchant policy. It blocks when policy is no longer valid, payment is captured, case is closed/recovered, limits are reached, the action is unsupported, or contact information is absent. The database atomically reserves `POLICY_ALLOWED -> EXECUTING` only when no execution key exists; a unique sparse index on `execution.idempotencyKey` protects concurrent requests. The deterministic key is also passed as Razorpay's unique `reference_id`.

The provider call is deliberately outside the transaction; holding a transaction over a network call risks expiry. The reservation commits first, then completion/failure is finalized transactionally. A timeout remains `FAILED` and is not automatically retried because Razorpay might have received the request.

Creating a link increments `customerContactAttempts`, marks the case `ACTION_PENDING`, and stores the provider link ID. It does **not** change the original Payment from `FAILED`, set `recoveredAmount`, or claim recovered revenue. A future provider-confirmed event is required.

## Run

Set `MONGODB_URI`, `JWT_SECRET`, `RAZORPAY_KEY_ID` (must start `rzp_test_`), and `RAZORPAY_KEY_SECRET`. MongoDB must be a replica set. Run `npm.cmd test` and `npm.cmd run check`; tests use a fake provider and never call Razorpay.
