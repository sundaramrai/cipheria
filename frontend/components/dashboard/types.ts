import type { LucideIcon } from 'lucide-react';
import { Globe, CreditCard, StickyNote, User } from 'lucide-react';
export type { VaultItem, DecryptedPayload } from '@/lib/types';

export type Category = 'all' | 'login' | 'card' | 'note' | 'identity';

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
    login: Globe,
    card: CreditCard,
    note: StickyNote,
    identity: User,
};

/** Auto-lock after 5 minutes of inactivity */
export const IDLE_MS = 5 * 60 * 1000;

export const genOptions = {
    length: 20,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
} as const;

export type ItemForm = {
    name: string;
    category: Exclude<Category, 'all'>;
    username: string;
    password: string;
    url: string;
    notes: string;
    cardNumber: string;
    cardHolder: string;
    expiry: string;
    cvv: string;
    firstName: string;
    lastName: string;
    phone: string;
    address: string;
};

/**
 * Empty form template.
 * Use spread to reset: setForm({ ...emptyForm })
 * `as const` prevents accidental mutation of the template object.
 */
export const emptyForm = {
    name: '', category: 'login',
    username: '', password: '', url: '', notes: '',
    cardNumber: '', cardHolder: '', expiry: '', cvv: '',
    firstName: '', lastName: '', phone: '', address: '',
} satisfies ItemForm;
