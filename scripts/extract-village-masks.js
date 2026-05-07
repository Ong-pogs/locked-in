/**
 * Extracts white silhouettes from village mask source images.
 * Source: web-app/public/images/village/Invertedmask/ (painted village + white building).
 * Output: web-app/public/images/village/masks/mask-{name}.png (white-on-transparent).
 *
 * Logic: any pixel with RGB all > 240 becomes opaque white; everything else becomes transparent.
 */

const sharp = require('sharp');
const path = require('path');

const SRC = path.join(__dirname, '../web-app/public/images/village/Invertedmask');
const DST = path.join(__dirname, '../web-app/public/images/village/masks');

const RENAME_MAP = {
  'leftmosttudor-mask.png': 'mask-academy.png',
  'leftmiddletudor-mask.png': 'mask-cottage.png',
  'leftlasttudormask.png': 'mask-market.png',
  'rightlasttudormask.png': 'mask-tavern.png',
  'rightmosttudormask.png': 'mask-storage.png',
  'rightchurchmmiddlemask.png': 'mask-forge.png',
  'clocktowermask.png': 'mask-clock.png',
  'middlewellmask.png': 'mask-lantern.png',
  'signboardbesideleftmostmask.png': 'mask-notice.png',
};

const WHITE_THRESHOLD = 240;

async function convert() {
  for (const [src, dst] of Object.entries(RENAME_MAP)) {
    const srcPath = path.join(SRC, src);
    const dstPath = path.join(DST, dst);

    const { data, info } = await sharp(srcPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixelCount = info.width * info.height;
    const channels = info.channels;
    let whitePixels = 0;

    for (let i = 0; i < pixelCount; i++) {
      const offset = i * channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const isWhite = r > WHITE_THRESHOLD && g > WHITE_THRESHOLD && b > WHITE_THRESHOLD;

      if (isWhite) {
        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
        data[offset + 3] = 255;
        whitePixels++;
      } else {
        data[offset + 3] = 0;
      }
    }

    await sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    })
      .png()
      .toFile(dstPath);

    const pct = ((whitePixels / pixelCount) * 100).toFixed(1);
    console.log(`✓ ${src} → ${dst}  (${whitePixels} white px, ${pct}% of canvas)`);
  }

  console.log('\nDone — 9 masks extracted.');
}

convert().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
