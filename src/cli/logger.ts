import pino from 'pino';
import pretty from 'pino-pretty';

export interface LoggerOptions {
  /** Suppress info-level (stdout) output; only errors are emitted. */
  quiet?: boolean;
  /** Colorize pretty output. Defaults to on for a TTY, off when piped. */
  color?: boolean;
}

/**
 * Human-friendly CLI logger. Pretty in a TTY; plain JSON when piped. `--quiet`
 * raises the level to `error` so nothing routine reaches stdout; `--no-color`
 * disables ANSI even on a TTY.
 *
 * pino-pretty is attached as a direct destination stream rather than via
 * `transport: { target: 'pino-pretty' }`. The transport form spawns a worker
 * thread that resolves the target module by string at runtime, which a
 * single-file esbuild bundle cannot satisfy; the stream form bundles cleanly
 * while producing identical pretty output. See `scripts/build.mjs`.
 */
export function createLogger(options: LoggerOptions = {}): pino.Logger {
  const isTty = Boolean(process.stdout.isTTY);
  const colorize = options.color ?? isTty;
  const level = options.quiet ? 'error' : 'info';
  return isTty ? pino({ level }, pretty({ colorize })) : pino({ level });
}

/** Default logger used by `defaultDeps`; the CLI replaces it per-run from flags. */
export const logger = createLogger();
