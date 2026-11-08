import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ClassesScreen } from './ClassesScreen';
import { ProgressScreen } from './ProgressScreen';
import { MeScreen } from './MeScreen';
import { SettingsScreen } from './me/SettingsScreen';
import { NotificationsScreen } from './me/NotificationsScreen';
import { SearchScreen } from './me/SearchScreen';
import { MainShell } from '../Shell';
import { Root } from '../Root';
import { NOW, classFixture, gymFixture, makeFakeApi, meFixture, renderApp } from '../test/fakeApi';

const now = () => NOW;

describe('Classes', () => {
  it('books a class with a confirmation toast, then offers to cancel', async () => {
    const api = makeFakeApi();
    renderApp(<ClassesScreen now={now} />, { api });
    expect(await screen.findByText('Morning Yoga')).toBeTruthy();
    expect(screen.getByText('6 spots left')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Book'));
    expect(await screen.findByText('✓ Booked')).toBeTruthy();
    expect(api.book).toHaveBeenCalledWith('gym-1', 'c1');
    expect(screen.getByTestId('toast')).toBeTruthy();
    expect(screen.getByText('Booked Morning Yoga')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Cancel booking'));
    await waitFor(() => expect(api.cancelBooking).toHaveBeenCalledWith('gym-1', 'c1'));
  });

  it('shows full classes and waitlist positions, and filters by day', async () => {
    const api = makeFakeApi({
      classes: async () => ({
        classes: [
          classFixture({ id: 'full', title: 'HIIT', capacity: 2, bookedCount: 2, waitlistCount: 2, startsAt: '2026-11-09T12:30:00' }),
          classFixture({ id: 'wl', title: 'Zumba', capacity: 2, bookedCount: 2, myStatus: 'waitlisted', myWaitlistPosition: 2, startsAt: '2026-11-10T18:00:00' }),
        ],
      }),
    });
    renderApp(<ClassesScreen now={now} />, { api });
    expect(await screen.findByText('Full · 2 waiting')).toBeTruthy();
    expect(screen.getByText('Waitlist #2')).toBeTruthy();
    expect(screen.getByLabelText('Join waitlist')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('TUE 10'));
    expect(screen.queryByText('HIIT')).toBeNull();
    expect(screen.getByText('Zumba')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('SUN 8'));
    expect(screen.getByText('No classes this day')).toBeTruthy();
  });
});

describe('Me & settings', () => {
  it('shows membership and links to progress, favourites, notifications, help and settings', async () => {
    const { nav } = renderApp(<MeScreen />);
    expect(await screen.findByText('Ravi Kumar')).toBeTruthy();
    expect(await screen.findByText('5 days left')).toBeTruthy();
    for (const [label, route] of [
      ['Progress, Charts, body stats, badges', 'Progress'],
      ['Favourites, Saved workouts, articles and recipes', 'Favourites'],
      ['Notifications', 'Notifications'],
      ['Help & support, FAQs and messages with your gym', 'Support'],
      ['Settings, Goal, reminders, language, security', 'Settings'],
    ]) {
      fireEvent.press(screen.getByLabelText(label));
      expect(nav().stack.at(-1)?.name).toBe(route);
    }
    fireEvent.press(screen.getByLabelText('Edit profile'));
    expect(nav().stack.at(-1)?.name).toBe('EditProfile');
  });

  it('switches gyms', async () => {
    const second = gymFixture({ id: 'gym-2', name: 'Zen Yoga', joinCode: 'ZEN777' });
    const api = makeFakeApi({ me: async () => meFixture({ memberships: [...meFixture().memberships, { gym: second, role: 'member', joinedAt: '' }] }) });
    renderApp(<MainShell />, { api });
    fireEvent.press(await screen.findByLabelText('Me'));
    fireEvent.press(await screen.findByLabelText('Zen Yoga, Switch to Zen Yoga'));
    await waitFor(() => expect(api.summary).toHaveBeenCalledWith('gym-2'));
  });

  it('settings save weekly goal, reminders, language and privacy', async () => {
    const api = makeFakeApi();
    renderApp(<SettingsScreen />, { api });
    fireEvent.press(await screen.findByLabelText('Increase Visits per week'));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ weeklyGoal: 5 }));
    fireEvent(screen.getByLabelText('Class reminders'), 'valueChange', false);
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ notifyClassReminders: false }));
    fireEvent.press(screen.getByLabelText('हिन्दी'));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ language: 'hi' }));
    fireEvent(screen.getByLabelText('Show my stats to others'), 'valueChange', false);
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ showStats: false }));
    fireEvent.press(screen.getByLabelText('Dark'));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ themeMode: 'dark' }));
    expect(screen.getByText(/App lock needs Face ID/)).toBeTruthy(); // no biometrics in tests
  });

  it('logs out back to the welcome screen', async () => {
    renderApp(<Root initialUrl={null} />, { gate: false });
    fireEvent.press(await screen.findByLabelText('Me'));
    fireEvent.press(await screen.findByLabelText('Log out'));
    expect(await screen.findByText('Welcome!')).toBeTruthy();
  });
});

describe('Notifications', () => {
  it('lists notifications, marks one read when opened and follows its link', async () => {
    const api = makeFakeApi();
    const { nav } = renderApp(<NotificationsScreen now={now} />, { api });
    const item = await screen.findByLabelText(/Unread\. Coach Vikram assigned you Push day/);
    fireEvent.press(item);
    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith('gym-1', ['n1']));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'RoutineDetail', params: { id: 'r1' } });
  });

  it('marks everything read', async () => {
    const api = makeFakeApi();
    renderApp(<NotificationsScreen now={now} />, { api });
    fireEvent.press(await screen.findByLabelText('Mark all read'));
    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith('gym-1'));
    expect(screen.queryByLabelText(/^Unread\./)).toBeNull();
  });

  it('has a friendly empty state', async () => {
    renderApp(<NotificationsScreen now={now} />, { api: makeFakeApi({ notifications: async () => ({ notifications: [], unread: 0 }) }) });
    expect(await screen.findByText("You're all caught up")).toBeTruthy();
  });
});

describe('Search', () => {
  it('waits for 2 letters, then shows grouped results that navigate', async () => {
    const api = makeFakeApi();
    const { nav } = renderApp(<SearchScreen debounceMs={0} />, { api });
    fireEvent.changeText(await screen.findByLabelText('Search'), 'p');
    expect(screen.getByText(/Type at least 2 letters/)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Search'), 'push');
    await waitFor(() => expect(api.search).toHaveBeenCalledWith('gym-1', 'push'));
    expect(await screen.findByText('Workouts')).toBeTruthy();
    expect(screen.getByText('Recipes')).toBeTruthy();
    expect(screen.getByText('Trainers')).toBeTruthy();
    fireEvent.press(screen.getByLabelText(/^Push day, Intermediate/));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'RoutineDetail', params: { id: 'r1' } });
    fireEvent.press(screen.getByLabelText(/^Paneer bhurji wrap/));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'MealIdea', params: { id: 'm1' } });
  });

  it('says when nothing matched', async () => {
    const empty = { query: 'zzz', classes: [], routines: [], exercises: [], articles: [], mealIdeas: [], trainers: [] };
    renderApp(<SearchScreen debounceMs={0} />, { api: makeFakeApi({ search: async () => empty }) });
    fireEvent.changeText(await screen.findByLabelText('Search'), 'zzz');
    expect(await screen.findByText('Nothing for “zzz”')).toBeTruthy();
  });
});

describe('Progress', () => {
  it('shows weekly chart, weight trend, personal bests, visit calendar and badges', async () => {
    renderApp(<ProgressScreen now={now} />);
    expect(await screen.findByTestId('weekly-chart')).toBeTruthy();
    expect(await screen.findByTestId('weight-card')).toBeTruthy();
    expect(screen.getByText('Bench press')).toBeTruthy();
    expect(screen.getByText('42.5 kg × 8')).toBeTruthy();
    expect(screen.getAllByTestId('day-visited')).toHaveLength(3);
    expect(screen.getByTestId('badge-earned-first_checkin')).toBeTruthy();
    expect(screen.getByTestId('badge-locked-workouts_10')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Gym visits'));
    expect(screen.getByLabelText(/^Gym visits per week/)).toBeTruthy();
  });

  it('validates and saves a body measurement', async () => {
    const api = makeFakeApi();
    renderApp(<ProgressScreen now={now} />, { api });
    fireEvent.press(await screen.findByLabelText('Add'));
    fireEvent.press(await screen.findByLabelText('Save measurement'));
    expect(await screen.findByText('Enter your weight or waist.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Weight (kg)'), '80.5');
    fireEvent.press(screen.getByLabelText('Save measurement'));
    await waitFor(() => expect(api.addMeasurement).toHaveBeenCalledWith({ measuredOn: '2026-11-08', weightKg: 80.5, waistCm: null }));
    expect(await screen.findByText('Measurement saved')).toBeTruthy();
  });
});
