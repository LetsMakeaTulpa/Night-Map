# Findings

- Workspace is an existing React + TypeScript + Vite app using MapLibre, IndexedDB local persistence, a built-in resource/places model and private field notes.
- It already has categories for historical features, an OSM historic layer, custom private observations, saved places, and a review queue.
- No account/server sync or native Android sensor bridge is in place; browser wireless scanning should not be represented as available.
- Need inspect exact category IDs, data provenance and access-related fields before deciding what can be surfaced as verified passages or POPOS.
