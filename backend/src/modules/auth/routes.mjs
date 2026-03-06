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

export async function authRoutes(app) {
  app.post('/v1/auth/challenge', async (request) => {
    const walletAddress = assertWalletAddress(request.body?.walletAddress);
    return createChallenge(walletAddress);
  });

  app.post('/v1/auth/verify', async (request) => {
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

  app.post('/v1/auth/refresh', async (request) => {
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
