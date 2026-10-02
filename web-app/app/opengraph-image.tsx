import { ImageResponse } from 'next/og';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

export const alt = 'Locked In - Stop collecting courses. Finish one.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpenGraphImage() {
  // Pixel crest logo, read from disk at build time (process.cwd() is the web-app root).
  const logo = await readFile(join(process.cwd(), 'public/images/logo.png'), 'base64');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          color: '#E8DED0',
          background:
            'radial-gradient(circle at 82% 18%, rgba(153,69,255,0.38), transparent 32%), radial-gradient(circle at 18% 85%, rgba(42,232,212,0.18), transparent 34%), linear-gradient(135deg, #07101a, #120e20 58%, #2a1717)',
          fontFamily: 'monospace',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <img src={`data:image/png;base64,${logo}`} width={64} height={64} alt="" />
          <div style={{ color: '#FFD580', fontSize: 25, letterSpacing: 5 }}>LOCKED IN</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ color: '#2AE8D4', fontSize: 22, letterSpacing: 4 }}>
            FOUNDING 100 · MAINNET BETA
          </div>
          <div
            style={{
              marginTop: 22,
              maxWidth: 980,
              color: '#FFD580',
              fontFamily: 'serif',
              fontSize: 78,
              fontWeight: 800,
              lineHeight: 0.98,
            }}
          >
            Stop collecting courses. Finish one.
          </div>
          <div style={{ marginTop: 28, fontSize: 26, color: 'rgba(255,255,255,0.72)' }}>
            Put $10-$50 USDC behind the course you keep saying you will finish.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18 }}>
          <div style={{ color: '#F0A878' }}>VARIABLE YIELD · UNAUDITED SOFTWARE · RISK APPLIES</div>
          <div style={{ color: 'rgba(255,255,255,0.58)' }}>lockedin.quest</div>
        </div>
      </div>
    ),
    size,
  );
}
