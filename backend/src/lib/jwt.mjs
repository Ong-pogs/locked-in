import { SignJWT, jwtVerify } from 'jose';
import { appConfig } from '../config.mjs';
import { HttpError, unauthorized } from './errors.mjs';

const secret = new TextEncoder().encode(appConfig.jwtSecret);

export async function signAccessToken(walletAddress) {
  return new SignJWT({
    wallet_address: walletAddress,
    type: 'access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(appConfig.jwtIssuer)
    .setAudience(appConfig.jwtAudience)
    .setExpirationTime(appConfig.accessTokenTtl)
    .sign(secret);
}

export async function signRefreshToken(walletAddress) {
  return new SignJWT({
    wallet_address: walletAddress,
    type: 'refresh',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(appConfig.jwtIssuer)
    .setAudience(appConfig.jwtAudience)
    .setExpirationTime(appConfig.refreshTokenTtl)
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
    payload,
  };
}
