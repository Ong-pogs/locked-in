// GET /v1/progress/community-pot/windows/:windowId wallet privacy.
//
// Any signed-in wallet can read any window (window ids are YYYYMM, trivial to
// guess), so the recipient list must not carry other players' full addresses,
// nor their payout signatures or raw send errors (either one names the
// recipient's wallet on a block explorer). The viewer's own row keeps its
// payout details.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer } from '../../helpers/test-server.mjs';
import { generateTestWallet, getTestAuthHeaders } from '../../helpers/test-auth.mjs';
import { query } from '../../../src/lib/db.mjs';

// A window id no other suite uses, so the shared test database cannot collide.
const WINDOW_ID = 190401;
const COURSE_ID = 'test-pot-privacy';

const viewer = generateTestWallet();
const other = generateTestWallet();

async function seedRecipient(wallet, { payout, signature, lastError }) {
  await query(
    `INSERT INTO lesson.community_pot_distribution_snapshots
       (window_id, wallet_address, course_id, current_streak, principal_amount,
        weight, payout_amount, status, distribution_transaction_signature,
        distribution_last_error)
     VALUES ($1, $2, $3, 3, 1000000, 1000000, $4, 'distributed', $5, $6)`,
    [WINDOW_ID, wallet, COURSE_ID, payout, signature, lastError],
  );
}

let app;
beforeAll(async () => {
  app = await createTestServer();
  await query('DELETE FROM lesson.community_pot_distribution_snapshots WHERE window_id = $1', [WINDOW_ID]);
  await seedRecipient(viewer, { payout: 400, signature: 'sig-viewer', lastError: null });
  // A raw send error can quote account addresses, so it is seeded with one.
  await seedRecipient(other, { payout: 600, signature: 'sig-other', lastError: `failed for ${other}` });
});
afterAll(async () => {
  await query('DELETE FROM lesson.community_pot_distribution_snapshots WHERE window_id = $1', [WINDOW_ID]);
  await closeTestServer(app);
});

describe('community pot window detail', () => {
  it('sends no full wallet address for any recipient', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/progress/community-pot/windows/${WINDOW_ID}`,
      headers: await getTestAuthHeaders(viewer),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recipients).toHaveLength(2);
    expect(res.body).not.toContain(viewer);
    expect(res.body).not.toContain(other);
    for (const r of body.recipients) {
      expect(r).not.toHaveProperty('walletAddress');
      expect(r.displayIdentity).toMatch(/^.{4}….{4}$/);
    }
  });

  it('keeps payout signature and error only on the viewer row', async () => {
    const body = (await app.inject({
      method: 'GET',
      url: `/v1/progress/community-pot/windows/${WINDOW_ID}`,
      headers: await getTestAuthHeaders(viewer),
    })).json();
    const mine = body.recipients.find((r) => r.isCurrentUser);
    const theirs = body.recipients.find((r) => !r.isCurrentUser);
    expect(mine).toMatchObject({ transactionSignature: 'sig-viewer', payoutAmount: '400' });
    expect(theirs).toMatchObject({ transactionSignature: null, lastError: null, payoutAmount: '600' });
    expect(body.userEntry).toMatchObject({ isCurrentUser: true, transactionSignature: 'sig-viewer' });
  });

  it('shows a non-recipient no signatures at all', async () => {
    const body = (await app.inject({
      method: 'GET',
      url: `/v1/progress/community-pot/windows/${WINDOW_ID}`,
      headers: await getTestAuthHeaders(generateTestWallet()),
    })).json();
    expect(body.userEntry).toBeNull();
    expect(body.recipients.every((r) => r.transactionSignature === null)).toBe(true);
    expect(JSON.stringify(body)).not.toContain(other);
  });
});
