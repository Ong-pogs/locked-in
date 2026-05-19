import { vi } from 'vitest';

export const mockPrivy = {
  ready: true,
  authenticated: false,
  logout: vi.fn(),
  user: null as { google?: { email: string }; wallet?: { address: string } } | null,
  // Default: null token so the new Privy-session path short-circuits and
  // the legacy signMessage flow runs (which the existing tests assert on).
  // Individual tests can override with mockResolvedValueOnce to exercise
  // the new path.
  getAccessToken: vi.fn().mockResolvedValue(null),
};

export const mockLogin = {
  login: vi.fn(),
};

export const mockWallets = {
  wallets: [] as Array<{
    address: string;
    walletClientType: string;
    connectorType: string;
  }>,
  ready: true,
};

export const mockSignMessage = {
  signMessage: vi.fn(),
};

// Top-level vi.mock calls (hoisted by Vitest)
vi.mock('@privy-io/react-auth', () => ({
  PrivyProvider: ({ children }: { children: React.ReactNode }) => children,
  usePrivy: () => mockPrivy,
  useLogin: () => mockLogin,
}));

vi.mock('@privy-io/react-auth/solana', () => ({
  useWallets: () => mockWallets,
  useSignMessage: () => mockSignMessage,
  toSolanaWalletConnectors: () => [],
}));

/** @deprecated Use top-level mock instead — mocks are auto-applied on import */
export function setupPrivyMock() {
  // No-op: mocks are now at module top-level
}

export function resetPrivyMock() {
  mockPrivy.ready = true;
  mockPrivy.authenticated = false;
  mockPrivy.logout.mockClear();
  mockPrivy.user = null;
  mockPrivy.getAccessToken.mockReset().mockResolvedValue(null);
  mockLogin.login.mockClear();
  mockWallets.wallets = [];
  mockWallets.ready = true;
  mockSignMessage.signMessage.mockClear();
}
