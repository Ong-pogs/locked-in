# Wallet Connection Design

## Summary

Replace the mocked wallet connection with real Solana Mobile Wallet Adapter (MWA) on Android/iOS. Web stays mocked for now. Devnet cluster.

## Stack

- `@solana-mobile/mobile-wallet-adapter-protocol-web3js` (already installed)
- `@solana/web3.js` v1 (already installed)
- MWA `transact()` API for connect/disconnect/reauthorize

## Architecture

```
WalletConnectScreen
  └─ onPress → walletService.connect()
       └─ MWA transact() → opens Phantom/Solflare
            └─ user approves → returns publicKey + authToken
                 └─ userStore.setWallet(publicKey)
                      └─ AppNavigator switches to onboarding phase
```

## New Files

- `src/services/solana/connection.ts` — shared devnet Connection instance
- `src/services/solana/walletService.ts` — thin wrapper around MWA transact() for connect, disconnect, session reuse

## Modified Files

- `WalletConnectScreen.tsx` — replace mock setWallet with walletService.connect()
- `userStore.ts` — add authToken field for MWA session persistence

## Flows

### Connect
1. User taps "Connect Wallet"
2. walletService.connect() calls MWA transact() → opens wallet app
3. User approves → returns publicKey (base58) + authToken
4. Store both in userStore (persisted via AsyncStorage)
5. Navigation transitions to onboarding phase

### Auto-Reconnect
1. App launches, userStore loads persisted authToken
2. walletService.reconnect(authToken) calls transact() with reauthorize()
3. Valid → user stays logged in silently
4. Expired → clear state, show connect screen

### Disconnect
1. User triggers disconnect
2. walletService.disconnect() calls transact() with deauthorize()
3. Clear userStore → navigation returns to auth screen

## Platform Handling

- **Android/iOS**: Real MWA flow
- **Web**: Mock wallet (Platform.OS check skips MWA)

## Error Handling

- No wallet installed → "Install Phantom" prompt with store link
- User rejects → toast message, stay on connect screen
- Network error → retry option
- Auth token expired → silently clear, show connect screen

## Cluster

Devnet (`https://api.devnet.solana.com`). Configurable via constant for future mainnet switch.
