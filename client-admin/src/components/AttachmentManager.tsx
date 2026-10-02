import { useRef, useState } from 'react';
import { apiRequest, downloadFile, toApiError, uploadFile } from '../lib/api';
import { formatBytes } from '../lib/format';
import type { Attachment } from '../lib/types';

/**
 * The files a challenge hands out. Uploads and deletions take effect immediately rather than
 * waiting for the form to be saved — the file is already on the server by the time it is listed,
 * and pretending otherwise would mean holding bytes in the browser for no reason.
 */
export function AttachmentManager({
  basePath,
  attachments,
  onChanged,
}: {
  basePath: string;
  attachments: Attachment[];
  onChanged: (attachments: Attachment[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(file: File) {
    setBusy('upload');
    setError(null);
    try {
      const { attachment } = await uploadFile<{ attachment: Attachment }>(basePath, file);
      onChanged([...attachments, attachment].sort((a, b) => a.filename.localeCompare(b.filename)));
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setBusy(null);
      // Clearing the input lets the same file be picked again after a failure.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove(attachment: Attachment) {
    setBusy(attachment.id);
    setError(null);
    try {
      await apiRequest(`${basePath}/${attachment.id}`, { method: 'DELETE' });
      onChanged(attachments.filter((item) => item.id !== attachment.id));
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setBusy(null);
    }
  }

  async function download(attachment: Attachment) {
    setBusy(attachment.id);
    setError(null);
    try {
      await downloadFile(`${basePath}/${attachment.id}`, attachment.filename);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="attachments">
      <span className="label">Files</span>
      {attachments.length === 0 ? (
        <p className="hint">No files yet. Attach the pcap, binary or archive the challenge needs.</p>
      ) : (
        <ul className="attachment-list">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="attachment">
              <span className="attachment-name">{attachment.filename}</span>
              <span className="attachment-size mono">{formatBytes(attachment.sizeBytes)}</span>
              <button
                type="button"
                className="button ghost small"
                disabled={busy !== null}
                onClick={() => void download(attachment)}
              >
                Download
              </button>
              <button
                type="button"
                className="button ghost small danger-text"
                disabled={busy !== null}
                onClick={() => void remove(attachment)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div>
        <input
          ref={inputRef}
          type="file"
          className="hidden-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void add(file);
          }}
        />
        <button
          type="button"
          className="button ghost small"
          disabled={busy !== null}
          onClick={() => inputRef.current?.click()}
        >
          {busy === 'upload' ? 'Uploading…' : 'Add a file'}
        </button>
      </div>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
