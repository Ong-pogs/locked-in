import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Support',
  description: 'Get help with Locked In while keeping wallet secrets private.',
};

const body = {
  fontFamily: 'var(--font-pixel-mono), monospace',
  fontSize: 13,
  lineHeight: 1.7,
  color: 'rgba(255,255,255,0.74)',
} as const;

export default function SupportPage() {
  return (
    <main className="min-h-screen px-6 py-12" style={{ background: '#06060C' }}>
      <div className="mx-auto max-w-[680px]">
        <p
          className="font-pixel-mono text-xs uppercase tracking-[2px]"
          style={{ color: 'rgba(255,213,128,0.7)' }}
        >
          Locked In · Mainnet beta
        </p>
        <h1 className="mt-2 font-pixel text-[28px] font-bold" style={{ color: '#FFD580' }}>
          Get help without giving up your keys.
        </h1>
        <p className="mt-4" style={body}>
          Locked In support will never ask for your seed phrase, private key, recovery code, or a
          screen share of secret wallet material. Never paste those into an issue or direct message.
        </p>

        <section className="mt-8 rounded-xl border p-5" style={{ borderColor: 'rgba(255,213,128,0.24)', background: 'rgba(14,14,28,0.78)' }}>
          <h2 className="font-pixel text-lg" style={{ color: '#FFD580' }}>Before reporting a problem</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5" style={body}>
            <li>Do not retry a deposit or claim blindly if a transaction is still pending.</li>
            <li>Check the transaction in a Solana explorer and record its public signature.</li>
            <li>Note the page, approximate time, wallet type, and the exact message shown.</li>
            <li>Read the risk disclosure before moving more funds.</li>
          </ol>
        </section>

        <section className="mt-5 rounded-xl border p-5" style={{ borderColor: 'rgba(42,232,212,0.24)', background: 'rgba(14,14,28,0.78)' }}>
          <h2 className="font-pixel text-lg" style={{ color: '#2AE8D4' }}>Report it</h2>
          <p className="mt-3" style={body}>
            Use the repository issue tracker for non-sensitive product bugs. For a security issue,
            use the repository Security area and do not publish exploit details or wallet secrets.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href="https://github.com/Ong-pogs/locked-in/issues/new"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border px-4 py-3 font-pixel-mono text-xs font-bold uppercase tracking-[1px]"
              style={{ color: '#1A1000', background: '#FFD580', borderColor: '#FFE6AD' }}
            >
              Open a support issue
            </a>
            <a
              href="https://github.com/Ong-pogs/locked-in/security"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border px-4 py-3 font-pixel-mono text-xs font-bold uppercase tracking-[1px]"
              style={{ color: '#F0A878', borderColor: 'rgba(240,168,120,0.45)' }}
            >
              Security area
            </a>
          </div>
        </section>

        <nav className="mt-8 flex flex-wrap gap-4 font-pixel-mono text-xs" aria-label="Support links">
          <Link className="underline underline-offset-4" style={{ color: '#FFD580' }} href="/risk">Risk disclosure</Link>
          <Link className="underline underline-offset-4" style={{ color: '#FFD580' }} href="/terms">Terms</Link>
          <Link className="underline underline-offset-4" style={{ color: '#FFD580' }} href="/privacy">Privacy</Link>
          <Link className="underline underline-offset-4" style={{ color: '#FFD580' }} href="/village">Back to the village</Link>
        </nav>
      </div>
    </main>
  );
}
