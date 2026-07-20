// Client-side error reporting seam.
//
// Inert until NEXT_PUBLIC_ERROR_REPORTING_DSN is set, so mainnet can ship
// before the team owns a collector account — wiring a DSN later needs no code
// change, only a redeploy with the env var.
//
// Vendor-neutral on purpose: the payload is plain JSON POSTed to the DSN. A
// vendor SDK (Sentry et al.) can be swapped in behind this same surface without
// touching a single call site, and no vendor code loads on a build that has no
// DSN.
//
// captureError never throws and never rejects: reporting a failure must never
// become a second failure on a money path.

export type ErrorLevel = 'error' | 'warning' | 'info';

export interface CaptureOptions {
  /** Where in the flow this happened, dotted: 'claim.submit', 'deposit.sign'. */
  scope: string;
  context?: Record<string, unknown>;
  level?: ErrorLevel;
}

// Anything whose key looks like a credential is dropped before it leaves the
// device. Wallet addresses and tx signatures are public and stay.
const REDACTED_KEY = /secret|password|private|seed|mnemonic|authoriz|token|jwt|cookie/i;
const MAX_STRING_LENGTH = 512;
const MAX_DEPTH = 2;

function dsn(): string {
  return (process.env.NEXT_PUBLIC_ERROR_REPORTING_DSN ?? '').trim();
}

function environment(): string {
  return (
    process.env.NEXT_PUBLIC_ERROR_REPORTING_ENV ??
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER ??
    'unknown'
  ).trim();
}

export function isErrorReportingEnabled(): boolean {
  return dsn().length > 0;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (depth >= MAX_DEPTH) return String(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') return sanitizeContext(value as Record<string, unknown>, depth + 1);
  return String(value);
}

function sanitizeContext(context: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] = REDACTED_KEY.test(key) ? '[redacted]' : sanitizeValue(value, depth);
  }
  return out;
}

function describeError(error: unknown): { name: string; message: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ? error.stack.slice(0, 8_000) : null,
    };
  }
  return { name: typeof error, message: String(error), stack: null };
}

/**
 * Report a caught error. Awaitable so callers can flush before navigating, but
 * ignoring the promise is the normal case.
 */
export async function captureError(error: unknown, options: CaptureOptions): Promise<void> {
  const endpoint = dsn();
  if (!endpoint) return;
  try {
    const payload = {
      service: 'web-app',
      environment: environment(),
      level: options.level ?? 'error',
      scope: options.scope,
      error: describeError(error),
      context: sanitizeContext(options.context ?? {}),
      url: typeof window === 'undefined' ? null : window.location.href,
      userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
      timestamp: new Date().toISOString(),
    };
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      // The claim flow may navigate away the instant it fails; keepalive lets
      // the report survive the unload.
      keepalive: true,
    });
  } catch {
    // Reporting must never surface to the user or mask the original error.
  }
}
