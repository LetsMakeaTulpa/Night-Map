/**
 * Narrow, source-backed view of public-realm maintenance requests in the
 * sanitized City 311 snapshot. These are service-request labels, not verified
 * defects, outages, property conditions, predictions or safety ratings.
 */
import { zoneIdForPoint } from './zone-intelligence';

export const PUBLIC_REALM_MAINTENANCE_KINDS = [
  'Streetlights',
  'Street and Sidewalk Cleaning',
  'Graffiti Public',
  'Blocked Street and Sidewalk',
  'Litter Receptacle Maintenance',
  'Street Defect',
  'Sidewalk and Curb',
] as const;

export type PublicRealmMaintenanceKind = (typeof PUBLIC_REALM_MAINTENANCE_KINDS)[number];

const LABELS: Record<PublicRealmMaintenanceKind, string> = {
  Streetlights: 'Streetlight service requests',
  'Street and Sidewalk Cleaning': 'Street and sidewalk cleaning / debris',
  'Graffiti Public': 'Public-property graffiti reports',
  'Blocked Street and Sidewalk': 'Blocked public ways',
  'Litter Receptacle Maintenance': 'Litter receptacle maintenance',
  'Street Defect': 'Street defect reports',
  'Sidewalk and Curb': 'Sidewalk and curb reports',
};

const ALLOWED = new Set<string>(PUBLIC_REALM_MAINTENANCE_KINDS);

export function isPublicRealmMaintenanceKind(kind: string | null | undefined): kind is PublicRealmMaintenanceKind {
  return typeof kind === 'string' && ALLOWED.has(kind);
}

export interface PublicRealmMaintenanceRecord {
  coordinates: [number, number];
  kind: string;
}

export interface PublicRealmMaintenanceSummary {
  total: number;
  categories: { kind: PublicRealmMaintenanceKind; label: string; count: number }[];
}

export function summarizePublicRealmMaintenanceForZone(
  records: PublicRealmMaintenanceRecord[],
  zoneId: string,
): PublicRealmMaintenanceSummary {
  const counts = new Map<PublicRealmMaintenanceKind, number>();
  for (const record of records) {
    if (!isPublicRealmMaintenanceKind(record.kind)) continue;
    try {
      if (zoneIdForPoint(record.coordinates[0], record.coordinates[1]).id !== zoneId) continue;
    } catch {
      continue;
    }
    counts.set(record.kind, (counts.get(record.kind) ?? 0) + 1);
  }
  const categories = [...counts.entries()]
    .map(([kind, count]) => ({ kind, label: LABELS[kind], count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { total: categories.reduce((sum, entry) => sum + entry.count, 0), categories };
}
