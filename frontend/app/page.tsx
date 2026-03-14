'use client';
import Link from 'next/link';
import { Shield, Lock, Zap, Globe, Key, ArrowRight, RefreshCw, Download } from 'lucide-react';

export default function Page() {
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', position: 'relative' }}>

      <style>{`
        .nav-wrap { padding: 0 clamp(20px, 4vw, 48px); height: 58px; }
        .nav-link {
          font-size: 0.82rem; padding: 7px 14px; border-radius: 8px;
          font-family: var(--font-body); white-space: nowrap;
          text-decoration: none; transition: all 0.18s;
          display: inline-flex; align-items: center;
        }
        .nav-link-ghost { color: var(--text-secondary); border: 1px solid var(--border); }
        .nav-link-ghost:hover { color: var(--text-primary); border-color: var(--border-hover); background: var(--accent-dim); }
        .nav-link-primary { background: var(--accent); color: #0a0908; font-weight: 600; letter-spacing: 0.02em; gap: 6px; }
        .nav-link-primary:hover { background: #e8940a; box-shadow: 0 4px 16px rgba(245,158,11,0.3); }
        .hero-ctas { flex-direction: column; width: 100%; max-width: 340px; }
        @media (min-width: 480px) {
          .hero-ctas { flex-direction: row; width: auto; max-width: none; }
          .hero-ctas a { width: auto !important; }
        }
        @media (min-width: 640px) {
          .feature-card-inner { flex-direction: column !important; }
          .feature-icon { margin-bottom: 18px !important; margin-top: 0 !important; }
        }
        .features-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
        @media (min-width: 560px) { .features-grid { grid-template-columns: 1fr 1fr; } }
        @media (min-width: 900px) { .features-grid { grid-template-columns: repeat(3, 1fr); } }
      `}</style>

      {/* Nav */}
      <nav className="nav-wrap" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0, zIndex: 40,
        background: 'rgba(8,7,6,0.9)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(245,158,11,0.3)' }}>
            <Key size={16} color="#0a0908" strokeWidth={2.8} />
          </div>
          <span className="font-display" style={{ fontSize: 'clamp(1.15rem, 3vw, 1.35rem)', color: 'var(--text-primary)', lineHeight: 1 }}>
            Cipheria
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link href="/auth" className="nav-link nav-link-ghost">Sign In</Link>
          <Link href="/auth?tab=register" className="nav-link nav-link-primary">
            Get Started <ArrowRight size={13} />
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 'clamp(56px, 12vw, 112px) 24px clamp(56px, 10vw, 96px)', position: 'relative' }}>
        <div style={{ width: 1, height: 48, background: 'linear-gradient(to bottom, transparent, var(--border))', marginBottom: 20 }} />

        <div className="animate-fade-up" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'var(--accent-dim)', border: '1px solid rgba(245,158,11,0.28)', borderRadius: 100, padding: '5px 14px', marginBottom: 'clamp(20px, 5vw, 28px)' }}>
          <Shield size={11} color="var(--accent)" />
          <span style={{ fontSize: '0.7rem', color: 'var(--accent)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 500 }}>
            Zero-knowledge encryption
          </span>
        </div>

        <h1 className="font-display animate-fade-up" style={{ fontSize: 'clamp(2.8rem, 12vw, 6.5rem)', lineHeight: 1.05, animationDelay: '80ms', maxWidth: 760, marginBottom: 'clamp(18px, 4vw, 24px)' }}>
          <span className="text-gradient">Your secrets,</span>
          <br />
          <span style={{ color: 'var(--text-primary)', fontStyle: 'italic', opacity: 0.95 }}>forever yours.</span>
        </h1>

        <p className="animate-fade-up" style={{ fontSize: 'clamp(0.9rem, 2.2vw, 1.05rem)', color: 'var(--text-secondary)', maxWidth: 440, lineHeight: 1.8, marginBottom: 'clamp(32px, 8vw, 52px)', animationDelay: '160ms' }}>
          Cipheria encrypts everything client-side before it ever leaves your device. Not even we can read your passwords.
        </p>

        <div className="animate-fade-up hero-ctas" style={{ display: 'flex', gap: 10, animationDelay: '240ms' }}>
          <Link href="/auth?tab=register" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none', background: 'var(--accent)', color: '#0a0908', fontWeight: 600, padding: '13px 28px', borderRadius: 'var(--radius-md)', fontSize: '0.95rem', letterSpacing: '0.02em', transition: 'all 0.2s', width: '100%' }}>
            Start for free <ArrowRight size={16} />
          </Link>
          <Link href="/auth" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', color: 'var(--text-secondary)', border: '1px solid var(--border)', padding: '13px 28px', borderRadius: 'var(--radius-md)', fontSize: '0.95rem', transition: 'all 0.2s', width: '100%' }}>
            Sign in
          </Link>
        </div>

        <div style={{ width: 1, height: 48, marginTop: 52, background: 'linear-gradient(to bottom, var(--border), transparent)' }} />
      </section>

      {/* Features */}
      <section style={{ borderTop: '1px solid var(--border)', padding: 'clamp(52px, 10vw, 88px) clamp(20px, 5vw, 48px)' }}>
        <div style={{ maxWidth: 1060, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 'clamp(36px, 7vw, 60px)' }}>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500, marginBottom: 12 }}>
              Why Cipheria
            </p>
            <h2 className="font-display" style={{ fontSize: 'clamp(1.7rem, 5vw, 2.6rem)', color: 'var(--text-primary)', lineHeight: 1.1 }}>
              Built for the <span className="text-gradient">paranoid</span>
            </h2>
          </div>

          <div className="features-grid">
            {[
              { icon: Lock, title: 'AES-256-GCM', desc: 'Military-grade encryption derived from your master password — never stored, never sent.' },
              { icon: Zap, title: 'Instant Autofill', desc: 'Browser extension detects login forms and fills your credentials in a single click.' },
              { icon: Globe, title: 'Access Anywhere', desc: 'Syncs seamlessly across all your devices via a secure, serverless edge API.' },
              { icon: Shield, title: 'Zero Knowledge', desc: 'All encryption happens client-side. The server only ever sees ciphertext.' },
              { icon: RefreshCw, title: 'Password Generator', desc: 'Generate strong, random passwords with custom length and character rules.' },
              { icon: Download, title: 'Vault Export', desc: 'Download your entire vault as JSON anytime. Your data is always yours.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="glass glass-hover" style={{ borderRadius: 'var(--radius-lg)', padding: 'clamp(18px, 3vw, 26px)' }}>
                <div className="feature-card-inner" style={{ display: 'flex', flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
                  <div className="feature-icon" style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: 'var(--accent-dim)', border: '1px solid rgba(245,158,11,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                    <Icon size={18} color="var(--accent)" strokeWidth={1.8} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>{title}</h3>
                    <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>{desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: 'clamp(16px, 3vw, 22px) 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 18, height: 18, borderRadius: 5, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Key size={9} color="#0a0908" strokeWidth={3} />
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Cipheria</span>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>·</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>© 2026 · Open source · No ads · No tracking</span>
      </footer>
    </main>
  );
}