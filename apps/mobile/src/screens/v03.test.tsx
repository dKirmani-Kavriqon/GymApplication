import React from 'react';
import { Share } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Root } from '../Root';
import { MainShell } from '../Shell';
import { HomeScreen } from './HomeScreen';
import { MeScreen } from './MeScreen';
import { SettingsScreen } from './me/SettingsScreen';
import { CoachScreen } from './me/CoachScreen';
import { ApiError } from '../api/client';
import { NOW, gymFixture, makeFakeApi, meFixture, profileFixture, renderApp, summaryFixture } from '../test/fakeApi';
import { flushCheckIns, pendingFor, queueCheckIn } from '../utils/offlineQueue';
import { memoryStorage } from '../state/session';
import { parseDoorToken } from '../utils/format';

const now = () => NOW;
const consent = (over = {}) => ({ termsVersion: null, acceptedAt: null, guardianConsent: false, guardianName: null, needsConsent: true, needsGuardian: false, ...over });

beforeEach(() => {
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
});
afterEach(() => jest.restoreAllMocks());

describe('consent (DPDP / app stores)', () => {
  it('asks for consent before the app opens, then continues', async () => {
    let accepted = false;
    const api = makeFakeApi({
      me: async () => meFixture({ consent: accepted ? consent({ needsConsent: false }) : consent() }),
      acceptConsent: async (input: any) => {
        accepted = true;
        return consent({ needsConsent: false, termsVersion: input.termsVersion });
      },
    });
    renderApp(<Root initialUrl={null} />, { api, gate: false });
    expect(await screen.findByText('Your data, your choice')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Agree and continue'));
    expect(await screen.findByText('Please agree to the terms to continue.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('I agree to the Terms of Use and Privacy Policy'));
    fireEvent.press(screen.getByLabelText('Agree and continue'));
    expect(await screen.findByLabelText('Check in now')).toBeTruthy();
    expect(api.acceptConsent).toHaveBeenCalledWith({ termsVersion: '2026-11' });
  });

  it("requires a guardian's name and consent for members under 18", async () => {
    let accepted = false;
    const api = makeFakeApi({
      me: async () => meFixture({ consent: accepted ? consent({ needsConsent: false }) : consent({ needsGuardian: true }) }),
      acceptConsent: async () => {
        accepted = true;
        return consent({ needsConsent: false });
      },
    });
    renderApp(<Root initialUrl={null} />, { api, gate: false });
    fireEvent.press(await screen.findByLabelText('I agree to the Terms of Use and Privacy Policy'));
    fireEvent.press(screen.getByLabelText('Agree and continue'));
    expect(await screen.findByText("A parent or guardian needs to agree, and we need their name.")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Parent or guardian's name"), 'Sunita Kumar');
    fireEvent.press(screen.getByLabelText('My parent or guardian has read and agrees to the terms'));
    fireEvent.press(screen.getByLabelText('Agree and continue'));
    await waitFor(() => expect(api.acceptConsent).toHaveBeenCalledWith({ termsVersion: '2026-11', guardianConsent: true, guardianName: 'Sunita Kumar' }));
  });
});

describe('your data', () => {
  it('downloads the data export through the share sheet', async () => {
    const api = makeFakeApi();
    renderApp(<SettingsScreen />, { api });
    fireEvent.press(await screen.findByTestId('export-data'));
    await waitFor(() => expect(Share.share).toHaveBeenCalled());
    expect(api.exportAccount).toHaveBeenCalled();
    expect((Share.share as jest.Mock).mock.calls[0][0].message).toContain('"exportedAt"');
  });

  it('deletes the account only after typing DELETE, then signs out', async () => {
    const api = makeFakeApi();
    renderApp(<Root initialUrl={null} />, { api, gate: false });
    fireEvent.press(await screen.findByLabelText('Me'));
    fireEvent.press(await screen.findByLabelText('Settings, Goal, reminders, language, security'));
    fireEvent.press(await screen.findByTestId('delete-account'));
    const confirm = await screen.findByLabelText('Delete my account', { exact: true });
    expect(confirm.props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    fireEvent.press(screen.getAllByLabelText('Delete my account').at(-1)!);
    await waitFor(() => expect(api.deleteAccount).toHaveBeenCalled());
    expect(await screen.findByText('Welcome!')).toBeTruthy();
  });
});

describe('Home extras', () => {
  it('shows how busy the gym is', async () => {
    const api = makeFakeApi({ summary: async () => summaryFixture({ crowd: { level: 'busy', recentCheckIns: 31 } }) });
    renderApp(<HomeScreen now={now} />, { api });
    expect(await screen.findByText('Busy right now')).toBeTruthy();
  });

  it('checks in offline and syncs later', async () => {
    const api = makeFakeApi({
      checkIn: async () => {
        throw new ApiError(0, 'network', 'No internet connection.');
      },
    });
    const { storage } = renderApp(<HomeScreen now={now} />, { api });
    fireEvent.press(await screen.findByLabelText('Check in now'));
    expect(await screen.findByText('Checked in offline')).toBeTruthy();
    expect(screen.getByLabelText('Checked in today')).toBeTruthy();
    expect(await pendingFor(storage, 'gym-1')).toEqual([{ gymId: 'gym-1', occurredAt: NOW.toISOString() }]);
  });

  it('invites a friend with the referral link', async () => {
    const api = makeFakeApi();
    renderApp(<HomeScreen now={now} />, { api });
    fireEvent.press(await screen.findByLabelText('Invite a friend'));
    await waitFor(() => expect(Share.share).toHaveBeenCalledWith({ message: 'Join me at Flex Fitness! https://gymverse.app/join/FLEX42?ref=u1' }));
  });

  it('shows coach tools to staff only', async () => {
    renderApp(<HomeScreen now={now} />);
    await screen.findByLabelText('Check in now');
    expect(screen.queryByTestId('coach-card')).toBeNull();
    screen.unmount();
    const api = makeFakeApi({ me: async () => meFixture({ memberships: [{ gym: gymFixture(), role: 'trainer', joinedAt: '' }] }) });
    const { nav } = renderApp(<HomeScreen now={now} />, { api });
    fireEvent.press(await screen.findByTestId('coach-card'));
    expect(nav().stack.at(-1)?.name).toBe('Coach');
  });
});

describe('offline queue', () => {
  it('sends queued check-ins, keeps them on network errors and drops stale ones', async () => {
    const storage = memoryStorage();
    await queueCheckIn(storage, { gymId: 'g', occurredAt: '2026-11-08T08:00:00.000Z' });
    await queueCheckIn(storage, { gymId: 'g', occurredAt: '2026-11-08T08:30:00.000Z' }); // same day: ignored
    await queueCheckIn(storage, { gymId: 'g', occurredAt: '2026-11-06T08:00:00.000Z' }); // too old by flush time
    const offline = makeFakeApi({
      checkInWith: async () => {
        throw new ApiError(0, 'network', 'offline');
      },
    });
    expect(await flushCheckIns(storage, offline as never, new Date('2026-11-08T09:00:00Z'))).toBe(0);
    expect(await pendingFor(storage, 'g')).toHaveLength(1);
    const online = makeFakeApi();
    expect(await flushCheckIns(storage, online as never, new Date('2026-11-08T09:00:00Z'))).toBe(1);
    expect(online.checkInWith).toHaveBeenCalledWith('g', { method: 'button', occurredAt: '2026-11-08T08:00:00.000Z' });
    expect(await pendingFor(storage, 'g')).toHaveLength(0);
  });
});

describe('door QR check-in', () => {
  it('parses door links', () => {
    expect(parseDoorToken('gymverse://checkin/AbC123xyz_-')).toBe('AbC123xyz_-');
    expect(parseDoorToken('https://gymverse.app/checkin/AbC123xyz?x=1')).toBe('AbC123xyz');
    expect(parseDoorToken('gymverse://join/FLEX42')).toBeNull();
  });

  it('checks in when the app is opened from the door QR', async () => {
    const api = makeFakeApi();
    renderApp(<Root initialUrl="gymverse://checkin/door-token-123" />, { api, gate: false });
    await waitFor(() => expect(api.checkInWith).toHaveBeenCalledWith('gym-1', { method: 'qr', doorToken: 'door-token-123' }));
    expect(await screen.findByText('Checked in at Flex Fitness')).toBeTruthy();
  });
});

describe('Coach', () => {
  it('marks attendance with one tap and rolls back on error', async () => {
    let fail = false;
    const api = makeFakeApi({
      markAttendance: async (_g: string, _c: string, userId: string, attended: boolean) => {
        if (fail) throw new ApiError(500, 'internal', 'Something went wrong.');
        return { userId, name: 'Anita Desai', phone: '', status: 'booked', attended };
      },
    });
    renderApp(<CoachScreen now={now} />, { api });
    expect(await screen.findByText('1/2 here')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Anita Desai attended'));
    expect(await screen.findByText('2/2 here')).toBeTruthy();
    expect(api.markAttendance).toHaveBeenCalledWith('gym-1', 'c1', 'u2', true);
    fail = true;
    fireEvent.press(screen.getByLabelText('Karan Mehta attended'));
    expect(await screen.findByText("Couldn't save attendance")).toBeTruthy();
    expect(screen.getByText('2/2 here')).toBeTruthy();
  });
});

describe('Razorpay hosted checkout', () => {
  const order = { paymentId: 'pay-9', providerOrderId: 'order_rzp', amountPaise: 399900, currency: 'INR', status: 'created', provider: 'razorpay', keyId: 'rzp_live_x', checkoutUrl: 'https://api.example.com/pay/pay-9?t=tok' };

  it('opens checkout, returns to the app and confirms the payment', async () => {
    const WebBrowser = jest.requireMock('expo-web-browser');
    WebBrowser.openAuthSessionAsync.mockResolvedValueOnce({ type: 'success', url: 'gymverse://payment/pay-9?status=paid' });
    const api = makeFakeApi({ createOrder: async () => ({ ...order, plan: { id: 'p2', name: 'Quarterly', durationDays: 90, pricePaise: 399900, benefits: [] } }) });
    renderApp(<MainShell />, { api });
    fireEvent.press(await screen.findByLabelText('Renew'));
    fireEvent.press(await screen.findByLabelText('Pay ₹1,499'));
    expect(await screen.findByTestId('payment-success')).toBeTruthy();
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(order.checkoutUrl, 'gymverse://payment');
    expect(api.payment).toHaveBeenCalledWith('gym-1', 'pay-9');
    expect(screen.getByText('Receipt FLEX42-00008')).toBeTruthy();
  });

  it('says nothing was charged when checkout is dismissed', async () => {
    const api = makeFakeApi({
      createOrder: async () => ({ ...order, plan: { id: 'p1', name: 'Monthly', durationDays: 30, pricePaise: 149900, benefits: [] } }),
      payment: async () => ({ id: 'pay-9', planName: 'Monthly', amountPaise: 149900, status: 'created', receiptNumber: null, createdAt: '', paidAt: null, membershipEndsAt: null }),
    });
    renderApp(<MainShell />, { api });
    fireEvent.press(await screen.findByLabelText('Renew'));
    fireEvent.press(await screen.findByLabelText('Pay ₹1,499'));
    expect(await screen.findByText('Payment was not completed. You have not been charged.')).toBeTruthy();
  });
});

describe('Membership', () => {
  it('applies a coupon before paying', async () => {
    const api = makeFakeApi();
    renderApp(<MainShell />, { api });
    fireEvent.press(await screen.findByLabelText('Renew'));
    fireEvent.press(await screen.findByLabelText('Quarterly, ₹3,999'));
    fireEvent.press(screen.getByLabelText('Have a coupon code?'));
    fireEvent.changeText(screen.getByLabelText('Coupon code'), 'nope');
    fireEvent.press(screen.getByLabelText('Apply code'));
    expect(await screen.findByText("That code isn't valid.")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Coupon code'), 'diwali20');
    fireEvent.press(screen.getByLabelText('Apply code'));
    expect(await screen.findByTestId('coupon-applied')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Pay ₹3,199.20'));
    expect(await screen.findByTestId('payment-success')).toBeTruthy();
    expect(api.createOrderWithCoupon).toHaveBeenCalledWith('gym-1', 'p2', 'DIWALI20');
  });

  it('requests a membership pause', async () => {
    const api = makeFakeApi({ summary: async () => summaryFixture({ membership: { state: 'active', daysLeft: 40, planName: 'Quarterly', endsAt: '2026-12-18T09:00:00Z' } }) });
    renderApp(<MeScreen />, { api });
    fireEvent.press(await screen.findByLabelText('Pause membership'));
    fireEvent.press(await screen.findByLabelText('Injury'));
    fireEvent.press(screen.getByLabelText('Increase pause length'));
    fireEvent.press(screen.getByLabelText('Send request'));
    await waitFor(() => expect(api.requestFreeze).toHaveBeenCalledTimes(1));
    const [, body] = api.requestFreeze.mock.calls[0];
    expect(body.reason).toBe('Injury');
    expect(body.endsOn > body.startsOn).toBe(true);
    expect(await screen.findByText('Pause requested')).toBeTruthy();
  });
});

void profileFixture;
