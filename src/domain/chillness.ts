/**
 * A transparent, subjective chillness rubric for publicly accessible places.
 * This is a community comfort rating, not a safety guarantee or a surveillance map.
 * Monitoring/security factors record how a contributor felt during a dated visit;
 * they must never be used to infer camera positions, predict police patrols, or
 * recommend routes intended to evade law enforcement.
 */
export type ChillRating = 1 | 2 | 3 | 4 | 5;

export interface ChillnessFactors {
  /** Quiet and ability to decompress. */
  quiet?: ChillRating;
  /** Availability and usability of seating. */
  seating?: ChillRating;
  /** Shelter from rain, wind or sun. */
  shelter?: ChillRating;
  /** How uncrowded it felt (5 = spacious, 1 = packed). */
  spaciousness?: ChillRating;
  /** Whether a visitor felt welcome without needing to buy anything. */
  welcome?: ChillRating;
  /** Subjective comfort with visible monitoring, not camera detection. */
  monitoringComfort?: ChillRating;
  /** Subjective comfort around visible security presence during that visit. */
  securityPresenceComfort?: ChillRating;
}

export interface ChillnessObservation {
  factors: ChillnessFactors;
  observedAt: string;
  contributorType: 'self' | 'community';
  note?: string;
}

export interface ChillnessScore {
  score: number;
  answeredFactors: number;
  confidence: 'low' | 'medium' | 'high';
  freshness: 'recent' | 'aging' | 'stale' | 'unknown';
  explanation: string;
}

const WEIGHTS: Record<keyof ChillnessFactors, number> = {
  quiet: 20,
  seating: 15,
  shelter: 10,
  spaciousness: 15,
  welcome: 15,
  monitoringComfort: 15,
  securityPresenceComfort: 10,
};

const clampRating = (value: number): number => Math.min(5, Math.max(1, value));

export function calculateChillnessScore(observation: ChillnessObservation, now = new Date()): ChillnessScore | null {
  const entries = (Object.keys(WEIGHTS) as (keyof ChillnessFactors)[])
    .filter((key) => observation.factors[key] !== undefined)
    .map((key) => ({ key, value: clampRating(observation.factors[key] as number), weight: WEIGHTS[key] }));

  // Three answers are the minimum for a meaningful, partial score.
  if (entries.length < 3) return null;

  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const weighted = entries.reduce((sum, entry) => sum + ((entry.value - 1) / 4) * 100 * entry.weight, 0);
  const score = Math.round(weighted / totalWeight);

  const observed = new Date(observation.observedAt);
  const ageDays = Number.isNaN(observed.getTime())
    ? null
    : Math.max(0, (now.getTime() - observed.getTime()) / 86_400_000);
  const freshness: ChillnessScore['freshness'] =
    ageDays === null ? 'unknown' : ageDays <= 30 ? 'recent' : ageDays <= 180 ? 'aging' : 'stale';
  const confidence: ChillnessScore['confidence'] =
    entries.length >= 6 && ageDays !== null && ageDays <= 30 ? 'high'
      : entries.length >= 4 && ageDays !== null && ageDays <= 180 ? 'medium'
        : 'low';

  return {
    score,
    answeredFactors: entries.length,
    confidence,
    freshness,
    explanation: `Subjective visit rating: ${entries.length} of 7 factors answered. Monitoring and security comfort describe one contributor's experience at the stated time; they do not establish camera locations, police patterns, safety, or future conditions.`,
  };
}

export function chillnessLabel(score: number): string {
  if (score >= 80) return 'Very chill';
  if (score >= 60) return 'Chill';
  if (score >= 40) return 'Mixed';
  if (score >= 20) return 'Restless';
  return 'Not very chill';
}
