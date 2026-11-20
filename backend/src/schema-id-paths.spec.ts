import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Schema, SchemaType } from 'mongoose';

// Repo-wide guard: an id reference must be an ObjectId path, and money must be a
// Decimal128 path. Through Nest's @Prop, `type: Types.ObjectId` and
// `type: Types.Decimal128` compile to Mixed paths, which cast nothing.
//
// For ids that means a string id from the token is stored and queried as a string, so
// ownerFilter / findOwnedOrThrow (ACC-11) and any query with an ObjectId silently match
// nothing. Write `type: SchemaTypes.ObjectId`.
//
// For money it means a value that reaches the model as a string stays a string, so one
// collection ends up holding both strings and Decimal128s; a range query then compares
// them as text ("9.99" sorts above "100.00") and decimal128ToString is handed something
// it cannot read. It has not happened yet only because every service converts with
// toDecimal128() first. Write `type: SchemaTypes.Decimal128` (PAY-04).
//
// This test loads every *.schema.ts under src/, walks every path (nested and array
// sub-schemas included) and fails when a path that looks like an id reference is Mixed -
// its name ends in Id or Ids (userId, passengerIds), or in By (createdBy, cancelledBy),
// or it has a ref - or when a path that looks like money is Mixed: its name ends in
// amount, price, total, fee, cost or subtotal.

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

function leafOf(name: string): string {
  return name.split('.').pop() ?? name;
}

function looksLikeIdReference(name: string, type: SchemaType): boolean {
  const options: { ref?: unknown } = type.options;
  return /[a-z](Ids?|By)$/.test(leafOf(name)) || options.ref !== undefined;
}

// cabinPrice, fareAmount, baggageTotal, lineTotal, extraBagPrice, fee, cost, subtotal.
function looksLikeMoney(name: string): boolean {
  return /(amount|price|total|fee|cost|subtotal)$/i.test(leafOf(name));
}

type Suspect = (name: string, type: SchemaType) => boolean;

// Every Mixed path of a schema that `suspect` recognises, recursing into sub-schemas
// and arrays.
function mixedPaths(schema: Schema, suspect: Suspect, prefix = ''): string[] {
  const found: string[] = [];
  schema.eachPath((name, type) => {
    const path = `${prefix}${name}`;
    const sub: unknown = Reflect.get(type, 'schema');
    if (sub instanceof Schema) {
      found.push(...mixedPaths(sub, suspect, `${path}.`));
      return;
    }
    const caster: unknown = Reflect.get(type, 'caster');
    if (type.instance === 'Array' && caster instanceof SchemaType) {
      if (caster.instance === 'Mixed' && suspect(path, caster)) {
        found.push(`${path}[]`);
      }
      return;
    }
    if (type.instance === 'Mixed' && suspect(path, type)) {
      found.push(path);
    }
  });
  return found;
}

async function allMixedPaths(suspect: Suspect): Promise<string[]> {
  const found: string[] = [];
  for (const file of schemaFiles(SRC).sort((a, b) => a.localeCompare(b))) {
    const exports: Record<string, unknown> = await import(file);
    for (const [name, value] of Object.entries(exports)) {
      if (value instanceof Schema) {
        const where = `${relative(SRC, file).replaceAll('\\', '/')} ${name}`;
        found.push(
          ...mixedPaths(value, suspect).map((path) => `${where} ${path}`),
        );
      }
    }
  }
  return found;
}

describe('Mongoose id references (ACC-11)', () => {
  let found: string[];

  beforeAll(async () => {
    found = await allMixedPaths(looksLikeIdReference);
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

describe('Mongoose money paths (PAY-04)', () => {
  it('declares every money field as a Decimal128 path', async () => {
    // No allowlist, because there is nothing left to allow. Keep it that way: a money
    // field declared `type: Types.Decimal128` lands here, and the fix is one word.
    await expect(allMixedPaths(looksLikeMoney)).resolves.toEqual([]);
  });
});
