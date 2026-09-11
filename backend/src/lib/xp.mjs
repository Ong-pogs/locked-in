// Shared XP primitives, extracted from modules/progress/repository.mjs so the
// arena can award XP without importing 5k lines of the money path.
//
// Idempotency is NOT the SELECT fast-path inside awardXp — it is the ON
// CONFLICT, backed by the partial unique index added in
// sql/0044_xp_events_unique.sql. Do not "simplify" that away.

export const XP_LEVEL_THRESHOLDS = [0, 500, 1500, 3500, 7000, 12000, 20000];

export function xpToLevel(xpTotal) {
  for (let i = XP_LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xpTotal >= XP_LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

export async function ensureUserXp(client, walletAddress) {
  await client.query(
    `INSERT INTO lesson.user_xp (wallet_address) VALUES ($1) ON CONFLICT DO NOTHING`,
    [walletAddress],
  );
  const result = await client.query(
    `SELECT xp_total as "xpTotal", xp_level as "xpLevel" FROM lesson.user_xp WHERE wallet_address = $1`,
    [walletAddress],
  );
  return result.rows[0];
}

export async function awardXp(client, walletAddress, amount, source, sourceId = null) {
  if (amount <= 0) return null;

  // Fast-path: skip if this exact event was already recorded. NOT the
  // correctness mechanism — the ON CONFLICT below (backed by 0044's partial
  // unique index) is what makes concurrent double-submits award once.
  if (sourceId) {
    const existing = await client.query(
      `SELECT 1 FROM lesson.user_xp_events WHERE wallet_address = $1 AND source = $2 AND source_id = $3 LIMIT 1`,
      [walletAddress, source, sourceId],
    );
    if (existing.rowCount > 0) return null;
  }

  const inserted = await client.query(
    `INSERT INTO lesson.user_xp_events (wallet_address, xp_amount, source, source_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (wallet_address, source, source_id) WHERE source_id IS NOT NULL
     DO NOTHING`,
    [walletAddress, amount, source, sourceId],
  );
  if (inserted.rowCount === 0) return null;

  const result = await client.query(
    `UPDATE lesson.user_xp SET xp_total = xp_total + $2, xp_level = $3, updated_at = now()
     WHERE wallet_address = $1
     RETURNING xp_total as "xpTotal", xp_level as "xpLevel"`,
    [walletAddress, amount, xpToLevel(0)], // level recalculated below
  );

  if (result.rowCount > 0) {
    const newTotal = result.rows[0].xpTotal;
    const newLevel = xpToLevel(newTotal);
    await client.query(
      `UPDATE lesson.user_xp SET xp_level = $2 WHERE wallet_address = $1`,
      [walletAddress, newLevel],
    );
    return { xpTotal: newTotal, xpLevel: newLevel, xpAwarded: amount };
  }
  return null;
}
