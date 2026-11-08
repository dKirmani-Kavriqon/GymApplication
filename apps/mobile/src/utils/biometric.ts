import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** App lock with Face ID / fingerprint (FitBody gap: "Set your fingerprint"). Device-only setting. */
export const BIOMETRIC_KEY = 'gv.biometricLock';

export async function biometricAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

export async function authenticate(reason = 'Unlock GymVerse'): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: reason, fallbackLabel: 'Use passcode' });
    return res.success;
  } catch {
    return false;
  }
}

export async function isLockEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(BIOMETRIC_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setLockEnabled(on: boolean): Promise<void> {
  await (on ? AsyncStorage.setItem(BIOMETRIC_KEY, '1') : AsyncStorage.removeItem(BIOMETRIC_KEY));
}
