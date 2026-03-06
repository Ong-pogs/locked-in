import { hasRemoteLessonApi } from '../config';
import { createAuthChallenge, verifyAuthChallenge } from './authApi';
import type { AuthSession } from '../types';

type SignChallengeMessage = (message: string) => Promise<string>;

/**
 * Exchange signed challenge for backend session tokens.
 */
export async function issueBackendAccessToken(
  walletAddress: string,
  signChallengeMessage: SignChallengeMessage,
): Promise<string | null> {
  const session = await issueBackendSession(walletAddress, signChallengeMessage);
  return session?.accessToken ?? null;
}

/**
 * Exchange signed challenge for backend session tokens.
 */
export async function issueBackendSession(
  walletAddress: string,
  signChallengeMessage: SignChallengeMessage,
): Promise<AuthSession | null> {
  if (!hasRemoteLessonApi() || !walletAddress || !signChallengeMessage) {
    return null;
  }

  const challenge = await createAuthChallenge({ walletAddress });
  const signature = await signChallengeMessage(challenge.message);

  return verifyAuthChallenge({
    walletAddress,
    challengeId: challenge.challengeId,
    signature,
  });
}
