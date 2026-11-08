import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import type { Api } from '../api/client';
import { openLink, type NavValue } from '../navigation/Nav';

// Show notifications while the app is open, too (banner + list, quiet).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

/**
 * Registers this phone for push (Expo push service → APNs/FCM) and returns the token, or null on
 * web, simulators, or when the member declines. Needs the EAS projectId (`eas init`).
 */
export function easProjectId(): string | undefined {
  return (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
}

export async function registerForPush(api: Api, projectId: string | undefined = easProjectId()): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'GymVerse',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: '#6B0F1A',
      });
    }
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return null;
    if (!projectId) return null; // run `eas init` to enable push
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.registerDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
    return token;
  } catch {
    return null; // never block the app on push setup
  }
}

/** Registers once per session and routes notification taps to the right screen. */
export function usePushNotifications(api: Api, nav: NavValue, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    void registerForPush(api);
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const link = (response.notification.request.content.data as { link?: string } | undefined)?.link;
      openLink(nav, link ?? null);
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, enabled]);
}
