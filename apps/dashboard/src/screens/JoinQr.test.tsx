import { screen, waitFor, within } from '@testing-library/react';
import { JoinQr } from './JoinQr';
import { apiError, installFakeApi } from '../test/fakeApi';
import { makeGym } from '../test/fixtures';
import { DOOR } from '../test/fixtures3';
import { renderUi } from '../test/render';

function setup(routes = {}) {
  const fake = installFakeApi({
    'GET /gyms/:gymId/door-code': DOOR,
    'POST /gyms/:gymId/door-code/rotate': { token: 'door-token-bbbb', url: 'gymverse://checkin/door-token-bbbb', rotatedAt: '2026-11-08T10:00:00.000Z' },
    'GET /gyms/:gymId/referral': { link: 'https://gymverse.app/join/FLEX42?ref=u', message: 'Join me', joined: 3, reward: 'One free week' },
    'PUT /gyms/:gymId/referral': (req) => req.body as object,
    ...routes,
  });
  return { ...renderUi(<JoinQr gym={makeGym()} />), fake };
}

describe('Join QR page: door check-in poster', () => {
  it('shows a printable "Scan to check in" poster with the door QR', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: 'Check-in poster' }));
    expect(await screen.findByText('Scan to check in')).toBeInTheDocument();
    const qr = await screen.findByTestId('door-qr');
    expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    await user.click(screen.getByRole('button', { name: 'Print check-in poster' }));
    expect(print).toHaveBeenCalled();
  });

  it('rotating needs an in-page confirm that explains old posters stop working', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { user, fake } = setup();
    await user.click(screen.getByRole('tab', { name: 'Check-in poster' }));
    await screen.findByTestId('door-qr');

    await user.click(screen.getByRole('button', { name: 'Rotate code' }));
    const panel = screen.getByRole('group', { name: 'Rotate the door code?' });
    expect(panel).toHaveTextContent('Every printed check-in poster stops working straight away');
    await user.click(within(panel).getByRole('button', { name: 'Keep current code' }));
    expect(screen.queryByRole('group', { name: 'Rotate the door code?' })).not.toBeInTheDocument();
    expect(fake.callsTo('POST /gyms/:gymId/door-code/rotate')).toHaveLength(0);

    const before = screen.getByTestId('door-qr').getAttribute('src');
    await user.click(screen.getByRole('button', { name: 'Rotate code' }));
    await user.click(screen.getByRole('button', { name: 'Rotate now' }));
    expect(await screen.findByText('New door code ready. Print the new poster.')).toBeInTheDocument();
    expect(fake.callsTo('POST /gyms/:gymId/door-code/rotate')).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId('door-qr').getAttribute('src')).not.toBe(before));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('shows a rotate error inside the confirm', async () => {
    const { user } = setup({ 'POST /gyms/:gymId/door-code/rotate': apiError(500, 'Could not rotate') });
    await user.click(screen.getByRole('tab', { name: 'Check-in poster' }));
    await screen.findByTestId('door-qr');
    await user.click(screen.getByRole('button', { name: 'Rotate code' }));
    await user.click(screen.getByRole('button', { name: 'Rotate now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not rotate');
  });
});

describe('Join QR page: referral reward', () => {
  it('loads and saves the reward text', async () => {
    const { user, fake } = setup();
    const input = await screen.findByLabelText('Reward');
    await waitFor(() => expect(input).toHaveValue('One free week'));
    expect(screen.getByText('3 joined through referrals')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '  ₹500 off your next renewal ');
    await user.click(screen.getByRole('button', { name: 'Save reward' }));
    expect(await screen.findByText('Referral reward saved')).toBeInTheDocument();
    expect(fake.callsTo('PUT /gyms/:gymId/referral')[0].body).toEqual({ reward: '₹500 off your next renewal' });
  });

  it('an empty reward is saved as null', async () => {
    const { user, fake } = setup();
    const input = await screen.findByLabelText('Reward');
    await waitFor(() => expect(input).toHaveValue('One free week'));
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Save reward' }));
    await screen.findByText('Referral reward saved');
    expect(fake.callsTo('PUT /gyms/:gymId/referral')[0].body).toEqual({ reward: null });
  });
});
