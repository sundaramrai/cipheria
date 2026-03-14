'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toastService } from '@/lib/toast';
import { parseApiError } from '@/lib/errors';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { passwordStrength } from '@/lib/crypto';

type Tab = 'login' | 'register';

interface AuthForm {
    email: string;
    password: string;
    fullName: string;
    masterHint: string;
}

const EMPTY_FORM: AuthForm = { email: '', password: '', fullName: '', masterHint: '' };

/**
 * useAuthForm
 * Encapsulates all auth page state and submit logic.
 * The page component becomes nearly pure JSX.
 */
export function useAuthForm(initialTab: Tab = 'login') {
    const router = useRouter();
    const { setAuth } = useAuthStore();

    const [tab, setTab] = useState<Tab>(initialTab);
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState<AuthForm>(EMPTY_FORM);

    const strength = tab === 'register' ? passwordStrength(form.password) : null;

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
                const { data } = await authApi.register(
                    form.email,
                    form.password,
                    form.fullName,
                    form.masterHint,
                );
                const { data: user } = await authApi.me();
                // setAuth is the single source of truth for the access token
                setAuth(user, data.access_token);
                toastService.success('Account created! Set your master password to unlock the vault.');
            } else {
                const { data } = await authApi.login(form.email, form.password);
                const { data: user } = await authApi.me();
                setAuth(user, data.access_token);
                toastService.success('Welcome back!');
            }
            router.push('/dashboard');
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
        submitLabel = 'Sign In';
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
