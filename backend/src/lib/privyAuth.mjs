// Server-side verification of Privy session tokens. Used by the
// /v1/auth/privy-session endpoint to skip the redundant signMessage
// challenge — instead, we trust Privy's auth (which the user already
// signed for) and cross-check the claimed wallet address against the
// linked wallets in Privy's user record.
import { PrivyClient } from '@privy-io/server-auth';
import { appConfig } from '../config.mjs';

let client = null;

function getClient() {
  if (!appConfig.privyAppId || !appConfig.privyAppSecret) {
    throw new Error(
      'Privy server auth not configured. Set PRIVY_APP_ID and PRIVY_APP_SECRET on the backend.',
    );
  }
  if (!client) {
    client = new PrivyClient(appConfig.privyAppId, appConfig.privyAppSecret);
  }
  return client;
}

export function hasPrivyAuthConfig() {
  return Boolean(appConfig.privyAppId && appConfig.privyAppSecret);
}

/**
 * Verify a Privy access token and confirm the supplied walletAddress is
 * one of the user's linked Solana wallets. Returns the verified wallet
 * address on success; throws on any failure (invalid token, expired,
 * wallet not linked).
 */
export async function verifyPrivySessionForWallet(accessToken, walletAddress) {
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('Missing Privy access token.');
  }
  if (typeof walletAddress !== 'string' || walletAddress.length === 0) {
    throw new Error('Missing walletAddress.');
  }

  const privy = getClient();

  // 1. Verify the JWT signature + expiry. Throws if invalid.
  const claims = await privy.verifyAuthToken(accessToken);
  if (!claims?.userId) {
    throw new Error('Privy token missing userId.');
  }

  // 2. Fetch the user and confirm the claimed wallet is linked to them.
  //    Privy stores linked wallets in the user's linkedAccounts array.
  const user = await privy.getUser(claims.userId);
  const solanaLinked = (user?.linkedAccounts ?? []).filter(
    (a) => a?.type === 'wallet' && a?.chainType === 'solana',
  );
  const matched = solanaLinked.find(
    (a) => typeof a.address === 'string' && a.address === walletAddress,
  );
  if (!matched) {
    throw new Error('Wallet address is not linked to this Privy user.');
  }

  return { walletAddress: matched.address, privyUserId: claims.userId };
}
