import type { OtpSender } from './auth';
import type { Config } from './config';
import type { LoggerOptions } from './context';
import { createApp, type GymVerseApp } from './core';
import type { Db } from './db';
import { createJobs, type Jobs } from './jobs';
import { createMockPaymentProvider, createRazorpayProvider } from './payments';
import { createExpoPushSender, type PushSender } from './push';
import { createSmsSender, type FetchFn } from './sms';

export interface WireDeps {
  /** Swaps the network for tests. */
  fetch?: FetchFn;
  logger?: boolean | LoggerOptions;
  push?: PushSender;
}

/** Builds the app and its jobs from validated config on an open database. Runtime-neutral (Node and Workers). */
export function appFromConfig(db: Db, config: Config, deps: WireDeps = {}): { app: GymVerseApp; jobs: Jobs } {
  let sms: OtpSender = () => undefined;
  const app = createApp(db, {
    tokenSecret: config.tokenSecret,
    exposeDevOtp: config.exposeDevOtp,
    corsOrigins: config.corsOrigins,
    trustProxy: config.trustProxy,
    platformAdminPhones: config.platformAdminPhones,
    publicUrl: config.publicUrl,
    logger: deps.logger ?? { level: config.logLevel },
    sendOtp: (phone, code) => sms(phone, code),
    payments:
      config.payments.provider === 'razorpay' ? createRazorpayProvider({ ...config.payments, fetch: deps.fetch }) : createMockPaymentProvider(),
    push: deps.push ?? createExpoPushSender({ accessToken: config.expoAccessToken, fetch: deps.fetch }),
  });
  sms = createSmsSender(config.sms, { fetch: deps.fetch, log: app.log });
  return { app, jobs: createJobs(app.ctx) };
}
