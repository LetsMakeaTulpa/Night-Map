#!/usr/bin/env node
/**
 * Refresh every City-backed dataset in the order the build expects.
 *
 *   1. SF open data (water, Muni stops, POPOS) → scripts/.cache
 *   2. Rebuild the bundled places/resources/transit files from that cache
 *   3. Derive per-stop overnight service from SFMTA GTFS
 *   4. Dispatched calls and 311 snapshots → public/incidents
 *   5. Building registry → public/buildings/registry.json
 *
 * Basemap, terrain and building-footprint tiles are deliberately excluded:
 * they change rarely and are large. Refresh them with their own scripts when
 * the extract changes, not every night.
 *
 * Usage: node scripts/refresh-data.mjs [--skip-registry]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const skipRegistry = process.argv.includes('--skip-registry');

const steps = [
  { label: 'SF open data', script: 'scripts/fetch-sfgov.mjs', args: ['--refresh'] },
  { label: 'Bundled dataset', script: 'scripts/build-dataset.mjs', args: [] },
  { label: 'Night service schedules', script: 'scripts/build-transit-service.mjs', args: [] },
  { label: 'Incident snapshots', script: 'scripts/fetch-incidents.mjs', args: ['--refresh'] },
  ...(skipRegistry
    ? []
    : [{ label: 'Building registry', script: 'scripts/fetch-building-registry.mjs', args: ['--refresh'] }]),
];

for (const step of steps) {
  console.log(`\n=== ${step.label} (${step.script}) ===`);
  const result = spawnSync(process.execPath, [step.script, ...step.args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    console.error(`[refresh] ${step.label} failed to start:`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[refresh] ${step.label} exited with ${result.status ?? 'a signal'}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n[refresh] City data refreshed. Run `npm test` and `npm run build` before publishing.');
