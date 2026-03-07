import {
  DEFAULT_RECENT_SLOT_DURATION_MS,
  KaminoMarket,
  PROGRAM_ID as KAMINO_PROGRAM_ID,
} from '@kamino-finance/klend-sdk';
import { address, createSolanaRpc } from '@solana/kit';
import { appConfig } from '../config.mjs';

const YEAR_SECONDS = 365n * 24n * 60n * 60n;
const BPS_DENOMINATOR = 10_000n;
const DEFAULT_KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';

let cachedKaminoApy = null;

function hasPositiveInt(value) {
  return Number.isFinite(value) && value > 0;
}

function hasFixedApyConfig() {
  return hasPositiveInt(appConfig.yieldFixedApyBps);
}

function hasKaminoReserveConfig() {
  return Boolean(
    appConfig.yieldKaminoRpcUrl &&
      appConfig.yieldKaminoReserveSymbol,
  );
}

function getKaminoMarketAddressValue() {
  return appConfig.yieldKaminoMarketAddress || DEFAULT_KAMINO_MAIN_MARKET;
}

export function hasYieldStrategyConfig() {
  if (!appConfig.yieldStrategyEnabled || !hasPositiveInt(appConfig.yieldHarvestIntervalSeconds)) {
    return false;
  }

  if (appConfig.yieldStrategyKind === 'fixed_apy_v1') {
    return hasFixedApyConfig();
  }

  if (appConfig.yieldStrategyKind === 'kamino_klend_reserve_v1') {
    return hasKaminoReserveConfig();
  }

  return false;
}

export function getYieldHarvestIntervalSeconds() {
  return Math.max(1, Number(appConfig.yieldHarvestIntervalSeconds ?? 86_400));
}

export function deriveHarvestBucketTimestamp(
  now,
  intervalSeconds = getYieldHarvestIntervalSeconds(),
) {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const bucketStart = Math.floor(nowSeconds / intervalSeconds) * intervalSeconds;
  return new Date(bucketStart * 1000);
}

export function computeQuotedYieldFromApy({
  principalAmount,
  elapsedSeconds,
  apyBps,
}) {
  const principal = BigInt(principalAmount ?? 0);
  const elapsed = BigInt(Math.max(0, Number(elapsedSeconds ?? 0)));
  const rate = BigInt(Math.max(0, Number(apyBps ?? 0)));

  if (principal <= 0n || elapsed <= 0n || rate <= 0n) {
    return 0n;
  }

  return (principal * rate * elapsed) / (BPS_DENOMINATOR * YEAR_SECONDS);
}

async function readKaminoSupplyApyBps() {
  const now = Date.now();
  const marketAddressValue = getKaminoMarketAddressValue();
  const reserveSymbol = appConfig.yieldKaminoReserveSymbol.trim().toUpperCase();
  if (
    cachedKaminoApy &&
    cachedKaminoApy.rpcUrl === appConfig.yieldKaminoRpcUrl &&
    cachedKaminoApy.marketAddress === marketAddressValue &&
    cachedKaminoApy.reserveSymbol === reserveSymbol &&
    cachedKaminoApy.expiresAt > now
  ) {
    return cachedKaminoApy.apyBps;
  }

  const rpc = createSolanaRpc(appConfig.yieldKaminoRpcUrl);
  const marketAddress = address(marketAddressValue);
  const market = await KaminoMarket.load(
    rpc,
    marketAddress,
    appConfig.yieldKaminoRecentSlotDurationMs || DEFAULT_RECENT_SLOT_DURATION_MS,
    KAMINO_PROGRAM_ID,
  );

  if (!market) {
    throw new Error(`Kamino market ${marketAddressValue} was not found.`);
  }

  await market.loadReserves();
  const reserve = market.getReserveBySymbol(reserveSymbol);
  if (!reserve) {
    throw new Error(`Kamino reserve ${reserveSymbol} was not found in the configured market.`);
  }

  const currentSlot = await rpc.getSlot({ commitment: 'confirmed' }).send();
  const apy = Number(reserve.totalSupplyAPY(currentSlot));
  const apyBps = Math.max(0, Math.round(apy * 10_000));

  cachedKaminoApy = {
    rpcUrl: appConfig.yieldKaminoRpcUrl,
    marketAddress: marketAddressValue,
    reserveSymbol,
    apyBps,
    expiresAt: now + Math.max(1_000, Number(appConfig.yieldStrategyApyCacheMs ?? 60_000)),
  };

  return apyBps;
}

export function createFixedApyStrategyAdapter() {
  return {
    kind: 'fixed_apy_v1',
    intervalSeconds: getYieldHarvestIntervalSeconds(),
    async quoteHarvest({ principalAmount, elapsedSeconds }) {
      const apyBps = Number(appConfig.yieldFixedApyBps ?? 0);
      return {
        grossYieldAmount: computeQuotedYieldFromApy({
          principalAmount,
          elapsedSeconds,
          apyBps,
        }).toString(),
        apyBps,
      };
    },
  };
}

export function createKaminoKlendReserveStrategyAdapter() {
  return {
    kind: 'kamino_klend_reserve_v1',
    intervalSeconds: getYieldHarvestIntervalSeconds(),
    async quoteHarvest({ principalAmount, elapsedSeconds }) {
      const apyBps = await readKaminoSupplyApyBps();
      return {
        grossYieldAmount: computeQuotedYieldFromApy({
          principalAmount,
          elapsedSeconds,
          apyBps,
        }).toString(),
        apyBps,
      };
    },
  };
}

export function createYieldStrategyAdapter() {
  if (appConfig.yieldStrategyKind === 'kamino_klend_reserve_v1') {
    return createKaminoKlendReserveStrategyAdapter();
  }

  return createFixedApyStrategyAdapter();
}
