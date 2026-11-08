/**
 * Numbered schema migrations. The driver records how many have run (`PRAGMA user_version` on
 * node:sqlite, a meta table on Durable Objects); `migrate()` in
 * db.ts applies the rest in order, each in its own transaction. Never edit a released migration:
 * add a new one.
 *
 *   1  v0.1 schema
 *   2  v0.2: profile settings (accent_color -> theme_color), workouts, content, community, support
 *   3  v0.3: devices, consent, coupons, attendance, door codes, referrals, freezes, suspension,
 *      account deletion (payments.user_id nullable), webhook idempotency
 */
import type { Db } from './db';

const V01 = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  goal TEXT,
  height_cm REAL,
  weight_kg REAL,
  birth_year INTEGER,
  bio TEXT,
  accent_color TEXT,
  show_stats INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS otp_phone ON otp_codes(phone, created_at);

CREATE TABLE IF NOT EXISTS gyms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  timezone TEXT NOT NULL,
  join_code TEXT NOT NULL UNIQUE,
  tagline TEXT,
  logo_url TEXT,
  primary_color TEXT NOT NULL,
  accent_color TEXT NOT NULL,
  theme_pref TEXT NOT NULL DEFAULT 'auto',
  welcome_message TEXT,
  enabled_features TEXT NOT NULL,
  plan_tier TEXT NOT NULL DEFAULT 'starter',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gym_members (
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  joined_at TEXT NOT NULL,
  PRIMARY KEY (gym_id, user_id)
);

CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branches(id),
  day TEXT NOT NULL,
  checked_in_at TEXT NOT NULL,
  method TEXT NOT NULL,
  UNIQUE (gym_id, user_id, day)
);
CREATE INDEX IF NOT EXISTS checkins_gym_day ON checkins(gym_id, day);

CREATE TABLE IF NOT EXISTS class_sessions (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  trainer_name TEXT,
  starts_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  capacity INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS classes_gym_start ON class_sessions(gym_id, starts_at);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  price_paise INTEGER NOT NULL,
  benefits TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  payment_id TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  amount_paise INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_order_id TEXT NOT NULL UNIQUE,
  provider_payment_id TEXT,
  status TEXT NOT NULL,
  receipt_number TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_badges (
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id TEXT NOT NULL,
  earned_at TEXT NOT NULL,
  PRIMARY KEY (gym_id, user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  created_at TEXT NOT NULL
);

`;

const V02_TABLES = `
-- ---------- v0.2: workouts ----------

-- gym_id NULL = GymVerse built-in library shared by every gym (fixed ids 'ex_*').
CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  gym_id TEXT REFERENCES gyms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  muscle_group TEXT NOT NULL,
  equipment TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '[]',
  video_url TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS exercises_gym ON exercises(gym_id);

CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  level TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS routines_gym ON routines(gym_id, kind);

CREATE TABLE IF NOT EXISTS routine_exercises (
  routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  sets INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  weight_kg REAL,
  rest_sec INTEGER NOT NULL,
  PRIMARY KEY (routine_id, position)
);

CREATE TABLE IF NOT EXISTS routine_assignments (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (routine_id, user_id)
);
CREATE INDEX IF NOT EXISTS assignments_user ON routine_assignments(gym_id, user_id);

CREATE TABLE IF NOT EXISTS workout_logs (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_id TEXT,
  routine_name TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  day TEXT NOT NULL,
  total_volume_kg REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workouts_gym_user ON workout_logs(gym_id, user_id, completed_at);

CREATE TABLE IF NOT EXISTS workout_sets (
  id TEXT PRIMARY KEY,
  workout_id TEXT NOT NULL REFERENCES workout_logs(id) ON DELETE CASCADE,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  position INTEGER NOT NULL,
  set_number INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  weight_kg REAL
);
CREATE INDEX IF NOT EXISTS workout_sets_workout ON workout_sets(workout_id, position);

-- Personal, not gym-scoped: a member's body measurements follow them between gyms.
CREATE TABLE IF NOT EXISTS measurements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_on TEXT NOT NULL,
  weight_kg REAL,
  body_fat_pct REAL,
  waist_cm REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS measurements_user ON measurements(user_id, measured_on);

-- ---------- v0.2: resources & nutrition ----------

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  video_url TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  author_id TEXT NOT NULL REFERENCES users(id),
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS articles_gym ON articles(gym_id, published_at);

CREATE TABLE IF NOT EXISTS meal_ideas (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  meal_type TEXT NOT NULL,
  calories INTEGER NOT NULL,
  protein_g REAL NOT NULL,
  carbs_g REAL NOT NULL DEFAULT 0,
  fat_g REAL NOT NULL DEFAULT 0,
  ingredients TEXT NOT NULL DEFAULT '[]',
  steps TEXT NOT NULL DEFAULT '[]',
  image_url TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meal_plans (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  goal TEXT,
  description TEXT NOT NULL DEFAULT '',
  calories_per_day INTEGER NOT NULL,
  meals TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favourites (
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (gym_id, user_id, kind, item_id)
);

-- ---------- v0.2: community ----------

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_gym ON posts(gym_id, created_at);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id, created_at);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  metric TEXT NOT NULL,
  target INTEGER NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS challenges_gym ON challenges(gym_id, ends_on);

CREATE TABLE IF NOT EXISTS challenge_participants (
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (challenge_id, user_id)
);

-- ---------- v0.2: notifications & support ----------

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  -- Set for notifications that must only ever be created once (e.g. per subscription end date).
  dedupe_key TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(gym_id, user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe ON notifications(gym_id, user_id, dedupe_key);

CREATE TABLE IF NOT EXISTS support_info (
  gym_id TEXT PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  hours TEXT,
  faqs TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tickets_gym ON support_tickets(gym_id, updated_at);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  from_role TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket ON ticket_messages(ticket_id, created_at);
`;

const V03_TABLES = `
CREATE TABLE IF NOT EXISTS devices (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id);

CREATE TABLE IF NOT EXISTS consents (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  terms_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  guardian_consent INTEGER NOT NULL DEFAULT 0,
  guardian_name TEXT
);

CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  plan_ids TEXT NOT NULL DEFAULT '[]',
  expires_on TEXT,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (gym_id, code)
);

CREATE TABLE IF NOT EXISTS door_codes (
  gym_id TEXT PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  rotated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS freeze_requests (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  days INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  decided_by TEXT,
  new_ends_at TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS freeze_gym ON freeze_requests(gym_id, status);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- payments.user_id becomes nullable (kept for gym accounting after account deletion) and gains coupon columns.
CREATE TABLE payments_v3 (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  amount_paise INTEGER NOT NULL,
  original_paise INTEGER NOT NULL,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  coupon_id TEXT,
  provider TEXT NOT NULL,
  provider_order_id TEXT NOT NULL UNIQUE,
  provider_payment_id TEXT,
  status TEXT NOT NULL,
  receipt_number TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT
);
INSERT INTO payments_v3 (id, gym_id, user_id, plan_id, amount_paise, original_paise, discount_paise, coupon_id, provider,
                         provider_order_id, provider_payment_id, status, receipt_number, created_at, paid_at)
  SELECT id, gym_id, user_id, plan_id, amount_paise, amount_paise, 0, NULL, provider,
         provider_order_id, provider_payment_id, status, receipt_number, created_at, paid_at FROM payments;
DROP TABLE payments;
ALTER TABLE payments_v3 RENAME TO payments;
CREATE INDEX IF NOT EXISTS payments_gym_paid ON payments(gym_id, status, paid_at);
`;

/** Feature keys introduced in v0.2; switched on for gyms created before they existed. */
const V02_FEATURES = ['workouts', 'nutrition', 'community', 'resources', 'support'];

function columnsOf(db: Db, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
}

function addColumns(db: Db, table: string, columns: Array<[string, string]>): void {
  const have = columnsOf(db, table);
  for (const [name, type] of columns) {
    if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

export const MIGRATIONS: Array<(db: Db) => void> = [
  // 1: v0.1
  (db) => db.exec(V01),

  // 2: v0.2. Checks the actual shape, so half-migrated files from early v0.2 builds also work.
  (db) => {
    const cols = columnsOf(db, 'profiles');
    if (cols.has('accent_color') && !cols.has('theme_color')) db.exec('ALTER TABLE profiles RENAME COLUMN accent_color TO theme_color');
    addColumns(db, 'profiles', [
      ['gender', 'TEXT'],
      ['activity_level', 'TEXT'],
      ['theme_color', 'TEXT'],
      ['theme_mode', "TEXT NOT NULL DEFAULT 'gym'"],
      ['weekly_goal', 'INTEGER NOT NULL DEFAULT 3'],
      ['notify_class_reminders', 'INTEGER NOT NULL DEFAULT 1'],
      ['notify_announcements', 'INTEGER NOT NULL DEFAULT 1'],
      ['notify_workout_reminders', 'INTEGER NOT NULL DEFAULT 1'],
      ['language', "TEXT NOT NULL DEFAULT 'en'"],
      ['setup_complete', 'INTEGER NOT NULL DEFAULT 0'],
    ]);
    db.exec(V02_TABLES);
    const gyms = db.prepare('SELECT id, enabled_features FROM gyms').all() as Array<{ id: string; enabled_features: string }>;
    const update = db.prepare('UPDATE gyms SET enabled_features = ? WHERE id = ?');
    for (const g of gyms) {
      const features = JSON.parse(g.enabled_features) as string[];
      const next = [...features, ...V02_FEATURES.filter((f) => !features.includes(f))];
      if (next.length !== features.length) update.run(JSON.stringify(next), g.id);
    }
  },

  // 3: v0.3
  (db) => {
    addColumns(db, 'users', [['deleted_at', 'TEXT']]);
    addColumns(db, 'gyms', [
      ['suspended', 'INTEGER NOT NULL DEFAULT 0'],
      ['referral_reward', 'TEXT'],
    ]);
    addColumns(db, 'gym_members', [['referred_by', 'TEXT']]);
    addColumns(db, 'bookings', [
      ['attended', 'INTEGER'],
      ['attendance_marked_at', 'TEXT'],
    ]);
    db.exec(V03_TABLES);
  },
];

/**
 * A v0.1 database never set user_version, so 0 with existing tables means "migration 1 done".
 * Early v0.2 builds set user_version = 2 directly, which matches migration 2.
 */
export function currentVersion(db: Db): number {
  const v = db.getSchemaVersion();
  if (v > 0) return v;
  const hasUsers = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  return hasUsers ? 1 : 0;
}
