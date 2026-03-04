'use client';
import Link from 'next/link';
import { Shield, Lock, Zap, Globe, Key, ArrowRight, RefreshCw, Download } from 'lucide-react';

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>

      {/* Radial glow */}
      <div style={{
        position: 'fixed', top: '15%', left: '50%', transform: 'translateX(-50%)',
        width: 'min(700px, 140vw)', height: 'min(700px, 140vw)', borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(245,158,11,0.09) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Responsive styles */}
      <style>{`
        .nav-inner { padding: 14px 20px; }
        @media (min-width: 768px) { .nav-inner { padding: 18px 40px; } }

        .nav-btn {
          font-size: 0.85rem; padding: 8px 14px; border-radius: 8px; line-height: 1;
          font-family: Outfit, sans-serif; white-space: nowrap;
          text-decoration: none; transition: all 0.2s;
        }
        @media (min-width: 768px) {
          .nav-btn { font-size: 0.875rem; padding: 10px 20px; }
        }
        .nav-btn-ghost { color: var(--text-secondary); border: 1px solid var(--border); }
        .nav-btn-ghost:hover { color: var(--text-primary); border-color: var(--border-hover); background: var(--accent-dim); }
        .nav-btn-primary { background: var(--accent); color: #0a0908; font-weight: 600; letter-spacing: 0.01em; }
        .nav-btn-primary:hover { background: #d97706; }

        .hero-ctas { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 340px; }
        @media (min-width: 480px) {
          .hero-ctas { flex-direction: row; width: auto; max-width: none; }
          .hero-ctas a { width: auto !important; }
        }

        .feature-card { display: flex; flex-direction: row; gap: 16px; align-items: flex-start; }
        @media (min-width: 768px) {
          .feature-card { flex-direction: column; gap: 0; }
          .feature-card .feature-icon { margin-bottom: 20px; }
        }
      `}</style>

      {/* Nav */}
      <nav className="nav-inner" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0, zIndex: 40,
        background: 'rgba(10,9,8,0.88)', backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
            background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Key size={18} color="#0a0908" strokeWidth={2.5} />
          </div>
          <span className="font-display" style={{ fontSize: 'clamp(1.25rem, 3vw, 1.5rem)', color: 'var(--text-primary)', lineHeight: 1 }}>
            Cipheria
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link href="/auth" className="nav-btn nav-btn-ghost">Sign In</Link>
          <Link href="/auth?tab=register" className="nav-btn nav-btn-primary">Get Started</Link>
        </div>
      </nav>

      {/* Hero  */}
      <section style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        padding: 'clamp(40px, 10vw, 96px) 24px clamp(48px, 10vw, 96px)',
      }}>
        {/* Badge — outer wrapper removed, animation directly on pill */}
        <div className="animate-fade-up" style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          background: 'var(--accent-dim)', border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 100, padding: '6px 16px',
          marginBottom: 'clamp(20px, 5vw, 28px)',
        }}>
          <Shield size={12} color="var(--accent)" />
          <span style={{ fontSize: '0.72rem', color: 'var(--accent)', letterSpacing: '0.07em', textTransform: 'uppercase', fontWeight: 500 }}>
            Zero-knowledge encryption
          </span>
        </div>

        <h1 className="font-display animate-fade-up" style={{
          fontSize: 'clamp(2.6rem, 11vw, 6rem)', lineHeight: 1.1,
          animationDelay: '80ms', maxWidth: 740,
          marginBottom: 'clamp(18px, 4vw, 24px)',
        }}>
          <span className="text-gradient">Your secrets,</span>
          <br />
          <span style={{ color: 'var(--text-primary)', fontStyle: 'italic' }}>forever yours.</span>
        </h1>

        <p className="animate-fade-up" style={{
          fontSize: 'clamp(0.95rem, 2.5vw, 1.1rem)', color: 'var(--text-secondary)',
          maxWidth: 480, lineHeight: 1.75,
          marginBottom: 'clamp(32px, 8vw, 48px)', animationDelay: '160ms',
        }}>
          Cipheria encrypts everything client-side before it ever leaves your device.
          Not even we can read your passwords.
        </p>

        <div className="animate-fade-up hero-ctas" style={{ animationDelay: '240ms' }}>
          <Link href="/auth?tab=register" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            textDecoration: 'none', background: 'var(--accent)', color: '#0a0908',
            fontWeight: 600, padding: '14px 32px', borderRadius: 10,
            fontSize: '1rem', letterSpacing: '0.01em', transition: 'all 0.2s', width: '100%',
          }}>
            Start for free <ArrowRight size={17} />
          </Link>
          <Link href="/auth" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            textDecoration: 'none', color: 'var(--text-secondary)',
            border: '1px solid var(--border)', padding: '14px 32px', borderRadius: 10,
            fontSize: '1rem', transition: 'all 0.2s', width: '100%',
          }}>
            Sign in
          </Link>
        </div>
      </section>

      {/* Features */}
      <section style={{
        borderTop: '1px solid var(--border)',
        padding: 'clamp(48px, 10vw, 80px) clamp(16px, 5vw, 32px)',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <h2 className="font-display text-center" style={{
            fontSize: 'clamp(1.6rem, 5vw, 2.5rem)',
            color: 'var(--text-primary)', marginBottom: 'clamp(32px, 7vw, 56px)',
          }}>
            Built for the <span className="text-gradient">paranoid</span>
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
            gap: 'clamp(12px, 2vw, 24px)',
          }}>
            {[
              { icon: Lock, title: 'AES-256-GCM', desc: 'Military-grade encryption with a key derived from your master password — never stored anywhere.' },
              { icon: Zap, title: 'Instant Autofill', desc: 'Browser extension detects login forms and fills credentials in one click.' },
              { icon: Globe, title: 'Access Anywhere', desc: 'Syncs across all your devices via our secure serverless API on Vercel.' },
              { icon: Shield, title: 'Zero Knowledge', desc: 'End-to-end encrypted client-side. The server only ever sees ciphertext.' },
              { icon: RefreshCw, title: 'Password Generator', desc: 'Generate strong, random passwords with custom length and character rules in one click.' },
              { icon: Download, title: 'Vault Export', desc: 'Download your entire encrypted vault as JSON anytime — your data is always yours.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="glass glass-hover feature-card" style={{
                borderRadius: 16, padding: 'clamp(18px, 3vw, 28px)',
              }}>
                <div className="feature-icon" style={{
                  width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                  background: 'var(--accent-dim)', border: '1px solid rgba(245,158,11,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginTop: 2,
                }}>
                  <Icon size={20} color="var(--accent)" />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                    {title}
                  </h3>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    {desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid var(--border)',
        padding: 'clamp(16px, 4vw, 24px) 20px',
        textAlign: 'center',
      }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          © 2026 Cipheria · Open source · No ads · No tracking
        </span>
      </footer>
    </main>
  );
}