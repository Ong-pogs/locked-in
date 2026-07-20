import Link from 'next/link';

// Standalone styled page, same pattern as app/not-found.tsx: server component,
// no client JS, no store access, so it renders for logged-out visitors and
// crawlers. Styles are inline per-file rather than shared — these three legal
// pages are edited by lawyers, not designers, and each must stand alone.
export const metadata = {
  title: 'Terms of Service',
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

export default function TermsPage() {
  return (
    <div style={page}>
      <div style={wrap}>
        <p style={eyebrow}>Locked In</p>
        <h1 style={h1}>Terms of Service</h1>

        <p style={draft}>
          DRAFT — PENDING LEGAL REVIEW. This document has not been reviewed or approved by a
          lawyer. It describes how the software actually behaves today so you can decide whether to
          use it. It is not legal advice and it is not a final agreement.
        </p>
        <p style={draft}>
          NO PUBLISHED ENTITY OR CONTACT CHANNEL. Locked In is run by the project team as an
          unincorporated beta. We have not published a legal entity, a registered address or a
          contact address. These terms therefore do not name a company you can hold to them, and
          there is no published channel for questions, complaints or disputes. Do not lock money on
          the assumption that a support desk or a legal counterparty exists.
        </p>

        <h2 style={h2}>1. What Locked In does</h2>
        <p style={body}>
          You lock USDC against a course. While the lock is open, the USDC is supplied to Kamino, a
          third-party lending protocol on Solana, where it may earn yield. When you complete the
          course, you can claim your principal back together with whatever yield you have kept.
        </p>

        <h2 style={h2}>2. Custody</h2>
        <p style={body}>
          Locked In does not hold your funds in a company bank account. Your USDC is held by an
          on-chain Solana program under a lock account tied to your wallet. We operate the program
          and hold the authority key that signs completion vouchers and settlement. That means we
          can be a point of failure: a bug in the program, a compromise of our operational keys, or
          an error in our backend can affect your funds.
        </p>

        <h2 style={h2}>3. Beta limits</h2>
        <p style={body}>
          During the capped beta, a single lock is between $10 and $50 USDC, and total value locked
          across all users is capped at $1,000. These caps exist to limit how much anyone can lose
          while the software is young.
        </p>

        <h2 style={h2}>4. Lapse penalties</h2>
        <p style={body}>
          If you stop learning and your shields are spent, you forfeit yield — 50% of your yield on
          the first lapse and 100% on the second. Forfeited yield goes to a community pot that is
          redistributed to other users who kept their streaks. Penalties apply to yield only. We
          never take your principal as a penalty.
        </p>

        <h2 style={h2}>5. Getting your money out</h2>
        <p style={body}>
          The normal exit is completing the course and claiming. As a fallback, 180 days after a
          lock starts, the lock becomes force-returnable and anyone — including you — can trigger
          it. A force return pays back your principal only: 100% of the yield the deposit accrued
          is forfeited to the community pot, no matter why the force return happened or how well
          you kept your streak. It exists so a lock can never be stranded by us failing to sign,
          going offline, or disappearing — but it is a rescue, not an equivalent exit, and taking
          it costs you all of your yield.
        </p>

        <h2 style={h2}>6. No guarantee of yield, no guarantee of principal</h2>
        <p style={body}>
          Yield depends entirely on Kamino market rates and may be zero. Principal is exposed to
          Kamino protocol risk, USDC issuer risk and Solana network risk. See the{' '}
          <Link href="/risk" style={link}>
            Risk Disclosure
          </Link>{' '}
          for the specific ways you can lose money.
        </p>

        <h2 style={h2}>7. Unaudited beta software</h2>
        <p style={body}>
          The on-chain programs have not completed a third-party security audit. The software is
          provided &ldquo;as is&rdquo;, without warranties of any kind. Do not lock money you cannot
          afford to lose.
        </p>

        <h2 style={h2}>8. Your responsibilities</h2>
        <p style={body}>
          You are responsible for the security of your wallet, for any taxes arising from yield you
          receive, and for confirming that using this service is lawful where you live. You must be
          old enough to enter a contract in your jurisdiction.
        </p>

        <h2 style={h2}>9. Changes to these terms</h2>
        <p style={body}>
          We may update these terms. Material changes bump the terms version, and you will be asked
          to accept again before your next lock.
        </p>

        <h2 style={h2}>10. Who operates this, and how to reach us</h2>
        <p style={body}>
          Locked In is operated by the project team during an unincorporated beta. There is
          currently no published legal entity, registered address or contact address, and therefore
          no channel through which you can raise a question, a complaint or a dispute. We are not
          naming a company or an email here that we cannot stand behind. Both will be published
          before the beta caps are raised, and this section will be replaced with them.
        </p>

        <p style={{ ...body, marginTop: 32 }}>
          <Link href="/risk" style={link}>
            Risk Disclosure
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
