'use client';

import { useEffect } from 'react';
import { captureError } from '@/services/observability';

// Last-resort boundary: an unhandled render error in the root layout unmounts
// everything, so this file replaces <html>/<body> itself. Everything here is
// deliberately dependency-free and inline-styled — global styles, fonts and the
// theme module are exactly what may have failed to load.
//
// Its real job is reporting: before this existed, a React crash mid-claim was
// known only to the user staring at a blank screen.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error, {
      scope: 'app.global-error',
      context: {
        digest: error.digest ?? null,
        pathname: typeof window === 'undefined' ? null : window.location.pathname,
      },
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          backgroundColor: '#0E0E1C',
          color: '#F5E9D0',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <p style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px' }}>Something broke</p>
          <p style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.85, margin: '0 0 20px' }}>
            The app hit an error it could not recover from. Your funds are untouched — nothing
            on-chain happens without a wallet signature.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, opacity: 0.6, margin: '0 0 20px' }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              width: '100%',
              minHeight: 44,
              padding: '12px 16px',
              borderRadius: 8,
              border: '1px solid rgba(62,230,138,0.6)',
              backgroundColor: 'rgba(62,230,138,0.15)',
              color: '#3EE68A',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
