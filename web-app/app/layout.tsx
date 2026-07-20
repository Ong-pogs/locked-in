import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Geist, Geist_Mono, Pixelify_Sans, Silkscreen } from 'next/font/google';
import { Providers } from './providers';
import { SerwistProvider } from './serwist';
import { AppShell } from '@/components/AppShell';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import './globals.css';

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
const silkscreen = Silkscreen({
  variable: '--font-pixel-mono',
  subsets: ['latin'],
  weight: ['400', '700'],
});

const APP_NAME = 'Locked-In';
const APP_DESCRIPTION = 'Learn Solana. Lock deposits. Stay consistent.';

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
  metadataBase: new URL('https://www.lockedin.quest'),
  openGraph: {
    type: 'website',
    siteName: APP_NAME,
    title: APP_NAME,
    description: APP_DESCRIPTION,
    url: '/',
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512, alt: APP_NAME }],
  },
  twitter: {
    card: 'summary_large_image',
    title: APP_NAME,
    description: APP_DESCRIPTION,
    images: ['/icons/icon-512.png'],
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
      className={`${geistSans.variable} ${geistMono.variable} ${pixelifySans.variable} ${silkscreen.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col">
        <SerwistProvider swUrl="/serwist/sw.js">
          <Providers>
            <AppShell>
              <AnimatedSplash>{children}</AnimatedSplash>
            </AppShell>
          </Providers>
        </SerwistProvider>
      </body>
    </html>
  );
}
