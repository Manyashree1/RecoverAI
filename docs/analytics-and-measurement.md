# Analytics and measurement

`GET /api/analytics/overview` is authenticated and merchant-scoped. Its values are calculated on request from persisted Payment, RecoveryCase, RecoveryAction, and AuditEvent records; there are no hard-coded totals.

- **Revenue at risk:** sum of FAILED Payments with an open recovery case.
- **Eligible recovery cases:** those same open cases.
- **Recovery attempts:** actions in `EXECUTING`, `EXECUTED`, or `FAILED`.
- **Successful recoveries / recovered revenue:** only `RECOVERED` cases with a positive `recoveredAmount`, an executed action with a provider reference, and a Razorpay-authored `RECOVERY_COMPLETED` audit event.
- **Recovery rate:** provider-confirmed recovered opportunities / total recovery opportunities (cases with a failed payment). This denominator never shrinks after recovery, so the rate stays between 0% and 100%.
- **Recovery value rate:** recovered revenue / total recovery opportunity value. Uses the same historical opportunity denominator, not current revenue at risk.
- **Blocked actions:** `POLICY_BLOCKED` or `BLOCKED` actions.
- **Failed executions:** `FAILED` actions.
- **AI fallbacks:** `AI_FALLBACK_USED` audit events.

Payment Link creation, AI recommendations, policy approval, and execution completion do **not** mean money was recovered. Counting them would mislead a merchant. The endpoint also returns action, failure-category, and recovery-status breakdowns for a future React dashboard.

## Development demo seed

Run `set DEMO_ADMIN_PASSWORD=<strong local password>` then `node scripts/seedDemoData.js`. It is disabled in production, hashes the password through the existing auth service, and uses stable ids/upserts. It also configures only the RecoverAI Demo Merchant with a reminder-only policy and a `0.6` minimum confidence, preserving the deterministic confidence check. It creates temporary, policy-blocked, retry-limit, fallback-labelled, and provider-failure scenarios. It deliberately seeds **no recovered revenue**; a verified provider-confirmed Payment Link payment outcome is still required.

Call the endpoint with `Authorization: Bearer <merchant JWT>`:

```text
GET /api/analytics/overview
```

The React dashboard can use this response directly. Genuine recovered revenue becomes nonzero only after a verified `payment_link.paid` event is correlated to an executed RecoverAI Payment Link action.
