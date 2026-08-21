# Analytics and measurement

`GET /api/analytics/overview` is authenticated and merchant-scoped. Its values are calculated on request from persisted Payment, RecoveryCase, RecoveryAction, and AuditEvent records; there are no hard-coded totals.

- **Revenue at risk:** sum of FAILED Payments with an open recovery case.
- **Eligible recovery cases:** those same open cases.
- **Recovery attempts:** actions in `EXECUTING`, `EXECUTED`, or `FAILED`.
- **Successful recoveries / recovered revenue:** only `RECOVERED` cases with a positive `recoveredAmount`, an executed action with a provider reference, and a Razorpay-authored `RECOVERY_COMPLETED` audit event.
- **Recovery rate:** successful recoveries / eligible cases; zero when there are none.
- **Recovery value rate:** recovered revenue / revenue at risk; zero when at risk is zero.
- **Blocked actions:** `POLICY_BLOCKED` or `BLOCKED` actions.
- **Failed executions:** `FAILED` actions.
- **AI fallbacks:** `AI_FALLBACK_USED` audit events.

Payment Link creation, AI recommendations, policy approval, and execution completion do **not** mean money was recovered. Counting them would mislead a merchant. The endpoint also returns action, failure-category, and recovery-status breakdowns for a future React dashboard.

## Development demo seed

Run `set DEMO_ADMIN_PASSWORD=<strong local password>` then `node scripts/seedDemoData.js`. It is disabled in production, hashes the password through the existing auth service, and uses stable ids/upserts. It creates temporary, policy-blocked, retry-limit, fallback-labelled, and provider-failure scenarios. It deliberately seeds **no recovered revenue** because current code does not ingest a provider-confirmed Payment Link payment outcome.

Call the endpoint with `Authorization: Bearer <merchant JWT>`:

```text
GET /api/analytics/overview
```

The next increment can use this response directly in React, then add linked provider-outcome ingestion to make genuine recovery measurement possible.
