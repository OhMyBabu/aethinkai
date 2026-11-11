/**
 * Failure-tolerant fan-out for dashboard loads.
 *
 * A dashboard usually fires 5–8 endpoints in parallel. With `Promise.all` one
 * 404/500 (an endpoint added but the gateway not restarted, a revoked key, a
 * proxy hiccup) rejects the whole batch, and the page quietly renders zeros -
 * which reads like "no traffic" instead of "the call failed". `settle()` turns
 * each call into `T | null` so the caller can render what DID arrive and say
 * out loud what did not.
 */
export async function settle<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[settle] endpoint failed:", error);
    return null;
  }
}

export function failedCount(values: readonly unknown[]): number {
  return values.filter((value) => value === null || value === undefined).length;
}
