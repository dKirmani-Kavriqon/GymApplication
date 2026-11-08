import { act, render, screen } from '@testing-library/react';
import { CountUp } from '../components/ui';
import { motionAllowed } from './motion';

function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('reduce'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe('count-up numbers', () => {
  it('render the final value immediately under prefers-reduced-motion', () => {
    stubMatchMedia(true);
    expect(motionAllowed()).toBe(false);
    render(<CountUp value={1234} />);
    expect(screen.getByText('1234')).toBeInTheDocument();
  });

  it('render the final value immediately when matchMedia is missing (tests, old browsers)', () => {
    render(<CountUp value={42} format={(n) => `${Math.round(n)} visits`} />);
    expect(screen.getByText('42 visits')).toBeInTheDocument();
  });

  it('count up from 0 to the target over ~600ms when motion is allowed', () => {
    stubMatchMedia(false);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    expect(motionAllowed()).toBe(true);

    render(<CountUp value={100} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    const run = (t: number) =>
      act(() => {
        const cb = frames.shift();
        cb?.(t);
      });
    run(1000); // first frame sets the start time
    run(1300); // halfway: ease-out is past the midpoint
    const mid = Number(screen.getByText(/^\d+$/).textContent);
    expect(mid).toBeGreaterThan(50);
    expect(mid).toBeLessThan(100);
    run(1600);
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(frames).toHaveLength(0);
  });
});
