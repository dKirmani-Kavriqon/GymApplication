import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, IconTile, Screen, Txt } from '../../components/ui';
import type { IconName } from '../../components/Icon';
import { useTheme } from '../../theme/ThemeContext';

const SLIDES: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: 'map-pin', title: 'Check in with one tap', body: 'Build streaks and earn badges every time you show up.' },
  { icon: 'calendar', title: 'Book classes, train with your coach', body: "Reserve your spot, follow your trainer's plan and log every set." },
  { icon: 'trending-up', title: 'See yourself get stronger', body: 'Track your progress, join gym challenges and eat well with meal ideas.' },
];

/** Intro slides shown once on first launch (FitBody gap: onboarding A–D). */
export function IntroScreen({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const [i, setI] = useState(0);
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;
  return (
    <Screen
      testID={`intro-${i}`}
      scroll={false}
      footer={
        <>
          <Button label={last ? 'Get started' : 'Next'} arrow onPress={() => (last ? onDone() : setI(i + 1))} testID="intro-next" />
          {!last ? <Button label="Skip" variant="ghost" onPress={onDone} /> : null}
        </>
      }
    >
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, paddingTop: 40 }}>
        <View style={{ width: 220, height: 220, borderRadius: 110, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', top: 18, right: 10, width: 54, height: 54, borderRadius: 27, backgroundColor: t.tint2 }} />
          <IconTile icon={s.icon} size={110} tone="primary" />
        </View>
        <Txt variant="h1" color="heading" align="center" accessibilityRole="header">
          {s.title}
        </Txt>
        <Txt variant="body" color="textMuted" align="center" style={{ maxWidth: 320 }}>
          {s.body}
        </Txt>
        <View accessibilityLabel={`Slide ${i + 1} of ${SLIDES.length}`} style={{ flexDirection: 'row', gap: 8 }}>
          {SLIDES.map((_, j) => (
            <View key={j} style={{ width: j === i ? 26 : 8, height: 8, borderRadius: 4, backgroundColor: j === i ? t.primary : t.tint2 }} />
          ))}
        </View>
      </View>
    </Screen>
  );
}
