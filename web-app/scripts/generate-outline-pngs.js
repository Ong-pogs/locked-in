/**
 * Pre-compute outline PNGs for the village masks.
 * For each mask in masks/, generates a corresponding outline-{id}.png
 * containing only the rim of the silhouette, pre-blurred for soft glow.
 *
 * Eliminates runtime SVG filter computation — the page just shows static
 * <img> tags that fade in on hover. ~10x faster than runtime filters.
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '../public/images/village/masks');
const DST = path.join(__dirname, '../public/images/village/outlines');

if (!fs.existsSync(DST)) fs.mkdirSync(DST, { recursive: true });

const MASKS = [
  'academy',
  'cottage',
  'clock',
  'tavern',
  'forge',
  'market',
  'storage',
  'notice',
  'lantern',
];

const OUTLINE_RADIUS = 3; // dilation radius in source pixels
const GLOW_BLUR = 2; // gaussian blur sigma for soft halo
const COLOR = [255, 253, 242]; // warm white #FFFDF2

async function generate() {
  for (const name of MASKS) {
    const srcPath = path.join(SRC, `mask-${name}.png`);
    const dstPath = path.join(DST, `outline-${name}.png`);

    const { data, info } = await sharp(srcPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;

    // Build alpha map (1 where opaque, 0 where transparent)
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      alpha[i] = data[i * channels + 3] > 128 ? 1 : 0;
    }

    // Dilate: pixel is "in dilated" if any neighbor within radius is opaque.
    const r = OUTLINE_RADIUS;
    const dilated = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let any = false;
        for (let dy = -r; dy <= r && !any; dy++) {
          for (let dx = -r; dx <= r && !any; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (alpha[ny * width + nx]) any = true;
          }
        }
        dilated[y * width + x] = any ? 1 : 0;
      }
    }

    // Outline = dilated AND NOT original (the outer ring around the silhouette)
    const out = Buffer.alloc(width * height * 4);
    let outlinePixels = 0;
    for (let i = 0; i < width * height; i++) {
      const j = i * 4;
      const isOutline = dilated[i] && !alpha[i];
      if (isOutline) {
        out[j] = COLOR[0];
        out[j + 1] = COLOR[1];
        out[j + 2] = COLOR[2];
        out[j + 3] = 255;
        outlinePixels++;
      } else {
        out[j + 3] = 0;
      }
    }

    // Soft Gaussian blur for the glow halo
    await sharp(out, { raw: { width, height, channels: 4 } })
      .blur(GLOW_BLUR)
      .png()
      .toFile(dstPath);

    console.log(`✓ outline-${name}.png  (${outlinePixels} ring pixels)`);
  }

  console.log('\nDone. Generated 9 outline PNGs in public/images/village/outlines/');
}

generate().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
