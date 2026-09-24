/**
 * src/core/contract.ts: the stub convention for M0 contract files (frozen).
 * Every contract function that is not built yet throws notImplemented('<module>: <function>').
 * Harness pages and the app catch it with isNotImplemented() and fall back to a placeholder.
 */

export const NOT_IMPLEMENTED_PREFIX = 'not implemented: ';

export function notImplemented(what: string): never {
  throw new Error(`${NOT_IMPLEMENTED_PREFIX}${what}`);
}

export function isNotImplemented(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(NOT_IMPLEMENTED_PREFIX);
}

/** Run fn; if it throws notImplemented, return null (other errors propagate). */
export function tryImplemented<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch (err) {
    if (isNotImplemented(err)) return null;
    throw err;
  }
}
