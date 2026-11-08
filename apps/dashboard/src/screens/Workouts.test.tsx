import { screen, waitFor, within } from '@testing-library/react';
import type { Role, Routine } from '@gymverse/shared';
import { Workouts } from './Workouts';
import { apiError, installFakeApi, type Routes } from '../test/fakeApi';
import { MEMBERS, makeGym } from '../test/fixtures';
import { EXERCISES, makeExercise, makeRoutine } from '../test/fixtures2';
import { renderUi } from '../test/render';

function setup(opts: { role?: Role; presets?: Routine[]; routes?: Routes } = {}) {
  const fake = installFakeApi({
    'GET /gyms/:gymId/routines': { assigned: [], presets: opts.presets ?? [makeRoutine()], mine: [] },
    'GET /gyms/:gymId/exercises': { exercises: EXERCISES },
    'GET /gyms/:gymId/members': { members: MEMBERS },
    'POST /gyms/:gymId/routines': (req) => ({
      status: 201,
      body: makeRoutine({ id: 'r-new', ...(req.body as object), exercises: [], createdBy: { id: 'user-owner', name: 'Priya Sharma' } }),
    }),
    'PATCH /gyms/:gymId/routines/:id': (req) => makeRoutine({ ...(req.body as object), exercises: makeRoutine().exercises }),
    'DELETE /gyms/:gymId/routines/:id': { status: 204 },
    'POST /gyms/:gymId/routines/:id/assign': { assigned: true },
    'POST /gyms/:gymId/exercises': (req) => ({ status: 201, body: makeExercise({ id: 'gym-ex-9', builtIn: false, ...(req.body as object) } as never) }),
    ...opts.routes,
  });
  const utils = renderUi(<Workouts gym={makeGym()} role={opts.role ?? 'owner'} myUserId="user-owner" />);
  return { ...utils, fake };
}

async function setNumber(user: ReturnType<typeof setup>['user'], label: string, value: string) {
  const input = screen.getByLabelText(label);
  await user.clear(input);
  if (value) await user.type(input, value);
}

describe('Workouts: routines', () => {
  it('lists preset routines with their exercises', async () => {
    setup();
    const card = await screen.findByTestId('routine-card');
    expect(within(card).getByRole('heading', { name: 'Beginner full body' })).toBeInTheDocument();
    expect(within(card).getByText('Beginner')).toBeInTheDocument();
    expect(within(card).getByText('Back squat')).toBeInTheDocument();
    expect(within(card).getByText('3 × 10 · 40 kg')).toBeInTheDocument();
    expect(within(card).getByText(/2 exercises · ~20 min · by Coach Vikram/)).toBeInTheDocument();
  });

  it('creates a preset routine with two exercises and sends the right body', async () => {
    const { user, fake } = setup({ presets: [] });
    await screen.findByText(/No preset routines yet/);
    await user.click(screen.getByRole('button', { name: 'New routine' }));
    const form = screen.getByRole('form', { name: 'New routine' });

    // Nothing picked yet: blocked before the API.
    await user.type(within(form).getByLabelText('Routine name'), 'Leg day');
    await user.click(within(form).getByRole('button', { name: 'Create routine' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Add at least one exercise.');

    await user.selectOptions(within(form).getByLabelText('Level'), 'intermediate');
    await user.selectOptions(within(form).getByLabelText('Exercise to add'), 'ex_squat');
    await user.click(within(form).getByRole('button', { name: 'Add exercise' }));
    await user.selectOptions(within(form).getByLabelText('Exercise to add'), 'ex_lunge');
    await user.click(within(form).getByRole('button', { name: 'Add exercise' }));
    expect(within(form).getAllByTestId('routine-row')).toHaveLength(2);

    await setNumber(user, 'Sets for Back squat', '4');
    await setNumber(user, 'Reps for Back squat', '8');
    await setNumber(user, 'Weight for Back squat', '60');
    await setNumber(user, 'Rest for Back squat', '90');
    await user.click(within(form).getByRole('button', { name: 'Create routine' }));

    expect(await screen.findByText('Routine created')).toBeInTheDocument();
    const calls = fake.callsTo('POST /gyms/:gymId/routines');
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({
      name: 'Leg day',
      description: null,
      level: 'intermediate',
      kind: 'preset',
      exercises: [
        { exerciseId: 'ex_squat', sets: 4, reps: 8, weightKg: 60, restSec: 90 },
        { exerciseId: 'ex_lunge', sets: 3, reps: 10, weightKg: null, restSec: 60 },
      ],
    });
    expect(screen.queryByRole('form', { name: 'New routine' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Leg day' })).toBeInTheDocument();
  });

  it('validates reps with the shared schema before calling the API', async () => {
    const { user, fake } = setup({ presets: [] });
    await screen.findByText(/No preset routines yet/);
    await user.click(screen.getByRole('button', { name: 'New routine' }));
    await user.type(screen.getByLabelText('Routine name'), 'Odd');
    await user.selectOptions(screen.getByLabelText('Exercise to add'), 'ex_bench');
    await user.click(screen.getByRole('button', { name: 'Add exercise' }));
    await setNumber(user, 'Reps for Bench press', '0');
    await user.click(screen.getByRole('button', { name: 'Create routine' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Reps (row 1)');
    expect(fake.callsTo('POST /gyms/:gymId/routines')).toHaveLength(0);
  });

  it('edits a routine: reorders, removes an exercise and PATCHes', async () => {
    const { user, fake } = setup();
    await screen.findByTestId('routine-card');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit routine' });
    expect(within(form).getByLabelText('Routine name')).toHaveValue('Beginner full body');
    await user.click(within(form).getByRole('button', { name: 'Move Bench press up' }));
    await user.click(within(form).getByRole('button', { name: 'Remove Back squat' }));
    await user.clear(within(form).getByLabelText('Routine name'));
    await user.type(within(form).getByLabelText('Routine name'), 'Upper body');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Routine saved');
    const call = fake.callsTo('PATCH /gyms/:gymId/routines/:id')[0];
    expect(call.params.id).toBe('r-1');
    expect(call.body).toMatchObject({
      name: 'Upper body',
      kind: 'preset',
      exercises: [{ exerciseId: 'ex_bench', sets: 3, reps: 8, weightKg: null, restSec: 60 }],
    });
  });

  it('assigns a routine to a member with a note', async () => {
    const { user, fake } = setup();
    await screen.findByTestId('routine-card');
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    const dialog = screen.getByRole('dialog', { name: 'Assign Beginner full body' });
    const select = within(dialog).getByLabelText('Member');
    await waitFor(() => expect(select).not.toBeDisabled());
    // Only members are offered (not trainers or owners).
    expect(within(select).queryByText(/Coach Vikram/)).not.toBeInTheDocument();
    await user.selectOptions(select, 'u-ravi');
    await user.type(within(dialog).getByLabelText('Note for the member'), '  Twice a week  ');
    await user.click(within(dialog).getByRole('button', { name: 'Assign routine' }));
    expect(await screen.findByText('Beginner full body assigned to Ravi Kumar')).toBeInTheDocument();
    const call = fake.callsTo('POST /gyms/:gymId/routines/:id/assign')[0];
    expect(call.params.id).toBe('r-1');
    expect(call.body).toEqual({ userId: 'u-ravi', note: 'Twice a week' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('assign without a note sends null and shows API errors', async () => {
    const { user, fake } = setup({
      routes: { 'POST /gyms/:gymId/routines/:id/assign': apiError(404, 'That person is not a member of this gym.', 'not_found') },
    });
    await screen.findByTestId('routine-card');
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Assign routine' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose a member.');
    await waitFor(() => expect(within(dialog).getByLabelText('Member')).not.toBeDisabled());
    await user.selectOptions(within(dialog).getByLabelText('Member'), 'u-anita');
    await user.click(within(dialog).getByRole('button', { name: 'Assign routine' }));
    expect(await within(dialog).findByText('That person is not a member of this gym.')).toBeInTheDocument();
    expect(fake.callsTo('POST /gyms/:gymId/routines/:id/assign')[0].body).toEqual({ userId: 'u-anita', note: null });
  });

  it('deletes a preset after confirming; trainers can only delete their own', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, fake } = setup();
    await screen.findByTestId('routine-card');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByTestId('routine-card')).not.toBeInTheDocument());
    expect(fake.callsTo('DELETE /gyms/:gymId/routines/:id')[0].params.id).toBe('r-1');
  });

  it('trainer sees no Delete on presets made by someone else', async () => {
    setup({ role: 'trainer' });
    await screen.findByTestId('routine-card');
    expect(screen.getByRole('button', { name: 'Assign' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

describe('Workouts: exercise library', () => {
  it('filters by muscle group and search, and marks gym exercises', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: /Exercise library/ }));
    expect(await screen.findAllByTestId('exercise')).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Legs' }));
    expect(screen.getAllByTestId('exercise').map((e) => within(e).getByText(/Back squat|Walking lunge/).textContent)).toEqual([
      'Back squat',
      'Walking lunge',
    ]);
    expect(screen.getByRole('button', { name: 'Legs' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByLabelText('Search exercises'), 'sled');
    const [sled] = screen.getAllByTestId('exercise');
    expect(screen.getAllByTestId('exercise')).toHaveLength(1);
    expect(within(sled).getByText('Your gym')).toBeInTheDocument();
    expect(within(sled).getByText('Full body · None')).toBeInTheDocument();
  });

  it('adds a custom exercise', async () => {
    const { user, fake } = setup();
    await user.click(screen.getByRole('tab', { name: /Exercise library/ }));
    await screen.findAllByTestId('exercise');
    await user.click(screen.getByRole('button', { name: 'Add exercise' }));
    const form = screen.getByRole('form', { name: 'New exercise' });
    await user.type(within(form).getByLabelText('Exercise name'), 'Battle ropes');
    await user.selectOptions(within(form).getByLabelText('Muscle group'), 'cardio');
    await user.selectOptions(within(form).getByLabelText('Equipment'), 'none');
    await user.type(within(form).getByLabelText('Instructions (one step per line)'), 'Wave the ropes{Enter}{Enter}Keep a tight core');
    await user.type(within(form).getByLabelText('Video URL'), 'not-a-url');
    await user.click(within(form).getByRole('button', { name: 'Add exercise' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Video url');
    await user.clear(within(form).getByLabelText('Video URL'));
    await user.click(within(form).getByRole('button', { name: 'Add exercise' }));
    expect(await screen.findByText('Battle ropes added to the library')).toBeInTheDocument();
    expect(fake.callsTo('POST /gyms/:gymId/exercises')[0].body).toEqual({
      name: 'Battle ropes',
      muscleGroup: 'cardio',
      equipment: 'none',
      instructions: ['Wave the ropes', 'Keep a tight core'],
      videoUrl: null,
    });
    expect(screen.getAllByTestId('exercise')).toHaveLength(6);
  });
});
