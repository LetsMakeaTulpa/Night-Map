import { useRef, useState } from 'react';
import type { Observation, ObservationPhoto } from '../../domain/types';
import {
  MESSAGE_MAX_ACCURACY_M,
  MESSAGE_UNLOCK_RADIUS_M,
} from '../../domain/messages';
import { useStore } from '../../state/store';
import { preparePhoto, PhotoError } from '../../services/photo';
import { PresenceError } from '../../services/presence';

interface Props {
  existing?: Observation;
  onDone: () => void;
  onCancel: () => void;
}

export function MessageComposer({ existing, onDone, onCancel }: Props) {
  const { actions } = useStore();
  const [note, setNote] = useState(existing?.note ?? '');
  const [photo, setPhoto] = useState<ObservationPhoto | null>(existing?.photo ?? null);
  const [error, setError] = useState<string | null>(null);
  const [photoWarning, setPhotoWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const editing = Boolean(existing);

  const handlePhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const prepared = await preparePhoto(file);
      setPhoto(prepared);
      setPhotoWarning(
        'Photo re-encoded with EXIF, GPS and device metadata stripped. Do not photograph faces, documents or belongings that could identify someone.',
      );
    } catch (err) {
      setPhotoWarning(err instanceof PhotoError ? err.message : 'Could not process that photo.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async () => {
    if (!note.trim() && !photo) {
      setError('Write a message or attach a photo first.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (existing) {
        await actions.updatePrivateMessage(existing.id, { note: note.trim(), photo });
      } else {
        await actions.createPrivateMessage({ note: note.trim(), photo });
      }
      onDone();
    } catch (err) {
      setError(
        err instanceof PresenceError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'The message could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="composer message-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="composer-head">
        <div>
          <p className="eyebrow">{editing ? 'Edit private message' : 'New private message'}</p>
          <h3>{editing ? 'Edit at this location' : 'Leave a message here'}</h3>
        </div>
        <span className="private-lock">GPS locked</span>
      </div>

      <div className="message-gps-note">
        <strong>{editing ? 'Location check on save' : 'Location captured on save'}</strong>
        <p>
          {editing
            ? `Saving checks a fresh GPS fix and requires you to be within ${MESSAGE_UNLOCK_RADIUS_M} m of where this message was left.`
            : `Saving takes a fresh GPS fix from this device. Messages cannot be pinned by tapping the map or typing coordinates, and the fix must be accurate to ±${MESSAGE_MAX_ACCURACY_M} m.`}
        </p>
        <p className="muted small">
          If the fix is stale or imprecise, the message is not written. Nothing is saved to the cloud.
        </p>
      </div>

      <label className="field">
        <span>Message</span>
        <textarea
          value={note}
          maxLength={2000}
          rows={6}
          autoFocus
          placeholder="Leave a note for yourself at this exact place…"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      <div className="field">
        <span>Photo (optional)</span>
        <div className="button-row">
          <button type="button" className="button ghost small" onClick={() => fileRef.current?.click()} disabled={busy}>
            {photo ? 'Replace photo' : 'Attach photo'}
          </button>
          {photo && (
            <button
              type="button"
              className="button ghost small"
              onClick={() => {
                setPhoto(null);
                setPhotoWarning(null);
              }}
              disabled={busy}
            >
              Remove photo
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => void handlePhoto(event.target.files?.[0])}
        />
        {photo && <img className="photo-preview" src={photo.dataUrl} alt="Message photo preview" />}
        {photoWarning && <p className="muted small">{photoWarning}</p>}
      </div>

      {editing && existing?.presence && (
        <p className="muted small">
          Last verified with a ±{Math.round(existing.presence.accuracyM)} m fix at{' '}
          {new Date(existing.presence.verifiedAt).toLocaleString()}.
        </p>
      )}

      {error && (
        <p className="notice is-error" role="alert">
          {error}
        </p>
      )}

      <div className="button-row composer-actions">
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'Checking location…' : editing ? 'Save message' : 'Leave message'}
        </button>
        <button type="button" className="button ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
