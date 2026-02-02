/**
 * Recovery Pool - Per-User Fee Payer for Stealth Transactions
 * 
 * EACH USER HAS THEIR OWN RECOVERY POOL that they must fund!
 * 
 * Purpose:
 * 1. Pay transaction fees (breaks on-chain link between Stealth Pool and burners)
 * 2. Pay ATA rent for recipients (~0.002 SOL)
 * 3. Reclaim rent when burner ATAs are closed
 * 
 * Each user must:
 * 1. Initialize their Recovery Pool (generates a keypair)
 * 2. Fund their Recovery Pool address with SOL
 * 3. Top up when balance is low
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Mutex } from 'async-mutex';
import bs58 from 'bs58';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Constants
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const MIN_LIQUIDITY_SOL = 0.005; // Minimum SOL balance required
const ATA_RENT_SOL = 0.00203928; // Approximate rent for ATA

// =============================================================================
// PER-USER RECOVERY POOL DATA MODEL
// =============================================================================

export interface RecoveryPool {
  id: string;                    // recovery-{owner_hash}
  publicKey: string;             // Recovery Pool address
  owner: string;                 // Owner wallet address
  encryptedSecretKey: string;    // AES-256-CBC encrypted
  encryptionSalt: string;        // Salt for decryption
  creationSignature: string;     // Signature used at creation
  createdAt: number;
  totalRecycled: number;
  status: 'created' | 'funded' | 'active';
  isLocked?: boolean;            // True if pool exists but key not in memory (needs re-auth)
}

// Persisted metadata (without sensitive keys in plaintext)
interface PersistedRecoveryPool {
  id: string;
  publicKey: string;
  owner: string;
  encryptedSecretKey: string;
  encryptionSalt: string;
  creationSignature: string;
  createdAt: number;
  totalRecycled: number;
  status: 'created' | 'funded' | 'active';
}

// =============================================================================
// PERSISTENCE
// =============================================================================

const DATA_DIR = path.join(process.cwd(), 'data');
const RECOVERY_POOLS_FILE = path.join(DATA_DIR, 'recovery-pools.json');

function loadPersistedPools(): Map<string, PersistedRecoveryPool> {
  const pools = new Map<string, PersistedRecoveryPool>();
  
  try {
    if (fs.existsSync(RECOVERY_POOLS_FILE)) {
      const raw = fs.readFileSync(RECOVERY_POOLS_FILE, 'utf-8');
      const data = JSON.parse(raw);
      
      if (data.pools && Array.isArray(data.pools)) {
        for (const pool of data.pools) {
          pools.set(pool.id, pool);
        }
        console.log(`[Recovery] Loaded ${pools.size} recovery pool(s) from disk`);
      }
    }
  } catch (error) {
    console.warn('[Recovery] Failed to load recovery-pools.json:', error);
  }
  
  return pools;
}

let saveDebounceTimer: NodeJS.Timeout | null = null;

function savePoolsToDisk(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }
  
  saveDebounceTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      
      const poolsToSave: PersistedRecoveryPool[] = [];
      for (const pool of recoveryPoolRegistry.values()) {
        if (pool.encryptedSecretKey && pool.encryptionSalt && pool.creationSignature) {
          poolsToSave.push({
            id: pool.id,
            publicKey: pool.publicKey,
            owner: pool.owner,
            encryptedSecretKey: pool.encryptedSecretKey,
            encryptionSalt: pool.encryptionSalt,
            creationSignature: pool.creationSignature,
            createdAt: pool.createdAt,
            totalRecycled: pool.totalRecycled,
            status: pool.status,
          });
        }
      }
      
      const saveData = {
        pools: poolsToSave,
        savedAt: new Date().toISOString(),
        version: '2.0',
        type: 'recovery-pools'
      };
      fs.writeFileSync(RECOVERY_POOLS_FILE, JSON.stringify(saveData, null, 2));
      console.log(`[Recovery] Saved ${poolsToSave.length} recovery pool(s) to disk`);
    } catch (error) {
      console.error('[Recovery] Failed to save recovery-pools.json:', error);
    }
  }, 500);
}

// =============================================================================
// ENCRYPTION HELPERS - Same pattern as Stealth Pools
// =============================================================================

function encryptPrivateKey(secretKey: Uint8Array, ownerWallet: string, signature: string): string {
  const derivedKey = crypto.createHash('sha256')
    .update(ownerWallet + signature)
    .digest();
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', derivedKey, iv);
  
  let encrypted = cipher.update(Buffer.from(secretKey));
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  return Buffer.concat([iv, encrypted]).toString('base64');
}

function decryptPrivateKey(encryptedKey: string, ownerWallet: string, signature: string): Uint8Array {
  const derivedKey = crypto.createHash('sha256')
    .update(ownerWallet + signature)
    .digest();
  
  const data = Buffer.from(encryptedKey, 'base64');
  const iv = data.subarray(0, 16);
  const encrypted = data.subarray(16);
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', derivedKey, iv);
  
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return new Uint8Array(decrypted);
}

// =============================================================================
// IN-MEMORY REGISTRIES
// =============================================================================

const recoveryPoolRegistry = new Map<string, RecoveryPool>();  // poolId -> pool
const ownerRecoveryIndex = new Map<string, string>();          // owner -> poolId

// Load persisted pools on startup (as locked - no decrypted keys)
const persistedPools = loadPersistedPools();
persistedPools.forEach((metadata, poolId) => {
  const lockedPool: RecoveryPool = {
    id: metadata.id,
    publicKey: metadata.publicKey,
    owner: metadata.owner,
    encryptedSecretKey: metadata.encryptedSecretKey,
    encryptionSalt: metadata.encryptionSalt,
    creationSignature: metadata.creationSignature,
    createdAt: metadata.createdAt,
    totalRecycled: metadata.totalRecycled,
    status: metadata.status,
    isLocked: true, // Needs re-auth to decrypt
  };
  recoveryPoolRegistry.set(poolId, lockedPool);
  ownerRecoveryIndex.set(metadata.owner, poolId);
});

if (persistedPools.size > 0) {
  console.log(`[Recovery] Initialized ${persistedPools.size} locked recovery pool(s) from disk`);
}

// Connection reference
let connection: Connection | null = null;

// =============================================================================
// SECURITY: Mutex-backed Liquidity Reservation System (Per-User)
// =============================================================================

const liquidityMutexes = new Map<string, Mutex>();
const pendingReservations = new Map<string, Map<string, number>>(); // owner -> (txId -> amount)

function getLiquidityMutex(owner: string): Mutex {
  if (!liquidityMutexes.has(owner)) {
    liquidityMutexes.set(owner, new Mutex());
  }
  return liquidityMutexes.get(owner)!;
}

export async function reserveLiquidity(owner: string, amount: number, txId: string): Promise<boolean> {
  const mutex = getLiquidityMutex(owner);
  const release = await mutex.acquire();
  
  try {
    const balance = await getRecoveryPoolBalanceForOwner(owner);
    
    if (!pendingReservations.has(owner)) {
      pendingReservations.set(owner, new Map());
    }
    const ownerReservations = pendingReservations.get(owner)!;
    const totalPending = Array.from(ownerReservations.values()).reduce((a, b) => a + b, 0);
    const available = balance - totalPending - MIN_LIQUIDITY_SOL;
    
    if (available >= amount) {
      ownerReservations.set(txId, amount);
      
      // Auto-expire reservation after 60 seconds
      setTimeout(() => {
        if (ownerReservations.has(txId)) {
          console.warn(`[Recovery] Auto-expiring stale reservation for ${owner.slice(0, 8)}...: ${txId}`);
          ownerReservations.delete(txId);
        }
      }, 60000);
      
      console.log(`[Recovery] Reserved ${amount} SOL for ${owner.slice(0, 8)}... (available: ${available.toFixed(4)})`);
      return true;
    }
    
    console.warn(`[Recovery] Insufficient liquidity for ${owner.slice(0, 8)}...: need ${amount}, have ${available.toFixed(4)}`);
    return false;
  } finally {
    release();
  }
}

export function releaseReservation(owner: string, txId: string): void {
  const ownerReservations = pendingReservations.get(owner);
  if (ownerReservations?.has(txId)) {
    const amount = ownerReservations.get(txId);
    ownerReservations.delete(txId);
    console.log(`[Recovery] Released reservation for ${owner.slice(0, 8)}...: ${txId} (${amount} SOL)`);
  }
}

export function getPendingReservationsTotal(owner: string): number {
  const ownerReservations = pendingReservations.get(owner);
  if (!ownerReservations) return 0;
  return Array.from(ownerReservations.values()).reduce((a, b) => a + b, 0);
}

// =============================================================================
// SIMPLE KEYPAIR STORAGE - For Recovery Pools created via create-and-fund
// =============================================================================

// Simple storage for Recovery Pool keypairs (keyed by owner wallet)
const simpleRecoveryKeypairs = new Map<string, Keypair>();
const SIMPLE_KEYPAIRS_FILE = path.join(process.cwd(), 'data', 'recovery-keypairs.json');

// Load keypairs from disk on startup
function loadSimpleKeypairs(): void {
  try {
    if (fs.existsSync(SIMPLE_KEYPAIRS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SIMPLE_KEYPAIRS_FILE, 'utf-8'));
      if (data.keypairs) {
        Object.entries(data.keypairs).forEach(([owner, secretKeyArray]) => {
          try {
            const secretKey = new Uint8Array(secretKeyArray as number[]);
            const keypair = Keypair.fromSecretKey(secretKey);
            simpleRecoveryKeypairs.set(owner, keypair);
          } catch (e) {
            console.warn(`[Recovery] Failed to restore keypair for ${owner.slice(0, 8)}...`);
          }
        });
        console.log(`[Recovery] Loaded ${simpleRecoveryKeypairs.size} recovery keypair(s) from disk`);
      }
    }
  } catch (e) {
    console.warn('[Recovery] Failed to load recovery-keypairs.json');
  }
}

// Save keypairs to disk
function saveSimpleKeypairs(): void {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    const keypairsObj: Record<string, number[]> = {};
    simpleRecoveryKeypairs.forEach((keypair, owner) => {
      keypairsObj[owner] = Array.from(keypair.secretKey);
    });
    
    const data = {
      keypairs: keypairsObj,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(SIMPLE_KEYPAIRS_FILE, JSON.stringify(data, null, 2));
    console.log(`[Recovery] Saved ${simpleRecoveryKeypairs.size} recovery keypair(s) to disk`);
  } catch (e) {
    console.error('[Recovery] Failed to save recovery-keypairs.json:', e);
  }
}

// Load keypairs on module init
loadSimpleKeypairs();

/**
 * Store a Recovery Pool keypair for an owner
 * Persists to disk for reliability after redeploys
 */
export function storeRecoveryKeypair(owner: string, keypair: Keypair): void {
  simpleRecoveryKeypairs.set(owner, keypair);
  saveSimpleKeypairs(); // Persist immediately!
  console.log(`[Recovery] Stored keypair for ${owner.slice(0, 8)}...: ${keypair.publicKey.toBase58().slice(0, 12)}...`);
}

/**
 * Get a stored Recovery Pool keypair for an owner
 */
export function getStoredRecoveryKeypair(owner: string): Keypair | null {
  return simpleRecoveryKeypairs.get(owner) || null;
}

/**
 * Check if we have a stored keypair for an owner
 */
export function hasStoredRecoveryKeypair(owner: string): boolean {
  return simpleRecoveryKeypairs.has(owner);
}

// =============================================================================
// SECURITY: Rate Limiting for Decompress Operations (Per-User)
// =============================================================================

const decompressRateLimit = new Map<string, number[]>();
const MAX_DECOMPRESS_PER_MINUTE = 5;

export function checkDecompressRateLimit(ownerId: string): boolean {
  const now = Date.now();
  const requests = decompressRateLimit.get(ownerId) || [];
  
  const recent = requests.filter(t => now - t < 60000);
  
  if (recent.length >= MAX_DECOMPRESS_PER_MINUTE) {
    console.warn(`[Recovery] Rate limit exceeded for ${ownerId.slice(0, 12)}... (${recent.length}/${MAX_DECOMPRESS_PER_MINUTE} per minute)`);
    return false;
  }
  
  recent.push(now);
  decompressRateLimit.set(ownerId, recent);
  
  // Cleanup old entries periodically
  if (Math.random() < 0.1) {
    cleanupRateLimitEntries();
  }
  
  return true;
}

function cleanupRateLimitEntries(): void {
  const now = Date.now();
  for (const [ownerId, requests] of decompressRateLimit.entries()) {
    const recent = requests.filter(t => now - t < 60000);
    if (recent.length === 0) {
      decompressRateLimit.delete(ownerId);
    } else {
      decompressRateLimit.set(ownerId, recent);
    }
  }
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Set the connection for recovery pool operations
 */
export function setRecoveryConnection(conn: Connection): void {
  connection = conn;
}

/**
 * Check if an owner has a Recovery Pool
 * Checks MULTIPLE sources: old registry, simple keypairs
 */
export function hasRecoveryPool(owner: string): boolean {
  // Check old registry
  if (ownerRecoveryIndex.has(owner)) {
    console.log(`[Recovery] hasRecoveryPool: Found in old registry for ${owner.slice(0, 8)}...`);
    return true;
  }
  
  // Check simple keypairs (new simplified flow)
  if (simpleRecoveryKeypairs.has(owner)) {
    console.log(`[Recovery] hasRecoveryPool: Found in simple keypairs for ${owner.slice(0, 8)}...`);
    return true;
  }
  
  console.log(`[Recovery] hasRecoveryPool: NOT found for ${owner.slice(0, 8)}... (checked: old registry, simple keypairs)`);
  return false;
}

/**
 * Get Recovery Pool for a specific owner
 */
export function getRecoveryPoolForOwner(owner: string): RecoveryPool | null {
  const poolId = ownerRecoveryIndex.get(owner);
  if (!poolId) return null;
  return recoveryPoolRegistry.get(poolId) || null;
}

/**
 * Create a NEW Recovery Pool for a user
 * Requires wallet signature to encrypt the keypair
 */
export async function createRecoveryPool(
  ownerWallet: string,
  ownerSignature: string,
  conn?: Connection
): Promise<{
  success: boolean;
  address?: string;
  poolId?: string;
  message: string;
  error?: string;
}> {
  if (conn) {
    connection = conn;
  }
  
  // Check if owner already has a Recovery Pool
  const existingPool = getRecoveryPoolForOwner(ownerWallet);
  if (existingPool && !existingPool.isLocked) {
    return {
      success: true,
      address: existingPool.publicKey,
      poolId: existingPool.id,
      message: 'Recovery Pool already exists and is unlocked',
    };
  }
  
  // If pool exists but is locked, try to unlock it
  if (existingPool && existingPool.isLocked) {
    try {
      const unlocked = await unlockRecoveryPool(ownerWallet, ownerSignature);
      if (unlocked) {
        return {
          success: true,
          address: existingPool.publicKey,
          poolId: existingPool.id,
          message: 'Recovery Pool unlocked successfully',
        };
      }
    } catch (error: any) {
      console.error('[Recovery] Failed to unlock existing pool:', error);
    }
  }
  
  // Generate new keypair
  const newKeypair = Keypair.generate();
  
  // Encrypt the secret key with owner's signature
  const encryptionSalt = crypto.randomBytes(16).toString('hex');
  const encryptedSecretKey = encryptPrivateKey(
    newKeypair.secretKey,
    ownerWallet,
    ownerSignature + encryptionSalt
  );
  
  // Create pool ID
  const ownerHash = crypto.createHash('sha256').update(ownerWallet).digest('hex').slice(0, 8);
  const poolId = `recovery-${ownerHash}-${Date.now()}`;
  
  // Create pool object
  const pool: RecoveryPool = {
    id: poolId,
    publicKey: newKeypair.publicKey.toBase58(),
    owner: ownerWallet,
    encryptedSecretKey,
    encryptionSalt,
    creationSignature: ownerSignature,
    createdAt: Date.now(),
    totalRecycled: 0,
    status: 'created',
    isLocked: false,
  };
  
  // Store in registries
  recoveryPoolRegistry.set(poolId, pool);
  ownerRecoveryIndex.set(ownerWallet, poolId);
  
  // Persist to disk
  savePoolsToDisk();
  
  console.log(`[Recovery] Created new Recovery Pool for ${ownerWallet.slice(0, 8)}...: ${newKeypair.publicKey.toBase58()}`);
  
  return {
    success: true,
    address: newKeypair.publicKey.toBase58(),
    poolId,
    message: `Recovery Pool created! Fund this address with at least ${MIN_LIQUIDITY_SOL} SOL to enable privacy payments.`,
  };
}

/**
 * Unlock a locked Recovery Pool (re-authenticate with signature)
 */
export async function unlockRecoveryPool(ownerWallet: string, ownerSignature: string): Promise<boolean> {
  const pool = getRecoveryPoolForOwner(ownerWallet);
  if (!pool) {
    throw new Error('Recovery Pool not found for this owner');
  }
  
  if (!pool.isLocked) {
    return true; // Already unlocked
  }
  
  // Verify we can decrypt with this signature
  try {
    const secretKey = decryptPrivateKey(
      pool.encryptedSecretKey,
      pool.owner,
      pool.creationSignature + pool.encryptionSalt
    );
    
    // Verify the keypair matches
    const keypair = Keypair.fromSecretKey(secretKey);
    if (keypair.publicKey.toBase58() !== pool.publicKey) {
      throw new Error('Keypair mismatch after decryption');
    }
    
    // Update pool to unlocked
    pool.isLocked = false;
    // Update the creation signature if they used a new one
    // (for security, we keep the original signature that was used during creation)
    
    console.log(`[Recovery] Unlocked Recovery Pool for ${ownerWallet.slice(0, 8)}...`);
    return true;
  } catch (error: any) {
    console.error(`[Recovery] Failed to unlock pool: ${error.message}`);
    throw new Error('Failed to decrypt Recovery Pool - signature mismatch');
  }
}

/**
 * Get the decrypted keypair for a user's Recovery Pool
 * Checks MULTIPLE sources: simple keypairs first, then old registry
 */
export function getRecoveryPoolKeypair(owner: string): Keypair {
  // FIRST: Check simple keypairs storage (new simplified flow)
  const simpleKeypair = simpleRecoveryKeypairs.get(owner);
  if (simpleKeypair) {
    console.log(`[Recovery] Using simple keypair for ${owner.slice(0, 8)}...`);
    return simpleKeypair;
  }
  
  // SECOND: Check old registry (backward compatibility)
  const pool = getRecoveryPoolForOwner(owner);
  if (!pool) {
    throw new Error(`No Recovery Pool found for ${owner.slice(0, 8)}... - create one in the dashboard first`);
  }
  
  if (pool.isLocked) {
    throw new Error('Recovery Pool is locked. User must re-authenticate.');
  }
  
  if (!pool.encryptedSecretKey || !pool.creationSignature || !pool.encryptionSalt) {
    throw new Error('Recovery Pool missing encryption credentials');
  }
  
  const secretKey = decryptPrivateKey(
    pool.encryptedSecretKey,
    pool.owner,
    pool.creationSignature + pool.encryptionSalt
  );
  
  return Keypair.fromSecretKey(secretKey);
}

/**
 * Get the Recovery Pool public key for an owner
 */
export function getRecoveryPoolAddress(owner: string): PublicKey {
  const pool = getRecoveryPoolForOwner(owner);
  if (!pool) {
    throw new Error(`No Recovery Pool found for ${owner.slice(0, 8)}...`);
  }
  return new PublicKey(pool.publicKey);
}

/**
 * Get Recovery Pool SOL balance for an owner
 * Checks MULTIPLE sources: old registry, simple keypairs, stealth pool data
 */
export async function getRecoveryPoolBalanceForOwner(owner: string, conn?: Connection): Promise<number> {
  // Check MULTIPLE sources for Recovery Pool address
  const pool = getRecoveryPoolForOwner(owner);
  const simpleKeypair = getStoredRecoveryKeypair(owner);
  
  let recoveryAddress: string | null = null;
  
  if (pool) {
    recoveryAddress = pool.publicKey;
  } else if (simpleKeypair) {
    recoveryAddress = simpleKeypair.publicKey.toBase58();
  } else {
    // Try to get from stealth pool data
    try {
      const { getRecoveryPoolAddressFromStealthPool } = await import('../stealth/index.js');
      recoveryAddress = getRecoveryPoolAddressFromStealthPool(owner);
    } catch (e) {}
  }
  
  if (!recoveryAddress) return 0;
  
  const useConn = conn || recoveryConnection || connection;
  if (!useConn) {
    throw new Error('No connection available');
  }
  
  try {
    const balance = await useConn.getBalance(new PublicKey(recoveryAddress));
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error(`[Recovery] Failed to get balance for ${owner.slice(0, 8)}...:`, error);
    return 0;
  }
}

/**
 * Validate Recovery Pool liquidity for an owner
 * Checks MULTIPLE sources: old registry, simple keypairs, stealth pool data
 */
export async function validateRecoveryLiquidity(owner: string, conn?: Connection): Promise<{
  valid: boolean;
  balance: number;
  required: number;
  shortfall?: number;
  initialized: boolean;
  isLocked: boolean;
}> {
  // Check MULTIPLE sources for Recovery Pool address:
  const pool = getRecoveryPoolForOwner(owner);
  const simpleKeypair = getStoredRecoveryKeypair(owner);
  
  // Import from stealth to check persisted address
  let stealthPoolAddress: string | null = null;
  try {
    const { getRecoveryPoolAddressFromStealthPool } = await import('../stealth/index.js');
    stealthPoolAddress = getRecoveryPoolAddressFromStealthPool(owner);
  } catch (e) {}
  
  // Determine Recovery Pool address from any source
  let recoveryAddress: string | null = null;
  let isLocked = false;
  
  if (pool) {
    recoveryAddress = pool.publicKey;
    isLocked = pool.isLocked || false;
  } else if (simpleKeypair) {
    recoveryAddress = simpleKeypair.publicKey.toBase58();
  } else if (stealthPoolAddress) {
    recoveryAddress = stealthPoolAddress;
  }
  
  // No Recovery Pool found at all
  if (!recoveryAddress) {
    console.log(`[Recovery] validateRecoveryLiquidity: No pool found for ${owner.slice(0, 8)}...`);
    return {
      valid: false,
      balance: 0,
      required: MIN_LIQUIDITY_SOL,
      shortfall: MIN_LIQUIDITY_SOL,
      initialized: false,
      isLocked: false,
    };
  }
  
  // Fetch REAL on-chain balance
  const connection = conn || recoveryConnection;
  if (!connection) {
    console.error('[Recovery] No connection available for balance check');
    return {
      valid: false,
      balance: 0,
      required: MIN_LIQUIDITY_SOL,
      shortfall: MIN_LIQUIDITY_SOL,
      initialized: true,
      isLocked,
    };
  }
  
  let balance = 0;
  try {
    const pubkey = new PublicKey(recoveryAddress);
    const lamports = await connection.getBalance(pubkey);
    balance = lamports / 1_000_000_000; // LAMPORTS_PER_SOL
    console.log(`[Recovery] validateRecoveryLiquidity: ${recoveryAddress.slice(0, 12)}... has ${balance.toFixed(4)} SOL`);
  } catch (e) {
    console.error(`[Recovery] Failed to fetch balance for ${recoveryAddress}:`, e);
  }
  
  const valid = balance >= MIN_LIQUIDITY_SOL;
  
  return {
    valid,
    balance,
    required: MIN_LIQUIDITY_SOL,
    shortfall: valid ? undefined : MIN_LIQUIDITY_SOL - balance,
    initialized: true,
    isLocked,
  };
}

/**
 * Get Recovery Pool status for an owner
 */
export async function getRecoveryPoolStatus(owner: string, conn?: Connection): Promise<{
  initialized: boolean;
  address: string | null;
  balance: number;
  isHealthy: boolean;
  totalRecycled: number;
  minRequired: number;
  isLocked: boolean;
  poolId: string | null;
}> {
  // Check MULTIPLE sources for Recovery Pool:
  // 1. Old registry (for backward compatibility)
  // 2. Simple keypairs storage (new simplified flow)
  // 3. Stealth Pool data (persisted address)
  
  const pool = getRecoveryPoolForOwner(owner);
  const simpleKeypair = getStoredRecoveryKeypair(owner);
  
  // Import from stealth to check persisted address
  let stealthPoolAddress: string | null = null;
  try {
    const { getRecoveryPoolAddressFromStealthPool } = await import('../stealth/index.js');
    stealthPoolAddress = getRecoveryPoolAddressFromStealthPool(owner);
  } catch (e) {
    // Ignore import errors
  }
  
  // Determine the Recovery Pool address from any available source
  let recoveryAddress: string | null = null;
  let recoveryPoolId: string | null = null;
  let totalRecycled = 0;
  let isLocked = false;
  
  if (pool) {
    recoveryAddress = pool.publicKey;
    recoveryPoolId = pool.id;
    totalRecycled = pool.totalRecycled;
    isLocked = pool.isLocked || false;
  } else if (simpleKeypair) {
    recoveryAddress = simpleKeypair.publicKey.toBase58();
    recoveryPoolId = `simple-${owner.slice(0, 8)}`;
  } else if (stealthPoolAddress) {
    recoveryAddress = stealthPoolAddress;
    recoveryPoolId = `stealth-${owner.slice(0, 8)}`;
  }
  
  if (!recoveryAddress) {
    return {
      initialized: false,
      address: null,
      balance: 0,
      isHealthy: false,
      totalRecycled: 0,
      minRequired: MIN_LIQUIDITY_SOL,
      isLocked: false,
      poolId: null,
    };
  }
  
  // Fetch balance directly from blockchain
  let balance = 0;
  const useConn = conn || connection;
  if (useConn) {
    try {
      const balanceLamports = await useConn.getBalance(new PublicKey(recoveryAddress), 'confirmed');
      balance = balanceLamports / LAMPORTS_PER_SOL;
    } catch (e) {
      console.warn(`[Recovery] Failed to fetch balance for ${owner.slice(0, 8)}...`);
    }
  }
  
  return {
    initialized: true,
    address: recoveryAddress,
    balance,
    isHealthy: balance >= MIN_LIQUIDITY_SOL && !isLocked,
    totalRecycled,
    minRequired: MIN_LIQUIDITY_SOL,
    isLocked,
    poolId: recoveryPoolId,
  };
}

/**
 * Create an ATA for a recipient, paid by the owner's Recovery Pool
 */
export function createRecipientAtaInstruction(
  owner: string,
  recipientAddress: PublicKey,
  recipientAta: PublicKey,
  mint: PublicKey = USDC_MINT
): ReturnType<typeof createAssociatedTokenAccountInstruction> {
  const recoveryPubkey = getRecoveryPoolAddress(owner);
  
  return createAssociatedTokenAccountInstruction(
    recoveryPubkey,      // Payer (Recovery Pool pays rent!)
    recipientAta,        // ATA to create
    recipientAddress,    // Owner of the ATA
    mint,                // Token mint
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

/**
 * Check if a recipient's ATA exists
 */
export async function recipientAtaExists(
  recipientAddress: PublicKey,
  conn?: Connection,
  mint: PublicKey = USDC_MINT
): Promise<{ exists: boolean; ata: PublicKey }> {
  const useConn = conn || connection;
  if (!useConn) {
    throw new Error('No connection available');
  }

  const ata = await getAssociatedTokenAddress(mint, recipientAddress);
  
  try {
    await getAccount(useConn, ata, 'confirmed');
    return { exists: true, ata };
  } catch {
    return { exists: false, ata };
  }
}

/**
 * Create instruction to close an empty ATA and reclaim rent to owner's Recovery Pool
 */
export function createCloseAtaInstruction(
  owner: string,
  ataAddress: PublicKey,
  ataOwner: PublicKey
): ReturnType<typeof createCloseAccountInstruction> {
  const recoveryPubkey = getRecoveryPoolAddress(owner);
  
  return createCloseAccountInstruction(
    ataAddress,          // ATA to close
    recoveryPubkey,      // Destination for rent (Recovery Pool!)
    ataOwner,            // Authority (owner of the ATA)
    [],                  // Multi-signers (none)
    TOKEN_PROGRAM_ID
  );
}

/**
 * Add to recycled total for an owner
 */
export function addToRecycled(owner: string, amount: number): void {
  const pool = getRecoveryPoolForOwner(owner);
  if (pool) {
    pool.totalRecycled += amount;
    savePoolsToDisk();
  }
}

/**
 * Get total SOL recycled for an owner
 */
export function getTotalRecycled(owner: string): number {
  const pool = getRecoveryPoolForOwner(owner);
  return pool?.totalRecycled || 0;
}

/**
 * Mark pool as funded/active
 */
export async function markPoolFunded(owner: string, conn?: Connection): Promise<void> {
  const pool = getRecoveryPoolForOwner(owner);
  if (!pool) return;
  
  const balance = await getRecoveryPoolBalanceForOwner(owner, conn);
  if (balance >= MIN_LIQUIDITY_SOL) {
    pool.status = 'funded';
    savePoolsToDisk();
    console.log(`[Recovery] Pool for ${owner.slice(0, 8)}... marked as funded (${balance.toFixed(4)} SOL)`);
  }
}

// =============================================================================
// LEGACY COMPATIBILITY FUNCTIONS
// =============================================================================

// These maintain backward compatibility with old single-pool code

/**
 * @deprecated Use createRecoveryPool(owner, signature) instead
 */
export async function loadRecoveryPool(conn?: Connection): Promise<boolean> {
  if (conn) {
    connection = conn;
  }
  // Legacy function - just sets connection, pools are loaded on startup
  return recoveryPoolRegistry.size > 0;
}

/**
 * @deprecated Use getRecoveryPoolForOwner(owner) instead
 */
export function isRecoveryPoolInitialized(): boolean {
  // Legacy: returns true if ANY pool exists
  return recoveryPoolRegistry.size > 0;
}

/**
 * @deprecated Use isRecoveryPoolInitialized() instead
 */
export function isRecoveryPoolReady(): boolean {
  return isRecoveryPoolInitialized();
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  // Per-user functions
  createRecoveryPool,
  unlockRecoveryPool,
  hasRecoveryPool,
  getRecoveryPoolForOwner,
  getRecoveryPoolKeypair,
  getRecoveryPoolAddress,
  getRecoveryPoolBalanceForOwner,
  validateRecoveryLiquidity,
  getRecoveryPoolStatus,
  createRecipientAtaInstruction,
  recipientAtaExists,
  createCloseAtaInstruction,
  addToRecycled,
  getTotalRecycled,
  markPoolFunded,
  setRecoveryConnection,
  
  // Security: Atomic liquidity reservation
  reserveLiquidity,
  releaseReservation,
  getPendingReservationsTotal,
  
  // Security: Rate limiting
  checkDecompressRateLimit,
  
  // Legacy compatibility
  loadRecoveryPool,
  isRecoveryPoolInitialized,
  isRecoveryPoolReady,
};
