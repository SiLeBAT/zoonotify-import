import pino from 'pino';

/** Human-friendly CLI logger. Pretty in a TTY; plain JSON when piped. */
export const logger = pino(
  process.stdout.isTTY ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {},
);
