import { useState } from 'react';
import type { CategoryId } from '../../domain/types';
import { CATEGORY_BY_ID } from '../../domain/categories';
import { useStore } from '../../state/store';
import { PathIcon } from '../ui';

const PRESETS: CategoryId[] = [
  'food',
  'water',
  'bathroom',
  'shelter',
  'services',
  'medical',
  'hygiene',
  'laundry',
  'charging',
  'civic',
];

export function MissingPlaceComposer({
  coordinates,
  onDone,
  onCancel,
}: {
  coordinates: [number, number];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { actions } = useStore();
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const canSave = Boolean(category) && name.trim().length > 0 && !busy;

  const submit = async () => {
    if (!category || !canSave) return;
    setBusy(true);
    try {
      await actions.createObservation({
        placeId: null,
        placeName: name.trim(),
        geometry: coordinates,
        type: 'new_resource',
        suggestedCategory: category,
        note:
          note.trim() ||
          'Missing place reported from the map. Needs verification before it is treated as a record.',
        observedAt: new Date().toISOString(),
        photo: null,
        accessStatus: 'unknown',
        confidence: 'unverified',
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="composer missing-place"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="composer-head">
        <div>
          <p className="eyebrow">Missing place</p>
          <h3>Add what you found</h3>
          <p className="muted small">
            Map-picked location · {coordinates[1].toFixed(5)}, {coordinates[0].toFixed(5)}
          </p>
        </div>
        <span className="private-lock">Private</span>
      </div>

      <p className="notice">
        This saves a private lead on this device. It does not create a public Night Map record, publish to OpenStreetMap,
        or change City data. Verify the place before relying on it.
      </p>

      <fieldset className="field">
        <legend>Category preset</legend>
        <div className="missing-presets">
          {PRESETS.map((id) => {
            const definition = CATEGORY_BY_ID.get(id);
            if (!definition) return null;
            return (
              <button
                key={id}
                type="button"
                className={`missing-preset ${category === id ? 'is-active' : ''}`}
                aria-pressed={category === id}
                title={definition.label}
                onClick={() => setCategory(id)}
              >
                <span className="missing-preset-icon" style={{ color: definition.color }}>
                  <PathIcon path={definition.icon} size={16} />
                </span>
                {definition.short}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="field">
        <span>Name of the place</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          placeholder="Example: Corner pantry or drinking fountain"
          autoFocus
        />
        <span className="field-foot">{name.length}/120 · Use a factual name, not a guess about who uses it.</span>
      </label>

      <label className="field">
        <span>What did you see? (optional)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Example: unlocked water fountain beside the community garden gate."
        />
        <span className="field-foot">{note.length}/1000 · Do not describe people or private belongings.</span>
      </label>

      <div className="composer-actions">
        <button type="submit" className="button primary" disabled={!canSave}>
          {busy ? 'Saving…' : 'Save private lead'}
        </button>
        <button type="button" className="button ghost" onClick={onCancel}>
          Cancel
        </button>
        <span className="muted small">Unverified · private to this device</span>
      </div>
    </form>
  );
}
