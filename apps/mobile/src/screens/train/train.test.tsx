import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { ApiError } from '../../api/client';
import { NOW, makeFakeApi, renderApp, routineFixture, workoutFixture } from '../../test/fakeApi';
import { TrainTab } from './TrainTab';
import { RoutineDetailScreen } from './RoutineDetailScreen';
import { RoutineEditorScreen } from './RoutineEditorScreen';
import { WorkoutSessionScreen } from './WorkoutSessionScreen';
import { WorkoutHistoryScreen } from './WorkoutHistoryScreen';

const myRoutine = (id: string) => routineFixture({ id, name: 'My arm day', kind: 'custom', createdBy: { id: 'u1', name: 'Ravi Kumar' } });

describe('Train tab', () => {
  it('lists coach, gym and my routines and opens a routine', async () => {
    const { nav } = renderApp(<TrainTab />);
    expect(await screen.findByText('From your coach')).toBeTruthy();
    expect(screen.getByText('Gym programmes')).toBeTruthy();
    expect(screen.getByText('My routines')).toBeTruthy();
    expect(within(screen.getByTestId('coach-note-r1')).getByText('From Coach Vikram')).toBeTruthy();
    expect(screen.getByText('“Go light this week”')).toBeTruthy();
    expect(screen.getByText('Beginner full body')).toBeTruthy();
    expect(screen.getByText('My arm day')).toBeTruthy();

    fireEvent.press(screen.getByLabelText(/^Beginner full body, Beginner, about 40 minutes, 2 exercises/));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'RoutineDetail', params: { id: 'r2' } });

    fireEvent.press(screen.getByLabelText('Build your own'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'RoutineEditor' });
  });

  it('links to the progress charts', async () => {
    const { nav } = renderApp(<TrainTab />);
    fireEvent.press(await screen.findByTestId('progress-card'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'Progress' });
  });

  it('toggles a favourite optimistically', async () => {
    const api = makeFakeApi();
    renderApp(<TrainTab />, { api });
    fireEvent.press(await screen.findByLabelText('Save Beginner full body to favourites'));
    expect(screen.getByLabelText('Remove Beginner full body from favourites')).toBeTruthy();
    expect(api.setFavourite).toHaveBeenCalledWith('gym-1', 'routine', 'r2', true);
    // the list refreshes after a favourite changes
    await waitFor(() => expect(api.routines).toHaveBeenCalledTimes(2));
    await screen.findByLabelText('Save Push day to favourites');
  });

  it('rolls a favourite back when the server fails', async () => {
    const api = makeFakeApi({
      setFavourite: async () => {
        throw new ApiError(500, 'error', 'Server is busy');
      },
    });
    renderApp(<TrainTab />, { api });
    fireEvent.press(await screen.findByLabelText('Save My arm day to favourites'));
    expect(await screen.findByText('Server is busy')).toBeTruthy();
    expect(screen.getByLabelText('Save My arm day to favourites')).toBeTruthy();
  });

  it('shows workout history and expands the sets', async () => {
    renderApp(<TrainTab />);
    await screen.findByText('From your coach');
    fireEvent.press(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('42 min · 740 kg · 2 sets')).toBeTruthy();
    expect(screen.queryByText('Set 2: 8 reps × 42.5 kg')).toBeNull();
    fireEvent.press(screen.getByLabelText(/^Push day, .*Show sets/));
    expect(screen.getByText('Set 2: 8 reps × 42.5 kg')).toBeTruthy();
  });

  it('shows the API error with a retry', async () => {
    let fail = true;
    const api = makeFakeApi({
      routines: async () => {
        if (fail) throw new ApiError(0, 'network', 'No internet connection.');
        return { assigned: [], presets: [], mine: [] };
      },
    });
    renderApp(<TrainTab />, { api });
    expect(await screen.findByText('No internet connection.')).toBeTruthy();
    fail = false;
    fireEvent.press(screen.getByLabelText('Try again'));
    expect(await screen.findByText('Make it your own')).toBeTruthy();
  });
});

describe('Workout history screen', () => {
  it('lists a quick workout and an empty state', async () => {
    const api = makeFakeApi({ workouts: async () => ({ workouts: [workoutFixture({ routineId: null, routineName: null })] }) });
    renderApp(<WorkoutHistoryScreen />, { api });
    expect(await screen.findByText('Quick workout')).toBeTruthy();
  });

  it('shows an empty state', async () => {
    const api = makeFakeApi({ workouts: async () => ({ workouts: [] }) });
    renderApp(<WorkoutHistoryScreen />, { api });
    expect(await screen.findByText('No workouts yet')).toBeTruthy();
  });
});

describe('Routine detail', () => {
  it('shows the hero, coach note and exercises, and starts a workout', async () => {
    const api = makeFakeApi({ routine: async (_g: string, id: string) => routineFixture({ id, assignment: { by: { id: 'coach', name: 'Coach Vikram' }, note: 'Go light this week', at: '2026-11-07T00:00:00Z' } }) });
    const { nav } = renderApp(<RoutineDetailScreen params={{ id: 'r1' }} />, { api });
    expect(await screen.findByText('Bench press')).toBeTruthy();
    expect(screen.getByText('Assigned by Coach Vikram')).toBeTruthy();
    expect(screen.getByText('3 × 10 @ 40 kg')).toBeTruthy();
    expect(screen.getByText('Rest 90 s')).toBeTruthy();
    expect(screen.getByText('Chest · Barbell')).toBeTruthy();
    expect(screen.queryByText('Edit')).toBeNull();

    fireEvent.press(screen.getByLabelText('Show how to do Goblet squat'));
    expect(screen.getByText('2. Sit back and down')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Start workout'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'WorkoutSession', params: { routineId: 'r1' } });
  });

  it('lets me edit and delete my own routine with an in-page confirm', async () => {
    const api = makeFakeApi({ routine: async (_g: string, id: string) => myRoutine(id) });
    const { nav } = renderApp(<RoutineDetailScreen params={{ id: 'r3' }} />, { api });
    fireEvent.press(await screen.findByLabelText('Edit'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'RoutineEditor', params: { id: 'r3' } });

    fireEvent.press(screen.getByLabelText('Delete routine'));
    expect(screen.getByText('Delete “My arm day”?')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Keep it'));
    expect(screen.queryByTestId('confirm-delete')).toBeNull();
    expect(api.deleteRoutine).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Delete routine'));
    fireEvent.press(within(screen.getByTestId('confirm-delete')).getByLabelText('Delete'));
    await waitFor(() => expect(api.deleteRoutine).toHaveBeenCalledWith('gym-1', 'r3'));
    expect(await screen.findByText('Routine deleted')).toBeTruthy();
  });

  it('toggles the favourite from the header', async () => {
    const api = makeFakeApi();
    renderApp(<RoutineDetailScreen params={{ id: 'r1' }} />, { api });
    fireEvent.press(await screen.findByLabelText('Save Push day to favourites'));
    expect(api.setFavourite).toHaveBeenCalledWith('gym-1', 'routine', 'r1', true);
  });

  it('shows the API message when the routine cannot load', async () => {
    const api = makeFakeApi({
      routine: async () => {
        throw new ApiError(404, 'not_found', 'Routine not found');
      },
    });
    renderApp(<RoutineDetailScreen params={{ id: 'nope' }} />, { api });
    expect(await screen.findByText('Routine not found')).toBeTruthy();
  });
});

describe('Routine editor', () => {
  it('builds a routine with two exercises from the picker and sends the right body', async () => {
    const api = makeFakeApi();
    const { nav } = renderApp(<RoutineEditorScreen params={{}} />, { api });
    fireEvent.changeText(await screen.findByLabelText('Name'), '  Leg day  ');
    fireEvent.press(screen.getByLabelText('Intermediate'));

    fireEvent.press(screen.getByLabelText('Add exercises'));
    fireEvent.press(await screen.findByLabelText('Goblet squat, Legs, Dumbbell'));
    fireEvent.press(screen.getByLabelText('Bench press, Chest, Barbell'));
    fireEvent.press(screen.getByLabelText('Add 2 exercises'));
    await waitFor(() => expect(screen.queryByTestId('exercise-picker')).not.toBeOnTheScreen());

    const first = screen.getByTestId('row-0');
    fireEvent.press(within(first).getByLabelText('Increase Reps'));
    fireEvent.press(within(first).getByLabelText('Increase Weight'));
    fireEvent.press(within(first).getByLabelText('Increase Weight'));
    fireEvent.press(within(screen.getByTestId('row-1')).getByLabelText('Decrease Sets'));

    fireEvent.press(screen.getByLabelText('Save routine'));
    await waitFor(() => expect(api.createRoutine).toHaveBeenCalled());
    expect(api.createRoutine).toHaveBeenCalledWith('gym-1', {
      name: 'Leg day',
      description: null,
      level: 'intermediate',
      kind: 'custom',
      exercises: [
        { exerciseId: 'ex_squat', sets: 3, reps: 11, weightKg: 5, restSec: 60 },
        { exerciseId: 'ex_bench', sets: 2, reps: 10, weightKg: null, restSec: 60 },
      ],
    });
    expect(await screen.findByText('Routine created')).toBeTruthy();
    expect(nav().stack.at(-1)).toMatchObject({ name: 'RoutineDetail', params: { id: 'r-new' } });
  });

  it('filters the picker by muscle', async () => {
    const api = makeFakeApi();
    renderApp(<RoutineEditorScreen params={{}} />, { api });
    fireEvent.press(await screen.findByLabelText('Add exercises'));
    await screen.findByLabelText('Goblet squat, Legs, Dumbbell');
    fireEvent.press(screen.getByLabelText('Legs'));
    await waitFor(() => expect(api.exercises).toHaveBeenLastCalledWith('gym-1', { q: undefined, muscle: 'legs' }));
    fireEvent.changeText(screen.getByLabelText('Search exercises'), 'squat');
    await waitFor(() => expect(api.exercises).toHaveBeenLastCalledWith('gym-1', { q: 'squat', muscle: 'legs' }));
  });

  it('shows validation messages and does not save', async () => {
    const api = makeFakeApi();
    renderApp(<RoutineEditorScreen params={{}} />, { api });
    fireEvent.press(await screen.findByLabelText('Save routine'));
    expect(screen.getByText('Give your routine a name.')).toBeTruthy();
    expect(screen.getByText('Add at least one exercise.')).toBeTruthy();
    expect(api.createRoutine).not.toHaveBeenCalled();
  });

  it('edits an existing routine, removes a row and updates it', async () => {
    const api = makeFakeApi({ routine: async (_g: string, id: string) => myRoutine(id) });
    renderApp(<RoutineEditorScreen params={{ id: 'r3' }} />, { api });
    expect(await screen.findByDisplayValue('My arm day')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Remove Bench press'));
    fireEvent.press(screen.getByLabelText('Save changes'));
    await waitFor(() => expect(api.updateRoutine).toHaveBeenCalled());
    const [, id, body] = api.updateRoutine.mock.calls[0];
    expect(id).toBe('r3');
    expect(body.exercises).toEqual([{ exerciseId: 'ex_squat', sets: 3, reps: 12, weightKg: 16, restSec: 60 }]);
    expect(await screen.findByText('Routine saved')).toBeTruthy();
  });
});

describe('Workout session', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('completes sets, runs the rest timer, finishes and logs the completed sets', async () => {
    const api = makeFakeApi({ logWorkout: async () => ({ workout: workoutFixture({ id: 'w-new', durationMin: 3, totalVolumeKg: 840 }), newBadges: ['first_workout'] }) });
    const { nav } = renderApp(<WorkoutSessionScreen params={{ routineId: 'r1' }} />, { api });
    expect(await screen.findByText('Bench press')).toBeTruthy();
    expect(screen.getByTestId('sets-done')).toHaveTextContent('0 of 6 sets');

    // first set is open for editing: bump reps from 10 to 11
    fireEvent.press(screen.getByLabelText('Increase Reps'));
    fireEvent.press(screen.getByLabelText('Done, set 1 of Bench press'));
    expect(screen.getByTestId('sets-done')).toHaveTextContent('1 of 6 sets');
    expect(screen.getByTestId('rest-timer')).toHaveTextContent(/Rest 1:30/);

    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(screen.getByTestId('rest-timer')).toHaveTextContent(/Rest 1:00/);
    fireEvent.press(screen.getByLabelText('Skip rest'));
    expect(screen.queryByTestId('rest-timer')).toBeNull();

    fireEvent.press(screen.getByLabelText('Done, set 2 of Bench press'));
    expect(screen.getByTestId('rest-timer')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(91_000);
    });
    expect(screen.queryByTestId('rest-timer')).toBeNull();

    fireEvent.press(screen.getByLabelText('Finish workout'));
    expect(await screen.findByTestId('workout-summary')).toBeTruthy();
    expect(api.logWorkout).toHaveBeenCalledTimes(1);
    const [gymId, body] = api.logWorkout.mock.calls[0];
    expect(gymId).toBe('gym-1');
    expect(body.routineId).toBe('r1');
    expect(new Date(body.completedAt).getTime() - new Date(body.startedAt).getTime()).toBeGreaterThanOrEqual(121_000);
    expect(body.sets).toEqual([
      { exerciseId: 'ex_bench', reps: 11, weightKg: 40 },
      { exerciseId: 'ex_bench', reps: 10, weightKg: 40 },
    ]);
    expect(screen.getByText('Great work!')).toBeTruthy();
    expect(screen.getByLabelText('3 minutes')).toBeTruthy();
    expect(screen.getByLabelText('840 kg lifted')).toBeTruthy();

    expect(await screen.findByTestId('badge-celebration')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Awesome!'));
    await waitFor(() => expect(screen.queryByTestId('badge-celebration')).not.toBeOnTheScreen());

    act(() => nav().push('WorkoutSession', { routineId: 'r1' }));
    fireEvent.press(screen.getByLabelText('Done'));
    expect(nav().stack).toHaveLength(0);
  });

  it('ticks the elapsed clock', async () => {
    renderApp(<WorkoutSessionScreen params={{ routineId: 'r1' }} />);
    await screen.findByText('Bench press');
    const before = screen.getByTestId('elapsed').props.children as string;
    act(() => {
      jest.advanceTimersByTime(65_000);
    });
    expect(screen.getByTestId('elapsed').props.children).not.toBe(before);
  });

  it('asks before discarding completed sets', async () => {
    const { nav } = renderApp(<WorkoutSessionScreen params={{ routineId: 'r1' }} />);
    await screen.findByText('Bench press');
    act(() => nav().push('WorkoutSession', { routineId: 'r1' }));
    fireEvent.press(screen.getByLabelText('Done, set 1 of Bench press'));
    fireEvent.press(screen.getByLabelText('Back'));
    expect(screen.getByText('Discard this workout?')).toBeTruthy();
    expect(nav().stack).toHaveLength(1);
    fireEvent.press(screen.getByLabelText('Keep going'));
    expect(screen.queryByText('Discard this workout?')).toBeNull();
    fireEvent.press(screen.getByLabelText('Back'));
    fireEvent.press(screen.getByLabelText('Discard'));
    expect(nav().stack).toHaveLength(0);
  });

  it('runs a quick workout with exercises from the picker', async () => {
    const api = makeFakeApi();
    renderApp(<WorkoutSessionScreen params={{}} />, { api });
    expect(await screen.findByText('Add your first exercise')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Finish workout'));
    expect(screen.getByText('Tick at least one set as done before you finish.')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Add exercise'));
    fireEvent.press(await screen.findByLabelText('Goblet squat, Legs, Dumbbell'));
    fireEvent.press(screen.getByLabelText('Add 1 exercise'));
    expect(await screen.findByTestId('entry-ex_squat')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Done, set 1 of Goblet squat'));
    fireEvent.press(screen.getByLabelText('Finish workout'));
    await waitFor(() => expect(api.logWorkout).toHaveBeenCalled());
    expect(api.logWorkout.mock.calls[0][1]).toMatchObject({ routineId: null, sets: [{ exerciseId: 'ex_squat', reps: 10, weightKg: null }] });
  });
});
