import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { PALETTE } from '@gymverse/shared';
import { MainShell } from '../Shell';
import { HomeScreen } from './HomeScreen';
import { NOW, gymFixture, makeFakeApi, meFixture, profileFixture, renderApp, summaryFixture } from '../test/fakeApi';
import { ApiError } from '../api/client';

const flatten = (style: any): Record<string, any> => (Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {});
const now = () => NOW;

describe('Home', () => {
  it('greets the member and shows the weekly goal, renew banner, coach workout, challenge and gym news', async () => {
    renderApp(<HomeScreen now={now} />);
    expect(await screen.findByText('Ravi!')).toBeTruthy();
    expect(screen.getByText('Good morning,')).toBeTruthy();
    expect(within(screen.getByTestId('weekly-goal')).getByText(/3 of 4 visits/)).toBeTruthy();
    expect(screen.getByTestId('weekly-percent')).toHaveTextContent('75%');
    expect(screen.getByText('↑ 1 more than last week')).toBeTruthy();
    expect(screen.getByText('Membership ends in 5 days')).toBeTruthy();
    expect(screen.getByText('From Coach Vikram')).toBeTruthy();
    expect(screen.getByText('30 check-ins in November')).toBeTruthy();
    expect(screen.getByText('Diwali timings')).toBeTruthy();
    expect(screen.getByLabelText('Notifications, 2 new')).toBeTruthy();
  });

  it('checks in with one tap, updates streak and weekly goal, and celebrates a new badge', async () => {
    const api = makeFakeApi({
      checkIn: async () => ({ alreadyCheckedIn: false, checkedInAt: NOW.toISOString(), streak: { current: 4, longest: 5 }, newBadges: ['checkins_10'], totalCheckIns: 13 }),
    });
    renderApp(<HomeScreen now={now} />, { api });
    fireEvent.press(await screen.findByLabelText('Check in now'));
    expect(await screen.findByLabelText('Checked in today')).toBeTruthy();
    expect(api.checkIn).toHaveBeenCalledWith('gym-1');
    expect(within(screen.getByTestId('streak')).getByText('4')).toBeTruthy();
    expect(screen.getByTestId('weekly-percent')).toHaveTextContent('100%');
    expect(await screen.findByTestId('badge-celebration')).toBeTruthy();
    expect(screen.getByText('Regular')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Awesome!'));
    await waitFor(() => expect(screen.queryByTestId('badge-celebration')).not.toBeOnTheScreen());
  });

  it('shows check-in errors in plain words and keeps the button usable', async () => {
    const api = makeFakeApi({
      checkIn: async () => {
        throw new ApiError(503, 'unavailable', 'The gym server is busy. Please try again in a minute.');
      },
    });
    renderApp(<HomeScreen now={now} />, { api });
    fireEvent.press(await screen.findByLabelText('Check in now'));
    expect(await screen.findByText(/gym server is busy/)).toBeTruthy();
    expect(screen.getByLabelText('Check in now')).toBeTruthy();
  });

  it('navigates from search, bell, quick actions, coach workout and challenge', async () => {
    const { nav } = renderApp(<HomeScreen now={now} />);
    fireEvent.press(await screen.findByTestId('search-pill'));
    expect(nav().stack.at(-1)?.name).toBe('Search');
    fireEvent.press(screen.getByTestId('bell'));
    expect(nav().stack.at(-1)?.name).toBe('Notifications');
    for (const [label, route] of [
      ['Nutrition', 'Nutrition'],
      ['Learn', 'Resources'],
      ['Progress', 'Progress'],
      ['Help', 'Support'],
    ]) {
      fireEvent.press(screen.getByLabelText(label));
      expect(nav().stack.at(-1)?.name).toBe(route);
    }
    fireEvent.press(screen.getByLabelText('Workout: Push day'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'RoutineDetail', params: { id: 'r1' } });
    fireEvent.press(screen.getByLabelText('Challenge: 30 check-ins in November'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'ChallengeDetail', params: { id: 'ch1' } });
    fireEvent.press(screen.getByLabelText('Renew'));
    expect(nav().renewOpen).toBe(true);
  });

  it('hides switched-off features', async () => {
    const api = makeFakeApi({
      me: async () => meFixture({ memberships: [{ gym: gymFixture({ enabledFeatures: ['checkin', 'announcements'] }), role: 'member', joinedAt: '' }] }),
    });
    renderApp(<HomeScreen now={now} />, { api });
    expect(await screen.findByLabelText('Check in now')).toBeTruthy();
    expect(screen.queryByLabelText('Nutrition')).toBeNull();
    expect(screen.queryByTestId('recommended-routine')).toBeNull();
    expect(screen.queryByTestId('challenge-card')).toBeNull();
    expect(screen.queryByTestId('renew-banner')).toBeNull();
  });
});

describe('Shell theming: default → gym → member', () => {
  const buttonBg = async () => flatten((await screen.findByTestId('checkin-button')).props.style).backgroundColor;

  it('uses Burgundy & Beige when the gym has not customised', async () => {
    renderApp(<MainShell />);
    expect(await buttonBg()).toBe(PALETTE.burgundy);
  });

  it("uses the gym's brand", async () => {
    const teal = gymFixture({ branding: { ...gymFixture().branding, primaryColor: '#0F766E', accentColor: '#CE8509' } });
    renderApp(<MainShell />, { api: makeFakeApi({ me: async () => meFixture({ memberships: [{ gym: teal, role: 'member', joinedAt: '' }] }) }) });
    expect(await buttonBg()).toBe('#0F766E');
  });

  it("uses the member's own theme over the gym's", async () => {
    const api = makeFakeApi({ me: async () => meFixture({ profile: profileFixture({ themeColor: '#0B4F6C' }) }) });
    renderApp(<MainShell />, { api });
    expect(await buttonBg()).toBe('#0B4F6C');
  });

  it('switching theme in Me re-skins the app instantly', async () => {
    renderApp(<MainShell />);
    fireEvent.press(await screen.findByLabelText('Me'));
    fireEvent.press(await screen.findByLabelText('Forest theme'));
    await waitFor(() => expect(screen.getByLabelText('Forest theme').props.accessibilityState).toEqual({ selected: true }));
    fireEvent.press(screen.getByLabelText('Home'));
    expect(await buttonBg()).toBe('#1F5135');
  });

  it('has five labelled tabs and hides tabs for switched-off features', async () => {
    renderApp(<MainShell />);
    for (const label of ['Home', 'Classes', 'Train', 'Community', 'Me']) expect(await screen.findByLabelText(label)).toBeTruthy();
    screen.unmount();
    const api = makeFakeApi({ me: async () => meFixture({ memberships: [{ gym: gymFixture({ enabledFeatures: ['checkin'] }), role: 'member', joinedAt: '' }] }) });
    renderApp(<MainShell />, { api });
    expect(await screen.findByLabelText('Home')).toBeTruthy();
    expect(screen.queryByLabelText('Classes')).toBeNull();
    expect(screen.queryByLabelText('Train')).toBeNull();
    expect(screen.queryByLabelText('Community')).toBeNull();
  });

  it('shows Hindi labels when the member picks Hindi', async () => {
    renderApp(<MainShell />, { api: makeFakeApi({ me: async () => meFixture({ profile: profileFixture({ language: 'hi' }) }) }) });
    expect(await screen.findByLabelText('होम')).toBeTruthy();
    expect(screen.getByLabelText('अभी चेक-इन करें')).toBeTruthy();
  });

  it('opens a pushed screen over the tabs and goes back', async () => {
    const { nav } = renderApp(<MainShell />);
    fireEvent.press(await screen.findByTestId('bell'));
    expect(await screen.findByText('Coach Vikram assigned you Push day')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Back'));
    await waitFor(() => expect(nav().stack).toHaveLength(0));
  });
});

describe('Renew membership (3 taps)', () => {
  it('banner → pick plan → pay → receipt', async () => {
    const api = makeFakeApi();
    renderApp(<MainShell />, { api });
    fireEvent.press(await screen.findByLabelText('Renew'));
    fireEvent.press(await screen.findByLabelText('Quarterly, ₹3,999'));
    fireEvent.press(screen.getByLabelText('Pay ₹3,999'));
    expect(await screen.findByTestId('payment-success')).toBeTruthy();
    expect(api.createOrder).toHaveBeenCalledWith('gym-1', 'p2');
    expect(api.verifyPayment).toHaveBeenCalledWith('gym-1', 'pay-1', expect.stringMatching(/^pay_mock_/), 'sig');
    expect(screen.getByText('Receipt FLEX42-00007')).toBeTruthy();
  });

  it('explains when online payment is not available', async () => {
    const api = makeFakeApi({
      createOrder: async () => ({ paymentId: 'x', providerOrderId: 'o', amountPaise: 1, currency: 'INR', plan: {}, status: 'created', provider: 'razorpay' }),
    });
    renderApp(<MainShell />, { api });
    fireEvent.press(await screen.findByLabelText('Renew'));
    fireEvent.press(await screen.findByLabelText('Pay ₹1,499'));
    expect(await screen.findByText(/pay at the front desk/)).toBeTruthy();
    expect(api.verifyPayment).not.toHaveBeenCalled();
  });
});

void summaryFixture;
