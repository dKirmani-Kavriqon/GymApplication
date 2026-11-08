import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { TYPE } from '../theme/type';
import { nativeDriver, tapFeedback, useReduceMotion } from '../utils/feedback';
import { Icon } from './Icon';
import { shadow } from './ui';

const CONFETTI = 16;

/**
 * The one main action on Home (PRD §7 "Daily check-in, 1 tap"): a full-width pill.
 * Success moment: the pill pops, a ring pulses out and confetti bursts (skipped with Reduce Motion).
 */
export function CheckInButton({
  checkedIn,
  loading,
  onPress,
  celebrate,
  label,
  doneLabel,
}: {
  checkedIn: boolean;
  loading?: boolean;
  onPress: () => void;
  /** Increments each time a fresh check-in succeeds, to trigger the animation. */
  celebrate: number;
  label: string;
  doneLabel: string;
}) {
  const t = useTheme();
  const reduceMotion = useReduceMotion();
  const pop = useRef(new Animated.Value(1)).current;
  const burst = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!celebrate || reduceMotion) return;
    pop.setValue(0.9);
    burst.setValue(0);
    Animated.parallel([
      Animated.spring(pop, { toValue: 1, friction: 3, tension: 140, useNativeDriver: nativeDriver }),
      Animated.timing(burst, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver }),
    ]).start();
  }, [celebrate, reduceMotion, pop, burst]);

  const colors = [t.primary, t.accent, t.tint2, t.success, t.primaryText];

  return (
    <View style={{ alignItems: 'stretch', justifyContent: 'center' }}>
      {Array.from({ length: CONFETTI }, (_, i) => {
        const angle = (i / CONFETTI) * Math.PI * 2;
        const dist = 80 + (i % 3) * 22;
        return (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: '50%',
              top: 24,
              width: 9,
              height: i % 2 ? 9 : 14,
              borderRadius: 3,
              backgroundColor: colors[i % colors.length],
              opacity: burst.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 1, 1, 0] }),
              transform: [
                { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * dist * 1.6] }) },
                { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * dist * 0.6] }) },
                { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${(i % 2 ? 1 : -1) * 240}deg`] }) },
              ],
            }}
          />
        );
      })}
      <Animated.View style={{ transform: [{ scale: pop }] }}>
        <Pressable
          testID="checkin-button"
          accessibilityRole="button"
          accessibilityLabel={checkedIn ? doneLabel : label}
          accessibilityState={{ disabled: checkedIn || !!loading, busy: !!loading }}
          disabled={checkedIn || loading}
          onPress={() => {
            tapFeedback();
            onPress();
          }}
          style={({ pressed }) => ({
            minHeight: 60,
            borderRadius: 999,
            backgroundColor: checkedIn ? t.tint : t.primary,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            paddingHorizontal: 24,
            transform: [{ scale: pressed ? 0.97 : 1 }],
            ...(checkedIn ? null : shadow(t, 1.2)),
          })}
        >
          {loading ? (
            <ActivityIndicator color={t.onPrimary} />
          ) : checkedIn ? (
            <>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={16} color={t.onPrimary} />
              </View>
              <Text style={[TYPE.button, { color: t.primaryText, fontSize: 17 }]}>{doneLabel}</Text>
            </>
          ) : (
            <>
              <Icon name="map-pin" size={20} color={t.onPrimary} />
              <Text style={[TYPE.button, { color: t.onPrimary, fontSize: 17 }]}>{label}</Text>
              <Icon name="arrow-right" size={20} color={t.onPrimary} />
            </>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}
