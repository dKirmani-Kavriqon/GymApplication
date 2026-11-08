import { screen, waitFor, within } from '@testing-library/react';
import type { Role } from '@gymverse/shared';
import { Plans } from './Plans';
import { discountLabel } from './Coupons';
import { apiError, installFakeApi, type Routes } from '../test/fakeApi';
import { PLANS, makeGym } from '../test/fixtures';
import { makeCoupon } from '../test/fixtures3';
import { renderUi } from '../test/render';

const COUPONS = [
  makeCoupon(),
  makeCoupon({ id: 'cp-2', code: 'YEAR500', kind: 'flat', amount: 50_000, planIds: ['p2'], expiresOn: '2026-01-31', maxUses: 50, uses: 50, active: false }),
];

async function openCoupons(role: Role = 'owner', routes: Routes = {}) {
  const fake = installFakeApi({
    'GET /gyms/:gymId/plans': { plans: PLANS },
    'GET /gyms/:gymId/coupons': { coupons: COUPONS },
    'POST /gyms/:gymId/coupons': (req) => ({ status: 201, body: makeCoupon({ id: 'cp-new', uses: 0, ...(req.body as object) }) }),
    'PATCH /gyms/:gymId/coupons/:id': (req) => makeCoupon({ id: req.params.id, ...(req.body as object) }),
    ...routes,
  });
  const utils = renderUi(<Plans gym={makeGym()} role={role} />);
  await screen.findAllByTestId('plan-card');
  await utils.user.click(screen.getByRole('tab', { name: 'Coupons' }));
  return { ...utils, fake };
}

describe('discountLabel', () => {
  it('formats percent and flat (paise) discounts', () => {
    expect(discountLabel({ kind: 'percent', amount: 15 })).toBe('15% off');
    expect(discountLabel({ kind: 'flat', amount: 50_000 })).toBe('₹500 off');
  });
});

describe('Coupons (under Plans)', () => {
  it('trainers see no coupons tab', async () => {
    installFakeApi({ 'GET /gyms/:gymId/plans': { plans: PLANS } });
    renderUi(<Plans gym={makeGym()} role="trainer" />);
    await screen.findAllByTestId('plan-card');
    expect(screen.queryByRole('tab', { name: 'Coupons' })).not.toBeInTheDocument();
  });

  it('lists code, discount, plans, expiry and uses', async () => {
    await openCoupons();
    const rows = await screen.findAllByTestId('coupon-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('WELCOME10');
    expect(rows[0]).toHaveTextContent('10% off');
    expect(rows[0]).toHaveTextContent('All plans');
    expect(rows[0]).toHaveTextContent('No expiry');
    expect(rows[0]).toHaveTextContent('3 / ∞');
    expect(within(rows[0]).getByRole('checkbox', { name: 'WELCOME10 active' })).toBeChecked();
    expect(rows[1]).toHaveTextContent('₹500 off');
    expect(rows[1]).toHaveTextContent('Yearly');
    expect(within(rows[1]).getByText('Expired')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Used up')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('50 / 50');
    expect(within(rows[1]).getByRole('checkbox', { name: 'YEAR500 active' })).not.toBeChecked();
  });

  it('creates a flat coupon: rupees are sent as paise, with plans, expiry and max uses', async () => {
    const { user, fake } = await openCoupons();
    await screen.findAllByTestId('coupon-row');
    await user.click(screen.getByRole('button', { name: 'New coupon' }));
    const form = screen.getByRole('form', { name: 'New coupon' });
    await user.type(within(form).getByLabelText('Code'), 'diwali');
    expect(within(form).getByLabelText('Code')).toHaveValue('DIWALI');
    await user.click(within(form).getByLabelText('Flat amount (₹)'));
    await user.type(within(form).getByLabelText('Discount (₹)'), '499.50');
    await user.click(within(form).getByLabelText('Monthly'));
    await user.type(within(form).getByLabelText('Expires on'), '2026-12-31');
    await user.type(within(form).getByLabelText('Max uses'), '100');
    await user.click(within(form).getByRole('button', { name: 'Create coupon' }));

    expect(await screen.findByText('Coupon DIWALI created')).toBeInTheDocument();
    expect(fake.callsTo('POST /gyms/:gymId/coupons')[0].body).toEqual({
      code: 'DIWALI',
      kind: 'flat',
      amount: 49_950,
      planIds: ['p1'],
      expiresOn: '2026-12-31',
      maxUses: 100,
      active: true,
    });
    expect(screen.getAllByTestId('coupon-row')).toHaveLength(3);
  });

  it('a percent coupon with no plans means all plans; over 100% is rejected', async () => {
    const { user, fake } = await openCoupons();
    await screen.findAllByTestId('coupon-row');
    await user.click(screen.getByRole('button', { name: 'New coupon' }));
    await user.type(screen.getByLabelText('Code'), 'BIG');
    await user.type(screen.getByLabelText('Discount (%)'), '120');
    await user.click(screen.getByRole('button', { name: 'Create coupon' }));
    expect(screen.getByRole('alert')).toHaveTextContent('A percentage discount can be at most 100');
    expect(fake.callsTo('POST /gyms/:gymId/coupons')).toHaveLength(0);

    await user.clear(screen.getByLabelText('Discount (%)'));
    await user.type(screen.getByLabelText('Discount (%)'), '20');
    await user.click(screen.getByRole('button', { name: 'Create coupon' }));
    await screen.findByText('Coupon BIG created');
    expect(fake.callsTo('POST /gyms/:gymId/coupons')[0].body).toEqual({
      code: 'BIG',
      kind: 'percent',
      amount: 20,
      planIds: [],
      expiresOn: null,
      maxUses: null,
      active: true,
    });
  });

  it('shows duplicate-code errors from the API', async () => {
    const { user } = await openCoupons('owner', {
      'POST /gyms/:gymId/coupons': apiError(409, 'You already have a coupon with that code.', 'duplicate_code'),
    });
    await screen.findAllByTestId('coupon-row');
    await user.click(screen.getByRole('button', { name: 'New coupon' }));
    await user.type(screen.getByLabelText('Code'), 'WELCOME10');
    await user.type(screen.getByLabelText('Discount (%)'), '10');
    await user.click(screen.getByRole('button', { name: 'Create coupon' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You already have a coupon with that code.');
  });

  it('the active toggle PATCHes {active} and rolls back on error', async () => {
    const { user, fake } = await openCoupons();
    const toggle = await screen.findByRole('checkbox', { name: 'WELCOME10 active' });
    await user.click(toggle);
    expect(await screen.findByText('WELCOME10 paused')).toBeInTheDocument();
    expect(fake.callsTo('PATCH /gyms/:gymId/coupons/:id')[0]).toMatchObject({ params: { id: 'cp-1' }, body: { active: false } });
    expect(toggle).not.toBeChecked();
  });

  it('rolls the toggle back when the PATCH fails', async () => {
    const { user } = await openCoupons('owner', { 'PATCH /gyms/:gymId/coupons/:id': apiError(500, 'Server error') });
    const toggle = await screen.findByRole('checkbox', { name: 'YEAR500 active' });
    await user.click(toggle);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Server error'));
    expect(toggle).not.toBeChecked();
  });
});
