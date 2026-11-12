// class-transformer helpers for DTOs, run before validation. Non-strings are returned
// unchanged and left for the validators. Shared helpers so feature modules do not import
// each other's DTO files.

export const trimText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const trimLower = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
