process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5433/lockedin_test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long-for-hs256';
process.env.JWT_ISSUER = 'lockedin-api';
process.env.JWT_AUDIENCE = 'lockedin-mobile';
process.env.JWT_ACCESS_TTL = '15m';
process.env.JWT_REFRESH_TTL = '30d';
// >= 32 bytes: boot guard (a) binds on every non-local cluster now (sweep
// ruling R21) and the test env points at devnet RPC.
process.env.SCHEDULER_SECRET = 'test-scheduler-secret-that-is-32-bytes-plus';
// Enroll fresh-read retry pacing — keep retry-exhaustion tests fast.
process.env.ENROLL_RETRY_DELAY_MS = '20';
process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
// lock_vault + community_pot merged into ONE program (`locked_in`); both IDs match.
process.env.LOCK_VAULT_PROGRAM_ID = '3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav';
process.env.YIELD_SPLITTER_PROGRAM_ID = '8bevd3T3LWoUh2Z9348UKwFFN1p5MdbRbAe2zniCrnVv';
process.env.COMMUNITY_POT_PROGRAM_ID = '3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav';
process.env.LOCK_VAULT_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
// v2 completion-voucher signing (devnet-only throwaway key — NEVER a real key).
process.env.VAULT_V2_PROGRAM_ID = 'EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN';
process.env.LOCK_VAULT_WORKER_PRIVATE_KEY =
  '5uE3uZYba8jAnvhUsvKZizKZgBW2XFkbcPFkEpqEY8g5krd8FtQiBVYN5T2TArP5koXCNVzrj6PmtM2gLyyigd7b';
process.env.VOUCHER_TTL_SECONDS = '3600';
process.env.LOCK_VAULT_RELAY_ENABLED = 'false';
process.env.RUNTIME_SCHEDULER_ENABLED = 'false';
process.env.LEADERBOARD_SNAPSHOT_ENABLED = 'false';
process.env.UNLOCK_INDEXER_ENABLED = 'false';
process.env.REDEMPTION_VAULT_AUTOFUND_ENABLED = 'false';
process.env.FAUCET_ENABLED = 'false';
process.env.YIELD_STRATEGY_ENABLED = 'false';
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
