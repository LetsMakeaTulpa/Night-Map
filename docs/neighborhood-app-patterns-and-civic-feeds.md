# Reverse-engineering neighborhood apps and building Night Map's civic-feed layer

Last reviewed: 2026-10-28. This is feature-level analysis of publicly documented behavior and public APIs, not decompilation, private endpoint extraction, or bypassing access controls.

## Product patterns to borrow

### CrimeMapping.com
Public documentation describes a map of categorized reported crime, block-generalized locations, filters, date windows, and email alerts. Its data is described as refreshed daily, and its own disclaimer says coverage is not all-inclusive. Night Map should adopt: map + time window + category filters, source/date labels, block/coarse-zone precision, saved areas and opt-in alerts. Do not copy an implied “crime = danger” interpretation; incidents are not a complete measure of comfort or likelihood of being moved along.

### SpotCrime
SpotCrime describes aggregation, normalization, source attribution, crime maps, alerts and a developer API. Night Map should borrow the normalized event schema and source traceability pattern. API access, price and licensing must be confirmed before integration; no vendor data is treated as free by default.

### CRIMEWATCH
Public product information emphasizes verified agency pages, official updates/alerts, subscriptions and secure tips. Night Map should implement verified-source badges, agency-source links, timestamped notices and subscription-ready zone alerts. Do not create a public tip-submission channel until moderation, abuse handling, privacy, retention and escalation responsibilities are designed.

### Nextdoor / neighborhood apps
Nextdoor documents approved content APIs for public posts, marketplace listings, and public agency feeds. Access to these APIs requires a request; public agency content and public posts are distinct from private neighborhood content. Night Map should provide a community feed model with source type (official / community / business), timestamp, location confidence, verification state and links back to origin. Only ingest through approved access and permitted public content; do not scrape logged-in feeds or import private resident conversations.

### 311-style service systems
311 is best modeled as a service-request lifecycle, not a crime feed: opened, updated, assigned, closed, category, responsible agency, and location when published. Keep request status and timestamps, and distinguish a citizen report from an independently verified condition. Public datasets can be aggregated by zone; free-text and sensitive person-focused categories stay out of public markers.

## Common data model

Every source adapter should emit the same envelope:
- `sourceId`, `sourceRecordId`, `sourceUrl`
- `publishedAt`, `observedAt`, `retrievedAt`, `expiresAt`
- `eventType`, `status`, `agency`, `zoneId`, optional generalized geometry
- `verificationLevel`, `locationPrecision`, `license`, `dataLag`
- `privacyClass`, `dedupeKey`, `rawRecordHash`

Keep raw source data in a server-side staging area only when licensing and privacy allow it. The public app receives a normalized, minimized snapshot. Retain source timestamps and import time separately, expose stale/error status, and never present an old snapshot as live.

## San Francisco feed inventory

| Source | Public endpoint / landing page | Published cadence | Integration plan |
|---|---|---|---|
| Law Enforcement Dispatched Calls (gnap-fj3t) | [DataSF](https://data.sf.gov/d/gnap-fj3t) | Every 10 minutes, plus about 10-minute publication delay; rolling 48 hours | Existing snapshot; refresh target 10–15 minutes when hosted refresh is available |
| SF 311 Cases (vw6y-z8j6) | [DataSF](https://data.sf.gov/d/vw6y-z8j6) | Nightly, generally around 6 a.m. Pacific | Existing snapshot; refresh after published update |
| SFPD Incident Reports (wg3w-h783) | [DataSF](https://data.sf.gov/d/wg3w-h783) | Dataset metadata must be checked; not a live dispatch feed | Add daily incremental adapter with overlap for corrections |
| Fire/EMS dispatched calls (nuek-vuh3) | [DataSF](https://data.sf.gov/d/nuek-vuh3) | Daily | Add safe aggregate only; exclude medical/person-focused event categories and deduplicate multiple units |
| Temporary Street Closures (8x25-yybr) | [DataSF](https://data.sf.gov/d/8x25-yybr) | Database changes continuously; published report daily | Add with start/end-time expiry; scope is SFMTA-permitted closures, not every department |
| Public Works Street-Use Permits (b6tj-gt35) | [DataSF](https://data.sf.gov/d/b6tj-gt35) | Daily around midnight with about a one-day lag | Add active-permit subset; deduplicate repeated street rows |
| 511 transit real-time and service alerts | [511 Open Data](https://511.org/open-data/transit) | Real-time | Requires free API token; obey rate limits and terms; use alerts/trip updates for route context |
| NotifySF / official emergency alerts | [SF.gov](https://sf.gov/notify-sf) | Event-driven | Public machine-readable feed not verified; link-only until API/feed access is confirmed |
| Public facilities (bathrooms, fountains, POPOS, Muni stops) | [DataSF](https://data.sf.gov/) | Dataset-specific | Existing snapshot; re-import on metadata/source change; never claim live availability |
| Nextdoor public content / verified agency feed | [Developer docs](https://developer.nextdoor.com/reference/introduction) | API-defined | Request access; public content only; no private feed scraping |
| SpotCrime | [Product/API overview](https://spotcrime.io/about) | Vendor-defined | Verify API access, price, terms and coverage before adapter |
| CrimeMapping.com | [Official product](https://www.crimemapping.com/) | Participating agencies described as daily | Link/benchmark only unless authorized API/feed is documented |

This is a prioritized inventory, not a claim that every government dataset or private platform has a public API. “Use every feed” should mean **systematically discover, assess, and integrate every relevant feed that is legally and technically accessible**, not indiscriminately ingest every record. A large feed catalog needs automated metadata discovery and an explicit inclusion/exclusion review.

## Refresh architecture

1. **Source discovery:** daily fetch of DataSF catalog metadata, search for public datasets with update cadence and geospatial fields; store IDs, owners, license, cadence, columns, last-modified time and deprecation status.
2. **Incremental ingestion:** use `data_as_of`, update timestamps or stable IDs where available; overlap time windows to capture late corrections; use ETags/Last-Modified where supported; paginate; retry with exponential backoff.
3. **Source-specific adapters:** never assume that every dataset uses the same field names or timestamp semantics.
4. **Normalization and deduplication:** preserve original source identity and link, hash source record, deduplicate cross-feed events without erasing separate evidence.
5. **Privacy/safety filter:** remove free-text, personal identifiers, sensitive calls, person-focused categories and precise home addresses before public output. Never create individual risk profiles.
6. **Freshness monitoring:** each source has expected cadence, last success, newest record, retrieval time, row count, schema fingerprint, and a stale/error state.
7. **Public snapshots:** serve minimized JSON from the app's own host so the PWA remains usable offline. The UI must show “snapshot updated” and “newest event” separately.
8. **Alerts:** opt-in per saved zone, category and time window; deduplicate; rate-limit; let users mute sources. Do not turn low-confidence reports into urgent push alerts.

## Zone and rating semantics

- Use a shared coarse grid and neighborhood labels, but never claim different feeds have equivalent location precision.
- Keep official incidents, dispatched calls, 311 complaints, transport disruptions and community posts as separate layers.
- Hangout comfort and low-friction ratings are community observations, not computed from police counts.
- Never map individual complainants, unhoused people, medical/welfare calls, or private resident allegations.
- Do not add camera-position mapping or live police-tracking/evasion features.
- “Open/public” is a verified access attribute; vacancy or lack of visible security does not imply permission.

## Implementation status

Already present: bundled snapshots for dispatched calls and 311; source-aware data records; public facility inventory; a manual refresh script; existing coarse-zone aggregation/rating domain module.

Added to the current branch: this source catalog, documented app feature patterns, and catalog integrity tests.

Still needed: hosted scheduled refresh, catalog crawler, SFPD incident and safe fire/EMS adapters, street closure and Public Works adapters, 511 token-backed adapter, freshness dashboard, and map/UI integration of zone summaries. Nextdoor API access is approval-gated; NotifySF machine-readable access is unverified; SpotCrime API terms/cost require confirmation.
