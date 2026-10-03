import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Geist, Geist_Mono, Pixelify_Sans } from 'next/font/google';
import localFont from 'next/font/local';
import { Providers } from './providers';
import { SerwistProvider } from './serwist';
import { AppShell } from '@/components/AppShell';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import { ProductAnalytics } from '@/components/ProductAnalytics';
import { SITE_ORIGIN } from '@/lib/site';
import './globals.css';
// App-wide UI base rules, in their own file (see the note at the top of it).
import './ui-base.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Cozy pixel-art body font — matches painted village aesthetic.
const pixelifySans = Pixelify_Sans({
  variable: '--font-pixel',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

// Tight HUD readout font for stat numbers — sharper than Pixelify, very legible at small sizes.
// Self-hosted (Latin subset, about 8 KB per weight) instead of next/font/google
// because the bold "4" is redrawn: stock Silkscreen Bold fills the gap between
// the 4's two arms, so ratings like "1418" read as "1Ч18". The modified bold is
// renamed "Silkscreen LI" inside the file (OFL; Silkscreen reserves no name).
const silkscreen = localFont({
  variable: '--font-pixel-mono',
  src: [
    { path: '../assets/fonts/Silkscreen-Regular-latin.woff2', weight: '400' },
    { path: '../assets/fonts/SilkscreenLI-Bold-latin.woff2', weight: '700' },
  ],
});

// Digits for Pixelify text (the bold file carries the same redrawn "4").
// Pixelify Sans draws "5" like "S" (and, in bold,
// "2" like "8", so "$20" read as "$80"). This face holds only Silkscreen's
// digits (subset files, about 3 KB each) and unicode-range limits it to 0-9,
// so .font-pixel keeps Pixelify letters with unambiguous numbers.
// size-adjust 90% matches the digits to Pixelify's cap height.
const pixelDigits = localFont({
  variable: '--font-pixel-digits',
  src: [
    { path: '../assets/fonts/SilkscreenDigits-Regular.woff2', weight: '400' },
    { path: '../assets/fonts/SilkscreenDigits-Bold.woff2', weight: '700' },
  ],
  declarations: [
    { prop: 'unicode-range', value: 'U+0030-0039' },
    { prop: 'size-adjust', value: '90%' },
  ],
  // No metric fallback: this face only ever covers digits inside Pixelify text.
  adjustFontFallback: false,
});

// "%" for Silkscreen text. Bold Silkscreen draws "%" like "Z" ("100%" read as
// "100Z" on the claim and yield screens). This face holds only Tiny5's "%"
// (about 2 KB), sized to Silkscreen's digits; one face covers every weight.
const pixelPercent = localFont({
  variable: '--font-pixel-pct',
  src: [{ path: '../assets/fonts/Tiny5Percent.woff2', weight: '100 900' }],
  declarations: [
    { prop: 'unicode-range', value: 'U+0025' },
    { prop: 'size-adjust', value: '115%' },
  ],
  adjustFontFallback: false,
});

const APP_NAME = 'Locked-In';
const APP_DESCRIPTION =
  'Stop collecting courses. Finish one. Put $10-$50 USDC behind a course in a capped mainnet beta.';

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_NAME,
    template: `%s - ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: APP_NAME,
  },
  formatDetection: {
    telephone: false,
  },
  // Sharing any link previously produced no preview card at all.
  metadataBase: new URL(SITE_ORIGIN),
  openGraph: {
    type: 'website',
    siteName: APP_NAME,
    title: APP_NAME,
    description: APP_DESCRIPTION,
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: APP_NAME,
    description: APP_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: '#06060C',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${pixelifySans.variable} ${pixelDigits.variable} ${silkscreen.variable} ${pixelPercent.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col">
        <SerwistProvider swUrl="/serwist/sw.js">
          <Providers>
            <AppShell>
              <AnimatedSplash>{children}</AnimatedSplash>
            </AppShell>
          </Providers>
        </SerwistProvider>
        <ProductAnalytics />
      </body>
    </html>
  );
}
