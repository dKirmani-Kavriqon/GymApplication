import { useMemo, useState, type FormEvent } from 'react';
import {
  DEFAULT_BRANDING,
  FEATURES,
  FEATURE_LABELS,
  THEME_PRESETS,
  checkBrandContrast,
  isHexColor,
  modesFor,
  normalizeHex,
  type BrandingInput,
  type ContrastIssue,
  type FeatureKey,
  type Gym,
  type ThemeMode,
  type ThemePreference,
} from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { PhonePreview } from '../components/PhonePreview';
import { Icon } from '../components/Icon';
import { ErrorBanner, PageHeader, Toggle } from '../components/ui';
import { useToast } from '../components/Toast';

interface Props {
  gym: Gym;
  canEdit: boolean;
  onSaved: (gym: Gym) => void;
  /** Onboarding uses the studio as a step: different header and button copy. */
  variant?: 'page' | 'onboarding';
  onSkip?: () => void;
}

interface FormState {
  gymName: string;
  tagline: string;
  logoUrl: string;
  welcomeMessage: string;
  primaryColor: string;
  accentColor: string;
  themePreference: ThemePreference;
  enabledFeatures: FeatureKey[];
}

function fromGym(gym: Gym): FormState {
  const b = gym.branding;
  return {
    gymName: b.gymName,
    tagline: b.tagline ?? '',
    logoUrl: b.logoUrl ?? '',
    welcomeMessage: b.welcomeMessage ?? '',
    primaryColor: b.primaryColor,
    accentColor: b.accentColor,
    themePreference: b.themePreference,
    enabledFeatures: [...gym.enabledFeatures],
  };
}

function validUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** The PATCH /gyms/:id/branding body for a form state. */
export function toBrandingInput(f: FormState): BrandingInput {
  const orNull = (v: string) => (v.trim() ? v.trim() : null);
  return {
    gymName: f.gymName.trim(),
    tagline: orNull(f.tagline),
    logoUrl: orNull(f.logoUrl),
    welcomeMessage: orNull(f.welcomeMessage),
    primaryColor: normalizeHex(f.primaryColor),
    accentColor: normalizeHex(f.accentColor),
    themePreference: f.themePreference,
    enabledFeatures: FEATURES.filter((k) => f.enabledFeatures.includes(k)),
  };
}

const FIELD_LABEL: Record<ContrastIssue['field'], string> = { primary: 'Primary colour', accent: 'Accent colour' };
const same = (a: string, b: string) => isHexColor(a) && isHexColor(b) && normalizeHex(a) === normalizeHex(b);

function ColorField(props: {
  id: string;
  label: string;
  hint: string;
  value: string;
  fallback: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const { id, label, hint, value, fallback, disabled, onChange } = props;
  const valid = isHexColor(value);
  const swatch = (valid ? normalizeHex(value) : fallback).toLowerCase();
  return (
    <div className="field">
      <label htmlFor={`${id}-hex`}>{label}</label>
      <div className="color-row">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={swatch}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        <input
          id={`${id}-hex`}
          className="mono"
          value={value}
          maxLength={7}
          disabled={disabled}
          aria-invalid={!valid}
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange(v && !v.startsWith('#') ? `#${v}` : v);
          }}
        />
      </div>
      {valid ? <small className="muted">{hint}</small> : <small className="field-error">Use a colour like #6B0F1A</small>}
    </div>
  );
}

export function BrandingStudio({ gym, canEdit, onSaved, variant = 'page', onSkip }: Props) {
  const [form, setForm] = useState<FormState>(() => fromGym(gym));
  const [previewMode, setPreviewMode] = useState<ThemeMode>(gym.branding.themePreference === 'dark' ? 'dark' : 'light');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  // The preview keeps the last valid colour while the owner is mid-way through typing a hex.
  const primary = isHexColor(form.primaryColor) ? normalizeHex(form.primaryColor) : gym.branding.primaryColor;
  const accent = isHexColor(form.accentColor) ? normalizeHex(form.accentColor) : gym.branding.accentColor;
  const modes = modesFor(form.themePreference);
  const issues = useMemo(() => checkBrandContrast(primary, accent, 3, modes), [primary, accent, modes.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const effectiveMode: ThemeMode = form.themePreference === 'auto' ? previewMode : form.themePreference;
  const isDefault =
    same(form.primaryColor, DEFAULT_BRANDING.primaryColor) &&
    same(form.accentColor, DEFAULT_BRANDING.accentColor) &&
    form.themePreference === DEFAULT_BRANDING.themePreference;

  const problems: string[] = [];
  if (form.gymName.trim().length < 2) problems.push('Gym name needs at least 2 characters.');
  if (!isHexColor(form.primaryColor) || !isHexColor(form.accentColor)) problems.push('Fix the colour codes before saving.');
  if (form.logoUrl.trim() && !validUrl(form.logoUrl.trim())) problems.push('Logo URL must start with https://');

  function toggleFeature(key: FeatureKey, on: boolean) {
    set('enabledFeatures', on ? [...form.enabledFeatures.filter((k) => k !== key), key] : form.enabledFeatures.filter((k) => k !== key));
  }

  function applyColours(p: string, a: string) {
    setForm((f) => ({ ...f, primaryColor: p, accentColor: a }));
  }

  function resetToDefault() {
    setForm((f) => ({
      ...f,
      primaryColor: DEFAULT_BRANDING.primaryColor,
      accentColor: DEFAULT_BRANDING.accentColor,
      themePreference: DEFAULT_BRANDING.themePreference,
    }));
    setPreviewMode('light');
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (problems.length) {
      setError(problems[0]);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api.patch<{ gym: Gym; contrastIssues: ContrastIssue[] }>(`/gyms/${gym.id}/branding`, toBrandingInput(form));
      toast((res.contrastIssues ?? []).length ? 'Branding saved (some colours have low contrast)' : 'Branding saved');
      onSaved(res.gym);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const disabled = !canEdit || saving;
  const modeText = modes.length === 2 ? 'light and dark mode' : `${modes[0]} mode`;

  return (
    <div className="branding">
      {variant === 'page' ? (
        <PageHeader
          eyebrow="Brand studio"
          title="Branding"
          subtitle="Make the member app look and feel like your gym. Changes preview live."
        />
      ) : (
        <PageHeader title="Make it yours" subtitle="Step 2 of 3 · Pick your colours and logo. You can change these any time." />
      )}
      {!canEdit && <div className="info-banner">Only managers and owners can change branding. You're viewing the current settings.</div>}
      <div className="branding-grid">
        <form className="stack branding-form" onSubmit={save} aria-label="Branding form">
          <section className="card stack">
            <h2>Identity</h2>
            <label className="field">
              <span>Gym name</span>
              <input value={form.gymName} maxLength={60} disabled={disabled} onChange={(e) => set('gymName', e.target.value)} />
            </label>
            <label className="field">
              <span>Tagline</span>
              <input
                value={form.tagline}
                maxLength={80}
                placeholder="Stronger every day"
                disabled={disabled}
                onChange={(e) => set('tagline', e.target.value)}
              />
            </label>
            <label className="field">
              <span>Logo URL</span>
              <input
                inputMode="url"
                value={form.logoUrl}
                placeholder="https://…/logo.png"
                disabled={disabled}
                onChange={(e) => set('logoUrl', e.target.value)}
              />
            </label>
            <small className="muted hint-under">A square PNG or SVG works best. Leave empty to use the GymVerse star.</small>
            <label className="field">
              <span>Welcome message</span>
              <textarea
                rows={3}
                maxLength={500}
                value={form.welcomeMessage}
                placeholder="Lockers are free. Please re-rack your weights!"
                disabled={disabled}
                onChange={(e) => set('welcomeMessage', e.target.value)}
              />
            </label>
          </section>

          <section className="card stack">
            <div className="section-head">
              <h2>Colours</h2>
              {canEdit && (
                <button type="button" className="btn btn-small btn-secondary" onClick={resetToDefault} disabled={disabled || isDefault}>
                  Reset to GymVerse default
                </button>
              )}
            </div>
            <div className="field">
              <span className="field-label" id="presets-label">
                Theme presets
              </span>
              <div className="preset-row" role="group" aria-labelledby="presets-label">
                {THEME_PRESETS.map((p, i) => {
                  const on = same(form.primaryColor, p.primary) && same(form.accentColor, p.accent);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className="preset"
                      aria-pressed={on}
                      disabled={disabled}
                      onClick={() => applyColours(p.primary, p.accent)}
                    >
                      <i style={{ background: `conic-gradient(${p.primary} 0 50%, ${p.accent} 0)` }} aria-hidden />
                      <span>{p.name}</span>
                      {i === 0 && <small className="muted">Default</small>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="two-col">
              <ColorField
                id="primary"
                label="Primary colour"
                hint="Main buttons, tab bar and highlights"
                value={form.primaryColor}
                fallback={gym.branding.primaryColor}
                disabled={disabled}
                onChange={(v) => set('primaryColor', v)}
              />
              <ColorField
                id="accent"
                label="Accent colour"
                hint="Badges, chips and small highlights"
                value={form.accentColor}
                fallback={gym.branding.accentColor}
                disabled={disabled}
                onChange={(v) => set('accentColor', v)}
              />
            </div>
            {issues.length > 0 ? (
              <div className="stack-sm">
                {issues.map((issue) => (
                  <div key={`${issue.field}-${issue.against}`} className="contrast-warning" data-testid="contrast-warning">
                    <div>
                      <strong>
                        {FIELD_LABEL[issue.field]} {issue.field === 'primary' ? primary : accent} is hard to read
                      </strong>{' '}
                      on the {issue.against} theme (contrast {issue.ratio}:1, needs 3:1).
                      <div className="suggestion">
                        Suggested: <span className="swatch" style={{ background: issue.suggestion }} /> <code>{issue.suggestion}</code>
                      </div>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        className="btn btn-small btn-secondary"
                        onClick={() => set(issue.field === 'primary' ? 'primaryColor' : 'accentColor', issue.suggestion)}
                      >
                        Use suggested colour
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="contrast-ok" data-testid="contrast-ok">
                <Icon name="check" size={16} /> Both colours are readable in {modeText}.
              </div>
            )}
          </section>

          <section className="card stack">
            <h2>Appearance</h2>
            <div className="segmented" role="radiogroup" aria-label="Theme">
              {(['light', 'dark', 'auto'] as const).map((p) => (
                <label key={p} className={form.themePreference === p ? 'is-active' : ''}>
                  <input
                    type="radio"
                    name="themePreference"
                    value={p}
                    checked={form.themePreference === p}
                    disabled={disabled}
                    onChange={() => {
                      set('themePreference', p);
                      if (p !== 'auto') setPreviewMode(p);
                    }}
                  />
                  {p === 'auto' ? 'Auto (follow phone)' : p === 'light' ? 'Light' : 'Dark'}
                </label>
              ))}
            </div>
            <small className="muted">Members can still pick their own colour theme and appearance in the app.</small>
          </section>

          <section className="card stack">
            <div className="section-head">
              <h2>Features</h2>
              <span className="muted small">
                {form.enabledFeatures.length} of {FEATURES.length} on
              </span>
            </div>
            <div className="feature-grid">
              {FEATURES.map((key) => (
                <Toggle
                  key={key}
                  label={FEATURE_LABELS[key].label}
                  description={FEATURE_LABELS[key].description}
                  checked={form.enabledFeatures.includes(key)}
                  disabled={disabled}
                  onChange={(on) => toggleFeature(key, on)}
                />
              ))}
            </div>
          </section>

          <ErrorBanner message={error} />
          {canEdit && (
            <div className="form-actions sticky-actions">
              {onSkip && (
                <button type="button" className="btn btn-secondary" onClick={onSkip} disabled={saving}>
                  Skip for now
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : variant === 'onboarding' ? 'Save & continue' : 'Save branding'}
                {!saving && <Icon name="arrowRight" size={18} />}
              </button>
            </div>
          )}
        </form>

        <aside className="preview-col" aria-label="Live preview">
          <div className="preview-toolbar">
            <span className="eyebrow">Live preview</span>
            <div className="segmented segmented-small" role="group" aria-label="Preview mode">
              {(['light', 'dark'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={effectiveMode === m}
                  className={effectiveMode === m ? 'is-active' : ''}
                  disabled={form.themePreference !== 'auto'}
                  onClick={() => setPreviewMode(m)}
                >
                  {m === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
          </div>
          <PhonePreview
            mode={effectiveMode}
            features={form.enabledFeatures}
            branding={{
              gymName: form.gymName,
              tagline: form.tagline || null,
              logoUrl: form.logoUrl.trim() && validUrl(form.logoUrl.trim()) ? form.logoUrl.trim() : null,
              welcomeMessage: form.welcomeMessage || null,
              primaryColor: primary,
              accentColor: accent,
              themePreference: form.themePreference,
            }}
          />
          {form.themePreference !== 'auto' && <p className="muted small center">Members see {form.themePreference} mode unless they choose otherwise.</p>}
        </aside>
      </div>
    </div>
  );
}
