import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from './storage';
import type { ResurfaceReceipt } from '@/types';

interface ResurfaceStore {
  receipts: ResurfaceReceipt[];
  addReceipt: (receipt: ResurfaceReceipt) => void;
  hydrateReceipts: (receipts: ResurfaceReceipt[]) => void;
}

export const useResurfaceStore = create<ResurfaceStore>()(
  persist(
    (set) => ({
      receipts: [],

      addReceipt: (receipt) =>
        set((state) => {
          const nextReceipts = [
            receipt,
            ...state.receipts.filter((entry) => entry.id !== receipt.id),
          ];
          return {
            receipts: nextReceipts.slice(0, 50),
          };
        }),

      hydrateReceipts: (receipts) =>
        set((state) => {
          const merged = [
            ...receipts,
            ...state.receipts.filter(
              (existing) => !receipts.some((incoming) => incoming.id === existing.id),
            ),
          ];
          return {
            receipts: merged.slice(0, 50),
          };
        }),
    }),
    {
      name: 'locked-in-resurface-receipts',
      storage: createJSONStorage(() => asyncStorageAdapter),
    },
  ),
);
