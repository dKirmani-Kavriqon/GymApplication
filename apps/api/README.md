# GymVerse API

Runs on **Cloudflare Workers** in production: the Worker (`src/worker.ts`) forwards every request to
one Durable Object whose built-in SQLite holds all gyms. The same app also runs on Node 24 with
`node:sqlite` for local development and tests. The contract lives in `docs/API*.md` and
`packages/shared`.

| File | Role |
|---|---|
| `src/core.ts` | Builds the app on any `Db` (routes, hooks, error handling). Runtime-neutral |
| `src/http.ts`, `src/log.ts` | Small Fastify-style framework on standard Request/Response, pino-style JSON logs |
| `src/db.ts` | Database interface, migrations runner, `tx()` |
| `src/db-durable.ts` / `src/db-node.ts` | Durable Object SQLite driver / node:sqlite driver |
| `src/worker.ts` | Cloudflare entry: Worker, `GymVerseApi` Durable Object, cron, `/__ops` restore |
| `src/server.ts`, `src/app.ts` | Node entry (local dev, tests, self-hosting) |

```sh
npm run dev:worker -w @gymverse/api     # the real Cloudflare runtime locally (staging settings, demo gym), http://127.0.0.1:4200
npm run dev -w @gymverse/api            # Node, http://localhost:4000, dev OTPs returned in responses
npm run seed -w @gymverse/api           # demo gym FLEX42 (safe to re-run)
npm test -w @gymverse/api
npm run test:coverage -w @gymverse/api  # fails under 80% lines/functions, 70% branches
npm run typecheck -w @gymverse/api
npm run test:worker -w @gymverse/api    # driver checks in a Durable Object + smoke test on workerd
npm run smoke -w @gymverse/api -- <url> # end-to-end checks against a running staging API
```

Both database drivers pass the same checks (`test/driver-conformance.ts`): transactions and
nested rollback, changed-row counts, foreign keys, migrations and the demo seed.

## Environment

All settings are read once by `src/config.ts`. On Cloudflare they are Worker **vars** (in
`wrangler.jsonc`) and **secrets** (`npx wrangler secret put NAME`); on Node, environment variables.
In `NODE_ENV=production` the API refuses to start (every problem listed: Node exits 1, the Worker
answers 503 and logs the list) when something required is missing or unsafe. Secret values are
never logged.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` / `HOST` / `DB_PATH` | `4000` / `0.0.0.0` / `gymverse.db` | Node only. On Cloudflare the database is the Durable Object's |
| `LOG_LEVEL` | `info` | JSON logs (Workers Logs on Cloudflare); tokens, codes, signatures redacted, phones masked |
| `TOKEN_SECRET` | dev value | **Production: required, 32+ characters.** Signs login and checkout tokens |
| `CORS_ORIGINS` | any | **Production: required, comma-separated, not `*`** |
| `TRUST_PROXY` | `false` | Node behind a proxy only. On Cloudflare the client IP comes from `CF-Connecting-IP` |
| `PUBLIC_API_URL` | `http://localhost:<PORT>` | Base of hosted checkout links. **Production with razorpay: required, https** |
| `PLATFORM_ADMIN_PHONES` | none | E.164 numbers allowed into `/admin` |
| `EXPOSE_DEV_OTP` | on in dev | Never on in production |
| `JOBS_ENABLED` | `true` | Class/expiry reminders and OTP pruning every 5 minutes |
| `SMS_PROVIDER` | `log` | `msg91` (`MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`) or `twilio` (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`) |
| `PAYMENTS_PROVIDER` | `mock` | `razorpay` needs `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| `EXPO_ACCESS_TOKEN` | none | Optional, for Expo push |
| `ALLOW_INSECURE_PROVIDERS` | `false` | Lets production run with `log`/`mock` providers. CI smoke test only |
| `DEMO_SEED` | `false` | Seeds the FLEX42 demo gym into an empty database. Staging only; refused in production |
| `OPS_TOKEN` | none | Secret, 32+ characters. Turns on `/__ops` (point-in-time restore) on Cloudflare |
| `LOCATION_HINT` | `apac` | Cloudflare only: where the database object is first created (it stays there) |

## Hosted checkout (no native payment SDK)

1. The app calls `POST /gyms/:gymId/payments/orders` (optional `couponCode`). The response
   includes `checkoutUrl` = `<PUBLIC_API_URL>/pay/<paymentId>?t=<token>`. The token is HMAC-signed
   with `TOKEN_SECRET`, bound to that payment and user, and valid for 30 minutes. ₹0 orders come
   back already `paid` with no `checkoutUrl`.
2. The app opens `checkoutUrl` in the browser. `GET /pay/:paymentId?t=` serves a small page
   (gym, plan, amount) with a strict per-response CSP (script nonce; only `checkout.razorpay.com`
   and `api.razorpay.com` allowed) and `Cache-Control: no-store`.
   - **razorpay**: "Pay with Razorpay" opens Razorpay Checkout (key, order id, amount, gym name,
     phone prefill).
   - **mock** (development): "Pay (test)" completes with the mock signature; no money moves.
   - Bad or foreign link: 403 page. Expired link: 410 page. Already paid: a page with a
     "Return to the app" link.
3. On success the page posts `{t, razorpay_payment_id, razorpay_order_id, razorpay_signature}` to
   `POST /pay/:paymentId/complete`, which checks the token and the signature exactly like
   `/payments/:id/verify` and returns `PaymentResult`. It is idempotent: the Razorpay webhook
   (`POST /webhooks/razorpay`) may have completed the payment already; the membership is extended once.
4. The page then redirects to `gymverse://payment/<paymentId>?status=paid`. Dismissing or a failed
   payment redirects with `status=cancelled`. If the confirmation call itself fails (network), it
   redirects with `status=pending`; the webhook will still complete a captured payment.
5. Back in the app, `GET /gyms/:gymId/payments/:paymentId` (the member's own payments only) returns
   the `PaymentRecord` plus `membershipEndsAt` to show the result.

Checkout tokens are stripped from request logs (`?t=[redacted]`).
