import type {
  Article,
  Challenge,
  Comment,
  Exercise,
  LeaderboardEntry,
  MealIdea,
  MealPlan,
  Post,
  Routine,
  SupportInfo,
  SupportTicket,
  WorkoutLog,
} from '@gymverse/shared';

export function makeExercise(o: Partial<Exercise> & Pick<Exercise, 'id' | 'name'>): Exercise {
  return { muscleGroup: 'legs', equipment: 'barbell', instructions: [], videoUrl: null, builtIn: true, ...o };
}

export const EXERCISES: Exercise[] = [
  makeExercise({ id: 'ex_squat', name: 'Back squat', muscleGroup: 'legs', instructions: ['Brace', 'Sit back'] }),
  makeExercise({ id: 'ex_lunge', name: 'Walking lunge', muscleGroup: 'legs', equipment: 'dumbbell' }),
  makeExercise({ id: 'ex_bench', name: 'Bench press', muscleGroup: 'chest' }),
  makeExercise({ id: 'ex_plank', name: 'Plank', muscleGroup: 'core', equipment: 'mat' }),
  makeExercise({ id: 'gym-ex-1', name: 'Sled push', muscleGroup: 'full_body', equipment: 'none', builtIn: false }),
];

export function makeRoutine(o: Partial<Routine> = {}): Routine {
  return {
    id: 'r-1',
    name: 'Beginner full body',
    description: 'Three moves, twice a week',
    level: 'beginner',
    kind: 'preset',
    durationMin: 20,
    createdBy: { id: 'u-vikram', name: 'Coach Vikram' },
    exercises: [
      { exerciseId: 'ex_squat', exercise: EXERCISES[0], sets: 3, reps: 10, weightKg: 40, restSec: 90 },
      { exerciseId: 'ex_bench', exercise: EXERCISES[2], sets: 3, reps: 8, weightKg: null, restSec: 60 },
    ],
    assignment: null,
    favourite: false,
    createdAt: '2026-11-01T10:00:00.000Z',
    ...o,
  };
}

export const WORKOUTS: WorkoutLog[] = [
  {
    id: 'w-1',
    routineId: 'r-1',
    routineName: 'Beginner full body',
    startedAt: '2026-11-06T12:00:00.000Z',
    completedAt: '2026-11-06T12:40:00.000Z',
    durationMin: 40,
    sets: [
      { exerciseId: 'ex_squat', exerciseName: 'Back squat', setNumber: 1, reps: 10, weightKg: 40 },
      { exerciseId: 'ex_squat', exerciseName: 'Back squat', setNumber: 2, reps: 8, weightKg: 45 },
      { exerciseId: 'ex_plank', exerciseName: 'Plank', setNumber: 3, reps: 1, weightKg: null },
    ],
    totalVolumeKg: 760,
    notes: 'Felt strong',
  },
];

export function makeArticle(o: Partial<Article> = {}): Article {
  return {
    id: 'a-1',
    kind: 'article',
    title: 'Warm up properly',
    summary: 'Five minutes that save your knees',
    body: 'Start with light cardio.',
    imageUrl: null,
    videoUrl: null,
    tags: ['mobility'],
    readMinutes: 1,
    publishedAt: '2026-11-02T10:00:00.000Z',
    author: { id: 'user-owner', name: 'Priya Sharma' },
    favourite: false,
    ...o,
  };
}

export function makeMealPlan(o: Partial<MealPlan> = {}): MealPlan {
  return {
    id: 'mp-1',
    title: 'Lean bulk',
    goal: 'build_muscle',
    description: '',
    caloriesPerDay: 2600,
    meals: [{ slot: 'breakfast', title: 'Oats & whey', description: '', calories: 550, proteinG: 40 }],
    favourite: false,
    ...o,
  };
}

export function makeMealIdea(o: Partial<MealIdea> = {}): MealIdea {
  return {
    id: 'mi-1',
    title: 'Paneer wrap',
    mealType: 'lunch',
    calories: 480,
    proteinG: 28,
    carbsG: 45,
    fatG: 18,
    ingredients: ['Paneer', 'Roti'],
    steps: ['Grill', 'Wrap'],
    imageUrl: null,
    tags: [],
    favourite: false,
    ...o,
  };
}

export function makePost(o: Partial<Post> = {}): Post {
  return {
    id: 'p-1',
    author: { id: 'u-ravi', name: 'Ravi Kumar', role: 'member' },
    body: 'New PR on squats today!',
    createdAt: '2026-11-07T08:00:00.000Z',
    likeCount: 4,
    commentCount: 1,
    likedByMe: false,
    mine: false,
    hidden: false,
    ...o,
  };
}

export const COMMENTS: Comment[] = [
  { id: 'c-1', author: { id: 'u-anita', name: 'Anita Desai' }, body: 'Nice one!', createdAt: '2026-11-07T09:00:00.000Z', mine: false },
];

export function makeChallenge(o: Partial<Challenge> = {}): Challenge {
  return {
    id: 'ch-1',
    title: 'November 12 visits',
    description: '',
    metric: 'checkins',
    target: 12,
    startsOn: '2026-11-01',
    endsOn: '2026-11-30',
    status: 'active',
    participantCount: 2,
    joined: false,
    myProgress: 0,
    myRank: null,
    ...o,
  };
}

export const LEADERBOARD: LeaderboardEntry[] = [
  { rank: 1, user: { id: 'u-ravi', name: 'Ravi Kumar' }, progress: 12, completed: true, isMe: false },
  { rank: 2, user: { id: 'u-anita', name: 'Member' }, progress: 5, completed: false, isMe: false },
];

export const SUPPORT_INFO: SupportInfo = {
  phone: '+919999900001',
  whatsapp: null,
  email: null,
  address: 'FC Road, Pune',
  hours: null,
  faqs: [{ q: 'Is parking free?', a: 'Yes, for members.' }],
};

export function makeTicket(o: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: 't-1',
    subject: 'Freeze my membership',
    status: 'open',
    createdAt: '2026-11-06T10:00:00.000Z',
    updatedAt: '2026-11-06T10:00:00.000Z',
    member: { id: 'u-ravi', name: 'Ravi Kumar' },
    messages: [
      { id: 'm-1', from: 'member', author: { id: 'u-ravi', name: 'Ravi Kumar' }, body: 'I am travelling for 2 weeks.', at: '2026-11-06T10:00:00.000Z' },
    ],
    ...o,
  };
}
