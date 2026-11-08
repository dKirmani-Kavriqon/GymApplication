import { screen, waitFor, within } from '@testing-library/react';
import type { AdminGymRow } from '@gymverse/shared';
import { Admin, ratePercent } from './Admin';
import { apiError, installFakeApi, type Routes } from '../test/fakeApi';
import { ADMIN_STATS, makeAdminGym } from '../test/fixtures3';
import { renderUi } from '../test/render';

const GYMS: AdminGymRow[] = [
  makeAdminGym(),
  makeAdminGym({ id: 'gym-2', name: 'Iron Den', city: 'Mumbai', joinCode: 'IRON77', planTier: 'pro', suspended: true }),
];

function setup(routes: Routes = {}, onGymChanged = vi.fn()) {
  const fake = installFakeApi({
    'GET /admin/stats': ADMIN_STATS,
    'GET /admin/gyms': (req) => {
      const q = (req.query.get('q') ?? '').toLowerCase();
      return { gyms: GYMS.filter((g) => !q || `${g.name} ${g.city} ${g.joinCode}`.toLowerCase().includes(q)) };
    },
    'PATCH /admin/gyms/:id': (req) => ({ ...GYMS.find((g) => g.id === req.params.id)!, ...(req.body as object) }),
    ...routes,
  });
  return { ...renderUi(<Admin onGymChanged={onGymChanged} />), fake, onGymChanged };
}

const rowFor = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

describe('ratePercent', () => {
  it('turns the 0–1 fraction into a percentage, clamped', () => {
    expect(ratePercent(0.38)).toBe(38);
    expect(ratePercent(0.456)).toBe(45.6);
    expect(ratePercent(1.3)).toBe(100);
    expect(ratePercent(-0.2)).toBe(0);
    expect(ratePercent(Number.NaN)).toBe(0);
  });
});

describe('Admin console', () => {
  it('shows platform stats and the weekly active rate against the 45% goal', async () => {
    setup();
    expect(await screen.findByTestId('admin-weekly-rate')).toHaveTextContent('38%');
    expect(screen.getByText('Below the 45% goal')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Weekly active rate 38% against a 45% goal' })).toBeInTheDocument();
    expect(screen.getByTestId('admin-gyms')).toHaveTextContent('12');
    expect(screen.getByText('1 suspended')).toBeInTheDocument();
    expect(screen.getByTestId('admin-checkins-today')).toHaveTextContent('133');
    expect(screen.getByTestId('admin-revenue-30d')).toHaveTextContent('₹98,765');
  });

  it('lists gyms and searches with ?q=', async () => {
    const { user, fake } = setup();
    expect(await screen.findAllByTestId('admin-gym-row')).toHaveLength(2);
    expect(within(rowFor('Iron Den')).getByText('Suspended')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search gyms'), 'mumbai');
    await waitFor(() => expect(screen.getAllByTestId('admin-gym-row')).toHaveLength(1));
    expect(screen.getByText('Iron Den')).toBeInTheDocument();
    expect(fake.callsTo('GET /admin/gyms').at(-1)!.query.get('q')).toBe('mumbai');
    await user.clear(screen.getByLabelText('Search gyms'));
    await user.type(screen.getByLabelText('Search gyms'), 'zzz');
    expect(await screen.findByText('No gyms match “zzz”.')).toBeInTheDocument();
  });

  it('suspending needs an in-page confirm, then PATCHes {suspended: true}', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { user, fake, onGymChanged } = setup();
    await screen.findAllByTestId('admin-gym-row');
    await user.click(within(rowFor('Flex Fitness')).getByRole('button', { name: 'Suspend' }));
    const panel = screen.getByRole('group', { name: 'Suspend Flex Fitness?' });
    expect(panel).toHaveTextContent('Members and staff lose access');
    await user.click(within(panel).getByRole('button', { name: 'Cancel' }));
    expect(fake.callsTo('PATCH /admin/gyms/:id')).toHaveLength(0);

    await user.click(within(rowFor('Flex Fitness')).getByRole('button', { name: 'Suspend' }));
    await user.click(screen.getByRole('button', { name: 'Yes, suspend' }));
    expect(await screen.findByText('Flex Fitness suspended')).toBeInTheDocument();
    expect(fake.callsTo('PATCH /admin/gyms/:id')[0]).toMatchObject({ params: { id: 'gym-1' }, body: { suspended: true } });
    expect(within(rowFor('Flex Fitness')).getByRole('button', { name: 'Unsuspend' })).toBeInTheDocument();
    expect(onGymChanged).toHaveBeenCalledWith(expect.objectContaining({ id: 'gym-1', suspended: true }));
    expect(confirm).not.toHaveBeenCalled();
    // Stats refresh after a change.
    expect(fake.callsTo('GET /admin/stats').length).toBeGreaterThanOrEqual(2);
  });

  it('unsuspends after confirming', async () => {
    const { user, fake } = setup();
    await screen.findAllByTestId('admin-gym-row');
    await user.click(within(rowFor('Iron Den')).getByRole('button', { name: 'Unsuspend' }));
    await user.click(screen.getByRole('button', { name: 'Yes, unsuspend' }));
    await screen.findByText('Iron Den is active again');
    expect(fake.callsTo('PATCH /admin/gyms/:id')[0]).toMatchObject({ params: { id: 'gym-2' }, body: { suspended: false } });
  });

  it('changes the plan tier', async () => {
    const { user, fake } = setup();
    await screen.findAllByTestId('admin-gym-row');
    await user.selectOptions(screen.getByLabelText('Plan tier for Flex Fitness'), 'enterprise');
    expect(await screen.findByText('Flex Fitness moved to Enterprise')).toBeInTheDocument();
    expect(fake.callsTo('PATCH /admin/gyms/:id')[0].body).toEqual({ planTier: 'enterprise' });
    expect(screen.getByLabelText('Plan tier for Flex Fitness')).toHaveValue('enterprise');
  });

  it('shows errors in the row', async () => {
    const { user } = setup({ 'PATCH /admin/gyms/:id': apiError(500, 'Audit log unavailable') });
    await screen.findAllByTestId('admin-gym-row');
    await user.click(within(rowFor('Flex Fitness')).getByRole('button', { name: 'Suspend' }));
    await user.click(screen.getByRole('button', { name: 'Yes, suspend' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Audit log unavailable');
  });
});
