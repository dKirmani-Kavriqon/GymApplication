# GymVerse API v0.3 — production readiness + remaining PRD features

Builds on [API.md](API.md) and [API-v0.2.md](API-v0.2.md). New types and schemas:
`packages/shared/src/ops.ts` (plus optional fields in `types.ts`: `MeResponse.consent`,
`MeResponse.isPlatformAdmin`, `Gym.suspended`, `MemberSummary.crowd`). Same conventions as
before (404 for other tenants, 403 for wrong role, 403 `feature_disabled`).

## 1. Production hardening (no route changes unless listed)
- **Config** (`src/config.ts`): parse `process.env` with zod at startup. In `NODE_ENV=production`
  refuse to start (clear message, exit 1) when `TOKEN_SECRET` is missing or shorter than 32
  characters, `CORS_ORIGINS` is missing or `*`, or `SMS_PROVIDER=log` / `PAYMENTS_PROVIDER=mock`
  (unless `ALLOW_INSECURE_PROVIDERS=true`, used only by the CI smoke test). Never log secret values.
- **SQLite**: `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL`, `foreign_keys=ON`.
  Numbered migrations recorded in `PRAGMA user_version`; existing files migrate forward.
- **Health**: `GET /health/live` → `{ok:true}` (process up); `GET /health/ready` → 200 when a
  `SELECT 1` succeeds, else 503. Keep `GET /health`.
- **Security headers** on every response: `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site`,
  `Cache-Control: no-store` on authenticated responses. No `x-powered-by`.
- **Rate limits** (in-memory, per client IP; `TRUST_PROXY=true` uses `X-Forwarded-For`):
  global 300 req/min; `/auth/*` 10 req/min; check-ins 30/min per user. 429 body
  `{error:'rate_limited', message, retryAfterSec}` + `Retry-After` header.
- **Limits**: JSON body max 256 KB (`/members/import` 2 MB); request timeout 15 s.
- **Logging**: pino JSON with request id (`x-request-id` echoed back), redact `authorization`,
  `code`, `devCode`, `token`, `signature`, phone numbers masked to last 4 digits.
- **Errors**: 5xx responses never include stack traces or SQL; they're logged with request id.
- **Graceful shutdown** on SIGTERM/SIGINT: stop accepting, finish in-flight (max 10 s), close DB.
- **Jobs** (`src/jobs.ts`; a Cron Trigger every 5 minutes on Cloudflare, a timer in `server.ts` on Node; injectable clock, also callable from tests):
  every 5 min: class reminders (booked members, class starting in 55–65 min,
  `notifyClassReminders`), once per class per member; daily 09:00 gym time: membership
  expiring (≤ 3 days) reminders; daily: prune OTP rows older than 7 days.

## 2. Real providers
- **SMS** (`src/sms.ts`): `log` (dev), `msg91` (Flow API with template, `authkey` header),
  `twilio` (Messages API with basic auth). Use `fetch`; injectable for tests. Failures → 502
  `sms_failed` "We couldn't send the code. Try again in a minute." (OTP row is kept).
- **Razorpay** (`src/payments.ts`): `createOrder` → `POST https://api.razorpay.com/v1/orders`
  (basic auth key:secret, `amount` in paise, `receipt`); `verifyPayment` = HMAC-SHA256
  `order_id|payment_id` with key secret, timing-safe compare. `PaymentOrder` for razorpay
  includes `keyId` (public) so the app can open checkout. **Webhook** `POST /webhooks/razorpay`:
  verify `X-Razorpay-Signature` (HMAC of raw body with webhook secret), handle
  `payment.captured` / `order.paid` idempotently (same effect as `/verify`); unknown events 200.
- **Push** (`src/push.ts`): Expo push API `https://exp.host/--/api/v2/push/send`, batches of 100,
  `Authorization: Bearer EXPO_ACCESS_TOKEN` when set; remove tokens that return
  `DeviceNotRegistered`. Every in-app notification created by the server is also pushed to the
  member's devices (respecting the matching `notify*` preference). Injectable sender; tests assert calls.

## 3. Account, devices, consent
| Method | Path | Who | Body → Response |
|---|---|---|---|
| POST | `/me/devices` | user | `deviceSchema` → 204 (upsert; a token moves to the latest user) |
| DELETE | `/me/devices/:token` | user | → 204 |
| POST | `/me/consent` | user | `consentSchema` → `ConsentState` (`guardianConsent` required when `isMinor(birthYear)`; 400 `guardian_required`) |
| GET | `/me/export` | user | → `AccountExport` (everything about the caller, all gyms) |
| DELETE | `/me` | user | `deleteAccountSchema` → 204. Deletes the user and personal data; anonymises their posts/comments/tickets ("Deleted member"); keeps payment rows with `user_id` nulled for gym accounting. 409 `sole_owner` if they're the only owner of a gym that has other members. |

`GET /me` gains `consent: ConsentState` and `isPlatformAdmin` (phone in `PLATFORM_ADMIN_PHONES`).

## 4. Gym features
| Method | Path | Who | Body → Response |
|---|---|---|---|
| GET | `/gyms/:gymId/coupons` | admin | → `{coupons: Coupon[]}` |
| POST | `/gyms/:gymId/coupons` | admin | `couponSchema` → 201 `Coupon` (409 `duplicate_code` per gym) |
| PATCH | `/gyms/:gymId/coupons/:id` | admin | `{active: boolean}` → `Coupon` |
| POST | `/gyms/:gymId/coupons/quote` | member | `{code, planId}` → `CouponQuote` (404 "That code isn't valid", 409 `coupon_expired` / `coupon_used_up` / `coupon_not_for_plan`) |
| POST | `/gyms/:gymId/payments/orders` | member | now accepts optional `couponCode`; the order amount is the discounted price; a ₹0 order is completed immediately (`status: 'paid'`) without the gateway; coupon `uses` increments only when paid |
| GET | `/gyms/:gymId/classes/:id/attendees` | staff | now → `{attendees: Attendee[]}` |
| PUT | `/gyms/:gymId/classes/:id/attendees/:userId` | staff | `attendanceSchema` → `Attendee` (only booked people; attended=true also records a check-in with method `staff` if they had none that day) |
| GET | `/gyms/:gymId/trainer/today` | staff | → `{classes: Array<ClassSession & {attendees: Attendee[]}>}` classes today (gym time zone), the caller's first when `trainerName` matches their name |
| GET | `/gyms/:gymId/door-code` | admin | → `DoorCode` (created on first call) |
| POST | `/gyms/:gymId/door-code/rotate` | admin | → `DoorCode` (old token stops working) |
| POST | `/gyms/:gymId/checkins` | member | body now `qrCheckInSchema`: `method:'qr'` requires a valid `doorToken` (403 `bad_door_code`); `occurredAt` (offline queue) accepted if ≤ 12 h old and not in the future, and counts for that day |
| GET | `/gyms/:gymId/me/summary` | member | gains `crowd: Crowd` (check-ins in the last 90 min, `crowdLevel`) |
| GET | `/gyms/:gymId/referral` | member | → `ReferralInfo` (`link` = `https://gymverse.app/join/<CODE>?ref=<userId>`) |
| PUT | `/gyms/:gymId/referral` | admin | `referralSettingsSchema` → `{reward}` |
| POST | `/gyms/join` | user | accepts optional `ref` (a userId); stored once as the referrer if they're a member of that gym |
| GET | `/gyms/:gymId/reports/revenue` | admin | → `RevenueReport` |
| GET | `/gyms/:gymId/freeze-requests` | member/staff | members: their own; admins: all (`?status=`) → `{requests: FreezeRequest[]}` |
| POST | `/gyms/:gymId/freeze-requests` | member | `freezeRequestSchema` → 201 `FreezeRequest` (max `MAX_FREEZE_DAYS`; needs an active membership; one pending at a time) |
| PATCH | `/gyms/:gymId/freeze-requests/:id` | admin | `freezeDecisionSchema` → `FreezeRequest`; approving extends the current subscription end by `days`; member is notified either way |

## 5. Platform admin console (`isPlatformAdmin` only; others get 404)
| Method | Path | Body → Response |
|---|---|---|
| GET | `/admin/stats` | → `AdminStats` |
| GET | `/admin/gyms?q=` | → `{gyms: AdminGymRow[]}` |
| PATCH | `/admin/gyms/:id` | `adminGymUpdateSchema` → `AdminGymRow` (audit-logged) |

Suspended gyms: `GET /me` still lists them with `suspended: true`; every gym-scoped route returns
403 `gym_suspended` "This gym's account is paused. Please contact the gym." (owners can still read
`/gyms/:id` and the admin can unsuspend). Gym preview/join for a suspended gym → 404.
