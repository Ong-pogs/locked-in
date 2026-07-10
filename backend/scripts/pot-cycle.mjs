#!/usr/bin/env node
// Monthly v2 pot-cycle runner (pot-cycle ruling 2026-07-10, R7).
//
// Intended Render cron: schedule '15 6 3 * *' (06:15 UTC on the 3rd — after
// boundary-straddling claims settle), command `node scripts/pot-cycle.mjs`.
// Targets the PREVIOUS UTC month; scan + record + close + distribute, all
// signed by the relay worker key. The deployer key is NEVER on Render — if
// this exits POT_VAULT_UNDERFUNDED, run
// `node scripts/bridge-v2-pot-transfer.mjs --execute` LOCALLY, then re-run.
//
// Exit code: 0 only on the benign outcomes (NOTHING_TO_DISTRIBUTE,
// ALREADY_CLOSED with rows and nothing pending, NO_PENDING_RECIPIENTS with
// all rows distributed); 1 on everything else so the cron surfaces failures.
//
// Usage:
//   node scripts/pot-cycle.mjs [--window-id YYYYMM] [--dry-run]

if (!process.env.DATABASE_URL) {
  console.error('pot-cycle: DATABASE_URL is required. Refusing to run.');
  process.exit(1);
}

const { runPotCycle } = await import('../src/lib/potCycle.mjs');

function parseArgs(argv) {
  const args = { windowId: null, execute: true };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--window-id') {
      args.windowId = Number.parseInt(argv[++i], 10);
      if (!Number.isFinite(args.windowId)) {
        console.error('pot-cycle: --window-id must be a number like 202607');
        process.exit(1);
      }
    } else if (flag === '--dry-run') {
      args.execute = false;
    } else {
      console.error(`pot-cycle: unknown flag ${flag}`);
      process.exit(1);
    }
  }
  return args;
}

const { windowId, execute } = parseArgs(process.argv);

const consoleLog = {
  info: (fields, msg) => console.log(`[pot-cycle] ${msg}`, JSON.stringify(fields)),
  warn: (fields, msg) => console.warn(`[pot-cycle] ${msg}`, JSON.stringify(fields)),
  error: (fields, msg) => console.error(`[pot-cycle] ${msg}`, JSON.stringify(fields)),
};

try {
  const result = await runPotCycle({ windowId, execute, log: consoleLog });
  console.log('[pot-cycle] result', JSON.stringify(result, null, 2));
  if (!result.benign) {
    console.error(`[pot-cycle] FAILED: ${result.reason}`);
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  console.error('[pot-cycle] FAILED:', error?.message ?? error);
  process.exit(1);
}
