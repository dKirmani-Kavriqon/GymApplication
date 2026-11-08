import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { getToken, setToken } from './lib/api';
import { apiError, installFakeApi, type Routes } from './test/fakeApi';
import { MEMBERS, PLANS, makeGym, makeMe, makeReport } from './test/fixtures';
import { makeRevenue } from './test/fixtures3';
import type { Role } from '@gymverse/shared';

function dashboardRoutes(role: Role = 'owner'): Routes {
  return {
    'GET /me': makeMe(role),
    'GET /gyms/:gymId/reports/attendance': makeReport(),
    'GET /gyms/:gymId/members': { members: MEMBERS },
    'GET /gyms/:gymId/plans': { plans: PLANS },
    'GET /gyms/:gymId/classes': { classes: [] },
    'GET /gyms/:gymId/announcements': { announcements: [] },
    'GET /gyms/:gymId/routines': { assigned: [], presets: [], mine: [] },
    'GET /gyms/:gymId/exercises': { exercises: [] },
    'GET /gyms/:gymId/support/tickets': { tickets: [] },
    'GET /gyms/:gymId/meal-plans': { mealPlans: [] },
    'GET /gyms/:gymId/meal-ideas': { mealIdeas: [] },
    'GET /gyms/:gymId/reports/revenue': makeRevenue(),
  };
}

describe('login flow', () => {
  it('requests an OTP, shows the dev code, verifies and lands on the dashboard', async () => {
    const user = userEvent.setup();
    const fake = installFakeApi({
      'POST /auth/otp/request': { sent: true, devCode: '123456' },
      'POST /auth/otp/verify': (req) =>
        (req.body as { code: string }).code === '123456'
          ? { token: 'tok-abc', isNewUser: false, user: makeMe().user }
          : apiError(400, 'That code is wrong or has expired.'),
      ...dashboardRoutes('owner'),
    });
    render(<App />);

    await user.type(screen.getByLabelText('Phone number'), '99999 00001');
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    expect(await screen.findByTestId('dev-code')).toHaveTextContent('Dev code: 123456');
    expect(fake.callsTo('POST /auth/otp/request')[0].body).toEqual({ phone: '+919999900001' });

    // Wrong code shows the API's message.
    await user.type(screen.getByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify & continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is wrong or has expired.');

    await user.clear(screen.getByLabelText('6-digit code'));
    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify & continue' }));

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(getToken()).toBe('tok-abc');
    expect(fake.callsTo('GET /me')[0].headers.Authorization).toBe('Bearer tok-abc');
    expect(await screen.findByTestId('stat-today')).toHaveTextContent('4');
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections' });
    for (const label of ['Overview', 'Members', 'Classes', 'Plans', 'Announcements', 'Branding', 'Join QR']) {
      expect(within(nav).getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('rejects an invalid phone without calling the API', async () => {
    const user = userEvent.setup();
    const fake = installFakeApi({});
    render(<App />);
    await user.type(screen.getByLabelText('Phone number'), '123');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid phone number');
    expect(fake.fetchMock).not.toHaveBeenCalled();
  });

  it('logs out when the stored token is rejected', async () => {
    setToken('expired');
    installFakeApi({ 'GET /me': apiError(401, 'Please log in again.', 'unauthorized') });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Gym owner login' })).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });
});

describe('gym selection', () => {
  it('sends users without a staff membership to onboarding', async () => {
    setToken('tok');
    const me = makeMe('member');
    installFakeApi({ 'GET /me': me });
    render(<App />);
    expect(await screen.findByRole('heading', { name: "Let's set up your gym" })).toBeInTheDocument();
  });

  it('shows a picker when the user manages several gyms', async () => {
    setToken('tok');
    const user = userEvent.setup();
    const me = makeMe('owner');
    const second = makeGym({ id: 'gym-2', name: 'Iron Den', branding: { ...makeGym().branding, gymName: 'Iron Den' } });
    me.memberships.push({ gym: second, role: 'manager', joinedAt: '2026-01-01T00:00:00.000Z' });
    const fake = installFakeApi({ ...dashboardRoutes(), 'GET /me': me });
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Iron Den/ }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    await waitFor(() => expect(fake.callsTo('GET /gyms/:gymId/reports/attendance')[0].params.gymId).toBe('gym-2'));
    expect(screen.getByText(/Manager · code FLEX42/)).toBeInTheDocument();
  });
});

describe('role-based controls', () => {
  async function open(role: Role, section: string) {
    setToken('tok');
    const user = userEvent.setup();
    installFakeApi(dashboardRoutes(role));
    render(<App />);
    await screen.findByRole('heading', { name: 'Overview' });
    await user.click(screen.getByRole('button', { name: new RegExp(section) }));
    return user;
  }

  it('trainer: no role select, deactivate or import on Members', async () => {
    await open('trainer', 'Members');
    await screen.findByText('Ravi Kumar');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import CSV' })).not.toBeInTheDocument();
  });

  it('trainer: navigation shows only Overview, Members, Classes, Workouts and Support', async () => {
    await open('trainer', 'Members');
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections' });
    const labels = within(nav)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(labels).toEqual(['Overview', 'Members', 'Classes', 'Workouts', 'Support']);
    for (const hidden of ['Plans', 'Nutrition', 'Resources', 'Community', 'Announcements', 'Branding', 'Join QR']) {
      expect(within(nav).queryByRole('button', { name: new RegExp(hidden) })).not.toBeInTheDocument();
    }
  });

  it('trainer: support is an inbox only (no help-info editor) and members have a Workouts action', async () => {
    const user = await open('trainer', 'Members');
    await screen.findByText('Ravi Kumar');
    expect(screen.getByRole('button', { name: 'Workouts for Ravi Kumar' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('navigation', { name: 'Dashboard sections' })).getByRole('button', { name: /Support/ }));
    expect(await screen.findByRole('heading', { name: 'Support' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Help info & FAQs' })).not.toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Ticket status' })).toBeInTheDocument();
  });

  it('manager: can deactivate and import but not change roles', async () => {
    await open('manager', 'Members');
    await screen.findByText('Ravi Kumar');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Deactivate' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Import CSV' })).toBeInTheDocument();
  });

  it('owner: sees role selects (except for themselves) and the branding save button', async () => {
    const user = await open('owner', 'Members');
    await screen.findByText('Ravi Kumar');
    expect(screen.getByRole('combobox', { name: 'Role for Ravi Kumar' })).toBeInTheDocument();
    // The fixture owner row is not the logged-in user (u-owner vs user-owner), so owners see 3 + 1 selects.
    expect(screen.getAllByRole('combobox')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: /Branding/ }));
    expect(await screen.findByRole('button', { name: 'Save branding' })).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('owner sees every section, grouped in three blocks', async () => {
    setToken('tok');
    installFakeApi(dashboardRoutes('owner'));
    render(<App />);
    await screen.findByRole('heading', { name: 'Overview' });
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections' });
    const groups = within(nav).getAllByRole('group');
    expect(groups.map((g) => within(g).getAllByRole('button').map((b) => b.textContent))).toEqual([
      ['Overview', 'Members', 'Classes', 'Plans', 'Revenue'],
      ['Workouts', 'Nutrition', 'Resources', 'Community'],
      ['Announcements', 'Support', 'Branding', 'Join QR'],
    ]);
    expect(within(nav).getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });

  it('owner: switched-off features are greyed with "Turn on in Branding"', async () => {
    setToken('tok');
    const user = userEvent.setup();
    const gym = makeGym({ enabledFeatures: ['checkin', 'classes', 'payments', 'progress', 'announcements', 'badges', 'workouts'] });
    installFakeApi({ ...dashboardRoutes('owner'), 'GET /me': makeMe('owner', gym) });
    render(<App />);
    await screen.findByRole('heading', { name: 'Overview' });
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections' });
    const nutrition = within(nav).getByRole('button', { name: /Nutrition/ });
    expect(nutrition).toHaveAttribute('data-state', 'disabled');
    expect(nutrition).toHaveTextContent('Off · Turn on in Branding');
    expect(within(nav).getByRole('button', { name: /Workouts/ })).toHaveAttribute('data-state', 'enabled');
    for (const off of ['Resources', 'Community', 'Support']) {
      expect(within(nav).getByRole('button', { name: new RegExp(off) })).toHaveAttribute('data-state', 'disabled');
    }

    await user.click(nutrition);
    expect(await screen.findByRole('heading', { name: 'Nutrition' })).toBeInTheDocument();
    expect(screen.getByText(/is switched off, so members don't see it/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Turn on in Branding' }));
    expect(await screen.findByRole('heading', { name: 'Branding' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^Nutrition/ })).not.toBeChecked();
  });

  it('trainer: sections for switched-off features are hidden, and so is the Workouts action', async () => {
    setToken('tok');
    const user = userEvent.setup();
    const gym = makeGym({ enabledFeatures: ['checkin', 'classes', 'support'] });
    installFakeApi({ ...dashboardRoutes('trainer'), 'GET /me': makeMe('trainer', gym) });
    render(<App />);
    await screen.findByRole('heading', { name: 'Overview' });
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Overview', 'Members', 'Classes', 'Support']);
    await user.click(within(nav).getByRole('button', { name: 'Members' }));
    await screen.findByText('Ravi Kumar');
    expect(screen.queryByRole('button', { name: /Workouts for/ })).not.toBeInTheDocument();
  });
});

describe('v0.3 shell', () => {
  it('hides the Admin console unless me.isPlatformAdmin', async () => {
    setToken('tok');
    installFakeApi(dashboardRoutes('owner'));
    render(<App />);
    await screen.findByRole('heading', { name: 'Overview' });
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections' });
    expect(within(nav).queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
    expect(within(nav).getAllByRole('group')).toHaveLength(3);
  });

  it('platform admins get an Admin section at the bottom of the sidebar', async () => {
    setToken('tok');
    const user = userEvent.setup();
    const me = { ...makeMe('trainer'), isPlatformAdmin: true };
    installFakeApi({
      ...dashboardRoutes('trainer'),
      'GET /me': me,
      'GET /admin/stats': { gyms: 1, suspendedGyms: 0, users: 2, members: 2, checkInsToday: 0, checkIns30d: 3, revenue30dPaise: 0, weeklyActiveRate: 0.5 },
      'GET /admin/gyms': { gyms: [] },
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Overview' });
    const groups = within(screen.getByRole('navigation', { name: 'Dashboard sections' })).getAllByRole('group');
    const last = groups[groups.length - 1];
    expect(last).toHaveAccessibleName('Platform');
    await user.click(within(last).getByRole('button', { name: 'Admin' }));
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(await screen.findByText('On track')).toBeInTheDocument();
  });

  it('shows a banner on every page when the gym is suspended', async () => {
    setToken('tok');
    const user = userEvent.setup();
    installFakeApi({ ...dashboardRoutes('owner'), 'GET /me': makeMe('owner', makeGym({ suspended: true })) });
    render(<App />);
    await screen.findByRole('heading', { name: 'Overview' });
    expect(screen.getByTestId('suspended-banner')).toHaveTextContent("This gym's account is paused.");
    await user.click(screen.getByRole('button', { name: 'Plans' }));
    await screen.findByRole('heading', { name: 'Plans' });
    expect(screen.getByTestId('suspended-banner')).toBeInTheDocument();
  });

  it('shows a pending pause-request badge on Members for admins', async () => {
    setToken('tok');
    installFakeApi({
      ...dashboardRoutes('owner'),
      'GET /gyms/:gymId/freeze-requests': {
        requests: [
          { id: 'f1', member: { id: 'u', name: 'A' }, startsOn: '2026-11-10', endsOn: '2026-11-12', days: 3, reason: 'Trip', status: 'pending', note: null, createdAt: '2026-11-01T00:00:00.000Z', decidedAt: null },
        ],
      },
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Overview' });
    expect(await screen.findByLabelText('1 pending pause request')).toHaveTextContent('1');
  });
});

describe('platform admin without a gym', () => {
  it('lands on the Admin console instead of onboarding, and can still create a gym', async () => {
    setToken('tok');
    const user = userEvent.setup();
    const me = { ...makeMe('member'), isPlatformAdmin: true };
    installFakeApi({
      'GET /me': me,
      'GET /admin/stats': { gyms: 3, suspendedGyms: 0, users: 20, members: 18, checkInsToday: 4, checkIns30d: 90, revenue30dPaise: 0, weeklyActiveRate: 0.5 },
      'GET /admin/gyms': { gyms: [] },
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "Let's set up your gym" })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create a gym' }));
    expect(await screen.findByRole('heading', { name: "Let's set up your gym" })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
  });

  it('regular users without a gym still go to onboarding', async () => {
    setToken('tok');
    installFakeApi({ 'GET /me': { ...makeMe('member'), isPlatformAdmin: false } });
    render(<App />);
    expect(await screen.findByRole('heading', { name: "Let's set up your gym" })).toBeInTheDocument();
  });
});
