/**
 * Seeds a demo gym so the apps have something to show:
 *   gym code FLEX42 · owner +919999900001 · member +919999900002 · trainer +919999900003
 * Log in with any of these numbers; in development the OTP is shown in the app.
 * Safe to run repeatedly (see src/demo-seed.ts). Never point this at a production database.
 */
import { openDb } from './db-node';
import { seedDemo } from './demo-seed';

const db = openDb(process.env.DB_PATH ?? 'gymverse.db');
const result = seedDemo(db);
db.close();

const done = [
  result.createdGym && 'created the demo gym',
  !result.createdGym && result.addedContent && 'added v0.2 demo content',
  !result.createdGym && result.addedV03 && 'added v0.3 demo content',
  result.recoloured && 'switched it to the GymVerse default colours',
].filter(Boolean);

console.log(
  done.length
    ? `FLEX42: ${done.join(', ')}. Owner +919999900001 · member +919999900002 · trainer +919999900003`
    : 'Demo gym FLEX42 is already up to date; nothing to do.',
);
