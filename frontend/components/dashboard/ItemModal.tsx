'use client';
import React, { useState, useEffect } from 'react';
import { Globe, CreditCard, StickyNote, User, Plus, Edit2, X, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { generatePassword, passwordStrength } from '@/lib/crypto';

/* Field label */
export function FieldLabel({ htmlFor, children }: Readonly<{ htmlFor: string; children: React.ReactNode }>) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        fontSize: '0.68rem', fontWeight: 600,
        letterSpacing: '0.09em', textTransform: 'uppercase',
        color: 'var(--text-secondary)', marginBottom: 7,
      }}
    >
      {children}
    </label>
  );
}

/* Category picker */
const CATEGORY_CONFIG = [
  { value: 'login', label: 'Login', icon: Globe },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'note', label: 'Note', icon: StickyNote },
  { value: 'identity', label: 'Identity', icon: User },
] as const;

export function CategoryPicker({ value, onChange }: Readonly<{ value: string; onChange: (v: string) => void }>) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {CATEGORY_CONFIG.map(({ value: v, label, icon: Icon }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 13px',
              borderRadius: 100,
              border: `1px solid ${active ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
              background: active ? 'var(--accent-dim)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: '0.78rem',
              fontFamily: 'var(--font-body)',
              cursor: 'pointer',
              transition: 'all 0.15s',
              minHeight: 32,
              fontWeight: active ? 500 : 400,
            }}
          >
            <Icon size={12} strokeWidth={active ? 2.2 : 1.8} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* Modal shell */
export function Modal({ children, onClose, title, icon }: Readonly<{
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
}>) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.show();
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const handleBackdropClick = (e: MouseEvent) => { if (e.target === dialog) onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    dialog?.addEventListener('click', handleBackdropClick);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      dialog?.removeEventListener('click', handleBackdropClick);
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      style={{
        position: 'fixed', inset: 0, margin: 0,
        width: '100%', height: '100%',
        maxWidth: '100%', maxHeight: '100%',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        zIndex: 100, padding: 0, border: 'none',
      }}
    >
      <style>{`
        @media (min-width: 600px) {
          .modal-dialog { align-items: center !important; padding: 24px !important; }
          .modal-sheet  { border-radius: var(--radius-xl) !important; margin-bottom: 0 !important; }
          .modal-handle { display: none !important; }
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .modal-sheet { animation: slideUp 0.26s cubic-bezier(0.32, 0.72, 0, 1) forwards; }
      `}</style>

      <div
        className="modal-sheet"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
          width: '100%', maxWidth: 500,
          maxHeight: '93dvh',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 -8px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(245,158,11,0.06)',
        }}
      >
        {/* Mobile drag handle */}
        <div
          className="modal-handle"
          style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 2, flexShrink: 0 }}
        >
          <div style={{ width: 32, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.12)' }} />
        </div>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 22px 0',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {icon && (
              <div style={{
                width: 32, height: 32, borderRadius: 9,
                background: 'var(--accent-dim)',
                border: '1px solid rgba(245,158,11,0.22)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {icon}
              </div>
            )}
            <h3
              className="font-display"
              style={{ fontSize: '1.35rem', color: 'var(--text-primary)', lineHeight: 1 }}
            >
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="btn-icon"
            style={{ borderRadius: 8 }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Divider */}
        <div className="hairline" style={{ margin: '16px 0 0', flexShrink: 0 }} />

        {/* Scrollable body */}
        <div style={{
          overflowY: 'auto',
          flex: 1,
          padding: '18px 22px',
          paddingBottom: 'calc(18px + env(safe-area-inset-bottom, 0px))',
        }}>
          {children}
        </div>
      </div>
    </dialog>
  );
}

/* Password strength bar */
function StrengthBar({ password }: Readonly<{ password: string }>) {
  const s = password ? passwordStrength(password) : null;
  if (!s || !password) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 3, marginBottom: 5 }}>
        {[0, 1, 2, 3, 4].map(i => (
          <div
            key={i}
            style={{
              height: 2, flex: 1, borderRadius: 2,
              background: i <= s.score ? s.color : 'rgba(255,255,255,0.07)',
              transition: 'background 0.3s',
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: '0.7rem', color: s.color, fontWeight: 500 }}>{s.label}</span>
    </div>
  );
}

/* Login form fields */
function LoginFormFields({ form, setForm, genOptions }: Readonly<{ form: any; setForm: (f: any) => void; genOptions: any }>) {
  const [showPw, setShowPw] = useState(false);
  return (
    <>
      <div>
        <FieldLabel htmlFor="login-url">URL</FieldLabel>
        <input id="login-url" className="input-field" placeholder="https://github.com"
          value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
      </div>
      <div>
        <FieldLabel htmlFor="login-username">Username / Email</FieldLabel>
        <input id="login-username" className="input-field" placeholder="you@example.com"
          value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
      </div>
      <div>
        <FieldLabel htmlFor="login-password">Password</FieldLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              id="login-password"
              className="input-field"
              type={showPw ? 'text' : 'password'}
              placeholder="••••••••••••"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              style={{ paddingRight: 42, fontFamily: showPw ? 'inherit' : 'var(--font-mono)' }}
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              style={{
                position: 'absolute', right: 0, top: 0, bottom: 0, width: 42,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: '0 13px', flexShrink: 0, minHeight: 44, display: 'flex', alignItems: 'center', gap: 5 }}
            onClick={() => setForm({ ...form, password: generatePassword(genOptions) })}
            title="Generate password"
          >
            <RefreshCw size={13} />
          </button>
        </div>
        <StrengthBar password={form.password} />
      </div>
    </>
  );
}

/* Card form fields */
function CardFormFields({ form, setForm, prefix }: Readonly<{ form: any; setForm: (f: any) => void; prefix: string }>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <FieldLabel htmlFor={`${prefix}-card-number`}>Card Number</FieldLabel>
        <input id={`${prefix}-card-number`} className="input-field" placeholder="4111 1111 1111 1111"
          value={form.cardNumber} onChange={(e) => setForm({ ...form, cardNumber: e.target.value })}
          style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }} />
      </div>
      <div>
        <FieldLabel htmlFor={`${prefix}-card-holder`}>Cardholder Name</FieldLabel>
        <input id={`${prefix}-card-holder`} className="input-field" placeholder="Jane Smith"
          value={form.cardHolder} onChange={(e) => setForm({ ...form, cardHolder: e.target.value })} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <FieldLabel htmlFor={`${prefix}-expiry`}>Expiry</FieldLabel>
          <input id={`${prefix}-expiry`} className="input-field" placeholder="MM / YY"
            value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} />
        </div>
        <div>
          <FieldLabel htmlFor={`${prefix}-cvv`}>CVV</FieldLabel>
          <input id={`${prefix}-cvv`} className="input-field" placeholder="•••" type="password"
            value={form.cvv} onChange={(e) => setForm({ ...form, cvv: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

/* Identity form fields */
function IdentityFormFields({ form, setForm, prefix }: Readonly<{ form: any; setForm: (f: any) => void; prefix: string }>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <FieldLabel htmlFor={`${prefix}-first-name`}>First Name</FieldLabel>
          <input id={`${prefix}-first-name`} className="input-field" placeholder="Jane"
            value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
        </div>
        <div>
          <FieldLabel htmlFor={`${prefix}-last-name`}>Last Name</FieldLabel>
          <input id={`${prefix}-last-name`} className="input-field" placeholder="Smith"
            value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
        </div>
      </div>
      <div>
        <FieldLabel htmlFor={`${prefix}-phone`}>Phone</FieldLabel>
        <input id={`${prefix}-phone`} className="input-field" placeholder="+1 555 000 0000"
          value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </div>
      <div>
        <FieldLabel htmlFor={`${prefix}-address`}>Address</FieldLabel>
        <input id={`${prefix}-address`} className="input-field" placeholder="123 Main St, City"
          value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </div>
    </div>
  );
}

/* Shared form body */
export function ItemFormBody({
  form, setForm, genOptions, submitLabel, submitting, onClose,
}: Readonly<{
  form: any; setForm: (f: any) => void; genOptions: any;
  submitLabel: string; submitting: boolean; onClose: () => void;
}>) {
  const handleCategoryChange = React.useCallback((v: string): void => {
    setForm({ ...form, category: v });
  }, [form, setForm]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <FieldLabel htmlFor="form-name">Name *</FieldLabel>
        <input
          id="form-name" className="input-field" required
          placeholder="e.g. GitHub, Netflix…"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>

      <div>
        <FieldLabel htmlFor="form-category">Category</FieldLabel>
        <CategoryPicker value={form.category} onChange={handleCategoryChange} />
      </div>

      <div className="hairline" />

      {form.category === 'login' && <LoginFormFields form={form} setForm={setForm} genOptions={genOptions} />}
      {form.category === 'card' && <CardFormFields form={form} setForm={setForm} prefix="form" />}
      {form.category === 'identity' && <IdentityFormFields form={form} setForm={setForm} prefix="form" />}

      <div>
        <FieldLabel htmlFor="form-notes">Notes</FieldLabel>
        <textarea
          id="form-notes" className="input-field" rows={3}
          placeholder="Any additional notes…"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          style={{ resize: 'vertical', lineHeight: 1.6 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
        <button type="button" className="btn-ghost" onClick={onClose} style={{ flex: 1, minHeight: 44 }}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn-primary"
          disabled={submitting}
          style={{ flex: 2, minHeight: 44 }}
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  );
}

/* Modal exports */
export function AddItemModal({ newItem, setNewItem, savingItem, genOptions, onSubmit, onClose }: Readonly<{
  newItem: any; setNewItem: (f: any) => void; savingItem: boolean; genOptions: any;
  onSubmit: (e: React.SyntheticEvent) => void; onClose: () => void;
}>) {
  return (
    <Modal onClose={onClose} title="Add Item" icon={<Plus size={14} color="var(--accent)" />}>
      <form onSubmit={onSubmit} autoComplete="off">
        <ItemFormBody
          form={newItem} setForm={setNewItem} genOptions={genOptions}
          submitLabel="Save to Vault" submitting={savingItem} onClose={onClose}
        />
      </form>
    </Modal>
  );
}

export function EditItemModal({ editForm, setEditForm, updatingItem, genOptions, onSubmit, onClose }: Readonly<{
  editForm: any; setEditForm: (f: any) => void; updatingItem: boolean; genOptions: any;
  onSubmit: (e: React.SyntheticEvent) => void; onClose: () => void;
}>) {
  return (
    <Modal onClose={onClose} title="Edit Item" icon={<Edit2 size={14} color="var(--accent)" />}>
      <form onSubmit={onSubmit} autoComplete="off">
        <ItemFormBody
          form={editForm} setForm={setEditForm} genOptions={genOptions}
          submitLabel="Save Changes" submitting={updatingItem} onClose={onClose}
        />
      </form>
    </Modal>
  );
}