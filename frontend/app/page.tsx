'use client';
import Link from 'next/link';
import { Shield, Lock, Zap, Globe, Key, ArrowRight, RefreshCw, Download } from 'lucide-react';

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>

      {/* Radial glow */}
      <div style={{
        position: 'fixed', top: '20%', left: '50%', transform: 'translateX(-50%)',
        width: 800, height: 800, borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(245,158,11,0.06) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-6" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Key size={18} color="#0a0908" strokeWidth={2.5} />
          </div>
          <span className="font-display text-2xl" style={{ color: 'var(--text-primary)' }}>Cipheria</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/auth" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', textDecoration: 'none' }}
            className="hover:text-amber-400 transition-colors">
            Sign In
          </Link>
          <Link href="/auth?tab=register" className="btn-primary" style={{ textDecoration: 'none', padding: '10px 20px', fontSize: '0.875rem' }}>
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-24">
        <div className="animate-fade-up" style={{ animationDelay: '0ms' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'var(--accent-dim)', border: '1px solid rgba(245,158,11,0.25)',
            borderRadius: 100, padding: '6px 16px', marginBottom: 32,
          }}>
            <Shield size={13} color="var(--accent)" />
            <span style={{ fontSize: '0.78rem', color: 'var(--accent)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Zero-knowledge encryption
            </span>
          </div>
        </div>

        <h1 className="font-display animate-fade-up" style={{
          fontSize: 'clamp(3rem, 8vw, 6rem)', lineHeight: 1.05,
          animationDelay: '80ms', maxWidth: 800, marginBottom: 24,
        }}>
          <span className="text-gradient">Your secrets,</span>
          <br />
          <span style={{ color: 'var(--text-primary)', fontStyle: 'italic' }}>forever yours.</span>
        </h1>

        <p className="animate-fade-up" style={{
          fontSize: '1.1rem', color: 'var(--text-secondary)',
          maxWidth: 540, lineHeight: 1.7, marginBottom: 48,
          animationDelay: '160ms',
        }}>
          Cipheria encrypts everything client-side before it ever leaves your device.
          Not even we can read your passwords.
        </p>

        <div className="flex items-center gap-4 animate-fade-up" style={{ animationDelay: '240ms' }}>
          <Link href="/auth?tab=register" className="btn-primary" style={{ textDecoration: 'none', padding: '14px 32px', fontSize: '1rem' }}>
            Start for free <ArrowRight size={16} style={{ display: 'inline', marginLeft: 6 }} />
          </Link>
          <Link href="/auth" className="btn-ghost" style={{ textDecoration: 'none', padding: '14px 32px', fontSize: '1rem' }}>
            Sign in
          </Link>
        </div>
      </section>

      {/* Features */}
      <section style={{ borderTop: '1px solid var(--border)', padding: '80px 32px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <h2 className="font-display text-center" style={{ fontSize: '2.5rem', color: 'var(--text-primary)', marginBottom: 60 }}>
            Built for the <span className="text-gradient">paranoid</span>
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
            {[
              { icon: Lock, title: 'AES-256-GCM', desc: 'Military-grade encryption with a key derived from your master password — never stored anywhere.' },
              { icon: Zap, title: 'Instant Autofill', desc: 'Browser extension detects login forms and fills credentials in one click.' },
              { icon: Globe, title: 'Access Anywhere', desc: 'Syncs across all your devices via our secure serverless API on Vercel.' },
              { icon: Shield, title: 'Zero Knowledge', desc: 'End-to-end encrypted client-side. The server only ever sees ciphertext.' },
              { icon: RefreshCw, title: 'Password Generator', desc: 'Generate strong, random passwords with custom length and character rules in one click.' },
              { icon: Download, title: 'Vault Export', desc: 'Download your entire encrypted vault as JSON anytime — your data is always yours.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="glass glass-hover" style={{
                borderRadius: 16, padding: 28, transition: 'all 0.25s',
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 10,
                  background: 'var(--accent-dim)', border: '1px solid rgba(245,158,11,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
                }}>
                  <Icon size={20} color="var(--accent)" />
                </div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>{title}</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '24px 32px', textAlign: 'center' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          © 2026 Cipheria · Open source · No ads · No tracking
        </span>
      </footer>
    </main>
  );
}
