import { useEffect, useRef, useState } from 'react';
import type { BuildingCondition, Observation, ObservationPhoto, ObservationType } from '../../domain/types';
import { BUILDING_CONDITIONS } from '../../domain/buildings';
import { useStore } from '../../state/store';
import { preparePhoto, PhotoError } from '../../services/photo';
import { clearDraft, loadDraft, saveDraft } from '../../services/storage';
import { formatDate } from '../../domain/status';

const TYPES: { id: ObservationType; label: string }[] = [
  { id: 'passage_discovery', label: 'Passage or cut-through' },
  { id: 'popos_observation', label: 'POPOS or public space candidate' },
  { id: 'entrance_observation', label: 'Entrance or access point' },
  { id: 'stairs_ramp_observation', label: 'Stairs, ramp or path' },
  { id: 'resource_present', label: 'Resource exists' },
  { id: 'resource_not_found', label: 'Resource not found' },
  { id: 'hours_incorrect', label: 'Hours seem wrong' },
  { id: 'open_observed', label: 'Was open when I passed' },
  { id: 'closed_observed', label: 'Was closed when I passed' },
  { id: 'access_issue', label: 'Access issue' },
  { id: 'infrastructure_change', label: 'Infrastructure change' },
  { id: 'new_resource', label: 'New or changed service' },
  { id: 'follow_up', label: 'Follow-up needed' },
  { id: 'other', label: 'Something else' },
];

export interface ComposeTarget {
  placeId: string | null;
  placeName: string | null;
  coordinates: [number, number] | null;
  /** When set, the note is a condition check on a registry parcel. */
  buildingId?: string | null;
  buildingAddress?: string | null;
}

interface Props {
  target: ComposeTarget;
  existing?: Observation;
  onDone: () => void;
  onCancel: () => void;
}

interface DraftState {
  type: ObservationType;
  note: string;
  observedAt: string;
  photo: ObservationPhoto | null;
  accessStatus: NonNullable<Observation['accessStatus']>;
  buildingCondition?: BuildingCondition | 'unset';
  sourceReference: string;
  confidence: NonNullable<Observation['confidence']>;
}

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export function FieldnoteComposer({ target, existing, onDone, onCancel }: Props) {
  const { actions } = useStore();
  const [type, setType] = useState<ObservationType>(existing?.type ?? 'passage_discovery');
  const [note, setNote] = useState(existing?.note ?? '');
  const [observedAt, setObservedAt] = useState(
    existing ? existing.observedAt.slice(0, 16) : nowLocal(),
  );
  const [photo, setPhoto] = useState<ObservationPhoto | null>(existing?.photo ?? null);
  const [accessStatus, setAccessStatus] = useState<NonNullable<Observation['accessStatus']>>(existing?.accessStatus ?? 'unknown');
  const [sourceReference, setSourceReference] = useState(existing?.sourceReference ?? '');
  const [confidence, setConfidence] = useState<NonNullable<Observation['confidence']>>(existing?.confidence ?? 'unverified');
  const buildingId = target.buildingId ?? existing?.buildingId ?? null;
  const [buildingCondition, setBuildingCondition] = useState<BuildingCondition | 'unset'>(
    existing?.buildingCondition ?? 'unset',
  );
  const [photoWarning, setPhotoWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (existing) return;
    let cancelled = false;
    (async () => {
      const draft = await loadDraft<DraftState>('observation-draft');
      if (cancelled || !draft) return;
      if (draft.note || draft.photo) {
        setType(draft.type);
        setNote(draft.note);
        setObservedAt(draft.observedAt);
        setPhoto(draft.photo);
        setAccessStatus(draft.accessStatus ?? 'unknown');
        setBuildingCondition(draft.buildingCondition ?? 'unset');
        setSourceReference(draft.sourceReference ?? '');
        setConfidence(draft.confidence ?? 'unverified');
        setDraftRestored(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [existing]);

  useEffect(() => {
    if (existing) return;
    const timeout = window.setTimeout(() => {
      const draft: DraftState = {
        type,
        note,
        observedAt,
        photo,
        accessStatus,
        buildingCondition,
        sourceReference,
        confidence,
      };
      void saveDraft(draft);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [type, note, observedAt, photo, accessStatus, buildingCondition, sourceReference, confidence, existing]);

  const handlePhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const prepared = await preparePhoto(file);
      setPhoto(prepared);
      setPhotoWarning(
        'Photo re-encoded and stripped of EXIF, GPS and device metadata. Still: do not photograph faces, documents, encampments or belongings that could identify someone.',
      );
    } catch (err) {
      setPhotoWarning(err instanceof PhotoError ? err.message : 'Could not process that photo.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async () => {
    if (note.trim().length === 0 && !photo) return;
    if (existing) {
      await actions.updateObservation({
        ...existing,
        type,
        note: note.trim(),
        observedAt: new Date(observedAt).toISOString(),
        photo,
        accessStatus,
        buildingId,
        buildingCondition: buildingCondition === 'unset' ? undefined : buildingCondition,
        sourceReference: sourceReference.trim() || undefined,
        confidence,
      });
    } else {
      await actions.createObservation({
        placeId: target.placeId,
        placeName: target.placeName,
        geometry: target.coordinates,
        type,
        note: note.trim() || '(photo only)',
        observedAt: new Date(observedAt).toISOString(),
        photo,
        accessStatus,
        buildingId,
        buildingCondition: buildingCondition === 'unset' ? undefined : buildingCondition,
        sourceReference: sourceReference.trim() || undefined,
        confidence,
      });
      await clearDraft('observation-draft');
    }
    onDone();
  };

  const verb = existing ? 'Save changes' : 'Save private note';

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="composer-head">
        <div>
          <p className="eyebrow">{existing ? 'Edit field note' : 'New field note'}</p>
          <h3>{target.placeName ?? 'Pinned observation'}</h3>
          {buildingId && (
            <p className="muted small">
              Condition check on a registry parcel. Private to this device; it does not change the City record.
            </p>
          )}
          {target.coordinates && (
            <p className="muted small">
              {target.placeId ? 'Attached to a place record' : buildingId ? 'Parcel position' : 'Pin at'} ·{' '}
              {target.coordinates[1].toFixed(5)}, {target.coordinates[0].toFixed(5)}
            </p>
          )}
        </div>
        <span className="private-lock">Private</span>
      </div>

      {draftRestored && <p className="notice">Restored an unsaved draft from this device.</p>}

      <fieldset className="field">
        <legend>What did you observe?</legend>
        <div className="chip-grid">
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`chip ${type === t.id ? 'is-active' : ''}`}
              aria-pressed={type === t.id}
              onClick={() => setType(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </fieldset>

      {buildingId && (
        <label className="field">
          <span>Condition seen from outside (optional)</span>
          <select
            value={buildingCondition}
            onChange={(event) => setBuildingCondition(event.target.value as BuildingCondition | 'unset')}
          >
            <option value="unset">Not recorded</option>
            {BUILDING_CONDITIONS.map((condition) => (
              <option key={condition.id} value={condition.id}>
                {condition.label}
              </option>
            ))}
          </select>
          <span className="field-foot">
            {BUILDING_CONDITIONS.find((condition) => condition.id === buildingCondition)?.note ??
              'This is your visual note, stored locally, and is never presented as a City finding.'}
          </span>
        </label>
      )}

      <div className="field-row">
        <label className="field">
          <span>Observed access status (not permission to enter)</span>
          <select value={accessStatus} onChange={(e) => setAccessStatus(e.target.value as NonNullable<Observation['accessStatus']>)}>
            <option value="unknown">Unknown</option>
            <option value="confirmed_public">Confirmed public from posted/source information</option>
            <option value="conditional">Conditional access</option>
            <option value="private_restricted">Private or restricted</option>
            <option value="temporarily_closed">Temporarily closed</option>
          </select>
        </label>
        <label className="field">
          <span>Evidence status</span>
          <select value={confidence} onChange={(e) => setConfidence(e.target.value as NonNullable<Observation['confidence']>)}>
            <option value="unverified">Unverified</option>
            <option value="documented">Documented source</option>
            <option value="corroborated">Corroborated</option>
            <option value="inferred">Inference</option>
            <option value="disputed">Disputed</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>Source or evidence link (optional)</span>
        <input type="url" value={sourceReference} maxLength={1000} placeholder="https://…" onChange={(e) => setSourceReference(e.target.value)} />
      </label>

      <label className="field">
        <span>What did you see? (required if there is no photo)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="Example: door locked at 7:40pm, sign says closed for repairs. Keep it factual; do not describe people."
        />
        <span className="field-foot">{note.length}/4000 · Saved privately unless you deliberately export it.</span>
      </label>

      <div className="field-row">
        <label className="field">
          <span>When did you observe this?</span>
          <input type="datetime-local" value={observedAt} onChange={(e) => setObservedAt(e.target.value)} />
        </label>
        <div className="field">
          <span>Visibility</span>
          <div className="visibility-box">
            <strong>Private on this device</strong>
            <p>
              Group sharing and public publication are not implemented in this release. Nothing is sent to a server.
            </p>
          </div>
        </div>
      </div>

      <div className="field">
        <span>Photo (optional)</span>
        {photo ? (
          <div className="photo-preview">
            <img src={photo.dataUrl} alt="Attached field observation" />
            <div>
              <p className="small">
                {photo.width} × {photo.height} · metadata stripped
              </p>
              <button type="button" className="button ghost small" onClick={() => setPhoto(null)}>
                Remove photo
              </button>
            </div>
          </div>
        ) : (
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={(e) => void handlePhoto(e.target.files?.[0])}
          />
        )}
        {photoWarning && <p className="notice warn">{photoWarning}</p>}
      </div>

      <div className="composer-actions">
        <button type="submit" className="button primary" disabled={busy || (note.trim().length === 0 && !photo)}>
          {busy ? 'Processing photo…' : verb}
        </button>
        <button type="button" className="button ghost" onClick={onCancel}>
          Cancel
        </button>
        <span className="muted small">
          Recorded {formatDate(existing?.recordedAt ?? new Date().toISOString())} · unverified observation
        </span>
      </div>
    </form>
  );
}
