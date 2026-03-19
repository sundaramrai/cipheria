/**
 * lib/types.ts — Shared domain types used across lib/ and components/.
 *
 * Keeping these here (rather than in components/dashboard/types.ts) avoids
 * circular imports: lib/store.ts can import from lib/types.ts without pulling
 * in any React component dependency.
 */

export interface DecryptedPayload {
    // Login
    username?: string;
    password?: string;
    url?: string;
    // Card
    cardNumber?: string;
    cardHolder?: string;
    expiry?: string;
    cvv?: string;
    // Identity
    firstName?: string;
    lastName?: string;
    phone?: string;
    address?: string;
    // Shared
    notes?: string;
}

export interface VaultItem {
    id: string;
    name: string;
    category: string;
    /** Only present after fetching the detail endpoint */
    encrypted_data?: string;
    favicon_url?: string;
    is_favourite: boolean;
    is_deleted?: boolean;
    deleted_at?: string | null;
    created_at: string;
    updated_at: string;
    /** Populated client-side after decryption */
    decrypted?: DecryptedPayload;
}

export interface UserProfile {
    id: string;
    email: string;
    full_name?: string;
    vault_salt: string;
    master_hint?: string;
    email_verified: boolean;
    created_at?: string;
}

export interface SidebarCounts {
    all: number;
    login: number;
    card: number;
    note: number;
    identity: number;
    favourites: number;
    trash: number;
}

export interface AuthSession {
    access_token: string;
    token_type: string;
    vault_salt: string;
    user: UserProfile;
}

export interface PaginatedVaultItems<TItem> {
    items: TItem[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
    sidebar_counts?: SidebarCounts | null;
}
