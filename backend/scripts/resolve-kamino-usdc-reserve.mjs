// Resolve the real Kamino main-market USDC reserve into the exact account set
// initialize_vault_v2 + the client refresh_reserve ix need. Run against a
// mainnet RPC or a surfpool mainnet fork (127.0.0.1:8899). Dumps JSON to
// stdout AND to a file so the fork-proof test + config can reuse it verbatim.
//
//   node scripts/resolve-kamino-usdc-reserve.mjs [rpcUrl] [outPath]
//
// Default rpc: surfpool fork. This never touches real funds — read-only.

import { PublicKey } from '@solana/web3.js';
import { writeFileSync } from 'node:fs';

const RPC = process.argv[2] || 'http://127.0.0.1:8899';
const OUT = process.argv[3] || `${process.env.CLAUDE_JOB_DIR || '/tmp'}/tmp/kamino-usdc-reserve.json`;
const KLEND = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';

const { KaminoMarket } = await import('@kamino-finance/klend-sdk');
const { createSolanaRpc, address } = await import('@solana/kit');

const rpc = createSolanaRpc(RPC);
console.log('[resolve] rpc      :', RPC);
console.log('[resolve] market   :', MAIN_MARKET);

// The active main-market USDC reserve (getReserveBySymbol returns an obsolete
// status=2 one — there are several USDC reserves). Pin the live one, override
// via argv[4].
const RESERVE_ADDR = process.argv[4] || 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59';

const market = await KaminoMarket.load(rpc, address(MAIN_MARKET), 450, address(KLEND));
if (!market) throw new Error('KaminoMarket.load returned null');
await market.loadReserves();

let reserve = null;
for (const [pk, r] of market.reserves) {
  if (pk.toString() === RESERVE_ADDR) { reserve = r; break; }
}
if (!reserve) throw new Error(`reserve ${RESERVE_ADDR} not found in main market`);
console.log('[resolve] reserve  :', RESERVE_ADDR, 'status=' + reserve.state.config.status,
  'depLimit=' + reserve.state.config.depositLimit.toString());

const s = reserve.state;
const ti = s.config.tokenInfo;

// Lending-market authority PDA (seed "lma" + market).
const [lma] = PublicKey.findProgramAddressSync(
  [Buffer.from('lma'), new PublicKey(MAIN_MARKET).toBuffer()],
  new PublicKey(KLEND),
);

// Oracle inputs for refresh_reserve. Default (all-zero / 111…) means "unused";
// klend substitutes the program id for absent optional oracles.
const DEFAULT_PK = '11111111111111111111111111111111';
const orNull = (v) => {
  const str = v?.toString?.() ?? String(v);
  return str === DEFAULT_PK ? null : str;
};

const out = {
  resolvedAt: null, // stamped by caller; Date.* unavailable here is fine
  rpc: RPC,
  kaminoProgram: KLEND,
  kaminoMarket: MAIN_MARKET,
  kaminoReserve: reserve.address.toString(),
  kaminoLma: lma.toBase58(),
  kaminoLiquiditySupply: s.liquidity.supplyVault.toString(),
  kaminoCollateralMint: s.collateral.mintPubkey.toString(),
  usdcMint: s.liquidity.mintPubkey.toString(),
  liquidityDecimals: Number(s.liquidity.mintDecimals),
  // refresh_reserve oracle accounts (null → klend uses program id sentinel)
  oracles: {
    pyth: orNull(ti.pythConfiguration?.price),
    switchboardPrice: orNull(ti.switchboardConfiguration?.priceAggregator),
    switchboardTwap: orNull(ti.switchboardConfiguration?.twapAggregator),
    scopePrices: orNull(ti.scopeConfiguration?.priceFeed),
  },
};

// Collateral exchange rate — validates the position-value reader math.
try {
  const slot = await rpc.getSlot().send();
  const rate = reserve.getCollateralExchangeRate(); // cToken → liquidity ratio
  out.collateralExchangeRate = rate?.toString?.() ?? String(rate);
  out.totalSupplyApy = Number(reserve.totalSupplyAPY(Number(slot)));
} catch (e) {
  out.collateralExchangeRate = `ERR: ${e.message}`;
}

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log('\n=== RESOLVED USDC RESERVE ===');
console.log(JSON.stringify(out, null, 2));
console.log('\nwrote', OUT);
