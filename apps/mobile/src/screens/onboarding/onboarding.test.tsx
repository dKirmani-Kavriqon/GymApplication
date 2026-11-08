import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { MeResponse } from '@gymverse/shared';
import { Root } from '../../Root';
import { SessionProvider, memoryStorage } from '../../state/session';
import { NavProvider } from '../../navigation/Nav';
import { ToastProvider } from '../../components/Toast';
import type { Api } from '../../api/client';
import { gymFixture, makeFakeApi, meFixture, profileFixture, renderApp } from '../../test/fakeApi';

/** A stateful fake backend for a brand-new member. */
function newMemberApi() {
  let me: MeResponse = meFixture({
    user: { id: 'new', phone: '+919876543210', name: null, avatarUrl: null },
    profile: profileFixture({ goal: null, gender: null, activityLevel: null, heightCm: null, weightKg: null, birthYear: null, weeklyGoal: 3, setupComplete: false }),
    memberships: [],
  });
  return makeFakeApi({
    verifyOtp: async () => ({ token: 'tok', isNewUser: true, user: me.user }),
    me: async () => me,
    updateProfile: async (p: any) => {
      const { name, ...rest } = p;
      const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      me = { ...me, user: { ...me.user, name: name ?? me.user.name }, profile: { ...me.profile, ...clean } };
      return me;
    },
    joinGym: async () => {
      me = { ...me, memberships: [{ gym: gymFixture(), role: 'member', joinedAt: '2026-11-08T00:00:00Z' }] };
      return { gym: gymFixture(), role: 'member', alreadyMember: false };
    },
  });
}

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

describe('member onboarding (intro → code → phone → OTP → set-up → home)', () => {
  it('runs the whole flow on first launch', async () => {
    const api = newMemberApi();
    render(
      <SafeAreaProvider initialMetrics={metrics}>
        <SessionProvider makeApi={() => api as unknown as Api} storage={memoryStorage()}>
          <NavProvider>
            <ToastProvider>
              <Root initialUrl={null} />
            </ToastProvider>
          </NavProvider>
        </SessionProvider>
      </SafeAreaProvider>,
    );

    expect(await screen.findByText('Check in with one tap')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Next'));
    fireEvent.press(screen.getByLabelText('Next'));
    fireEvent.press(screen.getByLabelText('Get started'));

    fireEvent.changeText(await screen.findByLabelText('Gym code'), 'flex42');
    fireEvent.press(screen.getByLabelText('Find my gym'));
    expect(await screen.findByText('Stronger every day')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Join Flex Fitness'));

    fireEvent.changeText(await screen.findByLabelText('Mobile number'), '98765 43210');
    fireEvent.press(screen.getByLabelText('Send code'));
    expect(await screen.findByTestId('dev-code')).toBeTruthy();
    expect(api.requestOtp).toHaveBeenCalledWith('+919876543210');
    fireEvent.changeText(screen.getByLabelText('6-digit code'), '123456');
    await waitFor(() => expect(api.verifyOtp).toHaveBeenCalledWith('+919876543210', '123456'));

    // Set-up wizard: name is required, the rest is tap-only.
    fireEvent.press(await screen.findByLabelText('Next'));
    expect(await screen.findByText('Tell us your name.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Your name'), 'Ravi');
    fireEvent.press(screen.getByLabelText('Next'));
    fireEvent.press(await screen.findByLabelText('Male'));
    fireEvent.press(screen.getByLabelText('Next'));
    fireEvent.press(await screen.findByLabelText('Increase Age')); // 31
    fireEvent.press(screen.getByLabelText('Next'));
    fireEvent.press(await screen.findByLabelText('Skip')); // height
    fireEvent.press(await screen.findByLabelText('Decrease Weight')); // 64.5
    fireEvent.press(screen.getByLabelText('Next'));
    fireEvent.press(await screen.findByLabelText('Build muscle'));
    fireEvent.press(screen.getByLabelText('Next'));
    fireEvent.press(await screen.findByLabelText('Active'));
    fireEvent.press(screen.getByLabelText('Next'));
    fireEvent.press(await screen.findByLabelText('Increase Visits per week'));
    fireEvent.press(screen.getByLabelText("Let's go"));

    expect(await screen.findByLabelText('Check in now')).toBeTruthy();
    expect(api.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ravi',
        gender: 'male',
        birthYear: new Date().getFullYear() - 31,
        heightCm: undefined,
        weightKg: 64.5,
        goal: 'build_muscle',
        activityLevel: 'moderate',
        weeklyGoal: 4,
        setupComplete: true,
      }),
    );
    expect(api.joinGym).toHaveBeenCalledWith('FLEX42');
  });

  it('opens straight to the branded gym preview from a QR deep link', async () => {
    const api = newMemberApi();
    renderApp(<Root initialUrl="gymverse://join/FLEX42" />, { api, signedIn: false });
    expect(await screen.findByLabelText('Join Flex Fitness')).toBeTruthy();
    expect(api.previewGym).toHaveBeenCalledWith('FLEX42');
  });

  it('explains a wrong gym code', async () => {
    renderApp(<Root initialUrl={null} />, { api: newMemberApi(), signedIn: false });
    fireEvent.changeText(await screen.findByLabelText('Gym code'), 'ZZZZZZ');
    fireEvent.press(screen.getByLabelText('Find my gym'));
    expect(await screen.findByText('We could not find a gym with that code.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Gym code'), 'abc');
    fireEvent.press(screen.getByLabelText('Find my gym'));
    expect(await screen.findByText('Gym codes have 6 letters or numbers.')).toBeTruthy();
  });

  it('validates the phone number before sending', async () => {
    const api = newMemberApi();
    renderApp(<Root initialUrl={null} />, { api, signedIn: false });
    fireEvent.press(await screen.findByLabelText('I already have an account'));
    fireEvent.changeText(await screen.findByLabelText('Mobile number'), '123');
    fireEvent.press(screen.getByLabelText('Send code'));
    expect(await screen.findByText('Enter your 10-digit mobile number.')).toBeTruthy();
    expect(api.requestOtp).not.toHaveBeenCalled();
  });

  it('returning members who finished set-up go straight to Home', async () => {
    const api = makeFakeApi();
    renderApp(<Root initialUrl={null} />, { api, signedIn: false });
    fireEvent.press(await screen.findByLabelText('I already have an account'));
    fireEvent.changeText(await screen.findByLabelText('Mobile number'), '9999900002');
    fireEvent.press(screen.getByLabelText('Send code'));
    fireEvent.changeText(await screen.findByLabelText('6-digit code'), '123456');
    expect(await screen.findByLabelText('Check in now')).toBeTruthy();
  });

  it('members who never finished set-up see the wizard prefilled and can skip through', async () => {
    const api = makeFakeApi({ me: async () => meFixture({ profile: profileFixture({ setupComplete: false }) }) });
    renderApp(<Root initialUrl={null} />, { api, gate: false });
    expect(await screen.findByDisplayValue('Ravi Kumar')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Next'));
    for (let i = 0; i < 6; i++) fireEvent.press(await screen.findByLabelText('Skip'));
    fireEvent.press(await screen.findByLabelText("Let's go"));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ setupComplete: true, weeklyGoal: 4 })));
  });
});
