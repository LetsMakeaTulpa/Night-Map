/**
 * Source registry for the shared Night Map zone system.
 * A registry entry is not a claim that a source is already ingested by the app.
 */
export type ZoneSourceId = 'sfpd-incidents' | 'dispatched-calls' | 'sf311' | 'community-reports' | 'street-closures' | 'public-events';

export interface ZoneSourceDefinition {
  id: ZoneSourceId;
  name: string;
  url: string;
  kind: 'official_incident' | 'dispatch_snapshot' | 'service_request' | 'community' | 'mobility' | 'event';
  updateCadence: string;
  role: string;
  limitations: string[];
  ingestion: 'bundled_snapshot' | 'planned' | 'manual_link';
}

export const ZONE_SOURCES: ZoneSourceDefinition[] = [
  {
    id: 'dispatched-calls',
    name: 'Law Enforcement Dispatched Calls for Service',
    url: 'https://data.sf.gov/d/gnap-fj3t',
    kind: 'dispatch_snapshot',
    updateCadence: 'City dataset updates multiple times per hour; current app snapshot is refreshed manually by the build script',
    role: 'Contextual count of published, closed dispatch records in a coarse zone.',
    limitations: ['Not live dispatch or 911 audio', 'Open and sensitive calls are absent', 'A dispatched call is not proof of a crime', 'Not a prediction of police presence or enforcement'],
    ingestion: 'bundled_snapshot',
  },
  {
    id: 'sf311',
    name: 'San Francisco 311 Cases',
    url: 'https://data.sf.gov/d/vw6y-z8j6',
    kind: 'service_request',
    updateCadence: 'Nightly city dataset; bundled snapshot refresh is manual',
    role: 'Context on service requests such as noise, parking, graffiti, street conditions and other place-related complaints.',
    limitations: ['A request is not proof of wrongdoing and may already be resolved', 'Request volume reflects reporting behavior and agency classifications', 'Person-targeting and sensitive categories must remain excluded'],
    ingestion: 'bundled_snapshot',
  },
  {
    id: 'sfpd-incidents',
    name: 'SFPD Incident Reports (2018 to present)',
    url: 'https://data.sf.gov/d/wg3w-h783',
    kind: 'official_incident',
    updateCadence: 'City dataset updates hourly/daily; ingestion planned',
    role: 'Longer-term aggregate incident context to complement the short dispatched-call window.',
    limitations: ['Reports are not a complete census of events', 'Records can be updated or reclassified', 'Use coarse zone aggregates and broad categories only; never attach people or narrative details'],
    ingestion: 'planned',
  },
  {
    id: 'street-closures',
    name: 'Street closures and public-space changes',
    url: 'https://data.sf.gov/',
    kind: 'mobility',
    updateCadence: 'Dataset-specific; ingestion planned',
    role: 'Explain temporary changes that affect whether a public hangout or route is usable.',
    limitations: ['Only use datasets with documented coverage and licensing', 'A closure record does not establish why an individual is present'],
    ingestion: 'planned',
  },
  {
    id: 'public-events',
    name: 'Public event and permitted street-use listings',
    url: 'https://sf.gov/departments/entertainment-commission',
    kind: 'event',
    updateCadence: 'Organizer or permit schedule; ingestion planned',
    role: 'Add positive context such as public events, performances, street fairs and neighborhood activity.',
    limitations: ['Permit data is not a complete event calendar', 'Past events must expire; verify organizer details before travel'],
    ingestion: 'planned',
  },
  {
    id: 'community-reports',
    name: 'Community observations',
    url: '',
    kind: 'community',
    updateCadence: 'Submitted by visitors; timestamped and freshness-limited',
    role: 'Dated, voluntary ratings for hangout comfort, public-access clarity and unwanted interruption/friction.',
    limitations: ['Subjective and potentially biased', 'Require multiple reports before displaying a strong label', 'Keep precise notes private by default; never publish accusations about identifiable people'],
    ingestion: 'manual_link',
  },
];
