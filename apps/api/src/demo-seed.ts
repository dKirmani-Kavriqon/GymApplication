/**
 * Demo data for gym FLEX42 (Flex Fitness, Pune). Used by `npm run seed` and the seed test.
 *   owner +919999900001 (Priya) · member +919999900002 (Ravi) · trainer +919999900003 (Coach Vikram)
 *
 * Idempotent per gym code. Each layer is only added when it is missing, so an older demo
 * database is topped up once and a second run does nothing:
 *   base (gym, people, plans, check-ins, classes)  when FLEX42 does not exist
 *   v0.2 content (workouts, resources, ...)          when the gym has no routines
 *   v0.3 content (coupon, door code, freeze, ...)    when the gym has no coupons
 * Demo databases still on the old seed colours are switched to the GymVerse defaults.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_BRANDING, addDays, dayKey, mondayOf, type Gym } from '@gymverse/shared';
import { tx, type Db } from './db';
import { upsertUserByPhone } from './auth';
import * as store from './store';
import { notify, notifyGym } from './domain/notifications';
import { assignRoutine } from './domain/workouts';
import { seedV03 } from './demo-seed-v03';

export const DEMO_CODE = 'FLEX42';
export const DEMO_PHONES = { owner: '+919999900001', member: '+919999900002', trainer: '+919999900003' } as const;
const OTHER_MEMBERS = ['Anita Desai', 'Karan Mehta', 'Sneha Patil', 'Arjun Rao', 'Meera Iyer'];
const otherPhone = (i: number) => `+91999990010${i}`;
const OLD_COLOURS = { primary: '#E11D48', accent: '#D97706' };

export interface SeedResult {
  gymId: string;
  createdGym: boolean;
  addedContent: boolean;
  addedV03: boolean;
  recoloured: boolean;
}

export function seedDemo(db: Db, now = new Date()): SeedResult {
  return tx(db, () => {
    let gym = store.getGymByCode(db, DEMO_CODE);
    const createdGym = !gym;
    if (!gym) gym = seedBase(db, now);
    const hasContent = db.prepare('SELECT 1 FROM routines WHERE gym_id = ? LIMIT 1').get(gym.id);
    if (!hasContent) seedContent(db, gym, now);
    const hasV03 = db.prepare('SELECT 1 FROM coupons WHERE gym_id = ? LIMIT 1').get(gym.id);
    if (!hasV03) {
      const id = (phone: string) => upsertUserByPhone(db, phone, now).id;
      seedV03(db, gym, { owner: id(DEMO_PHONES.owner), ravi: id(DEMO_PHONES.member), coach: id(DEMO_PHONES.trainer), anita: id(otherPhone(0)), karan: id(otherPhone(1)) }, now);
    }
    const recoloured = gym.branding.primaryColor === OLD_COLOURS.primary && gym.branding.accentColor === OLD_COLOURS.accent;
    if (recoloured) {
      db.prepare('UPDATE gyms SET primary_color = ?, accent_color = ?, theme_pref = ? WHERE id = ?').run(
        DEFAULT_BRANDING.primaryColor,
        DEFAULT_BRANDING.accentColor,
        DEFAULT_BRANDING.themePreference,
        gym.id,
      );
    }
    return { gymId: gym.id, createdGym, addedContent: !hasContent, addedV03: !hasV03, recoloured };
  });
}

// ---------- v0.1 base: people, plans, check-ins, classes, announcement ----------

function seedBase(db: Db, now: Date): Gym {
  const owner = upsertUserByPhone(db, DEMO_PHONES.owner, now).id;
  db.prepare("UPDATE users SET name = 'Priya Sharma' WHERE id = ?").run(owner);
  // New GymVerse defaults (Burgundy & Beige, light) so demos show the current look.
  const gym = store.createGym(
    db,
    {
      name: 'Flex Fitness',
      city: 'Pune',
      timezone: 'Asia/Kolkata',
      primaryColor: DEFAULT_BRANDING.primaryColor,
      accentColor: DEFAULT_BRANDING.accentColor,
      themePreference: DEFAULT_BRANDING.themePreference,
    },
    owner,
    now,
  );
  db.prepare("UPDATE gyms SET join_code = ?, tagline = 'Stronger every day', welcome_message = ? WHERE id = ?").run(
    DEMO_CODE,
    'Welcome to Flex! Lockers are free, towels are ₹20. Please re-rack your weights.',
    gym.id,
  );

  const member = upsertUserByPhone(db, DEMO_PHONES.member, now).id;
  db.prepare("UPDATE users SET name = 'Ravi Kumar' WHERE id = ?").run(member);
  db.prepare("UPDATE profiles SET goal = 'stay_active', height_cm = 172, weight_kg = 81 WHERE user_id = ?").run(member);
  store.addMember(db, gym.id, member, 'member', new Date(now.getTime() - 40 * 86_400_000));

  const otherIds = OTHER_MEMBERS.map((name, i) => {
    const id = upsertUserByPhone(db, otherPhone(i), now).id;
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id);
    store.addMember(db, gym.id, id, 'member', new Date(now.getTime() - 30 * 86_400_000));
    return id;
  });
  const trainer = upsertUserByPhone(db, DEMO_PHONES.trainer, now).id;
  db.prepare("UPDATE users SET name = 'Coach Vikram' WHERE id = ?").run(trainer);
  store.addMember(db, gym.id, trainer, 'trainer', now);

  const plans = [
    ['Monthly', 30, 149900, ['Full gym access', 'Locker']],
    ['Quarterly', 90, 399900, ['Full gym access', 'Locker', '1 PT session']],
    ['Yearly', 365, 1299900, ['Full gym access', 'Locker', '4 PT sessions', 'Free T-shirt']],
  ] as const;
  const planIds = plans.map(([name, days, price, benefits]) => {
    const id = randomUUID();
    db.prepare('INSERT INTO plans (id, gym_id, name, duration_days, price_paise, benefits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id,
      gym.id,
      name,
      days,
      price,
      JSON.stringify(benefits),
      now.toISOString(),
    );
    return id;
  });

  // Ravi's membership ends in 5 days so the renewal banner (and the lazy expiry notification) shows.
  db.prepare('INSERT INTO subscriptions (id, gym_id, user_id, plan_id, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    randomUUID(),
    gym.id,
    member,
    planIds[0],
    new Date(now.getTime() - 25 * 86_400_000).toISOString(),
    new Date(now.getTime() + 5 * 86_400_000).toISOString(),
    now.toISOString(),
  );

  // Check-in history: Ravi has a 3-day streak ending yesterday; others vary; Meera is at risk.
  const today = dayKey(now, gym.timezone);
  const insertCheckin = db.prepare(
    "INSERT OR IGNORE INTO checkins (id, gym_id, user_id, day, checked_in_at, method) VALUES (?, ?, ?, ?, ?, 'button')",
  );
  const visit = (userId: string, daysAgo: number, hourUtc: number) => {
    const day = addDays(today, -daysAgo);
    insertCheckin.run(randomUUID(), gym.id, userId, day, `${day}T${String(hourUtc).padStart(2, '0')}:15:00.000Z`);
  };
  for (const d of [1, 2, 3, 6, 8, 9, 13]) visit(member, d, 1);
  otherIds.slice(0, 4).forEach((id, i) => {
    for (let d = 0; d < 14; d++) if ((d + i) % 2 === 0) visit(id, d, [0, 1, 12, 13][i]);
  });
  visit(otherIds[4], 20, 2);
  store.syncBadges(db, gym, member, now);

  const classes = [
    ['Morning Yoga', 'Coach Vikram', 1, 1, 15],
    ['HIIT Blast', 'Coach Vikram', 1, 12, 2],
    ['Zumba', 'Anjali', 2, 12, 20],
    ['Strength Basics', 'Coach Vikram', 3, 1, 10],
  ] as const;
  for (const [title, trainerName, inDays, hourUtc, capacity] of classes) {
    const day = addDays(today, inDays);
    db.prepare(
      'INSERT INTO class_sessions (id, gym_id, title, trainer_name, starts_at, duration_min, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), gym.id, title, trainerName, `${day}T${String(hourUtc).padStart(2, '0')}:30:00.000Z`, 45, capacity, now.toISOString());
  }

  db.prepare('INSERT INTO announcements (id, gym_id, title, body, pinned, created_by, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run(
    randomUUID(),
    gym.id,
    'Diwali timings',
    'We are open 6am to 12pm on Diwali day. Happy Diwali from the Flex family!',
    owner,
    now.toISOString(),
  );
  return gym;
}

// ---------- v0.2 content ----------

type RoutineItem = [exerciseId: string, sets: number, reps: number, weightKg: number | null, restSec: number];

function seedContent(db: Db, gym: Gym, now: Date): void {
  const DAY = 86_400_000;
  const ago = (days: number, minutes = 0) => new Date(now.getTime() - days * DAY - minutes * 60_000);
  const userId = (phone: string) => upsertUserByPhone(db, phone, now).id;
  const owner = userId(DEMO_PHONES.owner);
  const ravi = userId(DEMO_PHONES.member);
  const coach = userId(DEMO_PHONES.trainer);
  const [anita, karan, sneha, arjun] = [0, 1, 2, 3].map((i) => userId(otherPhone(i)));
  for (const id of [owner, ravi, coach, anita, karan, sneha, arjun]) {
    if (!store.getRole(db, gym.id, id)) store.addMember(db, gym.id, id, 'member', ago(30));
  }
  const today = dayKey(now, gym.timezone);

  // People details for the v0.2 profile fields.
  db.prepare(
    "UPDATE profiles SET gender = 'male', activity_level = 'moderate', weekly_goal = 4, setup_complete = 1, bio = ? WHERE user_id = ?",
  ).run('Desk job by day, squats by night.', ravi);
  db.prepare('UPDATE profiles SET show_stats = 0 WHERE user_id = ?').run(sneha); // shows as "Member" on leaderboards

  // ---- routines ----
  const routine = (name: string, description: string, level: string, kind: 'preset' | 'custom', by: string, at: Date, items: RoutineItem[]) => {
    const id = randomUUID();
    db.prepare(
      'INSERT INTO routines (id, gym_id, name, description, level, kind, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, gym.id, name, description, level, kind, by, at.toISOString(), at.toISOString());
    const insert = db.prepare(
      'INSERT INTO routine_exercises (routine_id, gym_id, position, exercise_id, sets, reps, weight_kg, rest_sec) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    items.forEach(([ex, sets, reps, kg, rest], i) => insert.run(id, gym.id, i, ex, sets, reps, kg, rest));
    return { id, name, items };
  };
  const fullBody = routine(
    'Beginner full body',
    'Three days a week for your first month. Learn the main movements with light weights.',
    'beginner',
    'preset',
    coach,
    ago(35),
    [
      ['ex_goblet_squat', 3, 12, 8, 60],
      ['ex_push_up', 3, 10, null, 60],
      ['ex_lat_pulldown', 3, 12, 25, 60],
      ['ex_shoulder_press', 3, 10, 6, 60],
      ['ex_plank', 3, 30, null, 45],
    ],
  );
  const pushDay = routine(
    'Push day',
    'Chest, shoulders and triceps. Add 2.5 kg to the bench when you hit all reps.',
    'intermediate',
    'preset',
    coach,
    ago(35, -10),
    [
      ['ex_bench_press', 4, 8, 40, 90],
      ['ex_shoulder_press', 3, 10, 10, 75],
      ['ex_lateral_raise', 3, 15, 4, 45],
      ['ex_triceps_pushdown', 3, 12, 15, 45],
      ['ex_push_up', 2, 15, null, 45],
    ],
  );
  const legDay = routine(
    'Leg day',
    'Squat, hinge and lunge. Warm up with two light squat sets first.',
    'intermediate',
    'preset',
    coach,
    ago(35, -20),
    [
      ['ex_back_squat', 4, 8, 50, 120],
      ['ex_romanian_deadlift', 3, 10, 40, 90],
      ['ex_walking_lunge', 3, 12, 8, 60],
      ['ex_leg_press', 3, 12, 80, 60],
      ['ex_crunch', 3, 20, null, 30],
    ],
  );
  const raviPlan = routine(
    'Fat-loss circuit',
    'Built for Ravi: a fast full-body circuit for the days you only have 30 minutes.',
    'beginner',
    'custom',
    coach,
    ago(10),
    [
      ['ex_kettlebell_swing', 3, 15, 12, 30],
      ['ex_goblet_squat', 3, 12, 12, 30],
      ['ex_push_up', 3, 12, null, 30],
      ['ex_seated_cable_row', 3, 12, 30, 30],
      ['ex_jumping_jacks', 3, 40, null, 30],
    ],
  );
  assignRoutine(db, gym.id, raviPlan.id, ravi, coach, 'Three rounds, keep the rests short. We will review it in two weeks.', ago(10));
  notify(
    db,
    gym.id,
    ravi,
    { kind: 'routine_assigned', title: 'New workout plan', body: 'Coach Vikram assigned you "Fat-loss circuit".', link: `routine:${raviPlan.id}` },
    ago(10),
  );

  // ---- workout logs: Ravi over the last three weeks, plus a couple for others ----
  const exerciseName = db.prepare('SELECT name FROM exercises WHERE id = ?');
  const logWorkout = (user: string, r: { id: string; name: string; items: RoutineItem[] }, at: Date, extraKg: number) => {
    const id = randomUUID();
    const started = new Date(at.getTime() - 50 * 60_000);
    const sets: Array<[string, number, number, number | null]> = [];
    for (const [ex, n, reps, kg] of r.items) {
      for (let s = 1; s <= n; s++) sets.push([ex, s, reps, kg === null ? null : kg + extraKg]);
    }
    const volume = sets.reduce((sum, [, , reps, kg]) => sum + reps * (kg ?? 0), 0);
    db.prepare(
      `INSERT INTO workout_logs (id, gym_id, user_id, routine_id, routine_name, started_at, completed_at, day, total_volume_kg, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(id, gym.id, user, r.id, r.name, started.toISOString(), at.toISOString(), dayKey(at, gym.timezone), volume, at.toISOString());
    const insertSet = db.prepare(
      `INSERT INTO workout_sets (id, workout_id, gym_id, exercise_id, exercise_name, position, set_number, reps, weight_kg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    sets.forEach(([ex, n, reps, kg], i) =>
      insertSet.run(randomUUID(), id, gym.id, ex, (exerciseName.get(ex) as { name: string }).name, i, n, reps, kg),
    );
  };
  const raviSessions: Array<[number, typeof fullBody, number]> = [
    [20, fullBody, 0],
    [17, legDay, 0],
    [13, pushDay, 0],
    [10, fullBody, 2],
    [8, raviPlan, 0],
    [6, legDay, 2.5],
    [3, pushDay, 2.5],
    [1, raviPlan, 0],
  ];
  for (const [d, r, extra] of raviSessions) logWorkout(ravi, r, ago(d, -60 * 2), extra); // ~08:00 IST
  logWorkout(arjun, pushDay, ago(2), 5);
  logWorkout(karan, legDay, ago(4), 10);

  // ---- measurements (personal) ----
  const measure = db.prepare(
    'INSERT INTO measurements (id, user_id, measured_on, weight_kg, body_fat_pct, waist_cm, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const [d, kg, fat, waist] of [
    [21, 84.0, 27.5, 96],
    [14, 83.2, null, null],
    [7, 82.1, 26.4, 94],
    [1, 81.0, null, 93],
  ] as const) {
    measure.run(randomUUID(), ravi, addDays(today, -d), kg, fat, waist, ago(d).toISOString());
  }
  db.prepare('UPDATE profiles SET weight_kg = 81 WHERE user_id = ?').run(ravi);

  // ---- resources ----
  const article = (kind: string, title: string, summary: string, body: string, tags: string[], daysAgo: number, videoUrl: string | null = null) => {
    const id = randomUUID();
    const at = ago(daysAgo).toISOString();
    db.prepare(
      `INSERT INTO articles (id, gym_id, kind, title, summary, body, image_url, video_url, tags, author_id, published_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run(id, gym.id, kind, title, summary, body, videoUrl, JSON.stringify(tags), owner, at, at);
    return id;
  };
  article(
    'article',
    'How to warm up properly (and why it matters)',
    'Ten minutes before you lift saves you weeks of sore joints. Here is the warm-up our coaches use.',
    [
      'Most gym injuries we see at Flex happen in the first fifteen minutes of a session, when people walk in from a cold car or a long day at a desk and go straight to their working weight.',
      'A good warm-up does three things. It raises your body temperature, so muscles and tendons are more elastic. It moves your joints through the range you are about to use. And it rehearses the movement pattern, so your first heavy set is not also your first attempt of the day.',
      'Start with five minutes of easy cardio: the bike, a brisk walk on the treadmill or skipping. You should be breathing a little harder but still able to talk.',
      'Next, spend three to four minutes on mobility for the joints you will train. Before leg day that means hip circles, cat-cow and the kneeling hip flexor stretch. Before an upper-body day, try arm circles, band pull-aparts and wall slides.',
      'Finally, do two or three ramp-up sets of your first exercise. If your working squat is 50 kg, do 8 reps with the empty bar, 5 reps at 30 kg and 3 reps at 40 kg before you start your real sets.',
      'Skip long static stretches before lifting; save those for the end of your session, when they will help you relax and recover. Ask any of our trainers to walk you through the routine the next time you are in.',
    ].join('\n\n'),
    ['warm-up', 'injury prevention', 'beginner'],
    12,
  );
  const proteinArticle = article(
    'article',
    'Getting enough protein on a vegetarian diet',
    'Dal, paneer, curd and chana can get you there. A simple plan for 80-100 g of protein a day.',
    [
      'If you are training regularly, aim for roughly 1.6 g of protein per kilogram of body weight each day. For a 70 kg member that is about 110 g, which sounds like a lot until you spread it across your meals.',
      'Start with breakfast, the meal most of us under-do. Two moong dal chillas with a bowl of curd give you around 25 g. Swap your morning poha for besan chilla or a paneer sandwich and you are off to a strong start.',
      'At lunch and dinner, make dal thicker and have a second katori. Add a side of sprouts, a paneer or tofu sabzi, or rajma and chole a few times a week. Soya chunks are one of the cheapest sources of protein you can buy: 50 g dry gives you about 25 g of protein.',
      'Snacks are where protein quietly disappears. Replace biscuits and namkeen with roasted chana, a glass of buttermilk, a handful of peanuts or Greek-style hung curd with fruit.',
      'If you still fall short, a whey or plant protein shake is a convenient top-up, not a requirement. Talk to the front desk if you would like a nutrition consult with one of our coaches.',
    ].join('\n\n'),
    ['nutrition', 'protein', 'vegetarian'],
    8,
  );
  article(
    'video',
    'Squat form in three minutes',
    'Coach Vikram breaks down the barbell back squat: stance, depth and bracing.',
    'Watch this before your next leg day. Pay attention to how the knees track over the toes and how the chest stays up out of the bottom of the squat.',
    ['technique', 'legs', 'squat'],
    5,
    'https://videos.flexfitness.example/squat-form.mp4',
  );
  article(
    'tip',
    'Drink water before you feel thirsty',
    'Bring a one-litre bottle and finish it by the end of your session.',
    'By the time you feel thirsty you are already a little dehydrated, and your strength and focus drop with it. Sip between sets and refill at the cooler by the stretching area.',
    ['hydration', 'recovery'],
    3,
  );
  article(
    'tip',
    'Sleep is part of your training',
    'Seven to eight hours is when the muscle you trained for actually gets built.',
    'Late nights undo good workouts. Try to keep the same bedtime on weekdays and weekends, and put your phone away half an hour before you sleep.',
    ['recovery', 'sleep'],
    1,
  );

  // ---- nutrition ----
  const mealPlan = (title: string, goal: string, description: string, kcal: number, meals: object[], daysAgo: number) => {
    db.prepare(
      `INSERT INTO meal_plans (id, gym_id, title, goal, description, calories_per_day, meals, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), gym.id, title, goal, description, kcal, JSON.stringify(meals), owner, ago(daysAgo).toISOString());
  };
  mealPlan(
    'Vegetarian fat loss',
    'lose_weight',
    'A simple Indian vegetarian day at about 1,600 kcal with 90 g of protein. Keep oil to 3 teaspoons a day.',
    1600,
    [
      { slot: 'breakfast', title: 'Moong dal chilla with curd', description: '2 chillas, mint chutney and a small bowl of curd', calories: 380, proteinG: 24 },
      { slot: 'lunch', title: 'Phulka, dal and sabzi', description: '2 phulkas, 1 katori dal, mixed veg sabzi and salad', calories: 480, proteinG: 20 },
      { slot: 'snack', title: 'Roasted chana and buttermilk', description: 'A handful of roasted chana with a glass of chaas', calories: 220, proteinG: 12 },
      { slot: 'dinner', title: 'Paneer tikka with sauteed vegetables', description: '100 g paneer tikka, sauteed capsicum and onion, 1 phulka', calories: 520, proteinG: 34 },
    ],
    20,
  );
  mealPlan(
    'High-protein muscle gain',
    'build_muscle',
    'About 2,600 kcal and 140 g of protein for training days. Eggs and chicken can be swapped for paneer or soya.',
    2600,
    [
      { slot: 'breakfast', title: 'Egg bhurji, toast and milk', description: '2 whole eggs + 3 whites, 2 slices of toast, a glass of milk', calories: 600, proteinG: 42 },
      { slot: 'lunch', title: 'Chicken curry, rice and dal', description: '150 g chicken, 1 cup rice, 1 katori dal, salad', calories: 780, proteinG: 52 },
      { slot: 'snack', title: 'Banana peanut butter smoothie', description: 'Milk, banana, 1 tbsp peanut butter, a scoop of whey (optional)', calories: 480, proteinG: 30 },
      { slot: 'dinner', title: 'Soya chunk pulao with raita', description: 'Soya and vegetable pulao with a bowl of cucumber raita', calories: 740, proteinG: 38 },
    ],
    18,
  );
  const mealIdea = (
    title: string,
    mealType: string,
    macros: [kcal: number, protein: number, carbs: number, fat: number],
    ingredients: string[],
    steps: string[],
    tags: string[],
    daysAgo: number,
  ) => {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO meal_ideas (id, gym_id, title, meal_type, calories, protein_g, carbs_g, fat_g, ingredients, steps, image_url, tags, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).run(id, gym.id, title, mealType, ...macros, JSON.stringify(ingredients), JSON.stringify(steps), JSON.stringify(tags), owner, ago(daysAgo).toISOString());
    return id;
  };
  const chilla = mealIdea(
    'Moong dal chilla',
    'breakfast',
    [280, 16, 34, 7],
    ['1/2 cup yellow moong dal, soaked 4 hours', '1 green chilli', 'Small piece of ginger', '2 tbsp chopped onion and coriander', '1 tsp oil'],
    ['Grind the soaked dal with chilli, ginger and a little water to a smooth batter.', 'Stir in onion, coriander and a pinch of salt.', 'Spread thin on a hot tawa, drizzle with oil and cook both sides until golden.'],
    ['vegetarian', 'high-protein', 'quick'],
    15,
  );
  mealIdea(
    'Paneer bhurji wrap',
    'lunch',
    [420, 24, 38, 18],
    ['100 g paneer, crumbled', '1 whole-wheat roti', '1 onion and 1 tomato, chopped', '1/4 tsp haldi and 1/2 tsp garam masala', 'Handful of lettuce'],
    ['Saute onion and tomato with the spices until soft.', 'Add the paneer and cook for 2 minutes.', 'Fill the roti with lettuce and bhurji and roll it up.'],
    ['vegetarian', 'high-protein', 'lunchbox'],
    14,
  );
  mealIdea(
    'Masala roasted chana',
    'snack',
    [180, 9, 26, 4],
    ['1/2 cup roasted chana', '1/2 tsp chaat masala', 'Squeeze of lemon', 'Chopped onion and tomato (optional)'],
    ['Toss everything together in a bowl.', 'Eat straight away so the chana stays crunchy.'],
    ['vegetarian', 'vegan', 'quick', 'budget'],
    13,
  );
  mealIdea(
    'Chicken tikka with kachumber',
    'dinner',
    [380, 38, 12, 18],
    ['150 g boneless chicken', '3 tbsp hung curd', '1 tsp ginger-garlic paste', '1 tsp tikka masala', 'Cucumber, onion and tomato for the kachumber'],
    ['Marinate the chicken in curd, ginger-garlic paste and spices for at least 30 minutes.', 'Grill or air-fry at 200 C for 15 minutes, turning once.', 'Serve with kachumber dressed with lemon and salt.'],
    ['high-protein', 'low-carb'],
    12,
  );

  // ---- favourites ----
  const fav = db.prepare('INSERT OR IGNORE INTO favourites (gym_id, user_id, kind, item_id, created_at) VALUES (?, ?, ?, ?, ?)');
  fav.run(gym.id, ravi, 'article', proteinArticle, ago(6).toISOString());
  fav.run(gym.id, ravi, 'meal_idea', chilla, ago(5).toISOString());
  fav.run(gym.id, ravi, 'routine', legDay.id, ago(4).toISOString());

  // ---- challenges ----
  const monthStart = `${today.slice(0, 8)}01`;
  const [y, m] = today.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const challenge = (title: string, description: string, metric: string, target: number, startsOn: string, endsOn: string, at: Date) => {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO challenges (id, gym_id, title, description, metric, target, starts_on, ends_on, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, gym.id, title, description, metric, target, startsOn, endsOn, owner, at.toISOString());
    notifyGym(db, gym.id, { kind: 'challenge', title: `New challenge: ${title}`, body: description, link: `challenge:${id}` }, at, {
      exceptUserId: owner,
    });
    return id;
  };
  const join = db.prepare('INSERT OR IGNORE INTO challenge_participants (challenge_id, gym_id, user_id, joined_at) VALUES (?, ?, ?, ?)');
  const monthly = challenge(
    `30 check-ins in ${monthName}`,
    `Check in every day of ${monthName}. Everyone who makes it gets the Challenger badge and a free Flex T-shirt.`,
    'checkins',
    30,
    monthStart,
    monthEnd,
    new Date(`${monthStart}T03:30:00.000Z`) < now ? new Date(`${monthStart}T03:30:00.000Z`) : ago(0, 60),
  );
  for (const [i, u] of [ravi, anita, karan, sneha].entries()) join.run(monthly, gym.id, u, ago(7, -i * 30).toISOString());
  const monday = mondayOf(today);
  const weekly = challenge(
    'Five workouts this week',
    'Log five workouts between Monday and Sunday. Any routine counts.',
    'workouts',
    5,
    monday,
    addDays(monday, 6),
    new Date(Math.min(now.getTime() - 60 * 60_000, new Date(`${monday}T02:30:00.000Z`).getTime())),
  );
  for (const u of [ravi, arjun, karan]) join.run(weekly, gym.id, u, ago(0, 30).toISOString());

  // ---- community feed ----
  const post = (author: string, body: string, at: Date, likers: string[], comments: Array<[string, string, number]>) => {
    const id = randomUUID();
    db.prepare('INSERT INTO posts (id, gym_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(id, gym.id, author, body, at.toISOString());
    for (const l of likers) {
      db.prepare('INSERT OR IGNORE INTO post_likes (post_id, gym_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(id, gym.id, l, at.toISOString());
    }
    for (const [who, text, minutesLater] of comments) {
      db.prepare('INSERT INTO comments (id, gym_id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        randomUUID(),
        gym.id,
        id,
        who,
        text,
        new Date(at.getTime() + minutesLater * 60_000).toISOString(),
      );
    }
  };
  post(
    coach,
    'Form tip: on rows, pull your elbows towards your back pockets, not up to your chest. You will feel your lats doing the work instead of your arms.',
    ago(9),
    [ravi, arjun, anita],
    [[arjun, 'This fixed my rows instantly, thanks coach!', 90]],
  );
  post(anita, 'Anyone up for the Morning Yoga class tomorrow? Looking for a buddy to keep me honest.', ago(4), [sneha], [
    [sneha, 'Count me in! See you at 7.', 25],
  ]);
  post(karan, `Day 5 of the ${monthName} check-in challenge done. Who else is in?`, ago(3), [ravi, anita, sneha], [
    [ravi, 'Me! Missed a couple of days but catching up.', 40],
    [anita, 'Same here, let us keep each other going.', 75],
  ]);
  post(ravi, 'Hit 52.5 kg on the squat today, my heaviest ever. Thanks Coach Vikram for fixing my depth!', ago(1, -60 * 3), [coach, anita, karan, arjun], [
    [coach, 'Great depth too. Next stop 60!', 20],
    [anita, 'Congrats Ravi!', 45],
  ]);

  // ---- help & support ----
  db.prepare(
    `INSERT INTO support_info (gym_id, phone, whatsapp, email, address, hours, faqs, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    gym.id,
    '+91 20 4000 4242',
    '+91 99999 00001',
    'hello@flexfitness.example',
    '2nd floor, Lane 5, Koregaon Park, Pune 411001',
    'Mon-Sat 5:30 am - 10:30 pm, Sun 7 am - 12 pm',
    JSON.stringify([
      { q: 'Can I freeze my membership?', a: 'Yes. Quarterly and yearly plans can be frozen once for up to 15 days. Ask at the front desk or message us here.' },
      { q: 'Do you have lockers and showers?', a: 'Free lockers (bring your own lock) and hot showers in both changing rooms. Towels are Rs 20.' },
      { q: 'Can I bring a friend?', a: 'Every member gets one free guest pass a month. Your friend just needs to show photo ID at reception.' },
      { q: 'How do I book a personal training session?', a: 'Message us here or ask Coach Vikram on the floor. PT sessions are 45 minutes and can be booked a week ahead.' },
      { q: 'What are the Diwali and holiday timings?', a: 'We post holiday timings in Announcements at least a week in advance.' },
    ]),
    ago(20).toISOString(),
  );
  const ticketId = randomUUID();
  const asked = ago(3, -60);
  const replied = ago(2, -60 * 4);
  db.prepare("INSERT INTO support_tickets (id, gym_id, user_id, subject, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'answered', ?, ?)").run(
    ticketId,
    gym.id,
    ravi,
    'Can I freeze my membership in December?',
    asked.toISOString(),
    replied.toISOString(),
  );
  const message = db.prepare('INSERT INTO ticket_messages (id, gym_id, ticket_id, author_id, from_role, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  message.run(
    randomUUID(),
    gym.id,
    ticketId,
    ravi,
    'member',
    'I am travelling for work from 10 to 20 December. Can I pause my membership for those days?',
    asked.toISOString(),
  );
  const reply = 'Yes! We can freeze your plan for those 10 days and extend your end date to match. We will set it up when you renew this week.';
  message.run(randomUUID(), gym.id, ticketId, owner, 'staff', reply, replied.toISOString());
  notify(
    db,
    gym.id,
    ravi,
    { kind: 'support_reply', title: 'Reply: Can I freeze my membership in December?', body: reply, link: `ticket:${ticketId}` },
    replied,
  );

  // ---- a booking for Ravi (next class on the home screen) and some older notifications ----
  const yoga = db
    .prepare("SELECT * FROM class_sessions WHERE gym_id = ? AND title = 'Morning Yoga' AND starts_at > ? ORDER BY starts_at LIMIT 1")
    .get(gym.id, now.toISOString()) as store.Row | undefined;
  if (yoga) {
    db.prepare("INSERT OR IGNORE INTO bookings (id, gym_id, session_id, user_id, status, created_at) VALUES (?, ?, ?, ?, 'booked', ?)").run(
      randomUUID(),
      gym.id,
      yoga.id as string,
      ravi,
      ago(0, 90).toISOString(),
    );
    notify(db, gym.id, ravi, { kind: 'booking', title: 'Class booked', body: "You're booked for Morning Yoga tomorrow.", link: 'classes' }, ago(0, 90));
  }
  notify(
    db,
    gym.id,
    ravi,
    { kind: 'announcement', title: 'Diwali timings', body: 'We are open 6am to 12pm on Diwali day. Happy Diwali from the Flex family!', link: 'announcements' },
    ago(14),
  );
  // Everything older than a week has been read already.
  db.prepare('UPDATE notifications SET read_at = ? WHERE gym_id = ? AND user_id = ? AND created_at < ?').run(
    ago(6).toISOString(),
    gym.id,
    ravi,
    ago(7).toISOString(),
  );

  for (const u of [ravi, anita, karan, sneha, arjun, coach]) store.syncBadges(db, gym, u, now);
}
