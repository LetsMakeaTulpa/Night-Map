import type { Place, PlaceOverride, Resource, Source, VerificationStatus } from './types';
import { isOpenAt, nextBoundary, summarizeHours, type HoursSummary } from './hours';

export type RecencyLevel = 'fresh' | 'aging' | 'stale' | 'unknown';

export const FRESH_DAYS = 90;
export const AGING_DAYS = 365;

export function daysSince(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

export function recency(iso: string | null | undefined, now = new Date()): { level: RecencyLevel; days: number | null } {
  const days = daysSince(iso, now);
  if (days === null) return { level: 'unknown', days: null };
  if (days <= FRESH_DAYS) return { level: 'fresh', days };
  if (days <= AGING_DAYS) return { level: 'aging', days };
  return { level: 'stale', days };
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'No date recorded';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Los_Angeles',
  }).format(t);
}

export function formatAge(days: number | null): string {
  if (days === null) return 'date unknown';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 60) return 'about a month ago';
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = (days / 365).toFixed(1);
  return `about ${years} years ago`;
}

export type StatusTone = 'official' | 'verified' | 'community' | 'stale' | 'closed' | 'unknown';

export interface EvidenceStatus {
  tone: StatusTone;
  label: string;
  detail: string;
  checkedAt: string | null;
  recency: RecencyLevel;
  days: number | null;
  /** Never true when the app lacks fresh, explicit information. */
  openNow: boolean | null;
  openNote: string | null;
  hours: HoursSummary | null;
  hoursNote: string | null;
  closingHint: string | null;
  canClaimOpen: boolean;
}

const STATUS_LABEL: Record<VerificationStatus, string> = {
  official_source: 'Officially published',
  recently_verified: 'Checked recently',
  community_reported: 'Community reported',
  community_mapped: 'Community-mapped',
  unverified: 'Unverified',
  temporarily_unavailable: 'Reported temporarily unavailable',
  permanently_closed: 'Reported permanently closed',
  unknown: 'Status unknown',
};

/**
 * `override` carries a reviewer's local correction. It can close a record or
 * replace its status label, but it never rewrites the source value — the
 * bundled evidence stays visible underneath.
 */
export function evidenceFor(
  place: Place,
  resource: Resource | undefined,
  _sources: Source[],
  now = new Date(),
  override: PlaceOverride | null = null,
): EvidenceStatus {
  const primary =
    override?.verification?.status ?? resource?.verification.status ?? place.verificationOverride?.status ?? 'unknown';
  const checkedAt = resource?.lastVerifiedAt ?? resource?.sourceUpdatedAt ?? null;
  const sourceRecency = recency(resource?.sourceUpdatedAt ?? null, now);
  const verifyRecency = recency(resource?.lastVerifiedAt ?? null, now);
  // A hand-checked date wins over the source dataset timestamp when present.
  const effectiveRecency: RecencyLevel =
    verifyRecency.level !== 'unknown' ? verifyRecency.level : sourceRecency.level;

  const trusty =
    primary === 'official_source' || primary === 'recently_verified' || primary === 'community_reported';
  const closed =
    primary === 'permanently_closed' ||
    primary === 'temporarily_unavailable' ||
    override?.status === 'permanently_closed' ||
    override?.status === 'temporarily_closed' ||
    place.status === 'permanently_closed' ||
    place.status === 'temporarily_closed';

  const freshEnough = effectiveRecency === 'fresh';
  const hasHours = Boolean(resource?.hours);
  // Open-now is a claim. It needs published hours *and* a recent check.
  const canClaimOpen = Boolean(trusty && freshEnough && hasHours && !closed);
  const openNow = canClaimOpen && resource ? isOpenAt(resource.hours, now) : null;

  let tone: StatusTone = 'unknown';
  if (closed) tone = 'closed';
  else if (primary === 'official_source') tone = effectiveRecency === 'stale' ? 'stale' : 'official';
  else if (primary === 'recently_verified') tone = effectiveRecency === 'fresh' ? 'verified' : 'stale';
  else if (primary === 'community_reported' || primary === 'community_mapped') tone = 'community';
  else if (effectiveRecency === 'stale') tone = 'stale';

  let label =
    override?.verification?.label ?? resource?.verification.label ?? place.verificationOverride?.label ?? 'Status unknown';
  if (!closed && effectiveRecency === 'stale' && primary === 'official_source') {
    label = 'Official source · potentially outdated';
    tone = 'stale';
  }
  if (!closed && effectiveRecency === 'aging' && primary === 'official_source') {
    label = 'Official source · aging record';
  }

  const openNote = canClaimOpen
    ? `Based on hours published for this record and a check within the last ${FRESH_DAYS} days. Not a live door check.`
    : hasHours
      ? `Hours are published (checked ${formatDate(checkedAt)}), but this record is not fresh enough for Night Map to say whether it is open right now.`
      : 'No published hours for this record, so Night Map will not guess whether it is open.';

  return {
    tone,
    label,
    detail: override?.verification?.note ?? resource?.verification.note ?? place.verificationOverride?.note ?? 'No verification note.',
    checkedAt,
    recency: effectiveRecency,
    days: daysSince(checkedAt, now),
    openNow,
    openNote,
    hours: summarizeHours(resource?.hours ?? null),
    hoursNote: override?.hoursNote ?? resource?.hoursNote ?? null,
    closingHint: openNow ? nextBoundary(resource?.hours ?? null, now) : null,
    canClaimOpen,
  };
}

export function statusLabelFor(status: VerificationStatus): string {
  return STATUS_LABEL[status];
}

export function toneClass(tone: StatusTone): string {
  return `tone-${tone}`;
}

/** Sources that are relevant to a record, de-duplicated and ordered by input. */
export function sourcesFor(place: Place, resource: Resource | undefined, sources: Source[]): Source[] {
  const ids = new Set<string>([...(place.sourceIds ?? []), ...(resource?.sourceIds ?? [])]);
  return sources.filter((s) => ids.has(s.id));
}
