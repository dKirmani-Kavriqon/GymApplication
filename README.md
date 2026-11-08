# GymVerse

White-label, multi-gym fitness platform: one app every gym can make its own. Members check in,
book classes, train with their coach's plans, track progress, eat well and stay motivated; owners
run their gym from a web dashboard. Default look: **Burgundy & Beige**
([reference](docs/design/burgundy-beige-reference.webp)); gyms can apply their own brand and members
can pick their own theme on top.

| Package | What | Stack |
|---|---|---|
| `apps/mobile` | Member app (iOS, Android, web) | React Native 0.88, Expo SDK 58 |
| `apps/dashboard` | Owner / manager / trainer dashboard + platform admin console | React 19 + Vite |
| `apps/api` | Multi-tenant REST API | Cloudflare Workers + Durable Object SQLite (Node 24 + `node:sqlite` locally) |
| `packages/shared` | Contract: types, zod schemas, theme engine (WCAG AA), streaks, badges | TypeScript |
| `deploy/` | Self-hosting alternative: Docker, Caddy, Litestream (production runs on Cloudflare) | |

## Run it locally

Requires Node 24.3 or newer (the API uses the built-in `node:sqlite`; Expo SDK 58 needs 24.3+).

```bash
npm install
```

```bash
npm run seed -w @gymverse/api
```

```bash
npm run dev:api
```

```bash
npm run dev:mobile
```

```bash
npm run dev:dashboard
```

- API http://localhost:4000 · member app (web) http://localhost:8081 · dashboard http://localhost:5173
- Or run the API on the real Cloudflare runtime with the demo gym already in it:
  `npm run dev:worker -w @gymverse/api` (http://127.0.0.1:4200; copy `apps/api/.dev.vars.example` to
  `apps/api/.dev.vars` first).
- Demo gym **FLEX42** (Flex Fitness, Pune). Owner `+919999900001` (Priya), member `+919999900002`
  (Ravi), trainer `+919999900003` (Coach Vikram). In development the login code is shown on screen.
- On a phone: the Expo Go app in the stores doesn't run SDK 58 yet, so install a build from EAS
  instead. `cd apps/mobile && eas build --profile preview --platform android` makes an installable
  app that talks to the staging API (set its URL in `eas.json`). To run your local code on a phone
  with live reload, add a development client first (`npx expo install expo-dev-client`), build the
  `development` profile once, then `npm run start -w @gymverse/mobile` and set `EXPO_PUBLIC_API_URL`
  to your computer's LAN address.

## Test it

```bash
npm test
```

```bash
npm run typecheck
```

Every package has unit and integration tests; the API suite includes **tenant-isolation tests**
that attack every gym-scoped route from another gym. Coverage gates (ECC: 80%+) run in CI.

The API also runs on the Cloudflare runtime locally: database driver checks inside a Durable
Object, then 15 end-to-end checks over HTTP.

```bash
npm run test:worker -w @gymverse/api
```

## Features

**Member app:** intro, join by gym code or QR, phone login, set-up wizard (gender, age, height,
weight, goal, activity, weekly goal), consent (with guardian consent for under-18s) · Home with
greeting, weekly goal, one-tap check-in (offline too), crowd meter, coach's workout, challenge,
next class, gym news, invite a friend · door QR check-in · classes with waitlist · Train:
coach-assigned and gym routines, build your own, guided workout logger with rest timer, history ·
progress charts, body weight, personal bests, badges · nutrition (meal plans, recipes) · learn
(articles, videos, tips) · favourites · community feed and challenges with leaderboards ·
notifications · search · help centre and messaging the gym · membership renewal with coupons,
pause requests · my colour theme, light/dark, Hindi, Face ID / fingerprint lock · data export and
account deletion · coach tools for trainers (today's classes, attendance).

**Dashboard:** onboarding, branding studio with live phone preview and theme presets, members (CSV
import, roles, at-risk), classes and attendance, plans and coupons, revenue, workouts (exercise
library, programmes, assign to members), nutrition, resources, community moderation and
challenges, announcements, support inbox and FAQ, pause requests, join and door QR posters,
platform admin console.

Subtle motion throughout (card entrances, progress fills, celebrations), always off when the OS
"Reduce motion" setting is on.

## Docs

- [Going to production on Cloudflare](docs/PRODUCTION.md): staging and production deploys, secrets, CI, restore, mobile release, checklists
- API: [v0.1](docs/API.md), [v0.2](docs/API-v0.2.md), [v0.3](docs/API-v0.3.md), [API README: env vars, payments flow](apps/api/README.md)

## Not built yet

Progress photos (needs object storage), wearables (Apple Health / Health Connect need a native
build), multi-branch gyms, in-app QR scanner (the phone camera already opens door and join QRs),
error tracking (Sentry), a scheduled full backup export to R2, and splitting the database into one
Durable Object per gym when one object is no longer enough.
