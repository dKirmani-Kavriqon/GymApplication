# Going to production (Cloudflare)

This is the runbook for launching GymVerse on Cloudflare: the API as a Worker with its database in
a Durable Object, the owner dashboard as static assets, and the iOS and Android apps built with
EAS. There is no server to run, patch or back up. Read it top to bottom once; after that the
checklist at the end is enough.

## 1. Architecture

```
 Phones (Expo app) ─┐
                    ├─HTTPS─▶ api.example.com ── Worker (gymverse-api)
 Browser ───────────┘                                │  adds client IP, /__ops
   │                                                 ▼
   │                                  Durable Object "GymVerseApi" (one, in APAC)
   │                                  ├─ the whole API (routes, auth, tenant guard)
   │                                  └─ built-in SQLite: every gym, 30-day point-in-time recovery
   │                         Cron every 5 min ──▶ reminders, OTP pruning, push (Expo)
   └──────▶ app.example.com ── gymverse-dashboard (static assets, security headers, SPA)
```

- **Tenant isolation** is enforced in the API: every gym-scoped route goes through one guard
  (`gymAccess`) and every query filters by `gym_id`. Non-members get 404, not 403, so gym ids can't
  be probed. The tenant-isolation test suite attacks every route from another gym.
- **Why one Durable Object:** it is SQLite with synchronous queries and real transactions, so the
  API code is the same one the tests run on Node. One object means one writer: rate limits and
  transactions behave exactly as on a single server, with no database to operate. It comfortably
  covers the launch targets (hundreds of gyms; a request is a few milliseconds of SQLite).
  Limits to know: 10 GB of data per object, and all writes go through it.
  **When to change:** past a few thousand active gyms or 10 GB, split into one Durable Object per
  gym (the schema already keys everything by `gym_id`) with a small directory object for logins.
- **Logs:** JSON lines in Workers Logs (dashboard → Workers → gymverse-api → Logs), with a
  request id on every line. Tokens, codes and signatures are redacted; phone numbers are masked.

## 2. Accounts you need

| Service | What for | Notes |
|---|---|---|
| Cloudflare | API, database, dashboard, DNS | **Workers Paid plan** ($5/month) for production: higher limits, and point-in-time recovery for the database |
| A domain | `api.` and `app.` hostnames | Add the domain to Cloudflare (DNS on Cloudflare) |
| Razorpay | Membership payments | Live keys + a webhook to `https://api.example.com/webhooks/razorpay` for `payment.captured` and `order.paid`. The app pays through a hosted checkout page served by the API at `/pay/<id>` (UPI, cards, netbanking), so no native SDK is needed |
| MSG91 or Twilio | Login codes by SMS | MSG91 needs a DLT-approved template in India. **Start this first: approval can take days** |
| Expo / EAS | App builds, push notifications | `npm i -g eas-cli`, `eas login` |
| Apple Developer + Google Play Console | Store listings | |
| GitHub | Code, CI, deploys | Optional but recommended (section 5) |

## 3. First deploy (from your computer)

Log in once:

```bash
npx wrangler login
```

### 3a. Staging first (demo data, test payments)

Staging is a separate Worker and database with the FLEX42 demo gym, test payments and login codes
shown on screen. Use it to try a deploy end to end before anything real.

```bash
cd apps/api
```

```bash
npx wrangler secret put TOKEN_SECRET --env staging
```

Paste a random value of 32+ characters (for example from `openssl rand -base64 48`). Then deploy:

```bash
npm run deploy:staging
```

Wrangler prints the URL, like `https://gymverse-api-staging.<you>.workers.dev`. Set it as the
public URL (hosted checkout links use it) and deploy again:

```bash
npx wrangler deploy --env staging --var PUBLIC_API_URL:https://gymverse-api-staging.<you>.workers.dev
```

Check it end to end (15 checks: login, check-in, workout, coupon payment, tenant guard, admin):

```bash
npm run smoke -- https://gymverse-api-staging.<you>.workers.dev
```

Dashboard and member web app on staging (from the repo root, with your staging API URL):

```bash
cd apps/dashboard && VITE_API_URL=https://gymverse-api-staging.<you>.workers.dev npm run build:cloudflare && npm run deploy:staging
```

```bash
cd apps/mobile && EXPO_PUBLIC_API_URL=https://gymverse-api-staging.<you>.workers.dev npm run build:cloudflare && npm run deploy:staging
```

Log in with `9999900002` (member) or `9999900001` (owner and platform admin). The code is shown on
screen in staging.

### 3b. Production

1. **Set your hostnames.** In `apps/api/wrangler.jsonc` set `PUBLIC_API_URL`, `CORS_ORIGINS` and
   `PLATFORM_ADMIN_PHONES`, and uncomment `routes` with your API hostname. In
   `apps/dashboard/wrangler.jsonc` uncomment `routes` with your dashboard hostname. Cloudflare
   creates the DNS records and certificates.
2. **Set the secrets** (each command asks for the value; nothing is stored in the repo):

```bash
cd apps/api
```

```bash
npx wrangler secret put TOKEN_SECRET --env=""
```

```bash
npx wrangler secret put MSG91_AUTH_KEY --env=""
```

```bash
npx wrangler secret put MSG91_TEMPLATE_ID --env=""
```

```bash
npx wrangler secret put RAZORPAY_KEY_ID --env=""
```

```bash
npx wrangler secret put RAZORPAY_KEY_SECRET --env=""
```

```bash
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET --env=""
```

```bash
npx wrangler secret put OPS_TOKEN --env=""
```

   `EXPO_ACCESS_TOKEN` is optional (Expo push security). Using Twilio instead of MSG91: set
   `SMS_PROVIDER` to `twilio` in `wrangler.jsonc` and put `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
   and `TWILIO_FROM` instead.

3. **Deploy:**

```bash
npm run deploy
```

```bash
curl https://api.example.com/health/ready
```

   The API **refuses to start** in production if `TOKEN_SECRET` is short or missing, `CORS_ORIGINS`
   is missing or `*`, SMS/payments are on the development providers, or `DEMO_SEED` is on. It then
   answers 503 and the Worker logs list exactly which setting is wrong (Workers → gymverse-api →
   Logs, search "not started").

4. **Dashboard:**

```bash
cd apps/dashboard && VITE_API_URL=https://api.example.com npm run build:cloudflare && npm run deploy
```

**Create the first gym:** open `https://app.example.com`, log in with your phone number, and the
dashboard walks you through creating the gym (name, branding, plans, then the join QR poster).
Numbers listed in `PLATFORM_ADMIN_PHONES` also see the Admin console (all gyms, suspend, plan tier).

## 4. Updating

Deploy again (section 3, or let CI do it, section 5). Cloudflare switches to the new version
without dropping requests. Database migrations run automatically when the object starts with new
code; they only ever add. The database object keeps its data across deploys.

Never change `DATABASE_OBJECT` in `src/worker.ts` or the Durable Object `migrations` tags in
`wrangler.jsonc` once you have real data: both would point the API at a new, empty database.

## 5. Deploying from GitHub (recommended)

`.github/workflows/ci.yml` tests every push and pull request: type checks, all test suites with
coverage gates, the API on the real Cloudflare runtime (`npm run test:worker`), builds and a
dependency audit.

- **Staging** deploys automatically on every push to `main`, then runs the smoke test against it.
- **Production** deploys only when you run the workflow by hand (Actions → CI → Run workflow →
  target `production`), from `main`, after the required reviewers approve.

Set up once in the GitHub repository settings:

| Where | Name | Value |
|---|---|---|
| Secrets | `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with "Edit Cloudflare Workers" |
| Secrets | `CLOUDFLARE_ACCOUNT_ID` | From the Cloudflare dashboard sidebar |
| Variables | `STAGING_API_URL` | `https://gymverse-api-staging.<you>.workers.dev` |
| Variables | `PRODUCTION_API_URL` | `https://api.example.com` |
| Environments | `production` | Add yourself as a required reviewer |

Worker secrets (section 3b) stay in Cloudflare; CI never sees them.

## 6. Backups and restore

Cloudflare keeps every change to the database for **30 days** (point-in-time recovery, Workers
Paid). Restoring rolls the **whole** database (all gyms) back to a moment; anything written after
it is lost, so restore only to undo real damage (a bad migration, a mistaken bulk delete).

The restore endpoints are off unless `OPS_TOKEN` is set. With it:

```bash
curl -X POST https://api.example.com/__ops/restore -H "authorization: Bearer $OPS_TOKEN" -H "content-type: application/json" -d '{"at":"2026-11-08T10:00:00Z"}'
```

The database restarts at that point within a few seconds. The response includes an `undo`
bookmark. Keep it: posting `{"bookmark":"<undo>"}` to the same endpoint reverses the restore.

- **Test it on staging** before you need it in production: write something, restore to a minute
  earlier, check it is gone, then undo.
- Not built yet: a scheduled full export to R2 as a second copy outside the database's own
  history. Members can already download their own data (`GET /me/export`).

## 7. Mobile apps

1. Set your real API URL in `apps/mobile/eas.json` (`production` → `EXPO_PUBLIC_API_URL`, and
   `preview` → your staging URL) and the App Store Connect app id under `submit`.
2. `cd apps/mobile && eas init` (links the project and adds the `projectId` that push tokens need).
3. Build and submit:

```bash
eas build --platform all --profile production
```

```bash
eas submit --platform all --profile production
```

4. Store review notes: membership fees are payments for a **physical service** (gym access), so
   Razorpay is allowed instead of in-app purchase (App Store guideline 3.1.3(e), Play policy for
   physical goods/services). Mention this in the review notes. Account deletion is in
   Settings → Your data (required by both stores).
5. Icons and splash are generated by `node scripts/make-icons.mjs` (Burgundy & Beige mark).

Gym QR posters encode `gymverse://join/CODE` (join) and `gymverse://checkin/TOKEN` (door
check-in). For the join link to work when the app isn't installed, host
`https://gymverse.app/join/*` as a page that redirects to the stores (universal links are a
later improvement).

## 8. Security checklist (ECC rules applied)

- [x] No secrets in the repo; Worker secrets live in Cloudflare; required secrets are validated at
      startup (the API answers 503 rather than run unsafely).
- [x] All inputs validated with zod schemas at the API boundary (shared with the apps).
- [x] Parameterised SQL everywhere (`db.prepare(...).run(?)`), no string-built queries with user input.
- [x] Rate limiting on every route (stricter on login codes and check-ins); OTP attempts and
      requests are capped per phone. One database object means the limits are exact.
- [x] Bearer tokens (no cookies), so CSRF doesn't apply; CORS limited to the dashboard origin.
- [x] Security headers on API responses and on the dashboard (`_headers`: HSTS, CSP with the API
      origin only, frame denial, nosniff).
- [x] Errors never include stack traces or SQL; logs redact tokens, codes and phone numbers.
- [x] Payment signatures and webhooks verified with HMAC and timing-safe comparison.
- [x] Ops endpoints off by default; bearer token compared in constant time.
- [x] Tenant isolation tested on every route.
- [x] Data protection (India DPDP Act): consent recorded with terms version, guardian consent for
      under-18s, data export and account deletion in the app.
- [ ] Before launch: rotate any keys that were ever pasted into chat or tickets.
- [ ] Before launch: run `npm audit --omit=dev` and a final `/security-review`.
- [ ] Optional: Cloudflare WAF rate-limiting rule on `/auth/*` as a second layer.

## 9. Monitoring

- Uptime monitor (UptimeRobot, Better Stack) on `GET https://api.example.com/health/ready`;
  alert on two failures in a row.
- Workers Logs: filter by `reqId` to follow one request; search `"level":50` for errors.
- Cloudflare notifications: turn on Workers error-rate alerts for `gymverse-api`.
- Not built yet: error tracking (Sentry). Add before scaling past the pilot.

## 10. Launch checklist

- [ ] Staging deployed; `npm run smoke -- <staging url>` passes; restore tested on staging.
- [ ] Domain on Cloudflare; `routes` set for `api.` and `app.`; HTTPS works on both.
- [ ] Production secrets set; `npm run deploy`; `/health/ready` is 200.
- [ ] `PUBLIC_API_URL` and `CORS_ORIGINS` point at your real hostnames.
- [ ] Razorpay live keys; webhook shows "active"; a ₹1 test plan paid end to end from a real phone, then deleted.
- [ ] SMS: a real login code arrives on an Indian number (MSG91 DLT template approved).
- [ ] Push: `eas init` done; a test announcement reaches a real phone.
- [ ] Terms and privacy pages live at the URLs in `apps/mobile/src/screens/onboarding/ConsentScreen.tsx`.
- [ ] App builds approved in TestFlight / Play internal testing by 2–3 real members.
- [ ] Pilot gym: owner onboarded, members imported from Excel, QR posters printed (join + door).
- [ ] Uptime monitor and error alerts set up.

## Appendix: self-hosting instead

`deploy/` still has a Docker setup (API on Node with `node:sqlite`, Caddy for HTTPS, Litestream
backups to S3/R2) built and smoke-tested in CI. It uses `.env.example`. Use it only if you need to
run outside Cloudflare; data does not move between the two automatically.
