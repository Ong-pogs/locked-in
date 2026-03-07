export interface ResurfaceReceipt {
  id: string;
  walletAddress: string;
  courseId: string;
  courseTitle: string;
  lockAccountAddress: string;
  principalAmountUi: string;
  skrLockedAmountUi: string;
  unlockedAt: string;
  unlockTxSignature: string;
  lockEndDate: string;
  verifiedBlockTime?: string | null;
  source?: 'local' | 'backend';
}
