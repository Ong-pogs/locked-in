import { appConfig } from '../config.mjs';

const YEAR_SECONDS = 365n * 24n * 60n * 60n;
const BPS_DENOMINATOR = 10_000n;

export function hasYieldStrategyConfig() {
  return (
    appConfig.yieldStrategyEnabled &&
    appConfig.yieldStrategyKind === 'fixed_apy_v1' &&
    Number.isFinite(appConfig.yieldFixedApyBps) &&
    appConfig.yieldFixedApyBps > 0 &&
    Number.isFinite(appConfig.yieldHarvestIntervalSeconds) &&
    appConfig.yieldHarvestIntervalSeconds > 0
  );
}

export function getYieldHarvestIntervalSeconds() {
  return Math.max(1, Number(appConfig.yieldHarvestIntervalSeconds ?? 86_400));
}

export function deriveHarvestBucketTimestamp(now, intervalSeconds = getYieldHarvestIntervalSeconds()) {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const bucketStart = Math.floor(nowSeconds / intervalSeconds) * intervalSeconds;
  return new Date(bucketStart * 1000);
}

export function computeFixedApyGrossYield({
  principalAmount,
  elapsedSeconds,
  apyBps = appConfig.yieldFixedApyBps,
}) {
  const principal = BigInt(principalAmount ?? 0);
  const elapsed = BigInt(Math.max(0, Number(elapsedSeconds ?? 0)));
  const rate = BigInt(Math.max(0, Number(apyBps ?? 0)));

  if (principal <= 0n || elapsed <= 0n || rate <= 0n) {
    return 0n;
  }

  return (principal * rate * elapsed) / (BPS_DENOMINATOR * YEAR_SECONDS);
}

export function createFixedApyStrategyAdapter() {
  return {
    kind: 'fixed_apy_v1',
    intervalSeconds: getYieldHarvestIntervalSeconds(),
    quoteHarvest({ principalAmount, elapsedSeconds }) {
      return {
        grossYieldAmount: computeFixedApyGrossYield({
          principalAmount,
          elapsedSeconds,
        }).toString(),
      };
    },
  };
}
