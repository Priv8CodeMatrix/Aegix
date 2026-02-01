/**
 * Aegix Gateway API Client
 * NON-CUSTODIAL: No balance/deposit/withdraw functions
 * Only manages agents and encrypted audit logs
 */

import { gatewayFetch, getCached } from './gatewayFetch';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';

// Types
export interface GatewayStatus {
  version: string;
  network: string;
  rpc_url: string;
  usdc_mint: string;
  model?: string;
  payai?: {
    url: string;
    network: string;
    features: string[];
  };
  fhe?: {
    provider: string;
    mode: 'REAL' | 'SIMULATION';
    sdkLoaded: boolean;
    error: string | null;
  };
}

export interface SpendingLimits {
  maxPerTransaction: string;
  dailyLimit: string;
  allowedResources: string[];
}

export interface AgentStealthSettings {
  enabled: boolean;
  mode?: 'legacy' | 'light';           // NEW: Toggle between old and Light Protocol
  
  // Legacy fields (Aegix 3.x)
  poolId?: string;
  poolAddress?: string;
  
  // Light Protocol fields (Aegix 4.0)
  lightPoolAddress?: string;           // Compressed pool account address
  lightSessionKey?: LightSessionKey;   // Session authority
  lightMerkleRoot?: string;            // Merkle tree for compressed accounts
  
  // Common fields
  fundingThreshold: string;
  totalPayments: number;
  totalSolRecovered: number;
}

// Light Protocol Session Key (Aegix 4.0)
export interface LightSessionKey {
  publicKey: string;
  grantedAt: string;
  expiresAt: string;
  maxPerTransaction: string;
  dailyLimit: string;
  spentToday: string;
  lastResetDate: string;
  status: 'active' | 'expired' | 'revoked' | 'pending';
  lightPoolAddress?: string;
  merkleTree?: string;
}

// Light Protocol Session Status
export interface LightSessionStatus {
  agentId: string;
  agentName: string;
  mode: 'light' | 'legacy';
  lightEnabled: boolean;
  session?: {
    publicKey: string;
    status: string;
    expiresIn: string;
    maxPerTx: string;
    dailyLimit: string;
    spentToday: string;
    remainingToday: string;
    valid: boolean;
    validationReason?: string;
    remainingDailyLimit?: string;
  };
  pool?: {
    address: string;
    merkleTree: string;
    balance: {
      amount: string;
      formatted: string;
    } | null;
  };
  health?: {
    lightProtocol: boolean;
    slot?: number;
  };
  costEstimate?: {
    regularAccountRent: number;
    compressedAccountCost: number;
    savingsMultiplier: number;
  };
}

// Light Protocol cost estimate
export interface LightCostEstimate {
  perPayment: {
    legacy: string;
    light: string;
    savings: string;
  };
  forPayments: {
    count: number;
    legacy: string;
    light: string;
    totalSavings: string;
    savingsMultiplier: number;
  };
}

export interface Agent {
  id: string;
  owner: string;
  name: string;
  status: 'active' | 'idle' | 'paused';
  privacyLevel: 'maximum' | 'shielded' | 'standard';
  spent24h: string;
  totalSpent: string;
  apiCalls: number;
  createdAt: string;
  lastActivity: string;
  // API Key fields (apiKey only present on creation)
  apiKey?: string;
  apiKeyVisible?: string;
  spendingLimits?: SpendingLimits;
  stealthSettings?: AgentStealthSettings;
}

export interface AgentWithKey extends Agent {
  apiKey: string; // Always present when newly created
}

export interface AuditLogEntry {
  id: string;
  type: 'agent_payment' | 'payment_confirmed' | 'agent_created' | 'agent_deleted' | 'pool_payment' | 'pool_initialized' | 'maximum_privacy_payment' | 'compress_tokens' | 'shield_tokens' | string;
  amount?: string;
  service?: string;
  timestamp: string;
  encrypted: boolean;
  txSignature?: string;
  txSignature1?: string;  // For two-step payments (Pool → Burner)
  txSignature2?: string;  // For two-step payments (Burner → Recipient)
  fheHandle?: string;
  // Pool payment specific fields
  stealthPoolAddress?: string;
  recipient?: string;
  tempBurner?: string;
  solRecovered?: number;
  method?: string;
  feePayer?: string;
  paymentFlow?: {
    setupTx?: string;
    usdcTransferTx?: string;
    paymentTx?: string;
    recoveryTx?: string;
  };
  // Light Protocol compression fields
  compressed?: boolean;
  proofHash?: string;
  compression?: {
    enabled: boolean;
    savingsPerPayment?: number | string;
    multiplier?: number;
  };
  privacy?: {
    twoStepBurner?: boolean;
    recipientSees?: string;
    ownerHidden?: boolean;
    poolHidden?: boolean;
    zkProof?: boolean;
  };
}

export interface AuditLogResponse {
  owner: string;
  logs: AuditLogEntry[];
  encrypted: boolean;
  model: string;
}

export interface ProtectedResource {
  path: string;
  price: string;
  description: string;
}

export interface PaymentRequest {
  paymentId: string;
  resource: string;
  amount: string;
  amountUsdc: string;
  payai: {
    facilitator: string;
    network: string;
    action: string;
  };
  model: string;
}

export interface ApiError {
  error: string;
  message?: string;
}

// Helper function for API calls
async function apiCall<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${GATEWAY_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `API Error: ${response.status}`);
    }

    return data;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('Gateway unreachable. Is the server running?');
    }
    throw error;
  }
}

/**
 * Check if gateway is healthy
 */
export async function checkHealth(): Promise<{ healthy: boolean; network?: string }> {
  try {
    const data = await apiCall<{ status: string; network: string }>('/health');
    return { healthy: data.status === 'healthy', network: data.network };
  } catch {
    return { healthy: false };
  }
}

/**
 * Get gateway status and configuration
 */
export async function getStatus(): Promise<GatewayStatus | null> {
  try {
    const response = await apiCall<{ success: boolean; data: GatewayStatus }>('/api/status');
    return response.data;
  } catch (error) {
    console.error('Failed to get gateway status:', error);
    return null;
  }
}

/**
 * Fetch audit log for a wallet owner (encrypted activity history)
 */
export async function fetchAuditLog(owner: string): Promise<AuditLogEntry[]> {
  try {
    const response = await apiCall<{ success: boolean; data: AuditLogResponse }>(
      `/api/credits/audit/${owner}`
    );
    return response.data.logs || [];
  } catch (error) {
    console.error('Failed to fetch audit log:', error);
    return [];
  }
}

/**
 * Fetch audit log with FHE mode information
 */
export async function fetchAuditLogWithFheMode(owner: string): Promise<{
  logs: AuditLogEntry[];
  fheMode: 'REAL' | 'SIMULATION' | 'UNKNOWN';
}> {
  try {
    const response = await apiCall<{ 
      success: boolean; 
      data: AuditLogResponse;
      fhe?: { mode: string };
    }>(
      `/api/credits/audit/${owner}`
    );
    return {
      logs: response.data.logs || [],
      fheMode: (response.fhe?.mode as 'REAL' | 'SIMULATION') || 'UNKNOWN',
    };
  } catch (error) {
    console.error('Failed to fetch audit log:', error);
    return { logs: [], fheMode: 'UNKNOWN' };
  }
}

/**
 * Get list of protected resources and their prices
 */
export async function getResources(): Promise<ProtectedResource[]> {
  try {
    const response = await apiCall<{ success: boolean; data: ProtectedResource[] }>(
      '/api/credits/resources'
    );
    return response.data || [];
  } catch (error) {
    console.error('Failed to get resources:', error);
    return [];
  }
}

// ============ Agent Management ============

/**
 * Get agents for an owner
 */
export async function getAgents(owner: string): Promise<Agent[]> {
  try {
    const response = await apiCall<{ success: boolean; data: { agents: Agent[] } }>(
      `/api/agents/${owner}`
    );
    return response.data.agents || [];
  } catch (error) {
    console.error('Failed to get agents:', error);
    return [];
  }
}

/**
 * Register a new agent - Returns API key ONCE
 * The API key allows the agent to make payment requests
 */
export async function registerAgent(
  owner: string,
  name: string,
  privacyLevel: 'maximum' | 'shielded' | 'standard' = 'shielded',
  spendingLimits?: Partial<SpendingLimits>
): Promise<AgentWithKey> {
  console.log('[Agent] Registering:', { owner: owner.slice(0, 8), name, privacyLevel });
  
  try {
    const response = await apiCall<{ success: boolean; data: AgentWithKey; error?: string; warning?: string }>(
      '/api/agents/register',
      {
        method: 'POST',
        body: JSON.stringify({ owner, name, privacyLevel, spendingLimits }),
      }
    );
    
    console.log('[Agent] Registration response:', response);
    
    if (!response.success) {
      throw new Error(response.error || 'Registration failed');
    }
    
    return response.data;
  } catch (error: any) {
    console.error('[Agent] Registration failed:', error);
    throw error; // Re-throw instead of returning null
  }
}

/**
 * Update agent configuration
 */
export async function updateAgentConfig(
  agentId: string,
  updates: Partial<Pick<Agent, 'status' | 'privacyLevel' | 'name'>> & {
    spendingLimits?: Partial<SpendingLimits>;
  }
): Promise<Agent | null> {
  try {
    console.log('[Agent] Updating config:', { agentId, updates });
    const response = await apiCall<{ success: boolean; data: Agent }>(
      `/api/agents/${agentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(updates),
      }
    );
    return response.data;
  } catch (error) {
    console.error('Failed to update agent:', error);
    return null;
  }
}

/**
 * Delete an agent
 */
export async function deleteAgentById(agentId: string): Promise<boolean> {
  try {
    await apiCall<{ success: boolean }>(
      `/api/agents/${agentId}`,
      { method: 'DELETE' }
    );
    return true;
  } catch (error) {
    console.error('Failed to delete agent:', error);
    return false;
  }
}

/**
 * Regenerate agent API key
 */
export async function regenerateAgentKey(agentId: string): Promise<{ apiKey: string; apiKeyVisible?: string } | null> {
  try {
    const response = await apiCall<{ success: boolean; data: { apiKey: string; apiKeyPrefix?: string } }>(
      `/api/agents/${agentId}/regenerate-key`,
      { method: 'POST' }
    );
    if (!response.success || !response.data) {
      throw new Error('Failed to regenerate key');
    }
    return {
      apiKey: response.data.apiKey,
      apiKeyVisible: response.data.apiKeyPrefix ? `${response.data.apiKeyPrefix}...` : undefined,
    };
  } catch (error) {
    console.error('Failed to regenerate agent key:', error);
    throw error; // Re-throw so caller can handle it
  }
}

// ============ Agent Payments (Non-Custodial) ============

/**
 * Request a payment for an agent
 * Returns PayAI payment instructions - actual payment goes from user wallet to service provider
 */
export async function requestAgentPayment(
  agentApiKey: string,
  resource: string
): Promise<PaymentRequest | null> {
  try {
    const response = await apiCall<{ success: boolean; data: PaymentRequest }>(
      '/api/credits/agent/pay',
      {
        method: 'POST',
        headers: {
          'X-Agent-Key': agentApiKey,
        },
        body: JSON.stringify({ resource }),
      }
    );
    return response.data;
  } catch (error) {
    console.error('Failed to request agent payment:', error);
    return null;
  }
}

/**
 * Confirm a payment was made (after user signed via PayAI)
 */
export async function confirmAgentPayment(
  agentApiKey: string,
  paymentId: string,
  txSignature: string
): Promise<boolean> {
  try {
    await apiCall<{ success: boolean }>(
      '/api/credits/agent/confirm',
      {
        method: 'POST',
        headers: {
          'X-Agent-Key': agentApiKey,
        },
        body: JSON.stringify({ paymentId, txSignature }),
      }
    );
    return true;
  } catch (error) {
    console.error('Failed to confirm payment:', error);
    return false;
  }
}

// ============ Agent Stealth Functions ============

/**
 * Setup stealth pool for an agent
 */
export async function setupAgentStealth(
  agentId: string,
  fundingAmount?: string
): Promise<{ poolId: string; poolAddress: string; steps: string[] } | null> {
  try {
    console.log('[Agent] Setting up stealth for:', agentId);
    const response = await apiCall<{ success: boolean; data: any; error?: string }>(
      `/api/agents/${agentId}/stealth/setup`,
      {
        method: 'POST',
        body: JSON.stringify({ fundingAmount }),
      }
    );
    if (!response.success) throw new Error(response.error || 'Setup failed');
    return response.data;
  } catch (error) {
    console.error('[Agent] Failed to setup stealth:', error);
    throw error;
  }
}

/**
 * Link a pool wallet to an agent
 */
export async function linkAgentPool(
  agentId: string,
  poolId: string,
  poolAddress: string
): Promise<boolean> {
  try {
    console.log('[Agent] Linking pool to agent:', { agentId, poolId });
    const response = await apiCall<{ success: boolean; error?: string }>(
      `/api/agents/${agentId}/stealth/link`,
      {
        method: 'POST',
        body: JSON.stringify({ poolId, poolAddress }),
      }
    );
    if (!response.success) throw new Error(response.error || 'Link failed');
    return true;
  } catch (error) {
    console.error('[Agent] Failed to link pool:', error);
    throw error;
  }
}

/**
 * Get agent stealth settings
 */
export async function getAgentStealth(agentId: string): Promise<{
  enabled: boolean;
  poolId?: string;
  poolAddress?: string;
  balance?: { sol: number; usdc: number };
  totalPayments: number;
  totalSolRecovered: number;
} | null> {
  try {
    const response = await apiCall<{ success: boolean; data: any }>(
      `/api/agents/${agentId}/stealth`
    );
    return response.data;
  } catch (error) {
    console.error('[Agent] Failed to get stealth info:', error);
    return null;
  }
}

/**
 * Update agent stealth settings
 */
export async function updateAgentStealth(
  agentId: string,
  settings: { enabled?: boolean; fundingThreshold?: string }
): Promise<boolean> {
  try {
    const response = await apiCall<{ success: boolean; error?: string }>(
      `/api/agents/${agentId}/stealth`,
      {
        method: 'PATCH',
        body: JSON.stringify(settings),
      }
    );
    if (!response.success) throw new Error(response.error || 'Update failed');
    return true;
  } catch (error) {
    console.error('[Agent] Failed to update stealth:', error);
    throw error;
  }
}

/**
 * Link agent to main pool (use owner's pool)
 */
export async function linkAgentToMainPool(
  agentId: string,
  mainPoolId: string,
  mainPoolAddress: string
): Promise<boolean> {
  try {
    console.log('[Agent] Linking to main pool:', { agentId, mainPoolId });
    const response = await apiCall<{ success: boolean; error?: string }>(
      `/api/agents/${agentId}/stealth/use-main`,
      {
        method: 'POST',
        body: JSON.stringify({ mainPoolId, mainPoolAddress }),
      }
    );
    if (!response.success) throw new Error(response.error);
    return true;
  } catch (error) {
    console.error('[Agent] Failed to link main pool:', error);
    throw error;
  }
}

/**
 * Bundle multiple agents to one pool
 */
export async function bundleAgentsToPool(
  agentIds: string[],
  poolId: string,
  poolAddress: string,
  owner: string
): Promise<{ agentId: string; success: boolean; name?: string; error?: string }[]> {
  try {
    console.log('[Agent] Bundling agents to pool:', { agentIds, poolId });
    const response = await apiCall<{ success: boolean; data: { bundledAgents: any[] }; error?: string }>(
      '/api/agents/bundle',
      {
        method: 'POST',
        body: JSON.stringify({ agentIds, poolId, poolAddress, owner }),
      }
    );
    if (!response.success) throw new Error(response.error);
    return response.data.bundledAgents;
  } catch (error) {
    console.error('[Agent] Failed to bundle agents:', error);
    throw error;
  }
}

/**
 * Create dedicated pool for agent with FHE-encrypted private key
 * 
 * This is the secure CREATE_OWN_POOL flow:
 * 1. Generates a new Solana keypair on the backend
 * 2. Encrypts the private key with Inco FHE
 * 3. Stores only the encrypted handle (never raw key!)
 * 4. Returns pool address for funding
 */
export async function createAgentPool(
  agentId: string,
  ownerAddress: string,
  signature: string,
  message: string
): Promise<{ poolId: string; poolAddress: string; fheEncrypted: boolean } | null> {
  try {
    console.log('[Agent] Creating FHE-encrypted pool for:', agentId);
    
    // Call the new FHE-encrypted pool creation endpoint
    const response = await apiCall<{ 
      success: boolean; 
      data: { 
        agentId: string;
        poolId: string; 
        poolAddress: string; 
        fheEncrypted: boolean;
        isRealFhe: boolean;
        message: string;
      }; 
      error?: string;
    }>(
      `/api/agents/${agentId}/stealth/create-pool`,
      {
        method: 'POST',
        body: JSON.stringify({ 
          ownerSignature: signature, 
          message,
        }),
      }
    );
    
    if (!response.success) throw new Error(response.error || 'Pool creation failed');
    
    console.log(`[Agent] ✓ Pool created: ${response.data.poolAddress.slice(0, 12)}... (FHE: ${response.data.fheEncrypted ? 'YES' : 'NO'})`);
    
    return {
      poolId: response.data.poolId,
      poolAddress: response.data.poolAddress,
      fheEncrypted: response.data.fheEncrypted,
    };
  } catch (error) {
    console.error('[Agent] Failed to create agent pool:', error);
    throw error;
  }
}

/**
 * Pool Type Hierarchy (Aegix v4.0)
 * All pools are compressed via Light Protocol ZK Compression
 * 
 * LEGACY: Initial compressed pool, funded directly from wallet
 * MAIN: Agent bridge pool, funded ONLY from Legacy Pool
 * CUSTOM: Agent-specific pools, funded ONLY from Main Pool
 */
export type PoolType = 'LEGACY' | 'MAIN' | 'CUSTOM';

/**
 * Pool status - compressed pools are always ready once funded
 */
export type PoolStatus = 'SETUP' | 'READY' | 'LOW_BALANCE' | 'INACTIVE';

/**
 * Pool display interface with all metadata
 */
export interface PoolData {
  poolId: string;
  poolAddress: string;
  type: PoolType;              // Pool hierarchy type
  isMain: boolean;             // Legacy compat: true for LEGACY or MAIN
  isLegacy?: boolean;          // True only for LEGACY pool
  name: string;
  customName?: string;
  customNameHandle?: string;
  fheHandle?: string;
  agentCount: number;
  agentIds?: string[];
  balance?: { 
    sol: number; 
    usdc: number;
    compressedUsdc?: number;   // Compressed USDC balance (Light Protocol)
  } | null;
  createdAt?: string;
  status?: PoolStatus;
  lifetimeTxCount?: number;
  needsShielding?: boolean;    // True if has regular USDC but no compressed USDC
  lifetimeVolume?: number;
  // Compression info (all pools are compressed)
  compressed: boolean;
  merkleRoot?: string;
  // Funding hierarchy
  fundedFrom?: string;         // Pool address this was funded from
  canFundTo?: PoolType[];      // Which pool types this can fund
}

/**
 * Minimum balance thresholds for pool operations
 */
export const POOL_THRESHOLDS = {
  /** Minimum SOL needed for rent + operations */
  MIN_SOL_FOR_OPERATIONS: 0.003,
  /** Minimum USDC to consider pool "funded" */
  MIN_USDC_FUNDED: 0.01,
  /** Minimum SOL in Legacy to create Main Pool */
  MIN_SOL_FOR_MAIN_CREATION: 0.005,
  /** Warning threshold for low balance */
  LOW_BALANCE_USDC: 1.0,
};

/**
 * Determine pool status based on actual balance
 * NEVER returns 'SETUP' if pool has any funds
 */
function determinePoolStatus(balance?: { sol: number; usdc: number } | null): PoolStatus {
  if (!balance) return 'SETUP';
  
  const hasSol = balance.sol >= POOL_THRESHOLDS.MIN_SOL_FOR_OPERATIONS;
  const hasUsdc = balance.usdc >= POOL_THRESHOLDS.MIN_USDC_FUNDED;
  
  // If pool has ANY meaningful funds, it's ready
  if (hasSol || hasUsdc) {
    // Check for low balance warning
    if (balance.usdc < POOL_THRESHOLDS.LOW_BALANCE_USDC && balance.sol < POOL_THRESHOLDS.MIN_SOL_FOR_OPERATIONS) {
      return 'LOW_BALANCE';
    }
    return 'READY';
  }
  
  return 'SETUP';
}

/**
 * Check if Legacy Pool has sufficient funds for Main Pool creation
 */
export function canCreateMainPool(legacyPool?: PoolData): { canCreate: boolean; reason?: string; needed?: { sol?: number; usdc?: number } } {
  if (!legacyPool) {
    return { canCreate: false, reason: 'Legacy Pool not initialized' };
  }
  
  const balance = legacyPool.balance;
  if (!balance) {
    return { canCreate: false, reason: 'Legacy Pool balance unknown', needed: { sol: POOL_THRESHOLDS.MIN_SOL_FOR_MAIN_CREATION } };
  }
  
  // Need enough SOL for rent
  if (balance.sol < POOL_THRESHOLDS.MIN_SOL_FOR_MAIN_CREATION) {
    return { 
      canCreate: false, 
      reason: `Need ${POOL_THRESHOLDS.MIN_SOL_FOR_MAIN_CREATION.toFixed(4)} SOL for rent`,
      needed: { sol: POOL_THRESHOLDS.MIN_SOL_FOR_MAIN_CREATION - balance.sol }
    };
  }
  
  return { canCreate: true };
}

/**
 * Get list of all pools for an owner
 * Normalizes backend response to PoolData with proper type hierarchy
 * Uses throttled fetch to prevent 429 errors
 */
export async function getAllPools(owner: string): Promise<PoolData[]> {
  try {
    // Use throttled fetch (10s between requests, 60s cache)
    const response = await gatewayFetch<{ success: boolean; data: { pools: any[] } }>(
      `/api/agents/pools/list?owner=${owner}`,
      { cacheDuration: 30000 } // 30 second cache for pools
    );
    
    if (!response?.success) {
      // Return cached data if available
      const cached = getCached<{ success: boolean; data: { pools: any[] } }>(`/api/agents/pools/list?owner=${owner}`);
      if (cached?.data?.pools) {
        return normalizePoolsResponse(cached.data.pools);
      }
      return [];
    }
    
    return normalizePoolsResponse(response.data.pools || []);
  } catch (error) {
    console.error('Failed to get pools:', error);
    return [];
  }
}

// Helper to normalize pool data
function normalizePoolsResponse(pools: any[]): PoolData[] {
  return pools.map((pool: any): PoolData => {
    // Determine pool type from backend data
    let type: PoolType = 'CUSTOM';
    if (pool.type) {
      type = pool.type as PoolType;
    } else if (pool.isLegacy || (pool.isMain && pool.name?.toLowerCase().includes('legacy'))) {
      type = 'LEGACY';
    } else if (pool.isMain) {
      type = 'MAIN';
    }
    
    // Determine status - never show SETUP for funded pools
    const status = determinePoolStatus(pool.balance);
    
    return {
      poolId: pool.poolId,
      poolAddress: pool.poolAddress,
      type,
      isMain: type === 'LEGACY' || type === 'MAIN',
      isLegacy: type === 'LEGACY',
      name: pool.name || (type === 'LEGACY' ? 'Legacy Pool' : type === 'MAIN' ? 'Main Pool' : 'Custom Pool'),
      customName: pool.customName,
      customNameHandle: pool.customNameHandle,
      fheHandle: pool.fheHandle,
      agentCount: pool.agentCount || 0,
      agentIds: pool.agentIds,
      balance: pool.balance,
      createdAt: pool.createdAt,
      status,
      lifetimeTxCount: pool.lifetimeTxCount,
      lifetimeVolume: pool.lifetimeVolume,
      compressed: true, // All pools are compressed in v4.0
      merkleRoot: pool.merkleRoot,
      fundedFrom: pool.fundedFrom,
      canFundTo: type === 'LEGACY' ? ['MAIN'] : type === 'MAIN' ? ['CUSTOM'] : undefined,
    };
  });
}

/**
 * Shield (compress) USDC tokens for compressed payments
 * Converts regular USDC to compressed state via Light Protocol
 * Uses x402 gasless flow for seamless UX
 */
export async function shieldFunds(
  poolId: string,
  amountUsdc: string,
  owner: string
): Promise<{ 
  success: boolean; 
  requiresPayment?: boolean;
  paymentRequired?: any;
  txSignature?: string; 
  error?: string;
  compressedBalance?: string;
}> {
  try {
    console.log('[Shield] Compressing USDC:', { poolId, amountUsdc, owner });
    
    const response = await apiCall<{ 
      success: boolean;
      requiresPayment?: boolean;
      paymentRequired?: any;
      data?: { 
        txSignature?: string;
        transaction?: string; // Unsigned transaction for wallet signing
        compressedBalance?: string;
      }; 
      error?: string;
    }>(
      '/api/credits/pool/shield',
      {
        method: 'POST',
        body: JSON.stringify({ 
          poolId, 
          amountUsdc, 
          owner,
        }),
      }
    );
    
    if (!response.success) {
      return { 
        success: false, 
        error: response.error || 'Failed to shield funds' 
      };
    }
    
    // x402 Payment Required response
    if (response.requiresPayment && response.paymentRequired) {
      return {
        success: false,
        requiresPayment: true,
        paymentRequired: response.paymentRequired,
      };
    }
    
    return { 
      success: true, 
      txSignature: response.data?.txSignature,
      compressedBalance: response.data?.compressedBalance,
    };
  } catch (error: any) {
    console.error('[Shield] Failed to shield funds:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to shield funds' 
    };
  }
}

/**
 * Transfer funds between pools or wallet
 * Supports hierarchy-validated transfers and wallet deposits/withdrawals
 */
export async function transferFunds(
  sourceId: string,
  targetId: string,
  amountUsdc: string,
  owner: string,
  signature: string,
  message: string,
  isWalletSource: boolean = false,
  isWalletTarget: boolean = false
): Promise<{ success: boolean; txSignature?: string; error?: string }> {
  try {
    console.log('[Transfer] Transferring funds:', { sourceId, targetId, amountUsdc, isWalletSource, isWalletTarget });
    
    const response = await apiCall<{ 
      success: boolean; 
      data?: { 
        txSignature?: string;
        transaction?: string; // For wallet txs that need signing
      }; 
      error?: string;
    }>(
      '/api/credits/pool/transfer',
      {
        method: 'POST',
        body: JSON.stringify({ 
          sourceId, 
          targetId, 
          amountUsdc, 
          owner, 
          signature, 
          message,
          isWalletSource,
          isWalletTarget
        }),
      }
    );
    
    if (!response.success) {
      throw new Error(response.error || 'Transfer failed');
    }
    
    return {
      success: true,
      txSignature: response.data?.txSignature,
    };
  } catch (error: any) {
    console.error('Failed to transfer funds:', error);
    throw error;
  }
}

/**
 * Refresh pool balance from on-chain
 * Forces a fresh balance check bypassing any cache
 */
export async function refreshPoolBalance(poolAddress: string): Promise<{ sol: number; usdc: number } | null> {
  try {
    const response = await apiCall<{ success: boolean; data: { balance: { sol: number; usdc: number } } }>(
      `/api/credits/pool/balance?address=${poolAddress}&refresh=true`
    );
    return response.data.balance;
  } catch (error) {
    console.error('Failed to refresh pool balance:', error);
    return null;
  }
}

/**
 * Get the Legacy pool (initial compressed pool)
 */
export function getLegacyPool(pools: PoolData[]): PoolData | undefined {
  return pools.find(p => p.type === 'LEGACY');
}

/**
 * Get the Main pool (agent bridge)
 */
export function getMainPool(pools: PoolData[]): PoolData | undefined {
  return pools.find(p => p.type === 'MAIN');
}

/**
 * Get all Custom pools
 */
export function getCustomPools(pools: PoolData[]): PoolData[] {
  return pools.filter(p => p.type === 'CUSTOM');
}

/**
 * Validate funding hierarchy
 * Returns error message if invalid, null if valid
 */
export function validateFundingHierarchy(sourceType: PoolType, targetType: PoolType): string | null {
  if (sourceType === 'LEGACY' && targetType !== 'MAIN') {
    return 'Legacy Pool can only fund the Main Pool';
  }
  if (sourceType === 'MAIN' && targetType !== 'CUSTOM') {
    return 'Main Pool can only fund Custom Pools';
  }
  if (sourceType === 'CUSTOM') {
    return 'Custom Pools cannot fund other pools';
  }
  return null;
}

/**
 * Create or get the Main Pool (agent bridge)
 * Auto-created on first agent need if not exists
 */
export async function getOrCreateMainPool(
  owner: string,
  signature: string,
  message: string
): Promise<{ 
  poolId: string; 
  poolAddress: string;
  created: boolean;
  existed?: boolean;
  transaction?: string;
  rentRequired?: number;
}> {
  try {
    console.log('[Pool] Getting/Creating Main Pool for:', owner.slice(0, 8));
    const response = await apiCall<{ 
      success: boolean; 
      data: { 
        poolId: string; 
        poolAddress: string;
        created: boolean;
        existed?: boolean;
        transaction?: string;
        rentRequired?: number;
      }; 
      error?: string;
    }>(
      '/api/credits/pool/main',
      {
        method: 'POST',
        body: JSON.stringify({ owner, signature, message }),
      }
    );
    
    if (!response.success) throw new Error(response.error || 'Failed to get/create Main Pool');
    
    // Normalize response: if not created, it existed
    return {
      ...response.data,
      existed: !response.data.created,
    };
  } catch (error) {
    console.error('Failed to get/create Main Pool:', error);
    throw error;
  }
}

/**
 * Fund a pool from another pool (hierarchy-validated)
 * LEGACY → MAIN only
 * MAIN → CUSTOM only
 */
export async function fundPoolFromPool(
  sourcePoolId: string,
  targetPoolId: string,
  amountUsdc: string,
  owner: string,
  signature: string
): Promise<{
  success: boolean;
  txSignature: string;
  newSourceBalance: number;
  newTargetBalance: number;
}> {
  try {
    console.log('[Pool] Funding pool:', { source: sourcePoolId.slice(0, 8), target: targetPoolId.slice(0, 8), amount: amountUsdc });
    const response = await apiCall<{ 
      success: boolean; 
      data: {
        txSignature: string;
        newSourceBalance: number;
        newTargetBalance: number;
      };
      error?: string;
    }>(
      '/api/credits/pool/fund-pool',
      {
        method: 'POST',
        body: JSON.stringify({ 
          sourcePoolId, 
          targetPoolId, 
          amountUsdc,
          owner,
          signature,
        }),
      }
    );
    
    if (!response.success) throw new Error(response.error || 'Funding failed');
    return {
      success: true,
      ...response.data,
    };
  } catch (error: any) {
    console.error('Failed to fund pool:', error);
    throw new Error(error.message || 'Failed to fund pool');
  }
}

/**
 * Assign agent to a specific pool
 * Agents can only be assigned to MAIN or CUSTOM pools (never LEGACY)
 */
export async function assignAgentToPool(
  agentId: string,
  poolId: string,
  poolAddress: string
): Promise<boolean> {
  try {
    const response = await apiCall<{ success: boolean; error?: string }>(
      `/api/agents/${agentId}/stealth/assign-pool`,
      {
        method: 'POST',
        body: JSON.stringify({ poolId, poolAddress }),
      }
    );
    if (!response.success) throw new Error(response.error);
    return true;
  } catch (error) {
    console.error('Failed to assign agent to pool:', error);
    throw error;
  }
}

/**
 * Unlink agent from its assigned pool
 * Clears poolId, poolAddress, and disables stealth for the agent
 */
export async function unlinkAgentPool(agentId: string): Promise<boolean> {
  try {
    console.log('[Agent] Unlinking pool from agent:', agentId);
    const response = await apiCall<{ success: boolean; error?: string }>(
      `/api/agents/${agentId}/stealth/unlink`,
      { method: 'POST' }
    );
    if (!response.success) throw new Error(response.error || 'Unlink failed');
    return true;
  } catch (error) {
    console.error('Failed to unlink agent pool:', error);
    throw error;
  }
}

/**
 * Create a custom stealth pool - Step 1: Get transaction
 * Returns a transaction that must be signed by the user
 * 
 * @param owner - Wallet address of the owner
 * @param signature - Base64 encoded signature of the message
 * @param message - The signed message
 */
export async function createCustomPool(
  owner: string,
  signature: string,
  message: string
): Promise<{ 
  poolId: string; 
  poolAddress: string; 
  transaction: string;
  rentRequired: number;
  fheEncrypted: boolean;
}> {
  try {
    console.log('[Pool] Creating custom pool for:', owner.slice(0, 8));
    const response = await apiCall<{ 
      success: boolean; 
      data: { 
        poolId: string; 
        poolAddress: string; 
        transaction: string;
        rentRequired: number;
        fheEncrypted: boolean;
      }; 
      error?: string;
    }>(
      '/api/credits/pool/create-custom',
      {
        method: 'POST',
        body: JSON.stringify({ owner, signature, message }),
      }
    );
    
    if (!response.success) throw new Error(response.error || 'Pool creation failed');
    
    console.log(`[Pool] ✓ Pool transaction prepared: ${response.data.poolAddress.slice(0, 12)}...`);
    return response.data;
  } catch (error) {
    console.error('Failed to create custom pool:', error);
    throw error;
  }
}

/**
 * Confirm custom pool creation - Step 2: After user signs and broadcasts
 * 
 * @param poolId - Pool ID from step 1
 * @param txSignature - Transaction signature after broadcasting
 * @param owner - Wallet address of the owner
 */
export async function confirmCustomPool(
  poolId: string,
  txSignature: string,
  owner: string
): Promise<{ poolId: string; poolAddress: string; status: string }> {
  try {
    console.log('[Pool] Confirming custom pool:', poolId);
    const response = await apiCall<{ 
      success: boolean; 
      data: { 
        poolId: string; 
        poolAddress: string;
        status: string;
      }; 
      error?: string;
    }>(
      '/api/credits/pool/confirm-custom',
      {
        method: 'POST',
        body: JSON.stringify({ poolId, txSignature, owner }),
      }
    );
    
    if (!response.success) throw new Error(response.error || 'Pool confirmation failed');
    
    console.log(`[Pool] ✓ Custom pool confirmed: ${response.data.poolAddress.slice(0, 12)}...`);
    return response.data;
  } catch (error) {
    console.error('Failed to confirm custom pool:', error);
    throw error;
  }
}

// =============================================================================
// ADVANCED POOL MANAGEMENT (Infrastructure Shield)
// =============================================================================

/**
 * Delete a custom pool (PROTECTED: Main pool cannot be deleted)
 * Returns 403 Forbidden if attempting to delete main pool
 */
export async function deletePool(
  poolId: string,
  owner: string,
  signature?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[Pool] Attempting to delete pool:', poolId);
    const response = await apiCall<{ 
      success: boolean; 
      data?: { poolId: string; message: string };
      error?: string;
      code?: string;
    }>(
      `/api/agents/pools/${poolId}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ owner, signature }),
      }
    );
    
    if (!response.success) {
      // Special handling for Main Pool protection
      if (response.code === 'IMMUTABLE_ROOT') {
        console.error('[Pool] ⛔ BLOCKED: Cannot delete main pool');
      }
      throw new Error(response.error || 'Delete failed');
    }
    
    console.log(`[Pool] ✓ Pool deleted: ${poolId}`);
    return { success: true };
  } catch (error: any) {
    console.error('Failed to delete pool:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update pool custom name (FHE-encrypted)
 */
export async function updatePoolName(
  poolId: string,
  owner: string,
  customName: string
): Promise<{ success: boolean; customNameHandle?: string; error?: string }> {
  try {
    console.log('[Pool] Updating name for pool:', poolId);
    const response = await apiCall<{ 
      success: boolean; 
      data?: { poolId: string; customName: string; customNameHandle: string };
      error?: string;
    }>(
      `/api/agents/pools/${poolId}/update-name`,
      {
        method: 'POST',
        body: JSON.stringify({ owner, customName }),
      }
    );
    
    if (!response.success) throw new Error(response.error || 'Update name failed');
    
    console.log(`[Pool] ✓ Name updated: "${customName}"`);
    return { success: true, customNameHandle: response.data?.customNameHandle };
  } catch (error: any) {
    console.error('Failed to update pool name:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Export pool private key - RAW 64-byte Solana secretKey in Base58
 * SECURITY: Key expires in 60s, must be cleared from memory after use
 * 
 * Returns Base58-encoded secretKey compatible with Phantom/Solflare import
 */
export async function exportPoolKey(
  poolId: string,
  owner: string,
  signature: string,
  message: string
): Promise<{ 
  success: boolean; 
  privateKeyBase58?: string;
  publicKey?: string;
  poolAddress?: string;
  format?: string;
  importGuide?: string;
  expiresInMs?: number;
  error?: string;
}> {
  try {
    console.log('[Pool] ⚠️ SENSITIVE: Exporting key for pool:', poolId);
    const response = await apiCall<{ 
      success: boolean; 
      data?: { 
        poolId: string;
        poolAddress: string;
        privateKeyBase58: string;
        publicKey: string;
        format: string;
        importGuide: string;
        warning: string;
        expiresInMs: number;
      };
      error?: string;
    }>(
      `/api/agents/pools/${poolId}/export-key`,
      {
        method: 'POST',
        body: JSON.stringify({ owner, signature, message }),
      }
    );
    
    if (!response.success) throw new Error(response.error || 'Export key failed');
    
    return { 
      success: true, 
      privateKeyBase58: response.data?.privateKeyBase58,
      publicKey: response.data?.publicKey,
      poolAddress: response.data?.poolAddress,
      format: response.data?.format,
      importGuide: response.data?.importGuide,
      expiresInMs: response.data?.expiresInMs || 60000,
    };
  } catch (error: any) {
    console.error('Failed to export pool key:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get pool statistics from audit logs
 */
export async function getPoolStats(
  poolId: string,
  owner: string
): Promise<{ 
  lifetimeTxCount: number; 
  lifetimeVolume: number;
  last24hTxCount: number;
  recentTransactions: Array<{
    type: string;
    amount: string;
    timestamp: string;
    txSignature?: string;
  }>;
}> {
  try {
    const response = await apiCall<{ 
      success: boolean; 
      data: { 
        poolId: string;
        lifetimeTxCount: number;
        lifetimeVolume: number;
        last24hTxCount: number;
        recentTransactions: any[];
      };
      error?: string;
    }>(
      `/api/agents/pools/${poolId}/stats?owner=${owner}`
    );
    
    if (!response.success) throw new Error(response.error || 'Get stats failed');
    
    return {
      lifetimeTxCount: response.data.lifetimeTxCount,
      lifetimeVolume: response.data.lifetimeVolume,
      last24hTxCount: response.data.last24hTxCount,
      recentTransactions: response.data.recentTransactions || [],
    };
  } catch (error) {
    console.error('Failed to get pool stats:', error);
    return {
      lifetimeTxCount: 0,
      lifetimeVolume: 0,
      last24hTxCount: 0,
      recentTransactions: [],
    };
  }
}

/**
 * Unlink agent from pool (pool-level management)
 * Requires wallet signature for security
 */
export async function unlinkAgentFromPool(
  poolId: string,
  owner: string,
  agentId: string,
  signature?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[Pool] Unlinking agent from pool:', agentId, poolId);
    const response = await apiCall<{ 
      success: boolean; 
      data?: { poolId: string; agentId: string; message: string };
      error?: string;
    }>(
      `/api/agents/pools/${poolId}/unlink-agent`,
      {
        method: 'POST',
        body: JSON.stringify({ owner, agentId, signature }),
      }
    );
    
    if (!response.success) throw new Error(response.error || 'Unlink failed');
    
    console.log(`[Pool] ✓ Agent ${agentId} unlinked from pool ${poolId}`);
    return { success: true };
  } catch (error: any) {
    console.error('Failed to unlink agent from pool:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update agent budget from pool view (pool-level management)
 */
export async function updateAgentBudgetFromPool(
  poolId: string,
  owner: string,
  agentId: string,
  maxPerTransaction?: number,
  dailyLimit?: number
): Promise<{ success: boolean; spendingLimits?: SpendingLimits; error?: string }> {
  try {
    console.log('[Pool] Updating budget for agent:', agentId);
    const response = await apiCall<{ 
      success: boolean; 
      data?: { 
        poolId: string; 
        agentId: string; 
        spendingLimits: SpendingLimits;
        message: string;
      };
      error?: string;
    }>(
      `/api/agents/pools/${poolId}/update-agent-budget`,
      {
        method: 'POST',
        body: JSON.stringify({ owner, agentId, maxPerTransaction, dailyLimit }),
      }
    );
    
    if (!response.success) throw new Error(response.error || 'Update budget failed');
    
    console.log(`[Pool] ✓ Budget updated for agent ${agentId}`);
    return { success: true, spendingLimits: response.data?.spendingLimits };
  } catch (error: any) {
    console.error('Failed to update agent budget:', error);
    return { success: false, error: error.message };
  }
}

// =============================================================================
// LIGHT PROTOCOL API FUNCTIONS (Aegix 4.0)
// =============================================================================

/**
 * Create a Light Protocol session for an agent
 * Owner signs message to grant autonomous spending authority
 */
export async function createLightSession(
  agentId: string,
  ownerSignature: string,
  message: string,
  limits?: { maxPerTransaction?: string; dailyLimit?: string },
  durationHours?: number
): Promise<{
  success: boolean;
  sessionPublicKey?: string;
  poolAddress?: string;
  expiresAt?: string;
  error?: string;
}> {
  try {
    console.log('[Light] Creating session for agent:', agentId);
    const response = await apiCall<{
      success: boolean;
      data?: {
        agentId: string;
        sessionPublicKey: string;
        poolAddress: string;
        expiresAt: string;
        limits: any;
      };
      error?: string;
    }>(
      `/api/agents/${agentId}/light/create-session`,
      {
        method: 'POST',
        body: JSON.stringify({ ownerSignature, message, limits, durationHours }),
      }
    );

    if (!response.success) throw new Error(response.error || 'Create session failed');

    console.log(`[Light] ✓ Session created: ${response.data?.sessionPublicKey?.slice(0, 12)}...`);
    return {
      success: true,
      sessionPublicKey: response.data?.sessionPublicKey,
      poolAddress: response.data?.poolAddress,
      expiresAt: response.data?.expiresAt,
    };
  } catch (error: any) {
    console.error('Failed to create Light session:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get transaction to fund agent's Light compressed pool
 */
export async function fundLightPool(
  agentId: string,
  amount: number
): Promise<{
  success: boolean;
  transaction?: string;
  poolAddress?: string;
  error?: string;
}> {
  try {
    console.log('[Light] Funding pool for agent:', agentId, 'amount:', amount);
    const response = await apiCall<{
      success: boolean;
      data?: {
        agentId: string;
        poolAddress: string;
        amount: number;
        transaction: string;
      };
      error?: string;
    }>(
      `/api/agents/${agentId}/light/fund-pool`,
      {
        method: 'POST',
        body: JSON.stringify({ amount }),
      }
    );

    if (!response.success) throw new Error(response.error || 'Fund pool failed');

    return {
      success: true,
      transaction: response.data?.transaction,
      poolAddress: response.data?.poolAddress,
    };
  } catch (error: any) {
    console.error('Failed to fund Light pool:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Revoke agent's Light Protocol session
 */
export async function revokeLightSession(
  agentId: string,
  ownerSignature: string,
  message: string,
  sweepFunds?: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[Light] Revoking session for agent:', agentId);
    const response = await apiCall<{
      success: boolean;
      data?: {
        agentId: string;
        revokedAt: string;
        status: string;
      };
      error?: string;
    }>(
      `/api/agents/${agentId}/light/revoke-session`,
      {
        method: 'POST',
        body: JSON.stringify({ ownerSignature, message, sweepFunds }),
      }
    );

    if (!response.success) throw new Error(response.error || 'Revoke session failed');

    console.log(`[Light] ✓ Session revoked for agent ${agentId}`);
    return { success: true };
  } catch (error: any) {
    console.error('Failed to revoke Light session:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get Light Protocol session status and pool balance
 */
export async function getLightStatus(
  agentId: string
): Promise<LightSessionStatus | null> {
  try {
    console.log('[Light] Getting status for agent:', agentId);
    const response = await apiCall<{
      success: boolean;
      data?: LightSessionStatus;
      error?: string;
    }>(
      `/api/agents/${agentId}/light/status`
    );

    if (!response.success) throw new Error(response.error || 'Get status failed');

    return response.data || null;
  } catch (error: any) {
    console.error('Failed to get Light status:', error);
    return null;
  }
}

/**
 * Get Light Protocol health status
 */
export async function getLightHealth(): Promise<{
  healthy: boolean;
  slot?: number;
  error?: string;
  features?: string[];
}> {
  try {
    const response = await apiCall<{
      success: boolean;
      data?: {
        healthy: boolean;
        slot?: number;
        error?: string;
        features?: {
          compressedAccounts: boolean;
          compressedTokens: boolean;
          sessionKeys: boolean;
          gaslessPayments: boolean;
        };
      };
    }>(
      `/api/agents/light/health`
    );

    if (!response.success) {
      return { healthy: false };
    }

    return {
      healthy: response.data?.healthy || false,
      slot: response.data?.slot,
      error: response.data?.error,
      features: response.data?.features 
        ? Object.entries(response.data.features)
            .filter(([_, v]) => v)
            .map(([k]) => k)
        : undefined,
    };
  } catch (error: any) {
    console.error('Failed to get Light health:', error);
    return { healthy: false, error: error.message };
  }
}

/**
 * Get cost estimate for Light vs legacy payments
 */
export async function getLightCostEstimate(
  numPayments?: number
): Promise<LightCostEstimate | null> {
  try {
    const query = numPayments ? `?numPayments=${numPayments}` : '';
    const response = await apiCall<{
      success: boolean;
      data?: LightCostEstimate;
    }>(
      `/api/credits/light/estimate${query}`
    );

    return response.data || null;
  } catch (error) {
    console.error('Failed to get Light cost estimate:', error);
    return null;
  }
}

// Export gateway URL for reference
export { GATEWAY_URL };
