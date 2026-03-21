'use client';
import { useEffect, Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Key, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import { useAuthForm } from '@/components/dashboard/hooks/useAuthForm';
import { authApi } from '@/lib/api';
import { parseApiError } from '@/lib/errors';
import { emitAuthEvent } from '@/lib/authSync';

const GLOW_STYLE = {
  position: 'fixed' as const,
  top: '30%',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(600px, 100vw)',
  height: 'min(600px, 100vw)',
  borderRadius: '50%',
  background: 'radial-gradient(ellipse, color-mix(in srgb, var(--accent) 8%, transparent) 0%, transparent 70%)',
  pointerEvents: 'none' as const,
};

const LOGO_WRAP_STYLE = {
  width: 44,
  height: 44,
  borderRadius: 10,
  flexShrink: 0,
  background: 'var(--accent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
} as const;

const CARD_STYLE = {
  borderRadius: 20,
  padding: 'clamp(24px, 6vw, 40px)',
} as const;

const WARNING_BOX_STYLE = {
  display: 'flex',
  gap: 8,
  marginTop: 10,
  padding: 'clamp(8px, 2vw, 10px) 12px',
  borderRadius: 8,
  background: 'var(--warning-bg)',
  border: '1px solid var(--warning-border)',
} as const;

function AuxShell({ title, children, centered = false }: Readonly<{ title: string; children: React.ReactNode; centered?: boolean }>) {
  return (
    <main
      style={{
        background: 'var(--bg)',
        padding: 'clamp(16px, 5vw, 24px)',
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={GLOW_STYLE} />
      <div className="animate-fade-up" style={{ width: '100%', maxWidth: 440, position: 'relative', zIndex: 1, margin: '0 auto' }}>
        <div className="flex items-center gap-3 justify-center" style={{ marginBottom: 'clamp(24px, 6vw, 40px)' }}>
          <div style={LOGO_WRAP_STYLE}>
            <Key size={22} color="var(--accent-ink)" strokeWidth={2.5} />
          </div>
          <span className="font-display text-3xl" style={{ color: 'var(--text-primary)' }}>Cipheria</span>
        </div>
        <div className="glass" style={{ ...CARD_STYLE, textAlign: centered ? 'center' : 'left' }}>
          <h2 className="font-display" style={{ fontSize: '1.6rem', color: 'var(--text-primary)', marginBottom: 16 }}>{title}</h2>
          {children}
        </div>
      </div>
    </main>
  );
}

function VerifyEmailView({ token }: Readonly<{ token: string }>) {
  const router = useRouter();
  const [state, setState] = useState<{ loading: boolean; message: string; error: boolean }>({
    loading: true,
    message: 'Verifying email...',
    error: false,
  });

  useEffect(() => {
    if (!token) {
      setState({
        loading: false,
        message: 'Invalid or missing verification token.',
        error: true,
      });
      return;
    }
    authApi.verifyEmail(token)
      .then(({ data }) => {
        emitAuthEvent('user-updated');
        setState({ loading: false, message: data.message, error: false });
      })
      .catch((err) => setState({ loading: false, message: parseApiError(err, 'Verification failed'), error: true }));
  }, [token]);

  return (
    <AuxShell title="Email Verification" centered>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
        <p style={{ color: state.error ? 'var(--danger)' : 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 280 }}>
          {state.message}
        </p>
        {!state.loading && (
          <button className="btn-primary" onClick={() => router.replace('/auth')} style={{ width: '100%' }}>
            Back to Sign In
          </button>
        )}
      </div>
    </AuxShell>
  );
}

function ResetNotSupportedView() {
  const router = useRouter();

  return (
    <AuxShell title="Reset Not Supported" centered>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 280 }}>
          Cipheria now uses a single zero-knowledge master password. Lost master passwords cannot be reset.
        </p>
        <button className="btn-primary" onClick={() => router.replace('/auth')} style={{ width: '100%' }}>
          Back to Sign In
        </button>
      </div>
    </AuxShell>
  );
}

function AuthForm({ initialTab }: Readonly<{ initialTab: 'login' | 'register' }>) {
  const {
    tab, setTab, toggleTab,
    showPassword, togglePassword,
    loading, form, handleChange,
    handleSubmit, strength, submitLabel,
  } = useAuthForm(initialTab);

  return (
    <>
      <div style={{
        display: 'flex', gap: 0, marginBottom: 'clamp(20px, 5vw, 32px)',
        background: 'var(--surface-veil)', borderRadius: 10, padding: 4,
      }}>
        {(['login', 'register'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: 'clamp(8px, 2vw, 10px)', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: tab === t ? 'var(--accent)' : 'transparent',
            color: tab === t ? 'var(--accent-ink)' : 'var(--text-secondary)',
            fontFamily: 'Outfit, sans-serif', fontWeight: 600,
            fontSize: 'clamp(0.78rem, 2.5vw, 0.875rem)', transition: 'all 0.2s', whiteSpace: 'nowrap' as const,
          }}>
            {t === 'login' ? 'Unlock Vault' : 'Create Account'}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(14px, 3vw, 18px)' }}>
        {tab === 'register' && (
          <div>
            <label htmlFor="fullName" style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8, letterSpacing: '0.04em' }}>
              FULL NAME
            </label>
            <input
              id="fullName"
              className="input-field"
              type="text"
              placeholder="Ada Lovelace"
              value={form.fullName}
              onChange={handleChange('fullName')}
            />
          </div>
        )}

        <div>
          <label htmlFor="email" style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8, letterSpacing: '0.04em' }}>
            EMAIL
          </label>
          <input
            id="email"
            className="input-field"
            type="email"
            placeholder="you@example.com"
            required
            value={form.email}
            onChange={handleChange('email')}
            style={{ fontSize: 'max(16px, 0.9rem)' }}
          />
        </div>

        <div>
          <label htmlFor="masterPassword" style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8, letterSpacing: '0.04em' }}>
            MASTER PASSWORD
          </label>
          <div style={{ position: 'relative' }}>
            <input
              id="masterPassword"
              className="input-field"
              type={showPassword ? 'text' : 'password'}
              placeholder="Your one vault secret"
              required
              value={form.masterPassword}
              onChange={handleChange('masterPassword')}
              style={{ paddingRight: 44, fontSize: 'max(16px, 0.9rem)' }}
            />
            <button
              type="button"
              onClick={togglePassword}
              style={{
                position: 'absolute', right: 0, top: 0, bottom: 0,
                width: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)',
              }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {tab === 'register' && (
            <div style={WARNING_BOX_STYLE}>
              <AlertCircle size={14} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Your master password encrypts your vault. We do not store it, so if you forget it, <strong style={{ color: 'var(--text-primary)' }}>your vault cannot be recovered</strong>.
              </p>
            </div>
          )}
          {strength && form.masterPassword && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} style={{
                    height: 3, flex: 1, borderRadius: 2,
                    background: i <= strength.score ? strength.color : 'var(--skeleton-2)',
                    transition: 'background 0.3s',
                  }} />
                ))}
              </div>
              <span style={{ fontSize: '0.75rem', color: strength.color }}>{strength.label}</span>
            </div>
          )}
        </div>

        {tab === 'register' && (
          <>
            <div>
              <label htmlFor="confirmMasterPassword" style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8, letterSpacing: '0.04em' }}>
                CONFIRM MASTER PASSWORD
              </label>
              <input
                id="confirmMasterPassword"
                className="input-field"
                type="password"
                placeholder="Re-enter your master password"
                required
                value={form.confirmMasterPassword}
                onChange={handleChange('confirmMasterPassword')}
                style={{ fontSize: 'max(16px, 0.9rem)' }}
              />
            </div>

            <div>
              <label htmlFor="masterHint" style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8, letterSpacing: '0.04em' }}>
                MASTER PASSWORD HINT <span style={{ opacity: 0.5 }}>(optional)</span>
              </label>
              <input
                id="masterHint"
                className="input-field"
                type="text"
                placeholder="A hint to remember your master password"
                value={form.masterHint}
                onChange={handleChange('masterHint')}
                style={{ fontSize: 'max(16px, 0.9rem)' }}
              />
            </div>
          </>
        )}

        <button
          type="submit"
          className="btn-primary"
          disabled={loading}
          style={{
            marginTop: 8, opacity: loading ? 0.7 : 1,
            cursor: loading ? 'not-allowed' : 'pointer',
            minHeight: 48,
          }}
        >
          {submitLabel}
        </button>
      </form>

      <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.8rem', color: 'var(--text-secondary)', paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
        {tab === 'login' ? "Don't have an account? " : 'Already have an account? '}
        <button
          onClick={toggleTab}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.8rem', padding: '4px 2px' }}
        >
          {tab === 'login' ? 'Create one' : 'Sign in'}
        </button>
      </p>
    </>
  );
}

function AuthPageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { isAuthenticated, cryptoKey, restoreSession } = useAuthStore();
  const [checkingSession, setCheckingSession] = useState(true);
  const mode = params.get('mode');
  const token = params.get('token') ?? '';
  const initialTab = params.get('tab') === 'register' ? 'register' : 'login';

  useEffect(() => {
    if (mode) {
      setCheckingSession(false);
      return;
    }

    let active = true;
    if (isAuthenticated) {
      setCheckingSession(false);
      return () => {
        active = false;
      };
    }

    void restoreSession().then((ok) => {
      if (!active) return;
      setCheckingSession(false);
      if (ok) {
        router.replace('/dashboard');
      }
    });

    return () => {
      active = false;
    };
  }, [isAuthenticated, mode, restoreSession, router]);

  useEffect(() => {
    if (isAuthenticated && !mode) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, mode, router]);

  if (mode === 'verify-email') return <VerifyEmailView token={token} />;
  if (mode === 'reset-password') return <ResetNotSupportedView />;
  if (checkingSession) {
    return (
      <AuxShell title="Opening Cipheria" centered>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Checking your session...
        </p>
      </AuxShell>
    );
  }
  if (isAuthenticated && !mode && cryptoKey) return null;
  if (isAuthenticated && !mode && !cryptoKey) {
    return (
      <AuxShell title="Opening Vault" centered>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Redirecting to your dashboard...
        </p>
      </AuxShell>
    );
  }

  return (
    <main
      style={{
        background: 'var(--bg)',
        padding: 'clamp(16px, 5vw, 24px)',
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
      }}
    >
      <style>{`@media (min-height: 640px) { main { align-items: center !important; } }`}</style>
      <div style={GLOW_STYLE} />
      <div className="animate-fade-up" style={{ width: '100%', maxWidth: 440, position: 'relative', zIndex: 1, margin: '0 auto' }}>
        <div className="flex items-center gap-3 justify-center" style={{ marginBottom: 'clamp(24px, 6vw, 40px)' }}>
          <div style={LOGO_WRAP_STYLE}>
            <Key size={22} color="var(--accent-ink)" strokeWidth={2.5} />
          </div>
          <span className="font-display text-3xl" style={{ color: 'var(--text-primary)' }}>Cipheria</span>
        </div>
        <div className="glass" style={CARD_STYLE}>
          <AuthForm key={initialTab} initialTab={initialTab} />
        </div>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AuthPageContent />
    </Suspense>
  );
}
