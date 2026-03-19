'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toastService } from '@/lib/toast';
import { parseApiError } from '@/lib/errors';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { deriveKey, deriveMasterPasswordVerifier, generateSaltHex, passwordStrength } from '@/lib/crypto';

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

    const [tab, setTab] = useState<Tab>(initialTab);
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState<AuthForm>(EMPTY_FORM);

    const strength = tab === 'register' ? passwordStrength(form.masterPassword) : null;

    const toggleTab = () => {
        setTab((t) => (t === 'login' ? 'register' : 'login'));
        setForm(EMPTY_FORM);
    };

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
                const vaultSalt = generateSaltHex();
                const key = await deriveKey(form.masterPassword, vaultSalt);
                const masterPasswordVerifier = await deriveMasterPasswordVerifier(form.masterPassword, vaultSalt);
                const { data } = await authApi.register(
                    form.email,
                    vaultSalt,
                    masterPasswordVerifier,
                    form.fullName,
                    form.masterHint,
                );
                completeAuth(data.user, data.access_token, key);
                toastService.success('Account created. Check your email to verify the account.');
            } else {
                if (!form.masterPassword) {
                    toastService.error('Enter your master password');
                    return;
                }
                const { data: challenge } = await authApi.loginChallenge(form.email);
                const key = await deriveKey(form.masterPassword, challenge.vault_salt);
                const masterPasswordVerifier = await deriveMasterPasswordVerifier(form.masterPassword, challenge.vault_salt);
                const { data } = await authApi.login(form.email, masterPasswordVerifier);
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
        strength,
        submitLabel,
    };
}
