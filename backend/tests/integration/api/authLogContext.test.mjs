// Support could not answer "my deposit vanished": the request lifecycle logs
// carried {method,url,ip,origin,statusCode,durationMs} and nothing that ties a
// line to a person, even though requireAccessAuth already knows the wallet.
// requireAccessAuth now binds the wallet onto the request logger, so every
// later line on that request (including server.mjs's request.end hook) carries
// wallet next to Fastify's reqId — and the bearer token never does.

import { describe, it, expect } from 'vitest';
import { requireAccessAuth, optionalAccessAuth } from '../../../src/plugins/auth.mjs';
import { getTestAccessToken, generateTestWallet } from '../../helpers/test-auth.mjs';

function fakeRequest(token) {
  const bindings = [];
  const log = {
    bindings,
    child(extra) {
      bindings.push(extra);
      return { ...log, bindings };
    },
  };
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    log,
    bindings,
  };
}

describe('requireAccessAuth log context', () => {
  it('binds the authenticated wallet onto the request logger', async () => {
    const walletAddress = generateTestWallet();
    const request = fakeRequest(await getTestAccessToken(walletAddress));

    await requireAccessAuth(request);

    expect(request.bindings).toEqual([{ wallet: walletAddress }]);
  });

  it('never binds the bearer token or any other credential', async () => {
    const walletAddress = generateTestWallet();
    const token = await getTestAccessToken(walletAddress);
    const request = fakeRequest(token);

    await requireAccessAuth(request);

    const serialized = JSON.stringify(request.bindings);
    expect(serialized).not.toContain(token);
    expect(request.bindings.every((b) => Object.keys(b).length === 1)).toBe(true);
  });

  it('binds the wallet when optional auth resolves a caller', async () => {
    const walletAddress = generateTestWallet();
    const request = fakeRequest(await getTestAccessToken(walletAddress));

    await optionalAccessAuth(request);

    expect(request.bindings).toEqual([{ wallet: walletAddress }]);
  });

  it('leaves the logger untouched for an anonymous caller', async () => {
    const request = fakeRequest(null);

    await optionalAccessAuth(request);

    expect(request.bindings).toEqual([]);
  });
});
