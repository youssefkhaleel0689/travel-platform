import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';

export function oid(id: string, field = 'id'): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new BadRequestException(`${field} is not a valid id`);
  return new Types.ObjectId(id);
}

/** Maps Mongo duplicate-key errors to 409 so unique violations are not reported as 500. */
export function rethrowDuplicate(err: unknown, message: string): never {
  const code = (err as { code?: number } | null)?.code;
  if (code === 11000 || code === 11001) throw new ConflictException(message);
  throw err;
}

/** Recursively converts Decimal128 values to strings for JSON responses. */
export function jsonTransform(_doc: unknown, ret: Record<string, unknown>) {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if ((v as { _bsontype?: string })._bsontype === 'Decimal128') return String(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Date || v instanceof Types.ObjectId || (v as { _bsontype?: string })._bsontype !== undefined) return v;
    const obj = v as Record<string, unknown>;
    for (const k of Object.keys(obj)) obj[k] = walk(obj[k]);
    return obj;
  };
  return walk(ret);
}

