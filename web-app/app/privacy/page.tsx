import Link from 'next/link';

// Standalone styled page, same pattern as app/not-found.tsx: server component,
// no client JS, no store access, so it renders for logged-out visitors.
export const metadata = {
  title: 'Privacy Policy',
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

export default function PrivacyPage() {
  return (
    <div style={page}>
      <div style={wrap}>
        <p style={eyebrow}>Locked In</p>
        <h1 style={h1}>Privacy Policy</h1>

        <p style={draft}>
          DRAFT — PENDING LEGAL REVIEW. This document has not been reviewed or approved by a
          lawyer. It describes what the app actually collects today.
        </p>
        <p style={draft}>
          NO PUBLISHED ENTITY OR CONTACT CHANNEL. Locked In is run by the project team as an
          unincorporated beta. No legal entity, data controller or contact address has been
          published, so there is currently no working channel for you to request access to or
          deletion of your data, and no named controller to complain to. Assume that anything you
          give the app cannot be recalled on request. See &ldquo;Retention and your
          choices&rdquo; below for what you can actually control today.
        </p>

        <h2 style={h2}>What we collect</h2>
        <p style={body}>
          <strong style={{ color: 'rgba(255,255,255,0.9)' }}>Account.</strong> We use Privy for
          login. Privy collects your email address and your wallet address, and it may create and
          hold an embedded wallet for you. Privy is a third-party processor with its own privacy
          policy.
        </p>
        <p style={body}>
          <strong style={{ color: 'rgba(255,255,255,0.9)' }}>Learning activity.</strong> Lessons you
          open, answers you submit, quiz results, streaks, shields and lapses. This is what the
          penalty and reward mechanics run on.
        </p>
        <p style={body}>
          <strong style={{ color: 'rgba(255,255,255,0.9)' }}>On-chain activity.</strong> Your wallet
          address, lock accounts, deposit and claim transactions. This data is public on the Solana
          blockchain by design — we do not put it there privately and we cannot remove it.
        </p>
        <p style={body}>
          <strong style={{ color: 'rgba(255,255,255,0.9)' }}>Consent records.</strong> When you
          accept the Terms and Risk Disclosure before a deposit, we store which version you accepted
          and when.
        </p>
        <p style={body}>
          <strong style={{ color: 'rgba(255,255,255,0.9)' }}>Technical logs.</strong> Ordinary
          server request logs, including IP address, used for debugging and abuse prevention.
        </p>

        <h2 style={h2}>What we do not collect</h2>
        <p style={body}>
          We never ask for and never store your seed phrase or private keys. We do not collect
          government ID, and we do not sell personal data.
        </p>

        <h2 style={h2}>Why we hold it</h2>
        <p style={body}>
          To run your account, to compute streaks and yield outcomes, to prevent cheating and abuse,
          and to keep a record that you were shown the risk disclosure before committing funds.
        </p>

        <h2 style={h2}>Who it is shared with</h2>
        <p style={body}>
          Privy (authentication and embedded wallets), our hosting and database providers, and
          Solana RPC providers who see the transactions we submit on your behalf. Kamino is
          interacted with on-chain only — we send no personal data to it.
        </p>

        <h2 style={h2}>Public by nature</h2>
        <p style={body}>
          Anything on-chain — your wallet address, deposits, claims, pot distributions — is
          permanently public and linkable. Leaderboards display your progress to other users.
        </p>

        <h2 style={h2}>Local storage on your device</h2>
        <p style={body}>
          The app stores session tokens, cached progress and your terms acceptance in your
          browser&rsquo;s local storage. Clearing site data logs you out; it does not affect your
          on-chain lock.
        </p>

        <h2 style={h2}>Retention and your choices</h2>
        <p style={body}>
          We keep account and learning data while your account exists and while any lock is open.
          On-chain records cannot be deleted by anyone, including us.
        </p>
        <p style={body}>
          We have not yet published a contact address, so we cannot honestly offer you a deletion
          or access request channel right now — do not assume one exists. What is genuinely in your
          control today: the only personal data the app requires is the email and wallet address
          held by Privy, which has its own privacy policy and its own account deletion process; and
          clearing your browser&rsquo;s site data removes the copy stored on your device. Given
          that, treat the beta as somewhere not to put data you would later need erased.
        </p>

        <p style={{ ...body, marginTop: 32 }}>
          <Link href="/terms" style={link}>
            Terms
          </Link>{' '}
          ·{' '}
          <Link href="/risk" style={link}>
            Risk Disclosure
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
