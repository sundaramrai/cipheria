'use client';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}

export function Pagination({ page, totalPages, onPageChange }: Readonly<PaginationProps>) {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  const visible = pages.filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1
  );
  const withEllipsis: (number | '...')[] = [];
  for (let i = 0; i < visible.length; i++) {
    if (i > 0 && visible[i] - visible[i - 1] > 1) withEllipsis.push('...');
    withEllipsis.push(visible[i]);
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        padding: '10px 8px',
        borderTop: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      {/* Prev */}
      <button
        className="btn-icon"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
        style={{
          width: 30,
          height: 30,
          fontSize: '1rem',
          opacity: page === 1 ? 0.3 : 1,
          borderRadius: 'var(--radius-sm)',
        }}
      >
        ‹
      </button>

      {withEllipsis.map((p, i) => {
        const prevPage = i > 0 && typeof withEllipsis[i - 1] === 'number' ? withEllipsis[i - 1] : null;
        const nextPage = i < withEllipsis.length - 1 && typeof withEllipsis[i + 1] === 'number' ? withEllipsis[i + 1] : null;
        return p === '...' ? (
          <span
            key={`ellipsis-${prevPage}-${nextPage}`}
            style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem', padding: '0 3px' }}
          >
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            aria-current={p === page ? 'page' : undefined}
            style={{
              minWidth: 30,
              height: 30,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid',
              borderColor: p === page ? 'rgba(245,158,11,0.35)' : 'var(--border)',
              background: p === page ? 'var(--accent-dim)' : 'transparent',
              color: p === page ? 'var(--accent)' : 'var(--text-secondary)',
              fontWeight: p === page ? 600 : 400,
              cursor: 'pointer',
              fontSize: '0.78rem',
              fontFamily: 'var(--font-body)',
              transition: 'all 0.14s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {p}
          </button>
        );
      })}

      {/* Next */}
      <button
        className="btn-icon"
        disabled={page === totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
        style={{
          width: 30,
          height: 30,
          fontSize: '1rem',
          opacity: page === totalPages ? 0.3 : 1,
          borderRadius: 'var(--radius-sm)',
        }}
      >
        ›
      </button>
    </div>
  );
}