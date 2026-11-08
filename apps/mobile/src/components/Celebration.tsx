import React, { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, Text, View } from 'react-native';
import { badgeById } from '@gymverse/shared';
import { useTheme } from '../theme/ThemeContext';
import { TYPE } from '../theme/type';
import { nativeDriver, successFeedback, useReduceMotion } from '../utils/feedback';
import { Button, Txt } from './ui';

/** "Badge earned" moment: the badge flips in and shines (PRD §8 animation table). */
export function BadgeCelebration({ badgeId, onClose }: { badgeId: string | null; onClose: () => void }) {
  const t = useTheme();
  const reduce = useReduceMotion();
  const flip = useRef(new Animated.Value(0)).current;
  const badge = badgeId ? badgeById(badgeId) : undefined;

  useEffect(() => {
    if (!badgeId) return;
    successFeedback();
    flip.setValue(reduce ? 1 : 0);
    if (!reduce) Animated.spring(flip, { toValue: 1, friction: 5, tension: 60, useNativeDriver: nativeDriver }).start();
  }, [badgeId, reduce, flip]);

  if (!badge) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: t.overlay, justifyContent: 'center', padding: 28 }}>
        <Pressable onPress={() => undefined}>
          <View testID="badge-celebration" style={{ backgroundColor: t.surface, borderRadius: t.radius.xl, padding: 28, alignItems: 'center', gap: 12 }}>
            <Txt variant="caption" color="textMuted">
              New badge
            </Txt>
            <Animated.View
              style={{
                width: 128,
                height: 128,
                borderRadius: 64,
                backgroundColor: t.tint,
                borderWidth: 6,
                borderColor: t.primary,
                alignItems: 'center',
                justifyContent: 'center',
                transform: [
                  { perspective: 600 },
                  { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '0deg'] }) },
                  { scale: flip.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
                ],
              }}
            >
              <Text style={{ fontSize: 58 }}>{badge.emoji}</Text>
            </Animated.View>
            <Text style={[TYPE.h1, { color: t.heading }]}>{badge.title}</Text>
            <Txt variant="body" color="textMuted" align="center">
              {badge.description}
            </Txt>
            <Button label="Awesome!" onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
