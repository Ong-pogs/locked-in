import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MobileHub } from '@/app/village/MobileHub';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@privy-io/react-auth', () => ({
  useLogin: () => ({ login: vi.fn() }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    ensureFreshSession: vi.fn(),
    markFreshLogin: vi.fn(),
  }),
}));

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));

describe('MobileHub', () => {
  it('uses the Founding 100 promise as the only level-one heading', () => {
    render(<MobileHub />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Stop collecting courses. Finish one.' }),
    ).toBeInTheDocument();
  });
});
