'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Modal } from './ItemModal';
import { vaultApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { parseApiError } from '@/lib/errors';
import { toastService } from '@/lib/toast';
import { buildImportRequest, MAX_EXPORT_BYTES, prepareImport, prepareImportItems, selectImportItems } from '@/lib/vaultImport';
import type { ImportPreview, ImportRequest } from '@/lib/vaultImport';
import { CSV_FIELDS, mapCsvRows, parseCsv, suggestCsvMapping } from '@/lib/csvImport';
import type { CsvIssue, CsvMapping, CsvTable } from '@/lib/csvImport';

const FIELD_LABELS = { name: 'Title', url: 'Website URL', username: 'Username', password: 'Password', notes: 'Notes' };

export function ImportVaultModal({ onClose, onImported }: Readonly<{
  onClose: () => void;
  onImported: () => void;
}>) {
  const [destination] = useState(() => {
    const { cryptoKey, user } = useAuthStore.getState();
    return { cryptoKey, user: user ? { id: user.id, vault_salt: user.vault_salt } : null };
  });
  const controller = useRef(new AbortController());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [csv, setCsv] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [acknowledgeOmitted, setAcknowledgeOmitted] = useState(false);
  const [issues, setIssues] = useState<CsvIssue[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [password, setPassword] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [request, setRequest] = useState<ImportRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const csvReview = useMemo(() => {
    if (!csv || !mapping) return null;
    try { return { data: mapCsvRows(csv, mapping), error: '' }; } catch (cause) {
      return { data: null, error: cause instanceof Error ? cause.message : 'Check the column mapping.' };
    }
  }, [csv, mapping]);

  useEffect(() => {
    // Subscribe synchronously: lock/account changes must cancel work before another await resumes.
    controller.current = new AbortController();
    const active = controller.current;
    const unsubscribe = useAuthStore.subscribe(state => {
      if (state.cryptoKey !== destination.cryptoKey || state.user?.id !== destination.user?.id ||
          state.user?.vault_salt !== destination.user?.vault_salt || state.isVaultLocked) active.abort();
    });
    return () => { active.abort(); unsubscribe(); };
  }, [destination]);

  const prepare = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (busy || (!file && !csv) || !destination.cryptoKey) return;
    const signal = controller.current.signal;
    setBusy(true);
    setError('');
    try {
      if (file && file.size > MAX_EXPORT_BYTES) throw new Error('Choose a file smaller than 2 MiB.');
      const source = file ? await file.text() : '';
      signal.throwIfAborted();
      if (format === 'csv' && !csv) {
        const table = parseCsv(source);
        setCsv(table);
        setMapping(suggestCsvMapping(table));
        setFile(null);
        return;
      }
      if (format === 'csv' && (!csvReview?.data || !csvReview.data.items.length ||
          (csvReview.data.omittedColumns.length > 0 && !acknowledgeOmitted))) {
        throw new Error('Check the mapped fields and confirm any omitted columns.');
      }
      const { data: existing } = await vaultApi.export(false, signal);
      signal.throwIfAborted();
      if (existing.vault_salt !== destination.user?.vault_salt) {
        throw new Error('Your vault password changed. Lock and unlock before importing.');
      }
      const next = format === 'csv'
        ? await prepareImportItems(csvReview!.data!.items, destination.cryptoKey, existing.items, signal)
        : await prepareImport(source, password, destination.cryptoKey, existing.items, signal);
      signal.throwIfAborted();
      setIssues(format === 'csv' ? csvReview!.data!.issues : []);
      setPreview(next);
      setSelected(new Set(next.items.map((_, index) => index)));
      setCsv(null);
      setMapping(null);
      setFile(null);
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error && !('response' in cause)
        ? cause.message : 'Could not prepare the import. Your vault was not changed.');
    } finally {
      if (!signal.aborted) { setPassword(''); setBusy(false); }
    }
  };

  const confirm = async () => {
    if (busy || !preview || !destination.user) return;
    const signal = controller.current.signal;
    setBusy(true);
    setError('');
    try {
      signal.throwIfAborted();
      const body = request ?? buildImportRequest(preview, destination.user.vault_salt, skipDuplicates, selected);
      // Retain the exact ciphertext and operation ID for a lost-response retry.
      setRequest(body);
      const { data } = await vaultApi.importJson(body, signal);
      signal.throwIfAborted();
      toastService.success(`Imported ${data.imported_count} ${data.imported_count === 1 ? 'item' : 'items'}`);
      onClose();
      onImported();
    } catch (cause) {
      if (!signal.aborted) setError(parseApiError(cause, 'Could not confirm the import. Retry here to check the same operation safely.'));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  };

  const included = new Set(preview ? selectImportItems(preview, skipDuplicates, selected) : []);
  const selectedCount = included.size;
  return (
    <Modal title="Import Vault" icon={<Upload size={16} />} onClose={onClose} closeDisabled={busy && request !== null}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-(--text-secondary)">
          Import saved logins from a browser CSV, or restore a Cipheria JSON export.
          Encryption stays in this browser; existing items are never overwritten.
        </p>
        {error && <p role="alert" className="text-sm text-(--danger)">{error}</p>}
        {!preview ? (
          <form onSubmit={prepare} className="flex flex-col gap-4">
            {!csv && <div>
              <label htmlFor="import-format" className="mb-2 block text-sm">Import source</label>
              <select id="import-format" className="input-field" value={format} disabled={busy}
                onChange={event => { setFormat(event.target.value as 'csv' | 'json'); setFile(null); setPassword(''); setError(''); }}>
                <option value="csv">Browser passwords (CSV)</option>
                <option value="json">Cipheria backup (JSON)</option>
              </select>
            </div>}
            {!csv && <div>
              <label id="import-file-label" htmlFor="import-file" className="mb-2 block text-sm">{format === 'csv' ? 'Password CSV' : 'Cipheria JSON export'} (up to 2 MiB)</label>
              <input ref={fileInputRef} key={format} id="import-file" type="file" hidden
                accept={format === 'csv' ? '.csv,text/csv' : '.json,application/json'} disabled={busy}
                onChange={event => {
                  const chosen = event.target.files?.[0];
                  // Keep the previous File if a browser reports an empty selection on cancel.
                  if (chosen) { setFile(chosen); setError(''); }
                }} />
              <button type="button" className="input-field flex items-center gap-3 text-left disabled:opacity-50" disabled={busy}
                aria-label={file ? 'Change file' : 'Choose file'} title={file?.name}
                aria-describedby="import-file-label import-selected-file" onClick={() => fileInputRef.current?.click()}>
                <span id="import-selected-file" role="status" className="min-w-0 flex-1 truncate">
                  {file?.name ?? 'Choose file'}
                </span>
                <Upload size={16} className="shrink-0" aria-hidden="true" />
              </button>
              {format === 'csv' && <p className="mt-2 text-sm text-(--text-secondary)">
                CSV exports contain readable passwords. Delete the file after importing.
              </p>}
            </div>}
            {format === 'json' && <div>
              <label htmlFor="import-password" className="mb-2 block text-sm">Export master password</label>
              <input id="import-password" type="password" autoComplete="off" required disabled={busy}
                className="input-field" value={password} onChange={event => setPassword(event.target.value)} />
            </div>}
            {csv && mapping && <>
              <p className="text-sm">Match the columns in your CSV. Password values are never displayed here.</p>
              {CSV_FIELDS.map(field => <div key={field}>
                <label htmlFor={`import-column-${field}`} className="mb-1 block text-sm">{FIELD_LABELS[field]} column</label>
                <select id={`import-column-${field}`} className="input-field" value={mapping[field]} disabled={busy}
                  onChange={event => { setMapping({ ...mapping, [field]: Number(event.target.value) }); setAcknowledgeOmitted(false); }}>
                  <option value={-1}>{field === 'password' ? 'Choose a column' : 'Not included'}</option>
                  {csv.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}
                </select>
              </div>)}
              {csvReview?.error && <p role="alert" className="text-sm text-(--danger)">{csvReview.error}</p>}
              {csvReview?.data && <>
                <p className="text-sm">{csvReview.data.items.length} valid records; {csvReview.data.issues.length} invalid records.</p>
                {csvReview.data.issues.length > 0 && <details className="text-sm">
                  <summary>Review invalid records</summary>
                  <ul>{csvReview.data.issues.map(issue => <li key={issue.row}>Record {issue.row}: {issue.reason}</li>)}</ul>
                </details>}
                {csvReview.data.ignoredMetadata.length > 0 && <p className="text-sm text-(--text-secondary)">
                  Browser IDs, timestamps, and form-action metadata are not migrated.
                </p>}
                {csvReview.data.omittedColumns.length > 0 && <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={acknowledgeOmitted} disabled={busy} onChange={event => setAcknowledgeOmitted(event.target.checked)} />
                  <span>Import only the mapped fields. Omit these nonempty columns: {csvReview.data.omittedColumns.join(', ')}. Any authenticator secrets in those columns will not transfer.</span>
                </label>}
              </>}
            </>}
            <button className="btn-primary" type="submit" disabled={busy || (!file && !csv) ||
              (csv !== null && (!csvReview?.data?.items.length || (csvReview.data.omittedColumns.length > 0 && !acknowledgeOmitted)))}>
              {busy ? 'Preparing preview...' : format === 'csv' && !csv ? 'Read CSV' : 'Preview import'}
            </button>
          </form>
        ) : (
          <>
            <p role="status">{preview.items.length} items ready. {preview.duplicateCount} exact duplicates found.</p>
            <p className="text-sm">{selected.size} selected; {selectedCount} will import; {issues.length} invalid records excluded.</p>
            {issues.length > 0 && <details className="text-sm">
              <summary>Review excluded records</summary>
              <ul>{issues.map(issue => <li key={issue.row}>Record {issue.row}: {issue.reason}</li>)}</ul>
            </details>}
            <p className="text-sm text-(--text-secondary)">
              Duplicates are compared with active items at preview time and within this file.
              Select the items to import. Existing vault items will not be overwritten.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={skipDuplicates} disabled={busy || request !== null}
                onChange={event => setSkipDuplicates(event.target.checked)} />
              Skip exact duplicates (uncheck to import separate copies)
            </label>
            <div className="flex gap-3 text-sm">
              <button type="button" className="btn-ghost" disabled={busy || request !== null}
                onClick={() => setSelected(new Set(preview.items.map((_, index) => index)))}>Select all</button>
              <button type="button" className="btn-ghost" disabled={busy || request !== null}
                onClick={() => setSelected(new Set())}>Select none</button>
            </div>
            <ul className="max-h-48 overflow-auto text-sm" aria-label="Import preview">
              {preview.items.map((item, index) => (
                <li key={index} className="flex justify-between gap-3 border-b border-(--border) py-2">
                  <label className="flex min-w-0 items-start gap-2 break-words">
                    <input type="checkbox" aria-label={`Select ${item.name}${item.sourceRow ? ` (record ${item.sourceRow})` : ''}`}
                      checked={selected.has(index)} disabled={busy || request !== null}
                      onChange={event => setSelected(current => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(index); else next.delete(index);
                        return next;
                      })} />
                    {item.name}
                  </label>
                  <span className="shrink-0 text-(--text-secondary)">{included.has(item) ? item.category : 'Skipped'}</span>
                </li>
              ))}
            </ul>
            {request && <p className="text-sm text-(--text-secondary)">
              Retrying checks the same import without adding duplicates. Closing this window does not undo a submitted import.
            </p>}
            <button type="button" className="btn-primary" disabled={busy || !selectedCount} onClick={() => { void confirm(); }}>
              {busy ? 'Importing...' : request ? 'Retry import' : `Import ${selectedCount} ${selectedCount === 1 ? 'item' : 'items'}`}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
