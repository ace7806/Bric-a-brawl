import { ErrorCode } from './enums';

export class InvariantError extends Error {
  public readonly code: ErrorCode;

  public constructor(code: ErrorCode, message: string) {
    super(`[E${code}] ${message}`);
    this.name = 'InvariantError';
    this.code = code;
  }
}

export function assert(condition: unknown, code: ErrorCode, message: string): asserts condition {
  if (!condition) throw new InvariantError(code, message);
}

export function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new InvariantError(ErrorCode.NonFiniteNumber, `${label} is not finite: ${String(value)}`);
  }
  return value;
}

export function assertNever(value: never, context: string): never {
  throw new InvariantError(ErrorCode.UnreachableCase, `Unreachable case in ${context}: ${String(value)}`);
}

export function requireAt<T>(items: readonly T[], index: number, label: string): T {
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new InvariantError(ErrorCode.IndexOutOfBounds, `${label}[${index}] out of bounds (len=${items.length})`);
  }
  return items[index] as T;
}

export function requireKey<K, V>(map: ReadonlyMap<K, V>, key: K, label: string): V {
  if (!map.has(key)) {
    throw new InvariantError(ErrorCode.MissingRequiredEntry, `Missing key ${String(key)} in ${label}`);
  }
  return map.get(key) as V;
}

export function requireDefined<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new InvariantError(ErrorCode.MissingRequiredEntry, `Required value missing: ${label}`);
  }
  return value;
}
