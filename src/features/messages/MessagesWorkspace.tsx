import { useEffect, useMemo, useRef, useState } from 'react';
import type { Observation } from '../../domain/types';
import {
  isFixAccurate,
  isFixFresh,
  MESSAGE_MAX_ACCURACY_M,
  MESSAGE_UNLOCK_RADIUS_M,
  messageMarkerState,
  type MessageMarkerState,
} from '../../domain/messages';
import { formatDistance } from '../../domain/geo';
import { formatDate } from '../../domain/status';
import { useStore } from '../../state/store';
import { EmptyState } from '../ui';
import { MessageComposer } from './MessageComposer';

function lockedCopy(marker: MessageMarkerState, units: 'metric' | 'imperial'): string {
  switch (marker.reason) {
    case 'no_anchor':
      return 'Locked · this message has no saved location.';
    case 'no_fix':
      return 'Locked · turn on GPS lock to check whether you are nearby.';
    case 'stale_fix':
      return 'Locked · the GPS fix is stale. Refresh it from where you are standing.';
    case 'inaccurate_fix':
      return `Locked · the GPS fix is too imprecise. A ±${MESSAGE_MAX_ACCURACY_M} m fix is required.`;
    case 'too_far':
      return `Locked · ${formatDistance(marker.distanceM ?? 0, units)} away.`;
    default:
      return 'Locked.';
  }
}

export function MessagesWorkspace() {
  const { state, actions } = useStore();
  const [mode, setMode] = useState<'list' | 'compose' | 'edit'>('list');
  const [editing, setEditing] = useState<Observation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const gpsRequested = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  // Opening Messages starts a real, live device watch unless permission was
  // explicitly denied. There is no simulated or map-centre fallback here.
  useEffect(() => {
    if (gpsRequested.current) return;
    gpsRequested.current = true;
    if (state.settings.locationPermission !== 'denied' && !state.gpsLocked) {
      actions.startGpsLock();
    }
  }, [actions, state.gpsLocked, state.settings.locationPermission]);

  const messages = useMemo(
    () =>
      state.observations
        .filter((observation) => observation.kind === 'message')
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt)),
    [state.observations],
  );

  const gps = useMemo(() => {
    const fix = state.userLocation;
    if (!fix) {
      return {
        ready: false,
        label: 'No GPS fix yet',
        detail: 'Turn on GPS lock, or save a message and let the location check run then.',
      };
    }
    if (!isFixFresh(fix, now)) {
      return {
        ready: false,
        label: 'GPS fix is stale',
        detail: 'Refresh the fix before relying on nearby states. Saving a message always requests a fresh one.',
      };
    }
    if (!isFixAccurate(fix)) {
      return {
        ready: false,
        label: `GPS fix too imprecise${Number.isFinite(fix.accuracy) ? ` (±${Math.round(fix.accuracy)} m)` : ''}`,
        detail: `A fix within ±${MESSAGE_MAX_ACCURACY_M} m is required. Move into the open and refresh.`,
      };
    }
    return {
      ready: true,
      label: `GPS ready · ±${Math.round(fix.accuracy)} m`,
      detail: `Nearby means a fresh fix within ${MESSAGE_UNLOCK_RADIUS_M} m of the message.`,
    };
  }, [now, state.userLocation]);

  const startCompose = () => {
    setEditing(null);
    setError(null);
    setMode('compose');
  };

  const startEdit = (message: Observation) => {
    setEditing(message);
    setError(null);
    setMode('edit');
  };

  const deleteMessage = async (message: Observation) => {
    setError(null);
    try {
      await actions.deletePrivateMessage(message.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The message could not be deleted.');
    }
  };

  // Do not leave message text open in the editor after its fix expires.
  useEffect(() => {
    if (mode !== 'edit' || !editing) return;
    if (messageMarkerState(editing, state.userLocation, now).state === 'nearby') return;
    setEditing(null);
    setMode('list');
    setError(
      `This message locked again. Move within ${MESSAGE_UNLOCK_RADIUS_M} m and use a fresh GPS fix to edit it.`,
    );
  }, [editing, mode, now, state.userLocation]);

  if (mode === 'compose') {
    return (
      <div className="workspace-panel messages">
        <MessageComposer
          onDone={() => setMode('list')}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (mode === 'edit' && editing) {
    return (
      <div className="workspace-panel messages">
        <MessageComposer
          existing={editing}
          onDone={() => {
            setEditing(null);
            setMode('list');
          }}
          onCancel={() => {
            setEditing(null);
            setMode('list');
          }}
        />
      </div>
    );
  }

  return (
    <div className="workspace-panel messages">
      <header className="workspace-head">
        <div>
          <p className="eyebrow">Messages</p>
          <h2>Private messages</h2>
          <p className="muted small">
            {messages.length} location-locked {messages.length === 1 ? 'message' : 'messages'} on this device. They are
            never published, and composing is only available here — not from the map.
          </p>
        </div>
      </header>

      <section className={`message-gps-card ${gps.ready ? 'is-ready' : ''}`} aria-live="polite">
        <div>
          <strong>{gps.label}</strong>
          <p className="muted small">{gps.detail}</p>
          {state.userLocation && Number.isFinite(state.userLocation.at) && (
            <p className="muted small">
              Last fix{' '}
              {new Date(state.userLocation.at).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
              {state.gpsLocked ? ' · GPS lock on' : ' · GPS lock off'}
            </p>
          )}
        </div>
        <div className="button-row">
          {!state.gpsLocked && (
            <button type="button" className="button ghost small" onClick={actions.startGpsLock}>
              Turn on GPS lock
            </button>
          )}
          {state.gpsLocked && (
            <button type="button" className="button ghost small" onClick={actions.stopGpsLock}>
              Stop GPS
            </button>
          )}
          <button
            type="button"
            className="button ghost small"
            onClick={() => void actions.useCurrentLocation()}
            aria-label="Realign to my GPS location"
            title="Get a fresh GPS fix and update message distances"
          >
            Realign GPS
          </button>
        </div>
      </section>

      <section className="quick-compose">
        <h3>Leave a message at this location</h3>
        <p className="muted small">
          The location is taken from a fresh GPS fix when you save. There is no map pin, no map-centre fallback and no
          coordinate field.
        </p>
        <button type="button" className="button primary" onClick={startCompose}>
          Compose private message
        </button>
      </section>

      {error && (
        <p className="notice is-error" role="alert">
          {error}
        </p>
      )}

      <div className="section-head">
        <h3>Your messages</h3>
        <span className="muted small">
          {MESSAGE_UNLOCK_RADIUS_M} m unlock radius
        </span>
      </div>

      {messages.length === 0 ? (
        <EmptyState title="No private messages yet">
          A message is tied to the place where you leave it. Leave one from this workspace; the map only shows whether
          each message is locked or nearby.
        </EmptyState>
      ) : (
        <ul className="message-list">
          {messages.map((message) => {
            const marker = messageMarkerState(message, state.userLocation, now);
            const nearby = marker.state === 'nearby';
            return (
              <li key={message.id} className={`message-card ${nearby ? 'is-nearby' : 'is-locked'}`}>
                <div className="message-head">
                  <span className={`message-state ${nearby ? 'is-nearby' : 'is-locked'}`}>
                    {nearby ? 'Nearby' : 'Locked'}
                  </span>
                  <span className="private-lock">Private</span>
                </div>

                {nearby ? (
                  <>
                    <p className="message-distance">
                      {formatDistance(marker.distanceM ?? 0, state.settings.units)} away
                      {message.presence
                        ? ` · verified with a ±${Math.round(message.presence.accuracyM)} m fix`
                        : ''}
                    </p>
                    <p>{message.note || '(photo only)'}</p>
                    {message.photo && (
                      <img src={message.photo.dataUrl} alt="Private message attachment" />
                    )}
                    <p className="muted small">
                      Left {formatDate(message.observedAt)} · recorded {formatDate(message.recordedAt)}
                    </p>
                    <div className="button-row">
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => actions.selectObservation(message.id)}
                      >
                        Inspect on map
                      </button>
                      <button type="button" className="link-button" onClick={() => startEdit(message)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => void deleteMessage(message)}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="message-locked-copy">{lockedCopy(marker, state.settings.units)}</p>
                    <p className="muted small">
                      Move within {MESSAGE_UNLOCK_RADIUS_M} m of where it was left and use a fresh GPS fix to read, edit
                      or delete it.
                    </p>
                    <p className="muted small">Left {formatDate(message.observedAt)}</p>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
