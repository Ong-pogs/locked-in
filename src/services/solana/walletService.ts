// src/services/solana/walletService.ts
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { PublicKey } from '@solana/web3.js';
import { toByteArray } from 'base64-js';

// App identity shown in wallet approval prompt
const APP_IDENTITY = {
  name: 'Locked In',
};

// MWA chain identifier for devnet
const CHAIN = 'solana:devnet';

const MWA_UNAVAILABLE_CODE = 'ERROR_WALLET_ADAPTER_UNAVAILABLE';
const MWA_UNAVAILABLE_MESSAGE =
  'Mobile Wallet Adapter is unavailable in this build. Use an Android custom dev build with native Solana MWA support.';
const MWA_SIGNING_CODE = 'ERROR_WALLET_MESSAGE_SIGNING_UNAVAILABLE';
const MWA_SIGNING_MESSAGE =
  'Message signing is unavailable in this runtime. Connect a compatible wallet to continue.';
const ED25519_SIGNATURE_LENGTH = 64;

export interface WalletSession {
  /** Base58-encoded public key */
  publicKey: string;
  /** MWA auth token for session reuse */
  authToken: string;
  /** Wallet label (e.g. "Phantom") */
  walletLabel?: string;
}

function createMWAUnavailableError(cause?: unknown): Error & { code: string } {
  const error = new Error(MWA_UNAVAILABLE_MESSAGE) as Error & {
    code: string;
    cause?: unknown;
  };
  error.name = 'WalletServiceError';
  error.code = MWA_UNAVAILABLE_CODE;
  error.cause = cause;
  return error;
}

function createSigningUnavailableError(cause?: unknown): Error & { code: string } {
  const error = new Error(MWA_SIGNING_MESSAGE) as Error & {
    code: string;
    cause?: unknown;
  };
  error.name = 'WalletServiceError';
  error.code = MWA_SIGNING_CODE;
  error.cause = cause;
  return error;
}

function hasNativeMWAModule(): boolean {
  const turboRegistry = TurboModuleRegistry as {
    get?: (name: string) => unknown;
  };
  return Boolean(
    turboRegistry.get?.('SolanaMobileWalletAdapter') ||
      (NativeModules as Record<string, unknown>).SolanaMobileWalletAdapter,
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function normalizeBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }

  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    Array.isArray((value as { data: unknown }).data)
  ) {
    return Uint8Array.from((value as { data: number[] }).data);
  }

  throw createSigningUnavailableError('Unsupported signature byte format.');
}

function extractDetachedSignature(
  messageBytes: Uint8Array,
  signedPayload: Uint8Array,
): Uint8Array {
  if (signedPayload.length === ED25519_SIGNATURE_LENGTH) {
    return signedPayload;
  }

  if (signedPayload.length !== messageBytes.length + ED25519_SIGNATURE_LENGTH) {
    throw createSigningUnavailableError('Unexpected signed payload length.');
  }

  const messagePrefix = signedPayload.slice(0, messageBytes.length);
  if (bytesEqual(messagePrefix, messageBytes)) {
    return signedPayload.slice(messageBytes.length);
  }

  const messageSuffix = signedPayload.slice(ED25519_SIGNATURE_LENGTH);
  if (bytesEqual(messageSuffix, messageBytes)) {
    return signedPayload.slice(0, ED25519_SIGNATURE_LENGTH);
  }

  throw createSigningUnavailableError('Signed payload does not match challenge.');
}

async function loadTransact() {
  // MWA native module is required and currently available only on Android native builds.
  if (Platform.OS !== 'android' || !hasNativeMWAModule()) {
    throw createMWAUnavailableError();
  }

  try {
    const module = await import(
      '@solana-mobile/mobile-wallet-adapter-protocol-web3js'
    );
    if (typeof module.transact !== 'function') {
      throw createMWAUnavailableError();
    }
    return module.transact;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('SolanaMobileWalletAdapter') ||
      message.includes('TurboModuleRegistry.getEnforcing')
    ) {
      throw createMWAUnavailableError(error);
    }
    throw error;
  }
}

async function signWithWebWallet(
  walletAddress: string,
  message: string,
): Promise<Uint8Array> {
  const provider = (globalThis as any)?.solana;
  if (!provider) {
    throw createSigningUnavailableError('No injected web wallet provider.');
  }

  if (!provider.publicKey && typeof provider.connect === 'function') {
    try {
      await provider.connect({ onlyIfTrusted: true });
    } catch {
      await provider.connect();
    }
  }

  const connectedAddress = provider.publicKey?.toBase58?.();
  if (!connectedAddress || connectedAddress !== walletAddress) {
    throw createSigningUnavailableError(
      'Injected wallet does not match connected address.',
    );
  }

  if (typeof provider.signMessage !== 'function') {
    throw createSigningUnavailableError('Wallet does not expose signMessage().');
  }

  const messageBytes = new TextEncoder().encode(message);
  const result = await provider.signMessage(messageBytes, 'utf8');
  const signatureBytes = normalizeBytes((result as any)?.signature ?? result);

  if (signatureBytes.length !== ED25519_SIGNATURE_LENGTH) {
    throw createSigningUnavailableError('Wallet returned invalid signature length.');
  }

  return signatureBytes;
}

/**
 * Connect to a wallet via MWA. Opens the user's wallet app for approval.
 */
export async function connectWallet(): Promise<WalletSession> {
  if (Platform.OS === 'web') {
    return { publicKey: 'MOCK_WALLET_ADDRESS', authToken: 'mock' };
  }

  const transact = await loadTransact();

  const result = await transact(async (wallet) => {
    const auth = await wallet.authorize({
      identity: APP_IDENTITY,
      chain: CHAIN,
    });

    const firstAccount = auth.accounts[0];
    const addressBytes = toByteArray(firstAccount.address);
    const publicKey = new PublicKey(addressBytes).toBase58();

    return {
      publicKey,
      authToken: auth.auth_token,
      walletLabel: firstAccount.label,
    };
  });

  return result;
}

/**
 * Reconnect using a cached auth token. Silent — no wallet app popup if token is still valid.
 */
export async function reconnectWallet(authToken: string): Promise<WalletSession> {
  if (Platform.OS === 'web') {
    return { publicKey: 'MOCK_WALLET_ADDRESS', authToken: 'mock' };
  }

  const transact = await loadTransact();

  const result = await transact(async (wallet) => {
    const auth = await wallet.reauthorize({
      auth_token: authToken,
      identity: APP_IDENTITY,
    });

    const firstAccount = auth.accounts[0];
    const addressBytes = toByteArray(firstAccount.address);
    const publicKey = new PublicKey(addressBytes).toBase58();

    return {
      publicKey,
      authToken: auth.auth_token,
      walletLabel: firstAccount.label,
    };
  });

  return result;
}

/**
 * Disconnect — deauthorizes the session in the wallet app.
 */
export async function disconnectWallet(authToken: string): Promise<void> {
  if (Platform.OS === 'web' || !authToken || authToken === 'mock') return;

  const transact = await loadTransact();

  await transact(async (wallet) => {
    await wallet.deauthorize({ auth_token: authToken });
  });
}

/**
 * Sign auth challenge message and return detached Ed25519 signature bytes.
 */
export async function signAuthChallengeMessage(
  walletAddress: string,
  message: string,
  walletAuthToken?: string | null,
): Promise<Uint8Array> {
  if (!walletAddress || !message) {
    throw createSigningUnavailableError('walletAddress and message are required.');
  }

  if (Platform.OS === 'web') {
    return signWithWebWallet(walletAddress, message);
  }

  const transact = await loadTransact();
  const messageBytes = new TextEncoder().encode(message);

  const signedPayload = await transact(async (wallet) => {
    const authorization = walletAuthToken
      ? await wallet.reauthorize({
          auth_token: walletAuthToken,
          identity: APP_IDENTITY,
        })
      : await wallet.authorize({
          identity: APP_IDENTITY,
          chain: CHAIN,
        });

    const matchingAccount = authorization.accounts.find((account) => {
      const addressBytes = toByteArray(account.address);
      return new PublicKey(addressBytes).toBase58() === walletAddress;
    });

    if (!matchingAccount) {
      throw createSigningUnavailableError(
        'Connected wallet account not found in authorization session.',
      );
    }

    const signedPayloads = await wallet.signMessages({
      addresses: [matchingAccount.address],
      payloads: [messageBytes],
    });

    if (!signedPayloads[0]) {
      throw createSigningUnavailableError('Wallet did not return signed payload.');
    }

    return signedPayloads[0];
  });

  return extractDetachedSignature(messageBytes, signedPayload);
}
