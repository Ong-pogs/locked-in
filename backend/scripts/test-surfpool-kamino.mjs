// Smoke test: verify our Kamino integration works against a local Surfpool
// fork of mainnet via the `kamino_surfpool` strategy profile. Confirms that
// without changing application code we can switch the yield source between
// the devnet fixed-APY simulator (production default) and real Kamino
// mainnet state simply by setting YIELD_STRATEGY_PROFILE=kamino_surfpool.
//
// Prereq: `surfpool start --network mainnet --no-tui` running on :8899.
//
// Run: cd backend && node scripts/test-surfpool-kamino.mjs

// Resolve config from backend/.env via dotenv (called inside config.mjs).
// Nothing is hardcoded in this script — everything (profile, RPC URL,
// market address, reserve symbol) comes from the resolved profile in
// appConfig. To run against a different profile without editing .env:
//   YIELD_STRATEGY_PROFILE=kamino_usdc_mainnet node scripts/test-surfpool-kamino.mjs
// Shell env always wins over .env values.
const { appConfig } = await import('../src/config.mjs');

if (appConfig.yieldStrategyProfile !== 'kamino_surfpool') {
  console.error(
    `\n⚠️  This test expects YIELD_STRATEGY_PROFILE=kamino_surfpool in backend/.env.\n` +
    `   Current resolved profile: ${appConfig.yieldStrategyProfile ?? '(none)'}\n` +
    `   Either set it in .env or pass via shell env:\n` +
    `   YIELD_STRATEGY_PROFILE=kamino_surfpool node scripts/test-surfpool-kamino.mjs\n`,
  );
  process.exit(1);
}

const t0 = Date.now();

const { KaminoMarket } = await import('@kamino-finance/klend-sdk');
const { createSolanaRpc, address } = await import('@solana/kit');

// Everything below is pulled from the resolved profile in config.mjs — no
// hardcoded URLs or addresses in this test. Swap profiles to switch modes.
const KLEND_PROGRAM = address('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const rpcUrl = appConfig.yieldKaminoRpcUrl;
const marketAddr = address(appConfig.yieldKaminoMarketAddress);
const reserveSymbol = appConfig.yieldKaminoReserveSymbol;

console.log('=== Surfpool + Kamino smoke test ===');
console.log('Profile:     ', appConfig.yieldStrategyProfile);
console.log('Strategy kind:', appConfig.yieldStrategyKind);
console.log('RPC:         ', rpcUrl);
console.log('Market:      ', appConfig.yieldKaminoMarketAddress);
console.log('Reserve:     ', reserveSymbol);
console.log('');

console.log('[1/4] Connecting to RPC...');
const rpc = createSolanaRpc(rpcUrl);
const version = await rpc.getVersion().send();
console.log('  OK. Solana version:', version['solana-core']);

console.log('[2/4] Loading Kamino market...');
const market = await KaminoMarket.load(rpc, marketAddr, 450, KLEND_PROGRAM);
if (!market) throw new Error('Market load returned null');
console.log('  OK. Market address:', market.address);

console.log('[3/4] Loading reserves...');
await market.loadReserves();
const reserves = market.reserves;
console.log('  OK. Reserves loaded:', Object.keys(Object.fromEntries(reserves)).length);

console.log(`[4/4] Reading ${reserveSymbol} reserve APY...`);
const reserve = market.getReserveBySymbol(reserveSymbol);
if (!reserve) throw new Error(`${reserveSymbol} reserve not found`);
const slot = await rpc.getSlot({ commitment: 'confirmed' }).send();
const supplyApy = Number(reserve.totalSupplyAPY(slot));
const borrowApy = Number(reserve.totalBorrowAPY(slot));
const utilization = Number(reserve.calculateUtilizationRatio());

console.log('');
console.log('========================================');
console.log('  Reserve:        ', reserveSymbol);
console.log('  Slot:           ', slot.toString());
console.log('  Supply APY:     ', (supplyApy * 100).toFixed(4), '%');
console.log('  Borrow APY:     ', (borrowApy * 100).toFixed(4), '%');
console.log('  Utilization:    ', (utilization * 100).toFixed(2), '%');
console.log('  Total supplied: ', reserve.getTotalSupply().toFixed(0));
console.log('  Total borrowed: ', reserve.getBorrowedAmount().toFixed(0));
console.log('========================================');
console.log('');
console.log(`Total time: ${((Date.now() - t0) / 1000).toFixed(2)}s`);
console.log(`PASS — Kamino integration works via profile '${appConfig.yieldStrategyProfile}'.`);
