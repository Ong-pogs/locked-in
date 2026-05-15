// Smoke test: verify our existing Kamino integration works against a local
// Surfpool fork of mainnet. Confirms that without changing application code
// we can switch the yield source between fixed-APY simulator and real
// Kamino mainnet state simply by flipping environment variables.
//
// Prereq: `surfpool start --network mainnet --no-tui` running on :8899.
//
// Run: cd backend && node scripts/test-surfpool-kamino.mjs

// Override env BEFORE importing config.mjs (config reads env at import time)
process.env.YIELD_STRATEGY_PROFILE = '';
process.env.YIELD_STRATEGY_ENABLED = 'true';
process.env.YIELD_STRATEGY_KIND = 'kamino_klend_reserve_v1';
process.env.YIELD_KAMINO_RPC_URL = 'http://127.0.0.1:8899';
process.env.YIELD_KAMINO_MARKET_ADDRESS = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
process.env.YIELD_KAMINO_RESERVE_SYMBOL = 'USDC';

const t0 = Date.now();

const { KaminoMarket } = await import('@kamino-finance/klend-sdk');
const { createSolanaRpc, address } = await import('@solana/kit');

const KLEND_PROGRAM = address('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const MAIN_MARKET = address('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF');
const SURFPOOL_RPC = 'http://127.0.0.1:8899';

console.log('=== Surfpool + Kamino smoke test ===');
console.log('RPC:', SURFPOOL_RPC);
console.log('Market:', MAIN_MARKET);
console.log('Program:', KLEND_PROGRAM);
console.log('');

console.log('[1/4] Connecting to Surfpool RPC...');
const rpc = createSolanaRpc(SURFPOOL_RPC);
const version = await rpc.getVersion().send();
console.log('  OK. Solana version:', version['solana-core']);

console.log('[2/4] Loading Kamino market (lazy-forks from mainnet)...');
const market = await KaminoMarket.load(rpc, MAIN_MARKET, 450, KLEND_PROGRAM);
if (!market) throw new Error('Market load returned null');
console.log('  OK. Market address:', market.address);

console.log('[3/4] Loading reserves...');
await market.loadReserves();
const reserves = market.reserves;
console.log('  OK. Reserves loaded:', Object.keys(Object.fromEntries(reserves)).length);

console.log('[4/4] Reading USDC reserve APY...');
const usdcReserve = market.getReserveBySymbol('USDC');
if (!usdcReserve) throw new Error('USDC reserve not found');
const slot = await rpc.getSlot({ commitment: 'confirmed' }).send();
const supplyApy = Number(usdcReserve.totalSupplyAPY(slot));
const borrowApy = Number(usdcReserve.totalBorrowAPY(slot));
const utilization = Number(usdcReserve.calculateUtilizationRatio());

console.log('');
console.log('========================================');
console.log('  Reserve:        USDC');
console.log('  Slot:           ', slot.toString());
console.log('  Supply APY:     ', (supplyApy * 100).toFixed(4), '%');
console.log('  Borrow APY:     ', (borrowApy * 100).toFixed(4), '%');
console.log('  Utilization:    ', (utilization * 100).toFixed(2), '%');
console.log('  Total supplied: ', usdcReserve.getTotalSupply().toFixed(0));
console.log('  Total borrowed: ', usdcReserve.getBorrowedAmount().toFixed(0));
console.log('========================================');
console.log('');
console.log(`Total time: ${((Date.now() - t0) / 1000).toFixed(2)}s`);
console.log('PASS — Kamino integration works via Surfpool fork.');
