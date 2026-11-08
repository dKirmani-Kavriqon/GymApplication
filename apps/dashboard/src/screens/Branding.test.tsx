import { screen, within } from '@testing-library/react';
import { PALETTE, THEME_PRESETS, buildTheme, checkBrandContrast, type Gym } from '@gymverse/shared';
import { BrandingStudio } from './Branding';
import { installFakeApi, apiError } from '../test/fakeApi';
import { makeGym } from '../test/fixtures';
import { renderUi } from '../test/render';

function setup(opts: { canEdit?: boolean; gym?: Gym } = {}) {
  const gym = opts.gym ?? makeGym();
  const onSaved = vi.fn();
  const fake = installFakeApi({
    'PATCH /gyms/:gymId/branding': (req) => ({
      gym: { ...gym, branding: { ...gym.branding, ...(req.body as object) } },
      contrastIssues: [],
    }),
  });
  const utils = renderUi(<BrandingStudio gym={gym} canEdit={opts.canEdit ?? true} onSaved={onSaved} />);
  return { ...utils, fake, onSaved, gym };
}

async function setHex(user: ReturnType<typeof setup>['user'], label: string, value: string) {
  const input = screen.getByLabelText(label);
  await user.clear(input);
  await user.type(input, value);
}

describe('BrandingStudio', () => {
  it('renders the live preview with the gym colours and name', () => {
    setup();
    const preview = screen.getByTestId('phone-preview');
    expect(within(preview).getByTestId('preview-gym-name')).toHaveTextContent('Flex Fitness');
    expect(within(preview).getByTestId('preview-checkin')).toHaveStyle({ backgroundColor: '#E11D48' });
    const tabs = within(preview).getByRole('navigation', { name: 'Preview tabs' });
    for (const tab of ['Home', 'Classes', 'Workouts', 'Progress', 'Me']) expect(within(tabs).getByText(tab)).toBeInTheDocument();
    expect(within(preview).getByTestId('preview-welcome')).toHaveTextContent('Welcome to Flex!');
    expect(screen.getByTestId('contrast-ok')).toBeInTheDocument();
  });

  it('updates the preview as the owner types', async () => {
    const { user } = setup();
    await setHex(user, 'Primary colour', '#0EA5E9');
    expect(screen.getByTestId('preview-checkin')).toHaveStyle({ backgroundColor: '#0EA5E9' });
    // The colour picker follows the hex field.
    expect(screen.getByLabelText('Primary colour picker')).toHaveValue('#0ea5e9');

    const name = screen.getByLabelText('Gym name');
    await user.clear(name);
    await user.type(name, 'Iron Den');
    expect(screen.getByTestId('preview-gym-name')).toHaveTextContent('Iron Den');

    await user.type(screen.getByLabelText('Tagline'), '!');
    expect(screen.getByTestId('phone-preview')).toHaveTextContent('Stronger every day!');
  });

  it('keeps the last valid colour while a hex is half-typed and flags it', async () => {
    const { user } = setup();
    await setHex(user, 'Primary colour', '#12');
    expect(screen.getByText('Use a colour like #6B0F1A')).toBeInTheDocument();
    expect(screen.getByTestId('preview-checkin')).toHaveStyle({ backgroundColor: '#E11D48' });
  });

  it('warns about #FFE600 and "Use suggested colour" fixes it', async () => {
    const { user } = setup();
    await setHex(user, 'Primary colour', '#FFE600');
    expect(screen.getByTestId('preview-checkin')).toHaveStyle({ backgroundColor: '#FFE600' });

    const warning = screen.getByTestId('contrast-warning');
    expect(warning).toHaveTextContent('Primary colour #FFE600 is hard to read');
    expect(warning).toHaveTextContent('light theme');
    const [issue] = checkBrandContrast('#FFE600', '#D97706');
    expect(warning).toHaveTextContent(issue.suggestion);

    await user.click(within(warning).getByRole('button', { name: 'Use suggested colour' }));
    expect(screen.queryByTestId('contrast-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('contrast-ok')).toBeInTheDocument();
    expect(screen.getByLabelText('Primary colour')).toHaveValue(issue.suggestion);
    expect(screen.getByTestId('preview-checkin')).toHaveStyle({ backgroundColor: issue.suggestion });
  });

  it('warns about a near-black accent on the dark theme', async () => {
    const { user } = setup();
    await setHex(user, 'Accent colour', '#111111');
    expect(screen.getByTestId('contrast-warning')).toHaveTextContent('Accent colour #111111 is hard to read on the dark theme');
  });

  it('flags the default amber accent (#F59E0B) on the light theme', () => {
    setup({ gym: makeGym({ branding: { ...makeGym().branding, accentColor: '#F59E0B' } }) });
    const warnings = screen.getAllByTestId('contrast-warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toHaveTextContent('Accent colour #F59E0B is hard to read on the light theme');
  });

  it('toggles the preview between light and dark', async () => {
    const { user } = setup();
    const preview = screen.getByTestId('phone-preview');
    expect(preview).toHaveAttribute('data-mode', 'light');
    await user.click(screen.getByRole('button', { name: 'Dark' }));
    expect(preview).toHaveAttribute('data-mode', 'dark');
    // Choosing a fixed theme locks the preview to it.
    await user.click(screen.getByLabelText('Light'));
    expect(preview).toHaveAttribute('data-mode', 'light');
    expect(screen.getByRole('button', { name: 'Dark' })).toBeDisabled();
  });

  it('feature toggles change the preview', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('checkbox', { name: /^Classes/ }));
    const preview = screen.getByTestId('phone-preview');
    expect(within(preview).queryByTestId('preview-next-class')).not.toBeInTheDocument();
    expect(within(preview).queryByText('Classes')).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /^Check-in/ }));
    expect(within(preview).queryByTestId('preview-checkin')).not.toBeInTheDocument();
  });

  it('saves with the right PATCH body', async () => {
    const { user, fake, onSaved } = setup();
    await setHex(user, 'Primary colour', '#ffe600');
    await user.click(screen.getByRole('button', { name: 'Use suggested colour' }));
    const suggestion = checkBrandContrast('#FFE600', '#D97706')[0].suggestion;
    await user.clear(screen.getByLabelText('Tagline'));
    await user.type(screen.getByLabelText('Logo URL'), 'https://cdn.example.com/logo.png');
    await user.click(screen.getByLabelText('Dark'));
    await user.click(screen.getByRole('checkbox', { name: /^Payments/ }));
    await user.click(screen.getByRole('button', { name: 'Save branding' }));

    expect(await screen.findByText('Branding saved')).toBeInTheDocument();
    const calls = fake.callsTo('PATCH /gyms/:gymId/branding');
    expect(calls).toHaveLength(1);
    expect(calls[0].params.gymId).toBe('gym-1');
    expect(calls[0].body).toEqual({
      gymName: 'Flex Fitness',
      tagline: null,
      logoUrl: 'https://cdn.example.com/logo.png',
      welcomeMessage: 'Welcome to Flex!',
      primaryColor: suggestion,
      accentColor: '#D97706',
      themePreference: 'dark',
      enabledFeatures: ['checkin', 'classes', 'progress', 'announcements', 'badges', 'workouts', 'nutrition', 'community', 'resources', 'support'],
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('normalises lowercase / short hex before sending', async () => {
    const { user, fake } = setup();
    await setHex(user, 'Accent colour', '#0af');
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    await screen.findByText('Branding saved');
    expect((fake.callsTo('PATCH /gyms/:gymId/branding')[0].body as { accentColor: string }).accentColor).toBe('#00AAFF');
  });

  it('blocks saving an invalid colour or logo URL', async () => {
    const { user, fake } = setup();
    await user.type(screen.getByLabelText('Logo URL'), 'not a url');
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Logo URL must start with https://');
    expect(fake.calls).toHaveLength(0);
  });

  it('shows the API error message', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    installFakeApi({ 'PATCH /gyms/:gymId/branding': apiError(403, 'Only managers and owners can do that.', 'forbidden') });
    renderUi(<BrandingStudio gym={makeGym()} canEdit onSaved={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only managers and owners can do that.');
  });

  it('read-only mode hides save and suggestion buttons', async () => {
    setup({ canEdit: false, gym: makeGym({ branding: { ...makeGym().branding, primaryColor: '#FFE600' } }) });
    expect(screen.getByTestId('contrast-warning')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use suggested colour' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save branding' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Primary colour')).toBeDisabled();
  });

  it('theme presets recolour the preview in one click; the first preset is the default', async () => {
    const { user } = setup();
    const presets = screen.getByRole('group', { name: 'Theme presets' });
    const buttons = within(presets).getAllByRole('button');
    expect(buttons).toHaveLength(THEME_PRESETS.length);
    expect(buttons[0]).toHaveTextContent('Burgundy & Beige');

    const ocean = THEME_PRESETS.find((p) => p.id === 'ocean')!;
    await user.click(within(presets).getByRole('button', { name: /Ocean/ }));
    expect(within(presets).getByRole('button', { name: /Ocean/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Primary colour')).toHaveValue(ocean.primary);
    expect(screen.getByLabelText('Accent colour')).toHaveValue(ocean.accent);
    expect(screen.getByTestId('preview-checkin')).toHaveStyle({ backgroundColor: ocean.primary });
    // Surfaces are tinted from the brand colour too.
    const t = buildTheme({ gymName: 'x', primaryColor: ocean.primary, accentColor: ocean.accent, themePreference: 'light' }, 'light');
    expect(screen.getByTestId('phone-preview').firstElementChild).toHaveStyle({ backgroundColor: t.background });
  });

  it('"Reset to GymVerse default" restores Burgundy & Beige in light mode and saves it', async () => {
    const { user, fake } = setup();
    await user.click(screen.getByLabelText('Dark'));
    await user.click(screen.getByRole('button', { name: 'Reset to GymVerse default' }));
    expect(screen.getByLabelText('Primary colour')).toHaveValue(PALETTE.burgundy);
    expect(screen.getByLabelText('Accent colour')).toHaveValue(PALETTE.rose);
    expect(screen.getByLabelText('Light')).toBeChecked();
    expect(screen.getByTestId('phone-preview')).toHaveAttribute('data-mode', 'light');
    expect(screen.getByTestId('preview-checkin')).toHaveStyle({ backgroundColor: PALETTE.burgundy });
    expect(within(screen.getByRole('group', { name: 'Theme presets' })).getByRole('button', { name: /Burgundy/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Nothing left to reset.
    expect(screen.getByRole('button', { name: 'Reset to GymVerse default' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    await screen.findByText('Branding saved');
    expect(fake.callsTo('PATCH /gyms/:gymId/branding')[0].body).toMatchObject({
      primaryColor: '#6B0F1A',
      accentColor: '#B54B6A',
      themePreference: 'light',
    });
  });

  it('only checks contrast for the modes the gym uses', async () => {
    const { user } = setup({ gym: makeGym({ branding: { ...makeGym().branding, themePreference: 'light', accentColor: '#111111' } }) });
    expect(screen.queryByTestId('contrast-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('contrast-ok')).toHaveTextContent('readable in light mode');
    await user.click(screen.getByLabelText('Auto (follow phone)'));
    expect(screen.getByTestId('contrast-warning')).toHaveTextContent('Accent colour #111111 is hard to read on the dark theme');
  });

  it('new feature toggles go into the PATCH body and the preview', async () => {
    const old = makeGym({ enabledFeatures: ['checkin', 'classes', 'payments', 'progress', 'announcements', 'badges'] });
    const { user, fake } = setup({ gym: old });
    const preview = screen.getByTestId('phone-preview');
    const tabs = within(preview).getByRole('navigation', { name: 'Preview tabs' });
    expect(within(tabs).queryByText('Workouts')).not.toBeInTheDocument();
    for (const label of ['Workouts', 'Nutrition', 'Community', 'Resources', 'Help & support']) {
      expect(screen.getByRole('checkbox', { name: new RegExp(`^${label}`) })).not.toBeChecked();
    }
    await user.click(screen.getByRole('checkbox', { name: /^Workouts/ }));
    await user.click(screen.getByRole('checkbox', { name: /^Help & support/ }));
    await user.click(screen.getByRole('checkbox', { name: /^Community/ }));
    await user.click(screen.getByRole('checkbox', { name: /^Badges/ }));
    expect(within(tabs).getByText('Workouts')).toBeInTheDocument();
    expect(within(screen.getByTestId('preview-quick-actions')).getByText('Challenge')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    await screen.findByText('Branding saved');
    expect((fake.callsTo('PATCH /gyms/:gymId/branding')[0].body as { enabledFeatures: string[] }).enabledFeatures).toEqual([
      'checkin',
      'classes',
      'payments',
      'progress',
      'announcements',
      'workouts',
      'community',
      'support',
    ]);
  });
});
