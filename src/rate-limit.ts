/**
 * Rate limit detection and deferred retry utilities for container runners.
 */

/** Interval between scheduled retries (1 hour). */
export const PENDING_RETRY_INTERVAL_MS = 60 * 60 * 1000;

/** Maximum retry attempts before giving up permanently. */
export const MAX_PENDING_RETRY_ATTEMPTS = 5;

/**
 * Returns true if the container stderr indicates an API rate limit,
 * quota exhaustion, or server overload error.
 */
export function isRateLimitError(stderr: string): boolean {
  return /429|529|rate.?limit|quota.?exceeded|resource.?exhausted|too.?many.?requests|overload/i.test(
    stderr,
  );
}
