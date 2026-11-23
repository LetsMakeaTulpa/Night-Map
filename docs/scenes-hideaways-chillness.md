# Night Map zones, hangout comfort and neighborhood signals

## Product priority

The first three priorities are:
1. **Public hangouts and POPOS:** clearly permitted places to sit, decompress, meet, or spend time without a purchase.
2. **Abandoned/vacant building collection:** dated, source-backed history and vacancy leads, with access status kept separate from apparent vacancy.
3. **Food, mutual aid and advocacy:** Food Not Bombs, food distributions, community fridges, supply exchanges and outreach.

DIY/counterculture enriches these layers where relevant: community-run spaces, zines, collectives, independent radio, historic radical venues, DIY shows and public events. Avoid gimmicky gamification and do not turn it into a generic nightlife directory.

## Shared zone model

`src/domain/zone-intelligence.ts` defines stable, coarse grid zones of approximately 220–280 metres across. Every supported feed is assigned to the same zone key before aggregation. This is a grid overlay, not a claim that existing neighborhood centroids are neighborhood boundaries. A future boundary layer can add official neighborhood names as labels while retaining the same stable grid IDs for cross-feed comparisons.

The zone summary keeps these evidence types separate:
- **Police incident reports:** longer-term reported-incident context.
- **Dispatched calls:** short rolling snapshot of closed calls, not live police location.
- **311 service requests:** place/service complaint signals, not proof that someone did anything wrong.
- **Street conditions and closures:** practical access and route context.
- **Community reports:** dated visitor experiences, never treated as official records.

Current app ingestion is already implemented for dispatched-call and 311 snapshots. SFPD incident reports, closures, and public-event feeds are registered as planned sources, not falsely marked as integrated. See `src/domain/zone-feeds.ts`.

## Two ratings, not one safety score

### Hangout comfort
A community-reported 0–100 summary derived only from dated visitor ratings. It represents comfort at the reported time band and place; it is not an objective safety guarantee.

### Low-friction / complaint experience
A separate community-reported 0–100 summary derived only from dated reports of unwanted interruption or complaints. A high score means contributors reported fewer interruptions in their visits; it does **not** predict that a future visitor will avoid complaints, security or law enforcement.

Both experience ratings require at least three reports before the UI uses a substantive label. A third independent rating, **public-access clarity**, records whether visitors found permission and access rules clear; it must never infer permission from vacancy or a lack of visible staff. Confidence depends on sample size and freshness. The model supports filtering ratings by day/evening/late-night, since conditions change across time.

### Official feeds remain contextual evidence
The system does not combine calls, crime reports and 311 into one “danger” score. Counts are not population-adjusted rates and can reflect reporting practices, agency response, and unequal access to reporting. A 311 complaint may be resolved or misclassified; a dispatch is not proof of crime. Use counts, date ranges, source links and freshness, with clear caveats.

The existing feed loader is a bundled snapshot. City data may update more often than the app; every view must show when the bundled data was captured and the newest event time separately.

## Privacy, safety and anti-targeting rules

- Never map sensitive calls, health/welfare categories, unhoused people's locations, person descriptions, free-text narratives, caller information, or identifiable complainants.
- Keep precise field notes private by default. Public ratings should contain structured fields and time bands, not accusations or descriptions of individuals.
- Do not infer CCTV locations or publish live police-position/patrol predictions. Aggregate public datasets by coarse zones and use historical/contextual summaries only.
- The abandoned-building collection is a research/historical layer, not permission to enter. Preserve source, last checked date, apparent status and access status separately.
- Only score places whose public-access status is documented or explicitly mark access as unknown. Do not infer public access from an unlocked door, vacancy or lack of visible staff.
- Community ratings must be explainable and appealable; don't let one report label a neighborhood unsafe or “complaint-prone.”

## Current implementation status

Implemented in the current branch:
- New categories and “Scenes & hideaways” quick view.
- Existing city-dispatched-call and 311 snapshot layers retained.
- Coarse zone key and zone aggregation domain module.
- Separate community-only hangout-comfort and low-friction rating summaries, with sample-size, freshness and confidence rules.
- A source registry and unit tests for zone aggregation.

Not yet implemented:
- Importing SFPD's longer-term incident report dataset.
- Map polygon/heat overlay and zone detail panel.
- User-facing rating submission, moderation and aggregate persistence.
- Automated refresh/scheduling. The existing PWA ships bundled snapshots; this registry does not imply live updates.

## Source references

- [DataSF police incident reports](https://data.sf.gov/d/wg3w-h783)
- [DataSF dispatched calls for service](https://data.sf.gov/d/gnap-fj3t)
- [DataSF 311 cases](https://data.sf.gov/d/vw6y-z8j6)
- [SF Planning POPOS inventory](https://sfplanning.org/privately-owned-public-open-space-and-public-art)
- [SF Food Not Bombs serving schedule](https://sffnb.org/serving-schedule/)
- [SF Food Not Bombs abandoned-building list](https://sffnb.org/list-of-san-francisco-empty-and-abandoned-buildings/)
