# Mephisto Protocol v1.0 — engineering review

Status: accepted as a set of product ideas, not accepted as deployable code. The
amendment at the end records what the shipped app now does; where the two differ,
the amendment and the README describe the build.

## 1. Shadow Layer → Public-realm maintenance context

Accepted: expose a narrow subset of City 311 service requests for streetlights, cleaning/debris, public graffiti, litter receptacles, street defects and blocked public ways.

Rejected: the proposed risk score and red/yellow/green safe/unsafe labels. A 311 request is a report, not a verified fault. A streetlight service category does not confirm a lamp is out. Reporting rates, duplicate requests, dataset caps, closure delays, maintenance schedules and population differences make a weighted sum unsuitable as a prediction of danger or neglect.

Implementation:
- use exact allowlisted City categories from the sanitized 7-day 311 snapshot;
- retain source and snapshot timestamp;
- display requests separately from closed dispatched-call records;
- preserve the existing approximately 40 m coordinate coarsening;
- show a coarse ~250 m cell count and actual request categories;
- label them as reports, never safety levels or confirmed current conditions.

No map color is to mean “safe”. The maintenance palette is a category cue only.

## 2. WhisperNet → native-first, opt-in communications design

WhisperNet's peer-to-peer transport is not implemented in the browser/PWA. React Native BLE APIs and Android Wi-Fi Direct are not available through the current MapLibre web application without a separate native transport layer and platform permissions. The app's Messages workspace is a separate feature: self-addressed, location-locked notes on this device, with no peer delivery.

The supplied sample is not secure:
- CryptoJS.AES.encrypt does not implement AES-256-GCM as claimed; the default CryptoJS AES mode is not an authenticated-encryption interface.
- one hard-coded shared passphrase gives every peer the same identity and compromise boundary;
- there is no authenticated key exchange, peer authentication, message signature, replay cache, nonce discipline, key rotation or revocation;
- incoming messages are re-broadcast by calling sendMessage, which creates a new sender/timestamp/TTL and can create loops;
- the sample BLE manager API does not provide the shown generic advertising method in the manner assumed;
- delivery, retention and peer-device logging cannot be guaranteed absent merely because the app does not operate a server.

A future native design needs a reviewed protocol and threat model before implementation. Candidate building blocks: X25519 key agreement, Ed25519 peer identity signatures, HKDF-SHA-256 session derivation, AES-256-GCM or ChaCha20-Poly1305, unique nonces, authenticated sender/recipient IDs, monotonic message IDs, replay/deduplication cache, bounded TTL, explicit expiry, peer consent and revocation. Prefer an established protocol/library over custom cryptography. BLE should be a transport only; Wi-Fi Direct is an optional Android high-throughput transport, not the security layer.

The UI must state that connected peers can retain or forward messages, and cannot promise “no traces” or “no logs” on devices it does not control.

## 3. HollowShell → evidence-backed building records

Accepted: create building dossiers from public, attributable records and public-facing observations, retaining uncertainty and dates.

Rejected: infer occupancy or abandoned status solely from boarded windows, darkness, faded signs, vegetation or broken glass. None proves vacancy. Street imagery may be old, seasonal, obscured or mislocated. The supplied model file, training data and dependency/API versions are not included, so the sample cannot currently run.

Record classes, now implemented where a source exists:
- official commercial-vacancy filings or other explicitly published vacancy declarations
  (San Francisco publishes no such register, so this class is unused);
- parcel and assessor records, planning/zoning, permits and inspections where public;
- OSM building footprint/address/entrance data, clearly attributed;
- visual condition observations from public rights-of-way, dated and marked unverified;
- human verification and correction history.

Do not convert an unverified building into a suggested shelter, entry target, vantage point or escape route. Do not infer permission to enter. Building dossiers should direct users to official public parcel/property records and document public access, not bypass private access controls.

## Explicitly not implemented

This list is about inference and intrusion, not about City records: dispatched calls ship
as published, delayed records, and vacancy/abandonment parcels ship as reported records
(see the amendment).

- person-level or live encampment location reporting;
- a predictive danger score from civic complaints;
- unauthorized CCTV patching, private camera access or camera-network exploitation;
- instructions to enter private or unsecured buildings or to use them as vantage/escape locations.

These are deliberate product and privacy boundaries, not missing implementation details.

## Amendment — 2026-11-23

The product owner asked for the boundaries above to be re-examined. What has
changed in the build since this review:

- **Police activity is shipped, not refused.** Dispatched calls are plotted from
  the City's delayed CAD feed while the layer is open; sensitive and
  person-describing categories are removed and coordinates are coarsened to about
  40 m.
- **HollowShell became the building registry.** Parcel dossiers join DBI
  complaints, permits and notices; they classify records, never occupancy.
- **Vacancy and abandonment parcels are shown from City records**, labelled as
  reported and never as a confirmed vacant building.

What still stands, and why:

- live camera streams and a camera point layer — no lawful public feed or register
  exists, so positions would be invented;
- encampment locations — mapping where unhoused people sleep would turn the map
  into a targeting tool;
- occupancy inference from photographs — a boarded window is not a vacancy finding.

This amendment records a product decision; it does not change the underlying data.
