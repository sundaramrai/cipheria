'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Mail, Settings, Trash2, UserRound, MonitorCog, MoonStar, SunMedium } from 'lucide-react';
import { Modal } from './ItemModal';
import { applyThemePreference, getStoredThemePreference } from '@/lib/theme';
import type { ThemePreference } from '@/lib/theme';

type ProfileForm = {
  full_name: string;
  master_hint: string;
};

type MasterPasswordForm = {
  password: string;
  confirm: string;
  master_hint: string;
};

interface SettingsModalProps {
  user: {
    email?: string;
    email_verified?: boolean;
  } | null;
  profileForm: ProfileForm;
  setProfileForm: (form: ProfileForm) => void;
  masterPasswordForm: MasterPasswordForm;
  setMasterPasswordForm: (form: MasterPasswordForm) => void;
  deletePassword: string;
  setDeletePassword: (value: string) => void;
  profileSaving: boolean;
  verificationSending: boolean;
  masterPasswordSaving: boolean;
  deletingAccount: boolean;
  onClose: () => void;
  onSaveProfile: (e: React.SyntheticEvent) => void;
  onResendVerification: () => void;
  onChangeMasterPassword: (e: React.SyntheticEvent) => void;
  onDeleteAccount: (e: React.SyntheticEvent) => void;
}

const sectionStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '16px 0',
} as const;

const labelStyle = {
  display: 'block',
  fontSize: '0.74rem',
  color: 'var(--text-secondary)',
  marginBottom: 6,
  letterSpacing: '0.05em',
} as const;

const themeButtonStyle = {
  flex: 1,
  minHeight: 40,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontFamily: 'var(--font-body), sans-serif',
  fontSize: '0.82rem',
  transition: 'all 0.18s',
} as const;

export function SettingsModal({
  user,
  profileForm,
  setProfileForm,
  masterPasswordForm,
  setMasterPasswordForm,
  deletePassword,
  setDeletePassword,
  profileSaving,
  verificationSending,
  masterPasswordSaving,
  deletingAccount,
  onClose,
  onSaveProfile,
  onResendVerification,
  onChangeMasterPassword,
  onDeleteAccount,
}: Readonly<SettingsModalProps>) {
  const [theme, setTheme] = useState<ThemePreference>('system');

  useEffect(() => {
    setTheme(getStoredThemePreference());
  }, []);

  const handleThemeChange = (nextTheme: ThemePreference) => {
    setTheme(nextTheme);
    applyThemePreference(nextTheme);
  };

  return (
    <Modal
      onClose={onClose}
      title="Account Settings"
      icon={<Settings size={14} color="var(--accent)" />}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserRound size={16} color="var(--accent)" />
            <h4 style={{ color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: 600 }}>Profile</h4>
          </div>
          <form onSubmit={onSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label htmlFor="settings-full-name" style={labelStyle}>FULL NAME</label>
              <input
                id="settings-full-name"
                className="input-field"
                value={profileForm.full_name}
                onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="settings-master-hint" style={labelStyle}>MASTER HINT</label>
              <input
                id="settings-master-hint"
                className="input-field"
                value={profileForm.master_hint}
                onChange={(e) => setProfileForm({ ...profileForm, master_hint: e.target.value })}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={profileSaving}>
              {profileSaving ? 'Saving…' : 'Save Profile'}
            </button>
          </form>
        </section>

        <div className="hairline" />

        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MonitorCog size={16} color="var(--accent)" />
            <h4 style={{ color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: 600 }}>Theme</h4>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { id: 'system', label: 'System', icon: MonitorCog },
              { id: 'light', label: 'Light', icon: SunMedium },
              { id: 'dark', label: 'Dark', icon: MoonStar },
            ].map(({ id, label, icon: Icon }) => {
              const active = theme === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleThemeChange(id as ThemePreference)}
                  style={{
                    ...themeButtonStyle,
                    color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    background: active ? 'var(--accent-dim)' : 'transparent',
                    borderColor: active ? 'var(--border-hover)' : 'var(--border)',
                  }}
                >
                  <Icon size={15} />
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        <div className="hairline" />

        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mail size={16} color="var(--accent)" />
            <h4 style={{ color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: 600 }}>Email Verification</h4>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.6 }}>
            {user?.email_verified
              ? `Verified: ${user?.email}`
              : `Current email: ${user?.email ?? 'Unknown'}`}
          </p>
          {!user?.email_verified && (
            <button type="button" className="btn-ghost" onClick={onResendVerification} disabled={verificationSending}>
              {verificationSending ? 'Sending…' : 'Resend verification email'}
            </button>
          )}
        </section>

        <div className="hairline" />

        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <KeyRound size={16} color="var(--accent)" />
            <h4 style={{ color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: 600 }}>Master Password</h4>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.6 }}>
            You can change your master password only while the vault is unlocked. Cipheria re-encrypts every vault item, including items in trash, with the new password and rotates your vault salt.
          </p>
          <form onSubmit={onChangeMasterPassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label htmlFor="settings-new-master-password" style={labelStyle}>NEW MASTER PASSWORD</label>
              <input
                id="settings-new-master-password"
                className="input-field"
                type="password"
                value={masterPasswordForm.password}
                onChange={(e) => setMasterPasswordForm({ ...masterPasswordForm, password: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="settings-confirm-master-password" style={labelStyle}>CONFIRM MASTER PASSWORD</label>
              <input
                id="settings-confirm-master-password"
                className="input-field"
                type="password"
                value={masterPasswordForm.confirm}
                onChange={(e) => setMasterPasswordForm({ ...masterPasswordForm, confirm: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="settings-new-master-hint" style={labelStyle}>NEW MASTER HINT</label>
              <input
                id="settings-new-master-hint"
                className="input-field"
                value={masterPasswordForm.master_hint}
                onChange={(e) => setMasterPasswordForm({ ...masterPasswordForm, master_hint: e.target.value })}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={masterPasswordSaving}>
              {masterPasswordSaving ? 'Re-encrypting…' : 'Change Master Password'}
            </button>
          </form>
        </section>

        <div className="hairline" />

        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Trash2 size={16} color="var(--danger)" />
            <h4 style={{ color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: 600 }}>Delete Account</h4>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.6 }}>
            This permanently deletes your account, vault items, sessions, and audit history.
          </p>
          <form onSubmit={onDeleteAccount} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label htmlFor="settings-delete-password" style={labelStyle}>MASTER PASSWORD</label>
              <input
                id="settings-delete-password"
                className="input-field"
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-ghost btn-danger" disabled={deletingAccount}>
              {deletingAccount ? 'Deleting…' : 'Delete Account'}
            </button>
          </form>
        </section>
      </div>
    </Modal>
  );
}
