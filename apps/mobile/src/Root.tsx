import React, { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import type { GymPreview } from '@gymverse/shared';
import { ErrorText, Loading, Screen } from './components/ui';
import { useSession } from './state/session';
import { ThemeProvider } from './theme/ThemeContext';
import { parseDoorToken, parseJoinCode } from './utils/format';
import { useToast } from './components/Toast';
import { successFeedback } from './utils/feedback';
import { IntroScreen } from './screens/onboarding/IntroScreen';
import { WelcomeScreen } from './screens/onboarding/WelcomeScreen';
import { PhoneScreen } from './screens/onboarding/PhoneScreen';
import { OtpScreen } from './screens/onboarding/OtpScreen';
import { SetupWizard } from './screens/onboarding/SetupWizard';
import { ConsentScreen } from './screens/onboarding/ConsentScreen';
import { MainShell } from './Shell';

const INTRO_KEY = 'gv.introSeen';
type Step = 'welcome' | 'phone' | 'otp';

/**
 * Decides what to show: intro → find gym → phone → code → set-up wizard → join → app (PRD §7).
 * A gym QR/deep link (gymverse://join/CODE) pre-fills the gym and themes onboarding with its brand.
 */
export function Root({ initialUrl }: { initialUrl?: string | null }) {
  const { status, me, api, refreshMe, selectGym, activeGym, storage } = useSession();
  const [introSeen, setIntroSeen] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<GymPreview | null>(null);
  const [linkCode, setLinkCode] = useState<string | null>(initialUrl ? parseJoinCode(initialUrl) : null);
  const [doorToken, setDoorToken] = useState<string | null>(initialUrl ? parseDoorToken(initialUrl) : null);
  const toast = useToast();
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('welcome');
  const [phone, setPhone] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    storage
      .getItem(INTRO_KEY)
      .then((v) => setIntroSeen(v === '1'))
      .catch(() => setIntroSeen(true));
  }, [storage]);

  // Deep links from the gym's QR poster.
  useEffect(() => {
    if (initialUrl !== undefined) return;
    const handle = (url: string) => {
      const door = parseDoorToken(url);
      if (door) setDoorToken(door);
      else setLinkCode(parseJoinCode(url));
    };
    Linking.getInitialURL()
      .then((url) => url && handle(url))
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, [initialUrl]);

  // A scanned code shows the gym's branded preview straight away.
  useEffect(() => {
    if (!linkCode) return;
    api
      .previewGym(linkCode)
      .then((p) => {
        setPreview(p);
        setStep('welcome');
      })
      .catch(() => undefined);
  }, [linkCode, api]);

  const needsConsent = !!me?.consent && (me.consent.needsConsent || me.consent.needsGuardian);
  const ready = status === 'signedIn' && !!me?.user.name && !!me?.profile.setupComplete && !needsConsent;

  // After sign-in and set-up, join the gym the person picked.
  useEffect(() => {
    if (!ready || !pendingCode) return;
    let alive = true;
    api
      .joinGym(pendingCode)
      .then(async ({ gym }) => {
        selectGym(gym.id);
        await refreshMe();
        if (alive) {
          setPendingCode(null);
          setPreview(null);
          setLinkCode(null);
        }
      })
      .catch((err) => alive && setJoinError((err as Error).message));
    return () => {
      alive = false;
    };
  }, [ready, pendingCode, api, selectGym, refreshMe]);

  // Door QR scanned with the phone camera: check in to the active gym.
  useEffect(() => {
    if (!ready || !doorToken || !activeGym) return;
    const token = doorToken;
    setDoorToken(null);
    api
      .checkInWith(activeGym.gym.id, { method: 'qr', doorToken: token })
      .then((res) => {
        successFeedback();
        toast.show(res.alreadyCheckedIn ? { title: 'Already checked in today' } : { title: `Checked in at ${activeGym.gym.name}`, body: `${res.streak.current}-day streak` });
      })
      .catch((err) => toast.show({ title: "Couldn't check you in", body: (err as Error).message, icon: 'alert-circle' }));
  }, [ready, doorToken, activeGym, api, toast]);

  if (status === 'loading' || introSeen === null) return <Loading />;
  const onboardingBrand = preview?.branding ?? activeGym?.gym.branding;

  if (status === 'signedOut') {
    if (!introSeen && !linkCode) {
      return (
        <ThemeProvider>
          <IntroScreen
            onDone={() => {
              setIntroSeen(true);
              void storage.setItem(INTRO_KEY, '1');
            }}
          />
        </ThemeProvider>
      );
    }
    return (
      <ThemeProvider branding={preview?.branding}>
        {step === 'welcome' ? (
          <WelcomeScreen
            initialCode={linkCode}
            preview={preview}
            onPreview={setPreview}
            onContinue={() => {
              setPendingCode(preview!.joinCode);
              setStep('phone');
            }}
            onHaveAccount={() => setStep('phone')}
          />
        ) : step === 'phone' ? (
          <PhoneScreen
            onBack={() => setStep('welcome')}
            onSent={(p, code) => {
              setPhone(p);
              setDevCode(code);
              setStep('otp');
            }}
          />
        ) : (
          <OtpScreen phone={phone} devCode={devCode} onBack={() => setStep('phone')} />
        )}
      </ThemeProvider>
    );
  }

  if (!me) return <Loading />;

  if (!me.user.name || !me.profile.setupComplete) {
    return (
      <ThemeProvider branding={onboardingBrand}>
        <SetupWizard />
      </ThemeProvider>
    );
  }

  if (needsConsent) {
    return (
      <ThemeProvider branding={onboardingBrand}>
        <ConsentScreen />
      </ThemeProvider>
    );
  }

  if (pendingCode) {
    return (
      <ThemeProvider branding={preview?.branding}>
        {joinError ? (
          <Screen>
            <ErrorText message={joinError} />
          </Screen>
        ) : (
          <Loading label="Joining your gym" />
        )}
      </ThemeProvider>
    );
  }

  if (!activeGym || preview) {
    // Signed in but no gym yet, or a new gym QR was scanned while signed in.
    return (
      <ThemeProvider branding={preview?.branding}>
        <WelcomeScreen
          initialCode={linkCode}
          preview={preview}
          onPreview={(p) => {
            setPreview(p);
            if (!p) setLinkCode(null);
          }}
          onContinue={() => setPendingCode(preview!.joinCode)}
        />
      </ThemeProvider>
    );
  }

  return <MainShell />;
}
Root.isRoot = true;
