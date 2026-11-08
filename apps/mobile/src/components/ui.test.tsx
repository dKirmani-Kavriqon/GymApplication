import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PALETTE, THEME_PRESETS, buildTheme, contrastRatio, type Branding } from '@gymverse/shared';
import { ThemeProvider } from '../theme/ThemeContext';
import { Banner, Button, Stepper } from './ui';
import { TabBar } from './TabBar';

const flatten = (style: any): Record<string, any> => (Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {});
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const branding = (themePreference: Branding['themePreference'], primaryColor: string = PALETTE.burgundy, accentColor: string = PALETTE.rose): Branding => ({
  gymName: 'Flex',
  primaryColor,
  accentColor,
  themePreference,
});

describe('Banner contrast (regression)', () => {
  for (const mode of ['light', 'dark'] as const) {
    for (const tone of ['danger', 'accent'] as const) {
      it(`${tone} banner text is AA-readable in ${mode} mode`, () => {
        render(
          <ThemeProvider branding={branding(mode)}>
            <Banner testID="b" icon="alert-circle" text="No active membership" tone={tone} />
          </ThemeProvider>,
        );
        const bg = flatten(screen.getByTestId('b').props.style).backgroundColor;
        const fg = flatten(screen.getByText('No active membership').props.style).color;
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('Button', () => {
  it('primary uses the brand colour and stays readable for every preset', () => {
    for (const p of THEME_PRESETS) {
      const { unmount } = render(
        <ThemeProvider branding={branding('light', p.primary, p.accent)}>
          <Button label="Book" onPress={() => undefined} testID="btn" />
        </ThemeProvider>,
      );
      const bg = flatten(screen.getByTestId('btn').props.style).backgroundColor;
      const fg = flatten(screen.getByText('Book').props.style).color;
      expect(bg).toBe(p.primary);
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      unmount();
    }
  });

  it('is labelled, pressable and blocks presses while loading', () => {
    const onPress = jest.fn();
    const { rerender } = render(<Button label="Pay ₹1,499" onPress={onPress} />);
    fireEvent.press(screen.getByLabelText('Pay ₹1,499'));
    expect(onPress).toHaveBeenCalledTimes(1);
    rerender(<Button label="Pay ₹1,499" onPress={onPress} loading />);
    fireEvent.press(screen.getByLabelText('Pay ₹1,499'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('Stepper', () => {
  it('steps and clamps to its range', () => {
    const onChange = jest.fn();
    const { rerender } = render(<Stepper label="Weight" unit="kg" step={0.5} value={80} min={25} max={80} onChange={onChange} />);
    fireEvent.press(screen.getByLabelText('Increase Weight'));
    expect(onChange).toHaveBeenLastCalledWith(80);
    fireEvent.press(screen.getByLabelText('Decrease Weight'));
    expect(onChange).toHaveBeenLastCalledWith(79.5);
    rerender(<Stepper label="Weight" unit="kg" step={0.5} value={25} min={25} max={80} onChange={onChange} />);
    fireEvent.press(screen.getByLabelText('Decrease Weight'));
    expect(onChange).toHaveBeenLastCalledWith(25);
  });
});

describe('TabBar', () => {
  it('labels every tab and marks the selected one with a readable brand colour', () => {
    const onChange = jest.fn();
    render(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider branding={branding('light')}>
          <TabBar
            active="classes"
            onChange={onChange}
            tabs={[
              { key: 'home', label: 'Home', icon: 'home' },
              { key: 'classes', label: 'Classes', icon: 'calendar' },
              { key: 'train', label: 'Train', icon: 'activity' },
              { key: 'community', label: 'Community', icon: 'users' },
              { key: 'me', label: 'Me', icon: 'user' },
            ]}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.getByLabelText('Classes').props.accessibilityState).toEqual({ selected: true });
    const t = buildTheme(branding('light'), 'light');
    expect(contrastRatio(flatten(screen.getByText('Classes').props.style).color, t.surface)).toBeGreaterThanOrEqual(4.5);
    fireEvent.press(screen.getByLabelText('Train'));
    expect(onChange).toHaveBeenCalledWith('train');
  });
});
