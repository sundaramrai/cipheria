'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Key, Eye, EyeOff, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { passwordStrength } from '@/lib/crypto';

function AuthPageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<'login' | 'register'>(
    params.get('tab') === 'register' ? 'register' : 'login'
  );
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', fullName: '', masterHint: '' });
  const { setAuth, isAuthenticated, restoreSession } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
      return;
    }
    // If tokens exist from a previous session, restore and redirect
    restoreSession().then((ok) => {
      if (ok) router.push('/dashboard');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const strength = tab === 'register' ? passwordStrength(form.password) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (tab === 'register') {
        const { data } = await authApi.register(form.email, form.password, form.fullName, form.masterHint);
        setAuth(
          { id: data.user_id, email: form.email, full_name: form.fullName, vault_salt: data.vault_salt },
          data.access_token, data.refresh_token
        );
        toast.success('Account created! Set your master password to unlock the vault.');
      } else {
        const { data } = await authApi.login(form.email, form.password);
        sessionStorage.setItem('access_token', data.access_token);
        const { data: user } = await authApi.me();
        setAuth(user, data.access_token, data.refresh_token);
        toast.success('Welcome back!');
      }
      router.push('/dashboard');
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Something went wrong';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Extract button label from nested ternary
  let buttonLabel = '';
  if (loading) {
    buttonLabel = 'Please wait...';
  } else if (tab === 'login') {
    buttonLabel = 'Sign In';
  } else {
    buttonLabel = 'Create Account';
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
      {/* Background glow */}
      <div style={{
        position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)',
        width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(245,158,11,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div className="animate-fade-up" style={{ width: '100%', maxWidth: 440, position: 'relative', zIndex: 1 }}>
        {/* Logo */}
        <div className="flex items-center gap-3 justify-center mb-10">
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Key size={22} color="#0a0908" strokeWidth={2.5} />
          </div>
          <span className="font-display text-3xl" style={{ color: 'var(--text-primary)' }}>Cipheria</span>
        </div>

        {/* Card */}
        <div className="glass" style={{ borderRadius: 20, padding: 40 }}>
          {/* Tabs */}
          <div style={{
            display: 'flex', gap: 0, marginBottom: 32,
            background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: 4,
          }}>
            {(['login', 'register'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{
                flex: 1, padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: tab === t ? 'var(--accent)' : 'transparent',
                color: tab === t ? '#0a0908' : 'var(--text-secondary)',
                fontFamily: 'Outfit, sans-serif', fontWeight: 600, fontSize: '0.875rem',
                transition: 'all 0.2s', textTransform: 'capitalize',
              }}>
                {t === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
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
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
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
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>

            <div>
              <label htmlFor="password" style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8, letterSpacing: '0.04em' }}>
                PASSWORD
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="password"
                  className="input-field"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••••••"
                  required
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  style={{ paddingRight: 44 }}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{
                  position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)',
                }}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {/* Password strength bar */}
              {strength && form.password && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} style={{
                        height: 3, flex: 1, borderRadius: 2,
                        background: i <= strength.score ? strength.color : 'rgba(255,255,255,0.1)',
                        transition: 'background 0.3s',
                      }} />
                    ))}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: strength.color }}>{strength.label}</span>
                </div>
              )}
            </div>

            {tab === 'register' && (
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
                  onChange={(e) => setForm({ ...form, masterHint: e.target.value })}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)' }}>
                  <AlertCircle size={14} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    Your master password derives the encryption key. If you forget it, <strong style={{ color: 'var(--text-primary)' }}>your vault cannot be recovered</strong>.
                  </p>
                </div>
              </div>
            )}

            <button
              type="submit"
              className="btn-primary"
              disabled={loading}
              style={{ marginTop: 8, opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              {buttonLabel}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {tab === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button onClick={() => setTab(tab === 'login' ? 'register' : 'login')}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.8rem' }}>
            {tab === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </div>
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthPageContent />
    </Suspense>
  );
}
