'use client';
import { useState } from 'react';
import { Eye, EyeOff, Copy, CheckCheck } from 'lucide-react';

export function Field({
  label,
  value,
  secret,
  onCopy,
}: Readonly<{
  label: string;
  value: string;
  secret?: boolean;
  multiline?: boolean;
  onCopy?: () => void;
}>) {
  const [show, setShow] = useState(!secret);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!onCopy) return;
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      className="glass"
      style={{ borderRadius: 'var(--radius-md)', padding: '13px 15px' }}
    >
      <p
        style={{
          fontSize: '0.67rem',
          fontWeight: 600,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          marginBottom: 7,
          fontFamily: 'var(--font-body)',
        }}
      >
        {label}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <p
          style={{
            flex: 1,
            fontSize: '0.92rem',
            color: 'var(--text-primary)',
            fontFamily: secret ? 'var(--font-mono), DM Mono, monospace' : 'inherit',
            wordBreak: 'break-all',
            lineHeight: 1.6,
            letterSpacing: secret && !show ? '0.08em' : 'inherit',
          }}
        >
          {secret && !show ? '••••••••••••' : value}
        </p>
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {secret && (
            <button
              className="btn-icon"
              onClick={() => setShow(!show)}
              title={show ? 'Hide' : 'Reveal'}
            >
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}
          {onCopy && (
            <button
              className="btn-icon"
              onClick={handleCopy}
              title="Copy"
              style={{ color: copied ? 'var(--success)' : undefined }}
            >
              {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function HibpCheck({
  hibp,
  onCheck,
}: Readonly<{
  hibp: { checking: boolean; count: number | null };
  onCheck: () => void;
}>) {
  const { checking, count } = hibp;

  let statusColor = 'var(--text-secondary)';
  if (count === 0) statusColor = 'var(--success)';
  else if (count !== null && count > 0) statusColor = 'var(--danger)';

  let statusText = '';
  if (count === -1) statusText = 'Check failed';
  else if (count === 0) statusText = '✓ Not found in any breaches';
  else if (count !== null) statusText = `⚠ Found in ${count.toLocaleString()} breaches`;

  let badgeClass = '';
  if (count === 0) badgeClass = 'badge badge-green';
  else if (count !== null && count > 0) badgeClass = 'badge badge-red';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: -4 }}>
      <button
        type="button"
        onClick={onCheck}
        disabled={checking}
        className="btn-ghost"
        style={{
          fontSize: '0.72rem',
          padding: '4px 10px',
          minHeight: 30,
          opacity: checking ? 0.6 : 1,
        }}
      >
        {checking ? 'Checking…' : 'Check breaches'}
      </button>
      {count !== null && (
        <span className={badgeClass || ''} style={{ color: statusColor, fontSize: '0.72rem', fontWeight: 600 }}>
          {statusText}
        </span>
      )}
    </div>
  );
}