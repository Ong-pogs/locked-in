# Wallet Connection (Onboarding)

## What This Is

The entry point to the app. Users connect a Solana wallet (Phantom, Solflare, or similar) to authenticate and start their journey. No email, no password — wallet-first, crypto-native onboarding.

## Current State

Implemented with MWA `transact()` integration on native flows, with real connection currently enabled on Android native builds. Web platform uses a mock wallet for development. The flow goes: connect wallet → course selection → deposit → gauntlet. Auto-reconnect on app launch uses cached MWA auth tokens persisted in AsyncStorage. Cluster: devnet.

As of March 5, 2026, this repo only enables real MWA connection on Android native builds where the `SolanaMobileWalletAdapter` native module is present. On Expo Go or iOS runtime, wallet connect now exits early with a clear unsupported-runtime error instead of crashing.

## How It Should Work

1. User opens the app for the first time and sees the wallet connect screen.
2. They tap "Connect Wallet" which triggers the Solana Mobile Wallet Adapter protocol.
3. This opens their installed wallet app (Phantom, Solflare, etc.) for approval.
4. On approval, the app receives the user's public key (wallet address).
5. The public key becomes their identity — stored locally and used for all on-chain interactions.
6. If they've connected before, the app should auto-reconnect on launch using the cached session.

## Where Solana Fits In

- **Solana Mobile Wallet Adapter** handles the connection flow on native mobile (currently enabled for Android in this setup).
- **Wallet Standard** provides a unified interface for discovering and connecting wallets.
- The connected wallet is needed for signing deposit transactions, reading USDC balances, and interacting with the vault program. Fuel is tracked by the backend service.
- On web, the standard Solana wallet-adapter libraries handle connection via browser extension wallets.

## Key Considerations

- The wallet address is the user's identity. No separate auth system needed.
- Need to handle disconnection gracefully (clear local state, return to auth screen).
- Should support session persistence so users don't have to reconnect every app open.
- Expo Go and iOS runtime do not include the Android-only native MWA module in this setup. Use a custom Android dev build for real wallet flows.
- Consider a "seedless wallet" option in the future for non-crypto-native users who don't have a wallet yet.
- Error handling for: no wallet installed, user rejects connection, network issues.

## Related Files

- `src/screens/auth/WalletConnectScreen.tsx` — connect screen with MWA integration and error handling
- `src/stores/userStore.ts` — stores wallet address, auth token, and onboarding phase
- `src/services/solana/walletService.ts` — MWA wrapper: connectWallet, reconnectWallet, disconnectWallet
- `src/services/solana/connection.ts` — shared devnet Connection instance
- `src/services/solana/index.ts` — barrel exports
- `App.tsx` — auto-reconnect hook on app launch
- `src/components/wallet/` — empty, for future wallet UI components
