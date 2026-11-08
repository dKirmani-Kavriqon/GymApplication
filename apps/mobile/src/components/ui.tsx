import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppTheme } from '@gymverse/shared';
import { useTheme } from '../theme/ThemeContext';
import { TYPE, type TypeVariant } from '../theme/type';
import { nativeDriver, tapFeedback, useReduceMotion } from '../utils/feedback';
import { Icon, type IconName } from './Icon';
import { useEntrance, usePop, usePulse } from './motion';

/** Tap targets ≥ 48pt, labels on every control, one primary action per screen (PRD §8). */
export const MIN_TOUCH = 48;

type ColorKey = 'text' | 'textMuted' | 'heading' | 'primaryText' | 'onPrimary' | 'accent' | 'onAccent' | 'success' | 'warning' | 'danger';

export function Txt({
  variant = 'body',
  color = 'text',
  align,
  style,
  numberOfLines,
  children,
  testID,
  accessibilityRole,
}: {
  variant?: TypeVariant;
  color?: ColorKey | string;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  children: React.ReactNode;
  testID?: string;
  accessibilityRole?: 'header' | 'text' | 'alert';
}) {
  const t = useTheme();
  const c = (t as unknown as Record<string, string>)[color] ?? color;
  return (
    <Text
      testID={testID}
      numberOfLines={numberOfLines}
      accessibilityRole={accessibilityRole}
      style={[TYPE[variant], { color: c, textAlign: align }, style]}
    >
      {children}
    </Text>
  );
}

export function shadow(t: AppTheme, depth = 1): ViewStyle {
  return {
    shadowColor: t.mode === 'dark' ? '#000' : t.primary,
    shadowOpacity: t.mode === 'dark' ? 0.3 : 0.08 * depth,
    shadowRadius: 14 * depth,
    shadowOffset: { width: 0, height: 6 * depth },
    elevation: 2 * depth,
  };
}

// ---------- layout ----------

export function Screen({
  children,
  title,
  onBack,
  right,
  scroll = true,
  testID,
  footer,
  refreshing,
  onRefresh,
  padded = true,
  decor,
}: {
  children: React.ReactNode;
  title?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  scroll?: boolean;
  testID?: string;
  footer?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  /** Decorative layer drawn behind the content (e.g. the brand blob). */
  decor?: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const header =
    title || onBack || right ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
        {onBack ? <IconButton icon="arrow-left" label="Back" onPress={onBack} /> : null}
        {title ? (
          <Txt variant={onBack ? 'h2' : 'h1'} color="heading" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={1}>
            {title}
          </Txt>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {right}
      </View>
    ) : null;
  const body = (
    <View style={{ paddingHorizontal: padded ? 20 : 0, gap: 16, paddingTop: insets.top + 12, paddingBottom: 28, flex: scroll ? undefined : 1 }}>
      {header}
      {children}
    </View>
  );
  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: t.background }}>
      {decor}
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.primaryText} /> : undefined}
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{body}</View>
      )}
      {footer ? <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: insets.bottom + 16, gap: 8 }}>{footer}</View> : null}
    </View>
  );
}

/** The curved brand shape from the reference design, top-right of hero screens. */
export function BrandBlob() {
  const t = useTheme();
  const reduce = useReduceMotion();
  const enter = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.timing(enter, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }).start();
  }, [reduce, enter]);
  const slide = (from: number) => enter.interpolate({ inputRange: [0, 1], outputRange: [from, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', top: -70, right: -80, width: 230, height: 220, opacity: enter, transform: [{ translateX: slide(40) }, { translateY: slide(-30) }] }}
    >
      <View style={{ position: 'absolute', left: -30, bottom: -36, width: 130, height: 130, borderRadius: 65, backgroundColor: t.tint2 }} />
      <View style={{ position: 'absolute', inset: 0, borderBottomLeftRadius: 150, backgroundColor: t.primary }} />
    </Animated.View>
  );
}

export function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
      <Txt variant="h3" color="heading" accessibilityRole="header">
        {title}
      </Txt>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={onAction} hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 }}>
          <Txt variant="smallStrong" color="primaryText">
            {actionLabel}
          </Txt>
          <Icon name="arrow-right" size={14} color={undefined} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------- buttons ----------

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  arrow,
  loading,
  disabled,
  testID,
  full = true,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'soft' | 'ghost' | 'danger';
  size?: 'lg' | 'md' | 'sm';
  icon?: IconName;
  /** Adds the → used on the reference's buttons. */
  arrow?: boolean;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  full?: boolean;
}) {
  const t = useTheme();
  const palette = {
    primary: { bg: t.primary, fg: t.onPrimary, border: t.primary },
    outline: { bg: 'transparent', fg: t.primaryText, border: t.primaryText },
    soft: { bg: t.tint, fg: t.primaryText, border: t.tint },
    ghost: { bg: 'transparent', fg: t.primaryText, border: 'transparent' },
    danger: { bg: 'transparent', fg: t.danger, border: t.danger },
  }[variant];
  const height = size === 'lg' ? 56 : size === 'md' ? 48 : 44;
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      hitSlop={size === 'sm' ? 4 : undefined}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: height,
        paddingHorizontal: size === 'sm' ? 16 : 22,
        borderRadius: t.radius.pill,
        borderWidth: variant === 'outline' || variant === 'danger' ? 1.5 : 0,
        borderColor: palette.border,
        backgroundColor: palette.bg,
        opacity: inactive ? 0.5 : 1,
        alignSelf: full ? 'stretch' : 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        transform: [{ scale: pressed ? 0.97 : 1 }],
        ...(variant === 'primary' ? shadow(t, 0.8) : null),
      })}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} color={palette.fg} /> : null}
          <Text style={[TYPE.button, { color: palette.fg, fontSize: size === 'sm' ? 14 : 16 }]}>{label}</Text>
          {arrow ? <Icon name="arrow-right" size={size === 'sm' ? 16 : 18} color={palette.fg} /> : null}
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  variant = 'surface',
  size = 44,
  badge,
  testID,
  selected,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  variant?: 'surface' | 'tint' | 'primary';
  size?: number;
  badge?: number;
  testID?: string;
  /** For toggles such as a favourite heart. */
  selected?: boolean;
}) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.primary : variant === 'tint' ? t.tint : t.surface;
  const fg = variant === 'primary' ? t.onPrimary : t.primaryText;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} new` : label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      hitSlop={6}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        width: Math.max(size, 44),
        height: Math.max(size, 44),
        borderRadius: 999,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ scale: pressed ? 0.94 : 1 }],
        ...(variant === 'surface' ? shadow(t, 0.6) : null),
      })}
    >
      <Icon name={icon} size={20} color={fg} />
      {badge ? (
        <View style={{ position: 'absolute', top: 6, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
          <Text style={[TYPE.caption, { color: t.onAccent, fontSize: 9, letterSpacing: 0 }]}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ---------- surfaces ----------

export function Card({
  children,
  style,
  onPress,
  testID,
  variant = 'surface',
  accessibilityLabel,
  index = 0,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  testID?: string;
  variant?: 'surface' | 'tint';
  accessibilityLabel?: string;
  /** Position among siblings, for a staggered entrance. */
  index?: number;
}) {
  const t = useTheme();
  const entrance = useEntrance(index) as unknown as ViewStyle;
  const base: ViewStyle = {
    backgroundColor: variant === 'tint' ? t.tint : t.surface,
    borderRadius: t.radius.lg,
    padding: 16,
    gap: 8,
    borderWidth: variant === 'tint' ? 0 : 1,
    borderColor: t.border,
    ...(variant === 'surface' ? shadow(t) : null),
  };
  if (!onPress) {
    return (
      <Animated.View testID={testID} accessibilityLabel={accessibilityLabel} style={[base, style, entrance]}>
        {children}
      </Animated.View>
    );
  }
  return (
    <Animated.View style={entrance}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={() => {
          tapFeedback();
          onPress();
        }}
        style={({ pressed }) => [base, { transform: [{ scale: pressed ? 0.985 : 1 }] }, style]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export function IconTile({ icon, size = 48, tone = 'tint' }: { icon: IconName; size?: number; tone?: 'tint' | 'primary' }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        backgroundColor: tone === 'primary' ? t.primary : t.tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={size * 0.44} color={tone === 'primary' ? t.onPrimary : t.primaryText} />
    </View>
  );
}

export function QuickAction({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 6, transform: [{ scale: pressed ? 0.95 : 1 }] })}
    >
      <IconTile icon={icon} size={56} />
      <Txt variant="small" align="center" numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function ListRow({
  icon,
  title,
  subtitle,
  onPress,
  right,
  testID,
  danger,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  testID?: string;
  danger?: boolean;
}) {
  const t = useTheme();
  const content = (
    <>
      {icon ? <IconTile icon={icon} size={42} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="bodyStrong" color={danger ? 'danger' : 'text'} numberOfLines={1}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="small" color="textMuted" numberOfLines={2}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron-right" size={20} color={t.textMuted} /> : null)}
    </>
  );
  const style: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 6 };
  if (!onPress) return <View testID={testID} style={style}>{content}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => [style, { opacity: pressed ? 0.7 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.border }} />;
}

// ---------- data display ----------

export function Stat({ value, label, icon, testID }: { value: string | number; label: string; icon?: IconName; testID?: string }) {
  const t = useTheme();
  const pop = usePop(value);
  return (
    <View testID={testID} accessibilityLabel={`${value} ${label}`} style={{ flex: 1, gap: 2 }}>
      <Animated.View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, transform: [{ scale: pop }] }}>
        {icon ? <Icon name={icon} size={18} color={t.primaryText} /> : null}
        <Txt variant="number" color="heading" style={{ fontSize: 26, lineHeight: 30 }}>
          {value}
        </Txt>
      </Animated.View>
      <Txt variant="small" color="textMuted">
        {label}
      </Txt>
    </View>
  );
}

export function ProgressBar({ value, height = 8, testID, label }: { value: number; height?: number; testID?: string; label?: string }) {
  const t = useTheme();
  const reduce = useReduceMotion();
  const pct = Math.max(0, Math.min(1, value));
  const fill = useRef(new Animated.Value(reduce ? pct : 0)).current;
  useEffect(() => {
    if (reduce) return;
    // Width can't use the native driver; this is a single short tween.
    Animated.timing(fill, { toValue: pct, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [pct, reduce, fill]);
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{ height, borderRadius: height, backgroundColor: t.mode === 'dark' ? t.surfaceAlt : 'rgba(255,255,255,0.65)', overflow: 'hidden' }}
    >
      {reduce ? (
        <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: height, backgroundColor: t.primary }} />
      ) : (
        <Animated.View
          style={{ width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }), height: '100%', borderRadius: height, backgroundColor: t.primary }}
        />
      )}
    </View>
  );
}

export function Pill({ label, tone = 'tint', testID }: { label: string; tone?: 'primary' | 'tint' | 'success' | 'warning' | 'muted'; testID?: string }) {
  const t = useTheme();
  const map = {
    primary: { bg: t.primary, fg: t.onPrimary },
    tint: { bg: t.tint, fg: t.primaryText },
    success: { bg: t.tint, fg: t.success },
    warning: { bg: t.tint, fg: t.warning },
    muted: { bg: t.surfaceAlt, fg: t.textMuted },
  }[tone];
  return (
    <View testID={testID} style={{ backgroundColor: map.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Text style={[TYPE.smallStrong, { color: map.fg, fontSize: 12 }]}>{label}</Text>
    </View>
  );
}

export function Avatar({ name, size = 44, color }: { name: string | null | undefined; size?: number; color?: string }) {
  const t = useTheme();
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const initials = parts.length ? (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() : '?';
  const bg = color ?? t.accent;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={[TYPE.bodyStrong, { color: bg === t.accent ? t.onAccent : '#FFFFFF', fontSize: size * 0.36 }]}>{initials}</Text>
    </View>
  );
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function DateBadge({ iso }: { iso: string }) {
  const t = useTheme();
  const d = new Date(iso);
  return (
    <View style={{ width: 54, height: 58, borderRadius: 16, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={[TYPE.caption, { color: t.onPrimary, letterSpacing: 0.5 }]}>{WEEKDAYS[d.getDay()]}</Text>
      <Text style={[TYPE.h2, { color: t.onPrimary }]}>{d.getDate()}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, body, actionLabel, onAction }: { icon: IconName; title: string; body?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 10 }}>
      <IconTile icon={icon} size={64} />
      <Txt variant="h3" color="heading" align="center">
        {title}
      </Txt>
      {body ? (
        <Txt variant="body" color="textMuted" align="center">
          {body}
        </Txt>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} size="md" full={false} arrow /> : null}
    </Card>
  );
}

export function Banner({
  icon,
  text,
  actionLabel,
  onAction,
  tone = 'accent',
  testID,
}: {
  icon: IconName;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'accent' | 'danger';
  testID?: string;
}) {
  const t = useTheme();
  const bg = tone === 'danger' ? t.danger : t.accent;
  const fg = tone === 'danger' ? (t.mode === 'dark' ? '#1F1F1F' : '#FFFFFF') : t.onAccent;
  return (
    <View testID={testID} style={{ backgroundColor: bg, borderRadius: t.radius.lg, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Icon name={icon} size={20} color={fg} />
      <Text style={[TYPE.bodyStrong, { color: fg, flex: 1 }]}>{text}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={{ backgroundColor: fg, borderRadius: 999, paddingHorizontal: 16, minHeight: 40, justifyContent: 'center' }}
        >
          <Text style={[TYPE.smallStrong, { color: bg }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------- inputs ----------

export function Field({ label, error, multiline, ...input }: TextInputProps & { label: string; error?: string | null }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="smallStrong">{label}</Txt>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.textMuted}
        multiline={multiline}
        {...input}
        style={[
          TYPE.body,
          {
            minHeight: multiline ? 110 : 54,
            borderRadius: multiline ? t.radius.md : t.radius.pill,
            borderWidth: 1.5,
            borderColor: error ? t.danger : t.border,
            backgroundColor: t.surface,
            color: t.text,
            paddingHorizontal: 18,
            paddingVertical: multiline ? 14 : 0,
            fontSize: 17,
            textAlignVertical: multiline ? 'top' : 'center',
          },
        ]}
      />
      {error ? (
        <Txt variant="small" color="danger" accessibilityRole="alert">
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

export function SearchPill({ placeholder, onPress, testID }: { placeholder: string; onPress: () => void; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="search"
      accessibilityLabel={placeholder}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 50, borderRadius: 999, backgroundColor: t.surfaceAlt, paddingHorizontal: 18 }}
    >
      <Icon name="search" size={18} color={t.textMuted} />
      <Txt variant="body" color="textMuted">
        {placeholder}
      </Txt>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, icon, testID }: { label: string; selected: boolean; onPress: () => void; icon?: IconName; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 48,
        paddingHorizontal: 16,
        borderRadius: 999,
        backgroundColor: selected ? t.primary : t.surface,
        borderWidth: 1,
        borderColor: selected ? t.primary : t.border,
      }}
    >
      {icon ? <Icon name={icon} size={15} color={selected ? t.onPrimary : t.primaryText} /> : null}
      <Text style={[TYPE.smallStrong, { color: selected ? t.onPrimary : t.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <View testID={testID} accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: t.surfaceAlt, borderRadius: 999, padding: 4 }}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            onPress={() => {
              tapFeedback();
              onChange(o.id);
            }}
            style={{ flex: 1, minHeight: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.surface : 'transparent', ...(on ? shadow(t, 0.4) : null) }}
          >
            <Text style={[TYPE.smallStrong, { color: on ? t.primaryText : t.textMuted }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ToggleRow({ label, description, value, onChange, testID }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 }}>
      <View style={{ flex: 1 }}>
        <Txt variant="bodyStrong">{label}</Txt>
        {description ? (
          <Txt variant="small" color="textMuted">
            {description}
          </Txt>
        ) : null}
      </View>
      <Switch
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: t.primary, false: t.border }}
        thumbColor={t.surface}
        {...({ activeThumbColor: t.surface } as object)}
      />
    </View>
  );
}

export function ChoiceCard({ label, icon, selected, onPress, description }: { label: string; icon?: IconName; selected: boolean; onPress: () => void; description?: string }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={{
        flexBasis: '46%',
        flexGrow: 1,
        minHeight: 64,
        borderRadius: t.radius.lg,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: selected ? t.primary : t.surface,
        borderWidth: 1.5,
        borderColor: selected ? t.primary : t.border,
      }}
    >
      {icon ? <Icon name={icon} size={22} color={selected ? t.onPrimary : t.primaryText} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[TYPE.bodyStrong, { color: selected ? t.onPrimary : t.text }]}>{label}</Text>
        {description ? <Text style={[TYPE.small, { color: selected ? t.onPrimary : t.textMuted }]}>{description}</Text> : null}
      </View>
      {selected ? <Icon name="check-circle" size={20} color={t.onPrimary} /> : null}
    </Pressable>
  );
}

export function Stepper({
  label,
  value,
  unit,
  step = 1,
  min,
  max,
  onChange,
  big,
  a11yLabel,
}: {
  label: string;
  /** Distinguishes several steppers with the same label, e.g. 'Reps, set 2'. */
  a11yLabel?: string;
  value: number;
  unit?: string;
  step?: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  big?: boolean;
}) {
  const t = useTheme();
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 10) / 10));
  const btn = (sign: 1 | -1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${sign > 0 ? 'Increase' : 'Decrease'} ${a11yLabel ?? label}`}
      onPress={() => {
        tapFeedback();
        onChange(clamp(value + sign * step));
      }}
      style={({ pressed }) => ({
        width: big ? 64 : 48,
        height: big ? 64 : 48,
        borderRadius: 999,
        backgroundColor: t.tint,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ scale: pressed ? 0.92 : 1 }],
      })}
    >
      <Icon name={sign > 0 ? 'plus' : 'minus'} size={big ? 26 : 20} color={t.primaryText} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {!big ? (
        <Txt variant="bodyStrong" style={{ flex: 1 }}>
          {label}
        </Txt>
      ) : null}
      {btn(-1)}
      <View style={{ minWidth: big ? 140 : 90, alignItems: 'center', flex: big ? 1 : undefined }} accessibilityLabel={`${label} ${value}${unit ? ` ${unit}` : ''}`}>
        <Text style={[big ? TYPE.display : TYPE.h2, { color: t.heading }]}>
          {value}
          {unit ? <Text style={[TYPE.h3, { color: t.textMuted }]}> {unit}</Text> : null}
        </Text>
      </View>
      {btn(1)}
    </View>
  );
}

// ---------- feedback ----------

/** Skeleton placeholder (pulsing cards) instead of a spinner, so screens don't jump when data lands. */
export function Loading({ label = 'Loading', rows = 3 }: { label?: string; rows?: number }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pulse = usePulse();
  const block = (h: number, w: ViewStyle['width'] = '100%', r = t.radius.lg) => <View style={{ height: h, width: w, borderRadius: r, backgroundColor: t.surfaceAlt }} />;
  return (
    <View accessibilityLabel={label} accessibilityRole="progressbar" style={{ flex: 1, backgroundColor: t.background, padding: 20, paddingTop: insets.top + 20 }}>
      <Animated.View style={{ gap: 14, opacity: pulse }}>
        {block(28, '55%', 10)}
        {block(16, '35%', 8)}
        {Array.from({ length: rows }, (_, i) => (
          <View key={i}>{block(i === 0 ? 150 : 96)}</View>
        ))}
      </Animated.View>
    </View>
  );
}

/** In-content skeleton (inside a Screen), unlike Loading which fills the page. */
export function Skeleton({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  const t = useTheme();
  const pulse = usePulse();
  return (
    <Animated.View accessibilityLabel={label} accessibilityRole="progressbar" style={{ gap: 12, opacity: pulse }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ height: i === 0 ? 120 : 84, borderRadius: t.radius.lg, backgroundColor: t.surfaceAlt }} />
      ))}
    </Animated.View>
  );
}

export function Spinner() {
  const t = useTheme();
  return <ActivityIndicator color={t.primaryText} />;
}

export function ErrorText({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <Txt variant="bodyStrong" color="danger" align="center" accessibilityRole="alert">
      {message}
    </Txt>
  );
}

export function Sheet({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode; testID?: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: t.overlay }}>
        <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={onClose} />
        <View
          testID={testID}
          style={{ backgroundColor: t.background, borderTopLeftRadius: t.radius.xl, borderTopRightRadius: t.radius.xl, padding: 20, paddingBottom: insets.bottom + 20, gap: 14, maxHeight: '90%' }}
        >
          <View style={{ alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: t.border }} />
          {title ? (
            <Txt variant="h2" color="heading" accessibilityRole="header">
              {title}
            </Txt>
          ) : null}
          <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
