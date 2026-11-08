export interface BadgeDef {
  id: string;
  title: string;
  description: string;
  emoji: string;
}

export const BADGES: BadgeDef[] = [
  { id: 'first_checkin', title: 'First Step', description: 'Checked in for the first time', emoji: '👟' },
  { id: 'streak_3', title: 'On a Roll', description: '3-day streak', emoji: '🔥' },
  { id: 'streak_7', title: 'Week Warrior', description: '7-day streak', emoji: '⚡' },
  { id: 'streak_30', title: 'Unstoppable', description: '30-day streak', emoji: '🏆' },
  { id: 'checkins_10', title: 'Regular', description: '10 check-ins', emoji: '💪' },
  { id: 'checkins_50', title: 'Gym Rat', description: '50 check-ins', emoji: '🦾' },
  { id: 'first_class', title: 'Class Act', description: 'Booked your first class', emoji: '🧘' },
  { id: 'first_workout', title: 'Logged It', description: 'Logged your first workout', emoji: '📝' },
  { id: 'workouts_10', title: 'Iron Habit', description: '10 workouts logged', emoji: '🏋️' },
  { id: 'challenge_done', title: 'Challenger', description: 'Completed a gym challenge', emoji: '🥇' },
];

export interface BadgeStats {
  totalCheckIns: number;
  longestStreak: number;
  totalBookings: number;
  totalWorkouts?: number;
  challengesCompleted?: number;
}

/** All badge ids a member has earned given their stats. */
export function earnedBadges(stats: BadgeStats): string[] {
  const out: string[] = [];
  if (stats.totalCheckIns >= 1) out.push('first_checkin');
  if (stats.longestStreak >= 3) out.push('streak_3');
  if (stats.longestStreak >= 7) out.push('streak_7');
  if (stats.longestStreak >= 30) out.push('streak_30');
  if (stats.totalCheckIns >= 10) out.push('checkins_10');
  if (stats.totalCheckIns >= 50) out.push('checkins_50');
  if (stats.totalBookings >= 1) out.push('first_class');
  if ((stats.totalWorkouts ?? 0) >= 1) out.push('first_workout');
  if ((stats.totalWorkouts ?? 0) >= 10) out.push('workouts_10');
  if ((stats.challengesCompleted ?? 0) >= 1) out.push('challenge_done');
  return out;
}

export function badgeById(id: string): BadgeDef | undefined {
  return BADGES.find((b) => b.id === id);
}
