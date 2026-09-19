import { describe, expect, it } from 'vitest';
import { findProhibitedPublicClaims } from '../../scripts/check-public-copy.mjs';

describe('public copy policy', () => {
  it.each([
    ['guaranteed', '<p>Your return is guaranteed.</p>'],
    ['risk free', '<p>This is risk-free.</p>'],
    ['every cent back', '<p>Get every cent back.</p>'],
    ['learn-to-earn', '<p>Learn to earn.</p>'],
  ])('detects %s in rendered literals', (claim, source) => {
    expect(findProhibitedPublicClaims(`export const Page = () => (${source});`)).toEqual([
      expect.objectContaining({ claim }),
    ]);
  });

  it('ignores developer comments because they are not rendered copy', () => {
    expect(findProhibitedPublicClaims('// This would be guaranteed if the guard were removed.'))
      .toEqual([]);
  });
});
