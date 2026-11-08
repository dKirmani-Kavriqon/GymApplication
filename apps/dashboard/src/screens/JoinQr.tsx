import { useEffect, useState, type FormEvent } from 'react';
import { buildTheme, referralSettingsSchema, type DoorCode, type Gym, type ReferralInfo } from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { useApiData } from '../lib/useApi';
import { formatDateTime } from '../lib/format';
import { printPoster, qrDataUrl } from '../lib/qr';
import { emptyToNull, validate } from '../lib/validate';
import { QrPoster } from '../components/QrPoster';
import { Icon } from '../components/Icon';
import { ErrorBanner, Loading, PageHeader, Tabs } from '../components/ui';
import { useToast } from '../components/Toast';

/** Printable "Scan to check in" poster for the gym door. */
function DoorPoster({ gym }: { gym: Gym }) {
  const { data: door, error, loading, setData } = useApiData<DoorCode>(`/gyms/${gym.id}/door-code`);
  const [qr, setQr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const toast = useToast();
  const theme = buildTheme({ ...gym.branding, themePreference: 'light' }, 'light');

  useEffect(() => {
    if (!door?.url) return;
    let alive = true;
    qrDataUrl(door.url)
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [door?.url]);

  async function rotate() {
    setBusy(true);
    setRotateError(null);
    try {
      const next = await api.post<DoorCode>(`/gyms/${gym.id}/door-code/rotate`);
      setData(next);
      setQr(null);
      setConfirming(false);
      toast('New door code ready. Print the new poster.');
    } catch (err) {
      setRotateError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !door) return <Loading rows={4} />;
  if (error) return <ErrorBanner message={error} />;
  if (!door) return null;

  return (
    <div className="poster-wrap">
      <div className="print-poster poster" data-poster="door" style={{ borderColor: theme.primary }}>
        <div className="poster-band" style={{ background: theme.primary, color: theme.onPrimary }}>
          <Icon name="door" size={36} />
          <div className="poster-gym">{gym.branding.gymName}</div>
          <div className="poster-tagline">Members only</div>
        </div>
        <div className="poster-body">
          <div className="poster-title">Scan to check in</div>
          {qr ? (
            <img className="poster-qr" src={qr} alt={`Check-in QR code for ${gym.branding.gymName}`} data-testid="door-qr" />
          ) : (
            <div className="poster-qr poster-qr-placeholder">Generating QR…</div>
          )}
          <ol className="poster-steps">
            <li>Point your phone camera at this code</li>
            <li>Tap the GymVerse link that appears</li>
            <li>You are checked in and your streak updates</li>
          </ol>
        </div>
      </div>
      <div className="poster-actions no-print">
        <button type="button" className="btn btn-primary" onClick={() => printPoster('door')}>
          <Icon name="printer" size={18} /> Print check-in poster
        </button>
        {!confirming && (
          <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
            <Icon name="refresh" size={16} /> Rotate code
          </button>
        )}
      </div>
      <p className="muted small no-print" data-testid="door-rotated">
        Code last changed {formatDateTime(door.rotatedAt, gym.timezone)}
      </p>
      {confirming && (
        <div className="confirm-panel no-print" role="group" aria-label="Rotate the door code?">
          <div>
            <strong>Rotate the door code?</strong>
            <p className="small">
              Every printed check-in poster stops working straight away. Members scanning an old poster will see an error until you put up the new
              one. Do this if a photo of the code has been shared outside the gym.
            </p>
          </div>
          <ErrorBanner message={rotateError} />
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Keep current code
            </button>
            <button type="button" className="btn btn-primary btn-danger" onClick={rotate} disabled={busy}>
              {busy ? 'Rotating…' : 'Rotate now'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReferralSettings({ gym }: { gym: Gym }) {
  const { data, error, loading } = useApiData<ReferralInfo>(`/gyms/${gym.id}/referral`);
  const [reward, setReward] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const toast = useToast();
  const value = reward ?? data?.reward ?? '';

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = validate(referralSettingsSchema, { reward: emptyToNull(value) });
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api.put(`/gyms/${gym.id}/referral`, { reward: parsed.data.reward ?? null });
      toast('Referral reward saved');
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={save} noValidate aria-label="Referral reward">
      <div className="section-head">
        <h2>Refer a friend</h2>
        {data && <span className="badge badge-brand">{data.joined} joined through referrals</span>}
      </div>
      <p className="muted small">
        Members share a personal link from the app. Tell them what they get when a friend joins. Leave empty to share without a reward.
      </p>
      {loading && !data ? (
        <Loading rows={1} />
      ) : (
        <>
          <ErrorBanner message={error} />
          <label className="field">
            <span>Reward</span>
            <input value={value} onChange={(e) => setReward(e.target.value)} maxLength={120} placeholder="One free week for you and your friend" />
          </label>
          <small className="muted">{value.length}/120</small>
        </>
      )}
      <ErrorBanner message={formError} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || (loading && !data)}>
          {busy ? 'Saving…' : 'Save reward'}
        </button>
      </div>
    </form>
  );
}

export function JoinQr({ gym, canManage = true }: { gym: Gym; canManage?: boolean }) {
  const [tab, setTab] = useState<'join' | 'door'>('join');
  return (
    <div className="stack-lg">
      <PageHeader
        title="Join & check-in QR"
        subtitle={
          tab === 'join'
            ? 'Print this poster for your front desk. Members scan it (or type the code) to join your gym in the app.'
            : 'Put this poster at the door. Scanning it proves a member is really at the gym when they check in.'
        }
      />
      {canManage && (
        <Tabs
          label="Posters"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'join', label: 'Join poster' },
            { id: 'door', label: 'Check-in poster' },
          ]}
        />
      )}
      {tab === 'door' && canManage ? (
        <DoorPoster gym={gym} />
      ) : (
        <>
          <QrPoster gym={gym} />
          {canManage && <ReferralSettings gym={gym} />}
        </>
      )}
    </div>
  );
}
