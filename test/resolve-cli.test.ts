import { describe, it, expect } from 'vitest';
import { resolveCli } from '../src/cli/run.js';
import { DEFAULT_THROUGHPUT } from '../src/core/throughput.js';

describe('resolveCli — flag/config/default precedence', () => {
  it('falls back to the built-in throughput defaults when neither flags nor config set them', () => {
    const resolved = resolveCli({}, {});
    expect(resolved.throughput).toEqual(DEFAULT_THROUGHPUT);
    expect(resolved.report).toBeUndefined();
    expect(resolved.insecure).toBe(false);
    expect(resolved.verbose).toBe(false);
    expect(resolved.quiet).toBe(false);
    expect(resolved.color).toBe(true);
  });

  it('uses config values as defaults when no flag is given', () => {
    const resolved = resolveCli(
      {},
      { batchSize: 50, concurrency: 1, report: './cfg.json', insecure: true, noColor: true },
    );
    expect(resolved.throughput.batchSize).toBe(50);
    expect(resolved.throughput.concurrency).toBe(1);
    expect(resolved.report).toBe('./cfg.json');
    expect(resolved.insecure).toBe(true);
    expect(resolved.color).toBe(false);
  });

  it('lets an explicit flag override the config file', () => {
    const resolved = resolveCli(
      { batchSize: '500', report: './flag.json', verbose: true },
      { batchSize: 50, report: './cfg.json', verbose: false },
    );
    expect(resolved.throughput.batchSize).toBe(500);
    expect(resolved.report).toBe('./flag.json');
    expect(resolved.verbose).toBe(true);
  });

  it('converts request-timeout (seconds) to milliseconds from either source', () => {
    expect(resolveCli({ requestTimeout: '60' }, {}).throughput.requestTimeoutMs).toBe(60_000);
    expect(resolveCli({}, { requestTimeout: 45 }).throughput.requestTimeoutMs).toBe(45_000);
  });

  it('maps commander --no-color (color:false) through to color', () => {
    expect(resolveCli({ color: false }, {}).color).toBe(false);
    expect(resolveCli({ color: true }, { noColor: true }).color).toBe(true);
  });
});
