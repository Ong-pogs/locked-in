export default function OfflinePage() {
  return (
    <div className="flex items-center justify-center min-h-screen px-4">
      <div className="text-center space-y-4">
        {/* Cozy gold (COZY_TEXT) and readable muted gray (T.textMutedStrong),
            written as literals: theme.tsx is a client module and this page
            stays a plain server component. */}
        <h1 className="text-2xl font-bold font-pixel" style={{ color: '#FFD580' }}>
          You&apos;re offline
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.66)' }}>
          Reconnect to the internet to continue using Locked-In.
        </p>
      </div>
    </div>
  );
}
