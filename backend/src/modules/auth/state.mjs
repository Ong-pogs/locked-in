import { randomUUID } from 'node:crypto';
import { hasDatabase, query, withTransaction } from '../../lib/db.mjs';

const challenges = new Map();
const refreshSessions = new Map();

function buildChallengeMessage(walletAddress, challengeId, nonce) {
  return [
    'Locked In authentication',
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Challenge: ${challengeId}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join('\n');
}

export async function createChallenge(walletAddress) {
  const challengeId = randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const nonce = randomUUID();
  const message = buildChallengeMessage(walletAddress, challengeId, nonce);

  if (hasDatabase()) {
    await query(
      `
        insert into lesson_auth.wallet_challenges (
          id,
          wallet_address,
          message,
          expires_at
        )
        values ($1::uuid, $2, $3, $4::timestamptz)
      `,
      [challengeId, walletAddress, message, expiresAt.toISOString()],
    );
  } else {
    challenges.set(challengeId, {
      walletAddress,
      message,
      expiresAt,
      consumed: false,
    });
  }

  return {
    challengeId,
    message,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function consumeChallenge(challengeId, walletAddress) {
  if (hasDatabase()) {
    return withTransaction(async (client) => {
      const result = await client.query(
        `
          update lesson_auth.wallet_challenges
          set consumed_at = now()
          where id = $1::uuid
            and wallet_address = $2
            and consumed_at is null
            and expires_at > now()
          returning message, expires_at as "expiresAt"
        `,
        [challengeId, walletAddress],
      );

      return result.rows[0] ?? null;
    });
  }

  const challenge = challenges.get(challengeId);
  if (!challenge) return null;

  if (challenge.walletAddress !== walletAddress) return null;
  if (challenge.consumed) return null;
  if (new Date() > challenge.expiresAt) return null;

  challenge.consumed = true;
  challenges.set(challengeId, challenge);

  return challenge;
}

export async function issueRefreshSession(walletAddress, tokenId, expiresAt) {
  if (hasDatabase()) {
    await query(
      `
        insert into lesson_auth.refresh_sessions (
          token_id,
          wallet_address,
          expires_at
        )
        values ($1::uuid, $2, $3::timestamptz)
      `,
      [tokenId, walletAddress, expiresAt.toISOString()],
    );
    return;
  }

  refreshSessions.set(tokenId, {
    walletAddress,
    expiresAt,
    consumedAt: null,
    revokedAt: null,
    replacedBy: null,
  });
}

export async function rotateRefreshSession(
  walletAddress,
  currentTokenId,
  nextTokenId,
  nextExpiresAt,
) {
  if (hasDatabase()) {
    return withTransaction(async (client) => {
      const result = await client.query(
        `
          update lesson_auth.refresh_sessions
          set consumed_at = now(),
              replaced_by = $3::uuid
          where token_id = $1::uuid
            and wallet_address = $2
            and revoked_at is null
            and consumed_at is null
            and expires_at > now()
          returning token_id
        `,
        [currentTokenId, walletAddress, nextTokenId],
      );

      if (result.rowCount === 0) {
        return false;
      }

      await client.query(
        `
          insert into lesson_auth.refresh_sessions (
            token_id,
            wallet_address,
            expires_at
          )
          values ($1::uuid, $2, $3::timestamptz)
        `,
        [nextTokenId, walletAddress, nextExpiresAt.toISOString()],
      );

      return true;
    });
  }

  const existing = refreshSessions.get(currentTokenId);
  if (!existing) return false;
  if (existing.walletAddress !== walletAddress) return false;
  if (existing.revokedAt || existing.consumedAt || existing.expiresAt <= new Date()) {
    return false;
  }

  existing.consumedAt = new Date();
  existing.replacedBy = nextTokenId;
  refreshSessions.set(currentTokenId, existing);
  refreshSessions.set(nextTokenId, {
    walletAddress,
    expiresAt: nextExpiresAt,
    consumedAt: null,
    revokedAt: null,
    replacedBy: null,
  });
  return true;
}
