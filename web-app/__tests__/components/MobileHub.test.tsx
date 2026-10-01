import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileHub } from '@/app/village/MobileHub';

const authState = vi.hoisted(() => ({ isAuthenticated: false }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@privy-io/react-auth', () => ({
  useLogin: () => ({ login: vi.fn() }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: authState.isAuthenticated,
    ensureFreshSession: vi.fn(),
    markFreshLogin: vi.fn(),
  }),
}));

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));

describe('MobileHub', () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
  });

  it('leaves the page-level heading to the village route', () => {
    render(<MobileHub />);

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Stop collecting courses. Finish one.' }),
    ).toBeInTheDocument();
  });

  it('does not add a competing level-one heading after sign-in', () => {
    authState.isAuthenticated = true;
    render(<MobileHub />);

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText('The Village')).toBeInTheDocument();
  });
});
