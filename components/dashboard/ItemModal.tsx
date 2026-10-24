'use client';
import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import { Plus, Edit2, X, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { generatePassword } from '@/lib/crypto';
import { PasswordStrengthMeter } from '@/components/PasswordStrengthMeter';
import type { DecryptedPayload } from '@/lib/types';
import { ITEM_CATEGORIES } from './types';
import type { ItemForm } from './types';

export const ITEM_FIELDS = {
  url: { label: 'URL', copyLabel: 'URL', id: 'login-url', placeholder: 'https://github.com' },
  username: { label: 'Username / Email', copyLabel: 'Username', id: 'login-username', placeholder: 'you@example.com' },
  password: { label: 'Password', copyLabel: 'Password', secret: true },
  cardNumber: { label: 'Card Number', copyLabel: 'Card number', id: 'form-card-number', placeholder: '4111 1111 1111 1111', secret: true, style: { fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' } },
  cardHolder: { label: 'Cardholder Name', copyLabel: 'Cardholder', id: 'form-card-holder', placeholder: 'Jane Smith' },
  expiry: { label: 'Expiry', copyLabel: 'Expiry', id: 'form-expiry', placeholder: 'MM / YY' },
  cvv: { label: 'CVV', copyLabel: 'CVV', id: 'form-cvv', placeholder: '•••', secret: true },
  firstName: { label: 'First Name', copyLabel: 'First name', id: 'form-first-name', placeholder: 'Jane' },
  lastName: { label: 'Last Name', copyLabel: 'Last name', id: 'form-last-name', placeholder: 'Smith' },
  phone: { label: 'Phone', copyLabel: 'Phone', id: 'form-phone', placeholder: '+1 555 000 0000' },
  address: { label: 'Address', id: 'form-address', placeholder: '123 Main St, City', multiline: true },
  notes: { label: 'Notes', multiline: true },
} as const satisfies Record<Exclude<keyof DecryptedPayload, 'password_history'>, { label: string; copyLabel?: string; id?: string; placeholder?: string; secret?: boolean; multiline?: boolean; style?: React.CSSProperties }>;

const PASSWORD_GENERATOR_OPTIONS = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
} as const;

/* Field label */
function FieldLabel({ htmlFor, children }: Readonly<{ htmlFor: string; children: React.ReactNode }>) {
  return (
    <label htmlFor={htmlFor} style={{
      display: 'flex', alignItems: 'center', gap: 5,
      fontSize: '0.8rem', fontWeight: 600,
      letterSpacing: '0.05em', textTransform: 'uppercase',
      color: 'var(--text-secondary)', marginBottom: 7,
    }}>
      {children}
    </label>
  );
}

/* Category picker */
function CategoryPicker({ value, onChange }: Readonly<{ value: ItemForm['category']; onChange: (v: ItemForm['category']) => void }>) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {ITEM_CATEGORIES.map(({ id, pickerLabel, icon: Icon }) => {
        const active = value === id;
        return (
          <button key={id} type="button" aria-pressed={active} onClick={() => onChange(id)} style={{
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
            {pickerLabel}
          </button>
        );
      })}
    </div>
  );
}

/* Modal shell */
export function Modal({ children, onClose, title, icon, closeDisabled = false }: Readonly<{
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  closeDisabled?: boolean;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const closeDisabledRef = useRef(closeDisabled);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    closeDisabledRef.current = closeDisabled;
    onCloseRef.current = onClose;
  }, [closeDisabled, onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    titleRef.current?.focus();
    const handleCancel = (e: Event) => { e.preventDefault(); if (!closeDisabledRef.current) onCloseRef.current(); };
    const handleBackdropClick = (e: MouseEvent) => { if (e.target === dialog && !closeDisabledRef.current) onCloseRef.current(); };
    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('click', handleBackdropClick);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('click', handleBackdropClick);
      if (dialog.open) dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} className="modal-dialog" style={{
      position: 'fixed', inset: 0, margin: 0,
      width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%',
      background: 'var(--modal-backdrop)',
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      alignItems: 'flex-end', justifyContent: 'center',
      zIndex: 100, padding: 0, border: 'none',
    }}>
      <style>{`
                .modal-dialog[open] { display: flex; }
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
            <h3 id={titleId} ref={titleRef} tabIndex={-1} className="font-display" style={{ fontSize: '1.35rem', color: 'var(--text-primary)', lineHeight: 1 }}>
              {title}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="btn-icon" aria-label="Close dialog" disabled={closeDisabled} style={{ borderRadius: 8 }}>
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

function useFormField(form: ItemForm, setForm: (f: ItemForm) => void) {
  return useCallback(
    (key: keyof ItemForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [key]: e.target.value }),
    [form, setForm],
  );
}

function FormInput({ name, form, onChange }: Readonly<{
  name: Exclude<keyof DecryptedPayload, 'password' | 'notes' | 'password_history'>;
  form: ItemForm;
  onChange: (key: keyof ItemForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}>) {
  const definition = ITEM_FIELDS[name];
  return (
    <div>
      <FieldLabel htmlFor={definition.id}>{definition.label}</FieldLabel>
      <input id={definition.id} className="input-field" placeholder={definition.placeholder}
        type={'secret' in definition && definition.secret ? 'password' : 'text'}
        value={form[name]} onChange={onChange(name)}
        style={'style' in definition ? definition.style : undefined} />
    </div>
  );
}

/* Login form fields */
function LoginFormFields({ form, setForm }: Readonly<{ form: ItemForm; setForm: (f: ItemForm) => void }>) {
  const [showPw, setShowPw] = useState(false);
  const [generatorLength, setGeneratorLength] = useState<number>(PASSWORD_GENERATOR_OPTIONS.length);
  const [useSymbols, setUseSymbols] = useState(true);
  const [replacement, setReplacement] = useState<{ previous: string; generated: string } | null>(null);
  const generatorId = useId();
  const field = useFormField(form, setForm);
  const toggleShow = useCallback(() => setShowPw(v => !v), []);
  const generatePw = useCallback(() => {
    const generated = generatePassword({ ...PASSWORD_GENERATOR_OPTIONS, length: generatorLength, symbols: useSymbols });
    setReplacement({ previous: form.password, generated });
    setForm({ ...form, password: generated });
  }, [form, generatorLength, setForm, useSymbols]);

  return (
    <>
      <FormInput name="url" form={form} onChange={field} />
      <FormInput name="username" form={form} onChange={field} />
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
            <button type="button" onClick={toggleShow} aria-label={showPw ? 'Hide password' : 'Reveal password'} style={{
              position: 'absolute', right: 0, top: 0, bottom: 0, width: 42,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}>
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button type="button" className="btn-ghost" onClick={generatePw} title="Generate password" aria-label="Generate password"
            style={{ padding: '0 13px', flexShrink: 0, minHeight: 44, display: 'flex', alignItems: 'center', gap: 5 }}>
            <RefreshCw size={13} />
          </button>
        </div>
        {replacement?.generated && form.password === replacement.generated && (
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-(--text-secondary)">
            <span>Generated {replacement.generated.length}-character password</span>
            <button type="button" className="text-(--accent) underline underline-offset-4" onClick={() => {
              setForm({ ...form, password: replacement.previous });
              setReplacement(null);
            }}>Undo replacement</button>
          </div>
        )}
        <details className="mt-3 text-xs text-(--text-secondary)">
          <summary className="cursor-pointer py-1">Generator options</summary>
          <div className="mt-2 rounded-lg border border-(--border) p-3">
            <div className="mb-2 flex justify-between gap-3">
              <label htmlFor={`${generatorId}-length`}>Password length</label>
              <output htmlFor={`${generatorId}-length`}>{generatorLength} characters</output>
            </div>
            <input id={`${generatorId}-length`} type="range" min={8} max={128} step={1}
              className="w-full accent-(--accent)" value={generatorLength}
              onChange={event => setGeneratorLength(Number(event.target.value))} />
            <label className="mt-3 flex cursor-pointer items-center gap-2">
              <input type="checkbox" className="accent-(--accent)" checked={useSymbols}
                onChange={event => setUseSymbols(event.target.checked)} />Include symbols
            </label>
            <p className="mt-2 leading-5">Options apply the next time you generate a password.</p>
          </div>
        </details>
        <PasswordStrengthMeter password={form.password} />
      </div>
    </>
  );
}

/* Card form fields */
function CardFormFields({ form, setForm }: Readonly<{ form: ItemForm; setForm: (f: ItemForm) => void }>) {
  const field = useFormField(form, setForm);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <FormInput name="cardNumber" form={form} onChange={field} />
      <FormInput name="cardHolder" form={form} onChange={field} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <FormInput name="expiry" form={form} onChange={field} />
        <FormInput name="cvv" form={form} onChange={field} />
      </div>
    </div>
  );
}

/* Identity form fields */
function IdentityFormFields({ form, setForm }: Readonly<{ form: ItemForm; setForm: (f: ItemForm) => void }>) {
  const field = useFormField(form, setForm);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <FormInput name="firstName" form={form} onChange={field} />
        <FormInput name="lastName" form={form} onChange={field} />
      </div>
      <FormInput name="phone" form={form} onChange={field} />
      <FormInput name="address" form={form} onChange={field} />
    </div>
  );
}

/* Shared form body */
function ItemFormBody({ form, setForm, submitLabel, submitting, onClose }: Readonly<{
  form: ItemForm; setForm: (f: ItemForm) => void;
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

      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-(--text-secondary)">Category</legend>
        <CategoryPicker value={form.category} onChange={handleCategoryChange} />
      </fieldset>

      <div className="hairline" />

      {form.category === 'login' && <LoginFormFields form={form} setForm={setForm} />}
      {form.category === 'card' && <CardFormFields form={form} setForm={setForm} />}
      {form.category === 'identity' && <IdentityFormFields form={form} setForm={setForm} />}

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
  onSubmit: (e: React.SyntheticEvent) => void;
  onClose: () => void;
  mode: 'add' | 'edit';
}

const MODAL_CONFIG = {
  add: { title: 'Add Item', submitLabel: 'Save to Vault', icon: <Plus size={14} color="var(--accent)" /> },
  edit: { title: 'Edit Item', submitLabel: 'Save Changes', icon: <Edit2 size={14} color="var(--accent)" /> },
} as const;

export function ItemModal({ form, setForm, saving, onSubmit, onClose, mode }: Readonly<ItemModalProps>) {
  const { title, submitLabel, icon } = MODAL_CONFIG[mode];
  const [initialForm] = useState(() => ({ ...form }));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = (Object.keys(initialForm) as (keyof ItemForm)[]).some(key => form[key] !== initialForm[key]);
  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }, [dirty, onClose, saving]);
  const keepEditing = useCallback(() => setConfirmDiscard(false), []);
  const discardChanges = useCallback(() => {
    setForm({ ...initialForm });
    onClose();
  }, [initialForm, onClose, setForm]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty]);

  return (
    <>
      <Modal onClose={requestClose} title={title} icon={icon} closeDisabled={saving}>
        <form onSubmit={onSubmit} autoComplete="off">
          <fieldset disabled={saving} className="m-0 min-w-0 border-0 p-0">
            <ItemFormBody
              form={form} setForm={setForm}
              submitLabel={submitLabel} submitting={saving} onClose={requestClose}
            />
          </fieldset>
        </form>
      </Modal>
      {confirmDiscard && (
        <Modal onClose={keepEditing} title="Discard your changes?">
          <p className="text-sm leading-6 text-(--text-secondary)">Your changes have not been saved.</p>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="btn-ghost" onClick={keepEditing}>Keep editing</button>
            <button type="button" className="btn-ghost btn-danger" onClick={discardChanges}>Discard changes</button>
          </div>
        </Modal>
      )}
    </>
  );
}
