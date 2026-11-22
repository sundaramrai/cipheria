'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toastService } from '@/lib/toast';
import { parseApiError } from '@/lib/errors';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { deriveKey, deriveMasterPasswordVerifier } from '@/lib/crypto';
import { createVaultKey, unlockKey } from '@/lib/vaultKeys';

type Tab = 'login' | 'register';

interface AuthForm {
    email: string;
    masterPassword: string;
    confirmMasterPassword: string;
    fullName: string;
    masterHint: string;
}

const EMPTY_FORM: AuthForm = {
    email: '',
    masterPassword: '',
    confirmMasterPassword: '',
    fullName: '',
    masterHint: '',
};

/**
 * useAuthForm
 * Encapsulates all auth page state and submit logic.
 * The page component becomes nearly pure JSX.
 */
export function useAuthForm(initialTab: Tab = 'login') {
    const router = useRouter();
    const { completeAuth } = useAuthStore();

    const tab = initialTab;
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState<AuthForm>(EMPTY_FORM);

    const setTab = (nextTab: Tab) => router.replace(
        nextTab === 'register' ? '/auth?tab=register' : '/auth', { scroll: false },
    );
    const toggleTab = () => setTab(tab === 'login' ? 'register' : 'login');

    const togglePassword = () => setShowPassword((v) => !v);

    const handleChange =
        (field: keyof AuthForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
            setForm((prev) => ({ ...prev, [field]: e.target.value }));

    const handleSubmit = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (tab === 'register') {
                if (!form.masterPassword) {
                    toastService.error('Enter a master password');
                    return;
                }
                if (form.masterPassword !== form.confirmMasterPassword) {
                    toastService.error('Master password confirmation does not match');
                    return;
                }
                const { envelope, key } = await createVaultKey(form.masterPassword);
                const vaultSalt = envelope.salt;
                const masterPasswordVerifier = await deriveMasterPasswordVerifier(form.masterPassword, vaultSalt, 2);
                const { data } = await authApi.register(
                    form.email,
                    vaultSalt,
                    masterPasswordVerifier,
                    form.fullName,
                    form.masterHint,
                    envelope,
                );
                completeAuth(data.user, data.access_token, key);
                toastService.success('Account created. Check your email to verify the account.');
            } else {
                if (!form.masterPassword) {
                    toastService.error('Enter your master password');
                    return;
                }
                const { data: challenge } = await authApi.loginChallenge(form.email);
                const masterPasswordVerifier = await deriveMasterPasswordVerifier(form.masterPassword, challenge.vault_salt, challenge.version);
                const { data } = await authApi.login(form.email, masterPasswordVerifier);
                const key = data.user.key_envelope ? await unlockKey(form.masterPassword, data.user.key_envelope)
                    : await deriveKey(form.masterPassword, data.user.vault_salt);
                completeAuth(data.user, data.access_token, key);
                toastService.success('Welcome back!');
            }
            router.replace('/dashboard');
        } catch (err: unknown) {
            toastService.error(parseApiError(err, 'Something went wrong'));
        } finally {
            setLoading(false);
        }
    };

    let submitLabel: string;
    if (loading) {
        submitLabel = 'Please wait...';
    } else if (tab === 'login') {
        submitLabel = 'Unlock Vault';
    } else {
        submitLabel = 'Create Account';
    }

    return {
        tab,
        setTab,
        toggleTab,
        showPassword,
        togglePassword,
        loading,
        form,
        handleChange,
        handleSubmit,
        submitLabel,
    };
}
