# Night Map: Scenes, Hideaways and Chillness

## Map categories added

- **Nightlife & music scenes:** goth/darkwave, industrial, post-punk, techno, house, punk, live music, DJs, cabaret and recurring nights.
- **Counterculture & DIY:** independent art, zines, collectives, radical/countercultural history and independent radio.
- **Hidden hangouts & chill spots:** POPOS, public courtyards, quiet seating, public terraces, parks and other places people can legally use without buying anything.
- **Abandoned & vacant buildings:** documented historical/vacancy records, with status date, source, access status and uncertainty.
- **Mutual aid, food & advocacy:** Food Not Bombs, community fridges, food distributions, supply exchanges, outreach and advocacy.

The new categories and **Scenes & hideaways** quick view are now part of the discovery UI. They intentionally show zero records until a source-backed dataset is curated; empty categories must not be populated with invented locations.

## Chillness rating

`src/domain/chillness.ts` provides a small, transparent rating model. Each factor is rated 1–5 and the available factors are reweighted proportionally; at least three factors are required. The seven factors are quiet, seating, shelter, spaciousness, welcome without purchase, subjective comfort with visible monitoring, and subjective comfort around visible security presence.

The result is a **subjective place-comfort score**, not a safety score. Every observation needs a timestamp and its confidence/freshness should remain visible. Monitoring and security-presence answers describe the contributor's experience during that visit; they do not map camera positions, predict police activity, establish that an area is unmonitored, or support route recommendations designed to evade law enforcement. No inferred camera locations or live police tracking should be added.

Recommended UI: display the overall score beside the count of answered factors, last-observed date, and a low/medium/high confidence label. Let users inspect each factor separately. Do not collapse uncertainty into a single "safe" badge.

## Data quality and access rules

- **POPOS:** use the official [SF Planning POPOS inventory](https://sfplanning.org/privately-owned-public-open-space-and-public-art). Preserve posted hours, amenities, entrances and access notes; public-space status does not mean every entrance is open at every hour.
- **Mutual aid:** start with the [SF Food Not Bombs serving schedule](https://sffnb.org/serving-schedule/). Its page warns that servings can be cancelled, so show the organizer's source and a last-checked timestamp.
- **Abandoned/vacant buildings:** the [SF Food Not Bombs abandoned-building list](https://sffnb.org/list-of-san-francisco-empty-and-abandoned-buildings/) says it was updated January 2025 and explicitly does not verify current building status. Treat it as a dated lead, not confirmed abandonment or permission to enter. The City's [commercial vacancy-tax dataset](https://catalog.data.gov/dataset/taxable-commercial-spaces) covers a defined set of commercial districts, not every vacant or abandoned building.
- **Nightlife and counterculture:** use venue, organizer, artist, radio-station and archive sources; separate recurring listings from dated events and historical venues. Expire past events instead of leaving them as current pins.
- **Community edits:** keep source, observation date, verification status and access status distinct. Never infer legal access from a visible doorway or a building's apparent condition.

## Suggested implementation sequence

1. Add and validate source-backed POPOS and public hangout amenities.
2. Add event/venue records from scene calendars with expiry dates.
3. Add official mutual-aid schedules with cancellation and last-checked states.
4. Import abandoned/vacancy leads only after reviewing freshness, licensing, location precision and access implications.
5. Add community chillness observations and display the factors separately from source-backed place facts.
