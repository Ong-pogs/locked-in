# Wallet Connection and Identity (v3.0)

## Scope

Wallet connection is the only user identity layer.
No email/password auth is used for core flows.

This module must support:

- wallet session establishment
- session reuse (reauthorize)
- challenge signing for backend API auth
- transaction signing for on-chain instructions

## Supported Wallet Paths

1. Mobile native: Solana Mobile Wallet Adapter (MWA).
2. Web runtime: wallet-standard compatible injected providers.

Primary user wallets:

- Phantom
- Solflare
- compatible Solana wallets supporting message signing

## Canonical Flow

1. User taps `Connect Wallet`.
2. App requests wallet authorization.
3. App stores:
   - wallet public key
   - wallet auth token/session handle
4. App requests backend challenge (`/v1/auth/challenge`).
5. Wallet signs challenge message.
6. App verifies challenge (`/v1/auth/verify`) and receives access/refresh tokens.
7. User proceeds to course selection and lock flow.

## Session Management

Required behavior:

- cache wallet auth token for silent reauthorization
- always attempt silent wallet reauthorization on app launch when a cached wallet auth token exists
- cache backend access/refresh token pair
- rotate backend access token using refresh endpoint
- deauthorize the wallet session on explicit disconnect, then clear all local auth state
- fail closed if signature verification fails

## Security Requirements

1. Wallet address is authoritative identity key.
2. Challenge must be nonce-based and short-lived.
3. Challenge is single-use and cannot be replayed.
4. Signature must verify against the provided wallet address using Ed25519.
5. Authorization headers are redacted in logs.

## Transaction Signing Responsibilities

The same connected wallet must sign:

- `lock_funds` (stablecoin + optional SKR lock)
- voluntary lock extension instructions
- Ichor redemption instructions
- resurface/unlock transaction

## Integration Boundary With On-chain Programs

Wallet module does not embed business logic.
It only provides:

- active signer identity (public key)
- signed transaction payloads
- signed backend challenge payloads

Business rules remain in:

- on-chain programs (`LockVault`, `YieldSplitter`, `CommunityPot`)
- backend lesson verification and scheduling workers

## Environment and Network

- Cluster selection is environment-configured (`devnet` for development, `mainnet-beta` for production).
- RPC provider should be reliable and monitored.
- Wallet runtime compatibility checks must fail with explicit user-facing errors.
