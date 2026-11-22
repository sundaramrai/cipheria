'use client';
import Link from 'next/link';
import Image from 'next/image';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { ArrowRight, Key } from 'lucide-react';

// The scripts can survive client navigation; filter every event, including vitals.
function publicPageEvent<T extends { url: string }>(event: T): T | null {
  const url = new URL(event.url);
  return url.pathname === '/' && globalThis.location.pathname === '/'
    ? { ...event, url: url.origin + url.pathname } : null;
}

export default function Page() {
  return (
    <main className="min-h-dvh bg-(--bg) font-normal text-(--text-primary)">
      <header className="border-b border-(--border)">
        <nav aria-label="Main navigation" className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/" aria-label="Cipheria home" className="flex items-center gap-2.5 no-underline">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--accent)">
              <Key size={16} color="var(--accent-ink)" strokeWidth={2.5} aria-hidden="true" />
            </span>
            <span className="font-display text-2xl">Cipheria</span>
          </Link>
          <div className="flex items-center gap-3 sm:gap-6">
            <Link href="#privacy" className="hidden py-3 text-sm text-(--text-secondary) hover:text-(--text-primary) sm:inline-flex">Privacy</Link>
            <Link href="/auth" className="btn-ghost no-underline">Sign in</Link>
          </div>
        </nav>
      </header>

      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <section className="grid gap-8 py-12 sm:py-16 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:gap-x-16 lg:gap-y-10" aria-labelledby="intro-title">
          <div>
            <p className="mb-5 font-mono text-xs uppercase tracking-[0.16em] text-(--accent)">Cipheria / Personal vault</p>
            <h1 id="intro-title" className="font-display text-[clamp(2.75rem,6vw,4.5rem)] leading-[1.05] tracking-tight">
              Passwords, cards<br /><span className="italic text-(--accent)">and private notes.</span>
            </h1>
          </div>
          <div>
            <p className="max-w-md text-base leading-relaxed text-(--text-secondary)">
              Import the passwords you already use. Find and copy saved details, or keep an encrypted export. Your master password unlocks it all.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/auth?tab=register" className="btn-primary no-underline">
                Create your vault <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link href="#moving-in" className="btn-ghost no-underline">How it works</Link>
            </div>
          </div>
          <figure className="overflow-hidden rounded-xl border border-(--border) bg-(--bg-card) lg:col-span-2">
            <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-(--border) px-5 py-4">
              <span className="font-display text-xl">The Cipheria vault</span>
              <span className="text-sm text-(--text-secondary)">Actual interface, fictitious data</span>
            </figcaption>
            {[
              { theme: 'dark', classes: 'block [[data-resolved-theme=light]_&]:hidden' },
              { theme: 'light', classes: 'hidden [[data-resolved-theme=light]_&]:block' },
            ].map(({ theme, classes }) => (
              <picture key={theme} className={classes}>
                <source media="(max-width: 639px)" srcSet={`/vault-preview-${theme}-mobile.webp`} width={390} height={560} />
                <Image src={`/vault-preview-${theme}.webp`} width={1280} height={800} unoptimized
                  alt="Cipheria's vault showing saved items and a selected login with password visibility and copy controls."
                  className="h-auto w-full" />
              </picture>
            ))}
          </figure>
        </section>

        <section id="moving-in" aria-labelledby="moving-in-title" className="grid scroll-mt-6 gap-8 border-t border-(--border) py-12 sm:py-16 lg:grid-cols-2 lg:gap-20">
          <div>
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.16em] text-(--accent)">Make it yours</p>
            <h2 id="moving-in-title" className="font-display text-4xl leading-tight sm:text-5xl">Start with what<br />you already have.</h2>
          </div>
          <ol className="divide-y divide-(--border)">
            {[
              { title: 'Import browser passwords', text: 'Import a browser CSV, map its columns and review duplicates before saving. Existing entries stay untouched.' },
              { title: 'Find and copy credentials', text: 'Save logins, cards, notes and identities. Search names, login usernames and website URLs; copy details when you need them.' },
              { title: 'Export and restore your vault', text: 'Export an encrypted Cipheria JSON file and restore it with the password you used at export time.' },
            ].map(({ title, text }, index) => (
              <li key={title} className="flex gap-5 py-5 first:pt-0 last:pb-0">
                <span className="pt-1 font-mono text-xs text-(--accent)" aria-hidden="true">0{index + 1}</span>
                <div>
                  <h3 className="font-display text-2xl">{title}</h3>
                  <p className="mt-2 text-base leading-relaxed text-(--text-secondary)">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="privacy" aria-labelledby="privacy-title" className="grid scroll-mt-6 gap-8 border-t border-(--border) py-12 sm:py-16 lg:grid-cols-2 lg:gap-20">
          <div>
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.16em] text-(--accent)">The encryption boundary</p>
            <h2 id="privacy-title" className="font-display text-4xl leading-tight sm:text-5xl">Know what<br />stays private.</h2>
          </div>
          <div>
            <dl className="space-y-5">
              <div>
                <dt className="text-sm font-medium">Encrypted in your browser</dt>
                <dd className="mt-2 text-base leading-relaxed text-(--text-secondary)">Passwords, URLs, notes, card details and other item contents are encrypted before being sent to the server.</dd>
              </div>
              <div>
                <dt className="text-sm font-medium">Visible to the server</dt>
                <dd className="mt-2 text-base leading-relaxed text-(--text-secondary)">Item names, categories, favourites and timestamps, along with your account details. JSON exports also retain readable listing metadata.</dd>
              </div>
            </dl>
            <p className="mt-6 border-l-2 border-(--accent) pl-4 text-base leading-relaxed text-(--text-secondary)">
              Your master password is not sent to the server. If you forget it, Cipheria cannot decrypt your vault for you.
            </p>
          </div>
        </section>
      </div>

      <footer className="border-t border-(--border)">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-sm text-(--text-secondary) sm:px-8">
          <span className="font-display text-xl text-(--text-primary)">Cipheria</span>
          <p>No ads. Analytics and performance measurement on this public page only.</p>
          <Link href="/auth?tab=register" className="inline-flex min-h-11 items-center gap-2 text-(--accent) hover:underline">
            Create your vault <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </footer>
      <Analytics beforeSend={publicPageEvent} />
      <SpeedInsights beforeSend={publicPageEvent} />
    </main>
  );
}
