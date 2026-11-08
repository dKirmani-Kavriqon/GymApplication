import { z } from 'zod';

/**
 * All runtime configuration, parsed once at startup from the environment.
 * `server.ts` reads settings only through `loadConfig()`. Secret values are never logged:
 * use `describeConfig()` for a safe summary.
 */

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));
const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  DB_PATH: z.string().min(1).default('gymverse.db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TOKEN_SECRET: optional,
  CORS_ORIGINS: optional,
  TRUST_PROXY: bool,
  PLATFORM_ADMIN_PHONES: list,
  EXPOSE_DEV_OTP: optional,
  JOBS_ENABLED: z.enum(['true', 'false']).default('true'),
  SMS_PROVIDER: z.enum(['log', 'msg91', 'twilio']).default('log'),
  MSG91_AUTH_KEY: optional,
  MSG91_TEMPLATE_ID: optional,
  TWILIO_ACCOUNT_SID: optional,
  TWILIO_AUTH_TOKEN: optional,
  TWILIO_FROM: optional,
  PAYMENTS_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
  RAZORPAY_KEY_ID: optional,
  RAZORPAY_KEY_SECRET: optional,
  RAZORPAY_WEBHOOK_SECRET: optional,
  EXPO_ACCESS_TOKEN: optional,
  PUBLIC_API_URL: optional,
  ALLOW_INSECURE_PROVIDERS: bool,
  /** Seeds the FLEX42 demo gym into an empty database (staging/demo only; refused in production). */
  DEMO_SEED: bool,
  /** Bearer token for the Cloudflare ops endpoints (/__ops/*: point-in-time restore). Unset = endpoints off. */
  OPS_TOKEN: optional,
});

export type SmsConfig =
  | { provider: 'log' }
  | { provider: 'msg91'; authKey: string; templateId: string }
  | { provider: 'twilio'; accountSid: string; authToken: string; from: string };

export type PaymentsConfig =
  | { provider: 'mock' }
  | { provider: 'razorpay'; keyId: string; keySecret: string; webhookSecret: string };

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  dbPath: string;
  logLevel: string;
  tokenSecret: string;
  corsOrigins: string[] | true;
  trustProxy: boolean;
  platformAdminPhones: string[];
  exposeDevOtp: boolean;
  jobsEnabled: boolean;
  sms: SmsConfig;
  payments: PaymentsConfig;
  expoAccessToken: string | undefined;
  /** Public base URL of this API, no trailing slash (hosted checkout links). */
  publicUrl: string;
  demoSeed: boolean;
  opsToken: string | undefined;
}

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.problems = problems;
  }
}

const DEV_SECRET = 'dev-secret-change-me';

/** Parses and validates the environment. Throws `ConfigError` listing every problem at once. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const e = parsed.data;
  const prod = e.NODE_ENV === 'production';
  const problems: string[] = [];

  if (prod) {
    if (!e.TOKEN_SECRET) problems.push('TOKEN_SECRET is required in production');
    else if (e.TOKEN_SECRET.length < 32) problems.push('TOKEN_SECRET must be at least 32 characters');
    if (!e.CORS_ORIGINS || e.CORS_ORIGINS === '*') problems.push('CORS_ORIGINS must list the allowed origins (not *) in production');
    if (!e.ALLOW_INSECURE_PROVIDERS) {
      if (e.SMS_PROVIDER === 'log') problems.push('SMS_PROVIDER=log only logs login codes; use msg91 or twilio in production');
      if (e.PAYMENTS_PROVIDER === 'mock') problems.push('PAYMENTS_PROVIDER=mock accepts fake payments; use razorpay in production');
    }
  }

  let sms: SmsConfig = { provider: 'log' };
  if (e.SMS_PROVIDER === 'msg91') {
    if (!e.MSG91_AUTH_KEY || !e.MSG91_TEMPLATE_ID) problems.push('SMS_PROVIDER=msg91 needs MSG91_AUTH_KEY and MSG91_TEMPLATE_ID');
    sms = { provider: 'msg91', authKey: e.MSG91_AUTH_KEY ?? '', templateId: e.MSG91_TEMPLATE_ID ?? '' };
  } else if (e.SMS_PROVIDER === 'twilio') {
    if (!e.TWILIO_ACCOUNT_SID || !e.TWILIO_AUTH_TOKEN || !e.TWILIO_FROM) {
      problems.push('SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM');
    }
    sms = { provider: 'twilio', accountSid: e.TWILIO_ACCOUNT_SID ?? '', authToken: e.TWILIO_AUTH_TOKEN ?? '', from: e.TWILIO_FROM ?? '' };
  }

  let payments: PaymentsConfig = { provider: 'mock' };
  if (e.PAYMENTS_PROVIDER === 'razorpay') {
    if (!e.RAZORPAY_KEY_ID || !e.RAZORPAY_KEY_SECRET || !e.RAZORPAY_WEBHOOK_SECRET) {
      problems.push('PAYMENTS_PROVIDER=razorpay needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET');
    }
    payments = {
      provider: 'razorpay',
      keyId: e.RAZORPAY_KEY_ID ?? '',
      keySecret: e.RAZORPAY_KEY_SECRET ?? '',
      webhookSecret: e.RAZORPAY_WEBHOOK_SECRET ?? '',
    };
  }

  if (e.PUBLIC_API_URL && !/^https?:\/\/[^\s/]+/.test(e.PUBLIC_API_URL)) problems.push('PUBLIC_API_URL must be an http(s) URL');
  if (prod && e.PAYMENTS_PROVIDER === 'razorpay' && !e.PUBLIC_API_URL) {
    problems.push('PUBLIC_API_URL is required in production with razorpay (hosted checkout links)');
  }
  if (prod && e.PUBLIC_API_URL?.startsWith('http://')) problems.push('PUBLIC_API_URL must use https in production');
  if (prod && e.DEMO_SEED) problems.push('DEMO_SEED adds demo people who can log in; it is not allowed in production');
  if (e.OPS_TOKEN && e.OPS_TOKEN.length < 32) problems.push('OPS_TOKEN must be at least 32 characters');

  if (problems.length) throw new ConfigError(problems);

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    dbPath: e.DB_PATH,
    logLevel: e.LOG_LEVEL,
    tokenSecret: e.TOKEN_SECRET ?? DEV_SECRET,
    corsOrigins: !e.CORS_ORIGINS || e.CORS_ORIGINS === '*' ? true : e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: e.TRUST_PROXY,
    platformAdminPhones: e.PLATFORM_ADMIN_PHONES,
    // Never expose login codes in production, whatever the flag says.
    exposeDevOtp: !prod && e.EXPOSE_DEV_OTP !== 'false',
    jobsEnabled: e.JOBS_ENABLED === 'true',
    sms,
    payments,
    expoAccessToken: e.EXPO_ACCESS_TOKEN,
    publicUrl: (e.PUBLIC_API_URL ?? `http://localhost:${e.PORT}`).replace(/\/+$/, ''),
    demoSeed: e.DEMO_SEED,
    opsToken: e.OPS_TOKEN,
  };
}

/** A log-safe summary (no secret values). */
export function describeConfig(c: Config): Record<string, unknown> {
  return {
    env: c.env,
    port: c.port,
    dbPath: c.dbPath,
    corsOrigins: c.corsOrigins,
    trustProxy: c.trustProxy,
    sms: c.sms.provider,
    payments: c.payments.provider,
    push: c.expoAccessToken ? 'expo (token)' : 'expo',
    publicUrl: c.publicUrl,
    platformAdmins: c.platformAdminPhones.length,
    jobs: c.jobsEnabled,
    exposeDevOtp: c.exposeDevOtp,
    demoSeed: c.demoSeed,
    ops: Boolean(c.opsToken),
  };
}
