import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveCli, type ImportConfigFile } from '../src/cli/run.js';

/**
 * `config/qa-prod.json` carries the throughput that imported cleanly on QA
 * (2026-09-24). The defaults (200 rows, 30 s) time out there, and a timed-out
 * batch the server still commits is retried into duplicate rows on collections
 * without a unique field — so a silently ignored key here is not harmless.
 */
const raw = readFileSync(new URL('../config/qa-prod.json', import.meta.url), 'utf8');
const config = JSON.parse(raw) as ImportConfigFile;

describe('config/qa-prod.json', () => {
  it('resolves to the throughput verified on QA', () => {
    const { throughput, verbose } = resolveCli({}, config);

    expect(throughput.batchSize).toBe(50);
    expect(throughput.concurrency).toBe(2);
    expect(throughput.requestTimeoutMs).toBe(180_000);
    expect(verbose).toBe(true);
  });

  it('uses only keys the importer reads (a typo would silently fall back to a default)', () => {
    const known: (keyof ImportConfigFile)[] = [
      'batchSize',
      'concurrency',
      'requestTimeout',
      'maxRetries',
      'circuitBreakerThreshold',
      'report',
      'insecure',
      'verbose',
      'quiet',
      'noColor',
    ];
    expect(Object.keys(config).filter((k) => !known.includes(k as keyof ImportConfigFile))).toEqual(
      [],
    );
  });
});
