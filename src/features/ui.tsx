import { useEffect, useState, type ReactNode } from 'react';
import type { CategoryId, Source } from '../domain/types';
import { CATEGORY_BY_ID } from '../domain/categories';
import { formatDate, type EvidenceStatus } from '../domain/status';

export function PathIcon({ path, size = 18 }: { path: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="path-icon">
      <path d={path} />
    </svg>
  );
}

export function CategoryMark({ category, size = 20 }: { category: CategoryId; size?: number }) {
  const def = CATEGORY_BY_ID.get(category);
  if (!def) return null;
  return (
    <span className="category-mark" style={{ background: def.color, width: size, height: size }}>
      <PathIcon path={def.icon} size={size * 0.62} />
    </span>
  );
}

/** Marks a record, result or route point beyond the bundled extract. */
export function OutsideCoverageTag() {
  return (
    <span
      className="tag outside"
      title="Beyond the bundled central-San Francisco extract; street detail stops at the amber boundary."
    >
      Outside coverage
    </span>
  );
}

export function EvidencePill({ evidence, compact = false }: { evidence: EvidenceStatus; compact?: boolean }) {
  return (
    <span className={`evidence-pill tone-${evidence.tone}`} title={evidence.detail}>
      <span className="evidence-dot" aria-hidden="true" />
      {compact ? evidence.label.replace(' · potentially outdated', ' · outdated') : evidence.label}
    </span>
  );
}

export function OpenState({ evidence }: { evidence: EvidenceStatus }) {
  if (evidence.openNow === true) {
    return (
      <span className="open-state is-open">
        <span aria-hidden="true">●</span> Open now, per published hours
        {evidence.closingHint ? <em>· {evidence.closingHint}</em> : null}
      </span>
    );
  }
  if (evidence.openNow === false) {
    return (
      <span className="open-state is-closed">
        <span aria-hidden="true">○</span> Closed now, per published hours
      </span>
    );
  }
  return (
    <span className="open-state is-unknown">
      <span aria-hidden="true">◌</span> Open now not confirmed
    </span>
  );
}

export function MetaRow({
  label,
  children,
  note,
}: {
  label: string;
  children?: ReactNode;
  note?: string | null;
}) {
  return (
    <div className="meta-row">
      <dt>{label}</dt>
      <dd>
        {children ?? <span className="not-confirmed">Not confirmed</span>}
        {note ? <span className="meta-note">{note}</span> : null}
      </dd>
    </div>
  );
}

export function SourceDetails({ sources }: { sources: Source[] }) {
  if (sources.length === 0) {
    return <p className="muted">No source is attached to this record. Treat it as unverified.</p>;
  }
  return (
    <ul className="source-list">
      {sources.map((source) => (
        <li key={source.id}>
          <div className="source-head">
            <a href={source.url} target="_blank" rel="noreferrer noopener">
              {source.name}
            </a>
            <span className={`source-type type-${source.sourceType}`}>{source.sourceType.replace('_', ' ')}</span>
          </div>
          <p className="source-provider">
            {source.provider} · retrieved {formatDate(source.retrievedAt)}
          </p>
          <p className="source-license">{source.license}</p>
          <details>
            <summary>What this source covers and where it stops</summary>
            <p>
              <strong>Coverage:</strong> {source.coverage}
            </p>
            <p>
              <strong>Limitations:</strong> {source.limitations}
            </p>
            <p>
              <strong>Refresh:</strong> {source.updateCadence}
            </p>
            <p>
              <strong>Import:</strong> {source.importMethod}
            </p>
            {source.licenseUrl && (
              <p>
                <a href={source.licenseUrl} target="_blank" rel="noreferrer noopener">
                  License terms
                </a>
              </p>
            )}
          </details>
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 960));
  useEffect(() => {
    const query = window.matchMedia('(min-width: 960px)');
    const handler = (event: MediaQueryListEvent) => setDesktop(event.matches);
    setDesktop(query.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);
  return desktop;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
