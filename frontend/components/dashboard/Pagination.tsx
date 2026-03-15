'use client';
import { useCallback } from 'react';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}

const BTN_STYLE = {
  width: 30, height: 30, fontSize: '1rem',
  borderRadius: 'var(--radius-sm)',
} as const;

function NavButton({ label, disabled, onClick }: Readonly<{
  label: string; disabled: boolean; onClick: () => void;
}>) {
  return (
    <button className="btn-icon" disabled={disabled} onClick={onClick}
      aria-label={label === '‹' ? 'Previous page' : 'Next page'}
      style={{ ...BTN_STYLE, opacity: disabled ? 0.3 : 1 }}>
      {label}
    </button>
  );
}

function PageButton({ p, isActive, onPageChange }: Readonly<{
  p: number; isActive: boolean; onPageChange: (p: number) => void;
}>) {
  const handleClick = useCallback(() => onPageChange(p), [onPageChange, p]);
  return (
    <button onClick={handleClick} aria-current={isActive ? 'page' : undefined}
      style={{
        minWidth: 30, height: 30, borderRadius: 'var(--radius-sm)',
        border: '1px solid',
        borderColor: isActive ? 'var(--accent-border-focus)' : 'var(--border)',
        background: isActive ? 'var(--accent-dim)' : 'transparent',
        color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
        fontWeight: isActive ? 600 : 400,
        cursor: 'pointer', fontSize: '0.78rem',
        fontFamily: 'var(--font-body)', transition: 'all 0.14s',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      {p}
    </button>
  );
}

export function Pagination({ page, totalPages, onPageChange }: Readonly<PaginationProps>) {
  const goPrev = useCallback(() => onPageChange(page - 1), [onPageChange, page]);
  const goNext = useCallback(() => onPageChange(page + 1), [onPageChange, page]);

  if (totalPages <= 1) return null;

  const visible: number[] = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1);

  const withEllipsis = visible.reduce<(number | string)[]>((acc, p, i) => {
    if (i > 0 && p - visible[i - 1] > 1) acc.push(`ellipsis-after-${visible[i - 1]}`);
    acc.push(p);
    return acc;
  }, []);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 3, padding: '10px 8px',
      borderTop: '1px solid var(--border)', flexShrink: 0,
    }}>
      <NavButton label="‹" disabled={page === 1} onClick={goPrev} />

      {withEllipsis.map(p =>
        typeof p === 'string' ? (
          <span key={p} style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem', padding: '0 3px' }}>
            …
          </span>
        ) : (
          <PageButton key={p} p={p} isActive={p === page} onPageChange={onPageChange} />
        )
      )}

      <NavButton label="›" disabled={page === totalPages} onClick={goNext} />
    </div>
  );
}
