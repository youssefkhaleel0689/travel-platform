import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';

export function oid(id: string, field = 'id'): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new BadRequestException(`${field} is not a valid id`);
  return new Types.ObjectId(id);
}

/** Maps Mongo duplicate-key errors to 409 so unique violations are not reported as 500. */
export function rethrowDuplicate(err: any, message: string): never {
  if (err && (err.code === 11000 || err.code === 11001)) throw new ConflictException(message);
  throw err;
}

/** Recursively converts Decimal128 values to strings for JSON responses. */
export function jsonTransform(_doc: unknown, ret: any) {
  const walk = (v: any): any => {
    if (v && v._bsontype === 'Decimal128') return v.toString();
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof Types.ObjectId) && v._bsontype === undefined) {
      for (const k of Object.keys(v)) v[k] = walk(v[k]);
    }
    return v;
  };
  return walk(ret);
}

