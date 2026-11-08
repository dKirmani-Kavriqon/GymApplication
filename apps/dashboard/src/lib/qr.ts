import QRCode from 'qrcode';

export function joinLink(code: string): string {
  return `gymverse://join/${code}`;
}

/** Any text as a QR SVG data URL (crisp when printed, no canvas needed). */
export async function qrDataUrl(text: string): Promise<string> {
  const svg = await QRCode.toString(text, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#1F1F1F', light: '#FFFFFF' },
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** QR code for a gym join code. */
export function joinQrDataUrl(code: string): Promise<string> {
  return qrDataUrl(joinLink(code));
}

/**
 * Prints one poster: tags <body> so the print stylesheet hides the other posters on the page,
 * then clears the tag once the dialog closes.
 */
export function printPoster(kind: 'join' | 'door'): void {
  document.body.dataset.print = kind;
  try {
    window.print();
  } finally {
    // window.print() blocks until the dialog closes in browsers; clear on the next tick to be safe.
    setTimeout(() => delete document.body.dataset.print, 0);
  }
}
