import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { THEME_PRESETS, type MemberThemeMode } from '@gymverse/shared';
import { useSession } from '../state/session';
import { useGym, useSaveProfile } from '../state/hooks';
import { useTheme } from '../theme/ThemeContext';
import { TYPE } from '../theme/type';
import { tapFeedback } from '../utils/feedback';
import { ErrorText, Segmented, Txt } from './ui';

/**
 * "My colour theme" (PRD §5 + revamp): members can keep their gym's colours or
 * pick their own preset, and choose Light / Dark / Auto. Only affects their phone.
 */
export function ThemePicker() {
  const { me } = useSession();
  const gym = useGym();
  const t = useTheme();
  const save = useSaveProfile();
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const current = me.profile.themeColor;
  const mode = me.profile.themeMode;

  async function apply(patch: { themeColor?: string | null; themeMode?: MemberThemeMode }) {
    setError(null);
    try {
      await save(patch);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const options = [
    { id: 'gym', name: 'Gym colours', primary: gym.branding.primaryColor, accent: gym.branding.accentColor },
    ...THEME_PRESETS.map((p) => ({ id: p.id, name: p.name.replace(' & Beige', ''), primary: p.primary, accent: p.accent })),
  ];

  return (
    <View style={{ gap: 12 }}>
      <Txt variant="caption" color="textMuted">
        My colour theme
      </Txt>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {options.map((o) => {
          const selected = o.id === 'gym' ? !current : current?.toUpperCase() === o.primary.toUpperCase();
          return (
            <Pressable
              key={o.id}
              accessibilityRole="radio"
              accessibilityLabel={o.id === 'gym' ? `Gym colours (${gym.name})` : `${o.name} theme`}
              accessibilityState={{ selected }}
              onPress={() => {
                tapFeedback();
                void apply({ themeColor: o.id === 'gym' ? null : o.primary });
              }}
              style={{ width: 64, alignItems: 'center', gap: 4 }}
            >
              <View
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 23,
                  borderWidth: selected ? 3 : 2,
                  borderColor: selected ? t.text : t.border,
                  padding: 3,
                }}
              >
                <View style={{ flex: 1, borderRadius: 20, overflow: 'hidden', flexDirection: 'row' }}>
                  <View style={{ flex: 1, backgroundColor: o.primary }} />
                  <View style={{ flex: 1, backgroundColor: o.accent }} />
                </View>
              </View>
              <Text numberOfLines={1} style={[TYPE.small, { fontSize: 11, color: selected ? t.text : t.textMuted }, selected ? TYPE.smallStrong : null, { fontSize: 11 }]}>
                {o.id === 'gym' ? 'Gym' : o.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Txt variant="caption" color="textMuted">
        Appearance
      </Txt>
      <Segmented<MemberThemeMode>
        testID="appearance"
        value={mode}
        onChange={(m) => void apply({ themeMode: m })}
        options={[
          { id: 'gym', label: 'Gym' },
          { id: 'light', label: 'Light' },
          { id: 'dark', label: 'Dark' },
          { id: 'auto', label: 'Auto' },
        ]}
      />
      <ErrorText message={error} />
    </View>
  );
}
