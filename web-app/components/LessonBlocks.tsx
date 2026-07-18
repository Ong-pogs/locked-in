'use client';

import type { ReactNode } from 'react';
import { T } from '@/components/theme';
import type { LessonBlock, ConceptItem, KVItem } from '@/types';

/* ── Inline Formatting ──────────────────────────────────────────────── */

export function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} style={{ color: T.textPrimary, fontWeight: 600 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          style={{
            fontFamily: 'monospace',
            fontSize: 13,
            background: 'rgba(212,160,74,0.1)',
            border: '1px solid rgba(212,160,74,0.15)',
            color: T.amber,
            padding: '2px 8px',
            borderRadius: 5,
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/* ── RichParagraph ──────────────────────────────────────────────────── */

function RichParagraph({ block }: { block: LessonBlock }) {
  const text = block.text ?? '';
  const paragraphs = text.split('\n\n').filter((p) => p.trim());

  return (
    <div>
      {paragraphs.map((paragraph, i) => {
        const lines = paragraph.trim().split('\n');
        const firstLine = lines[0].trim();

        // Detect heading: short first line, no period, single line
        const looksLikeHeading =
          firstLine.length < 80 &&
          !firstLine.endsWith('.') &&
          !firstLine.endsWith(':') &&
          !firstLine.startsWith('- ') &&
          !firstLine.startsWith('\u2022 ') &&
          !/^\d+\.\s/.test(firstLine) &&
          lines.length === 1;

        if (looksLikeHeading) {
          return (
            <h3
              key={i}
              style={{
                fontFamily: 'Georgia, serif',
                fontSize: 22,
                fontWeight: 700,
                color: T.textPrimary,
                lineHeight: 1.3,
                marginBottom: 14,
                marginTop: i > 0 ? 24 : 0,
              }}
            >
              {firstLine}
            </h3>
          );
        }

        // All-list paragraph
        const isAllList = lines.every((l) => {
          const t = l.trim();
          return t.startsWith('- ') || t.startsWith('\u2022 ') || /^\d+\.\s/.test(t) || !t;
        });

        if (isAllList) {
          return (
            <div key={i} style={{ marginLeft: 8, marginTop: 12, marginBottom: 12 }}>
              {lines.map((line, j) => {
                const t = line.trim();
                if (!t) return null;

                const numMatch = t.match(/^(\d+)\.\s(.*)/);
                if (numMatch) {
                  return (
                    <div key={j} style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: T.amber,
                          flexShrink: 0,
                          width: 20,
                          textAlign: 'right',
                        }}
                      >
                        {numMatch[1]}.
                      </span>
                      <p style={{ fontSize: 15, lineHeight: 1.6, color: 'rgba(255,255,255,0.85)', flex: 1, margin: 0 }}>
                        {renderInline(numMatch[2])}
                      </p>
                    </div>
                  );
                }

                if (t.startsWith('- ') || t.startsWith('\u2022 ')) {
                  return (
                    <div key={j} style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                      <span style={{ fontSize: 8, marginTop: 8, flexShrink: 0, color: T.amber }}>{'\u25CF'}</span>
                      <p style={{ fontSize: 15, lineHeight: 1.6, color: 'rgba(255,255,255,0.85)', flex: 1, margin: 0 }}>
                        {renderInline(t.slice(2))}
                      </p>
                    </div>
                  );
                }

                return null;
              })}
            </div>
          );
        }

        // Mixed content
        const elements: ReactNode[] = [];
        let bodyLines: string[] = [];

        const flushBody = () => {
          if (bodyLines.length === 0) return;
          const joined = bodyLines.join(' ');
          elements.push(
            <p
              key={`body-${elements.length}`}
              style={{
                fontSize: 16,
                lineHeight: 1.75,
                color: 'rgba(255,255,255,0.65)',
                marginBottom: 20,
                marginTop: 0,
              }}
            >
              {renderInline(joined)}
            </p>,
          );
          bodyLines = [];
        };

        for (let j = 0; j < lines.length; j++) {
          const t = lines[j].trim();
          if (!t) {
            flushBody();
            continue;
          }

          // Heading-like first line in multi-line paragraph
          if (
            j === 0 &&
            lines.length > 1 &&
            t.length < 80 &&
            !t.endsWith('.') &&
            !t.startsWith('- ') &&
            !/^\d+\.\s/.test(t)
          ) {
            flushBody();
            elements.push(
              <h3
                key={`h-${j}`}
                style={{
                  fontFamily: 'Georgia, serif',
                  fontSize: 22,
                  fontWeight: 700,
                  color: T.textPrimary,
                  lineHeight: 1.3,
                  marginBottom: 14,
                  marginTop: i > 0 ? 24 : 0,
                }}
              >
                {t}
              </h3>,
            );
            continue;
          }

          // Numbered list item
          const numMatch = t.match(/^(\d+)\.\s(.*)/);
          if (numMatch) {
            flushBody();
            elements.push(
              <div key={`num-${j}`} style={{ display: 'flex', gap: 12, marginLeft: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: T.amber, flexShrink: 0, width: 20, textAlign: 'right' }}>
                  {numMatch[1]}.
                </span>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: 'rgba(255,255,255,0.85)', flex: 1, margin: 0 }}>
                  {renderInline(numMatch[2])}
                </p>
              </div>,
            );
            continue;
          }

          // Bullet item
          if (t.startsWith('- ') || t.startsWith('\u2022 ')) {
            flushBody();
            elements.push(
              <div key={`bullet-${j}`} style={{ display: 'flex', gap: 12, marginLeft: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 8, marginTop: 8, flexShrink: 0, color: T.amber }}>{'\u25CF'}</span>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: 'rgba(255,255,255,0.85)', flex: 1, margin: 0 }}>
                  {renderInline(t.slice(2))}
                </p>
              </div>,
            );
            continue;
          }

          bodyLines.push(t);
        }

        flushBody();

        return elements.length === 1 ? (
          <div key={i}>{elements[0]}</div>
        ) : (
          <div key={i}>{elements}</div>
        );
      })}
    </div>
  );
}

/* ── AnalogyBox ─────────────────────────────────────────────────────── */

function AnalogyBox({ block }: { block: LessonBlock }) {
  return (
    <div
      style={{
        background: 'rgba(14,14,28,0.88)',
        border: '1px solid rgba(212,160,74,0.12)',
        borderRadius: 14,
        padding: 24,
        margin: '24px 0',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 1.5,
          color: T.amber,
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {'\uD83D\uDCA1'} Analogy{block.title ? ` \u2014 ${block.title}` : ''}
      </div>
      <p
        style={{
          fontSize: 16,
          lineHeight: 1.75,
          color: 'rgba(255,255,255,0.65)',
          margin: 0,
        }}
      >
        {renderInline(block.text ?? '')}
      </p>
    </div>
  );
}

/* ── FlowSteps ──────────────────────────────────────────────────────── */

function FlowSteps({ block }: { block: LessonBlock }) {
  const steps = block.steps ?? [];

  return (
    <ol style={{ display: 'flex', flexDirection: 'column', gap: 0, margin: '24px 0', listStyle: 'none', padding: 0 }}>
      {steps.map((step, idx) => {
        const isGreen = step.color === 'green';
        const numberBg = isGreen ? 'rgba(62,230,138,0.1)' : 'rgba(212,160,74,0.1)';
        const numberColor = isGreen ? T.green : T.amber;
        const numberBorder = isGreen ? 'rgba(62,230,138,0.2)' : 'rgba(212,160,74,0.2)';

        return (
          <li key={idx}>
            {/* Connector line between steps */}
            {idx > 0 && (
              <div style={{ width: 32, display: 'flex', justifyContent: 'center', padding: 0 }}>
                <div style={{ width: 2, height: 20, background: 'rgba(212,160,74,0.15)' }} />
              </div>
            )}
            {/* Step */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '14px 0' }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: step.icon ? 16 : 14,
                  fontWeight: 700,
                  flexShrink: 0,
                  background: numberBg,
                  color: numberColor,
                  border: `1px solid ${numberBorder}`,
                }}
              >
                {step.icon ?? (isGreen ? '\u2714' : idx + 1)}
              </div>
              <div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: isGreen ? T.green : T.textPrimary,
                    marginBottom: 3,
                  }}
                >
                  {renderInline(step.title)}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(255,255,255,0.5)' }}>
                  {renderInline(step.desc)}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ── ConceptList ────────────────────────────────────────────────────── */

function ConceptList({ block }: { block: LessonBlock }) {
  const items = (block.items ?? []) as ConceptItem[];

  return (
    <div style={{ margin: '20px 0' }}>
      {block.text && (
        <p style={{ fontSize: 16, lineHeight: 1.75, color: 'rgba(255,255,255,0.65)', marginBottom: 16 }}>
          {renderInline(block.text)}
        </p>
      )}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {items.map((item, idx) => (
          <li
            key={idx}
            style={{
              display: 'flex',
              gap: 16,
              padding: '16px 0',
              borderBottom: idx < items.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                flexShrink: 0,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {item.icon}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.textPrimary, marginBottom: 3 }}>
                {item.name}
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(255,255,255,0.5)' }}>
                {renderInline(item.desc)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── ComparisonTable ────────────────────────────────────────────────── */

function ComparisonTable({ block }: { block: LessonBlock }) {
  const headers = block.headers ?? [];
  const rows = block.rows ?? [];
  const highlightRow = block.highlightRow ?? null;

  return (
    // Wide tables (4-5 columns) scroll inside their own box on narrow
    // viewports instead of stretching the whole page horizontally.
    <div style={{ overflowX: 'auto', margin: '20px 0' }}>
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 14,
      }}
    >
      <thead>
        <tr>
          {headers.map((h, idx) => (
            <th
              key={idx}
              style={{
                textAlign: 'left',
                padding: '10px 14px',
                fontFamily: 'monospace',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: 1.5,
                color: 'rgba(255,255,255,0.35)',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.02)',
                fontWeight: 400,
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIdx) => {
          const isHighlighted = highlightRow !== null && rowIdx === highlightRow;
          return (
            <tr key={rowIdx}>
              {row.map((cell, cellIdx) => (
                <td
                  key={cellIdx}
                  style={{
                    padding: '12px 14px',
                    borderBottom: rowIdx < rows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    color: cellIdx === 0 ? T.textPrimary : 'rgba(255,255,255,0.65)',
                    fontWeight: cellIdx === 0 ? 600 : 400,
                    background: isHighlighted ? 'rgba(153,69,255,0.04)' : 'transparent',
                  }}
                >
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

/* ── ChainCards ──────────────────────────────────────────────────────── */

const chainThemes: Record<string, { color: string; bg: string; border: string }> = {
  btc: { color: '#F7931A', bg: 'rgba(247,147,26,0.04)', border: '#F7931A' },
  eth: { color: '#627EEA', bg: 'rgba(98,126,234,0.04)', border: '#627EEA' },
  sol: { color: '#9945FF', bg: 'rgba(153,69,255,0.04)', border: '#9945FF' },
};

function ChainCards({ block }: { block: LessonBlock }) {
  const chains = block.chains ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '20px 0' }}>
      {chains.map((chain, idx) => {
        const theme = chainThemes[chain.theme] ?? chainThemes.sol;
        return (
          <div
            key={idx}
            style={{
              background: theme.bg,
              borderLeft: `3px solid ${theme.border}`,
              borderRadius: '0 12px 12px 0',
              padding: '18px 22px',
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: theme.color, marginBottom: 2 }}>
              {chain.name}
            </div>
            <div
              style={{
                fontSize: 13,
                textTransform: 'uppercase',
                letterSpacing: 1.5,
                color: 'rgba(255,255,255,0.35)',
                marginBottom: 10,
              }}
            >
              {chain.tagline}
            </div>
            <p style={{ fontSize: 15, lineHeight: 1.65, color: 'rgba(255,255,255,0.6)', margin: '0 0 12px 0' }}>
              {renderInline(chain.desc)}
            </p>
            {chain.stats.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {chain.stats.map((stat, sIdx) => (
                  <span
                    key={sIdx}
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 11,
                      padding: '4px 10px',
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      color: 'rgba(255,255,255,0.55)',
                    }}
                  >
                    {stat}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── ScamCard ────────────────────────────────────────────────────────── */

function ScamCard({ block }: { block: LessonBlock }) {
  return (
    <div
      style={{
        background: 'rgba(14,14,28,0.88)',
        border: '1px solid rgba(255,68,102,0.1)',
        borderRadius: 12,
        padding: '18px 20px',
        marginBottom: 10,
      }}
    >
      {/* SCAM #N label */}
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: 11,
          color: T.crimson,
          fontWeight: 700,
          marginBottom: 4,
        }}
      >
        SCAM #{block.number ?? 0}
      </div>

      {/* Title */}
      <div style={{ fontSize: 16, fontWeight: 700, color: T.textPrimary, marginBottom: 6 }}>
        {block.title ?? ''}
      </div>

      {/* Fake DM preview */}
      {block.example && block.exampleSender && (
        <div
          style={{
            background: 'rgba(14,14,28,0.9)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 14,
            padding: '16px 18px',
            margin: '16px 0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            {/* Avatar */}
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'rgba(255,68,102,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                color: T.crimson,
              }}
            >
              {'\u26A0'}
            </div>
            {/* Sender name */}
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>
              {block.exampleSender}
            </span>
            {/* Scam badge */}
            <span
              style={{
                fontSize: 9,
                background: 'rgba(255,68,102,0.1)',
                color: T.crimson,
                padding: '2px 6px',
                borderRadius: 4,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              Scam
            </span>
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(255,255,255,0.55)', fontStyle: 'italic' }}>
            {block.example}
          </div>
        </div>
      )}

      {/* Non-DM example (no sender) */}
      {block.example && !block.exampleSender && (
        <div
          style={{
            fontSize: 13,
            fontStyle: 'italic',
            color: 'rgba(255,255,255,0.4)',
            background: 'rgba(255,68,102,0.04)',
            borderRadius: 8,
            padding: '10px 14px',
            margin: '8px 0',
            borderLeft: '2px solid rgba(255,68,102,0.15)',
          }}
        >
          {renderInline(block.example)}
        </div>
      )}

      {/* Rule */}
      {block.rule && (
        <div style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(255,255,255,0.6)' }}>
          <strong style={{ color: T.textPrimary, fontWeight: 600 }}>The rule:</strong>{' '}
          {renderInline(block.rule)}
        </div>
      )}
    </div>
  );
}

/* ── Checklist ───────────────────────────────────────────────────────── */

function Checklist({ block }: { block: LessonBlock }) {
  const items = (block.items ?? []) as string[];

  return (
    <ul style={{ margin: '20px 0', padding: 0, listStyle: 'none' }}>
      {items.map((item, idx) => (
        <li
          key={idx}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '10px 0',
            borderBottom: idx < items.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
          }}
        >
          {/* Checkbox */}
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 5,
              border: '1.5px solid rgba(62,230,138,0.3)',
              flexShrink: 0,
              marginTop: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              color: T.green,
            }}
          >
            {'\u2713'}
          </div>
          {/* Text */}
          <div style={{ fontSize: 15, lineHeight: 1.6, color: 'rgba(255,255,255,0.6)' }}>
            {renderInline(item)}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── TakeawayBox ─────────────────────────────────────────────────────── */

function TakeawayBox({ block }: { block: LessonBlock }) {
  return (
    <div
      style={{
        background: 'rgba(62,230,138,0.04)',
        borderLeft: '3px solid rgba(62,230,138,0.3)',
        borderRadius: '0 12px 12px 0',
        padding: '18px 22px',
        margin: '24px 0',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 1.5,
          color: T.green,
          marginBottom: 8,
        }}
      >
        {'\u2714'} Key Takeaway
      </div>
      <p style={{ fontSize: 15, lineHeight: 1.65, color: 'rgba(255,255,255,0.65)', margin: 0 }}>
        {renderInline(block.text ?? '')}
      </p>
    </div>
  );
}

/* ── KVGrid ──────────────────────────────────────────────────────────── */

const kvColors: Record<string, string> = {
  default: '#E8DED0',
  red: '#FF4466',
  green: '#3EE68A',
  amber: '#D4A04A',
};

function KVGrid({ block }: { block: LessonBlock }) {
  const items = (block.items ?? []) as KVItem[];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
        margin: '20px 0',
      }}
    >
      {items.map((item, idx) => (
        <div
          key={idx}
          style={{
            background: 'rgba(14,14,28,0.88)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 10,
            padding: '14px 16px',
          }}
        >
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: 9,
              textTransform: 'uppercase',
              letterSpacing: 1.5,
              color: 'rgba(255,255,255,0.3)',
              marginBottom: 4,
            }}
          >
            {item.label}
          </div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: kvColors[item.color ?? 'default'] ?? kvColors.default,
            }}
          >
            {item.value}
          </div>
          {item.desc && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
              {item.desc}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── CodeBlock ────────────────────────────────────────────────────────── */

function CodeBlock({ block }: { block: LessonBlock }) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: '1px solid rgba(212,160,74,0.15)',
        overflow: 'hidden',
        margin: '16px 0',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'rgba(212,160,74,0.06)',
          borderBottom: '1px solid rgba(212,160,74,0.1)',
        }}
      >
        <svg viewBox="0 0 16 16" width={12} height={12} fill="none">
          <path
            d="M5 4L1 8l4 4M11 4l4 4-4 4"
            stroke={T.amber}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: 9,
            textTransform: 'uppercase',
            letterSpacing: 1.5,
            color: T.amber,
          }}
        >
          {block.language ?? 'Example'}
        </span>
      </div>
      {/* Code body */}
      <pre
        style={{
          padding: '16px 20px',
          overflowX: 'auto',
          fontSize: 13,
          lineHeight: '22px',
          fontFamily: 'monospace',
          background: 'rgba(0,0,0,0.4)',
          color: 'rgba(255,255,255,0.85)',
          margin: 0,
        }}
      >
        {block.text ?? ''}
      </pre>
    </div>
  );
}

/* ── ImageBlock ───────────────────────────────────────────────────────── */

function ImageBlock({ block }: { block: LessonBlock }) {
  if (!block.imageUrl) return null;
  return (
    <figure style={{ margin: '16px 0' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={block.imageUrl}
        alt={block.caption ?? ''}
        style={{
          width: '100%',
          borderRadius: 12,
          border: `1px solid ${T.borderDormant}`,
        }}
      />
      {block.caption && (
        <figcaption
          style={{
            textAlign: 'center',
            fontSize: 12,
            marginTop: 8,
            color: T.textMuted,
          }}
        >
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}

/* ── DefaultCallout ──────────────────────────────────────────────────── */

function DefaultCallout({ block }: { block: LessonBlock }) {
  const tone = block.calloutTone ?? 'info';
  const toneConfig = {
    info: { color: T.amber, bg: 'rgba(212,160,74,0.04)', border: 'rgba(212,160,74,0.25)' },
    warning: { color: T.crimson, bg: 'rgba(255,68,102,0.04)', border: 'rgba(255,68,102,0.3)' },
    tip: { color: T.green, bg: 'rgba(62,230,138,0.04)', border: 'rgba(62,230,138,0.3)' },
  }[tone];

  const text = block.text ?? '';
  const lines = text.split('\n').filter(Boolean);
  const firstLine = lines[0] ?? '';
  const colonIdx = firstLine.indexOf(':');
  const hasTitle = colonIdx > 0 && colonIdx < 60;
  const title = hasTitle ? firstLine.slice(0, colonIdx).trim() : null;
  const bodyStart = hasTitle ? firstLine.slice(colonIdx + 1).trim() : firstLine;
  const bodyLines = [bodyStart, ...lines.slice(1)].filter(Boolean);

  return (
    <div
      style={{
        background: toneConfig.bg,
        borderLeft: `3px solid ${toneConfig.border}`,
        borderRadius: '0 12px 12px 0',
        padding: '18px 22px',
        margin: '24px 0',
      }}
    >
      {title && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 1.5,
            color: toneConfig.color,
            marginBottom: 8,
          }}
        >
          {tone === 'warning' && '\u26A0 '}{title}
        </div>
      )}
      {bodyLines.map((line, idx) => (
        <p
          key={idx}
          style={{
            fontSize: 15,
            lineHeight: 1.65,
            color: 'rgba(255,255,255,0.6)',
            marginBottom: idx < bodyLines.length - 1 ? 6 : 0,
            marginTop: 0,
          }}
        >
          {renderInline(line)}
        </p>
      ))}
    </div>
  );
}

/* ── Main Export: LessonBlockRenderer ─────────────────────────────────── */

export function LessonBlockRenderer({ block }: { block: LessonBlock }) {
  // Variant takes priority over type
  switch (block.variant) {
    case 'analogy':
      return <AnalogyBox block={block} />;
    case 'flow':
      return <FlowSteps block={block} />;
    case 'concepts':
      return <ConceptList block={block} />;
    case 'comparison':
      return <ComparisonTable block={block} />;
    case 'chain-cards':
      return <ChainCards block={block} />;
    case 'scam':
      return <ScamCard block={block} />;
    case 'checklist':
      return <Checklist block={block} />;
    case 'takeaway':
      return <TakeawayBox block={block} />;
    case 'kv-grid':
      return <KVGrid block={block} />;
  }

  // Fall back to type
  switch (block.type) {
    case 'paragraph':
      return <RichParagraph block={block} />;
    case 'code':
      return <CodeBlock block={block} />;
    case 'callout':
      return <DefaultCallout block={block} />;
    case 'image':
      return <ImageBlock block={block} />;
    default:
      return <RichParagraph block={block} />;
  }
}
