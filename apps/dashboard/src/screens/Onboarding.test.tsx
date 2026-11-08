import { screen, waitFor, within } from '@testing-library/react';
import { Onboarding } from './Onboarding';
import { apiError, installFakeApi } from '../test/fakeApi';
import { makeGym } from '../test/fixtures';
import { renderUi } from '../test/render';

function setup(extra = {}) {
  const gym = makeGym({ id: 'gym-new', name: 'Iron Den', joinCode: 'IRON77', branding: { ...makeGym().branding, gymName: 'Iron Den', tagline: null } });
  let n = 0;
  const fake = installFakeApi({
    'POST /gyms': { status: 201, body: gym },
    'PATCH /gyms/:gymId/branding': (req) => ({ gym: { ...gym, branding: { ...gym.branding, ...(req.body as object) } }, contrastIssues: [] }),
    'POST /gyms/:gymId/plans': (req) => ({ status: 201, body: { id: `p${++n}`, ...(req.body as object) } }),
    ...extra,
  });
  const onFinish = vi.fn();
  return { ...renderUi(<Onboarding onFinish={onFinish} />), fake, onFinish, gym };
}

async function createGym(user: ReturnType<typeof setup>['user']) {
  await user.type(screen.getByLabelText('Gym name'), 'Iron Den');
  await user.type(screen.getByLabelText('City'), 'Mumbai');
  await user.click(screen.getByRole('button', { name: 'Create gym' }));
  await screen.findByRole('heading', { name: 'Make it yours' });
}

describe('Onboarding', () => {
  it('creates the gym, then shows the branding studio', async () => {
    const { user, fake } = setup();
    await createGym(user);
    expect(fake.callsTo('POST /gyms')[0].body).toEqual({ name: 'Iron Den', city: 'Mumbai' });
    expect(screen.getByTestId('phone-preview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save & continue' })).toBeInTheDocument();
  });

  it('shows the API error when gym creation fails', async () => {
    const { user } = setup({ 'POST /gyms': apiError(400, 'Enter at least 2 characters', 'validation') });
    await user.type(screen.getByLabelText('Gym name'), 'Iron Den');
    await user.type(screen.getByLabelText('City'), 'Mumbai');
    await user.click(screen.getByRole('button', { name: 'Create gym' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter at least 2 characters');
  });

  it('prefills plan templates and creates them in paise', async () => {
    const { user, fake } = setup();
    await createGym(user);
    await user.click(screen.getByRole('button', { name: 'Save & continue' }));
    expect(fake.callsTo('PATCH /gyms/:gymId/branding')).toHaveLength(1);

    await screen.findByRole('heading', { name: 'Membership plans' });
    expect(screen.getAllByTestId('plan-draft')).toHaveLength(3);
    expect(screen.getByLabelText('Plan 1 name')).toHaveValue('Monthly');
    expect(screen.getByLabelText('Plan 1 days')).toHaveValue(30);
    expect(screen.getByLabelText('Plan 1 price')).toHaveValue('1499');
    expect(screen.getByLabelText('Plan 2 name')).toHaveValue('Quarterly');
    expect(screen.getByLabelText('Plan 2 days')).toHaveValue(90);
    expect(screen.getByLabelText('Plan 2 price')).toHaveValue('3999');
    expect(screen.getByLabelText('Plan 3 name')).toHaveValue('Yearly');
    expect(screen.getByLabelText('Plan 3 days')).toHaveValue(365);
    expect(screen.getByLabelText('Plan 3 price')).toHaveValue('12999');
    expect(screen.getByText('₹12,999')).toBeInTheDocument();

    // Tweak the monthly price and drop the quarterly plan.
    await user.clear(screen.getByLabelText('Plan 1 price'));
    await user.type(screen.getByLabelText('Plan 1 price'), '1299');
    await user.click(screen.getByLabelText('Include plan 2'));
    await user.click(screen.getByRole('button', { name: 'Create 2 plans' }));

    await screen.findByRole('heading', { name: 'Iron Den is live!' });
    const bodies = fake.callsTo('POST /gyms/:gymId/plans').map((c) => c.body);
    expect(bodies).toEqual([
      { name: 'Monthly', durationDays: 30, pricePaise: 129900, benefits: ['Full gym access'] },
      { name: 'Yearly', durationDays: 365, pricePaise: 1299900, benefits: ['Full gym access', '4 PT sessions'] },
    ]);
  });

  it('done screen shows the join code big, a QR poster and printing', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const { user, onFinish, gym } = setup();
    await createGym(user);
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await screen.findByRole('heading', { name: 'Membership plans' });
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(await screen.findByTestId('done-join-code')).toHaveTextContent('IRON77');
    const qr = await screen.findByTestId('join-qr');
    expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(qr).toHaveAccessibleName('QR code for gymverse://join/IRON77');
    await user.click(screen.getByRole('button', { name: 'Print poster' }));
    expect(print).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Go to dashboard' }));
    expect(onFinish).toHaveBeenCalledWith(gym);
  });

  it('does not duplicate plans when one fails and the owner retries', async () => {
    let calls = 0;
    const { user, fake } = setup({
      'POST /gyms/:gymId/plans': (req: { body: unknown }) =>
        ++calls === 2 ? apiError(400, 'Plan name is too long', 'validation') : { status: 201, body: { id: `p${calls}`, ...(req.body as object) } },
    });
    await createGym(user);
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await screen.findByRole('heading', { name: 'Membership plans' });
    await user.click(screen.getByRole('button', { name: 'Create 3 plans' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Plan name is too long');
    // Monthly was created, so only Quarterly and Yearly remain.
    expect(screen.getAllByTestId('plan-draft')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Create 2 plans' }));
    await screen.findByRole('heading', { name: 'Iron Den is live!' });
    await waitFor(() =>
      expect(fake.callsTo('POST /gyms/:gymId/plans').map((c) => (c.body as { name: string }).name)).toEqual([
        'Monthly',
        'Quarterly',
        'Quarterly',
        'Yearly',
      ]),
    );
    expect(within(screen.getByTestId('done-join-code')).getByText('IRON77')).toBeInTheDocument();
  });
});
