import { describe, it, expect, beforeEach } from 'vitest';
import {
  writeFundingBreadcrumb,
  readFundingBreadcrumb,
  clearFundingBreadcrumb,
  FUNDING_BREADCRUMB_KEY,
} from '@/services/onramp/fundingBreadcrumb';

describe('fundingBreadcrumb', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a fresh breadcrumb', () => {
    writeFundingBreadcrumb({ address: 'Abc', amountUsdc: 12 });
    expect(readFundingBreadcrumb()).toMatchObject({ address: 'Abc', amountUsdc: 12 });
  });

  it('expires after 30 minutes', () => {
    localStorage.setItem(
      FUNDING_BREADCRUMB_KEY,
      JSON.stringify({
        address: 'Abc',
        amountUsdc: 12,
        initiatedAt: new Date(Date.now() - 31 * 60_000).toISOString(),
      }),
    );
    expect(readFundingBreadcrumb()).toBeNull();
  });

  it('survives just under the TTL', () => {
    localStorage.setItem(
      FUNDING_BREADCRUMB_KEY,
      JSON.stringify({
        address: 'Abc',
        amountUsdc: 12,
        initiatedAt: new Date(Date.now() - 29 * 60_000).toISOString(),
      }),
    );
    expect(readFundingBreadcrumb()).not.toBeNull();
  });

  it('clears', () => {
    writeFundingBreadcrumb({ address: 'Abc', amountUsdc: 12 });
    clearFundingBreadcrumb();
    expect(readFundingBreadcrumb()).toBeNull();
  });

  it('returns null on corrupted JSON', () => {
    localStorage.setItem(FUNDING_BREADCRUMB_KEY, '{nope');
    expect(readFundingBreadcrumb()).toBeNull();
  });

  it('returns null on shape mismatch', () => {
    localStorage.setItem(FUNDING_BREADCRUMB_KEY, JSON.stringify({ address: 'Abc' }));
    expect(readFundingBreadcrumb()).toBeNull();
  });
});
