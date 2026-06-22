import { describe, it, expect, beforeEach } from 'vitest';
import { useResurfaceStore } from '@/stores/resurfaceStore';
import type { ResurfaceReceipt } from '@/types';

function buildReceipt(overrides?: Partial<ResurfaceReceipt>): ResurfaceReceipt {
  return {
    id: 'receipt-1',
    walletAddress: 'Wallet123',
    courseId: 'course-1',
    courseTitle: 'Solana 101',
    lockAccountAddress: 'Lock123',
    principalAmountUi: '100',
    unlockedAt: '2024-06-01T00:00:00Z',
    unlockTxSignature: 'TxSig123',
    lockEndDate: '2024-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('resurfaceStore', () => {
  beforeEach(() => {
    useResurfaceStore.setState({ receipts: [] });
  });

  describe('addReceipt', () => {
    it('adds a receipt to the list', () => {
      const receipt = buildReceipt();
      useResurfaceStore.getState().addReceipt(receipt);

      expect(useResurfaceStore.getState().receipts).toHaveLength(1);
      expect(useResurfaceStore.getState().receipts[0].id).toBe('receipt-1');
    });

    it('deduplicates - adding same id replaces existing', () => {
      const receipt1 = buildReceipt({ id: 'receipt-1', principalAmountUi: '100' });
      const receipt2 = buildReceipt({ id: 'receipt-1', principalAmountUi: '200' });

      useResurfaceStore.getState().addReceipt(receipt1);
      useResurfaceStore.getState().addReceipt(receipt2);

      const receipts = useResurfaceStore.getState().receipts;
      expect(receipts).toHaveLength(1);
      expect(receipts[0].principalAmountUi).toBe('200');
    });

    it('prepends new receipt at the start', () => {
      const receipt1 = buildReceipt({ id: 'receipt-1' });
      const receipt2 = buildReceipt({ id: 'receipt-2' });

      useResurfaceStore.getState().addReceipt(receipt1);
      useResurfaceStore.getState().addReceipt(receipt2);

      expect(useResurfaceStore.getState().receipts[0].id).toBe('receipt-2');
      expect(useResurfaceStore.getState().receipts[1].id).toBe('receipt-1');
    });

    it('caps at max 50 receipts', () => {
      for (let i = 0; i < 55; i++) {
        useResurfaceStore.getState().addReceipt(buildReceipt({ id: `receipt-${i}` }));
      }

      expect(useResurfaceStore.getState().receipts).toHaveLength(50);
      // Most recent should be first
      expect(useResurfaceStore.getState().receipts[0].id).toBe('receipt-54');
    });
  });

  describe('hydrateReceipts', () => {
    it('merges incoming receipts without creating duplicates', () => {
      const local = buildReceipt({ id: 'receipt-1' });
      useResurfaceStore.getState().addReceipt(local);

      const incoming = [
        buildReceipt({ id: 'receipt-1', principalAmountUi: '999' }),
        buildReceipt({ id: 'receipt-2' }),
      ];
      useResurfaceStore.getState().hydrateReceipts(incoming);

      const receipts = useResurfaceStore.getState().receipts;
      expect(receipts).toHaveLength(2);
      // Incoming takes precedence (appears first)
      const receipt1 = receipts.find((r) => r.id === 'receipt-1');
      expect(receipt1?.principalAmountUi).toBe('999');
    });

    it('preserves local receipts not in incoming', () => {
      const local = buildReceipt({ id: 'local-only' });
      useResurfaceStore.getState().addReceipt(local);

      const incoming = [buildReceipt({ id: 'remote-1' })];
      useResurfaceStore.getState().hydrateReceipts(incoming);

      const receipts = useResurfaceStore.getState().receipts;
      expect(receipts.some((r) => r.id === 'local-only')).toBe(true);
      expect(receipts.some((r) => r.id === 'remote-1')).toBe(true);
    });

    it('caps at 50 after hydration', () => {
      // Add 30 local receipts
      for (let i = 0; i < 30; i++) {
        useResurfaceStore.getState().addReceipt(buildReceipt({ id: `local-${i}` }));
      }

      // Hydrate with 30 new remote receipts
      const incoming = Array.from({ length: 30 }, (_, i) =>
        buildReceipt({ id: `remote-${i}` }),
      );
      useResurfaceStore.getState().hydrateReceipts(incoming);

      expect(useResurfaceStore.getState().receipts.length).toBeLessThanOrEqual(50);
    });
  });
});
