/**
 * Types for building-registry.mjs, so the app and the tests can assert the same
 * classification rules the build script applies.
 */
export type RegistryRecord = {
  id?: string;
  date?: string | null;
  description?: string;
  item?: string;
  category?: string;
  status?: string;
  type?: string;
};

export type RegistryInput = {
  complaints: RegistryRecord[];
  permits: RegistryRecord[];
  notices: RegistryRecord[];
};

export type Assessment = {
  status:
    | 'reported_vacant'
    | 'vacancy_history'
    | 'under_demolition'
    | 'demolition_history'
    | 'under_construction'
    | 'code_enforcement'
    | 'records_only';
  statusLabel: string;
  confidence: 'high' | 'medium' | 'low';
  score: number;
  inputs: { points: number; label: string }[];
  counts: {
    complaints: number;
    permits: number;
    notices: number;
    vacancyComplaints: number;
    vacancyNotices: number;
    demolitionPermits: number;
    openComplaints: number;
    openNotices: number;
  };
  latestVacancy: string | null;
  latestBoard: string | null;
  latestDemolition: string | null;
};

export declare const VACANCY_RE: RegExp;
export declare const BOARD_RE: RegExp;
export declare const DEMOLITION_RE: RegExp;
export declare const CLASSIFICATION_NOTE: string;

export declare function statusLabel(status: string): string;
export declare function normalizeLot(lot: unknown): string;
export declare function normalizeBlock(block: unknown): string;
export declare function parcelKey(block: unknown, lot: unknown): string;
export declare function parcelId(block: unknown, lot: unknown): string;
export declare function cleanText(value: unknown, max?: number): string;
export declare function formatAddress(row: Record<string, unknown>): string;
export declare function isOpenComplaint(status: unknown): boolean;
export declare function isOpenNotice(status: unknown): boolean;
export declare function isOpenPermit(status: unknown): boolean;
export declare function vacancyAssessment(dossier: RegistryInput, now?: Date): Assessment;
export declare function buildingTimeline(dossier: RegistryInput): {
  at: string;
  kind: 'complaint' | 'notice' | 'permit';
  title: string;
  detail: string;
  status: string;
  recordId: string;
  sourceId: string;
}[];
export declare function sortDossiers<T>(dossiers: T[]): T[];
