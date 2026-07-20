import { randomUUID } from 'node:crypto';
import { badRequest, unauthorized } from '../../lib/errors.mjs';
import {
  getAccessTokenExpiryDate,
  getRefreshTokenExpiryDate,
  signAccessToken,
  signRefreshToken,
  verifyToken,
} from '../../lib/jwt.mjs';
import { verifySolanaChallengeSignature } from '../../lib/solanaAuth.mjs';
import {
  hasPrivyAuthConfig,
  verifyPrivySessionForWallet,
} from '../../lib/privyAuth.mjs';
import {
  consumeChallenge,
  createChallenge,
  issueRefreshSession,
  rotateRefreshSession,
} from './state.mjs';

function assertWalletAddress(value) {
  if (!value || typeof value !== 'string') {
    throw badRequest('walletAddress is required', 'MISSING_WALLET_ADDRESS');
  }
  return value;
}

function assertSignature(value) {
  if (!value || typeof value !== 'string') {
    throw badRequest('signature is required', 'MISSING_SIGNATURE');
  }
  return value;
}

async function buildSession(walletAddress) {
  const accessExpiresAt = getAccessTokenExpiryDate();
  const refreshExpiresAt = getRefreshTokenExpiryDate();
  const refreshTokenId = randomUUID();

  const accessToken = await signAccessToken(walletAddress, accessExpiresAt);
  const refreshToken = await signRefreshToken(
    walletAddress,
    refreshTokenId,
    refreshExpiresAt,
  );

  await issueRefreshSession(walletAddress, refreshTokenId, refreshExpiresAt);

  return {
    accessToken,
    refreshToken,
    expiresAt: accessExpiresAt.toISOString(),
  };
}

// Every auth route was unlimited: free brute-force against /verify and
// /refresh, and free JWT-minting load on the rest. These ceilings are per IP
// per minute and sit far above any human login flow (one login = one
// challenge + one verify), so they only bite scripts. Kept generous rather
// than tight — locking a real user out of their own money is the worse failure.
const AUTH_RATE_LIMIT = { max: 30, timeWindow: '1 minute' };
// Refresh is the one an ordinary session hits repeatedly (every access-token
// expiry, across tabs), and a shared IP multiplies that.
const REFRESH_RATE_LIMIT = { max: 60, timeWindow: '1 minute' };

export async function authRoutes(app) {
  app.post('/v1/auth/challenge', {
    config: { rateLimit: AUTH_RATE_LIMIT },
  }, async (request) => {
    const walletAddress = assertWalletAddress(request.body?.walletAddress);
    return createChallenge(walletAddress);
  });

  app.post('/v1/auth/verify', {
    config: { rateLimit: AUTH_RATE_LIMIT },
  }, async (request) => {
    const walletAddress = assertWalletAddress(request.body?.walletAddress);
    const challengeId = request.body?.challengeId;
    const signature = assertSignature(request.body?.signature);

    if (!challengeId || typeof challengeId !== 'string') {
      throw badRequest('challengeId is required', 'MISSING_CHALLENGE_ID');
    }

    const challenge = await consumeChallenge(challengeId, walletAddress);
    if (!challenge) {
      throw unauthorized('Invalid or expired challenge', 'INVALID_CHALLENGE');
    }

    let signatureIsValid = false;
    try {
      signatureIsValid = verifySolanaChallengeSignature({
        walletAddress,
        message: challenge.message,
        signature,
      });
    } catch (error) {
      throw badRequest(error.message, 'INVALID_SIGNATURE_FORMAT');
    }

    if (!signatureIsValid) {
      throw unauthorized('Signature verification failed', 'INVALID_SIGNATURE');
    }

    return buildSession(walletAddress);
  });

  // Privy-session flow: skip the signMessage challenge entirely.
  // Frontend sends the Privy access token from getAccessToken() plus the
  // claimed walletAddress. We verify the token via Privy's server-auth
  // SDK and cross-check that the wallet is linked to that Privy user.
  // The user already signed the Privy SIWS prompt, so this avoids a
  // second redundant signature request.
  app.post('/v1/auth/privy-session', {
    config: { rateLimit: AUTH_RATE_LIMIT },
  }, async (request) => {
    if (!hasPrivyAuthConfig()) {
      throw unauthorized(
        'Privy session login is not configured on this backend.',
        'PRIVY_NOT_CONFIGURED',
      );
    }

    const privyAccessToken = request.body?.privyAccessToken;
    const walletAddress = assertWalletAddress(request.body?.walletAddress);
    if (typeof privyAccessToken !== 'string' || privyAccessToken.length === 0) {
      throw badRequest('privyAccessToken is required', 'MISSING_PRIVY_TOKEN');
    }

    let verified;
    try {
      verified = await verifyPrivySessionForWallet(privyAccessToken, walletAddress);
    } catch (error) {
      throw unauthorized(
        error instanceof Error ? error.message : 'Privy verification failed.',
        'INVALID_PRIVY_SESSION',
      );
    }

    return buildSession(verified.walletAddress);
  });

  app.post('/v1/auth/refresh', {
    config: { rateLimit: REFRESH_RATE_LIMIT },
  }, async (request) => {
    const refreshToken = request.body?.refreshToken;
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw badRequest('refreshToken is required', 'MISSING_REFRESH_TOKEN');
    }

    const decoded = await verifyToken(refreshToken, 'refresh');
    if (!decoded.tokenId) {
      throw unauthorized('Refresh token is missing a session id', 'INVALID_TOKEN_PAYLOAD');
    }

    const nextRefreshExpiresAt = getRefreshTokenExpiryDate();
    const nextRefreshTokenId = randomUUID();
    const rotated = await rotateRefreshSession(
      decoded.walletAddress,
      decoded.tokenId,
      nextRefreshTokenId,
      nextRefreshExpiresAt,
    );

    if (!rotated) {
      throw unauthorized('Refresh token has been used or revoked', 'REFRESH_TOKEN_REUSED');
    }

    const accessExpiresAt = getAccessTokenExpiryDate();
    const accessToken = await signAccessToken(decoded.walletAddress, accessExpiresAt);
    const nextRefreshToken = await signRefreshToken(
      decoded.walletAddress,
      nextRefreshTokenId,
      nextRefreshExpiresAt,
    );

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      expiresAt: accessExpiresAt.toISOString(),
    };
  });
}
