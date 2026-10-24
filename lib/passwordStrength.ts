import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary as commonDictionary } from '@zxcvbn-ts/language-common';
import { dictionary as englishDictionary, translations } from '@zxcvbn-ts/language-en';

// Loaded only when a password is entered. No password leaves the browser.
const estimator = new ZxcvbnFactory({
  translations,
  graphs: adjacencyGraphs,
  dictionary: { ...commonDictionary, ...englishDictionary },
});

const LEVELS = [
  { label: 'Very weak', color: 'var(--danger)' },
  { label: 'Weak', color: 'var(--strength-weak)' },
  { label: 'Fair', color: 'var(--strength-fair)' },
  { label: 'Strong', color: 'var(--strength-strong)' },
  { label: 'Very strong', color: 'var(--success)' },
] as const;

export function passwordStrength(password: string) {
  const { score, feedback } = estimator.check(password);
  return {
    score,
    ...LEVELS[score],
    feedback: [feedback.warning, ...feedback.suggestions].filter(Boolean).join(' '),
  };
}

export type PasswordStrength = ReturnType<typeof passwordStrength>;
