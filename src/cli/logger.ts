import pino from 'pino';

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
 */
export function createLogger(options: LoggerOptions = {}): pino.Logger {
  const isTty = Boolean(process.stdout.isTTY);
  const colorize = options.color ?? isTty;
  const transport = isTty ? { transport: { target: 'pino-pretty', options: { colorize } } } : {};
  return pino({ level: options.quiet ? 'error' : 'info', ...transport });
}

/** Default logger used by `defaultDeps`; the CLI replaces it per-run from flags. */
export const logger = createLogger();
