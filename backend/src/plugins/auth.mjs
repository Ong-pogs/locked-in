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

export async function requireAccessAuth(request) {
  const rawToken = readBearerToken(request.headers.authorization);
  const decoded = await verifyToken(rawToken, 'access');
  request.auth = decoded;
}

export async function optionalAccessAuth(request) {
  const header = request.headers.authorization;
  if (!header) return;

  const rawToken = readBearerToken(header);
  const decoded = await verifyToken(rawToken, 'access');
  request.auth = decoded;
}
