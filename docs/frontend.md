# RecoverAI merchant console

The React application in `frontend/` is the visual product layer for the existing backend pipeline. It does not duplicate recovery, policy, execution, or measurement logic.

## Run locally

Start the backend:

```powershell
npm install
npm run dev
```

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173/login`. The Vite development server proxies `/api` to `http://localhost:3000`. For a production bundle, run `npm run build` from `frontend/` and serve `frontend/dist` with a static host that routes requests to the backend API.

## Screens and routes

- `/login` authenticates through `POST /api/auth/login`.
- `/` is the Recovery Command Center, using `GET /api/analytics/overview`.
- `/payments` lists the merchant's payments using `GET /api/payments`.
- `/payments/:id` loads a payment and links it to a recovery case when the existing case list contains one.
- `/recovery-cases` lists cases using `GET /api/recovery-cases`.
- `/recovery-cases/:id` loads the populated case/payment record, audit events, and can invoke the existing recommendation endpoint.
- `/recovery-actions` lists the merchant's recovery actions using `GET /api/recovery-actions`, showing execution evidence, policy decisions, and provider references.
- `/audit` loads the merchant's audit events using `GET /api/audit-events` with case and event-type filters.
- `/recovery-batch` runs a bounded batch recovery operation using `POST /api/recovery-batch/run`, showing at-risk/pending/recovered breakdown.

## Authentication and security

The login response's token and user object are stored in browser local storage for this development console. The shared API client adds `Authorization: Bearer <token>` to protected requests. A `401` clears the session and returns the user to the login screen. Merchant identity is never sent as a frontend authorization parameter; the backend derives it from the verified session.

The frontend contains no Razorpay credentials, webhook secret, AI key, or JWT secret. All displayed financial values, statuses, recommendations, provider references, and audit events come from backend responses. A Payment Link creation is presented as execution evidence only, never as recovered revenue.

## Evaluator demo path

1. Seed development data with `DEMO_ADMIN_PASSWORD` and `node scripts/seedDemoData.js`.
2. Sign in with `demo@recoverai.test` and the password used for the seed.
3. Start at Overview to see revenue at risk, case eligibility, action counts, and the pipeline.
4. Open Payments, select a failed payment, then open its recovery case.
5. Inspect diagnosis, eligibility, retry/contact counters, audit events, and the policy-gated recommendation.
6. Use Audit Trail to filter the case's append-only event history.

The current seed deliberately contains no provider-confirmed recovered revenue. The UI keeps that value at the backend-derived amount instead of manufacturing a success story.

## Frontend structure

- `src/api.js`: one authenticated API client and session helpers.
- `src/App.jsx`: route shell and data-driven screens.
- `src/components.jsx`: shared brand, status, loading, metric, pipeline, chart, and evidence components.
- `src/styles.css`: responsive fintech console styling.