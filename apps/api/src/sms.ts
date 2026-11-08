import type { Logger } from './log';
import type { SmsConfig } from './config';
import { HttpError } from './errors';
import type { OtpSender } from './auth';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Shows only the last 4 digits: +91******0002. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `${phone.startsWith('+') ? '+' : ''}${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export const smsFailed = () => new HttpError(502, 'sms_failed', "We couldn't send the code. Try again in a minute.");

async function ensureOk(res: Response, provider: string, log?: Logger): Promise<void> {
  if (res.ok) return;
  // Provider bodies can echo the phone number or the code: log the status only.
  log?.error({ provider, status: res.status }, 'SMS provider rejected the request');
  throw smsFailed();
}

/**
 * Builds the OTP sender for the configured provider. `fetchFn` is injectable so tests never
 * reach the network. Network errors and non-2xx responses become 502 `sms_failed`.
 */
export function createSmsSender(config: SmsConfig, opts: { fetch?: FetchFn; log?: Logger } = {}): OtpSender {
  const fetchFn = opts.fetch ?? (globalThis.fetch as FetchFn);
  const log = opts.log;
  const guarded = (send: (phone: string, code: string) => Promise<void>): OtpSender => async (phone, code) => {
    try {
      await send(phone, code);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      log?.error({ provider: config.provider, err: (err as Error).message }, 'SMS provider unreachable');
      throw smsFailed();
    }
  };

  switch (config.provider) {
    case 'msg91':
      // MSG91 Flow API: the template holds the text; ##otp## is filled from `otp`.
      return guarded(async (phone, code) => {
        const res = await fetchFn('https://control.msg91.com/api/v5/flow/', {
          method: 'POST',
          headers: { authkey: config.authKey, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ template_id: config.templateId, short_url: '0', recipients: [{ mobiles: phone.replace(/^\+/, ''), otp: code }] }),
        });
        await ensureOk(res, 'msg91', log);
      });
    case 'twilio':
      return guarded(async (phone, code) => {
        const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');
        const res = await fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`, {
          method: 'POST',
          headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: phone, From: config.from, Body: `${code} is your GymVerse login code. It expires in 5 minutes.` }).toString(),
        });
        await ensureOk(res, 'twilio', log);
      });
    default:
      // Development: the code is only logged (phone masked). Never use in production (config refuses it).
      return (phone, code) => {
        log?.info({ phone: maskPhone(phone), devCode: code }, 'OTP (log sender)');
      };
  }
}
