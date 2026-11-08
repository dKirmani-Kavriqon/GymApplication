import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Dimensions, View } from 'react-native';
import { resolveMemberBranding } from '@gymverse/shared';
import { TabBar, type TabDef } from './components/TabBar';
import { ToastProvider } from './components/Toast';
import { Button, IconTile, Txt } from './components/ui';
import { useSession } from './state/session';
import { useNav, type StackEntry, type TabKey } from './navigation/Nav';
import { routes } from './navigation/routes';
import { CommunityTab, TrainTab } from './navigation/featureRoutes';
import { ThemeProvider, useTheme } from './theme/ThemeContext';
import { useT } from './i18n';
import { HomeScreen } from './screens/HomeScreen';
import { ClassesScreen } from './screens/ClassesScreen';
import { MeScreen } from './screens/MeScreen';
import { RenewSheet } from './screens/RenewSheet';
import { authenticate, biometricAvailable, isLockEnabled } from './utils/biometric';
import { nativeDriver, useReduceMotion } from './utils/feedback';
import { usePushNotifications } from './utils/push';
import { FadeIn } from './components/motion';

/** Main app, re-themed with: GymVerse default → gym brand → the member's own theme. */
export function MainShell() {
  const { activeGym, me } = useSession();
  const branding = resolveMemberBranding(activeGym!.gym.branding, me?.profile);
  return (
    <ThemeProvider branding={branding}>
      <ToastProvider>
        <LockGate>
          <ShellBody />
        </LockGate>
      </ToastProvider>
    </ThemeProvider>
  );
}

function ShellBody() {
  const { activeGym, api } = useSession();
  const nav = useNav();
  usePushNotifications(api, nav, true);
  const t = useTheme();
  const tr = useT();
  const [paidVersion, setPaidVersion] = useState(0);
  const gym = activeGym!.gym;
  const f = gym.enabledFeatures;

  const tabs: TabDef[] = [
    { key: 'home' as TabKey, label: tr('tab.home'), icon: 'home' as const },
    f.includes('classes') ? { key: 'classes' as TabKey, label: tr('tab.classes'), icon: 'calendar' as const } : null,
    f.includes('workouts') ? { key: 'train' as TabKey, label: tr('tab.train'), icon: 'activity' as const } : null,
    f.includes('community') ? { key: 'community' as TabKey, label: tr('tab.community'), icon: 'users' as const } : null,
    { key: 'me' as TabKey, label: tr('tab.me'), icon: 'user' as const },
  ].filter(Boolean) as TabDef[];
  const current = tabs.some((x) => x.key === nav.tab) ? nav.tab : 'home';
  const top = nav.stack[nav.stack.length - 1];

  return (
    <View style={{ flex: 1, backgroundColor: t.background }} key={gym.id}>
      <View style={{ flex: 1, display: top ? 'none' : 'flex' }}>
        <FadeIn key={current} style={{ flex: 1 }}>
          {current === 'home' ? <HomeScreen key={paidVersion} /> : null}
          {current === 'classes' ? <ClassesScreen /> : null}
          {current === 'train' ? <TrainTab /> : null}
          {current === 'community' ? <CommunityTab /> : null}
          {current === 'me' ? <MeScreen paidVersion={paidVersion} /> : null}
        </FadeIn>
        <TabBar active={current} onChange={nav.setTab} tabs={tabs} />
      </View>
      {nav.stack.map((entry) => (
        <StackScreen key={entry.key} entry={entry} visible={entry === top} />
      ))}
      <RenewSheet visible={nav.renewOpen} onClose={nav.closeRenew} onPaid={() => setPaidVersion((v) => v + 1)} />
    </View>
  );
}

function StackScreen({ entry, visible }: { entry: StackEntry; visible: boolean }) {
  const reduce = useReduceMotion();
  const x = useRef(new Animated.Value(reduce ? 0 : Dimensions.get('window').width * 0.25)).current;
  const opacity = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.parallel([
      Animated.spring(x, { toValue: 0, useNativeDriver: nativeDriver, friction: 9, tension: 80 }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: nativeDriver }),
    ]).start();
  }, [reduce, x, opacity]);
  const Screen = routes[entry.name];
  return (
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: visible ? 'flex' : 'none', opacity, transform: [{ translateX: x }] }}>
      {Screen ? <Screen params={entry.params} /> : <Txt variant="body">Unknown screen: {entry.name}</Txt>}
    </Animated.View>
  );
}

/** Face ID / fingerprint lock (Settings → Privacy & security). Re-locks after 60s in the background. */
function LockGate({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const [locked, setLocked] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if ((await isLockEnabled()) && (await biometricAvailable()) && alive) setLocked(true);
    })();
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active' && backgroundedAt.current && Date.now() - backgroundedAt.current > 60_000 && (await isLockEnabled())) setLocked(true);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  if (!locked) return <>{children}</>;
  return (
    <View testID="lock-screen" style={{ flex: 1, backgroundColor: t.background, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
      <IconTile icon="lock" size={88} tone="primary" />
      <Txt variant="h1" color="heading">
        GymVerse is locked
      </Txt>
      <Txt variant="body" color="textMuted" align="center">
        Use Face ID or your fingerprint to continue.
      </Txt>
      <Button label="Unlock" icon="unlock" onPress={async () => (await authenticate()) && setLocked(false)} />
    </View>
  );
}
