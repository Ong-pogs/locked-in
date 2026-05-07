#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * extract-village-mask-bounds.js
 *
 * Reads each mask PNG in public/images/village/masks/ and computes the
 * bounding box of its opaque (alpha > threshold) pixels. Writes the result
 * to public/images/village/masks/bounds.json as normalized [0..1] coords:
 *
 *   { "academy": { "x": 0.0, "y": 0.1, "w": 0.28, "h": 0.30 }, ... }
 *
 * Run once after dropping new masks:
 *   node scripts/extract-village-mask-bounds.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MASKS_DIR = path.join(__dirname, '..', 'public', 'images', 'village', 'masks');
const OUT = path.join(MASKS_DIR, 'bounds.json');
const ALPHA_THRESHOLD = 16; // ignore near-transparent pixels

async function boundsFor(file) {
  const img = sharp(path.join(MASKS_DIR, file)).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let minX = width, minY = height, maxX = -1, maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const a = data[i + 3];
      if (a > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) {
    return null; // empty mask
  }

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  return {
    x: +(minX / width).toFixed(4),
    y: +(minY / height).toFixed(4),
    w: +(w / width).toFixed(4),
    h: +(h / height).toFixed(4),
  };
}

async function main() {
  const files = fs.readdirSync(MASKS_DIR).filter(
    (f) => f.startsWith('mask-') && f.endsWith('.png'),
  );

  const out = {};
  for (const file of files) {
    const id = file.replace(/^mask-/, '').replace(/\.png$/, '');
    const b = await boundsFor(file);
    if (b) {
      out[id] = b;
      console.log(`${id}: x=${b.x} y=${b.y} w=${b.w} h=${b.h}`);
    } else {
      console.warn(`${id}: empty mask, skipping`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nWrote ${Object.keys(out).length} bounds to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
