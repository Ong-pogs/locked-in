import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { VillageTour } from '@/app/village/VillageTour';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

describe('VillageTour', () => {
  it('describes the mainnet position without promising principal or yield', () => {
    render(<VillageTour bounds={{}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText(/may earn variable yield through Kamino/i)).toBeInTheDocument();
    expect(screen.getByText(/remains exposed to smart-contract, USDC, and Solana risks/i))
      .toBeInTheDocument();
    expect(screen.queryByText(/principal plus all the yield back/i)).not.toBeInTheDocument();
  });
});
