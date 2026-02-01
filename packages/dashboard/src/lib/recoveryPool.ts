/**
 * Recovery Pool Status Service
 * 
 * Uses the global gateway fetch throttler to prevent 429 errors.
 */

import { gatewayFetch, getCached, clearCache as clearGatewayCache } from './gatewayFetch';

const ENDPOINT = '/api/credits/recovery/status';

export interface RecoveryPoolStatus {
  address: string;
  balance: number;
  balanceFormatted: string;
  isHealthy: boolean;
  totalRecycled: number;
  totalRecycledFormatted: string;
  minRequired: number;
  minRequiredFormatted: string;
  status: 'HEALTHY' | 'NEEDS_FUNDING';
}

/**
 * Get cached status (no API call)
 */
export function getStatusFromCache(): RecoveryPoolStatus | null {
  const cached = getCached<{ success: boolean; data: RecoveryPoolStatus }>(ENDPOINT);
  return cached?.success ? cached.data : null;
}

/**
 * Fetch Recovery Pool status (heavily throttled)
 * Will return cached data if within 10-second window
 */
export async function fetchRecoveryPoolStatus(force = false): Promise<RecoveryPoolStatus | null> {
  const result = await gatewayFetch<{ success: boolean; data: RecoveryPoolStatus }>(
    ENDPOINT,
    { force }
  );
  
  return result?.success ? result.data : null;
}

/**
 * Clear cache (force next fetch to be fresh)
 */
export function clearCache(): void {
  clearGatewayCache(ENDPOINT);
}

// Legacy exports for compatibility
export function isCacheValid(): boolean {
  return getStatusFromCache() !== null;
}

export function getCachedStatus(): { data: RecoveryPoolStatus; timestamp: number } | null {
  const data = getStatusFromCache();
  return data ? { data, timestamp: Date.now() } : null;
}
