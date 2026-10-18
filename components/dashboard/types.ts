import { Globe, CreditCard, StickyNote, User } from 'lucide-react';
export const ITEM_CATEGORIES = [
    { id: 'login', label: 'Logins', pickerLabel: 'Login', icon: Globe },
    { id: 'card', label: 'Cards', pickerLabel: 'Card', icon: CreditCard },
    { id: 'note', label: 'Notes', pickerLabel: 'Note', icon: StickyNote },
    { id: 'identity', label: 'Identities', pickerLabel: 'Identity', icon: User },
] as const;
export type Category = 'all' | typeof ITEM_CATEGORIES[number]['id'];

export const CATEGORY_ICONS = Object.fromEntries(ITEM_CATEGORIES.map(({ id, icon }) => [id, icon]));

/** Auto-lock after 5 minutes of inactivity */
export const IDLE_MS = 5 * 60 * 1000;

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
