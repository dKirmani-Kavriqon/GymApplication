import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { nativeDriver } from '../utils/feedback';
import { Icon, type IconName } from './Icon';
import { Txt, shadow } from './ui';

interface ToastInput {
  title: string;
  body?: string;
  icon?: IconName;
}

const ToastCtx = createContext<{ show: (t: ToastInput) => void }>({ show: () => undefined });

/** "Task completed!"-style confirmation from the reference design. Auto-hides after 3s. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<(ToastInput & { key: number }) | null>(null);
  const show = useCallback((t: ToastInput) => setToast({ ...t, key: Date.now() }), []);
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      {toast ? <ToastView key={toast.key} toast={toast} onDone={() => setToast(null)} /> : null}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

function ToastView({ toast, onDone }: { toast: ToastInput; onDone: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(-20)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Animated.spring(y, { toValue: 0, useNativeDriver: nativeDriver, friction: 7 }).start();
    timer.current = setTimeout(onDone, 3000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [y, onDone]);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: insets.top + 10, left: 16, right: 16, transform: [{ translateY: y }] }}
    >
      <View
        testID="toast"
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.surface, borderRadius: t.radius.lg, padding: 14, borderWidth: 1, borderColor: t.border, ...shadow(t, 1.4) }}
      >
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={toast.icon ?? 'check'} size={18} color={t.onPrimary} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong">{toast.title}</Txt>
          {toast.body ? (
            <Txt variant="small" color="textMuted">
              {toast.body}
            </Txt>
          ) : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDone} hitSlop={10}>
          <Icon name="x" size={18} color={t.textMuted} />
        </Pressable>
      </View>
    </Animated.View>
  );
}
