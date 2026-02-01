/**
 * Gateway Fetch - Global request throttler
 * 
 * Prevents 429 errors by:
 * 1. Deduplicating all in-flight requests to the same endpoint
 * 2. Enforcing minimum intervals between requests to same endpoint
 * 3. Caching responses for a configurable duration
 */

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';
const GLOBAL_KEY = '__aegix_gateway_fetch__';
const MIN_INTERVAL = 10000; // 10 seconds minimum between requests to same endpoint
const CACHE_DURATION = 60000; // 1 minute cache

interface RequestState {
  inFlight: Map<string, Promise<any>>;
  lastRequest: Map<string, number>;
  cache: Map<string, { data: any; timestamp: number }>;
}

function getState(): RequestState {
  if (typeof window === 'undefined') {
    return {
      inFlight: new Map(),
      lastRequest: new Map(),
      cache: new Map(),
    };
  }
  
  if (!(window as any)[GLOBAL_KEY]) {
    (window as any)[GLOBAL_KEY] = {
      inFlight: new Map(),
      lastRequest: new Map(),
      cache: new Map(),
    };
  }
  return (window as any)[GLOBAL_KEY];
}

/**
 * Throttled fetch to gateway endpoints
 * Returns cached data if available and fresh, deduplicates concurrent requests
 */
export async function gatewayFetch<T = any>(
  endpoint: string,
  options?: {
    method?: 'GET' | 'POST';
    body?: any;
    force?: boolean;
    cacheDuration?: number;
  }
): Promise<T | null> {
  const state = getState();
  const method = options?.method || 'GET';
  const cacheKey = `${method}:${endpoint}`;
  const cacheDuration = options?.cacheDuration ?? CACHE_DURATION;
  const now = Date.now();
  
  // For GET requests, check cache first
  if (method === 'GET' && !options?.force) {
    const cached = state.cache.get(cacheKey);
    if (cached && (now - cached.timestamp) < cacheDuration) {
      return cached.data as T;
    }
  }
  
  // Check if we're within the minimum interval
  const lastReq = state.lastRequest.get(cacheKey) || 0;
  if (!options?.force && (now - lastReq) < MIN_INTERVAL) {
    // Return cached data if available, otherwise wait for in-flight
    const cached = state.cache.get(cacheKey);
    if (cached) {
      return cached.data as T;
    }
    
    // If there's an in-flight request, wait for it
    const inFlight = state.inFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }
    
    // Otherwise return null (rate limited)
    console.debug(`[Gateway] Rate limited: ${endpoint}`);
    return null;
  }
  
  // Check for in-flight request
  const existing = state.inFlight.get(cacheKey);
  if (existing) {
    return existing;
  }
  
  // Mark request time
  state.lastRequest.set(cacheKey, now);
  
  // Create the request
  const request = (async () => {
    try {
      const url = endpoint.startsWith('http') ? endpoint : `${GATEWAY_URL}${endpoint}`;
      const fetchOptions: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      
      if (options?.body) {
        fetchOptions.body = JSON.stringify(options.body);
      }
      
      const response = await fetch(url, fetchOptions);
      
      if (response.status === 429) {
        console.warn(`[Gateway] 429 received for ${endpoint}, using cache`);
        const cached = state.cache.get(cacheKey);
        return cached?.data || null;
      }
      
      const data = await response.json();
      
      // Cache successful responses
      if (method === 'GET') {
        state.cache.set(cacheKey, { data, timestamp: Date.now() });
      }
      
      return data as T;
    } catch (err) {
      console.warn(`[Gateway] Fetch failed: ${endpoint}`, err);
      // Return cached data on error
      const cached = state.cache.get(cacheKey);
      return cached?.data || null;
    } finally {
      // Clear in-flight after delay
      setTimeout(() => {
        state.inFlight.delete(cacheKey);
      }, 1000);
    }
  })();
  
  state.inFlight.set(cacheKey, request);
  return request;
}

/**
 * Get cached data without making a request
 */
export function getCached<T = any>(endpoint: string): T | null {
  const state = getState();
  const cacheKey = `GET:${endpoint}`;
  const cached = state.cache.get(cacheKey);
  return cached?.data || null;
}

/**
 * Clear cache for an endpoint
 */
export function clearCache(endpoint?: string): void {
  const state = getState();
  if (endpoint) {
    state.cache.delete(`GET:${endpoint}`);
    state.cache.delete(`POST:${endpoint}`);
    state.lastRequest.delete(`GET:${endpoint}`);
    state.lastRequest.delete(`POST:${endpoint}`);
  } else {
    state.cache.clear();
    state.lastRequest.clear();
  }
}
