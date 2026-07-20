import { verifyToken } from '../lib/jwt.mjs';
import { unauthorized } from '../lib/errors.mjs';

function readBearerToken(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') {
    throw unauthorized('Missing Authorization header');
  }

  const [scheme, token] = headerValue.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw unauthorized('Malformed Authorization header');
  }

  return token;
}

// Support gets handed a wallet address and nothing else ("my deposit
// vanished"). Binding it onto the request logger the moment we know it makes
// every later line on that request greppable by wallet, next to Fastify's own
// reqId — which is what stitches request.start, the handler's own warnings and
// request.end back into one story. Only the address is ever bound: the bearer
// token it came from must never reach a log line.
function bindWalletToLog(request, walletAddress) {
  if (!walletAddress || typeof request.log?.child !== 'function') return;
  request.log = request.log.child({ wallet: walletAddress });
}

export async function requireAccessAuth(request) {
  const rawToken = readBearerToken(request.headers.authorization);
  const decoded = await verifyToken(rawToken, 'access');
  request.auth = decoded;
  bindWalletToLog(request, decoded.walletAddress);
}

export async function optionalAccessAuth(request) {
  const header = request.headers.authorization;
  if (!header) return;

  // Treat any auth failure as anonymous — the whole point of "optional" is to
  // let the route serve unauthenticated callers. readBearerToken/verifyToken
  // throw on malformed or expired tokens; swallow those here.
  try {
    const rawToken = readBearerToken(header);
    const decoded = await verifyToken(rawToken, 'access');
    request.auth = decoded;
    bindWalletToLog(request, decoded.walletAddress);
  } catch {
    // Anonymous — leave request.auth unset
  }
}
