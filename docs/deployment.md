# RecoverAI — Deployment runbook (hackathon/demo)

Simplest reliable setup: **Netlify (static frontend) + Render (Node backend) + existing MongoDB Atlas + Razorpay TEST MODE**. No Docker/K8s/CI/CD. All secret values live in the hosting dashboards only — never in Git.

## Environment variables (names only — values go in host dashboards)

### Backend (Render web service)
| Variable | Notes |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Existing MongoDB Atlas connection string |
| `RAZORPAY_KEY_ID` | Existing TEST key |
| `RAZORPAY_KEY_SECRET` | Existing TEST secret |
| `RAZORPAY_WEBHOOK_SECRET` | Same value configured in the Razorpay webhook UI |
| `JWT_SECRET` | Fresh long random string (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
| `JWT_EXPIRES_IN` | e.g. `12h` |
| `CORS_ORIGIN` | The deployed frontend URL, e.g. `https://<site>.netlify.app` |
| `RAZORPAY_ACCOUNT_ID` | Optional; non-secret account id from webhook payloads |

Optional AI stage (`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`) — omit for the demo and the deterministic fallback runs automatically.

### Frontend (Netlify build settings)
| Variable | Value |
| --- | --- |
| `VITE_API_BASE_URL` | `https://<your-render-app>.onrender.com` (no trailing slash) |

Build command: `npm run build` · Publish directory: `dist`

## Steps

1. **Push this repository to GitHub** (already at `github.com/Manyashree1/RecoverAI`). Confirm `.env` is gitignored.
2. **Render → New → Web Service**, connect the repo:
   - Build command: `npm install`
   - Start command: `npm start`
   - Add every backend variable above. Note Atlas must allow Render's IPs (use `0.0.0.0/0` in Atlas Network Access for a hackathon).
3. **Verify backend**: open `https://<render-app>.onrender.com/api/health` until it responds. (Free tier sleeps after ~15 min idle; hit it before the demo, or attach a free uptime pinger.)
4. **Netlify → Add new site**, connect the repo with base directory `frontend`, or deploy `frontend/dist` manually after building locally with `VITE_API_BASE_URL` set.
5. **Set frontend env var** `VITE_API_BASE_URL` to the Render URL **before building**, then redeploy so it is baked into the bundle.
6. **Smoke test from the browser**: login → Recovery Cases → open any case → Audit Trail. Check DevTools console has no CORS errors.
7. **Only then configure Razorpay**: Dashboard → Settings → Webhooks → add
   `https://<render-app>.onrender.com/api/webhooks/razorpay`
   with event(s) `payment_link.paid` (plus `payment.captured`/`payment.failed` if used), using the same `RAZORPAY_WEBHOOK_SECRET`. Keep the account in **TEST MODE**.
8. Do not create payment links or payments during validation; the demo seed starts with ₹0 recovered revenue.

## Local behavior is unchanged
With no `CORS_ORIGIN` and no `VITE_API_BASE_URL`, both additions are inert: the Vite proxy keeps serving `/api` same-origin exactly as before.
