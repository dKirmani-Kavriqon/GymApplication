# GymVerse API (v0.1)

Base URL in development: `http://localhost:4000`. JSON in, JSON out.
Auth: `Authorization: Bearer <token>` (from `/auth/otp/verify`).
Errors: `{ "error": "<code>", "message": "<human text>" }` — show `message` to users.
Types referenced below live in `packages/shared/src/types.ts`.

Gym-scoped routes (`/gyms/:gymId/...`) return **404** if the caller isn't an active member
of that gym (tenant isolation), **403** if their role isn't allowed, and **403
`feature_disabled`** if the gym switched the feature off.
Roles: `member` < `trainer` (staff) < `manager` < `owner`. "staff" = trainer/manager/owner,
"admin" = manager/owner.

## Auth & profile
| Method | Path | Who | Body → Response |
|---|---|---|---|
| POST | `/auth/otp/request` | anyone | `{phone}` → `{sent, devCode?}` (`devCode` only in dev) |
| POST | `/auth/otp/verify` | anyone | `{phone, code}` → `{token, isNewUser, user}` |
| GET | `/me` | user | → `MeResponse` (user, profile, memberships with full `Gym`) |
| PATCH | `/me/profile` | user | `ProfileInput` (+ `name`) → `MeResponse` |

## Gyms
| Method | Path | Who | Body → Response |
|---|---|---|---|
| POST | `/gyms` | user | `{name, city, timezone?, primaryColor?, accentColor?}` → `Gym` (caller = owner) |
| GET | `/gyms/preview/:code` | anyone | → `GymPreview` (branding for a join code) |
| POST | `/gyms/join` | user | `{code}` → `{gym, role, alreadyMember}` |
| GET | `/gyms/:gymId` | member | → `{gym, role}` |
| PATCH | `/gyms/:gymId/branding` | admin | `BrandingInput` → `{gym, contrastIssues: ContrastIssue[]}` |

## Member
| Method | Path | Who | Body → Response |
|---|---|---|---|
| POST | `/gyms/:gymId/checkins` | member | `{method?}` → `CheckInResult` (201 new, 200 already today) |
| GET | `/gyms/:gymId/me/summary` | member | → `MemberSummary` (home screen) |
| GET | `/gyms/:gymId/classes?days=14` | member | → `{classes: ClassSession[]}` |
| POST | `/gyms/:gymId/classes/:id/book` | member | → `{session, newBadges}` (booked or waitlisted) |
| DELETE | `/gyms/:gymId/classes/:id/book` | member | → `{session, promotedUserId}` |
| GET | `/gyms/:gymId/plans` | member | → `{plans: Plan[]}` |
| POST | `/gyms/:gymId/payments/orders` | member | `{planId}` → `PaymentOrder` |
| POST | `/gyms/:gymId/payments/:paymentId/verify` | member | `{providerPaymentId, signature}` → `PaymentResult` |
| GET | `/gyms/:gymId/payments` | member | → `{payments: PaymentRecord[]}` |
| GET | `/gyms/:gymId/announcements` | member | → `{announcements: Announcement[]}` |

## Staff / owner
| Method | Path | Who | Body → Response |
|---|---|---|---|
| POST | `/gyms/:gymId/classes` | staff | `{title, trainerName?, startsAt (ISO), durationMin, capacity}` → `ClassSession` |
| DELETE | `/gyms/:gymId/classes/:id` | staff | → 204 |
| GET | `/gyms/:gymId/classes/:id/attendees` | staff | → `{attendees: {userId,name,phone,status}[]}` |
| POST | `/gyms/:gymId/plans` | admin | `{name, durationDays, pricePaise, benefits[]}` → `Plan` |
| DELETE | `/gyms/:gymId/plans/:id` | admin | → 204 (archives) |
| POST | `/gyms/:gymId/announcements` | admin | `{title, body, pinned?}` → `Announcement` |
| GET | `/gyms/:gymId/members` | staff | → `{members: MemberRow[]}` (incl. `atRisk`) |
| POST | `/gyms/:gymId/members/import` | admin | `{rows: {phone, name?}[]}` → `{created, added, skipped}` |
| PATCH | `/gyms/:gymId/members/:userId` | owner | `{role}` → `{userId, role}` |
| DELETE | `/gyms/:gymId/members/:userId` | admin | → 204 (deactivates) |
| GET | `/gyms/:gymId/reports/attendance` | staff | → `AttendanceReport` |

## Payments in development
The default provider is a mock. `PaymentOrder.mockSignature` is returned so the client can
call `/verify` straight away. In production swap in a Razorpay/Stripe `PaymentProvider`
(`apps/api/src/payments.ts`); the client opens the gateway checkout and sends the gateway's
signature to `/verify`.

## Demo data
`npm run seed -w @gymverse/api` creates gym **FLEX42** (Flex Fitness, Pune):
owner `+919999900001`, member `+919999900002`, trainer `+919999900003`. In dev the OTP
comes back as `devCode`.
