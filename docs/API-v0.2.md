# GymVerse API v0.2 additions (revamp + full feature set)

Builds on [API.md](API.md). Types: `packages/shared/src/types.ts`. Input validation: the zod
schemas in `packages/shared/src/schemas.ts` (named below). Same rules as v0.1: gym-scoped routes
return 404 to non-members, 403 for the wrong role, 403 `feature_disabled` when the gym switched
the feature off (feature key in brackets). Every list is scoped to the caller's gym.

## Defaults & profile
- New gyms default to **Burgundy & Beige**: primary `#6B0F1A`, accent `#B54B6A`, `themePreference: 'light'`.
- `PATCH /gyms/:gymId/branding` returns `contrastIssues` only for the modes the gym uses
  (`checkBrandContrast(p, a, 3, modesFor(themePreference))`).
- `Profile` gains: `gender, activityLevel, themeColor` (renamed from `accentColor`), `themeMode`
  (`'gym'` default), `weeklyGoal` (default 3), `notifyClassReminders / notifyAnnouncements /
  notifyWorkoutReminders` (default true), `language` (`'en'`), `setupComplete` (default false).
  `PATCH /me/profile` accepts all of them (`profileSchema`).
- `GET /gyms/:gymId/me/summary` gains `weekly: WeeklyGoal` (Monday-start weeks in the gym time zone),
  `unreadNotifications`, `activeChallenge`, `recommendedRoutine`.

## Workouts [workouts]
| Method | Path | Who | Body → Response |
|---|---|---|---|
| GET | `/gyms/:gymId/exercises?q=&muscle=` | member | → `{exercises: Exercise[]}` built-in library + the gym's own |
| POST | `/gyms/:gymId/exercises` | staff | `exerciseSchema` → 201 `Exercise` |
| GET | `/gyms/:gymId/routines` | member | → `RoutinesResponse` |
| GET | `/gyms/:gymId/routines/:id` | member | → `Routine` (presets, own custom, or assigned to me; staff see all) |
| POST | `/gyms/:gymId/routines` | member | `routineSchema` → 201 `Routine`. `kind: 'preset'` only for staff (403 otherwise) |
| PATCH | `/gyms/:gymId/routines/:id` | creator, or staff for presets | `routineSchema` → `Routine` |
| DELETE | `/gyms/:gymId/routines/:id` | creator, or admin for presets | → 204 |
| POST | `/gyms/:gymId/routines/:id/assign` | staff | `assignRoutineSchema` → `{assigned: true}`; notifies the member (`routine_assigned`, link `routine:<id>`) |
| GET | `/gyms/:gymId/members/:userId/workouts` | staff | → `{workouts: WorkoutLog[], assigned: Routine[]}` |
| POST | `/gyms/:gymId/workouts` | member | `workoutLogSchema` → 201 `WorkoutLogResult` (badges `first_workout`, `workouts_10`) |
| GET | `/gyms/:gymId/workouts?limit=20` | member | → `{workouts: WorkoutLog[]}` newest first |
| GET | `/gyms/:gymId/progress` | member | → `ProgressStats` |
| GET | `/me/measurements` | user | → `{measurements: Measurement[]}` oldest first (personal, not gym-scoped) |
| POST | `/me/measurements` | user | `measurementSchema` → 201 `Measurement` (also sets `profile.weightKg` when it is the newest) |
| DELETE | `/me/measurements/:id` | user | → 204 |

A built-in exercise library (about 24 exercises across all muscle groups, `builtIn: true`, fixed
ids `ex_*`) is created on startup and shared by all gyms.

## Resources [resources] and favourites
| Method | Path | Who | Body → Response |
|---|---|---|---|
| GET | `/gyms/:gymId/articles?kind=` | member | → `{articles: Article[]}` newest first |
| GET | `/gyms/:gymId/articles/:id` | member | → `Article` |
| POST | `/gyms/:gymId/articles` | admin | `articleSchema` → 201 `Article` |
| PATCH / DELETE | `/gyms/:gymId/articles/:id` | admin | `articleSchema` → `Article` / 204 |
| GET | `/gyms/:gymId/favourites` | member | → `FavouritesResponse` |
| PUT / DELETE | `/gyms/:gymId/favourites/:kind/:id` | member | kind ∈ `FAVOURITE_KINDS` → `{favourite: boolean}` (404 if the item is not in this gym) |

`readMinutes` = ceil(words / 200), minimum 1.

## Nutrition [nutrition]
| Method | Path | Who | Body → Response |
|---|---|---|---|
| GET | `/gyms/:gymId/meal-plans` | member | → `{mealPlans: MealPlan[]}` |
| GET | `/gyms/:gymId/meal-plans/:id` | member | → `MealPlan` |
| POST / DELETE | `/gyms/:gymId/meal-plans[/:id]` | admin | `mealPlanSchema` → 201 `MealPlan` / 204 |
| GET | `/gyms/:gymId/meal-ideas?mealType=` | member | → `{mealIdeas: MealIdea[]}` |
| GET | `/gyms/:gymId/meal-ideas/:id` | member | → `MealIdea` |
| POST / DELETE | `/gyms/:gymId/meal-ideas[/:id]` | admin | `mealIdeaSchema` → 201 `MealIdea` / 204 |

## Community [community]
| Method | Path | Who | Body → Response |
|---|---|---|---|
| GET | `/gyms/:gymId/posts?before=<iso>` | member | → `{posts: Post[]}` 20 newest; members never get hidden posts, staff do (`hidden: true`) |
| POST | `/gyms/:gymId/posts` | member | `postSchema` → 201 `Post` |
| PATCH | `/gyms/:gymId/posts/:id` | admin | `postModerationSchema` → `Post` |
| DELETE | `/gyms/:gymId/posts/:id` | author / admin | → 204 |
| PUT / DELETE | `/gyms/:gymId/posts/:id/like` | member | → `{likeCount, likedByMe}` (idempotent) |
| GET | `/gyms/:gymId/posts/:id/comments` | member | → `{comments: Comment[]}` oldest first |
| POST | `/gyms/:gymId/posts/:id/comments` | member | `commentSchema` → 201 `Comment` |
| DELETE | `/gyms/:gymId/comments/:id` | author / admin | → 204 |
| GET | `/gyms/:gymId/challenges` | member | → `{challenges: Challenge[]}` active first, then upcoming, then ended |
| POST | `/gyms/:gymId/challenges` | admin | `challengeSchema` → 201 `Challenge`; notifies members (`challenge`) |
| DELETE | `/gyms/:gymId/challenges/:id` | admin | → 204 |
| PUT / DELETE | `/gyms/:gymId/challenges/:id/join` | member | → `Challenge` (joining an ended one: 409) |
| GET | `/gyms/:gymId/challenges/:id/leaderboard` | member | → `{entries: LeaderboardEntry[]}` participants only, ranked by progress; people with `showStats = false` appear as "Member" unless it is the caller |

Challenge progress = count of the metric (check-ins / workouts logged / bookings for classes
starting in range) between `startsOn` and `endsOn` inclusive, in the gym time zone. Reaching the
target earns the `challenge_done` badge.

## Notifications
| Method | Path | Who | Body → Response |
|---|---|---|---|
| GET | `/gyms/:gymId/notifications` | member | → `NotificationsResponse` (50 newest) |
| POST | `/gyms/:gymId/notifications/read` | member | `markReadSchema` (no ids = all) → `{unread}` |

Created by the server on: announcement posted (`announcement`, to all active members except the
author, respecting `notifyAnnouncements`), class booked (`booking`), waitlist promotion
(`waitlist_promoted`), payment verified (`payment`), membership ending within 7 days
(`membership_expiring`, created lazily when the summary or notifications are read, once per
subscription end date), routine assigned, challenge created, and a staff reply on a ticket
(`support_reply`). Push delivery (FCM/APNs) is a TODO.

## Help & support [support]
| Method | Path | Who | Body → Response |
|---|---|---|---|
| GET | `/gyms/:gymId/support` | member | → `SupportInfo` (null fields and `faqs: []` if never set) |
| PUT | `/gyms/:gymId/support` | admin | `supportInfoSchema` → `SupportInfo` |
| GET | `/gyms/:gymId/support/tickets?status=` | member | members get their own, staff get all → `{tickets: SupportTicket[]}` newest update first |
| POST | `/gyms/:gymId/support/tickets` | member | `ticketSchema` → 201 `SupportTicket` |
| GET | `/gyms/:gymId/support/tickets/:id` | ticket owner / staff | → `SupportTicket` |
| POST | `/gyms/:gymId/support/tickets/:id/messages` | ticket owner / staff | `ticketMessageSchema` → `SupportTicket`; a staff reply sets `answered` and notifies; a member reply sets `open` |
| PATCH | `/gyms/:gymId/support/tickets/:id` | ticket owner / staff | `ticketStatusSchema` → `SupportTicket` |

## Search
`GET /gyms/:gymId/search?q=` (member; q of 2+ characters, else 400) → `SearchResults`:
case-insensitive substring match on class titles and trainer names (next 14 days), routine names
(presets, mine, assigned), exercise names, article titles and tags, meal idea titles and tags, and
staff names (`trainers`). At most 10 per group. Groups for switched-off features are empty arrays.
