/**
 * The Nearby workspace and the map are siblings, so a survey card asks the map
 * for its fly-to with a window event rather than duplicating camera code. The
 * cue carries the place identity and its coordinates; the map decides how much
 * motion is appropriate for the reader's preferences.
 */
export const SURVEY_FLY_TO_EVENT = 'nightmap:survey-fly-to';

export interface SurveyFlyToDetail {
  placeId: string;
  coordinates: [number, number];
}

export function requestSurveyFlyTo(detail: SurveyFlyToDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<SurveyFlyToDetail>(SURVEY_FLY_TO_EVENT, { detail }));
}
