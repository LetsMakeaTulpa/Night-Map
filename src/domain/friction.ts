import type { FrictionEntry, FrictionKind, Resource } from './types';

export const FRICTION_KIND_LABELS: Record<FrictionKind, string> = {
  true_price: 'Price',
  free_allowance: 'Free allowance',
  payment_methods: 'Payment',
  id_required: 'ID & eligibility',
  intake_required: 'Intake',
  availability: 'Availability',
  hours_access: 'Timing',
  other: 'Other',
};

/**
 * Every friction line recorded across the resources at a place, in one list.
 * These are the things that decide whether a service is usable tonight: what it
 * costs, how you pay, what you must show, and when it is actually reachable.
 */
export function frictionFor(resources: Resource[]): FrictionEntry[] {
  return resources.flatMap((resource) => resource.friction ?? []);
}

/**
 * True when at least one line records that the source is silent. The interface
 * says "the source does not say" rather than treating silence as permission.
 */
export function silences(resources: Resource[]): FrictionEntry[] {
  return frictionFor(resources).filter((line) => line.value === null);
}
