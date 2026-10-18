'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Eye, EyeOff, Copy, CheckCheck } from 'lucide-react';

const COPY_RESET_MS = 1600;
export function Field({ label, value, secret, multiline, onCopy }: Readonly<{
  label: string;
  value: string;
  secret?: boolean;
  multiline?: boolean;
  onCopy?: () => Promise<boolean>;
}>) {
  const [show, setShow] = useState(!secret);
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!onCopy || copying) return;
    setCopying(true);
    setCopied(false);
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    try {
      if (await onCopy()) {
        setCopied(true);
        copyResetRef.current = setTimeout(() => setCopied(false), COPY_RESET_MS);
      }
    } catch {
      setCopied(false);
    } finally {
      setCopying(false);
    }
  }, [onCopy, copying]);

  const toggleShow = useCallback(() => setShow(s => !s), []);

  const masked = secret && !show;

  return (
    <div className="px-4 py-4 sm:px-5">
      <p className="mb-1.5 text-[13px] font-medium tracking-wide text-[var(--text-secondary)]">
        {label}
      </p>
      <div className="flex min-w-0 items-center gap-3">
        <p className={`min-w-0 flex-1 [overflow-wrap:anywhere] text-base font-normal leading-6 text-[var(--text-primary)] ${secret ? 'font-mono' : ''} ${masked ? 'tracking-widest' : ''} ${multiline ? 'whitespace-pre-wrap' : ''}`}>
          {masked ? '••••••••••••' : value}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {secret && (
            <button type="button" className="btn-icon !size-9" onClick={toggleShow} title={show ? `Hide ${label}` : `Reveal ${label}`} aria-label={show ? `Hide ${label}` : `Reveal ${label}`}>
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          )}
          {onCopy && (
            <button type="button" className={`btn-icon !size-9 ${copied ? '!text-[var(--success)]' : ''}`} onClick={() => { void handleCopy(); }} disabled={copying}
              title={copied ? `${label} copied` : `Copy ${label}`} aria-label={copied ? `${label} copied` : `Copy ${label}`}>
              {copied ? <CheckCheck size={17} /> : <Copy size={17} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Derive all display state from count in one place instead of three separate if/else chains
function getHibpStatus(count: number | null): { text: string; badge: string } {
  if (count === null) return { text: '', badge: '' };
  if (count === -1) return { text: 'Check failed', badge: 'text-[var(--text-secondary)]' };
  if (count === 0) return { text: '✓ Not found in any breaches', badge: 'badge badge-green' };
  return { text: `⚠ Found in ${count.toLocaleString()} breaches`, badge: 'badge badge-red' };
}

export function HibpCheck({ hibp, onCheck }: Readonly<{
  hibp: { checking: boolean; count: number | null };
  onCheck: () => void;
}>) {
  const { checking, count } = hibp;
  const { text, badge } = getHibpStatus(count);

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-4 sm:px-5">
      <button type="button" onClick={onCheck} disabled={checking} className="btn-ghost !min-h-8 !px-2.5 !py-1 !text-xs">
        {checking ? 'Checking…' : 'Check breaches'}
      </button>
      {count !== null && (
        <span className={`${badge} text-xs font-semibold`}>
          {text}
        </span>
      )}
    </div>
  );
}
