import React, { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';
import { Txt } from './ui';

/** Vertical bars, one per label, scaled to the largest value. The last bar is emphasised. */
export function BarChart({
  data,
  height = 140,
  testID,
  label,
  format = (v) => String(v),
}: {
  data: Array<{ label: string; value: number }>;
  height?: number;
  testID?: string;
  label: string;
  format?: (v: number) => string;
}) {
  const t = useTheme();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View testID={testID} accessibilityLabel={`${label}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(', ')}`} style={{ gap: 6 }}>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        {data.map((d, i) => {
          const last = i === data.length - 1;
          const h = Math.max(4, (d.value / max) * (height - 20));
          return (
            <View key={`${d.label}-${i}`} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
              <Txt variant="small" color={last ? 'primaryText' : 'textMuted'} style={{ fontSize: 11 }}>
                {d.value ? format(d.value) : ''}
              </Txt>
              <View style={{ width: '100%', height: h, borderRadius: 10, backgroundColor: last ? t.primary : t.tint2 }} />
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {data.map((d, i) => (
          <Txt key={`${d.label}-l-${i}`} variant="small" color="textMuted" align="center" style={{ flex: 1, fontSize: 11 }}>
            {d.label}
          </Txt>
        ))}
      </View>
    </View>
  );
}

/** Smooth line with area fill and an emphasised last point (e.g. body weight over time). */
export function LineChart({
  points,
  height = 150,
  testID,
  label,
  unit = '',
}: {
  points: Array<{ label: string; value: number }>;
  height?: number;
  testID?: string;
  label: string;
  unit?: string;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(300);
  if (points.length === 0) return null;
  const pad = 10;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => (points.length === 1 ? width / 2 : pad + (i * (width - pad * 2)) / (points.length - 1));
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;
  const last = points[points.length - 1];
  return (
    <View
      testID={testID}
      accessibilityLabel={`${label}: from ${points[0].value}${unit} to ${last.value}${unit}`}
      onLayout={(e) => setWidth(Math.max(120, e.nativeEvent.layout.width))}
      style={{ gap: 6 }}
    >
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.primary} stopOpacity={0.22} />
            <Stop offset="1" stopColor={t.primary} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <Line key={f} x1={0} x2={width} y1={height * f} y2={height * f} stroke={t.border} strokeWidth={1} />
        ))}
        <Path d={area} fill="url(#area)" />
        <Path d={line} stroke={t.primary} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={x(points.length - 1)} cy={y(last.value)} r={6} fill={t.primary} stroke={t.surface} strokeWidth={3} />
        <Rect x={0} y={0} width={0} height={0} fill="none" />
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt variant="small" color="textMuted" style={{ fontSize: 11 }}>
          {points[0].label}
        </Txt>
        <Txt variant="small" color="textMuted" style={{ fontSize: 11 }}>
          {last.label}
        </Txt>
      </View>
    </View>
  );
}
