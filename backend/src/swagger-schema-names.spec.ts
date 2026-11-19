import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Swagger names every schema after its class. Two DTO classes with the same name
// (even in different modules) become ONE schema in the document: the last one
// loaded silently replaces the other, so an endpoint shows another endpoint's
// fields. This happened with FlightBookingPassengerDto (flight bookings vs the
// airline's booking list) and CancellationTierDto (airline policy, hotel policy
// and the booking cancellation quote). Give every DTO class a unique name.

const SRC = __dirname;
const DTO_CLASS = /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+Dto)\b/gm;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

describe('Swagger schema names (GEN-02)', () => {
  it('gives every DTO class a unique name', () => {
    const places = new Map<string, string[]>();
    for (const file of sourceFiles(SRC)) {
      for (const match of readFileSync(file, 'utf8').matchAll(DTO_CLASS)) {
        const name = match[1];
        places.set(name, [...(places.get(name) ?? []), relative(SRC, file)]);
      }
    }
    const duplicates = [...places.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([name, files]) => `${name}: ${files.join(', ')}`);
    expect(duplicates).toEqual([]);
  });
});
