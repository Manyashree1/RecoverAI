# RecoverAI Architecture

One diagram, kept current as increments land. Every stage after the AI box is deterministic, application-owned, and independently testable — the AI stage is advisory only.

```text
 Razorpay (TEST MODE)
        │  signed webhook
        ▼
 ┌─────────────────┐
 │ Webhook ingest   │  HMAC verify, idempotency, state machine
 └────────┬─────────┘
          ▼
 ┌─────────────────┐
 │ Payment          │  persisted status + failure context
 └────────┬─────────┘
          ▼
 ┌─────────────────┐
 │ RecoveryCase     │  one per failed Payment
 └────────┬─────────┘
          ▼
 ┌───────────────────────────────────────────┐
 │ AI Recommendation  ⚠ NON-AUTHORITATIVE     │
 │                                             │
 │  case context → AI provider ──fails/invalid──┐
 │       │ valid                                │
 │       ▼                                      ▼
 │  structured recommendation      deterministic fallback
 │  {action, confidence,           (same structured shape,
 │   diagnosis, reason,             provider: "deterministic-fallback")
 │   factors, requiresHumanReview}
 └───────────────────┬─────────────────────────┘
                      │  recommendation only — cannot move money,
                      │  cannot mark anything executed
                      ▼
 ┌─────────────────────────────┐
 │ Deterministic Policy Engine  │  ALLOW / BLOCK
 │ (policyEngine.js, unchanged) │  retry limits, amount caps, allowed
 └────────────┬─────────────────┘  actions, confidence floor
              ▼
 ┌─────────────────┐
 │ RecoveryAction   │  policy is revalidated immediately before execution
 └────────┬─────────┘
          ▼
 ┌─────────────────┐
 │ Bounded ACT      │  CUSTOMER_REMINDER only: Razorpay TEST Standard
 │                 │  Payment Link, atomically reserved and idempotent
 └────────┬─────────┘
          ▼
 ┌─────────────────┐
 │ MEASURE          │  merchant-scoped persisted-state analytics; no fake revenue
 └────────┬─────────┘
          ▼
 ┌─────────────────┐
 │ AuditEvent trail │  ... → ACTION_EXECUTION_STARTED → COMPLETED | FAILED | BLOCKED
 └─────────────────┘
```

## Why the AI box is marked non-authoritative

The AI provider (or its deterministic fallback) only ever produces a `{action, confidence, diagnosis, reason, factors, requiresHumanReview}` value. It has no code path to Razorpay, no code path to mark a `RecoveryAction` executed, and its raw output is never trusted directly — every field is validated and copied into a new object (`recommendationSchema.validateAiRecommendation`) before anything downstream sees it. The **policy engine is the only authorization boundary**, and it existed before the AI stage was added; the AI stage sits entirely upstream of it and could be removed without changing what the policy engine or execution layer (once built) does.

## Component ownership

| Layer | Owns | Cannot do |
| --- | --- | --- |
| AI provider / fallback | Classifying the failure, recommending one action, explaining why | Read/write the database, call Razorpay, see secrets |
| `recommendationSchema` | Rejecting malformed/unsafe AI output | Cannot be bypassed — the orchestrator never uses unvalidated output |
| `policyEngine` (unchanged since Increment 03) | ALLOW/BLOCK against merchant-defined limits | Cannot be influenced by AI confidence alone; every numeric limit is a separate, explicit check |
| Execution service | Revalidating policy, atomically reserving an allowed action, and calling the TEST payment-link adapter | Cannot retry the original payment, mark revenue recovered, or execute unsupported actions |

## Measurement ownership

`AnalyticsService` is the single owner of business metric calculations. `AnalyticsRepository` loads only the authenticated merchant's Payment, RecoveryCase, RecoveryAction, and AuditEvent records; the controller never accepts a merchant ID from the request. Revenue at risk is the value of failed payments with open cases. Recovered revenue requires a positive case amount, an executed provider-referenced action, and a Razorpay-authored `RECOVERY_COMPLETED` event. A created Payment Link, recommendation, policy decision, or successful link-creation response is not recovery evidence.

The `GET /api/analytics/overview` response also includes counts by existing recovery action, failure category, and recovery status so a future dashboard can visualize performance without duplicating financial logic in the frontend.

## Batch recovery

`BatchRecoveryService` orchestrates bounded, merchant-scoped batch processing of recovery opportunities. It reuses the existing recommendation service, policy engine, stopping rules, and execution service — it contains no duplicate domain logic.

Key properties:
- **Bounded**: hard maximum of 50 cases per batch (configurable lower)
- **Merchant scoped**: only processes the authenticated merchant's cases
- **Manual trigger**: opening the batch screen does nothing; the user must explicitly run it
- **Never fabricates recovery**: batch results clearly separate at-risk / pending / recovered
- **Idempotent per case**: reuses existing idempotency keys from the recommendation service

See `README.md` for setup and API details.
