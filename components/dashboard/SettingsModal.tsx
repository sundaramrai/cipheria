'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, KeyRound, MonitorCog, MoonStar, Settings, SunMedium, Trash2, UserRound } from 'lucide-react';
import { Modal } from './ItemModal';
import { applyThemePreference, getStoredThemePreference } from '@/lib/theme';
import type { ThemePreference } from '@/lib/theme';
import type { UserProfile } from '@/lib/types';
import { authApi } from '@/lib/api';
import { deriveMasterPasswordVerifier } from '@/lib/crypto';
import { parseApiError } from '@/lib/errors';

export type MasterPasswordForm = { current_password: string; password: string; confirm: string };
type ProfileUpdate = { full_name?: string | null; master_hint?: string | null };
type SecurityAction = 'password' | 'sessions' | 'protection' | 'hint' | 'delete';

const PASSWORD_FIELDS = [
  ['current_password', 'settings-current-master-password', 'Current master password', 'current-password', 'Enter your current master password'],
  ['password', 'settings-new-master-password', 'New master password', 'new-password', 'Enter a new master password'],
  ['confirm', 'settings-confirm-master-password', 'Confirm new master password', 'new-password', 'Confirm your new master password'],
] as const;

function passwordErrors(form: MasterPasswordForm) {
  const errors: Record<string, string> = {};
  for (const [field, id, , , message] of PASSWORD_FIELDS) {
    if (!form[field]) errors[id] = message;
  }
  if (form.confirm && form.password !== form.confirm) errors['settings-confirm-master-password'] = 'Passwords do not match';
  return errors;
}

interface SettingsModalProps {
  user: UserProfile | null;
  profileSaving: boolean;
  verificationSending: boolean;
  masterPasswordSaving: boolean;
  deletingAccount: boolean;
  onClose: () => void;
  onSaveProfile: (data: ProfileUpdate) => Promise<string | null>;
  onResendVerification: () => void;
  onChangeMasterPassword: (form: MasterPasswordForm, rotate?: boolean) => Promise<string | null>;
  onDeleteAccount: (password: string) => Promise<string | null>;
}

function PasswordField({ id, label, value, onChange, error, disabled, autoComplete = 'current-password' }: Readonly<{
  id: string; label: string; value: string; onChange: (value: string) => void;
  error?: string; disabled: boolean; autoComplete?: 'current-password' | 'new-password';
}>) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-(--text-primary)" htmlFor={id}>{label}</label>
      <div className="relative">
        <input id={id} className="input-field" style={{ paddingRight: 66 }} type={visible ? 'text' : 'password'}
          autoComplete={autoComplete} spellCheck={false} autoCapitalize="none"
          value={value} onChange={event => onChange(event.target.value)} disabled={disabled}
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} />
        <button type="button" className="absolute inset-y-0 right-1 w-14 cursor-pointer rounded-md text-xs text-(--text-secondary) hover:text-(--text-primary)" disabled={disabled}
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-controls={id}
          onClick={() => setVisible(!visible)}>{visible ? 'Hide' : 'Show'}</button>
      </div>
      {error && <p id={`${id}-error`} className="mt-1.5 text-sm leading-6 text-(--danger)">{error}</p>}
    </div>
  );
}

export function SettingsModal({ user, profileSaving, verificationSending, masterPasswordSaving,
  deletingAccount, onClose, onSaveProfile, onResendVerification, onChangeMasterPassword,
  onDeleteAccount }: Readonly<SettingsModalProps>) {
  const [section, setSection] = useState<'account' | 'security'>('account');
  const [action, setAction] = useState<SecurityAction | null>(null);
  const [name, setName] = useState(user?.full_name ?? '');
  const [hint, setHint] = useState(user?.master_hint ?? '');
  const [passwords, setPasswords] = useState<MasterPasswordForm>({ current_password: '', password: '', confirm: '' });
  const [actionPassword, setActionPassword] = useState('');
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState('');
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [discardRequested, setDiscardRequested] = useState(false);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const busy = profileSaving || revokingSessions || masterPasswordSaving || deletingAccount;
  const nameChanged = name !== (user?.full_name ?? '');
  const hintChanged = hint !== (user?.master_hint ?? '');
  const protectionLabel = user?.key_envelope ? 'Rotate vault key' : 'Upgrade vault encryption';

  useEffect(() => { setTheme(getStoredThemePreference()); }, []);
  useEffect(() => { if (discardRequested) keepEditingRef.current?.focus(); }, [discardRequested]);

  function requestClose() {
    if (busy) return;
    if (nameChanged || hintChanged || actionPassword || Object.values(passwords).some(Boolean)) {
      setDiscardRequested(true);
    } else onClose();
  }

  function chooseAction(next: SecurityAction | null) {
    if (action === 'hint' && !next) setHint(user?.master_hint ?? '');
    setAction(next);
    setErrors({});
    setSaved('');
    setActionPassword('');
    setPasswords({ current_password: '', password: '', confirm: '' });
    requestAnimationFrame(() => document.getElementById(next ? 'settings-action-title' : 'settings-section-security')?.focus());
  }

  function validate(next: Record<string, string>) {
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) requestAnimationFrame(() => document.getElementById(first)?.focus());
    return !first;
  }

  async function saveProfile(event: React.SyntheticEvent, field: 'full_name' | 'master_hint') {
    event.preventDefault();
    if (busy) return;
    setSaved('');
    setErrors({});
    const error = await onSaveProfile({ [field]: (field === 'full_name' ? name : hint) || null });
    if (error) setErrors({ form: error });
    else setSaved(field === 'full_name' ? 'Profile saved' : 'Password hint saved');
  }

  async function revokeSessions() {
    if (!user) return;
    setRevokingSessions(true);
    try {
      const verifier = await deriveMasterPasswordVerifier(actionPassword, user.vault_salt, user.key_envelope ? 2 : 1);
      await authApi.revokeOtherSessions(verifier);
      setActionPassword('');
      setSaved('Other sessions signed out');
    } catch (error) {
      setErrors({ form: parseApiError(error, 'Could not sign out other sessions') });
    } finally { setRevokingSessions(false); }
  }

  async function submitSecurity(event: React.SyntheticEvent) {
    event.preventDefault();
    if (busy || !user) return;
    setSaved('');
    if (action === 'password') {
      if (!validate(passwordErrors(passwords))) return;
      const error = await onChangeMasterPassword(passwords);
      if (error) setErrors({ form: error });
      return;
    }
    const id = `settings-${action}-password`;
    if (!validate(actionPassword ? {} : { [id]: 'Enter your master password' })) return;
    if (action === 'sessions') return revokeSessions();
    let error: string | null = null;
    if (action === 'protection') error = await onChangeMasterPassword({ current_password: actionPassword, password: '', confirm: '' }, true);
    if (action === 'delete') error = await onDeleteAccount(actionPassword);
    if (error) setErrors({ form: error });
  }

  const securityActions = [
    {
      id: 'password', label: 'Change master password', description: 'Set a new password for your vault.',
      detail: "You'll need to unlock again. Your other sessions will be signed out.", submit: 'Change master password'
    },
    {
      id: 'sessions', label: 'Sign out other sessions', description: 'Keep this browser signed in.',
      detail: 'Other browsers and devices will lose access. This browser stays signed in; already viewed data cannot be erased remotely.', submit: 'Sign out other sessions'
    },
    {
      id: 'hint', label: 'Password hint', description: 'Add or edit an optional reminder.',
      detail: "Use a reminder that doesn't reveal your password. The hint is not encrypted.", submit: 'Save hint'
    },
    {
      id: 'protection', label: 'Advanced vault protection', description: protectionLabel,
      detail: `${user?.key_envelope ? 'Re-encrypt every item, including Trash.' : 'Upgrade this vault without changing your master password.'} Your other sessions will be signed out, and this vault will lock.`, submit: protectionLabel
    },
    {
      id: 'delete', label: 'Delete account', description: 'Permanently delete your account and vault.',
      detail: 'This permanently deletes your account, vault items, sessions and audit history. This cannot be undone.', submit: 'Permanently delete account'
    },
  ] as const;

  function changeSection(next: typeof section) {
    setSection(next); setErrors({}); setSaved('');
  }

  function handleSectionKey(event: React.KeyboardEvent) {
    const other = section === 'account' ? 'security' : 'account';
    const targets: Record<string, typeof section> = { Home: 'account', End: 'security', ArrowLeft: other, ArrowRight: other };
    const next = targets[event.key];
    if (!next) return;
    event.preventDefault();
    changeSection(next);
    document.getElementById(`settings-section-${next}`)?.focus();
  }

  function renderAccount() {
    return (
      <>
        <form className="flex flex-col gap-4" onSubmit={event => saveProfile(event, 'full_name')}>
          <div>
            <label className="mb-2 block text-sm text-(--text-secondary)" htmlFor="settings-full-name">Full name</label>
            <input id="settings-full-name" className="input-field" autoComplete="name" value={name}
              disabled={busy} onChange={event => { setName(event.target.value); setSaved(''); setErrors({}); }} />
          </div>
          <div>
            <span className="mb-2 block text-sm text-(--text-secondary)">Email</span>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-(--text-primary)">
              <span className="min-w-0 select-text wrap-anywhere">{user?.email}</span>
              {user?.email_verified && <span className="inline-flex items-center gap-1 text-xs text-(--success)">
                <Check size={14} aria-hidden="true" />Verified
              </span>}
              {!user?.email_verified && <button type="button" className="min-h-11 shrink-0 cursor-pointer text-sm text-(--accent) hover:underline hover:underline-offset-4"
                disabled={verificationSending || busy} onClick={onResendVerification}>
                {verificationSending ? 'Sending...' : 'Verify email'}
              </button>}
            </div>
          </div>
          <button type="submit" className={`${nameChanged ? 'btn-primary' : 'btn-ghost'} min-w-32 self-start`} disabled={busy || !nameChanged}>
            {profileSaving ? 'Saving...' : 'Save profile'}
          </button>
        </form>
        <div className="hairline my-6" />
        <fieldset className="border-0 p-0">
          <legend className="mb-3 font-display text-(--text-primary)">Theme</legend>
          <div className="flex gap-2">
            {([{ id: 'system', label: 'System', icon: MonitorCog }, { id: 'light', label: 'Light', icon: SunMedium }, { id: 'dark', label: 'Dark', icon: MoonStar }] as const).map(({ id, label, icon: Icon }) => (
              <label key={id} className="settings-theme-option relative flex-1">
                <input className="sr-only" type="radio" name="settings-theme" value={id} checked={theme === id}
                  onChange={() => { setTheme(id); applyThemePreference(id); }} />
                <span className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-(--border) text-sm text-(--text-secondary)">
                  <Icon size={15} aria-hidden="true" />{label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </>
    );
  }

  function renderSecurityFields() {
    if (action === 'hint') return (
      <div>
        <label htmlFor="settings-master-hint" className="mb-2 block text-sm font-medium text-(--text-primary)">Password hint (optional)</label>
        <input id="settings-master-hint" className="input-field" value={hint} disabled={busy}
          onChange={event => { setHint(event.target.value); setSaved(''); setErrors({}); }} />
      </div>
    );
    if (action === 'password') return PASSWORD_FIELDS.map(([field, id, label, autoComplete]) => (
      <PasswordField key={id} id={id} label={label} autoComplete={autoComplete} value={passwords[field]}
        disabled={busy} error={errors[id]} onChange={value => {
          setPasswords({ ...passwords, [field]: value }); setErrors(previous => ({ ...previous, [id]: '', form: '' }));
        }} />
    ));
    return <PasswordField key={action} id={`settings-${action}-password`} label="Master password"
      value={actionPassword} disabled={busy} error={errors[`settings-${action}-password`]}
      onChange={value => { setActionPassword(value); setErrors({}); setSaved(''); }} />;
  }

  function renderSecurity() {
    const selected = securityActions.find(item => item.id === action);
    if (!selected) return (
      <div className="flex flex-col">
        {securityActions.map(({ id, label, description }) => (
          <button key={id} type="button" className={`group flex w-full cursor-pointer items-center justify-between gap-4 border-b border-(--border) py-4 text-left first:pt-1 last:border-0 ${id === 'delete' ? 'text-(--danger)' : 'text-(--text-primary)'}`}
            onClick={() => chooseAction(id)} disabled={busy}>
            <span className="flex flex-col gap-1"><strong className="text-sm font-medium group-hover:underline group-hover:underline-offset-4">{label}</strong><span className="text-sm leading-relaxed text-(--text-secondary)">{description}</span></span>
            <ChevronRight size={17} className="shrink-0" aria-hidden="true" />
          </button>
        ))}
      </div>
    );
    const title = action === 'protection' ? protectionLabel : selected.label;
    let submitLabel: string = selected.submit;
    if (profileSaving) submitLabel = 'Saving...';
    if (revokingSessions) submitLabel = 'Signing out...';
    if (deletingAccount) submitLabel = 'Deleting...';
    if (masterPasswordSaving) submitLabel = 'Updating vault protection...';
    return (
      <section className="flex flex-col gap-4">
        <h4 id="settings-action-title" tabIndex={-1} className={`flex items-center gap-2 font-semibold ${action === 'delete' ? 'text-(--danger)' : 'text-(--text-primary)'}`}>
          {action === 'delete' && <Trash2 size={17} aria-hidden="true" />}
          {action === 'protection' && <KeyRound size={17} aria-hidden="true" />}
          {title}{action === 'delete' && '?'}
        </h4>
        <p className="text-sm leading-relaxed text-(--text-secondary)">{selected.detail}</p>
        <form className="flex flex-col gap-4" noValidate onSubmit={action === 'hint' ? event => saveProfile(event, 'master_hint') : submitSecurity}>
          {renderSecurityFields()}
          <div className="settings-actions flex flex-wrap gap-2.5">
            <button type="submit" className={action === 'delete' ? 'btn-ghost btn-danger' : 'btn-primary'}
              disabled={busy || (action === 'hint' && !hintChanged)}>{submitLabel}</button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => chooseAction(null)}>Cancel</button>
          </div>
        </form>
      </section>
    );
  }

  function renderContent() {
    if (discardRequested) return (
      <section className="flex flex-col gap-4">
        <h4 className="font-semibold text-(--text-primary)">Discard unsaved changes?</h4>
        <p className="text-sm leading-relaxed text-(--text-secondary)">Your unsaved changes will be lost.</p>
        <div className="settings-actions flex flex-wrap gap-2.5">
          <button ref={keepEditingRef} type="button" className="btn-primary" onClick={() => {
            setDiscardRequested(false);
            requestAnimationFrame(() => document.getElementById(`settings-section-${section}`)?.focus());
          }}>Keep editing</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Discard and close</button>
        </div>
      </section>
    );
    return (
      <>
        <div className="settings-tabs mb-6 flex border-b border-(--border)" role="tablist" aria-label="Settings sections">
          {([{ id: 'account', label: 'Account', icon: UserRound }, { id: 'security', label: 'Security', icon: KeyRound }] as const).map(({ id, label, icon: Icon }) => (
            <button key={id} id={`settings-section-${id}`} type="button" role="tab"
              className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 border-b-2 border-transparent px-1 text-sm text-(--text-secondary)"
              aria-selected={section === id} aria-controls={`settings-panel-${id}`}
              tabIndex={section === id ? 0 : -1} disabled={busy}
              onClick={() => changeSection(id)} onKeyDown={handleSectionKey}>
              <Icon size={15} aria-hidden="true" />{label}
            </button>
          ))}
        </div>
        <div id={`settings-panel-${section}`} role="tabpanel" aria-labelledby={`settings-section-${section}`}>
          {errors.form && <p className="mb-4 text-sm text-(--danger)" role="alert">{errors.form}</p>}
          {saved && <output className="mb-4 block text-sm text-(--success)">{saved}</output>}
          {section === 'account' ? renderAccount() : renderSecurity()}
        </div>
      </>
    );
  }

  return (
    <Modal onClose={requestClose} closeDisabled={busy} title="Account Settings" icon={<Settings size={14} color="var(--accent)" />}>
      <div className="settings-content">{renderContent()}</div>
    </Modal>
  );
}
