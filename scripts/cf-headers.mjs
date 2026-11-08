#!/usr/bin/env node
/**
 * Writes `_headers` (Cloudflare static assets) into a built web app: security headers and a CSP
 * whose connect-src allows the API origin. Run after the app's build.
 *
 *   node scripts/cf-headers.mjs <dist-dir> [api-url]
 *
 * The API URL defaults to VITE_API_URL (dashboard) or EXPO_PUBLIC_API_URL (member web app), the
 * same variable the build baked in, so the CSP always matches the app.
 */
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [dist, arg] = process.argv.slice(2);
const apiUrl = arg || process.env.VITE_API_URL || process.env.EXPO_PUBLIC_API_URL;
if (!dist || !apiUrl || !existsSync(dist)) {
  console.error('Usage: node scripts/cf-headers.mjs <built-dist-dir> [api-url]  (or set VITE_API_URL / EXPO_PUBLIC_API_URL)');
  process.exit(1);
}
let api;
try {
  api = new URL(apiUrl).origin;
} catch {
  console.error(`Not a URL: ${apiUrl}`);
  process.exit(1);
}

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  // React Native Web and the dashboard set inline styles.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' ${api}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const headers = `/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: ${csp}

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/_expo/*
  Cache-Control: public, max-age=31536000, immutable
`;

writeFileSync(join(dist, '_headers'), headers);
console.log(`Wrote ${join(dist, '_headers')} (API ${api})`);
