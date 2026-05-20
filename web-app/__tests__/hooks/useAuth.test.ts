import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { setupPrivyMock, mockPrivy, mockWallets, mockSignMessage, resetPrivyMock } from '../mocks/privy';
import { useUserStore } from '@/stores/userStore';
import { useCourseStore } from '@/stores/courseStore';

// Setup mocks BEFORE importing the hook
setupPrivyMock();

vi.mock('@/services/api/auth/authApi', () => ({
  createAuthChallenge: vi.fn(),
  verifyAuthChallenge: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  getCourseRuntime: vi.fn(),
  hasRemoteLessonApi: vi.fn(() => false),
}));

vi.mock('@/services/api/progress/progressApi', () => ({
  convertFuel: vi.fn(),
}));

vi.mock('@/services/solana', () => ({
  batchCheckLockAccounts: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('@/services/repositories', () => ({
  loadHydratedContentSnapshot: vi.fn(),
}));

// Import after mocks are set up
import { useAuth } from '@/hooks/useAuth';
import { createAuthChallenge, verifyAuthChallenge } from '@/services/api/auth/authApi';

describe('useAuth', () => {
  beforeEach(() => {
    resetPrivyMock();
    useUserStore.setState({
      walletAddress: null,
      walletAuthToken: null,
      displayName: null,
      avatarUrl: null,
      onboardingPhase: 'auth',
      createdAt: null,
      tutorialCompleted: false,
      authToken: null,
      refreshToken: null,
    });
    useCourseStore.getState().reset();
    vi.mocked(createAuthChallenge).mockReset();
    vi.mocked(verifyAuthChallenge).mockReset();
  });

  it('returns isReady: false when Privy not ready', () => {
    mockPrivy.ready = false;
    mockWallets.ready = false;

    const { result } = renderHook(() => useAuth());
    expect(result.current.isReady).toBe(false);
  });

  it('returns isReady: true when Privy and wallets are ready', () => {
    mockPrivy.ready = true;
    mockWallets.ready = true;

    const { result } = renderHook(() => useAuth());
    expect(result.current.isReady).toBe(true);
  });

  it('returns isAuthenticated: true when store has valid token', () => {
    mockPrivy.ready = true;
    mockWallets.ready = true;
    useUserStore.setState({ authToken: 'valid-token' });

    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('returns isAuthenticated: false when no token', () => {
    mockPrivy.ready = true;
    mockWallets.ready = true;
    useUserStore.setState({ authToken: null });

    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('returns isConnected: false when not privy-authenticated', () => {
    mockPrivy.authenticated = false;
    mockWallets.wallets = [];

    const { result } = renderHook(() => useAuth());
    expect(result.current.isConnected).toBe(false);
  });

  it('authenticate calls challenge -> sign -> verify flow', async () => {
    mockPrivy.ready = true;
    mockPrivy.authenticated = true;
    mockWallets.ready = true;
    mockWallets.wallets = [
      {
        address: 'TestWallet123',
        walletClientType: 'phantom',
        connectorType: 'injected',
        // Mocked as external wallet (no isPrivyWallet flag)
        standardWallet: {},
      } as unknown,
    ] as typeof mockWallets.wallets;

    vi.mocked(createAuthChallenge).mockResolvedValueOnce({
      challengeId: 'challenge-1',
      message: 'Sign this message to authenticate',
      expiresAt: '2024-01-01T00:10:00Z',
    });

    mockSignMessage.signMessage.mockResolvedValueOnce({
      signature: new Uint8Array([1, 2, 3, 4]),
    });

    vi.mocked(verifyAuthChallenge).mockResolvedValueOnce({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: '2024-01-01T01:00:00Z',
    });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.authenticate();
    });

    expect(createAuthChallenge).toHaveBeenCalledWith({ walletAddress: 'TestWallet123' });
    expect(mockSignMessage.signMessage).toHaveBeenCalled();
    expect(verifyAuthChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: 'TestWallet123',
        challengeId: 'challenge-1',
      }),
    );

    // Store should have the new auth token
    expect(useUserStore.getState().authToken).toBe('new-access-token');
    expect(useUserStore.getState().refreshToken).toBe('new-refresh-token');
    expect(useUserStore.getState().walletAddress).toBe('TestWallet123');
  });

  it('disconnect clears Privy + stores + cookie', async () => {
    mockPrivy.authenticated = true;
    mockPrivy.ready = true;
    mockWallets.ready = true;
    useUserStore.setState({
      walletAddress: 'Wallet123',
      authToken: 'token',
      refreshToken: 'refresh',
    });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.disconnect();
    });

    expect(mockPrivy.logout).toHaveBeenCalled();
    expect(useUserStore.getState().walletAddress).toBeNull();
    expect(useUserStore.getState().authToken).toBeNull();
  });

  it('authenticate sets authError on failure', async () => {
    mockPrivy.ready = true;
    mockPrivy.authenticated = true;
    mockWallets.ready = true;
    mockWallets.wallets = [
      {
        address: 'TestWallet123',
        walletClientType: 'phantom',
        connectorType: 'injected',
        standardWallet: {},
      } as unknown,
    ] as typeof mockWallets.wallets;

    vi.mocked(createAuthChallenge).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.authenticate();
    });

    expect(result.current.authError).toBe('Network error');
  });

  it('loginMethod returns google when google user', () => {
    mockPrivy.ready = true;
    mockPrivy.authenticated = true;
    mockPrivy.user = { google: { email: 'test@gmail.com' } };
    mockWallets.ready = true;

    const { result } = renderHook(() => useAuth());
    expect(result.current.loginMethod).toBe('google');
  });

  it('loginMethod returns wallet when not google', () => {
    mockPrivy.ready = true;
    mockPrivy.authenticated = true;
    mockPrivy.user = { wallet: { address: 'Wallet123' } };
    mockWallets.ready = true;

    const { result } = renderHook(() => useAuth());
    expect(result.current.loginMethod).toBe('wallet');
  });
});
