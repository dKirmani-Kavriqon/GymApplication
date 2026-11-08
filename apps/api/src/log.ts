/**
 * Small pino-compatible JSON logger (same line shape: `{"level":30,"time":…,"msg":…}`) that runs on
 * Node and on Cloudflare Workers, where JSON lines written with console.log become structured logs.
 */

export const LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Infinity,
} as const;
export type LevelName = keyof typeof LEVELS;
type LogFn = (objOrMsg?: unknown, msg?: string) => void;

export interface Logger {
  level: string;
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerConfig {
  level?: string;
  /** Receives each JSON line (with a trailing newline). Default: console.log. */
  write?: (line: string) => void;
  /** Applied to every object before it is written (redaction). */
  redact?: (obj: Record<string, unknown>) => Record<string, unknown>;
}

function serializeError(err: Error): Record<string, unknown> {
  return { type: err.name, message: err.message, stack: err.stack };
}

export function createLogger(config: LoggerConfig = {}, bindings: Record<string, unknown> = {}): Logger {
  const level = (config.level ?? 'info') as LevelName;
  const min = LEVELS[level] ?? LEVELS.info;
  const write = config.write ?? ((line: string) => console.log(line.trimEnd()));
  const redact = config.redact ?? ((o) => o);

  const at =
    (name: Exclude<LevelName, 'silent'>): LogFn =>
    (objOrMsg, msg) => {
      const n = LEVELS[name];
      if (n < min) return;
      let fields: Record<string, unknown> = {};
      let message = msg;
      if (typeof objOrMsg === 'string') message = objOrMsg;
      else if (objOrMsg instanceof Error) fields = { err: serializeError(objOrMsg) };
      else if (objOrMsg && typeof objOrMsg === 'object') fields = { ...(objOrMsg as Record<string, unknown>) };
      if (fields.err instanceof Error) fields.err = serializeError(fields.err);
      const line = redact({
        level: n,
        time: Date.now(),
        ...bindings,
        ...fields,
        ...(message !== undefined ? { msg: message } : {}),
      });
      try {
        write(`${JSON.stringify(line)}\n`);
      } catch {
        // A broken log sink must never break a request.
      }
    };

  return {
    level,
    trace: at('trace'),
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    fatal: at('fatal'),
    child: (more) => createLogger(config, { ...bindings, ...more }),
  };
}

/** A logger that drops everything (logger: false). */
export const silentLogger: Logger = createLogger({ level: 'silent' });
