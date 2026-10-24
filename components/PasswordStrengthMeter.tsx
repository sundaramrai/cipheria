'use client';

import { useEffect, useState } from 'react';
import type { PasswordStrength } from '@/lib/passwordStrength';

export function PasswordStrengthMeter({ password }: Readonly<{ password: string }>) {
  const [result, setResult] = useState<{ password: string; strength: PasswordStrength | null } | null>(null);
  useEffect(() => {
    if (!password) return;
    let active = true;
    const timer = setTimeout(() => {
      void import('@/lib/passwordStrength')
        .then(({ passwordStrength }) => {
          if (active) setResult({ password, strength: passwordStrength(password) });
        })
        .catch(() => {
          if (active) setResult({ password, strength: null });
        });
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [password]);

  if (!password) return null;
  const strength = result?.password === password ? result.strength : null;
  if (!strength) return <p className="mt-2 text-xs text-(--text-secondary)">
    {result?.password === password ? 'Strength estimate unavailable' : 'Estimating strength…'}
  </p>;

  return (
    <div className="mt-2">
      <div aria-hidden="true" className="mb-1.5 flex gap-1">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="h-0.5 flex-1 rounded-sm transition-colors"
            style={{ background: i <= strength.score ? strength.color : 'var(--skeleton-2)' }} />
        ))}
      </div>
      <span className="text-xs font-medium" style={{ color: strength.color }}>Estimated strength: {strength.label}</span>
      {strength.feedback && <p className="mt-1 text-xs leading-5 text-(--text-secondary)">{strength.feedback}</p>}
    </div>
  );
}
