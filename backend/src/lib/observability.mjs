// Server-side error reporting seam.
//
// Inert until ERROR_REPORTING_DSN is set, so mainnet can ship before the team
// owns a collector account — wiring a DSN later needs only the env var.
//
// Vendor-neutral on purpose: the payload is plain JSON POSTed to the DSN, so a
// vendor SDK can be swapped in behind this surface without touching call
// sites, and no vendor code loads on a deploy that has no DSN.
//
// Read from process.env directly (not appConfig): this module must stay
// importable from one-off support scripts that never boot the config guards.
//
// captureError never throws and never rejects — reporting a failure must never
// become a second failure on a money path.

// Anything whose key looks like a credential is dropped before it leaves the
// process. Wallet addresses and tx signatures are public and stay.
const REDACTED_KEY = /secret|password|private|seed|mnemonic|authoriz|token|jwt|cookie/i;
const MAX_STRING_LENGTH = 512;
const MAX_DEPTH = 2;

function dsn() {
  return (process.env.ERROR_REPORTING_DSN ?? '').trim();
}

function environment() {
  return (process.env.ERROR_REPORTING_ENV ?? process.env.NODE_ENV ?? 'unknown').trim();
}

export function isErrorReportingEnabled() {
  return dsn().length > 0;
}

function sanitizeValue(value, depth) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (depth >= MAX_DEPTH) return String(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') return sanitizeContext(value, depth + 1);
  return String(value);
}

function sanitizeContext(context, depth = 0) {
  const out = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] = REDACTED_KEY.test(key) ? '[redacted]' : sanitizeValue(value, depth);
  }
  return out;
}

function describeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code: error.code ?? null,
      stack: error.stack ? error.stack.slice(0, 8_000) : null,
    };
  }
  return { name: typeof error, message: String(error), code: null, stack: null };
}

/**
 * Report a caught error. Awaitable, but ignoring the promise is the normal
 * case — request handlers already log through pino.
 *
 * @param {unknown} error
 * @param {{ scope: string, context?: Record<string, unknown>, level?: 'error'|'warning'|'info' }} options
 * @returns {Promise<void>}
 */
export async function captureError(error, options) {
  const endpoint = dsn();
  if (!endpoint) return;
  try {
    const payload = {
      service: 'backend',
      environment: environment(),
      level: options?.level ?? 'error',
      scope: options?.scope ?? 'unknown',
      error: describeError(error),
      context: sanitizeContext(options?.context ?? {}),
      timestamp: new Date().toISOString(),
    };
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Reporting must never mask the original error or crash the process.
  }
}
