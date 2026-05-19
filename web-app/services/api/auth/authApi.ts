import { httpRequest } from '../httpClient';
import type {
  AuthChallengeRequest,
  AuthChallengeResponse,
  AuthRefreshRequest,
  AuthSession,
  AuthVerifyRequest,
} from '../types';

export function createAuthChallenge(
  payload: AuthChallengeRequest,
): Promise<AuthChallengeResponse> {
  return httpRequest<AuthChallengeResponse>('/v1/auth/challenge', {
    method: 'POST',
    body: payload,
  });
}

export function verifyAuthChallenge(payload: AuthVerifyRequest): Promise<AuthSession> {
  return httpRequest<AuthSession>('/v1/auth/verify', {
    method: 'POST',
    body: payload,
  });
}

export function refreshAuthSession(payload: AuthRefreshRequest): Promise<AuthSession> {
  return httpRequest<AuthSession>('/v1/auth/refresh', {
    method: 'POST',
    body: payload,
  });
}

/**
 * Exchange a Privy access token for our own JWT, skipping the
 * signMessage challenge. The user already signed the Privy SIWS prompt,
 * so this avoids a second redundant signature request.
 */
export function verifyPrivySession(payload: {
  privyAccessToken: string;
  walletAddress: string;
}): Promise<AuthSession> {
  return httpRequest<AuthSession>('/v1/auth/privy-session', {
    method: 'POST',
    body: payload,
  });
}
