import { createHash } from 'node:crypto';

// @fastify/rate-limit's keyGenerator runs in the onRequest hook — BEFORE
// requireAccessAuth — so request.auth does not exist yet. For authenticated
// mutation routes we still want a per-caller bucket (many users behind one NAT
// share an IP; one abuser must not rate-limit the rest), so we derive the key
// from the bearer token WITHOUT trusting it: per-token ≈ per-session ≈
// per-wallet for abuse-bounding, and a forged/garbage token just gets its own
// bucket and still 401s in the handler.
//
// The token is sha256-hashed so no token material ever lands in the
// rate-limit store keys or logs. Falls back to the IP when no bearer token is
// present (request.ip already honors trustProxy, see server.mjs).
export function keyGenerator(request) {
  const header = request.headers.authorization;
  if (typeof header === 'string') {
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token) {
      return `tok:${createHash('sha256').update(token).digest('hex')}`;
    }
  }

  return `ip:${request.ip}`;
}
