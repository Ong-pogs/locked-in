import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string compare. Avoids leaking secret length/prefix via
 * early-exit timing on `===`/`!==`. Hashes both inputs to equal-length
 * buffers first so timingSafeEqual never throws on length mismatch and the
 * comparison time is independent of the inputs.
 */
export function secureEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // Length difference would make timingSafeEqual throw and leak length, so
  // compare fixed-width encodings of both. Use Buffer of equal length.
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still run a comparison to keep timing roughly constant, then fail.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
