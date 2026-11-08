import { FEATURES, routineSchema, challengeSchema } from '@gymverse/shared';
import { canOpen, navFor } from './nav';
import { numOrNull, splitList, validate } from './validate';
import { estimateMinutes, formatVolume, summarizeSets } from './workouts';

const ids = (groups: ReturnType<typeof navFor>) => groups.flatMap((g) => g.items.map((i) => `${i.id}${i.state === 'disabled' ? '(off)' : ''}`));

describe('navFor', () => {
  it('gives owners and managers every section in three groups', () => {
    for (const role of ['owner', 'manager'] as const) {
      const groups = navFor(role, FEATURES);
      expect(groups.map((g) => g.items.length)).toEqual([5, 4, 4]);
      expect(ids(groups)).not.toContain('(off)');
    }
  });

  it('gives trainers only overview, members, classes, workouts and support', () => {
    expect(ids(navFor('trainer', FEATURES))).toEqual(['overview', 'members', 'classes', 'workouts', 'support']);
  });

  it('greys switched-off features for admins and hides them for trainers', () => {
    const on = ['checkin', 'classes'] as const;
    expect(ids(navFor('owner', on))).toEqual([
      'overview',
      'members',
      'classes',
      'plans',
      'revenue',
      'workouts(off)',
      'nutrition(off)',
      'resources(off)',
      'community(off)',
      'announcements(off)',
      'support(off)',
      'branding',
      'qr',
    ]);
    expect(ids(navFor('trainer', on))).toEqual(['overview', 'members', 'classes']);
    expect(canOpen('workouts', 'owner', on)).toBe(false);
    expect(canOpen('workouts', 'trainer', FEATURES)).toBe(true);
    expect(canOpen('plans', 'trainer', FEATURES)).toBe(false);
  });

  it('members get no dashboard sections', () => {
    expect(navFor('member', FEATURES)).toEqual([]);
  });
});

describe('validate', () => {
  it('returns parsed data with schema defaults', () => {
    const res = validate(routineSchema, { name: ' Legs ', exercises: [{ exerciseId: 'ex_squat', sets: 3, reps: 5 }] });
    expect(res).toEqual({
      ok: true,
      data: { name: 'Legs', level: 'beginner', kind: 'custom', exercises: [{ exerciseId: 'ex_squat', sets: 3, reps: 5, restSec: 60 }] },
    });
  });

  it('names the field (and row) of the first problem', () => {
    const res = validate(routineSchema, { name: 'Legs', exercises: [{ exerciseId: 'x', sets: 3, reps: 0 }] });
    expect(res).toEqual({ ok: false, error: 'Reps (row 1): Must be at least 1' });
    const dates = validate(challengeSchema, { title: 'Go', metric: 'checkins', target: 5, startsOn: '2026-12-02', endsOn: '2026-12-01' });
    expect(dates).toEqual({ ok: false, error: 'Ends on: The end date must be on or after the start date' });
  });

  it('helpers', () => {
    expect(splitList(' a, b,,c ')).toEqual(['a', 'b', 'c']);
    expect(numOrNull('')).toBeNull();
    expect(numOrNull(' 12.5 ')).toBe(12.5);
    expect(Number.isNaN(numOrNull('x'))).toBe(true);
  });
});

describe('workout helpers', () => {
  it('summarises sets per exercise in order', () => {
    expect(
      summarizeSets([
        { exerciseId: 'b', exerciseName: 'Plank', setNumber: 3, reps: 1, weightKg: null },
        { exerciseId: 'a', exerciseName: 'Squat', setNumber: 1, reps: 10, weightKg: 40 },
        { exerciseId: 'a', exerciseName: 'Squat', setNumber: 2, reps: 8, weightKg: 42.5 },
      ]),
    ).toEqual([
      { exerciseId: 'a', name: 'Squat', count: 2, sets: '10 × 40 kg, 8 × 42.5 kg' },
      { exerciseId: 'b', name: 'Plank', count: 1, sets: '1' },
    ]);
  });

  it('formats volume and estimates duration like the API', () => {
    expect(formatVolume(12345.6)).toBe('12,346 kg');
    expect(estimateMinutes([{ sets: 3, restSec: 60 }, { sets: 3, restSec: 90 }])).toBe(12);
    expect(estimateMinutes([])).toBe(1);
  });
});
