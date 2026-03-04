// src/services/solana/connection.ts
import { Connection, clusterApiUrl } from '@solana/web3.js';

// Switch to 'mainnet-beta' for production
export const CLUSTER = 'devnet';
export const RPC_ENDPOINT = clusterApiUrl(CLUSTER);

// Shared connection instance — reused across the app
export const connection = new Connection(RPC_ENDPOINT, 'confirmed');
