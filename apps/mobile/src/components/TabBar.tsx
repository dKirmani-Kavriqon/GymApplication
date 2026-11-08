import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { TYPE } from '../theme/type';
import { tapFeedback } from '../utils/feedback';
import type { TabKey } from '../navigation/Nav';
import { Icon, type IconName } from './Icon';
import { shadow } from './ui';

export interface TabDef {
  key: TabKey;
  label: string;
  icon: IconName;
}

/** Floating bottom bar from the reference design: icon + label always, active tab in the brand colour. */
export function TabBar({ active, onChange, tabs }: { active: TabKey; onChange: (k: TabKey) => void; tabs: TabDef[] }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingHorizontal: 14, paddingBottom: Math.max(insets.bottom, 10), paddingTop: 6, backgroundColor: 'transparent' }}>
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: 'row',
          backgroundColor: t.surface,
          borderRadius: t.radius.xl,
          paddingVertical: 8,
          paddingHorizontal: 6,
          borderWidth: 1,
          borderColor: t.border,
          ...shadow(t, 1.2),
        }}
      >
        {tabs.map((tab) => {
          const selected = tab.key === active;
          return (
            <Pressable
              key={tab.key}
              testID={`tab-${tab.key}`}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected }}
              onPress={() => {
                tapFeedback();
                onChange(tab.key);
              }}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 52, gap: 3 }}
            >
              <View style={{ backgroundColor: selected ? t.tint : 'transparent', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 4 }}>
                <Icon name={tab.icon} size={21} color={selected ? t.primaryText : t.textMuted} />
              </View>
              <Text style={[TYPE.small, { fontSize: 11.5, lineHeight: 14, color: selected ? t.primaryText : t.textMuted }, selected ? TYPE.smallStrong : null, { fontSize: 11.5 }]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
