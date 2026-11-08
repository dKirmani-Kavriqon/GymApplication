import { useState, type FormEvent } from 'react';
import type { User } from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { isValidPhone, normalizePhone } from '../lib/format';
import { ErrorBanner } from '../components/ui';
import { Icon, StarMark } from '../components/Icon';

interface Props {
  onLoggedIn: (token: string, user: User) => void;
}

export function Login({ onLoggedIn }: Props) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    if (!isValidPhone(phone)) {
      setError('Enter a valid phone number');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ sent: boolean; devCode?: string }>('/auth/otp/request', { phone: normalizePhone(phone) });
      setDevCode(res.devCode ?? null);
      setCode('');
      setStep('code');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ token: string; isNewUser: boolean; user: User }>('/auth/otp/verify', {
        phone: normalizePhone(phone),
        code,
      });
      onLoggedIn(res.token, res.user);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="brand-mark">
          <StarMark size={22} className="brand-star" /> GymVerse
        </div>
        <h1>{step === 'phone' ? 'Gym owner login' : 'Enter your code'}</h1>
        {step === 'phone' ? (
          <form onSubmit={requestCode} className="stack">
            <p className="muted">We'll text you a 6-digit code. No password needed.</p>
            <label className="field">
              <span>Phone number</span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+91 98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoFocus
              />
            </label>
            <small className="muted hint-under">10-digit numbers are treated as +91 (India).</small>
            <ErrorBanner message={error} />
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
              {!busy && <Icon name="arrowRight" size={18} />}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="stack">
            <p className="muted">
              Sent to <strong>{normalizePhone(phone)}</strong>.{' '}
              <button type="button" className="link" onClick={() => setStep('phone')}>
                Change number
              </button>
            </p>
            {devCode && (
              <div className="dev-hint" data-testid="dev-code">
                Dev code: <strong>{devCode}</strong>
              </div>
            )}
            <label className="field">
              <span>6-digit code</span>
              <input
                className="otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
              />
            </label>
            <ErrorBanner message={error} />
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? 'Verifying…' : 'Verify & continue'}
            </button>
            <button type="button" className="btn btn-secondary btn-block" onClick={() => requestCode()} disabled={busy}>
              Resend code
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
