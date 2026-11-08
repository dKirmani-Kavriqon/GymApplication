import type { WorkoutSet } from '@gymverse/shared';

export interface ExerciseSummary {
  exerciseId: string;
  name: string;
  /** e.g. "10 × 40 kg, 8 × 45 kg" or "12, 12, 10" for bodyweight sets. */
  sets: string;
  count: number;
}

const kg = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} kg`;

/** Groups a workout's sets by exercise, keeping the order they were done in. */
export function summarizeSets(sets: WorkoutSet[]): ExerciseSummary[] {
  const groups = new Map<string, { name: string; sets: WorkoutSet[] }>();
  for (const s of [...sets].sort((a, b) => a.setNumber - b.setNumber)) {
    const g = groups.get(s.exerciseId) ?? { name: s.exerciseName, sets: [] };
    g.sets.push(s);
    groups.set(s.exerciseId, g);
  }
  return [...groups.entries()].map(([exerciseId, g]) => ({
    exerciseId,
    name: g.name,
    count: g.sets.length,
    sets: g.sets.map((s) => (s.weightKg ? `${s.reps} × ${kg(s.weightKg)}` : `${s.reps}`)).join(', '),
  }));
}

/** "1,250 kg" */
export function formatVolume(volumeKg: number): string {
  return `${Math.round(volumeKg).toLocaleString('en-IN')} kg`;
}

/** Rough routine length, as the API computes it: sets × (40s work + rest). */
export function estimateMinutes(rows: Array<{ sets: number; restSec: number }>): number {
  const sec = rows.reduce((sum, r) => sum + (r.sets || 0) * (40 + (r.restSec || 0)), 0);
  return Math.max(1, Math.round(sec / 60));
}
