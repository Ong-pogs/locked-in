# Wallet Connection and Identity (v4.0)

## Scope

Wallet connection is the only user identity layer.
No email/password auth is used for core flows.

This module must support:

- wallet session establishment
- session reuse (reauthorize)
- challenge signing for backend API auth
- transaction signing for on-chain instructions

## Supported Wallet Paths

1. Privy-managed wallet: embedded wallet or a connected external wallet.
2. Web runtime: wallet-standard compatible injected providers (browser extensions).

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

The same connected wallet must sign the custody actions on the single
`locked_in` program:

- `lock_funds` (escrows USDC principal for the course duration)
- `unlock_funds` (resurface/unlock once the lock timer elapses)

These are the only on-chain actions the user signs. Fuel, ichor, savers,
streak, and yield routing are off-chain DB mechanics (Postgres) — they
require no wallet signature. Ichor is a pure in-game shop currency with no
on-chain redemption.

## Integration Boundary With On-chain Programs

Wallet module does not embed business logic.
It only provides:

- active signer identity (public key)
- signed transaction payloads
- signed backend challenge payloads

Business rules remain in:

- the single on-chain `locked_in` program (program ID
  `68im45BCfv8sL6WnVVV9JF4edLkB11udeU9EAApNaEx3`), which contains the
  `vault` custody module (seed `vault-protocol`) and the `pot` module
  (seed `pot-protocol`)
- backend lesson verification, fuel/ichor/streak counters, and scheduling
  workers

## Environment and Network

- Cluster selection is environment-configured (`devnet` for development, `mainnet-beta` for production).
- RPC provider should be reliable and monitored.
- Wallet runtime compatibility checks must fail with explicit user-facing errors.
