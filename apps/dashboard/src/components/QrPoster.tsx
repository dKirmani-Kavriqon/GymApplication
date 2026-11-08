import { useEffect, useState } from 'react';
import { buildTheme, type Gym } from '@gymverse/shared';
import { joinLink, joinQrDataUrl, printPoster } from '../lib/qr';
import { Icon } from './Icon';

/** Printable join poster: big code + QR encoding gymverse://join/<CODE>. */
export function QrPoster({ gym }: { gym: Gym }) {
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const theme = buildTheme({ ...gym.branding, themePreference: 'light' }, 'light');

  useEffect(() => {
    let alive = true;
    joinQrDataUrl(gym.joinCode)
      .then((url) => alive && setQr(url))
      .catch(() => alive && setError('Could not generate the QR code.'));
    return () => {
      alive = false;
    };
  }, [gym.joinCode]);

  return (
    <div className="poster-wrap">
      <div className="print-poster poster" data-poster="join" style={{ borderColor: theme.primary }}>
        <div className="poster-band" style={{ background: theme.primary, color: theme.onPrimary }}>
          {gym.branding.logoUrl && <img className="poster-logo" src={gym.branding.logoUrl} alt="" />}
          <div className="poster-gym">{gym.branding.gymName}</div>
          {gym.branding.tagline && <div className="poster-tagline">{gym.branding.tagline}</div>}
        </div>
        <div className="poster-body">
          <div className="poster-title">Scan to join us on GymVerse</div>
          {qr ? (
            <img className="poster-qr" src={qr} alt={`QR code for ${joinLink(gym.joinCode)}`} data-testid="join-qr" />
          ) : (
            <div className="poster-qr poster-qr-placeholder">{error ?? 'Generating QR…'}</div>
          )}
          <div className="poster-or">or open the app and enter code</div>
          <div className="join-code" data-testid="join-code" style={{ color: theme.primaryText }}>
            {gym.joinCode}
          </div>
          <ol className="poster-steps">
            <li>Point your phone camera at this code</li>
            <li>Install GymVerse if asked, then open the link</li>
            <li>Or open the app and type the code above</li>
          </ol>
        </div>
      </div>
      <div className="poster-actions no-print">
        <button type="button" className="btn btn-primary" onClick={() => printPoster('join')}>
          <Icon name="printer" size={18} /> Print poster
        </button>
        <span className="muted small">Encodes {joinLink(gym.joinCode)}</span>
      </div>
    </div>
  );
}
