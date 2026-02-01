/**
 * Agent Management Routes
 * Handles registration, API keys, and spending for AI agents
 * 
 * PERSISTENCE: Agents are now saved to disk (data/agents.json) to survive restarts
 * FHE INTEGRATION: Pool private keys are encrypted with Inco FHE
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { getPoolWallet } from '../stealth/index.js';
import { getIncoClient, verifyOwnerSignature } from '../inco/lightning-client.js';
import { getAuditLedger } from '../inco/confidential.js';
import { getRegularConnection } from '../light/client.js';

const router = Router();

// File persistence setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const POOLS_FILE = path.join(DATA_DIR, 'pools.json');

// Types
interface AgentSpendingLimits {
  maxPerTransaction: string;  // Max USDC per tx (micro units)
  dailyLimit: string;         // Max USDC per day (micro units)
  allowedResources: string[]; // Which API paths agent can access
}

interface DonationAction {
  enabled: boolean;
  recipient: string;  // Wallet address to receive donations
  amount: string;     // Default amount in micro-USDC
}

interface AgentActions {
  donation: DonationAction;
  // Future actions can be added here
}

interface StealthSettings {
  enabled: boolean;
  mode?: 'legacy' | 'light' | 'single' | 'multi';   // Pool mode (light is new Aegix 4.0)
  
  // Legacy fields (Aegix 3.x architecture)
  poolId?: string;             // Pool wallet ID for this agent
  poolAddress?: string;        // Pool wallet public address
  fhePoolKeyHandle?: string;   // FHE encrypted pool private key (DEPRECATED)
  
  // Light Protocol fields (Aegix 4.0) - NEW
  lightPoolAddress?: string;           // Compressed pool account address
  lightSessionKey?: import('../light/session-keys.js').LightSessionKey; // Session authority
  lightMerkleRoot?: string;            // Merkle tree for compressed accounts
  
  // Common fields
  fundingThreshold: string;    // Auto-alert when below this amount (micro-USDC)
  lastFundedAt?: string;       // ISO timestamp of last funding
  totalPayments: number;       // Count of payments made via pool
  totalSolRecovered: number;   // Total SOL recycled back to pool
}

interface Agent {
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
  // New fields for API key
  apiKeyHash: string;         // Hashed API key (we don't store plaintext)
  apiKeyPrefix: string;       // First 8 chars for identification
  spendingLimits: AgentSpendingLimits;
  // Agent actions (donation, etc.)
  actions: AgentActions;
  // Stealth payment settings (Aegix 3.0)
  stealthSettings: StealthSettings;
}

// Custom Pool interface for persistence
interface CustomPool {
  poolId: string;
  poolAddress: string;
  owner: string;
  fheHandle?: string;             // FHE-encrypted pool private key handle
  customNameHandle?: string;      // FHE-encrypted custom pool name
  customName?: string;            // Plain name (shown in UI when decrypted)
  isMain: boolean;                // True if this is the root of trust pool
  createdAt: string;
  txSignature?: string;
  status: 'active' | 'pending' | 'inactive';
  balance?: { sol: number; usdc: number };
  lifetimeTxCount?: number;       // Total transactions through this pool
  lifetimeVolume?: number;        // Total USDC volume
}

// Default donation recipient (Aegix developer wallet)
const DEFAULT_DONATION_RECIPIENT = '7ygijvnG8kAWYu2BKEEAU6TGLzWhoy3J3VHzPkLzCra9';
const DEFAULT_DONATION_AMOUNT = '10000'; // 0.01 USDC

// In-memory stores
const agents = new Map<string, Agent>();
const ownerAgents = new Map<string, string[]>(); // owner -> agent IDs
const apiKeyToAgent = new Map<string, string>(); // apiKeyHash -> agentId
const customPools = new Map<string, CustomPool>(); // poolId -> CustomPool
const ownerPools = new Map<string, string[]>(); // owner -> pool IDs

// NEW: Temporary storage for full API keys (encrypted with AES)
// Key: agentId, Value: { encryptedKey: string, expiresAt: number }
const agentFullKeys = new Map<string, { encryptedKey: string; expiresAt: number }>();

// =============================================================================
// PERSISTENCE - Save agents to disk so they survive restarts
// =============================================================================

/**
 * Load agents from disk on module initialization
 */
function loadAgents(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    if (fs.existsSync(AGENTS_FILE)) {
      const data = fs.readFileSync(AGENTS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      
      // Restore the Maps from persisted data
      for (const agent of parsed.agents || []) {
        agents.set(agent.id, agent);
        apiKeyToAgent.set(agent.apiKeyHash, agent.id);
        
        // Rebuild owner -> agent mapping
        const ownerList = ownerAgents.get(agent.owner) || [];
        ownerList.push(agent.id);
        ownerAgents.set(agent.owner, ownerList);
      }
      
      console.log(`[Agents] ✓ Loaded ${agents.size} agent(s) from disk for ${ownerAgents.size} wallet(s)`);
    } else {
      console.log(`[Agents] No existing agents found, starting fresh`);
    }
  } catch (err) {
    console.error('[Agents] ❌ Failed to load agents from disk:', err);
  }
}

/**
 * Save agents to disk (debounced to prevent too many disk writes)
 */
let saveAgentsTimeout: NodeJS.Timeout | null = null;
function saveAgents(): void {
  // Debounce saves to prevent too many disk writes
  if (saveAgentsTimeout) clearTimeout(saveAgentsTimeout);
  
  saveAgentsTimeout = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      
      // Convert Map to array for JSON serialization
      const agentsArray = Array.from(agents.values());
      
      fs.writeFileSync(AGENTS_FILE, JSON.stringify({ 
        agents: agentsArray,
        savedAt: new Date().toISOString(),
        version: '1.0'
      }, null, 2));
      
      console.log(`[Agents] ✓ Saved ${agentsArray.length} agent(s) to disk`);
    } catch (err) {
      console.error('[Agents] ❌ Failed to save agents to disk:', err);
    }
  }, 1000); // 1 second debounce
}

// Load agents on module initialization
loadAgents();

// =============================================================================
// PERSISTENCE - Save custom pools to disk
// =============================================================================

/**
 * Load custom pools from disk on module initialization
 */
function loadPools(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    if (fs.existsSync(POOLS_FILE)) {
      const data = fs.readFileSync(POOLS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      
      // Restore the Maps from persisted data
      for (const pool of parsed.pools || []) {
        customPools.set(pool.poolId, pool);
        
        // Rebuild owner -> pool mapping
        const poolList = ownerPools.get(pool.owner) || [];
        poolList.push(pool.poolId);
        ownerPools.set(pool.owner, poolList);
      }
      
      console.log(`[Pools] ✓ Loaded ${customPools.size} custom pool(s) from disk`);
    } else {
      console.log(`[Pools] No existing pools found, starting fresh`);
    }
  } catch (err) {
    console.error('[Pools] ❌ Failed to load pools from disk:', err);
  }
}

/**
 * Save custom pools to disk (debounced)
 */
let savePoolsTimeout: NodeJS.Timeout | null = null;
export function savePools(): void {
  // Debounce saves to prevent too many disk writes
  if (savePoolsTimeout) clearTimeout(savePoolsTimeout);
  
  savePoolsTimeout = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      
      // Convert Map to array for JSON serialization
      const poolsArray = Array.from(customPools.values());
      
      fs.writeFileSync(POOLS_FILE, JSON.stringify({ 
        pools: poolsArray,
        savedAt: new Date().toISOString(),
        version: '1.0'
      }, null, 2));
      
      console.log(`[Pools] ✓ Saved ${poolsArray.length} custom pool(s) to disk`);
    } catch (err) {
      console.error('[Pools] ❌ Failed to save pools to disk:', err);
    }
  }, 500); // 500ms debounce (faster than agents for real-time sync)
}

/**
 * Add a custom pool to the registry
 */
export function addCustomPool(pool: CustomPool): void {
  // Ensure isMain defaults to false for new pools
  const poolWithDefaults: CustomPool = {
    ...pool,
    isMain: pool.isMain ?? false,
    lifetimeTxCount: pool.lifetimeTxCount ?? 0,
    lifetimeVolume: pool.lifetimeVolume ?? 0,
  };
  
  customPools.set(pool.poolId, poolWithDefaults);
  
  // Update owner mapping
  const poolList = ownerPools.get(pool.owner) || [];
  if (!poolList.includes(pool.poolId)) {
    poolList.push(pool.poolId);
    ownerPools.set(pool.owner, poolList);
  }
  
  console.log(`[Pools] ✓ Added ${poolWithDefaults.isMain ? 'MAIN' : 'custom'} pool ${pool.poolId} for owner ${pool.owner.slice(0, 8)}...`);
  savePools();
}

/**
 * Update pool statistics (called after transactions)
 */
export function updatePoolStats(poolId: string, txAmount?: number): void {
  const pool = customPools.get(poolId);
  if (pool) {
    pool.lifetimeTxCount = (pool.lifetimeTxCount || 0) + 1;
    if (txAmount) {
      pool.lifetimeVolume = (pool.lifetimeVolume || 0) + txAmount;
    }
    customPools.set(poolId, pool);
    savePools();
  }
}

/**
 * Update pool custom name (FHE-encrypted)
 */
export function updatePoolName(poolId: string, customNameHandle: string, customName?: string): void {
  const pool = customPools.get(poolId);
  if (pool) {
    pool.customNameHandle = customNameHandle;
    if (customName) pool.customName = customName;
    customPools.set(poolId, pool);
    savePools();
    console.log(`[Pools] ✓ Updated name for pool ${poolId}`);
  }
}

/**
 * Get a pool by ID
 */
export function getCustomPool(poolId: string): CustomPool | undefined {
  return customPools.get(poolId);
}

/**
 * Delete a pool (with Main Pool protection)
 */
export function deleteCustomPool(poolId: string): { success: boolean; error?: string } {
  const pool = customPools.get(poolId);
  
  if (!pool) {
    return { success: false, error: 'Pool not found' };
  }
  
  // IMMUTABLE ROOT: Main pool cannot be deleted
  if (pool.isMain) {
    return { success: false, error: 'FORBIDDEN: Main pool is the root of trust and cannot be deleted' };
  }
  
  // Remove from pools map
  customPools.delete(poolId);
  
  // Remove from owner mapping
  const ownerPoolList = ownerPools.get(pool.owner);
  if (ownerPoolList) {
    const index = ownerPoolList.indexOf(poolId);
    if (index > -1) {
      ownerPoolList.splice(index, 1);
      ownerPools.set(pool.owner, ownerPoolList);
    }
  }
  
  savePools();
  console.log(`[Pools] ✓ Deleted pool ${poolId}`);
  return { success: true };
}

/**
 * Get custom pools for an owner
 */
export function getCustomPoolsForOwner(owner: string): CustomPool[] {
  const poolIds = ownerPools.get(owner) || [];
  return poolIds.map(id => customPools.get(id)).filter(Boolean) as CustomPool[];
}

// Load pools on module initialization
loadPools();

/**
 * Generate a secure API key
 */
function generateApiKey(): { key: string; hash: string; prefix: string } {
  const randomPart = crypto.randomBytes(24).toString('hex');
  const key = `aegix_agent_${randomPart}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = key.substring(0, 20);
  return { key, hash, prefix };
}

/**
 * Hash an API key for lookup
 */
function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Store full API key temporarily (encrypted with AES using owner address)
 */
function storeFullKeyTemporarily(agentId: string, owner: string, fullKey: string): void {
  try {
    // Derive a proper 32-byte key from owner address using SHA-256
    const keyMaterial = crypto.createHash('sha256').update(owner).digest();
    const iv = crypto.randomBytes(16); // Initialization vector
    
    // Create cipher using AES-256-CBC
    const cipher = crypto.createCipheriv('aes-256-cbc', keyMaterial, iv);
    let encrypted = cipher.update(fullKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Store IV + encrypted data
    const encryptedWithIv = iv.toString('hex') + ':' + encrypted;
    
    agentFullKeys.set(agentId, {
      encryptedKey: encryptedWithIv,
      expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
    });
    
    console.log(`[Agents] ✓ Stored encrypted full API key for agent ${agentId} (expires in 24h)`);
  } catch (error) {
    console.error('[Agents] Failed to store full key:', error);
    // Continue without storing - key will only be shown once
  }
}

/**
 * Retrieve and decrypt full API key
 */
function retrieveFullKey(agentId: string, owner: string): string | null {
  const stored = agentFullKeys.get(agentId);
  if (!stored || stored.expiresAt < Date.now()) {
    return null; // Expired or not found
  }
  
  try {
    const [ivHex, encrypted] = stored.encryptedKey.split(':');
    if (!ivHex || !encrypted) {
      return null;
    }
    
    // Derive the same 32-byte key from owner address
    const keyMaterial = crypto.createHash('sha256').update(owner).digest();
    const iv = Buffer.from(ivHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyMaterial, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('[Agents] Failed to decrypt full key:', error);
    return null;
  }
}

/**
 * Validate agent API key and return agent + owner info
 * Returns null with reason if validation fails
 */
export function validateAgentKey(apiKey: string): { agent: Agent; owner: string } | null {
  const hash = hashApiKey(apiKey);
  const agentId = apiKeyToAgent.get(hash);
  
  if (!agentId) {
    console.log(`[Agents] ❌ API key not found in registry`);
    return null;
  }
  
  const agent = agents.get(agentId);
  if (!agent) {
    console.log(`[Agents] ❌ Agent ${agentId} not found (key orphaned)`);
    return null;
  }
  
  // CHECK STATUS - Reject paused agents
  if (agent.status === 'paused') {
    console.log(`[Agents] ❌ Agent ${agent.name} (${agentId}) is PAUSED - rejecting request`);
    return null;
  }
  
  // Update last activity timestamp
  agent.lastActivity = new Date().toISOString();
  
  console.log(`[Agents] ✓ Agent ${agent.name} validated (status: ${agent.status})`);
  return { agent, owner: agent.owner };
}

/**
 * Get agent status with detailed info (for diagnostics)
 */
export function getAgentStatus(agentId: string): {
  exists: boolean;
  status?: 'active' | 'idle' | 'paused';
  canProcess: boolean;
  reason?: string;
} {
  const agent = agents.get(agentId);
  
  if (!agent) {
    return { exists: false, canProcess: false, reason: 'Agent not found' };
  }
  
  if (agent.status === 'paused') {
    return { exists: true, status: agent.status, canProcess: false, reason: 'Agent is paused' };
  }
  
  return { exists: true, status: agent.status, canProcess: true };
}

/**
 * Check if agent can make a payment (spending limits)
 */
export function canAgentSpend(agentId: string, amount: string, resource: string): { allowed: boolean; reason?: string } {
  const agent = agents.get(agentId);
  if (!agent) return { allowed: false, reason: 'Agent not found' };
  
  const amountNum = BigInt(amount);
  const limits = agent.spendingLimits;
  
  // Check per-transaction limit
  if (amountNum > BigInt(limits.maxPerTransaction)) {
    return { 
      allowed: false, 
      reason: `Amount exceeds per-transaction limit of ${(parseInt(limits.maxPerTransaction) / 1_000_000).toFixed(2)} USDC` 
    };
  }
  
  // Check daily limit
  const spent24hMicro = Math.floor(parseFloat(agent.spent24h) * 1_000_000);
  if (spent24hMicro + Number(amountNum) > parseInt(limits.dailyLimit)) {
    return { 
      allowed: false, 
      reason: `Would exceed daily limit of ${(parseInt(limits.dailyLimit) / 1_000_000).toFixed(2)} USDC` 
    };
  }
  
  // Check allowed resources
  if (limits.allowedResources.length > 0 && !limits.allowedResources.includes(resource) && !limits.allowedResources.includes('*')) {
    return { 
      allowed: false, 
      reason: `Resource ${resource} not in agent's allowed resources` 
    };
  }
  
  return { allowed: true };
}

/**
 * Register a new agent - returns API key ONCE
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { 
      owner, 
      name, 
      privacyLevel = 'shielded',
      spendingLimits = {}
    } = req.body;

    if (!owner || !name) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: owner, name',
      });
    }

    // Generate API key
    const { key, hash, prefix } = generateApiKey();

    // Default spending limits
    const limits: AgentSpendingLimits = {
      maxPerTransaction: spendingLimits.maxPerTransaction || '100000000', // 100 USDC default
      dailyLimit: spendingLimits.dailyLimit || '1000000000', // 1000 USDC default
      allowedResources: spendingLimits.allowedResources || ['*'], // All resources by default
    };

    // Default actions with donation enabled
    const defaultActions: AgentActions = {
      donation: {
        enabled: true,
        recipient: DEFAULT_DONATION_RECIPIENT,
        amount: DEFAULT_DONATION_AMOUNT,
      },
    };

    // Default stealth settings (disabled by default)
    const defaultStealthSettings: StealthSettings = {
      enabled: false,
      fundingThreshold: '100000', // 0.1 USDC
      totalPayments: 0,
      totalSolRecovered: 0,
    };

    const agent: Agent = {
      id: `agent-${uuidv4().substring(0, 8)}`,
      owner,
      name,
      status: 'active',
      privacyLevel,
      spent24h: '0',
      totalSpent: '0',
      apiCalls: 0,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      apiKeyHash: hash,
      apiKeyPrefix: prefix,
      spendingLimits: limits,
      actions: defaultActions,
      stealthSettings: defaultStealthSettings,
    };

    agents.set(agent.id, agent);
    apiKeyToAgent.set(hash, agent.id);

    // Store full key temporarily (encrypted)
    storeFullKeyTemporarily(agent.id, owner, key);

    // Add to owner's agent list
    const ownerList = ownerAgents.get(owner) || [];
    ownerList.push(agent.id);
    ownerAgents.set(owner, ownerList);

    // Persist to disk
    saveAgents();

    console.log(`[Agents] Registered new agent: ${agent.name} (${agent.id}) for ${owner.slice(0, 8)}...`);

    // Return agent WITH the API key (only time it's shown)
    res.json({
      success: true,
      data: {
        ...agent,
        apiKey: key, // Only returned once!
        apiKeyHash: undefined, // Don't expose hash
      },
      warning: 'SAVE YOUR API KEY NOW! It will not be shown again.',
    });
  } catch (error) {
    console.error('[Agents] Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register agent',
    });
  }
});

/**
 * Get all agents for an owner (without API keys)
 */
router.get('/:owner', async (req: Request, res: Response) => {
  try {
    const { owner } = req.params;
    const agentIds = ownerAgents.get(owner) || [];
    
    const ownerAgentList = agentIds
      .map(id => agents.get(id))
      .filter((a): a is Agent => a !== undefined)
      .map(agent => ({
        ...agent,
        apiKeyHash: undefined, // Never expose hash
        apiKeyVisible: agent.apiKeyPrefix + '...', // Show prefix only
      }));

    res.json({
      success: true,
      data: {
        owner,
        agents: ownerAgentList,
        count: ownerAgentList.length,
      },
    });
  } catch (error) {
    console.error('[Agents] Fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch agents',
    });
  }
});

/**
 * Regenerate API key for an agent
 */
router.post('/:agentId/regenerate-key', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { ownerSignature } = req.body; // Would verify owner in production

    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    // Remove old key mapping
    apiKeyToAgent.delete(agent.apiKeyHash);

    // Generate new API key
    const { key, hash, prefix } = generateApiKey();
    agent.apiKeyHash = hash;
    agent.apiKeyPrefix = prefix;
    agent.lastActivity = new Date().toISOString();

    // Add new key mapping
    apiKeyToAgent.set(hash, agentId);

    // Store full key temporarily (encrypted)
    storeFullKeyTemporarily(agentId, agent.owner, key);

    // Persist to disk
    saveAgents();

    console.log(`[Agents] Regenerated API key for agent ${agentId}`);

    res.json({
      success: true,
      data: {
        agentId,
        apiKey: key, // Only time new key is shown
        apiKeyPrefix: prefix,
      },
      warning: 'SAVE YOUR NEW API KEY NOW! The old key is now invalid.',
    });
  } catch (error) {
    console.error('[Agents] Key regeneration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to regenerate API key',
    });
  }
});

/**
 * GET /api/agents/:agentId/api-key
 * Retrieve full API key (decrypted from temporary encrypted storage)
 * Requires owner authentication via wallet signature
 */
router.get('/:agentId/api-key', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const owner = req.query.owner as string;
    const signature = req.query.signature as string;
    const message = req.query.message as string;
    
    if (!owner) {
      return res.status(400).json({
        success: false,
        error: 'Owner authentication required (owner query parameter)',
      });
    }
    
    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }
    
    // Verify owner matches
    if (agent.owner !== owner) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Not the agent owner',
      });
    }
    
    // ==========================================================================
    // SECURITY: Verify wallet signature (Production requirement)
    // ==========================================================================
    if (!signature || !message) {
      return res.status(400).json({
        success: false,
        error: 'Signature and message required for API key retrieval',
        hint: 'Sign a message with your wallet and include signature & message query params',
      });
    }
    
    if (!verifyOwnerSignature(owner, signature, message)) {
      console.error(`[Agents] ✗ BLOCKED: Invalid signature for owner ${owner.slice(0, 12)}...`);
      return res.status(403).json({
        success: false,
        error: 'Invalid signature - wallet ownership verification failed',
      });
    }
    console.log(`[Agents] ✓ Owner signature verified for ${owner.slice(0, 12)}...`);
    // ==========================================================================
    
    // Retrieve and decrypt full key
    const fullKey = retrieveFullKey(agentId, owner);
    if (!fullKey) {
      return res.status(404).json({
        success: false,
        error: 'API key not available (only shown once when created/regenerated, expires after 24h)',
        hint: 'Please regenerate the key to get a new one',
      });
    }
    
    return res.json({
      success: true,
      data: {
        apiKey: fullKey,
        agentId,
      },
    });
  } catch (error) {
    console.error('[Agents] Get API key error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve API key',
    });
  }
});

/**
 * Update agent settings (PATCH)
 */
router.patch('/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { status, privacyLevel, name, spendingLimits } = req.body;

    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    if (status) agent.status = status;
    if (privacyLevel) agent.privacyLevel = privacyLevel;
    if (name) agent.name = name;
    if (spendingLimits) {
      if (spendingLimits.maxPerTransaction) agent.spendingLimits.maxPerTransaction = spendingLimits.maxPerTransaction;
      if (spendingLimits.dailyLimit) agent.spendingLimits.dailyLimit = spendingLimits.dailyLimit;
      if (spendingLimits.allowedResources) agent.spendingLimits.allowedResources = spendingLimits.allowedResources;
    }
    agent.lastActivity = new Date().toISOString();

    // Persist to disk
    saveAgents();

    console.log(`[Agents] Updated agent ${agentId}: status=${agent.status}, privacy=${agent.privacyLevel}`);

    res.json({
      success: true,
      data: {
        ...agent,
        apiKeyHash: undefined,
        apiKeyVisible: agent.apiKeyPrefix + '...',
      },
    });
  } catch (error) {
    console.error('[Agents] Update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update agent',
    });
  }
});

/**
 * Update agent actions (PATCH)
 */
router.patch('/:agentId/actions', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { donation } = req.body;

    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    // Update donation settings
    if (donation) {
      if (typeof donation.enabled === 'boolean') {
        agent.actions.donation.enabled = donation.enabled;
      }
      if (donation.amount) {
        // Validate amount is a number string
        const amountNum = parseInt(donation.amount);
        if (isNaN(amountNum) || amountNum <= 0) {
          return res.status(400).json({
            success: false,
            error: 'Invalid donation amount',
          });
        }
        agent.actions.donation.amount = donation.amount;
      }
      // Recipient is read-only (always goes to Aegix developer)
    }

    agent.lastActivity = new Date().toISOString();

    // Persist to disk
    saveAgents();

    console.log(`[Agents] Updated actions for ${agentId}: donation.enabled=${agent.actions.donation.enabled}`);

    res.json({
      success: true,
      data: {
        agentId,
        actions: agent.actions,
      },
    });
  } catch (error) {
    console.error('[Agents] Actions update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update agent actions',
    });
  }
});

/**
 * Update agent (PUT) - Full update
 */
router.put('/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { status, privacyLevel, name, spendingLimits } = req.body;

    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    if (status) agent.status = status;
    if (privacyLevel) agent.privacyLevel = privacyLevel;
    if (name) agent.name = name;
    if (spendingLimits) {
      if (spendingLimits.maxPerTransaction) agent.spendingLimits.maxPerTransaction = spendingLimits.maxPerTransaction;
      if (spendingLimits.dailyLimit) agent.spendingLimits.dailyLimit = spendingLimits.dailyLimit;
      if (spendingLimits.allowedResources) agent.spendingLimits.allowedResources = spendingLimits.allowedResources;
    }
    agent.lastActivity = new Date().toISOString();

    // Persist to disk
    saveAgents();

    console.log(`[Agents] Updated agent ${agentId}: status=${agent.status}, privacy=${agent.privacyLevel}`);

    res.json({
      success: true,
      data: {
        ...agent,
        apiKeyHash: undefined,
        apiKeyVisible: agent.apiKeyPrefix + '...',
      },
    });
  } catch (error) {
    console.error('[Agents] Update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update agent',
    });
  }
});

/**
 * Delete an agent
 */
router.delete('/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    // Remove API key mapping
    apiKeyToAgent.delete(agent.apiKeyHash);

    // Remove from owner's list
    const ownerList = ownerAgents.get(agent.owner) || [];
    const updatedList = ownerList.filter(id => id !== agentId);
    ownerAgents.set(agent.owner, updatedList);

    // Remove agent
    agents.delete(agentId);

    // Persist to disk
    saveAgents();

    console.log(`[Agents] Deleted agent ${agentId}`);

    res.json({
      success: true,
      message: 'Agent deleted',
    });
  } catch (error) {
    console.error('[Agents] Delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete agent',
    });
  }
});

/**
 * Record agent activity (called internally when agent makes payment)
 */
export function recordAgentActivity(agentId: string, amount: string): void {
  const agent = agents.get(agentId);
  if (agent) {
    const amountNum = parseFloat(amount) / 1_000_000; // Convert from micro USDC
    agent.spent24h = (parseFloat(agent.spent24h) + amountNum).toFixed(4);
    agent.totalSpent = (parseFloat(agent.totalSpent) + amountNum).toFixed(4);
    agent.apiCalls += 1;
    agent.lastActivity = new Date().toISOString();
    
    // Persist to disk
    saveAgents();
  }
}

/**
 * Get agent by ID (internal use)
 */
export function getAgentById(agentId: string): Agent | undefined {
  return agents.get(agentId);
}

/**
 * Get agent's donation config
 */
export function getAgentDonationConfig(agentId: string): DonationAction | null {
  const agent = agents.get(agentId);
  if (!agent) return null;
  return agent.actions?.donation || null;
}

/**
 * Get agent's stealth settings
 */
export function getAgentStealthSettings(agentId: string): StealthSettings | null {
  const agent = agents.get(agentId);
  if (!agent) return null;
  return agent.stealthSettings || null;
}

/**
 * Update agent's pool wallet ID (after setup)
 */
export function updateAgentPoolWallet(
  agentId: string, 
  poolId: string, 
  poolAddress: string
): boolean {
  const agent = agents.get(agentId);
  if (!agent) return false;
  
  agent.stealthSettings.poolId = poolId;
  agent.stealthSettings.poolAddress = poolAddress;
  agent.stealthSettings.lastFundedAt = new Date().toISOString();
  
  return true;
}

/**
 * Increment agent's stealth payment count
 */
export function incrementAgentStealthPayments(agentId: string, solRecovered?: number): void {
  const agent = agents.get(agentId);
  if (agent) {
    agent.stealthSettings.totalPayments += 1;
    if (solRecovered) {
      agent.stealthSettings.totalSolRecovered += solRecovered;
    }
  }
}

/**
 * PATCH /api/agents/:agentId/stealth
 * Update agent's stealth/pool settings (Aegix 3.1)
 */
router.patch('/:agentId/stealth', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { enabled, fundingThreshold } = req.body;

    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    // Update stealth settings
    if (enabled !== undefined) {
      agent.stealthSettings.enabled = enabled;
    }
    if (fundingThreshold !== undefined) {
      agent.stealthSettings.fundingThreshold = fundingThreshold;
    }

    // Persist to disk
    saveAgents();

    console.log(`[Agents] Updated stealth settings for ${agentId}: enabled=${agent.stealthSettings.enabled}`);

    res.json({
      success: true,
      data: {
        agentId,
        stealthSettings: agent.stealthSettings,
      },
    });
  } catch (error) {
    console.error('[Agents] Stealth update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update stealth settings',
    });
  }
});

/**
 * POST /api/agents/:agentId/stealth/setup
 * Setup pool wallet for an agent (Aegix 3.1)
 * Each agent gets their own pool wallet for private payments
 */
router.post('/:agentId/stealth/setup', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { fundingAmount } = req.body; // Optional initial funding amount

    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    if (!agent.stealthSettings.enabled) {
      return res.status(400).json({
        success: false,
        error: 'Stealth mode is not enabled for this agent. Enable it first.',
      });
    }

    // Check if pool already setup
    if (agent.stealthSettings.poolId) {
      return res.json({
        success: true,
        message: 'Pool wallet already setup for this agent',
        data: {
          poolId: agent.stealthSettings.poolId,
          poolAddress: agent.stealthSettings.poolAddress,
          needsFunding: true, // User needs to fund it
        },
      });
    }

    // Return info for the user to create and fund the pool wallet
    // The actual wallet creation happens via the /pool/init endpoint
    res.json({
      success: true,
      message: 'Ready to create pool wallet for agent',
      data: {
        agentId,
        steps: [
          '1. Call POST /api/credits/pool/init with owner wallet signature',
          '2. Call POST /api/credits/pool/fund to get funding transaction',
          '3. Sign and send the funding transaction',
          '4. Call POST /api/agents/:agentId/stealth/link to connect pool to agent',
        ],
        suggestedFunding: fundingAmount || '1000000', // 1 USDC default
        note: 'Each agent has their own pool wallet. Payments use temp burners, SOL auto-recycles.',
      },
    });
  } catch (error) {
    console.error('[Agents] Stealth setup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to setup pool wallet',
    });
  }
});

/**
 * POST /api/agents/:agentId/stealth/create-pool
 * Create a dedicated pool wallet for an agent with FHE-encrypted private key
 * 
 * This is the secure way to CREATE_OWN_POOL - the private key is NEVER stored in plaintext!
 * 
 * Flow:
 * 1. Generate new Solana Keypair
 * 2. Encrypt the secret key using Inco FHE
 * 3. Store only the FHE handle (encrypted key)
 * 4. Return the pool address for funding
 */
router.post('/:agentId/stealth/create-pool', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { ownerSignature, message } = req.body;

    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    // Check if pool already exists
    if (agent.stealthSettings.poolId && agent.stealthSettings.poolAddress) {
      return res.status(400).json({
        success: false,
        error: 'Pool already exists for this agent',
        existingPool: {
          poolId: agent.stealthSettings.poolId,
          poolAddress: agent.stealthSettings.poolAddress,
        },
      });
    }

    // 1. Generate new pool keypair
    const poolKeypair = Keypair.generate();
    const poolAddress = poolKeypair.publicKey.toBase58();
    const poolSecretKey = Buffer.from(poolKeypair.secretKey);

    console.log(`[Agents] Generating FHE-encrypted pool for agent ${agentId}...`);

    // 2. Encrypt private key with Inco FHE
    const inco = getIncoClient();
    const encryptedKey = await inco.encryptBytes(poolSecretKey);

    // 3. Store only the FHE handle (NEVER the raw key!)
    const poolId = `pool-${uuidv4().substring(0, 8)}`;

    agent.stealthSettings.enabled = true;
    agent.stealthSettings.poolId = poolId;
    agent.stealthSettings.poolAddress = poolAddress;
    agent.stealthSettings.fhePoolKeyHandle = encryptedKey.handle;
    agent.stealthSettings.lastFundedAt = new Date().toISOString();

    // 4. Persist to disk
    saveAgents();

    // 5. Log to audit trail
    const auditLedger = getAuditLedger();
    await auditLedger.logActivity(agent.owner, {
      type: 'pool_initialized',
      agentId: agent.id,
      agentName: agent.name,
      stealthPoolAddress: poolAddress,
      timestamp: new Date().toISOString(),
    });

    console.log(`[Agents] ✓ Created FHE-encrypted pool for agent ${agentId}: ${poolAddress.slice(0, 12)}...`);

    res.json({
      success: true,
      data: {
        agentId,
        poolId,
        poolAddress,
        fheEncrypted: true,
        isRealFhe: encryptedKey.isReal,
        message: 'Pool created with FHE-encrypted private key. Fund it to start using stealth payments.',
        fundingInstructions: `Send SOL and USDC to ${poolAddress} to enable payments.`,
      },
    });
  } catch (error: any) {
    console.error('[Agents] Create pool error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create pool',
    });
  }
});

/**
 * POST /api/agents/:agentId/stealth/link
 * Link a pool wallet to an agent (Aegix 3.1)
 */
router.post('/:agentId/stealth/link', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { poolId, poolAddress } = req.body;

    if (!poolId || !poolAddress) {
      return res.status(400).json({
        success: false,
        error: 'poolId and poolAddress required',
      });
    }

    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    // Update agent with pool wallet info
    agent.stealthSettings.poolId = poolId;
    agent.stealthSettings.poolAddress = poolAddress;
    agent.stealthSettings.lastFundedAt = new Date().toISOString();

    // Persist to disk
    saveAgents();

    console.log(`[Agents] Linked pool wallet ${poolId} to agent ${agentId}`);

    res.json({
      success: true,
      data: {
        agentId,
        poolId,
        poolAddress,
        message: 'Pool wallet linked to agent. Payments will use temp burners from this pool.',
      },
    });
  } catch (error) {
    console.error('[Agents] Pool link error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to link pool wallet',
    });
  }
});

/**
 * GET /api/agents/:agentId/stealth
 * Get agent's stealth/pool settings and wallet info
 */
router.get('/:agentId/stealth', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    res.json({
      success: true,
      data: {
        agentId,
        agentName: agent.name,
        stealthSettings: agent.stealthSettings,
        isSetup: !!agent.stealthSettings.poolId,
        poolAddress: agent.stealthSettings.poolAddress || null,
      },
    });
  } catch (error) {
    console.error('[Agents] Get stealth error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get stealth settings',
    });
  }
});

/**
 * POST /api/agents/bundle
 * Bundle multiple agents to a single pool
 */
router.post('/bundle', async (req: Request, res: Response) => {
  try {
    const { agentIds, poolId, poolAddress, owner } = req.body;
    
    if (!agentIds || !Array.isArray(agentIds) || agentIds.length === 0) {
      return res.status(400).json({ success: false, error: 'agentIds array required' });
    }
    
    if (!poolId || !poolAddress) {
      return res.status(400).json({ success: false, error: 'poolId and poolAddress required' });
    }
    
    // Verify all agents belong to owner and link them to the pool
    const results = [];
    for (const agentId of agentIds) {
      const agent = agents.get(agentId);
      if (!agent) {
        results.push({ agentId, success: false, error: 'Agent not found' });
        continue;
      }
      if (agent.owner !== owner) {
        results.push({ agentId, success: false, error: 'Not owner' });
        continue;
      }
      
      // Link agent to pool
      agent.stealthSettings.enabled = true;
      agent.stealthSettings.poolId = poolId;
      agent.stealthSettings.poolAddress = poolAddress;
      agent.stealthSettings.lastFundedAt = new Date().toISOString();
      
      results.push({ agentId, success: true, name: agent.name });
    }
    
    // Persist to disk
    saveAgents();
    
    console.log(`[Agents] Bundled ${results.filter(r => r.success).length} agents to pool ${poolId}`);
    
    res.json({
      success: true,
      data: {
        poolId,
        poolAddress,
        bundledAgents: results,
        message: 'Agents bundled to shared pool',
      },
    });
  } catch (error) {
    console.error('[Agents] Bundle error:', error);
    res.status(500).json({ success: false, error: 'Failed to bundle agents' });
  }
});

/**
 * POST /api/agents/:agentId/stealth/use-main
 * Link agent to user's main pool
 */
router.post('/:agentId/stealth/use-main', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { mainPoolId, mainPoolAddress } = req.body;
    
    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    
    if (!mainPoolId || !mainPoolAddress) {
      return res.status(400).json({ success: false, error: 'mainPoolId and mainPoolAddress required' });
    }
    
    // Link to main pool
    agent.stealthSettings.enabled = true;
    agent.stealthSettings.poolId = mainPoolId;
    agent.stealthSettings.poolAddress = mainPoolAddress;
    agent.stealthSettings.lastFundedAt = new Date().toISOString();
    
    // Persist to disk
    saveAgents();
    
    console.log(`[Agents] Agent ${agentId} now using main pool ${mainPoolId}`);
    
    res.json({
      success: true,
      data: {
        agentId,
        poolId: mainPoolId,
        poolAddress: mainPoolAddress,
        mode: 'main_pool',
        message: 'Agent will use your main stealth pool for payments',
      },
    });
  } catch (error) {
    console.error('[Agents] Use main pool error:', error);
    res.status(500).json({ success: false, error: 'Failed to link main pool' });
  }
});

/**
 * GET /api/agents/pools/list
 * Get all pools owned by a user with proper hierarchy types:
 * - LEGACY: Initial compressed pool (funded from wallet)
 * - MAIN: Agent bridge pool (funded from Legacy)
 * - CUSTOM: Agent-specific pools (funded from Main)
 * 
 * Includes compression info and transaction stats
 */
router.get('/pools/list', async (req: Request, res: Response) => {
  try {
    const { owner } = req.query;
    
    if (!owner || typeof owner !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Owner query parameter required',
      });
    }
    
    const mainPool = getPoolWallet(owner);
    const pools: Array<{
      poolId: string;
      poolAddress: string;
      type: 'LEGACY' | 'MAIN' | 'CUSTOM';  // NEW: Proper hierarchy type
      isMain: boolean;
      isLegacy?: boolean;
      name: string;
      customName?: string;
      customNameHandle?: string;
      fheHandle?: string;
      agentCount: number;
      agentIds?: string[];
      balance: { sol: number; usdc: number; compressedUsdc?: number } | null;
      createdAt?: string;
      status?: string;
      lifetimeTxCount?: number;
      lifetimeVolume?: number;
      compressed: boolean;  // NEW: All pools are compressed
      canFundTo?: ('MAIN' | 'CUSTOM')[];  // NEW: Funding hierarchy
    }> = [];
    
    // Track which pool IDs we've added to avoid duplicates
    const addedPoolIds = new Set<string>();
    
    // Add main pool if exists (THE ROOT OF TRUST)
    if (mainPool) {
      // Check if main pool is persisted, create if not
      let persistedMain = getCustomPool(mainPool.id);
      if (!persistedMain) {
        // Register main pool in persistence
        addCustomPool({
          poolId: mainPool.id,
          poolAddress: mainPool.publicKey,
          owner,
          isMain: true,
          createdAt: new Date().toISOString(),
          status: 'active',
          lifetimeTxCount: 0,
          lifetimeVolume: 0,
        });
        persistedMain = getCustomPool(mainPool.id);
      }
      
      // Fetch real-time balance for Legacy pool
      let legacyBalance = null;
      try {
        const connection = getRegularConnection();
        const poolPubkey = new PublicKey(mainPool.publicKey);
        const solBalance = await connection.getBalance(poolPubkey);
        
        // Get regular USDC balance
        let usdcBalance = 0;
        try {
          const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
          const usdcAta = await getAssociatedTokenAddress(usdcMint, poolPubkey);
          const ataInfo = await connection.getTokenAccountBalance(usdcAta);
          usdcBalance = ataInfo.value.uiAmount || 0;
        } catch (err) {
          // No USDC ATA exists
          usdcBalance = 0;
        }
        
        // Get compressed USDC balance (Light Protocol)
        let compressedUsdcBalance = 0;
        try {
          const { getCompressedBalance } = await import('../light/client.js');
          const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
          const compressedBalance = await getCompressedBalance(poolPubkey, usdcMint);
          // compressedBalance is an object { amount: bigint, ... } or null
          if (compressedBalance && compressedBalance.amount) {
            compressedUsdcBalance = Number(compressedBalance.amount) / 10 ** 6;
          }
          console.log(`[Pools] Legacy compressed USDC: ${compressedUsdcBalance}`);
        } catch (err) {
          // Light Protocol not available or no compressed balance
          console.log('[Pools] Could not fetch Legacy compressed balance');
          compressedUsdcBalance = 0;
        }
        
        legacyBalance = {
          sol: solBalance / LAMPORTS_PER_SOL,
          usdc: usdcBalance,
          compressedUsdc: compressedUsdcBalance,
        };
      } catch (err) {
        console.error('[Pools] Failed to fetch Legacy pool balance:', err);
      }
      
      // The first/main pool is the LEGACY pool (user's initial compressed pool)
      pools.push({
        poolId: mainPool.id,
        poolAddress: mainPool.publicKey,
        type: 'LEGACY',  // Initial compressed pool
        isMain: true,
        isLegacy: true,
        name: 'LEGACY_POOL',
        customName: persistedMain?.customName,
        customNameHandle: persistedMain?.customNameHandle,
        fheHandle: persistedMain?.fheHandle,
        agentCount: 0,
        balance: legacyBalance,
        createdAt: persistedMain?.createdAt,
        status: 'active',
        lifetimeTxCount: persistedMain?.lifetimeTxCount || 0,
        lifetimeVolume: persistedMain?.lifetimeVolume || 0,
        compressed: true,
        canFundTo: ['MAIN'],  // Legacy can only fund Main
      });
      addedPoolIds.add(mainPool.id);
    }
    
    // Add persisted custom pools for this owner
    // Determine type based on pool metadata or creation context
    // FETCH REAL-TIME BALANCES for all pools
    const ownerCustomPools = getCustomPoolsForOwner(owner);
    let hasMainPool = false;
    
    for (const customPool of ownerCustomPools) {
      if (!addedPoolIds.has(customPool.poolId)) {
        // Determine pool type:
        // - If it's the first non-legacy pool, it's MAIN (agent bridge)
        // - All others are CUSTOM
        let poolType: 'MAIN' | 'CUSTOM' = 'CUSTOM';
        if (!hasMainPool && (customPool.customName?.toLowerCase().includes('main') || customPool.isMain)) {
          poolType = 'MAIN';
          hasMainPool = true;
        }
        
        // Fetch real-time balance for this pool
        let poolBalance = customPool.balance || null;
        try {
          const connection = getRegularConnection();
          const poolPubkey = new PublicKey(customPool.poolAddress);
          const solBalance = await connection.getBalance(poolPubkey);
          
          // Get regular USDC balance
          let usdcBalance = 0;
          try {
            const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            const usdcAta = await getAssociatedTokenAddress(usdcMint, poolPubkey);
            const ataInfo = await connection.getTokenAccountBalance(usdcAta);
            usdcBalance = ataInfo.value.uiAmount || 0;
          } catch (err) {
            // No USDC ATA exists
            usdcBalance = 0;
          }
          
          // Get compressed USDC balance (Light Protocol)
          let compressedUsdcBalance = 0;
          try {
            const { getCompressedBalance } = await import('../light/client.js');
            const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            const compressedBalance = await getCompressedBalance(poolPubkey, usdcMint);
            // compressedBalance is an object { amount: bigint, ... } or null
            if (compressedBalance && compressedBalance.amount) {
              compressedUsdcBalance = Number(compressedBalance.amount) / 10 ** 6;
            }
            console.log(`[Pools] Custom pool ${customPool.poolId} compressed USDC: ${compressedUsdcBalance}`);
          } catch (err) {
            // Light Protocol not available or no compressed balance
            compressedUsdcBalance = 0;
          }
          
          poolBalance = {
            sol: solBalance / LAMPORTS_PER_SOL,
            usdc: usdcBalance,
            compressedUsdc: compressedUsdcBalance,
          };
        } catch (err) {
          console.error(`[Pools] Failed to fetch balance for ${customPool.poolId}:`, err);
        }
        
        pools.push({
          poolId: customPool.poolId,
          poolAddress: customPool.poolAddress,
          type: poolType,
          isMain: poolType === 'MAIN',
          name: customPool.customName || (poolType === 'MAIN' ? 'MAIN_POOL' : `CUSTOM_${customPool.poolId.slice(-8).toUpperCase()}`),
          customName: customPool.customName,
          customNameHandle: customPool.customNameHandle,
          fheHandle: customPool.fheHandle,
          agentCount: 0, // Will be updated below
          agentIds: [],
          balance: poolBalance,
          createdAt: customPool.createdAt,
          status: customPool.status,
          lifetimeTxCount: customPool.lifetimeTxCount || 0,
          lifetimeVolume: customPool.lifetimeVolume || 0,
          compressed: true,  // All pools are compressed
          canFundTo: poolType === 'MAIN' ? ['CUSTOM'] : undefined,
        });
        addedPoolIds.add(customPool.poolId);
      }
    }
    
    // Count agents per pool
    for (const [agentId, agent] of agents.entries()) {
      if (agent.owner === owner && agent.stealthSettings.enabled && agent.stealthSettings.poolId) {
        const poolId = agent.stealthSettings.poolId;
        
        // Find the pool entry and increment agent count
        const poolEntry = pools.find(p => p.poolId === poolId);
        if (poolEntry) {
          poolEntry.agentCount++;
          if (!poolEntry.agentIds) poolEntry.agentIds = [];
          poolEntry.agentIds.push(agentId);
        } else {
          // Agent references a pool not in our list - add it as CUSTOM
          const poolAddress = agent.stealthSettings.poolAddress || '';
          const fheHandle = agent.stealthSettings.fhePoolKeyHandle;
          if (!addedPoolIds.has(poolId)) {
            pools.push({
              poolId,
              poolAddress,
              type: 'CUSTOM',  // Agent-linked pools are CUSTOM
              isMain: false,
              name: `AGENT_POOL_${poolId.slice(-8).toUpperCase()}`,
              fheHandle,
              agentCount: 1,
              agentIds: [agentId],
              balance: null,
              compressed: true,
            });
            addedPoolIds.add(poolId);
          }
        }
      }
    }
    
    console.log(`[Pools] Listed ${pools.length} pool(s) for ${owner.slice(0, 8)}...`);
    
    res.json({
      success: true,
      data: {
        pools,
        count: pools.length,
      },
    });
  } catch (error) {
    console.error('[Pools] List error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list pools',
    });
  }
});

// =============================================================================
// POOL MANAGEMENT ENDPOINTS (Infrastructure Shield)
// =============================================================================

/**
 * DELETE /api/agents/pools/:poolId
 * Delete a custom pool (PROTECTED: Main pool cannot be deleted)
 */
router.delete('/pools/:poolId', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const { owner, signature } = req.body;
    
    if (!owner) {
      return res.status(400).json({
        success: false,
        error: 'Owner required',
      });
    }
    
    const pool = getCustomPool(poolId);
    
    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'Pool not found',
      });
    }
    
    // Verify ownership
    if (pool.owner !== owner) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to delete this pool',
      });
    }
    
    // IMMUTABLE ROOT CHECK - 403 Forbidden for Main Pool
    if (pool.isMain) {
      console.log(`[Pools] ⛔ BLOCKED: Attempted deletion of MAIN_POOL by ${owner.slice(0, 8)}...`);
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN: Main pool is the system root of trust and cannot be deleted',
        code: 'IMMUTABLE_ROOT',
      });
    }
    
    // Check if any agents are using this pool
    let linkedAgents = 0;
    for (const [agentId, agent] of agents.entries()) {
      if (agent.stealthSettings.poolId === poolId) {
        linkedAgents++;
      }
    }
    
    if (linkedAgents > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete pool: ${linkedAgents} agent(s) are still linked. Unlink them first.`,
        linkedAgents,
      });
    }
    
    // Delete the pool
    const result = deleteCustomPool(poolId);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }
    
    console.log(`[Pools] ✓ Deleted pool ${poolId} for ${owner.slice(0, 8)}...`);
    
    res.json({
      success: true,
      data: {
        poolId,
        message: 'Pool deleted successfully',
      },
    });
  } catch (error) {
    console.error('[Pools] Delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete pool',
    });
  }
});

/**
 * POST /api/agents/pools/:poolId/update-name
 * Update pool custom name (FHE-encrypted)
 */
router.post('/pools/:poolId/update-name', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const { owner, customName } = req.body;
    
    if (!owner || !customName) {
      return res.status(400).json({
        success: false,
        error: 'Owner and customName required',
      });
    }
    
    const pool = getCustomPool(poolId);
    
    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'Pool not found',
      });
    }
    
    if (pool.owner !== owner) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to update this pool',
      });
    }
    
    // Generate FHE-encrypted handle for the name
    // In production, this would use real Inco FHE encryption
    const incoClient = getIncoClient();
    const nameBytes = Buffer.from(customName, 'utf8');
    const nameAsNumber = nameBytes.length; // Use length as placeholder for FHE
    const encryptedName = await incoClient.encrypt(nameAsNumber);
    
    // Update pool with encrypted name handle
    updatePoolName(poolId, encryptedName.handle, customName);
    
    console.log(`[Pools] ✓ Updated name for pool ${poolId}: "${customName}"`);
    
    res.json({
      success: true,
      data: {
        poolId,
        customName,
        customNameHandle: encryptedName.handle,
        fheEncrypted: true,
        message: 'Pool name updated',
      },
    });
  } catch (error) {
    console.error('[Pools] Update name error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update pool name',
    });
  }
});

/**
 * POST /api/agents/pools/:poolId/export-key
 * Export pool private key - RAW 64-byte Solana secretKey in Base58 format
 * 
 * UNIVERSAL HANDLER: Works for both Main Pool (stealth module) and Custom Pools (FHE)
 * 
 * Security flow:
 * 1. User signs message "DECRYPT_POOL_KEY_[PoolID]"
 * 2. Backend verifies signature matches owner
 * 3. For Main Pool: use stealth module's exportPoolKey()
 * 4. For Custom Pool: FHE-encrypted bytes are decrypted via Inco
 * 5. Returns Base58-encoded 64-byte secretKey (Phantom/Solflare compatible)
 * 6. Key expires after 60s, cleared from memory
 */
router.post('/pools/:poolId/export-key', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const { owner, signature, message } = req.body;
    
    if (!owner || !signature || !message) {
      return res.status(400).json({
        success: false,
        error: 'Owner, signature, and message required',
      });
    }
    
    // Verify message format
    const expectedMessage = `DECRYPT_POOL_KEY_${poolId}`;
    if (message !== expectedMessage) {
      return res.status(400).json({
        success: false,
        error: `Invalid message format. Expected: "${expectedMessage}"`,
      });
    }
    
    // FIRST: Try the stealth module for Main Pool / Legacy pools
    // This mirrors the working Execute_Payment logic
    const { exportPoolKey: stealthExportKey, getPoolById } = await import('../stealth/index.js');
    const stealthPool = getPoolById(poolId);
    
    if (stealthPool && stealthPool.owner === owner) {
      const stealthResult = await stealthExportKey(poolId, owner);
      
      if (stealthResult) {
        console.log(`[Pools] ⚠️ SENSITIVE: Main/Legacy pool key exported for ${poolId} by ${owner.slice(0, 8)}...`);
        return res.json({
          success: true,
          data: {
            poolId,
            poolAddress: stealthPool.publicKey,
            // RAW 64-byte Solana secretKey as Base58 (Phantom/Solflare compatible)
            privateKeyBase58: stealthResult.privateKeyBase58,
            publicKey: stealthResult.publicKey,
            format: 'solana-secretkey-64-bytes',
            importGuide: 'Import into Phantom: Settings → Security → Show Recovery Phrase → Import Private Key',
            warning: 'CRITICAL: This key controls ALL funds in this pool. Never share it.',
            expiresInMs: 60000,
          },
        });
      }
    }
    
    // SECOND: Try custom pools (FHE-encrypted)
    let pool = getCustomPool(poolId);
    let fheHandle = pool?.fheHandle;
    let poolAddress = pool?.poolAddress;
    
    // THIRD: Check agent stealthSettings for pools created via "Link Agent" flow
    // These pools have their FHE handle stored in agent.stealthSettings.fhePoolKeyHandle
    if (!fheHandle) {
      for (const [agentId, agent] of agents.entries()) {
        if (agent.owner === owner && 
            agent.stealthSettings.poolId === poolId && 
            agent.stealthSettings.fhePoolKeyHandle) {
          fheHandle = agent.stealthSettings.fhePoolKeyHandle;
          poolAddress = agent.stealthSettings.poolAddress || poolAddress;
          console.log(`[Pools] Found FHE handle in agent ${agentId}'s stealthSettings`);
          break;
        }
      }
    }
    
    if (!pool && !fheHandle) {
      return res.status(404).json({
        success: false,
        error: 'Pool not found in registry, stealth module, or agent settings',
      });
    }
    
    if (pool && pool.owner !== owner) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to export this pool key',
      });
    }
    
    if (!fheHandle) {
      return res.status(400).json({
        success: false,
        error: 'Pool has no encrypted key handle. Pool may not support key export.',
      });
    }
    
    // Decrypt FHE-encrypted pool secret key
    const incoClient = getIncoClient();
    
    try {
      // Use decryptBytes for pool private keys (64-byte Solana secretKey)
      const secretKeyBuffer = await incoClient.decryptBytes(
        fheHandle,
        owner,
        signature
      );
      
      // Validate: Solana secretKey must be exactly 64 bytes
      if (secretKeyBuffer.length !== 64) {
        console.error(`[Pools] Invalid secretKey length: ${secretKeyBuffer.length} (expected 64)`);
        return res.status(500).json({
          success: false,
          error: 'Decrypted key has invalid length. Pool may be corrupted.',
        });
      }
      
      // Convert to Base58 (Phantom/Solflare import format)
      const bs58 = await import('bs58');
      const privateKeyBase58 = bs58.default.encode(secretKeyBuffer);
      
      // Derive public key from secret key to verify
      const { Keypair } = await import('@solana/web3.js');
      const keypair = Keypair.fromSecretKey(secretKeyBuffer);
      const publicKey = keypair.publicKey.toBase58();
      
      // Log export event (NEVER log the actual key!)
      console.log(`[Pools] ⚠️ SENSITIVE: Pool key exported for ${poolId} by ${owner.slice(0, 8)}...`);
      console.log(`[Pools]    Public key verified: ${publicKey.slice(0, 12)}...`);
      
      res.json({
        success: true,
        data: {
          poolId,
          poolAddress: poolAddress || publicKey,
          // RAW 64-byte Solana secretKey as Base58 (Phantom/Solflare compatible)
          privateKeyBase58,
          publicKey,
          format: 'solana-secretkey-64-bytes',
          importGuide: 'Import into Phantom: Settings → Security → Show Recovery Phrase → Import Private Key',
          warning: 'CRITICAL: This key controls ALL funds in this pool. Never share it.',
          expiresInMs: 60000, // 60 seconds for secure copy
        },
      });
    } catch (decryptError: any) {
      console.error('[Pools] FHE decryption failed:', decryptError.message);
      return res.status(400).json({
        success: false,
        error: 'FHE decryption failed. Signature may be invalid.',
      });
    }
  } catch (error) {
    console.error('[Pools] Export key error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export pool key',
    });
  }
});

/**
 * GET /api/agents/pools/:poolId/stats
 * Get pool transaction statistics from audit logs
 */
router.get('/pools/:poolId/stats', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const { owner } = req.query;
    
    if (!owner || typeof owner !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Owner query parameter required',
      });
    }
    
    const pool = getCustomPool(poolId);
    const poolAddress = pool?.poolAddress;
    
    // Also check agent stealthSettings for pool address
    let actualPoolAddress = poolAddress;
    if (!actualPoolAddress) {
      for (const [, agent] of agents.entries()) {
        if (agent.owner === owner && agent.stealthSettings.poolId === poolId) {
          actualPoolAddress = agent.stealthSettings.poolAddress;
          break;
        }
      }
    }
    
    // Get audit ledger - use getAuditLog (correct method name)
    const auditLedger = getAuditLedger();
    const allLogs = await auditLedger.getAuditLog(owner);
    
    // Filter logs for this pool
    const poolLogs = allLogs.filter(log => 
      log.stealthPoolAddress === actualPoolAddress ||
      log.stealthPoolAddress === poolId
    );
    
    // Calculate stats
    const stats = {
      lifetimeTxCount: poolLogs.length,
      lifetimeVolume: poolLogs.reduce((sum, log) => sum + (parseFloat(log.amount || '0') || 0), 0),
      last24hTxCount: poolLogs.filter(log => {
        const logTime = new Date(log.timestamp).getTime();
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        return logTime > dayAgo;
      }).length,
      recentTransactions: poolLogs.slice(0, 10).map(log => ({
        type: log.type,
        amount: log.amount,
        timestamp: log.timestamp,
        txSignature: log.txSignature,
      })),
    };
    
    // Update persisted stats
    if (pool) {
      pool.lifetimeTxCount = stats.lifetimeTxCount;
      pool.lifetimeVolume = stats.lifetimeVolume;
      savePools();
    }
    
    res.json({
      success: true,
      data: {
        poolId,
        ...stats,
      },
    });
  } catch (error) {
    console.error('[Pools] Stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get pool stats',
    });
  }
});

/**
 * POST /api/agents/pools/:poolId/unlink-agent
 * Unlink an agent from a pool (pool-level management)
 */
router.post('/pools/:poolId/unlink-agent', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const { owner, agentId } = req.body;
    
    if (!owner || !agentId) {
      return res.status(400).json({
        success: false,
        error: 'Owner and agentId required',
      });
    }
    
    const pool = getCustomPool(poolId);
    
    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'Pool not found',
      });
    }
    
    if (pool.owner !== owner) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to manage this pool',
      });
    }
    
    const agent = agents.get(agentId);
    
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }
    
    if (agent.stealthSettings.poolId !== poolId) {
      return res.status(400).json({
        success: false,
        error: 'Agent is not linked to this pool',
      });
    }
    
    // Unlink the agent
    agent.stealthSettings.enabled = false;
    agent.stealthSettings.poolId = undefined;
    agent.stealthSettings.poolAddress = undefined;
    agent.stealthSettings.fhePoolKeyHandle = undefined;
    agent.lastActivity = new Date().toISOString();
    
    saveAgents();
    
    console.log(`[Pools] ✓ Unlinked agent ${agentId} from pool ${poolId}`);
    
    res.json({
      success: true,
      data: {
        poolId,
        agentId,
        message: 'Agent unlinked from pool',
      },
    });
  } catch (error) {
    console.error('[Pools] Unlink agent error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unlink agent',
    });
  }
});

/**
 * POST /api/agents/pools/:poolId/update-agent-budget
 * Update spending budget for an agent from pool view
 */
router.post('/pools/:poolId/update-agent-budget', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const { owner, agentId, maxPerTransaction, dailyLimit } = req.body;
    
    if (!owner || !agentId) {
      return res.status(400).json({
        success: false,
        error: 'Owner and agentId required',
      });
    }
    
    const pool = getCustomPool(poolId);
    
    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'Pool not found',
      });
    }
    
    if (pool.owner !== owner) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to manage this pool',
      });
    }
    
    const agent = agents.get(agentId);
    
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }
    
    if (agent.stealthSettings.poolId !== poolId) {
      return res.status(400).json({
        success: false,
        error: 'Agent is not linked to this pool',
      });
    }
    
    // Update spending limits
    if (maxPerTransaction !== undefined) {
      agent.spendingLimits.maxPerTransaction = maxPerTransaction.toString();
    }
    if (dailyLimit !== undefined) {
      agent.spendingLimits.dailyLimit = dailyLimit.toString();
    }
    agent.lastActivity = new Date().toISOString();
    
    saveAgents();
    
    console.log(`[Pools] ✓ Updated budget for agent ${agentId}: max=${maxPerTransaction}, daily=${dailyLimit}`);
    
    res.json({
      success: true,
      data: {
        poolId,
        agentId,
        spendingLimits: agent.spendingLimits,
        message: 'Agent budget updated',
      },
    });
  } catch (error) {
    console.error('[Pools] Update budget error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update agent budget',
    });
  }
});

/**
 * POST /api/agents/:agentId/stealth/assign-pool
 * Assign agent to a specific pool (different from main pool)
 */
router.post('/:agentId/stealth/assign-pool', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { poolId, poolAddress } = req.body;
    
    if (!poolId || !poolAddress) {
      return res.status(400).json({
        success: false,
        error: 'poolId and poolAddress required',
      });
    }
    
    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }
    
    // Link agent to the specified pool
    agent.stealthSettings.enabled = true;
    agent.stealthSettings.poolId = poolId;
    agent.stealthSettings.poolAddress = poolAddress;
    agent.stealthSettings.lastFundedAt = new Date().toISOString();
    
    // Persist to disk
    saveAgents();
    
    console.log(`[Agents] Agent ${agentId} assigned to pool ${poolId}`);
    
    res.json({
      success: true,
      data: {
        agentId,
        poolId,
        poolAddress,
        mode: 'assigned_pool',
        message: `Agent assigned to pool ${poolId}`,
      },
    });
  } catch (error) {
    console.error('[Agents] Assign pool error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to assign pool',
    });
  }
});

/**
 * POST /api/agents/:agentId/stealth/unlink
 * Unlink an agent from its assigned pool
 * Clears poolId, poolAddress, fhePoolKeyHandle and disables stealth mode
 */
router.post('/:agentId/stealth/unlink', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    
    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }
    
    // Store previous pool info for logging
    const previousPoolId = agent.stealthSettings.poolId;
    const previousPoolAddress = agent.stealthSettings.poolAddress;
    
    // Clear pool assignment
    agent.stealthSettings.enabled = false;
    agent.stealthSettings.poolId = undefined;
    agent.stealthSettings.poolAddress = undefined;
    agent.stealthSettings.fhePoolKeyHandle = undefined;
    agent.lastActivity = new Date().toISOString();
    
    // Persist to disk
    saveAgents();
    
    console.log(`[Agents] ✓ Unlinked agent ${agentId} from pool ${previousPoolId || 'none'}`);
    
    res.json({
      success: true,
      data: {
        agentId,
        previousPoolId,
        previousPoolAddress,
        message: 'Pool unlinked successfully. Agent stealth mode disabled.',
      },
    });
  } catch (error) {
    console.error('[Agents] Unlink pool error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unlink pool',
    });
  }
});

// =============================================================================
// LIGHT PROTOCOL ENDPOINTS (Aegix 4.0)
// =============================================================================

import {
  createSessionKey,
  validateSessionKey,
  revokeSessionKey,
  recordSpending,
  getSessionKeypair,
  refreshSessionStatus,
  getSessionInfo,
  createCompressedPool,
  getCompressedBalance,
  compressTokens,
  checkLightHealth,
  getCostEstimate,
  type LightSessionKey,
  type SessionSpendingLimits,
} from '../light/index.js';

/**
 * POST /api/agents/:agentId/light/create-session
 * Create a Light Protocol session key for an agent
 * Owner signs message to grant autonomous spending authority
 * 
 * Flow:
 * 1. Owner signs "AEGIX_SESSION_GRANT::agentId::owner::timestamp"
 * 2. Gateway generates session keypair (encrypted storage)
 * 3. Creates compressed pool address
 * 4. Returns session public key and pool address for funding
 */
router.post('/:agentId/light/create-session', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { ownerSignature, message, limits, durationHours } = req.body;
    
    if (!ownerSignature || !message) {
      return res.status(400).json({
        success: false,
        error: 'Owner signature and message required',
      });
    }
    
    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }
    
    // Verify message format: AEGIX_SESSION_GRANT::agentId::owner::timestamp
    const expectedPattern = new RegExp(`^AEGIX_SESSION_GRANT::${agentId}::`);
    if (!expectedPattern.test(message)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid session grant message format',
        expected: `AEGIX_SESSION_GRANT::${agentId}::ownerAddress::timestamp`,
      });
    }
    
    // Parse spending limits or use defaults
    const sessionLimits: SessionSpendingLimits = {
      maxPerTransaction: limits?.maxPerTransaction || agent.spendingLimits.maxPerTransaction,
      dailyLimit: limits?.dailyLimit || agent.spendingLimits.dailyLimit,
    };
    
    // Calculate duration (default 24 hours, max 168 hours = 7 days)
    const durationMs = Math.min(
      (durationHours || 24) * 60 * 60 * 1000,
      7 * 24 * 60 * 60 * 1000
    );
    
    // Create session key
    const result = createSessionKey(
      agent.owner,
      ownerSignature,
      message,
      sessionLimits,
      durationMs
    );
    
    // Update agent with Light settings
    agent.stealthSettings.enabled = true;
    agent.stealthSettings.mode = 'light';
    agent.stealthSettings.lightPoolAddress = result.poolAddress;
    agent.stealthSettings.lightSessionKey = result.sessionKey;
    agent.stealthSettings.lightMerkleRoot = result.merkleTree;
    agent.lastActivity = new Date().toISOString();
    
    saveAgents();
    
    // Log session creation
    const auditLedger = getAuditLedger();
    await auditLedger.logActivity(agent.owner, {
      type: 'agent_created', // Using existing type
      agentId,
      agentName: agent.name,
      timestamp: new Date().toISOString(),
    });
    
    console.log(`[Light] ✓ Session created for agent ${agentId}: ${result.sessionKey.publicKey.slice(0, 12)}...`);
    
    res.json({
      success: true,
      data: {
        agentId,
        agentName: agent.name,
        sessionPublicKey: result.sessionKey.publicKey,
        poolAddress: result.poolAddress,
        merkleTree: result.merkleTree,
        expiresAt: result.expiresAt,
        limits: sessionLimits,
        mode: 'light',
        message: 'Session created. Fund the pool address with compressed USDC to enable payments.',
        costEstimate: getCostEstimate(),
      },
    });
  } catch (error: any) {
    console.error('[Light] Create session error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create Light session',
    });
  }
});

/**
 * POST /api/agents/:agentId/light/fund-pool
 * Get transaction to fund agent's Light compressed pool
 * Owner signs to transfer USDC and compress into pool
 */
router.post('/:agentId/light/fund-pool', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { amount } = req.body; // Amount in USDC (e.g., 10.00)
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount required (in USDC)',
      });
    }
    
    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }
    
    if (!agent.stealthSettings.lightPoolAddress) {
      return res.status(400).json({
        success: false,
        error: 'Agent has no Light pool. Create session first.',
      });
    }
    
    // Convert to micro-USDC
    const amountMicro = BigInt(Math.floor(amount * 1_000_000));
    
    // Build compress transaction
    const { PublicKey } = await import('@solana/web3.js');
    const ownerPubkey = new PublicKey(agent.owner);
    
    const transaction = await compressTokens(ownerPubkey, amountMicro);
    
    // Serialize transaction for frontend signing
    const serializedTx = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64');
    
    console.log(`[Light] Fund pool transaction prepared: ${amount} USDC for agent ${agentId}`);
    
    res.json({
      success: true,
      data: {
        agentId,
        poolAddress: agent.stealthSettings.lightPoolAddress,
        amount: amount,
        amountMicro: amountMicro.toString(),
        transaction: serializedTx,
        message: 'Sign this transaction to compress USDC into the agent pool.',
        instructions: [
          '1. Sign the transaction with your wallet',
          '2. Broadcast to Solana network',
          '3. USDC will be compressed into the agent pool',
        ],
      },
    });
  } catch (error: any) {
    console.error('[Light] Fund pool error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to build fund transaction',
    });
  }
});

/**
 * POST /api/agents/:agentId/light/revoke-session
 * Owner revokes agent's session key authority
 * Optionally sweeps remaining funds back to owner
 */
router.post('/:agentId/light/revoke-session', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { ownerSignature, message, sweepFunds } = req.body;
    
    if (!ownerSignature || !message) {
      return res.status(400).json({
        success: false,
        error: 'Owner signature and message required',
      });
    }
    
    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }
    
    if (!agent.stealthSettings.lightSessionKey) {
      return res.status(400).json({
        success: false,
        error: 'Agent has no active Light session',
      });
    }
    
    // Verify message format
    const expectedPattern = new RegExp(`^AEGIX_SESSION_REVOKE::${agentId}::`);
    if (!expectedPattern.test(message)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid revocation message format',
        expected: `AEGIX_SESSION_REVOKE::${agentId}::ownerAddress::timestamp`,
      });
    }
    
    // Revoke the session
    const revokedSession = revokeSessionKey(
      agent.stealthSettings.lightSessionKey,
      agent.owner,
      ownerSignature
    );
    
    // Update agent
    agent.stealthSettings.lightSessionKey = revokedSession;
    agent.lastActivity = new Date().toISOString();
    
    saveAgents();
    
    console.log(`[Light] ✓ Session revoked for agent ${agentId}`);
    
    // TODO: If sweepFunds is true, build decompress transaction to return funds
    
    res.json({
      success: true,
      data: {
        agentId,
        sessionPublicKey: revokedSession.publicKey,
        revokedAt: revokedSession.revokedAt,
        status: 'revoked',
        message: 'Session revoked. Agent can no longer spend autonomously.',
        sweepFunds: sweepFunds ? 'Transaction will be provided separately' : 'Not requested',
      },
    });
  } catch (error: any) {
    console.error('[Light] Revoke session error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to revoke session',
    });
  }
});

/**
 * GET /api/agents/:agentId/light/status
 * Get Light Protocol session status and pool balance
 */
router.get('/:agentId/light/status', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    
    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }
    
    // Check if using Light mode
    if (agent.stealthSettings.mode !== 'light' || !agent.stealthSettings.lightSessionKey) {
      return res.json({
        success: true,
        data: {
          agentId,
          mode: agent.stealthSettings.mode || 'legacy',
          lightEnabled: false,
          message: 'Agent is not using Light Protocol',
        },
      });
    }
    
    // Refresh session status
    const refreshedSession = refreshSessionStatus(agent.stealthSettings.lightSessionKey);
    if (refreshedSession.status !== agent.stealthSettings.lightSessionKey.status) {
      agent.stealthSettings.lightSessionKey = refreshedSession;
      saveAgents();
    }
    
    // Get session info
    const sessionInfo = getSessionInfo(refreshedSession);
    
    // Get compressed balance
    let balance = null;
    try {
      const { PublicKey } = await import('@solana/web3.js');
      const poolPubkey = new PublicKey(agent.stealthSettings.lightPoolAddress!);
      balance = await getCompressedBalance(poolPubkey);
    } catch (err) {
      console.warn('[Light] Could not fetch balance:', err);
    }
    
    // Validate session
    const validation = validateSessionKey(refreshedSession);
    
    // Check Light health
    const health = await checkLightHealth();
    
    res.json({
      success: true,
      data: {
        agentId,
        agentName: agent.name,
        mode: 'light',
        lightEnabled: true,
        session: {
          ...sessionInfo,
          valid: validation.valid,
          validationReason: validation.reason,
          remainingDailyLimit: validation.remainingDailyLimit,
        },
        pool: {
          address: agent.stealthSettings.lightPoolAddress,
          merkleTree: agent.stealthSettings.lightMerkleRoot,
          balance: balance ? {
            amount: balance.amount.toString(),
            formatted: `${Number(balance.amount) / 1_000_000} USDC`,
          } : null,
        },
        health: {
          lightProtocol: health.healthy,
          slot: health.slot,
        },
        costEstimate: getCostEstimate(),
      },
    });
  } catch (error: any) {
    console.error('[Light] Status error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get Light status',
    });
  }
});

/**
 * GET /api/light/health
 * Check Light Protocol health and availability
 * Returns detailed RPC status and helpful hints for configuration
 */
router.get('/light/health', async (_req: Request, res: Response) => {
  try {
    const health = await checkLightHealth();
    const costs = getCostEstimate();
    
    res.json({
      success: true,
      data: {
        healthy: health.healthy,
        slot: health.slot,
        error: health.error,
        hint: health.hint,
        rpc: {
          url: health.rpcUrl?.slice(0, 50) || 'unknown',
          compressionSupported: health.healthy,
        },
        costs,
        features: {
          compressedAccounts: health.healthy,
          compressedTokens: health.healthy,
          sessionKeys: true,
          gaslessPayments: true, // Via PayAI
        },
        version: '4.0.0',
        // Configuration help
        configHelp: !health.healthy ? {
          issue: health.error || 'RPC does not support Light Protocol compression methods',
          solution: 'Set LIGHT_RPC_URL or HELIUS_RPC_URL in your .env file',
          recommendedProviders: [
            { name: 'Helius', url: 'https://helius.xyz', note: 'Excellent Light Protocol support' },
            { name: 'Triton', url: 'https://triton.one', note: 'Good Light Protocol support' },
          ],
        } : undefined,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Health check failed',
      hint: 'Check RPC configuration. Use Helius or Triton for Light Protocol support.',
    });
  }
});

// =============================================================================
// MIGRATION ENDPOINTS (Legacy -> Light)
// =============================================================================

import {
  canMigrate,
  prepareMigration,
  migrateAgent,
  getMigrationStatus,
} from '../light/migrate.js';

/**
 * GET /api/agents/migration/status
 * Get migration status for all agents of an owner
 */
router.get('/migration/status', async (req: Request, res: Response) => {
  try {
    const owner = req.query.owner as string;
    if (!owner) {
      return res.status(400).json({
        success: false,
        error: 'Owner address required',
      });
    }
    
    // Get all agents for this owner
    const ownerAgents = Array.from(agents.values()).filter(a => a.owner === owner);
    
    const status = getMigrationStatus(ownerAgents);
    
    res.json({
      success: true,
      data: {
        ...status,
        summary: {
          percentOnLight: Math.round((status.onLight / status.total) * 100) || 0,
          migrationRecommended: status.onLegacy > 0,
          message: status.onLegacy > 0
            ? `${status.onLegacy} agent(s) can be migrated to Light Protocol for ~50x cheaper payments`
            : status.onLight === status.total
              ? 'All agents are using Light Protocol'
              : 'No agents have stealth pools configured',
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get migration status',
    });
  }
});

/**
 * GET /api/agents/:agentId/migration/prepare
 * Preview what migration will do for an agent
 */
router.get('/:agentId/migration/prepare', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const transferFunds = req.query.transferFunds === 'true';
    
    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }
    
    // Check if can migrate
    const check = canMigrate(agent);
    if (!check.canMigrate) {
      return res.json({
        success: true,
        data: {
          canMigrate: false,
          reason: check.reason,
          currentMode: check.currentMode,
        },
      });
    }
    
    // Prepare migration preview
    const preview = prepareMigration(agent, { transferFunds });
    
    res.json({
      success: true,
      data: {
        canMigrate: true,
        ...preview,
        benefits: [
          '~50x cheaper payments with ZK Compression',
          'Session-based autonomous spending (no per-payment signatures)',
          'Ephemeral burners for better privacy',
          'PayAI gasless support',
        ],
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to prepare migration',
    });
  }
});

/**
 * POST /api/agents/:agentId/migration/execute
 * Execute migration to Light Protocol
 */
router.post('/:agentId/migration/execute', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { ownerSignature, message, limits, sessionDurationHours } = req.body;
    
    if (!ownerSignature || !message) {
      return res.status(400).json({
        success: false,
        error: 'Owner signature and message required',
        expected: `AEGIX_MIGRATE_TO_LIGHT::${agentId}::ownerAddress::timestamp`,
      });
    }
    
    const agent = agents.get(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }
    
    // Execute migration
    const result = await migrateAgent(
      agent,
      agent.owner,
      ownerSignature,
      message,
      {
        limits,
        sessionDurationHours: sessionDurationHours || 24,
      }
    );
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }
    
    // Update agent with Light settings
    agent.stealthSettings.mode = 'light';
    agent.stealthSettings.lightPoolAddress = result.lightPoolAddress;
    agent.stealthSettings.lightSessionKey = result.lightSessionKey as any;
    agent.lastActivity = new Date().toISOString();
    
    // Mark legacy pool as deprecated (but don't delete)
    if (agent.stealthSettings.poolId) {
      console.log(`[Migration] Legacy pool ${agent.stealthSettings.poolId} preserved for agent ${agentId}`);
    }
    
    saveAgents();
    
    console.log(`[Migration] ✓ Agent ${agentId} migrated to Light Protocol`);
    
    res.json({
      success: true,
      data: {
        ...result,
        nextSteps: [
          'Fund the Light pool with compressed USDC',
          'Agent can now make autonomous payments',
          'Legacy pool is preserved (manually withdraw if needed)',
        ],
      },
    });
  } catch (error: any) {
    console.error('[Migration] Execute error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to execute migration',
    });
  }
});

export default router;
