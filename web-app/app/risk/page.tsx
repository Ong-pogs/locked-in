import Link from 'next/link';

// Standalone styled page, same pattern as app/not-found.tsx: server component,
// no client JS, no store access, so it renders for logged-out visitors.
export const metadata = {
  title: 'Risk Disclosure',
};

const page: React.CSSProperties = {
  minHeight: '100vh',
  backgroundColor: '#06060C',
  padding: '48px 24px 96px',
};
const wrap: React.CSSProperties = { maxWidth: 680, margin: '0 auto' };
const eyebrow: React.CSSProperties = {
  fontFamily: 'var(--font-pixel-mono), monospace',
  fontSize: 12,
  letterSpacing: 2,
  textTransform: 'uppercase',
  color: 'rgba(255,213,128,0.7)',
  marginBottom: 10,
};
const h1: React.CSSProperties = {
  fontFamily: 'var(--font-pixel), Georgia, serif',
  fontSize: 26,
  fontWeight: 700,
  color: '#FFD580',
  textShadow: '0 1px 2px rgba(0,0,0,0.85)',
  marginBottom: 16,
};
const h2: React.CSSProperties = {
  fontFamily: 'var(--font-pixel), Georgia, serif',
  fontSize: 16,
  fontWeight: 700,
  color: '#FFD580',
  marginTop: 32,
  marginBottom: 10,
};
const body: React.CSSProperties = {
  fontFamily: 'var(--font-pixel-mono), monospace',
  fontSize: 13,
  lineHeight: 1.7,
  color: 'rgba(255,255,255,0.72)',
  marginBottom: 12,
};
const draft: React.CSSProperties = {
  ...body,
  color: '#F0A878',
  border: '1px solid rgba(240,168,120,0.4)',
  backgroundColor: 'rgba(240,168,120,0.08)',
  borderRadius: 8,
  padding: 14,
  marginBottom: 28,
};
const link: React.CSSProperties = { color: '#FFD580', textDecoration: 'underline' };

export default function RiskPage() {
  return (
    <div style={page}>
      <div style={wrap}>
        <p style={eyebrow}>Locked In</p>
        <h1 style={h1}>Risk Disclosure</h1>

        <p style={draft}>
          DRAFT — PENDING LEGAL REVIEW. Not reviewed or approved by a lawyer. Read it anyway: it is
          an honest list of how you can lose money here.
        </p>

        <p style={body}>
          Locking USDC on Locked In puts real money at risk. You may get back less than you put in.
          Only lock what you can afford to lose entirely.
        </p>

        <h2 style={h2}>Your principal is not guaranteed</h2>
        <p style={body}>
          We never take principal as a penalty — lapse penalties touch yield only. That is a
          promise about our rules, not about the value of your deposit. Your USDC is supplied to
          Kamino while the lock is open, and if the position redeems for less than you deposited,
          you receive the smaller amount. The shortfall is absorbed by you, not by the community pot
          and not by us.
        </p>

        <h2 style={h2}>Kamino protocol risk</h2>
        <p style={body}>
          Kamino is a third party we do not control. A smart-contract exploit, a bad-debt event, a
          liquidation cascade or a socialized loss in the lending market can reduce the value of the
          position holding your deposit. Kamino illiquidity can also delay withdrawal.
        </p>

        <h2 style={h2}>USDC risk</h2>
        <p style={body}>
          USDC is issued by a third party. It can lose its peg to the US dollar, be frozen at the
          issuer&rsquo;s discretion, or be affected by the issuer&rsquo;s own solvency and banking
          arrangements.
        </p>

        <h2 style={h2}>Solana network risk</h2>
        <p style={body}>
          Solana can halt, congest or fork. During such an event you may be unable to deposit,
          claim or exit at the moment you want to.
        </p>

        <h2 style={h2}>Unaudited beta software</h2>
        <p style={body}>
          Our on-chain programs have not completed a third-party security audit. A bug in our code
          could lock, misdirect or lose funds. Our operational keys sign settlement; a compromise of
          those keys is a real risk. Beta caps ($10–$50 per lock, $1,000 total) exist to bound the
          damage, not to eliminate it.
        </p>

        <h2 style={h2}>Yield is not guaranteed</h2>
        <p style={body}>
          Yield comes from Kamino market rates, which float and can be near zero. Any yield figure
          shown in the app is an estimate based on current rates, not a promise. Over a short course
          the yield on a $10–$50 deposit is small in absolute terms.
        </p>

        <h2 style={h2}>You can forfeit yield</h2>
        <p style={body}>
          If you lapse after your shields are spent, you forfeit 50% of your yield on the first
          lapse and 100% on the second. Forfeited yield goes to a community pot that is
          redistributed to other users. This is the core mechanic, not a fee — it is designed to
          cost you something when you stop showing up.
        </p>

        <h2 style={h2}>Exit timing</h2>
        <p style={body}>
          Your deposit is not freely withdrawable on demand. The normal exit is completing the
          course. The fallback is the 180-day force return, after which the position can be returned
          to you by anyone. Plan for the possibility that your money is unavailable for that long.
        </p>

        <h2 style={h2}>Tax and legal</h2>
        <p style={body}>
          Yield you receive may be taxable where you live. We do not provide tax, legal or
          investment advice, and nothing in the app is a recommendation to deposit.
        </p>

        <p style={{ ...body, marginTop: 32 }}>
          <Link href="/terms" style={link}>
            Terms
          </Link>{' '}
          ·{' '}
          <Link href="/privacy" style={link}>
            Privacy
          </Link>{' '}
          ·{' '}
          <Link href="/village" style={link}>
            Back to the village
          </Link>
        </p>
      </div>
    </div>
  );
}
