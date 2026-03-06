import { SignJWT, jwtVerify } from 'jose';
import { appConfig } from '../config.mjs';
import { HttpError, unauthorized } from './errors.mjs';

const secret = new TextEncoder().encode(appConfig.jwtSecret);

function parseDurationToMs(rawValue, fallbackMs) {
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return rawValue * 1000;
  }

  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return fallbackMs;
  }

  const trimmed = rawValue.trim();
  const match = trimmed.match(/^(\d+)([smhd])$/i);
  if (!match) {
    return fallbackMs;
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multiplier =
    unit === 's'
      ? 1000
      : unit === 'm'
        ? 60_000
        : unit === 'h'
          ? 3_600_000
          : 86_400_000;

  return value * multiplier;
}

export function getAccessTokenExpiryDate() {
  return new Date(Date.now() + parseDurationToMs(appConfig.accessTokenTtl, 15 * 60_000));
}

export function getRefreshTokenExpiryDate() {
  return new Date(Date.now() + parseDurationToMs(appConfig.refreshTokenTtl, 30 * 86_400_000));
}

export async function signAccessToken(walletAddress, expiresAt = getAccessTokenExpiryDate()) {
  return new SignJWT({
    wallet_address: walletAddress,
    type: 'access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(appConfig.jwtIssuer)
    .setAudience(appConfig.jwtAudience)
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret);
}

export async function signRefreshToken(
  walletAddress,
  tokenId,
  expiresAt = getRefreshTokenExpiryDate(),
) {
  return new SignJWT({
    wallet_address: walletAddress,
    type: 'refresh',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(appConfig.jwtIssuer)
    .setAudience(appConfig.jwtAudience)
    .setJti(tokenId)
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret);
}

export async function verifyToken(token, expectedType = null) {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, secret, {
      issuer: appConfig.jwtIssuer,
      audience: appConfig.jwtAudience,
    }));
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    const code = error?.code === 'ERR_JWT_EXPIRED'
      ? 'TOKEN_EXPIRED'
      : 'INVALID_TOKEN';
    throw unauthorized('Invalid or expired token', code);
  }

  const wallet = payload.wallet_address;
  const tokenType = payload.type;

  if (typeof wallet !== 'string' || wallet.length === 0) {
    throw unauthorized('Invalid token payload', 'INVALID_TOKEN_PAYLOAD');
  }

  if (expectedType && tokenType !== expectedType) {
    throw unauthorized('Invalid token type', 'INVALID_TOKEN_TYPE');
  }

  return {
    walletAddress: wallet,
    tokenId: typeof payload.jti === 'string' ? payload.jti : null,
    payload,
  };
}
