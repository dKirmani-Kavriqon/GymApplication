import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
// Per-weight imports keep unused weights and italics out of the bundle.
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold';
import { SessionProvider } from './state/session';
import { NavProvider } from './navigation/Nav';
import { ToastProvider } from './components/Toast';
import { ThemeProvider } from './theme/ThemeContext';
import { Root } from './Root';

export default function App() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  // Don't hold the app hostage to a slow font download: fall back to system fonts after 2.5s.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), 2500);
    return () => clearTimeout(id);
  }, []);
  if (!fontsLoaded && !timedOut) return null;

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <ThemeProvider>
          <NavProvider>
            <ToastProvider>
              <StatusBar style="auto" />
              <Root />
            </ToastProvider>
          </NavProvider>
        </ThemeProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
