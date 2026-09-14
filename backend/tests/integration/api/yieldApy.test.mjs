// The public APY endpoint backs the dashboard chip, so whatever it returns is
// a number a person reads as what their money earns.
//
// This file exists because that was not true for a while: the fixed-APY
// profile (the devnet default, and what production ran) has a mock 8% used to
// make simulated harvests accrue, and the endpoint fell back to it whenever
// there was no live Kamino read. The chip then published 8.00% as the user's
// rate. It was labelled "Simulated", but the number itself was invented.
//
// The rule these tests hold: a simulated rate is not a rate. No live read
// means no APY, and the chip renders nothing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { getYieldStrategyInfo } from '../../../src/lib/yieldStrategy.mjs';

let app;
beforeAll(async () => { app = await createTestServer(); });
afterAll(async () => { await closeTestServer(app); });

const currentApy = async () =>
  (await app.inject({ method: 'GET', url: '/v1/yield/current-apy' })).json();

describe('GET /v1/yield/current-apy', () => {
  // Guards the premise of every test below: the test env runs the same
  // fixed-APY strategy production does, with a non-null mock constant sitting
  // right there for the endpoint to reach for.
  it('runs the fixed-APY strategy, with a mock constant available', () => {
    const info = getYieldStrategyInfo();
    expect(info.kind).toBe('fixed_apy_v1');
    expect(info.fixedApyBps).toBeGreaterThan(0);
  });

  it('publishes NO apy rather than the simulator constant', async () => {
    const body = await currentApy();
    expect(body.apyBps).toBeNull();
    expect(body.apyPct).toBeNull();
  });

  it('never returns the mock 8% that used to leak through', async () => {
    const body = await currentApy();
    expect(body.apyBps).not.toBe(800);
    expect(body.apyPct).not.toBe(8);
  });

  it('does not claim to be live when nothing was read on chain', async () => {
    const body = await currentApy();
    expect(body.live).toBe(false);
    expect(body.fetchedAt).toBeNull();
  });

  it('still answers 200 so the dashboard can hide the chip, not error', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/yield/current-apy' });
    expect(res.statusCode).toBe(200);
    // LiveApyChip renders null on a null apyPct; a 500 would show an error
    // state instead, which is a worse answer than showing nothing.
    expect(res.json().source).toBeTypeOf('string');
  });
});

describe('GET /v1/yield/strategy-info', () => {
  // The operator endpoint is allowed to say what the simulator is configured
  // to — that is a config readout, not a rate quoted to a user.
  it('still reports the configured fixed APY for operators', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/yield/strategy-info' });
    expect(res.statusCode).toBe(200);
    expect(res.json().fixedApyBps).toBeGreaterThan(0);
  });
});
