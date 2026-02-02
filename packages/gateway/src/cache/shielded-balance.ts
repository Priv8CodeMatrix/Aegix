/**
 * Shielded Balance Override Cache
 * 
 * This cache stores shielded (compressed) USDC balances that are TRUSTED
 * because they come from successful shield transactions.
 * 
 * The Light Protocol RPC is unreliable on Railway - it often returns 0 balance
 * even when the user HAS shielded funds. This cache solves that by:
 * 
 * 1. After successful shield TX: Update cache with shielded amount
 * 2. When fetching balance: Check cache FIRST before RPC
 * 3. If RPC returns 0 but cache exists: Trust the cache
 * 4. Cache expires after 5 minutes (forces RPC refresh eventually)
 */

interface ShieldedOverride {
  amount: number;
  timestamp: number;
  source: 'shield_tx' | 'payment_success' | 'rpc_confirmed';
  poolId: string;
}

// Keyed by pool ADDRESS (not poolId)
const shieldedBalanceOverrides = new Map<string, ShieldedOverride>();

// Cache is trusted for 5 minutes after shield transaction
const OVERRIDE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Set the shielded balance override for a pool
 * Called after successful shield transaction
 */
export function setShieldedOverride(
  poolAddress: string, 
  amount: number, 
  poolId: string, 
  source: 'shield_tx' | 'payment_success' | 'rpc_confirmed' = 'shield_tx'
): void {
  const override: ShieldedOverride = {
    amount,
    timestamp: Date.now(),
    source,
    poolId,
  };
  
  shieldedBalanceOverrides.set(poolAddress, override);
  
  console.log(`[ShieldedCache] SET override for ${poolAddress.slice(0, 12)}...:`);
  console.log(`[ShieldedCache]   Amount: ${amount.toFixed(6)} USDC`);
  console.log(`[ShieldedCache]   Source: ${source}`);
  console.log(`[ShieldedCache]   Pool ID: ${poolId.slice(0, 12)}...`);
}

/**
 * Get the shielded balance override for a pool
 * Returns null if no override exists
 */
export function getShieldedOverride(poolAddress: string): ShieldedOverride | null {
  const override = shieldedBalanceOverrides.get(poolAddress);
  
  if (!override) {
    return null;
  }
  
  const ageMs = Date.now() - override.timestamp;
  const isExpired = ageMs > OVERRIDE_TTL;
  
  console.log(`[ShieldedCache] GET override for ${poolAddress.slice(0, 12)}...:`);
  console.log(`[ShieldedCache]   Amount: ${override.amount.toFixed(6)} USDC`);
  console.log(`[ShieldedCache]   Age: ${(ageMs / 1000).toFixed(0)}s`);
  console.log(`[ShieldedCache]   Expired: ${isExpired}`);
  
  // Return even if expired - let caller decide whether to use it
  return override;
}

/**
 * Check if override is still valid (within TTL)
 */
export function isOverrideValid(poolAddress: string): boolean {
  const override = shieldedBalanceOverrides.get(poolAddress);
  if (!override) return false;
  
  return Date.now() - override.timestamp < OVERRIDE_TTL;
}

/**
 * Add to existing shielded balance (for additional shield transactions)
 */
export function addToShieldedOverride(
  poolAddress: string, 
  additionalAmount: number, 
  poolId: string
): void {
  const existing = shieldedBalanceOverrides.get(poolAddress);
  
  if (existing) {
    const newAmount = existing.amount + additionalAmount;
    console.log(`[ShieldedCache] ADD ${additionalAmount.toFixed(6)} USDC to existing ${existing.amount.toFixed(6)} USDC`);
    setShieldedOverride(poolAddress, newAmount, poolId, 'shield_tx');
  } else {
    console.log(`[ShieldedCache] No existing override, creating new with ${additionalAmount.toFixed(6)} USDC`);
    setShieldedOverride(poolAddress, additionalAmount, poolId, 'shield_tx');
  }
}

/**
 * Subtract from shielded balance (after successful payment)
 */
export function subtractFromShieldedOverride(
  poolAddress: string, 
  amountSpent: number
): void {
  const existing = shieldedBalanceOverrides.get(poolAddress);
  
  if (existing) {
    const newAmount = Math.max(0, existing.amount - amountSpent);
    console.log(`[ShieldedCache] SUBTRACT ${amountSpent.toFixed(6)} USDC, new balance: ${newAmount.toFixed(6)} USDC`);
    
    if (newAmount > 0) {
      existing.amount = newAmount;
      existing.timestamp = Date.now(); // Refresh timestamp
      shieldedBalanceOverrides.set(poolAddress, existing);
    } else {
      // Balance is 0, clear the override
      clearShieldedOverride(poolAddress);
    }
  }
}

/**
 * Clear the shielded balance override for a pool
 */
export function clearShieldedOverride(poolAddress: string): void {
  const had = shieldedBalanceOverrides.has(poolAddress);
  shieldedBalanceOverrides.delete(poolAddress);
  
  if (had) {
    console.log(`[ShieldedCache] CLEARED override for ${poolAddress.slice(0, 12)}...`);
  }
}

/**
 * Get all overrides (for debugging)
 */
export function getAllShieldedOverrides(): Map<string, ShieldedOverride> {
  return new Map(shieldedBalanceOverrides);
}

/**
 * Update override with RPC-confirmed balance (when RPC actually works)
 * This refreshes the timestamp and confirms the balance
 */
export function confirmShieldedBalance(
  poolAddress: string, 
  rpcBalance: number, 
  poolId: string
): void {
  const existing = shieldedBalanceOverrides.get(poolAddress);
  
  // Only update if RPC shows a balance (don't trust RPC when it returns 0)
  if (rpcBalance > 0) {
    if (existing && existing.amount !== rpcBalance) {
      console.log(`[ShieldedCache] RPC confirmed different balance: ${rpcBalance.toFixed(6)} vs cached ${existing.amount.toFixed(6)}`);
    }
    setShieldedOverride(poolAddress, rpcBalance, poolId, 'rpc_confirmed');
  } else if (existing) {
    console.log(`[ShieldedCache] RPC returned 0 but we have cached ${existing.amount.toFixed(6)} - keeping cache`);
  }
}
