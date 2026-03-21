'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Globe, CreditCard, StickyNote, User, Plus, Edit2, X, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { generatePassword, passwordStrength } from '@/lib/crypto';
import type { ItemForm } from './types';

/* Field label */
export function FieldLabel({ htmlFor, children }: Readonly<{ htmlFor: string; children: React.ReactNode }>) {
  return (
    <label htmlFor={htmlFor} style={{
      display: 'flex', alignItems: 'center', gap: 5,
      fontSize: '0.68rem', fontWeight: 600,
      letterSpacing: '0.09em', textTransform: 'uppercase',
      color: 'var(--text-secondary)', marginBottom: 7,
    }}>
      {children}
    </label>
  );
}

/* Category picker */
const CATEGORY_CONFIG: ReadonlyArray<{
  value: ItemForm['category'];
  label: string;
  icon: typeof Globe;
}> = [
  { value: 'login', label: 'Login', icon: Globe },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'note', label: 'Note', icon: StickyNote },
  { value: 'identity', label: 'Identity', icon: User },
] as const;

export function CategoryPicker({ value, onChange }: Readonly<{ value: ItemForm['category']; onChange: (v: ItemForm['category']) => void }>) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {CATEGORY_CONFIG.map(({ value: v, label, icon: Icon }) => {
        const active = value === v;
        return (
          <button key={v} type="button" onClick={() => onChange(v)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 13px', borderRadius: 100,
            border: `1px solid ${active ? 'var(--accent-border-focus)' : 'var(--border)'}`,
            background: active ? 'var(--accent-dim)' : 'transparent',
            color: active ? 'var(--accent)' : 'var(--text-secondary)',
            fontSize: '0.78rem', fontFamily: 'var(--font-body)',
            cursor: 'pointer', transition: 'all 0.15s',
            minHeight: 32, fontWeight: active ? 500 : 400,
          }}>
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
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.show();
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const handleBackdropClick = (e: MouseEvent) => { if (e.target === dialog) onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    dialog.addEventListener('click', handleBackdropClick);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      dialog.removeEventListener('click', handleBackdropClick);
    };
  }, [onClose]);

  return (
    <dialog ref={dialogRef} style={{
      position: 'fixed', inset: 0, margin: 0,
      width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%',
      background: 'var(--modal-backdrop)',
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      zIndex: 100, padding: 0, border: 'none',
    }}>
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

      <div className="modal-sheet" style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
        width: '100%', maxWidth: 500, maxHeight: '93dvh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: 'var(--sheet-shadow)',
      }}>
        {/* Mobile drag handle */}
        <div className="modal-handle" style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 2, flexShrink: 0 }}>
          <div style={{ width: 32, height: 3, borderRadius: 2, background: 'var(--grip-bg)' }} />
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {icon && (
              <div style={{
                width: 32, height: 32, borderRadius: 9,
                background: 'var(--accent-dim)', border: '1px solid var(--accent-border-soft)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                {icon}
              </div>
            )}
            <h3 className="font-display" style={{ fontSize: '1.35rem', color: 'var(--text-primary)', lineHeight: 1 }}>
              {title}
            </h3>
          </div>
          <button onClick={onClose} className="btn-icon" style={{ borderRadius: 8 }}>
            <X size={14} />
          </button>
        </div>

        <div className="hairline" style={{ margin: '16px 0 0', flexShrink: 0 }} />

        <div style={{
          overflowY: 'auto', flex: 1, padding: '18px 22px',
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
  if (!s) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 3, marginBottom: 5 }}>
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} style={{
            height: 2, flex: 1, borderRadius: 2,
            background: i <= s.score ? s.color : 'var(--skeleton-2)',
            transition: 'background 0.3s',
          }} />
        ))}
      </div>
      <span style={{ fontSize: '0.7rem', color: s.color, fontWeight: 500 }}>{s.label}</span>
    </div>
  );
}

type PasswordGeneratorOptions = {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
};

function useFormField<T extends ItemForm>(form: T, setForm: (f: T) => void) {
  return useCallback(
    (key: keyof T) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [key]: e.target.value }),
    [form, setForm],
  );
}

/* Login form fields */
function LoginFormFields({ form, setForm, genOptions }: Readonly<{ form: ItemForm; setForm: (f: ItemForm) => void; genOptions: PasswordGeneratorOptions }>) {
  const [showPw, setShowPw] = useState(false);
  const field = useFormField(form, setForm);
  const toggleShow = useCallback(() => setShowPw(v => !v), []);
  const generatePw = useCallback(() => setForm({ ...form, password: generatePassword(genOptions) }), [form, setForm, genOptions]);

  return (
    <>
      <div>
        <FieldLabel htmlFor="login-url">URL</FieldLabel>
        <input id="login-url" className="input-field" placeholder="https://github.com"
          value={form.url} onChange={field('url')} />
      </div>
      <div>
        <FieldLabel htmlFor="login-username">Username / Email</FieldLabel>
        <input id="login-username" className="input-field" placeholder="you@example.com"
          value={form.username} onChange={field('username')} />
      </div>
      <div>
        <FieldLabel htmlFor="login-password">Password</FieldLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              id="login-password" className="input-field"
              type={showPw ? 'text' : 'password'}
              placeholder="••••••••••••"
              value={form.password} onChange={field('password')}
              style={{ paddingRight: 42, fontFamily: showPw ? 'inherit' : 'var(--font-mono)' }}
            />
            <button type="button" onClick={toggleShow} style={{
              position: 'absolute', right: 0, top: 0, bottom: 0, width: 42,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}>
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button type="button" className="btn-ghost" onClick={generatePw} title="Generate password"
            style={{ padding: '0 13px', flexShrink: 0, minHeight: 44, display: 'flex', alignItems: 'center', gap: 5 }}>
            <RefreshCw size={13} />
          </button>
        </div>
        <StrengthBar password={form.password} />
      </div>
    </>
  );
}

/* Card form fields */
function CardFormFields({ form, setForm, prefix }: Readonly<{ form: ItemForm; setForm: (f: ItemForm) => void; prefix: string }>) {
  const field = useFormField(form, setForm);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <FieldLabel htmlFor={`${prefix}-card-number`}>Card Number</FieldLabel>
        <input id={`${prefix}-card-number`} className="input-field" placeholder="4111 1111 1111 1111"
          value={form.cardNumber} onChange={field('cardNumber')}
          style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }} />
      </div>
      <div>
        <FieldLabel htmlFor={`${prefix}-card-holder`}>Cardholder Name</FieldLabel>
        <input id={`${prefix}-card-holder`} className="input-field" placeholder="Jane Smith"
          value={form.cardHolder} onChange={field('cardHolder')} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <FieldLabel htmlFor={`${prefix}-expiry`}>Expiry</FieldLabel>
          <input id={`${prefix}-expiry`} className="input-field" placeholder="MM / YY"
            value={form.expiry} onChange={field('expiry')} />
        </div>
        <div>
          <FieldLabel htmlFor={`${prefix}-cvv`}>CVV</FieldLabel>
          <input id={`${prefix}-cvv`} className="input-field" placeholder="•••" type="password"
            value={form.cvv} onChange={field('cvv')} />
        </div>
      </div>
    </div>
  );
}

/* Identity form fields */
function IdentityFormFields({ form, setForm, prefix }: Readonly<{ form: ItemForm; setForm: (f: ItemForm) => void; prefix: string }>) {
  const field = useFormField(form, setForm);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <FieldLabel htmlFor={`${prefix}-first-name`}>First Name</FieldLabel>
          <input id={`${prefix}-first-name`} className="input-field" placeholder="Jane"
            value={form.firstName} onChange={field('firstName')} />
        </div>
        <div>
          <FieldLabel htmlFor={`${prefix}-last-name`}>Last Name</FieldLabel>
          <input id={`${prefix}-last-name`} className="input-field" placeholder="Smith"
            value={form.lastName} onChange={field('lastName')} />
        </div>
      </div>
      <div>
        <FieldLabel htmlFor={`${prefix}-phone`}>Phone</FieldLabel>
        <input id={`${prefix}-phone`} className="input-field" placeholder="+1 555 000 0000"
          value={form.phone} onChange={field('phone')} />
      </div>
      <div>
        <FieldLabel htmlFor={`${prefix}-address`}>Address</FieldLabel>
        <input id={`${prefix}-address`} className="input-field" placeholder="123 Main St, City"
          value={form.address} onChange={field('address')} />
      </div>
    </div>
  );
}

/* Shared form body */
export function ItemFormBody({ form, setForm, genOptions, submitLabel, submitting, onClose }: Readonly<{
  form: ItemForm; setForm: (f: ItemForm) => void; genOptions: PasswordGeneratorOptions;
  submitLabel: string; submitting: boolean; onClose: () => void;
}>) {
  const field = useFormField(form, setForm);
  const handleCategoryChange = useCallback((v: ItemForm['category']) => setForm({ ...form, category: v }), [form, setForm]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <FieldLabel htmlFor="form-name">Name *</FieldLabel>
        <input id="form-name" className="input-field" required
          placeholder="e.g. GitHub, Netflix…"
          value={form.name} onChange={field('name')} />
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
        <textarea id="form-notes" className="input-field" rows={3}
          placeholder="Any additional notes…"
          value={form.notes} onChange={field('notes')}
          style={{ resize: 'vertical', lineHeight: 1.6 }} />
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
        <button type="button" className="btn-ghost" onClick={onClose} style={{ flex: 1, minHeight: 44 }}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={submitting} style={{ flex: 2, minHeight: 44 }}>
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  );
}

/* Modal exports */
interface ItemModalProps {
  form: ItemForm;
  setForm: (f: ItemForm) => void;
  saving: boolean;
  genOptions: PasswordGeneratorOptions;
  onSubmit: (e: React.SyntheticEvent) => void;
  onClose: () => void;
  mode: 'add' | 'edit';
}

const MODAL_CONFIG = {
  add: { title: 'Add Item', submitLabel: 'Save to Vault', icon: <Plus size={14} color="var(--accent)" /> },
  edit: { title: 'Edit Item', submitLabel: 'Save Changes', icon: <Edit2 size={14} color="var(--accent)" /> },
} as const;

function ItemModal({ form, setForm, saving, genOptions, onSubmit, onClose, mode }: Readonly<ItemModalProps>) {
  const { title, submitLabel, icon } = MODAL_CONFIG[mode];
  return (
    <Modal onClose={onClose} title={title} icon={icon}>
      <form onSubmit={onSubmit} autoComplete="off">
        <ItemFormBody
          form={form} setForm={setForm} genOptions={genOptions}
          submitLabel={submitLabel} submitting={saving} onClose={onClose}
        />
      </form>
    </Modal>
  );
}

export function AddItemModal({ newItem, setNewItem, savingItem, genOptions, onSubmit, onClose }: Readonly<{
  newItem: ItemForm; setNewItem: (f: ItemForm) => void; savingItem: boolean; genOptions: PasswordGeneratorOptions;
  onSubmit: (e: React.SyntheticEvent) => void; onClose: () => void;
}>) {
  return <ItemModal mode="add" form={newItem} setForm={setNewItem} saving={savingItem} genOptions={genOptions} onSubmit={onSubmit} onClose={onClose} />;
}

export function EditItemModal({ editForm, setEditForm, updatingItem, genOptions, onSubmit, onClose }: Readonly<{
  editForm: ItemForm; setEditForm: (f: ItemForm) => void; updatingItem: boolean; genOptions: PasswordGeneratorOptions;
  onSubmit: (e: React.SyntheticEvent) => void; onClose: () => void;
}>) {
  return <ItemModal mode="edit" form={editForm} setForm={setEditForm} saving={updatingItem} genOptions={genOptions} onSubmit={onSubmit} onClose={onClose} />;
}
