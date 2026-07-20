import Link from 'next/link';

// Without this, every unknown URL fell through to the auth guard and silently
// redirected to /village — dead links gave no feedback and crawlers saw
// soft-404s. Server component: no client JS, no store access.
export const metadata = {
  title: 'Page not found',
};

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#06060C',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <p
          style={{
            fontFamily: 'var(--font-pixel-mono), monospace',
            fontSize: 12,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: 'rgba(255,213,128,0.7)',
            marginBottom: 10,
          }}
        >
          404
        </p>
        <h1
          style={{
            fontFamily: 'var(--font-pixel), Georgia, serif',
            fontSize: 24,
            fontWeight: 700,
            color: '#FFD580',
            textShadow: '0 1px 2px rgba(0,0,0,0.85)',
            marginBottom: 12,
          }}
        >
          Nothing down this path
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-pixel-mono), monospace',
            fontSize: 13,
            lineHeight: 1.6,
            color: 'rgba(255,255,255,0.66)',
            marginBottom: 24,
          }}
        >
          This page doesn&apos;t exist. Your streak, stake and yield are untouched.
        </p>
        <Link
          href="/village"
          style={{
            display: 'inline-block',
            minHeight: 44,
            padding: '12px 24px',
            borderRadius: 8,
            border: '1px solid rgba(255,213,128,0.4)',
            backgroundColor: 'rgba(255,213,128,0.12)',
            color: '#FFD580',
            fontFamily: 'var(--font-pixel), Georgia, serif',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: 'uppercase',
            textDecoration: 'none',
          }}
        >
          Back to the village
        </Link>
      </div>
    </div>
  );
}
