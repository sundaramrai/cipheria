'use client';
import { Lock } from 'lucide-react';

interface Props {
    user: any;
    masterPassword: string;
    setMasterPassword: (v: string) => void;
    unlocking: boolean;
    signout: boolean;
    setSignout: (v: boolean) => void;
    unlockVault: (e: React.SyntheticEvent) => void;
    handleLogout: () => Promise<void>;
}

export function LockedVaultScreen({ user, masterPassword, setMasterPassword, unlocking, signout, setSignout, unlockVault, handleLogout }: Readonly<Props>) {
    const handleSignout = async () => {
        setSignout(true);
        try { await handleLogout(); } finally { setSignout(false); }
    };

    return (
        <div
            style={{
                minHeight: '100dvh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg)',
                padding: 'clamp(16px, 5vw, 24px)',
                position: 'relative',
            }}
        >
            {/* Ambient glow */}
            <div
                aria-hidden
                style={{
                    position: 'fixed',
                    top: '25%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 'min(560px, 120vw)',
                    height: 'min(560px, 120vw)',
                    borderRadius: '50%',
                    background: 'radial-gradient(ellipse, rgba(245,158,11,0.07) 0%, transparent 68%)',
                    pointerEvents: 'none',
                }}
            />

            <div
                style={{
                    width: '100%',
                    maxWidth: 400,
                    position: 'relative',
                    zIndex: 1,
                }}
            >
                {/* Lock icon — separate stagger */}
                <div
                    className="animate-fade-up"
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        marginBottom: 28,
                    }}
                >
                    <div
                        style={{
                            width: 64,
                            height: 64,
                            borderRadius: 18,
                            background: 'var(--accent-dim)',
                            border: '1px solid rgba(245,158,11,0.25)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 0 30px rgba(245,158,11,0.1)',
                            marginBottom: 18,
                        }}
                    >
                        <Lock size={28} color="var(--accent)" />
                    </div>
                    <h2
                        className="font-display"
                        style={{ fontSize: 'clamp(1.75rem, 6vw, 2.25rem)', color: 'var(--text-primary)', marginBottom: 6 }}
                    >
                        Vault Locked
                    </h2>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                        Enter your master password to continue
                    </p>
                    {user?.master_hint && (
                        <p
                            style={{
                                marginTop: 10,
                                fontSize: '0.78rem',
                                color: 'rgba(245,158,11,0.65)',
                                fontStyle: 'italic',
                                textAlign: 'center',
                            }}
                        >
                            Hint: {user.master_hint}
                        </p>
                    )}
                </div>

                {/* Card */}
                <div
                    className="glass animate-fade-up stagger-2"
                    style={{ borderRadius: 'var(--radius-xl)', padding: 'clamp(22px, 6vw, 36px)' }}
                >
                    <form onSubmit={unlockVault} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <input
                            className="input-field"
                            type="password"
                            placeholder="Master password"
                            required
                            autoFocus
                            value={masterPassword}
                            onChange={(e) => setMasterPassword(e.target.value)}
                        />
                        <button
                            className="btn-primary"
                            type="submit"
                            disabled={unlocking}
                            style={{ width: '100%', minHeight: 46 }}
                        >
                            {unlocking ? 'Unlocking…' : 'Unlock Vault'}
                        </button>
                    </form>

                    <div className="divider" style={{ margin: '14px 0' }} />

                    <button
                        onClick={handleSignout}
                        className="btn-ghost btn-danger"
                        disabled={signout}
                        style={{ width: '100%', minHeight: 42, fontSize: '0.85rem' }}
                    >
                        {signout ? 'Signing out…' : 'Sign out of Cipheria'}
                    </button>
                </div>
            </div>
        </div>
    );
}