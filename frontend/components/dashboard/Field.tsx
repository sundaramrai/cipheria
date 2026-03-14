'use client';
import { useState, useCallback } from 'react';
import { Eye, EyeOff, Copy, CheckCheck } from 'lucide-react';

const COPY_RESET_MS = 1600;
export function Field({ label, value, secret, onCopy }: Readonly<{
  label: string;
  value: string;
  secret?: boolean;
  multiline?: boolean;
  onCopy?: () => void;
}>) {
  const [show, setShow] = useState(!secret);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!onCopy) return;
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_RESET_MS);
  }, [onCopy]);

  const toggleShow = useCallback(() => setShow(s => !s), []);

  const masked = secret && !show;

  return (
    <div className="glass" style={{ borderRadius: 'var(--radius-md)', padding: '13px 15px' }}>
      <p style={{
        fontSize: '0.67rem', fontWeight: 600, letterSpacing: '0.09em',
        textTransform: 'uppercase', color: 'var(--text-tertiary)',
        marginBottom: 7, fontFamily: 'var(--font-body)',
      }}>
        {label}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <p style={{
          flex: 1, fontSize: '0.92rem', color: 'var(--text-primary)',
          fontFamily: secret ? 'var(--font-mono), DM Mono, monospace' : 'inherit',
          wordBreak: 'break-all', lineHeight: 1.6,
          letterSpacing: masked ? '0.08em' : 'inherit',
        }}>
          {masked ? '••••••••••••' : value}
        </p>
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {secret && (
            <button className="btn-icon" onClick={toggleShow} title={show ? 'Hide' : 'Reveal'}>
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}
          {onCopy && (
            <button className="btn-icon" onClick={handleCopy} title="Copy"
              style={{ color: copied ? 'var(--success)' : undefined }}>
              {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Derive all display state from count in one place instead of three separate if/else chains
function getHibpStatus(count: number | null): { color: string; text: string; badge: string } {
  if (count === null) return { color: 'var(--text-secondary)', text: '', badge: '' };
  if (count === -1) return { color: 'var(--text-secondary)', text: 'Check failed', badge: '' };
  if (count === 0) return { color: 'var(--success)', text: '✓ Not found in any breaches', badge: 'badge badge-green' };
  return { color: 'var(--danger)', text: `⚠ Found in ${count.toLocaleString()} breaches`, badge: 'badge badge-red' };
}

export function HibpCheck({ hibp, onCheck }: Readonly<{
  hibp: { checking: boolean; count: number | null };
  onCheck: () => void;
}>) {
  const { checking, count } = hibp;
  const { color, text, badge } = getHibpStatus(count);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: -4 }}>
      <button type="button" onClick={onCheck} disabled={checking} className="btn-ghost"
        style={{ fontSize: '0.72rem', padding: '4px 10px', minHeight: 30, opacity: checking ? 0.6 : 1 }}>
        {checking ? 'Checking…' : 'Check breaches'}
      </button>
      {count !== null && (
        <span className={badge} style={{ color, fontSize: '0.72rem', fontWeight: 600 }}>
          {text}
        </span>
      )}
    </div>
  );
}