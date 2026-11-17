import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Schema, SchemaType } from 'mongoose';

// Repo-wide guard: an id reference must be an ObjectId path. Through Nest's @Prop,
// `type: Types.ObjectId` compiles to a Mixed path, which casts nothing: a string id from
// the token is stored and queried as a string, so ownerFilter / findOwnedOrThrow (ACC-11)
// and any query with an ObjectId silently match nothing. Write `type: SchemaTypes.ObjectId`.
//
// This test loads every *.schema.ts under src/, walks every path (nested and array
// sub-schemas included) and fails when a path that looks like an id reference is Mixed:
// its name ends in Id or Ids (userId, passengerIds), or in By (createdBy, cancelledBy),
// or it has a ref.

// Known Mixed id paths that exist today, as "<file relative to src> <Schema export> <path>".
// Do not add to this list: write `type: SchemaTypes.ObjectId` instead. A path nested in
// another schema appears once per schema that contains it. The second test fails when an
// entry is fixed but left here, so the list only shrinks.
const ALLOWED_MIXED_ID_PATHS: readonly string[] = [
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/airline-moderator-assignment.schema.ts AirlineModeratorAssignmentSchema moderatorId',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/airline-moderator-assignment.schema.ts AirlineModeratorAssignmentSchema airlineId',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/airline.schema.ts AirlineSchema createdBy',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/flight-booking.schema.ts BaggageSchema passengerId',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/flight-booking.schema.ts CancellationSchema cancelledBy',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/flight-booking.schema.ts CancellationSchema refundId',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/flight-booking.schema.ts FlightBookingSchema userId',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/flight-booking.schema.ts FlightBookingSchema policyAcceptanceId',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/flight-booking.schema.ts FlightBookingSchema paymentId',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/flight-booking.schema.ts FlightBookingSchema segments.flightId',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/flight-booking.schema.ts FlightBookingSchema segments.airlineId',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/flight-booking.schema.ts FlightBookingSchema baggage.passengerId',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/flight-booking.schema.ts FlightBookingSchema cancellation.cancelledBy',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/flight-booking.schema.ts FlightBookingSchema cancellation.refundId',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/flight-booking.schema.ts FlightSegmentSchema flightId',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/flight-booking.schema.ts FlightSegmentSchema airlineId',
  // owned by A1/A2, to be fixed in their PR
  'flights/schemas/flight.schema.ts FlightSchema airlineId',
];

const SRC = __dirname;

function schemaFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return schemaFiles(full);
    }
    return entry.name.endsWith('.schema.ts') ? [full] : [];
  });
}

function looksLikeIdReference(name: string, type: SchemaType): boolean {
  const leaf = name.split('.').pop() ?? name;
  const options: { ref?: unknown } = type.options;
  return /[a-z](Ids?|By)$/.test(leaf) || options.ref !== undefined;
}

// Every Mixed id path of a schema, recursing into sub-schemas and arrays.
function mixedIdPaths(schema: Schema, prefix = ''): string[] {
  const found: string[] = [];
  schema.eachPath((name, type) => {
    const path = `${prefix}${name}`;
    const sub: unknown = Reflect.get(type, 'schema');
    if (sub instanceof Schema) {
      found.push(...mixedIdPaths(sub, `${path}.`));
      return;
    }
    const caster: unknown = Reflect.get(type, 'caster');
    if (type.instance === 'Array' && caster instanceof SchemaType) {
      if (caster.instance === 'Mixed' && looksLikeIdReference(path, caster)) {
        found.push(`${path}[]`);
      }
      return;
    }
    if (type.instance === 'Mixed' && looksLikeIdReference(path, type)) {
      found.push(path);
    }
  });
  return found;
}

async function allMixedIdPaths(): Promise<string[]> {
  const found: string[] = [];
  for (const file of schemaFiles(SRC).sort((a, b) => a.localeCompare(b))) {
    const exports: Record<string, unknown> = await import(file);
    for (const [name, value] of Object.entries(exports)) {
      if (value instanceof Schema) {
        const where = `${relative(SRC, file).replaceAll('\\', '/')} ${name}`;
        found.push(...mixedIdPaths(value).map((path) => `${where} ${path}`));
      }
    }
  }
  return found;
}

describe('Mongoose id references (ACC-11)', () => {
  let found: string[];

  beforeAll(async () => {
    found = await allMixedIdPaths();
  });

  it('declares every new id reference as an ObjectId path', () => {
    const unexpected = found.filter(
      (path) => !ALLOWED_MIXED_ID_PATHS.includes(path),
    );
    expect(unexpected).toEqual([]);
  });

  it('keeps the allowlist current: remove an entry once its path is fixed', () => {
    const stale = ALLOWED_MIXED_ID_PATHS.filter(
      (path) => !found.includes(path),
    );
    expect(stale).toEqual([]);
  });
});
