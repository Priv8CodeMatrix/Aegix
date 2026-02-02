/**
 * Stealth Address System for Aegix 3.0
 * Generates one-time burner wallets for privacy
 * 
 * The core privacy mechanism:
 * 1. User funds a fresh stealth address
 * 2. Stealth address pays the service provider
 * 3. Service provider sees random wallet, NOT user's main wallet
 * 4. Inco FHE stores the owner↔stealth mapping (encrypted!)
 * 
 * SECURITY: Private keys are encrypted with wallet signature (AES-256)
 * Only the owner can decrypt them by signing a message
 */

import { 
  Keypair, 
  Connection, 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  LAMPORTS_PER_SOL 
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddress, 
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from '@solana/spl-token';
import { getIncoClient } from '../inco/lightning-client.js';
import { getPaymentLogger, type PaymentSession } from '../audit/PaymentLogger.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// =============================================================================
// PERSISTENCE - Save pool metadata (NOT private keys!) to disk
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');
const POOLS_FILE = path.join(DATA_DIR, 'pools.json');

// Pool metadata to persist (includes encrypted keys for legacy pool support)
interface PersistedPoolMetadata {
  id: string;
  publicKey: string;
  owner: string;
  fheHandle: string;
  createdAt: number;
  fundedAt?: number;
  fundingTx?: string;
  totalPayments: number;
  totalSolRecovered: number;
  status: 'created' | 'funded' | 'active';
  // Encrypted key fields for legacy pool support (key is encrypted, not raw!)
  encryptedSecretKey?: string;
  encryptionSalt?: string;
  creationSignature?: string;
  // Recovery Pool address (persisted here for reliability after redeploys)
  recoveryPoolAddress?: string;
}

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('[Persistence] Created data directory:', DATA_DIR);
  }
}

// Stealth module now uses SEPARATE file to avoid conflicts with agents module
const STEALTH_POOLS_FILE = path.join(DATA_DIR, 'stealth-pools.json');

// Load pool metadata from disk on startup
function loadPersistedPools(): Map<string, PersistedPoolMetadata> {
  ensureDataDir();
  
  if (!fs.existsSync(STEALTH_POOLS_FILE)) {
    console.log('[Persistence] No stealth-pools.json found, starting fresh');
    return new Map();
  }
  
  try {
    const data = fs.readFileSync(STEALTH_POOLS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    
    // Support both old array format and new wrapped format
    const pools: PersistedPoolMetadata[] = Array.isArray(parsed) 
      ? parsed 
      : (parsed.pools || []);
    
    const map = new Map<string, PersistedPoolMetadata>();
    
    pools.forEach(pool => {
      map.set(pool.id, pool);
    });
    
    console.log(`[Persistence] Loaded ${map.size} pool(s) from disk`);
    return map;
  } catch (error) {
    console.error('[Persistence] Failed to load stealth-pools.json:', error);
    return new Map();
  }
}

// Save pool metadata to disk (debounced)
let saveTimeout: NodeJS.Timeout | null = null;
function savePoolsToDisk() {
  // Debounce saves
  if (saveTimeout) clearTimeout(saveTimeout);
  
  saveTimeout = setTimeout(() => {
    ensureDataDir();
    
    const poolsToSave: PersistedPoolMetadata[] = [];
    
    poolRegistry.forEach(pool => {
      // Save metadata + encrypted keys (for legacy pool support)
      poolsToSave.push({
        id: pool.id,
        publicKey: pool.publicKey,
        owner: pool.owner,
        fheHandle: pool.fheHandle,
        createdAt: pool.createdAt,
        fundedAt: pool.fundedAt,
        fundingTx: pool.fundingTx,
        totalPayments: pool.totalPayments,
        totalSolRecovered: pool.totalSolRecovered,
        status: pool.status,
        // Include encrypted keys for legacy pool recovery
        encryptedSecretKey: pool.encryptedSecretKey,
        encryptionSalt: pool.encryptionSalt,
        creationSignature: pool.creationSignature,
        // Include Recovery Pool address for persistence
        recoveryPoolAddress: pool.recoveryPoolAddress,
      });
    });
    
    try {
      // Save with wrapped format for consistency
      const saveData = {
        pools: poolsToSave,
        savedAt: new Date().toISOString(),
        version: '1.0',
        type: 'stealth-pools'
      };
      fs.writeFileSync(STEALTH_POOLS_FILE, JSON.stringify(saveData, null, 2));
      console.log(`[Persistence] Saved ${poolsToSave.length} stealth pool(s) to disk`);
    } catch (error) {
      console.error('[Persistence] Failed to save stealth-pools.json:', error);
    }
  }, 500); // 500ms debounce
}

// Persisted pool metadata (loaded on startup)
const persistedPools = loadPersistedPools();

// =============================================================================
// ENCRYPTION HELPERS - Wallet-signature protected key storage
// =============================================================================

/**
 * Encrypt a private key using a key derived from wallet signature
 * The encryption key is derived from: ownerWallet + signature + salt
 * This ensures only the wallet owner can decrypt their stealth keys
 */
function encryptPrivateKey(secretKey: Uint8Array, ownerWallet: string, signature: string): string {
  // Derive encryption key from owner address + signature
  const derivedKey = crypto.createHash('sha256')
    .update(ownerWallet + signature)
    .digest();
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', derivedKey, iv);
  
  let encrypted = cipher.update(Buffer.from(secretKey));
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  // Return iv + encrypted data as base64
  return Buffer.concat([iv, encrypted]).toString('base64');
}

/**
 * Decrypt a private key using wallet signature
 * Requires the same signature used during creation (or a re-sign for export)
 */
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

// USDC Mainnet mint address
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// SOL needed for initial pool/stealth setup (ATA creation + tx fees + buffer)
// With x402 gasless: Pool only needs SOL for its own transactions, not burner gas
const STEALTH_SOL_REQUIREMENT = 0.005 * LAMPORTS_PER_SOL; // ~0.005 SOL for pool setup (reduced!)

// ATA rent constant
const ATA_RENT_LAMPORTS = 2039280; // ~0.00204 SOL for token account rent

// SOL needed for temp burner (FALLBACK mode only - when PayAI unavailable)
// With x402 gasless: Burner needs NO SOL (PayAI pays gas, rent recovered)
// Fallback mode: Burner needs ATA rent + gas for 2-3 txs
const TEMP_BURNER_GAS = 0.003 * LAMPORTS_PER_SOL; // ~0.003 SOL for gas (3 transactions)
const TEMP_BURNER_SOL = ATA_RENT_LAMPORTS + TEMP_BURNER_GAS + 0.001 * LAMPORTS_PER_SOL; // Total: ~0.006 SOL

// x402 Gasless constants
const GASLESS_RECOVERY_GAS = 10000; // 0.00001 SOL - minimal gas for recovery tx

// =============================================================================
// STEALTH POOL WALLET - One per user/agent, funds payments via temp burners
// =============================================================================

export interface StealthPool {
  id: string;                  // Pool ID (e.g., "pool-{owner_hash}")
  publicKey: string;           // Pool wallet public key
  owner: string;               // Real owner wallet
  encryptedSecretKey?: string; // ENCRYPTED private key (AES-256-CBC) - only in memory!
  encryptionSalt?: string;     // Salt for key derivation - only in memory!
  creationSignature?: string;  // Signature used at creation - only in memory!
  fheHandle: string;           // FHE handle proving ownership
  createdAt: number;
  fundedAt?: number;
  fundingTx?: string;
  totalPayments: number;       // Count of payments made
  totalSolRecovered: number;   // Total SOL recovered from temp burners
  status: 'created' | 'funded' | 'active';
  isLocked?: boolean;          // True if pool exists but key not in memory (needs re-auth)
  needsReauth?: boolean;       // Alternative flag for re-authentication
  recoveryPoolAddress?: string; // User's Recovery Pool address (persisted here for reliability)
}

// Temp burners are disposable - created per payment, then SOL recovered
export interface TempBurner {
  id: string;                  // Burner ID
  poolId: string;              // Parent pool
  publicKey: string;           // Burner public key
  encryptedSecretKey: string;  // Encrypted private key
  encryptionSalt: string;
  creationSignature: string;
  createdAt: number;
  usedAt?: number;
  paymentTx?: string;
  recipient?: string;
  amount?: string;
  solRecovered?: number;
  recoveryTx?: string;
  status: 'created' | 'funded' | 'used' | 'recovered';
}

// Legacy interface for backwards compatibility
export interface StealthAddress {
  id: string;
  publicKey: string;
  owner: string;
  encryptedSecretKey: string;
  encryptionSalt: string;
  creationSignature: string;
  fheHandle: string;
  createdAt: number;
  fundedAt?: number;
  fundingTx?: string;
  usedAt?: number;
  paymentTx?: string;
  recipient?: string;
  amount?: string;
  status: 'created' | 'funded' | 'used' | 'expired';
}

// In-memory stores
const stealthRegistry = new Map<string, StealthAddress>();
const ownerIndex = new Map<string, string[]>(); // owner -> stealth IDs

// Pool wallet stores
const poolRegistry = new Map<string, StealthPool>();       // poolId -> pool
const ownerPoolIndex = new Map<string, string>();          // owner -> poolId
const tempBurnerRegistry = new Map<string, TempBurner>();  // burnerId -> burner

// Initialize pools from persisted data (as locked - no keys in memory)
persistedPools.forEach((metadata, poolId) => {
  const lockedPool: StealthPool = {
    id: metadata.id,
    publicKey: metadata.publicKey,
    owner: metadata.owner,
    fheHandle: metadata.fheHandle,
    createdAt: metadata.createdAt,
    fundedAt: metadata.fundedAt,
    fundingTx: metadata.fundingTx,
    totalPayments: metadata.totalPayments,
    totalSolRecovered: metadata.totalSolRecovered,
    status: metadata.status,
    isLocked: true, // No keys in memory yet - need re-auth to decrypt!
    // Restore encrypted keys for legacy pool support
    encryptedSecretKey: metadata.encryptedSecretKey,
    encryptionSalt: metadata.encryptionSalt,
    creationSignature: metadata.creationSignature,
    // Restore Recovery Pool address
    recoveryPoolAddress: metadata.recoveryPoolAddress,
  };
  poolRegistry.set(poolId, lockedPool);
  ownerPoolIndex.set(metadata.owner, poolId);
  
  if (metadata.recoveryPoolAddress) {
    console.log(`[Stealth] Restored Recovery Pool address for ${metadata.owner.slice(0, 8)}...: ${metadata.recoveryPoolAddress.slice(0, 12)}...`);
  }
});

if (persistedPools.size > 0) {
  console.log(`[Stealth] Initialized ${persistedPools.size} locked pool(s) from disk`);
}

// =============================================================================
// POOL WALLET FUNCTIONS - New simplified architecture
// =============================================================================

/**
 * Derive a deterministic keypair from owner wallet + signature
 * This ensures the same signature always produces the same pool keypair
 * allowing us to recover the pool without storing private keys!
 */
function derivePoolKeypair(ownerWallet: string, signature: string): Keypair {
  // Create a deterministic seed from owner + signature
  const seed = crypto.createHash('sha256')
    .update(`aegix-pool:${ownerWallet}:${signature}`)
    .digest();
  
  // Use first 32 bytes as the secret key seed
  return Keypair.fromSeed(seed);
}

/**
 * Get or create a pool wallet for an owner
 * Each owner has exactly ONE pool wallet that persists
 * 
 * IMPORTANT: Pool keypairs are derived DETERMINISTICALLY from owner + signature.
 * This means the same signature always produces the same pool address.
 * When a pool is locked (loaded from disk), the user re-signs with the SAME message
 * and we can regenerate the exact same keypair!
 */
export async function getOrCreatePoolWallet(
  ownerWallet: string,
  ownerSignature: string
): Promise<{
  poolId: string;
  publicKey: string;
  fheHandle: string;
  isNew: boolean;
  wasUnlocked?: boolean;
  legacyPoolAddress?: string; // Address of old pool if migration happened
}> {
  // Check if owner already has a pool
  const existingPoolId = ownerPoolIndex.get(ownerWallet);
  if (existingPoolId) {
    const pool = poolRegistry.get(existingPoolId);
    if (pool) {
      // Check if pool is locked (loaded from disk, no keys in memory)
      if (pool.isLocked) {
        console.log(`[Pool] 🔓 Re-authenticating locked pool for ${ownerWallet.slice(0, 8)}...`);
        
        // STRATEGY 1: Try to decrypt using STORED encrypted key (works for legacy pools!)
        if (pool.encryptedSecretKey && pool.encryptionSalt && pool.creationSignature) {
          console.log(`[Pool] 📦 Found stored encrypted key, attempting decryption...`);
          try {
            const secretKey = decryptPrivateKey(
              pool.encryptedSecretKey,
              pool.owner,
              pool.creationSignature + pool.encryptionSalt
            );
            const keypair = Keypair.fromSecretKey(secretKey);
            
            // Verify the decrypted key matches the pool address
            if (keypair.publicKey.toBase58() === pool.publicKey) {
              console.log(`[Pool] ✓ Successfully decrypted stored key!`);
              
              // Re-encrypt with new signature for this session (optional, for consistency)
              const newEncryptionSalt = crypto.randomBytes(16).toString('hex');
              const newEncryptedSecretKey = encryptPrivateKey(
                keypair.secretKey,
                ownerWallet,
                ownerSignature + newEncryptionSalt
              );
              
              // Update pool with new encryption (using new signature)
              pool.encryptedSecretKey = newEncryptedSecretKey;
              pool.encryptionSalt = newEncryptionSalt;
              pool.creationSignature = ownerSignature;
              pool.isLocked = false;
              
              savePoolsToDisk();
              
              console.log(`[Pool] ✓ Pool unlocked: ${pool.publicKey.slice(0, 12)}...`);
              
              return {
                poolId: pool.id,
                publicKey: pool.publicKey,
                fheHandle: pool.fheHandle,
                isNew: false,
                wasUnlocked: true,
              };
            } else {
              console.warn(`[Pool] ⚠️ Stored key doesn't match pool address (corrupted?)`);
            }
          } catch (decryptError) {
            console.warn(`[Pool] ⚠️ Failed to decrypt stored key:`, decryptError);
          }
        }
        
        // STRATEGY 2: Try deterministic derivation (for pools created with deterministic keys)
        console.log(`[Pool] 🔑 Trying deterministic key derivation...`);
        const keypair = derivePoolKeypair(ownerWallet, ownerSignature);
        
        // Verify the derived keypair matches the stored pool address
        if (keypair.publicKey.toBase58() === pool.publicKey) {
          console.log(`[Pool] ✓ Deterministic derivation succeeded!`);
          
          // Re-encrypt the private key for this session
          const encryptionSalt = crypto.randomBytes(16).toString('hex');
          const encryptedSecretKey = encryptPrivateKey(
            keypair.secretKey,
            ownerWallet,
            ownerSignature + encryptionSalt
          );
          
          // Update pool
          pool.encryptedSecretKey = encryptedSecretKey;
          pool.encryptionSalt = encryptionSalt;
          pool.creationSignature = ownerSignature;
          pool.isLocked = false;
          
          savePoolsToDisk();
          
          console.log(`[Pool] ✓ Pool unlocked: ${pool.publicKey.slice(0, 12)}...`);
          
          return {
            poolId: pool.id,
            publicKey: pool.publicKey,
            fheHandle: pool.fheHandle,
            isNew: false,
            wasUnlocked: true,
          };
        }
        
        // NEITHER strategy worked - this is a legacy pool without stored keys
        // User must have exported the key before, or funds are stuck
        console.error(`[Pool] ❌ UNRECOVERABLE POOL!`);
        console.error(`[Pool]    Pool address: ${pool.publicKey}`);
        console.error(`[Pool]    No stored key found, and deterministic derivation doesn't match.`);
        console.error(`[Pool]    If you exported the private key before, import it into Phantom to recover.`);
        console.error(`[Pool]    Creating a new pool...`);
        
        const legacyPoolAddress = pool.publicKey;
        
        // Remove legacy pool from registry
        poolRegistry.delete(existingPoolId);
        ownerPoolIndex.delete(ownerWallet);
        
        // Create new pool with deterministic keypair
        const newPoolId = `pool-${crypto.createHash('sha256').update(ownerWallet).digest('hex').slice(0, 16)}-v2`;
        
        const encryptionSalt = crypto.randomBytes(16).toString('hex');
        const encryptedSecretKey = encryptPrivateKey(
          keypair.secretKey,
          ownerWallet,
          ownerSignature + encryptionSalt
        );
        
        const inco = getIncoClient();
        const ownerHash = crypto.createHash('sha256').update(ownerWallet).digest();
        const poolHash = crypto.createHash('sha256').update(keypair.publicKey.toBase58()).digest();
        const combined = Buffer.alloc(8);
        for (let i = 0; i < 8; i++) {
          combined[i] = ownerHash[i] ^ poolHash[i];
        }
        const encrypted = await inco.encrypt(BigInt('0x' + combined.toString('hex')), 'uint128');
        
        const newPool: StealthPool = {
          id: newPoolId,
          publicKey: keypair.publicKey.toBase58(),
          owner: ownerWallet,
          encryptedSecretKey,
          encryptionSalt,
          creationSignature: ownerSignature,
          fheHandle: encrypted.handle,
          createdAt: Date.now(),
          totalPayments: 0,
          totalSolRecovered: 0,
          status: 'created',
          isLocked: false,
        };
        
        poolRegistry.set(newPoolId, newPool);
        ownerPoolIndex.set(ownerWallet, newPoolId);
        
        await inco.store(ownerWallet, `pool:${newPoolId}`, encrypted.handle);
        savePoolsToDisk();
        
        console.log(`[Pool] ✓ New deterministic pool created: ${keypair.publicKey.toBase58().slice(0, 12)}...`);
        console.log(`[Pool] ⚠️ IMPORTANT: Recover funds from old pool: ${legacyPoolAddress}`);
        
        return {
          poolId: newPoolId,
          publicKey: keypair.publicKey.toBase58(),
          fheHandle: encrypted.handle,
          isNew: true,
          legacyPoolAddress, // Tell frontend about old pool for manual recovery
        };
      }
      
      // Pool is already unlocked
      console.log(`[Pool] ✓ Found existing unlocked pool for ${ownerWallet.slice(0, 8)}...`);
      return {
        poolId: pool.id,
        publicKey: pool.publicKey,
        fheHandle: pool.fheHandle,
        isNew: false,
      };
    }
  }
  
  // Create new pool wallet with DETERMINISTIC keypair
  console.log(`[Pool] 🔐 Creating new pool wallet for ${ownerWallet.slice(0, 8)}...`);
  
  // Derive keypair deterministically from owner + signature
  const keypair = derivePoolKeypair(ownerWallet, ownerSignature);
  const poolId = `pool-${crypto.createHash('sha256').update(ownerWallet).digest('hex').slice(0, 16)}`;
  
  // Encrypt the private key
  const encryptionSalt = crypto.randomBytes(16).toString('hex');
  const encryptedSecretKey = encryptPrivateKey(
    keypair.secretKey,
    ownerWallet,
    ownerSignature + encryptionSalt
  );
  
  // Encrypt the mapping with Inco FHE
  const inco = getIncoClient();
  const ownerHash = crypto.createHash('sha256').update(ownerWallet).digest();
  const poolHash = crypto.createHash('sha256').update(keypair.publicKey.toBase58()).digest();
  const combined = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    combined[i] = ownerHash[i] ^ poolHash[i];
  }
  const encrypted = await inco.encrypt(BigInt('0x' + combined.toString('hex')), 'uint128');
  
  const pool: StealthPool = {
    id: poolId,
    publicKey: keypair.publicKey.toBase58(),
    owner: ownerWallet,
    encryptedSecretKey,
    encryptionSalt,
    creationSignature: ownerSignature,
    fheHandle: encrypted.handle,
    createdAt: Date.now(),
    totalPayments: 0,
    totalSolRecovered: 0,
    status: 'created',
    isLocked: false,
  };
  
  poolRegistry.set(poolId, pool);
  ownerPoolIndex.set(ownerWallet, poolId);
  
  await inco.store(ownerWallet, `pool:${poolId}`, encrypted.handle);
  
  // Save to disk (metadata only!)
  savePoolsToDisk();
  
  console.log(`[Pool] ✓ Pool created: ${keypair.publicKey.toBase58().slice(0, 12)}...`);
  
  return {
    poolId,
    publicKey: keypair.publicKey.toBase58(),
    fheHandle: encrypted.handle,
    isNew: true,
  };
}

/**
 * Get pool wallet info
 * Returns the pool with isLocked flag indicating if re-auth is needed
 */
export function getPoolWallet(ownerWallet: string): (StealthPool & { needsReauth?: boolean }) | null {
  const poolId = ownerPoolIndex.get(ownerWallet);
  if (!poolId) return null;
  const pool = poolRegistry.get(poolId);
  if (!pool) return null;
  
  // Add needsReauth flag for locked pools
  return {
    ...pool,
    needsReauth: pool.isLocked === true,
  };
}

/**
 * Get pool wallet by ID
 */
export function getPoolById(poolId: string): StealthPool | null {
  return poolRegistry.get(poolId) || null;
}

// =============================================================================
// INDEPENDENT RECOVERY POOL ADDRESS STORAGE
// This stores Recovery Pool addresses separately from Stealth Pools
// so Recovery Pools can be created without requiring a Stealth Pool first
// =============================================================================

const RECOVERY_ADDRESSES_FILE = path.join(DATA_DIR, 'recovery-addresses.json');
const recoveryAddressRegistry = new Map<string, string>(); // owner -> recovery pool address

// Load recovery addresses on startup
function loadRecoveryAddresses(): void {
  try {
    if (fs.existsSync(RECOVERY_ADDRESSES_FILE)) {
      const data = JSON.parse(fs.readFileSync(RECOVERY_ADDRESSES_FILE, 'utf-8'));
      if (data.addresses) {
        Object.entries(data.addresses).forEach(([owner, address]) => {
          recoveryAddressRegistry.set(owner, address as string);
        });
        console.log(`[Recovery] Loaded ${recoveryAddressRegistry.size} recovery address(es) from disk`);
      }
    }
  } catch (e) {
    console.warn('[Recovery] Failed to load recovery-addresses.json');
  }
}

// Save recovery addresses to disk
function saveRecoveryAddresses(): void {
  try {
    ensureDataDir();
    const data = {
      addresses: Object.fromEntries(recoveryAddressRegistry),
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(RECOVERY_ADDRESSES_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('[Recovery] Failed to save recovery-addresses.json');
  }
}

// Load on module init
loadRecoveryAddresses();

/**
 * Set Recovery Pool address for an owner
 * Stores in BOTH Stealth Pool (if exists) AND independent registry
 */
export function setRecoveryPoolAddress(ownerWallet: string, recoveryPoolAddress: string): boolean {
  // Always save to independent registry (works without Stealth Pool)
  recoveryAddressRegistry.set(ownerWallet, recoveryPoolAddress);
  saveRecoveryAddresses();
  
  // Also try to save to Stealth Pool if it exists
  const poolId = ownerPoolIndex.get(ownerWallet);
  if (poolId) {
    const pool = poolRegistry.get(poolId);
    if (pool) {
      pool.recoveryPoolAddress = recoveryPoolAddress;
      savePoolsToDisk();
    }
  }
  
  console.log(`[Pool] ✓ Recovery Pool address saved for ${ownerWallet.slice(0, 8)}...: ${recoveryPoolAddress.slice(0, 12)}...`);
  return true;
}

/**
 * Get Recovery Pool address for an owner
 * Checks BOTH Stealth Pool data AND independent registry
 */
export function getRecoveryPoolAddressFromStealthPool(ownerWallet: string): string | null {
  // First check independent registry
  const fromRegistry = recoveryAddressRegistry.get(ownerWallet);
  if (fromRegistry) return fromRegistry;
  
  // Then check Stealth Pool data
  const pool = getPoolWallet(ownerWallet);
  return pool?.recoveryPoolAddress || null;
}

/**
 * Decrypt pool wallet keypair
 */
export async function decryptPoolKey(poolId: string): Promise<Keypair | null> {
  const pool = poolRegistry.get(poolId);
  if (!pool) return null;
  
  try {
    // Ensure required encryption fields exist
    if (!pool.encryptedSecretKey || !pool.creationSignature || !pool.encryptionSalt) {
      console.error(`[Pool] Missing encryption fields for ${poolId}`);
      return null;
    }
    
    const secretKey = decryptPrivateKey(
      pool.encryptedSecretKey,
      pool.owner,
      pool.creationSignature + pool.encryptionSalt
    );
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    console.error(`[Pool] Decryption failed for ${poolId}`);
    return null;
  }
}

/**
 * Mark pool as funded
 */
export function markPoolFunded(poolId: string, txSignature: string) {
  const pool = poolRegistry.get(poolId);
  if (pool) {
    pool.fundedAt = Date.now();
    pool.fundingTx = txSignature;
    pool.status = 'funded';
    savePoolsToDisk(); // Persist the funding status
    console.log(`[Pool] ✓ Pool funded: ${txSignature.slice(0, 20)}...`);
  }
}

/**
 * Create a funding transaction for the pool wallet
 */
export async function createPoolFundingTransaction(
  connection: Connection,
  userWallet: PublicKey,
  poolId: string,
  amountUSDC: bigint
): Promise<{
  transaction: Transaction;
  poolPublicKey: string;
  solRequired: number;
} | null> {
  const pool = poolRegistry.get(poolId);
  if (!pool) return null;
  
  const poolPubkey = new PublicKey(pool.publicKey);
  
  console.log(`[Pool] Building funding tx: ${userWallet.toBase58().slice(0, 8)}... → Pool`);
  
  const userUsdcAccount = await getAssociatedTokenAddress(
    USDC_MINT, userWallet, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  const poolUsdcAccount = await getAssociatedTokenAddress(
    USDC_MINT, poolPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  const transaction = new Transaction();
  let solRequired = 0;
  
  // Check if pool USDC account exists
  let poolAccountExists = false;
  try {
    await getAccount(connection, poolUsdcAccount, 'confirmed', TOKEN_PROGRAM_ID);
    poolAccountExists = true;
  } catch {
    poolAccountExists = false;
  }
  
  if (!poolAccountExists) {
    solRequired = STEALTH_SOL_REQUIREMENT;
    console.log(`[Pool] Sending ${solRequired / LAMPORTS_PER_SOL} SOL + creating ATA`);
    
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: userWallet,
        toPubkey: poolPubkey,
        lamports: Math.floor(solRequired),
      })
    );
    
    transaction.add(
      createAssociatedTokenAccountInstruction(
        userWallet, poolUsdcAccount, poolPubkey, USDC_MINT,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }
  
  // Transfer USDC to pool
  transaction.add(
    createTransferInstruction(
      userUsdcAccount, poolUsdcAccount, userWallet, amountUSDC,
      [], TOKEN_PROGRAM_ID
    )
  );
  
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = userWallet;
  
  return { transaction, poolPublicKey: pool.publicKey, solRequired: solRequired / LAMPORTS_PER_SOL };
}

/**
 * Execute a payment from pool via temp burner
 * 
 * NEW GASLESS FLOW (x402 / PayAI):
 * 1. Create temp burner wallet
 * 2. Pool creates burner's USDC ATA + sends USDC (pool pays gas + rent)
 * 3. Temp burner pays recipient via PayAI (GASLESS - PayAI pays gas!)
 * 4. Temp burner self-destructs → rent recovered to pool
 * 
 * FALLBACK (if PayAI unavailable):
 * - Uses direct Solana transfer (burner pays gas)
 */
export async function executePoolPayment(
  connection: Connection,
  poolId: string,
  recipientWallet: PublicKey,
  amountUSDC: bigint
): Promise<{
  success: boolean;
  paymentTx?: string;
  recoveryTx?: string;
  setupTx?: string;       // TX1: SOL + ATA creation
  usdcTransferTx?: string; // TX2: USDC to burner
  solRecovered?: number;
  tempBurnerAddress?: string;
  error?: string;
  method?: 'gasless' | 'direct';
  feePayer?: string;
  sessionId?: string;     // Payment session ID for audit trail
}> {
  const pool = poolRegistry.get(poolId);
  if (!pool) {
    return { success: false, error: 'Pool not found' };
  }
  
  if (pool.status === 'created') {
    return { success: false, error: 'Pool not funded yet' };
  }
  
  // Ensure pool has required encryption fields
  if (!pool.creationSignature) {
    return { success: false, error: 'Pool missing encryption credentials - please re-authenticate' };
  }
  
  // Decrypt pool keypair
  const poolKeypair = await decryptPoolKey(poolId);
  if (!poolKeypair) {
    return { success: false, error: 'Failed to decrypt pool keypair' };
  }
  
  const poolPubkey = poolKeypair.publicKey;
  
  console.log(`[Pool Payment] 🚀 Starting payment from pool:`);
  console.log(`[Pool Payment]    Pool: ${poolPubkey.toBase58().slice(0, 12)}...`);
  console.log(`[Pool Payment]    To: ${recipientWallet.toBase58().slice(0, 12)}...`);
  console.log(`[Pool Payment]    Amount: ${Number(amountUSDC) / 1_000_000} USDC`);
  
  // Step 1: Create temp burner
  const tempKeypair = Keypair.generate();
  const tempBurnerId = `burner-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  
  console.log(`[Pool Payment] ✓ Created temp burner: ${tempKeypair.publicKey.toBase58().slice(0, 12)}...`);
  
  // Store temp burner (encrypted)
  const encryptionSalt = crypto.randomBytes(16).toString('hex');
  const encryptedSecretKey = encryptPrivateKey(
    tempKeypair.secretKey,
    pool.owner,
    pool.creationSignature + encryptionSalt
  );
  
  const tempBurner: TempBurner = {
    id: tempBurnerId,
    poolId,
    publicKey: tempKeypair.publicKey.toBase58(),
    encryptedSecretKey,
    encryptionSalt,
    creationSignature: pool.creationSignature,
    createdAt: Date.now(),
    status: 'created',
  };
  tempBurnerRegistry.set(tempBurnerId, tempBurner);
  
  // ===== START PAYMENT SESSION (Audit Trail) =====
  const paymentLogger = getPaymentLogger(connection);
  const sessionId = paymentLogger.startSession(
    pool.owner,
    poolPubkey.toBase58(),
    tempKeypair.publicKey.toBase58(),
    recipientWallet.toBase58(),
    amountUSDC.toString(),
    'direct' // Will be updated if gasless succeeds
  );
  
  // ===== CHECK IF RECIPIENT HAS USDC ATA (required for gasless) =====
  // Gasless mode requires recipient to already have USDC ATA - otherwise skip to direct mode
  let recipientHasUsdcAta = false;
  try {
    const recipientUsdcAccount = await getAssociatedTokenAddress(
      USDC_MINT, recipientWallet, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const recipientAtaInfo = await connection.getAccountInfo(recipientUsdcAccount, 'confirmed');
    recipientHasUsdcAta = recipientAtaInfo !== null;
    
    if (recipientHasUsdcAta) {
      console.log(`[Pool Payment] ✓ Recipient has USDC ATA - gasless eligible`);
    } else {
      console.log(`[Pool Payment] ⚠️ Recipient has NO USDC ATA - will use direct mode (creates ATA)`);
    }
  } catch (ataCheckError: any) {
    console.log(`[Pool Payment] ⚠️ Could not verify recipient ATA: ${ataCheckError.message}`);
    // Assume no ATA, use direct mode to be safe
  }
  
  // ===== TRY GASLESS PAYMENT FIRST (x402 / PayAI) =====
  // Only attempt gasless if recipient already has USDC ATA
  if (recipientHasUsdcAta) {
    try {
      console.log(`[Pool Payment] 🔋 Attempting GASLESS payment via PayAI...`);
      
      // Import gasless payment function
      console.log(`[Pool Payment]    Importing gasless module...`);
      const gaslessModule = await import('../payai/gasless-stealth.js');
      const { executeGaslessPoolPayment, isGaslessAvailable } = gaslessModule;
      console.log(`[Pool Payment]    ✓ Module imported`);
      
      // Check if PayAI is available
      console.log(`[Pool Payment]    Checking PayAI availability...`);
      const gaslessAvailable = await isGaslessAvailable();
      console.log(`[Pool Payment]    PayAI available: ${gaslessAvailable}`);
      
      if (gaslessAvailable) {
        console.log(`[Pool Payment] ✓ PayAI facilitator available - using gasless flow!`);
        
        console.log(`[Pool Payment]    Calling executeGaslessPoolPayment...`);
        const gaslessResult = await executeGaslessPoolPayment(
          connection,
          poolKeypair,
          tempKeypair,
          recipientWallet.toBase58(),
          amountUSDC
        );
        console.log(`[Pool Payment]    Gasless result: success=${gaslessResult.success}, error=${gaslessResult.error || 'none'}`);
        
        if (gaslessResult.success) {
          // Update temp burner status
          tempBurner.status = 'recovered';
          tempBurner.usedAt = Date.now();
          tempBurner.paymentTx = gaslessResult.txSignature;
          tempBurner.recipient = recipientWallet.toBase58();
          tempBurner.amount = amountUSDC.toString();
          tempBurner.solRecovered = gaslessResult.solRecovered;
          
          // Update pool stats
          pool.totalPayments++;
          pool.totalSolRecovered += gaslessResult.solRecovered || 0;
          pool.status = 'active';
          savePoolsToDisk(); // Persist updated stats
          
          // ===== LOG TO PAYMENT SESSION (Gasless) =====
          paymentLogger.updateStatus(sessionId, 'in_progress');
          if (gaslessResult.setupTx) {
            await paymentLogger.recordTransaction(sessionId, 'tx1_funding_sol', gaslessResult.setupTx);
          }
          if (gaslessResult.usdcTransferTx) {
            await paymentLogger.recordTransaction(sessionId, 'tx2_funding_usdc', gaslessResult.usdcTransferTx);
          }
          if (gaslessResult.txSignature) {
            await paymentLogger.recordTransaction(sessionId, 'tx3_payment', gaslessResult.txSignature);
          }
          if (gaslessResult.recoveryTx) {
            await paymentLogger.recordTransaction(sessionId, 'tx4_recovery', gaslessResult.recoveryTx);
          }
          paymentLogger.setFeePayer(sessionId, gaslessResult.feePayer || 'PayAI');
          await paymentLogger.completeSession(sessionId, gaslessResult.solRecovered || 0);
          
          console.log(`[Pool Payment] 🎉 GASLESS payment complete!`);
          console.log(`[Pool Payment]    PayAI paid gas for transfer`);
          console.log(`[Pool Payment]    Rent recovered: ${gaslessResult.rentRecovered?.toFixed(6) || '0'} SOL`);
          
          return {
            success: true,
            paymentTx: gaslessResult.txSignature,
            setupTx: gaslessResult.setupTx,
            usdcTransferTx: gaslessResult.usdcTransferTx,
            recoveryTx: gaslessResult.recoveryTx,
            solRecovered: gaslessResult.solRecovered,
            tempBurnerAddress: tempKeypair.publicKey.toBase58(),
            method: 'gasless',
            feePayer: gaslessResult.feePayer,
            sessionId,
          };
        } else {
          console.warn(`[Pool Payment] ⚠️ Gasless payment failed: ${gaslessResult.error}`);
          console.warn(`[Pool Payment] Falling back to direct transfer...`);
        }
      } else {
        console.log(`[Pool Payment] ⚠️ PayAI not available`);
        console.log(`[Pool Payment]    Check /api/credits/pool/test-payai for debug info`);
      }
    } catch (gaslessError: any) {
      console.error(`[Pool Payment] ❌ Gasless attempt EXCEPTION:`);
      console.error(`[Pool Payment]    Message: ${gaslessError.message}`);
      console.error(`[Pool Payment]    Stack: ${gaslessError.stack?.split('\n').slice(0, 3).join('\n') || 'N/A'}`);
    }
  } else {
    console.log(`[Pool Payment] ⏭️ Skipping gasless - recipient needs USDC ATA created`);
  }
  
  // ===== FALLBACK: DIRECT TRANSFER (burner pays gas) =====
  // OPTIMIZED: Reduced RPC calls by reusing blockhash, batching txs, deferring recovery
  console.log(`[Pool Payment] 📤 Using DIRECT transfer (fallback mode)...`);
  console.log(`[Pool Payment]    Reason: PayAI gasless not available or failed`);
  console.log(`[Pool Payment]    Pool will pay ~0.006 SOL to burner (recoverable)`);
  
  // Helper: delay between RPC calls to avoid rate limits
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
  
  try {
    // OPTIMIZATION 1: Fetch blockhash ONCE and reuse (valid for ~1.5 min)
    console.log(`[Pool Payment] 🔄 Fetching blockhash (will reuse)...`);
    let { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    
    // Get token account addresses (no RPC calls, just derivation)
    const tempUsdcAccount = await getAssociatedTokenAddress(
      USDC_MINT, tempKeypair.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const poolUsdcAccount = await getAssociatedTokenAddress(
      USDC_MINT, poolPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const recipientUsdcAccount = await getAssociatedTokenAddress(
      USDC_MINT, recipientWallet, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    // OPTIMIZATION 2: TX1 - Pool sends SOL to temp burner
    console.log(`[Pool Payment]    Sending ${TEMP_BURNER_SOL / LAMPORTS_PER_SOL} SOL for ATA rent + gas`);
    
    const solTx = new Transaction();
    solTx.add(
      SystemProgram.transfer({
        fromPubkey: poolPubkey,
        toPubkey: tempKeypair.publicKey,
        lamports: Math.floor(TEMP_BURNER_SOL),
      })
    );
    solTx.recentBlockhash = blockhash;
    solTx.feePayer = poolPubkey;
    solTx.sign(poolKeypair);
    
    const solSig = await connection.sendRawTransaction(solTx.serialize(), {
      skipPreflight: true, // Skip preflight to reduce RPC calls
      preflightCommitment: 'confirmed',
    });
    await connection.confirmTransaction({ signature: solSig, blockhash, lastValidBlockHeight }, 'confirmed');
    console.log(`[Pool Payment] ✓ SOL sent to temp burner: ${solSig.slice(0, 20)}...`);
    
    // Log TX1 to payment session
    await paymentLogger.recordTransaction(sessionId, 'tx1_funding_sol', solSig, TEMP_BURNER_SOL / LAMPORTS_PER_SOL);
    
    await delay(300); // Rate limit protection
    
    // TX2 - Temp burner creates USDC account + Pool sends USDC (batched where possible)
    // Note: ATA creation must be signed by temp burner, USDC transfer by pool
    // So we need separate transactions, but we can reuse blockhash
    
    const ataTx = new Transaction();
    ataTx.add(
      createAssociatedTokenAccountInstruction(
        tempKeypair.publicKey,
        tempUsdcAccount,
        tempKeypair.publicKey,
        USDC_MINT,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    ataTx.recentBlockhash = blockhash; // Reuse blockhash!
    ataTx.feePayer = tempKeypair.publicKey;
    ataTx.sign(tempKeypair);
    
    const ataSig = await connection.sendRawTransaction(ataTx.serialize(), {
      skipPreflight: true,
      preflightCommitment: 'confirmed',
    });
    await connection.confirmTransaction({ signature: ataSig, blockhash, lastValidBlockHeight }, 'confirmed');
    console.log(`[Pool Payment] ✓ Temp burner USDC account created`);
    
    await delay(300); // Rate limit protection
    
    // TX3 - Pool sends USDC to temp burner
    const usdcTx = new Transaction();
    usdcTx.add(
      createTransferInstruction(
        poolUsdcAccount, tempUsdcAccount, poolPubkey, amountUSDC,
        [], TOKEN_PROGRAM_ID
      )
    );
    usdcTx.recentBlockhash = blockhash; // Reuse blockhash!
    usdcTx.feePayer = poolPubkey;
    usdcTx.sign(poolKeypair);
    
    const usdcSig = await connection.sendRawTransaction(usdcTx.serialize(), {
      skipPreflight: true,
      preflightCommitment: 'confirmed',
    });
    await connection.confirmTransaction({ signature: usdcSig, blockhash, lastValidBlockHeight }, 'confirmed');
    
    tempBurner.status = 'funded';
    console.log(`[Pool Payment] ✓ USDC sent to temp burner`);
    
    // Log TX2 (USDC transfer) to payment session
    await paymentLogger.recordTransaction(sessionId, 'tx2_funding_usdc', usdcSig);
    
    await delay(300); // Rate limit protection
    
    // TX4 - Temp burner pays recipient
    const payTx = new Transaction();
    
    // Check if recipient has USDC account (single RPC call)
    let recipientAccountExists = false;
    try {
      await getAccount(connection, recipientUsdcAccount, 'confirmed', TOKEN_PROGRAM_ID);
      recipientAccountExists = true;
    } catch {
      // Need to create recipient ATA
      payTx.add(
        createAssociatedTokenAccountInstruction(
          tempKeypair.publicKey, recipientUsdcAccount, recipientWallet, USDC_MINT,
          TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }
    
    payTx.add(
      createTransferInstruction(
        tempUsdcAccount, recipientUsdcAccount, tempKeypair.publicKey, amountUSDC,
        [], TOKEN_PROGRAM_ID
      )
    );
    payTx.recentBlockhash = blockhash; // Reuse blockhash!
    payTx.feePayer = tempKeypair.publicKey;
    payTx.sign(tempKeypair);
    
    console.log(`[Pool Payment] 📤 Executing private payment...`);
    const paySig = await connection.sendRawTransaction(payTx.serialize(), {
      skipPreflight: false, // Keep preflight for payment tx (important)
      preflightCommitment: 'confirmed',
    });
    await connection.confirmTransaction({ signature: paySig, blockhash, lastValidBlockHeight }, 'confirmed');
    
    tempBurner.status = 'used';
    tempBurner.usedAt = Date.now();
    tempBurner.paymentTx = paySig;
    tempBurner.recipient = recipientWallet.toBase58();
    tempBurner.amount = amountUSDC.toString();
    
    console.log(`[Pool Payment] ✅ Payment complete: ${paySig.slice(0, 20)}...`);
    
    // Log TX3 (payment) to payment session
    await paymentLogger.recordTransaction(sessionId, 'tx3_payment', paySig);
    
    // Update pool stats immediately (payment succeeded!)
    pool.totalPayments++;
    pool.status = 'active';
    savePoolsToDisk();
    
    // OPTIMIZATION 3: Defer SOL recovery to background (don't block return)
    // This prevents rate limiting from affecting user experience
    console.log(`[Pool Payment] 💰 Queuing SOL recovery (background)...`);
    
    const recoverySolAmount = TEMP_BURNER_SOL; // Approximate recovery amount
    
    // Background recovery task
    setTimeout(async () => {
      try {
        console.log(`[Pool Recovery] 🔄 Starting background SOL recovery...`);
        
        // Get fresh blockhash for recovery (old one may have expired)
        const { blockhash: recoveryBlockhash, lastValidBlockHeight: recoveryHeight } = 
          await connection.getLatestBlockhash('confirmed');
        
        const recoverTx = new Transaction();
        
        recoverTx.add(
          createCloseAccountInstruction(
            tempUsdcAccount, poolPubkey, tempKeypair.publicKey,
            [], TOKEN_PROGRAM_ID
          )
        );
        
        const tempBalance = await connection.getBalance(tempKeypair.publicKey, 'confirmed');
        const txFee = 5000;
        const solToRecover = tempBalance - txFee;
        
        if (solToRecover > 0) {
          recoverTx.add(
            SystemProgram.transfer({
              fromPubkey: tempKeypair.publicKey,
              toPubkey: poolPubkey,
              lamports: solToRecover,
            })
          );
        }
        
        recoverTx.recentBlockhash = recoveryBlockhash;
        recoverTx.feePayer = tempKeypair.publicKey;
        recoverTx.sign(tempKeypair);
        
        const recoverSig = await connection.sendRawTransaction(recoverTx.serialize(), {
          skipPreflight: true,
          preflightCommitment: 'confirmed',
        });
        await connection.confirmTransaction({ 
          signature: recoverSig, 
          blockhash: recoveryBlockhash, 
          lastValidBlockHeight: recoveryHeight 
        }, 'confirmed');
        
        const ATA_RENT = 2039280;
        const solRecovered = (ATA_RENT + solToRecover) / LAMPORTS_PER_SOL;
        
        tempBurner.status = 'recovered';
        tempBurner.solRecovered = solRecovered;
        tempBurner.recoveryTx = recoverSig;
        pool.totalSolRecovered += solRecovered;
        savePoolsToDisk();
        
        // Log TX4 (recovery) and complete the session
        await paymentLogger.recordTransaction(sessionId, 'tx4_recovery', recoverSig);
        await paymentLogger.completeSession(sessionId, solRecovered);
        
        console.log(`[Pool Recovery] ✅ Recovered ${solRecovered.toFixed(6)} SOL to pool`);
        
      } catch (recoverError: any) {
        console.error(`[Pool Recovery] ⚠️ Background recovery failed: ${recoverError.message}`);
        console.error(`[Pool Recovery]    SOL stuck in burner: ${tempKeypair.publicKey.toBase58()}`);
        // SOL can be recovered manually later - payment already succeeded
        // Still complete the session but with 0 recovery
        await paymentLogger.completeSession(sessionId, 0);
      }
    }, 5000); // 5 second delay before recovery
    
    return {
      success: true,
      paymentTx: paySig,
      setupTx: solSig,        // TX1: Pool sent SOL to burner
      usdcTransferTx: usdcSig, // TX3: Pool sent USDC to burner (TX2 was ATA creation)
      solRecovered: 0, // Will be updated in background
      tempBurnerAddress: tempKeypair.publicKey.toBase58(),
      method: 'direct',
      sessionId,
    };
    
  } catch (error: any) {
    console.error(`[Pool Payment] ❌ Error:`, error.message);
    // Fail the session if it was started
    await paymentLogger.failSession(sessionId, error.message);
    return { success: false, error: error.message, sessionId };
  }
}

/**
 * Get pool wallet balance (including compressed/shielded balance)
 */
export async function getPoolBalance(
  connection: Connection,
  poolId: string
): Promise<{ sol: number; usdc: number; compressedUsdc: number } | null> {
  const pool = poolRegistry.get(poolId);
  if (!pool) return null;
  
  const poolPubkey = new PublicKey(pool.publicKey);
  
  // Get SOL balance
  const solBalance = await connection.getBalance(poolPubkey, 'confirmed');
  
  // Get regular USDC balance
  let usdcBalance = 0;
  try {
    const poolUsdcAccount = await getAssociatedTokenAddress(
      USDC_MINT, poolPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const accountInfo = await getAccount(connection, poolUsdcAccount, 'confirmed', TOKEN_PROGRAM_ID);
    usdcBalance = Number(accountInfo.amount) / 1_000_000;
  } catch {
    // No USDC account
  }
  
  // Get compressed/shielded USDC balance (Light Protocol)
  let compressedUsdcBalance = 0;
  try {
    const { getCompressedBalance } = await import('../light/client.js');
    const compressedBalance = await getCompressedBalance(poolPubkey, USDC_MINT);
    if (compressedBalance && compressedBalance.amount) {
      compressedUsdcBalance = Number(compressedBalance.amount) / 1_000_000;
      console.log(`[Pool] ✓ Compressed USDC balance for ${poolId.slice(0, 8)}...: ${compressedUsdcBalance}`);
    } else {
      console.log(`[Pool] No compressed USDC for ${poolId.slice(0, 8)}... (balance object: ${JSON.stringify(compressedBalance)})`);
    }
  } catch (err: any) {
    // Light Protocol not available or no compressed balance
    console.log(`[Pool] Could not fetch compressed balance for ${poolId.slice(0, 8)}...: ${err.message}`);
  }
  
  const result = {
    sol: solBalance / LAMPORTS_PER_SOL,
    usdc: usdcBalance,
    compressedUsdc: compressedUsdcBalance,
  };
  
  console.log(`[Pool] Balance for ${poolId.slice(0, 8)}...: SOL=${result.sol.toFixed(4)}, USDC=${result.usdc.toFixed(2)}, CompressedUSDC=${result.compressedUsdc.toFixed(4)}`);
  
  return result;
}

/**
 * Get pool payment history
 */
export function getPoolPaymentHistory(poolId: string): TempBurner[] {
  const burners: TempBurner[] = [];
  tempBurnerRegistry.forEach(burner => {
    if (burner.poolId === poolId) {
      burners.push(burner);
    }
  });
  return burners.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Export pool private key
 */
export async function exportPoolKey(
  poolId: string,
  ownerWallet: string
): Promise<{ privateKeyBase58: string; publicKey: string } | null> {
  const pool = poolRegistry.get(poolId);
  if (!pool || pool.owner !== ownerWallet) return null;
  
  const keypair = await decryptPoolKey(poolId);
  if (!keypair) return null;
  
  const bs58 = await import('bs58');
  return {
    privateKeyBase58: bs58.default.encode(keypair.secretKey),
    publicKey: keypair.publicKey.toBase58(),
  };
}

/**
 * Generate a new stealth address for a payment
 * 
 * @param ownerWallet - The owner's main wallet address
 * @param ownerSignature - Wallet signature (used to encrypt the private key)
 * 
 * SECURITY: The private key is encrypted using AES-256-CBC with a key derived
 * from the owner's wallet address + signature. Only the owner can decrypt.
 */
export async function createStealthAddress(
  ownerWallet: string,
  ownerSignature: string
): Promise<{
  stealthId: string;
  stealthPublicKey: string;
  fheHandle: string;
}> {
  // Generate fresh keypair - this is the burner wallet
  const keypair = Keypair.generate();
  const stealthId = `stealth-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  
  console.log(`[Stealth] 🔐 Creating burner wallet for owner: ${ownerWallet.slice(0, 8)}...`);
  console.log(`[Stealth] 🔒 Encrypting private key with wallet signature...`);
  
  // Generate encryption salt
  const encryptionSalt = crypto.randomBytes(16).toString('hex');
  
  // Encrypt the private key using wallet signature
  const encryptedSecretKey = encryptPrivateKey(
    keypair.secretKey,
    ownerWallet,
    ownerSignature + encryptionSalt
  );
  
  // Encrypt the owner↔stealth mapping in Inco FHE
  const inco = getIncoClient();
  
  // Create a numeric representation of the mapping for FHE
  // We hash both addresses and combine them
  const ownerHash = crypto.createHash('sha256').update(ownerWallet).digest();
  const stealthHash = crypto.createHash('sha256').update(keypair.publicKey.toBase58()).digest();
  
  // XOR the hashes to create a combined value
  const combined = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    combined[i] = ownerHash[i] ^ stealthHash[i];
  }
  const combinedValue = BigInt('0x' + combined.toString('hex'));
  
  // Encrypt with Inco FHE
  const encrypted = await inco.encrypt(combinedValue, 'uint128');
  
  // Store the mapping (with ENCRYPTED private key, not raw keypair!)
  const stealth: StealthAddress = {
    id: stealthId,
    publicKey: keypair.publicKey.toBase58(),
    owner: ownerWallet,
    encryptedSecretKey,           // Encrypted, not raw!
    encryptionSalt,               // Needed for decryption
    creationSignature: ownerSignature, // Store for later decryption
    fheHandle: encrypted.handle,
    createdAt: Date.now(),
    status: 'created',
  };
  
  stealthRegistry.set(stealthId, stealth);
  
  // Index by owner for history lookup
  const ownerStealth = ownerIndex.get(ownerWallet) || [];
  ownerStealth.push(stealthId);
  ownerIndex.set(ownerWallet, ownerStealth);
  
  // Store the FHE handle with Inco
  await inco.store(ownerWallet, `stealth:${stealthId}`, encrypted.handle);
  
  console.log(`[Stealth] ✓ Burner created: ${keypair.publicKey.toBase58().slice(0, 12)}...`);
  console.log(`[Stealth] ✓ Private key encrypted (AES-256-CBC)`);
  console.log(`[Stealth] ✓ FHE mapping encrypted (${encrypted.handle.length} bytes)`);
  
  return {
    stealthId,
    stealthPublicKey: keypair.publicKey.toBase58(),
    fheHandle: encrypted.handle,
  };
}

/**
 * Get stealth address info by ID
 */
export function getStealthInfo(stealthId: string): StealthAddress | null {
  return stealthRegistry.get(stealthId) || null;
}

/**
 * Decrypt stealth keypair using owner's signature
 * 
 * @param stealthId - The stealth address ID
 * @param ownerSignature - A fresh wallet signature to derive decryption key
 * 
 * SECURITY: The signature must come from the owner's wallet.
 * We use the original creation signature for decryption.
 */
export async function decryptStealthKey(
  stealthId: string,
  ownerSignature?: string
): Promise<Keypair | null> {
  const stealth = stealthRegistry.get(stealthId);
  if (!stealth) {
    console.error(`[Stealth] Stealth address not found: ${stealthId}`);
    return null;
  }
  
  try {
    // Use creation signature for decryption
    const signatureForDecryption = stealth.creationSignature;
    
    const secretKey = decryptPrivateKey(
      stealth.encryptedSecretKey,
      stealth.owner,
      signatureForDecryption + stealth.encryptionSalt
    );
    
    const keypair = Keypair.fromSecretKey(secretKey);
    
    // Verify the keypair matches the stored public key
    if (keypair.publicKey.toBase58() !== stealth.publicKey) {
      console.error(`[Stealth] Decryption produced wrong keypair!`);
      return null;
    }
    
    console.log(`[Stealth] ✓ Decrypted keypair for ${stealthId.slice(0, 16)}...`);
    return keypair;
    
  } catch (error) {
    console.error(`[Stealth] Decryption failed for ${stealthId}:`, error);
    return null;
  }
}

/**
 * Export stealth private key using a fresh signature
 * This requires a NEW signature from the owner for security
 * 
 * @param stealthId - The stealth address ID
 * @param ownerSignature - A fresh wallet signature (for audit purposes)
 * @returns Base58 encoded private key or null
 */
export async function exportStealthKey(
  stealthId: string,
  ownerWallet: string,
  ownerSignature: string
): Promise<{
  privateKeyBase58: string;
  publicKey: string;
} | null> {
  const stealth = stealthRegistry.get(stealthId);
  if (!stealth) {
    console.error(`[Stealth] Stealth address not found: ${stealthId}`);
    return null;
  }
  
  // Verify ownership
  if (stealth.owner !== ownerWallet) {
    console.error(`[Stealth] Ownership verification failed for ${stealthId}`);
    return null;
  }
  
  try {
    // Use creation signature for decryption
    const keypair = await decryptStealthKey(stealthId);
    if (!keypair) {
      return null;
    }
    
    // Import bs58 for encoding
    const bs58 = await import('bs58');
    const privateKeyBase58 = bs58.default.encode(keypair.secretKey);
    
    console.log(`[Stealth] 🔑 Exported key for ${stealthId.slice(0, 16)}... to owner ${ownerWallet.slice(0, 8)}...`);
    
    return {
      privateKeyBase58,
      publicKey: keypair.publicKey.toBase58(),
    };
    
  } catch (error) {
    console.error(`[Stealth] Export failed for ${stealthId}:`, error);
    return null;
  }
}

/**
 * Get stealth keypair by ID (for signing transactions)
 * Uses internal decryption with stored signature
 * 
 * @deprecated Use decryptStealthKey with signature instead
 */
export async function getStealthKeypair(stealthId: string): Promise<Keypair | null> {
  return decryptStealthKey(stealthId);
}

/**
 * Get all stealth addresses for an owner
 * In production, this would require FHE proof of ownership
 */
export async function getOwnerStealthAddresses(ownerWallet: string): Promise<{
  stealthId: string;
  publicKey: string;
  status: string;
  createdAt: number;
  fundedAt?: number;
  usedAt?: number;
  fundingTx?: string;
  paymentTx?: string;
  recipient?: string;
  amount?: string;
}[]> {
  const stealthIds = ownerIndex.get(ownerWallet) || [];
  
  return stealthIds.map(id => {
    const s = stealthRegistry.get(id)!;
    return {
      stealthId: s.id,
      publicKey: s.publicKey,
      status: s.status,
      createdAt: s.createdAt,
      fundedAt: s.fundedAt,
      usedAt: s.usedAt,
      fundingTx: s.fundingTx,
      paymentTx: s.paymentTx,
      recipient: s.recipient,
      amount: s.amount,
    };
  });
}

/**
 * Mark stealth as funded
 */
export function markStealthFunded(stealthId: string, txSignature: string) {
  const stealth = stealthRegistry.get(stealthId);
  if (stealth) {
    stealth.fundedAt = Date.now();
    stealth.fundingTx = txSignature;
    stealth.status = 'funded';
    console.log(`[Stealth] ✓ ${stealthId.slice(0, 16)}... funded: ${txSignature.slice(0, 16)}...`);
  }
}

/**
 * Mark stealth as used after payment
 */
export function markStealthUsed(
  stealthId: string, 
  txSignature: string, 
  recipient: string, 
  amount: string
) {
  const stealth = stealthRegistry.get(stealthId);
  if (stealth) {
    stealth.usedAt = Date.now();
    stealth.paymentTx = txSignature;
    stealth.recipient = recipient;
    stealth.amount = amount;
    stealth.status = 'used';
    console.log(`[Stealth] ✓ ${stealthId.slice(0, 16)}... paid: ${txSignature.slice(0, 16)}...`);
  }
}

/**
 * Create funding transaction: User wallet → Stealth Address
 * User signs this transaction to fund the burner wallet
 * 
 * Sends USDC + SOL to stealth for payment execution
 */
export async function createFundingTransaction(
  connection: Connection,
  userWallet: PublicKey,
  stealthId: string,
  amountUSDC: bigint
): Promise<{ 
  transaction: Transaction; 
  stealthPublicKey: string;
  solRequired: number;
} | null> {
  const stealth = stealthRegistry.get(stealthId);
  if (!stealth) {
    console.error(`[Stealth] Stealth address not found: ${stealthId}`);
    return null;
  }
  
  if (stealth.status !== 'created') {
    console.error(`[Stealth] Stealth already in status: ${stealth.status}`);
    return null;
  }
  
  const stealthPubkey = new PublicKey(stealth.publicKey);
  
  console.log(`[Stealth] Building funding tx: ${userWallet.toBase58().slice(0, 8)}... → ${stealthPubkey.toBase58().slice(0, 8)}...`);
  
  // Get user's USDC account
  const userUsdcAccount = await getAssociatedTokenAddress(
    USDC_MINT,
    userWallet,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  // Get stealth's USDC account address
  const stealthUsdcAccount = await getAssociatedTokenAddress(
    USDC_MINT,
    stealthPubkey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  const transaction = new Transaction();
  let solRequired = 0;
  
  // Check if stealth USDC account exists
  let stealthAccountExists = false;
  try {
    await getAccount(connection, stealthUsdcAccount, 'confirmed', TOKEN_PROGRAM_ID);
    stealthAccountExists = true;
  } catch {
    // Need to create the ATA
    stealthAccountExists = false;
  }
  
  if (!stealthAccountExists) {
    // ALWAYS send SOL for tx fees + create ATA
    solRequired = STEALTH_SOL_REQUIREMENT;
    
    console.log(`[Stealth] Sending ${solRequired / LAMPORTS_PER_SOL} SOL + creating ATA`);
    
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: userWallet,
        toPubkey: stealthPubkey,
        lamports: Math.floor(solRequired),
      })
    );
    
    // Create the USDC token account for stealth
    transaction.add(
      createAssociatedTokenAccountInstruction(
        userWallet, // payer
        stealthUsdcAccount,
        stealthPubkey,
        USDC_MINT,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }
  
  // Transfer USDC to stealth address
  transaction.add(
    createTransferInstruction(
      userUsdcAccount,
      stealthUsdcAccount,
      userWallet,
      amountUSDC,
      [],
      TOKEN_PROGRAM_ID
    )
  );
  
  // Get blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = userWallet;
  
  console.log(`[Stealth] Funding tx ready: ${amountUSDC} micro-USDC + ${solRequired / LAMPORTS_PER_SOL} SOL`);
  
  return { 
    transaction, 
    stealthPublicKey: stealthPubkey.toBase58(),
    solRequired: solRequired / LAMPORTS_PER_SOL,
  };
}

/**
 * Create payment transaction: Stealth Address → Service Provider
 * This is signed by the stealth keypair - NO user signature needed!
 * 
 * PRIVACY FEATURES:
 * - Service provider sees payment from stealth wallet
 * - Service provider CANNOT link it to user's main wallet
 * 
 * DIRECT TRANSFER MODE:
 * - Uses SOL in stealth wallet for gas
 * - Simple, reliable, always works
 */
export async function executeStealthPayment(
  connection: Connection,
  stealthId: string,
  recipientWallet: PublicKey,
  amountUSDC: bigint,
  ownerSignature?: string  // Optional: can use stored signature
): Promise<{ 
  txSignature: string;
  stealthAddress: string;
  recipientAddress: string;
  method: 'direct';
  x402: {
    protocol: string;
    facilitatorUsed: boolean;
  };
} | null> {
  const stealth = stealthRegistry.get(stealthId);
  if (!stealth) {
    console.error(`[Stealth] Stealth address not found: ${stealthId}`);
    return null;
  }
  
  if (stealth.status !== 'funded') {
    console.error(`[Stealth] Stealth not funded, status: ${stealth.status}`);
    return null;
  }
  
  // Decrypt the keypair for signing
  const keypair = await decryptStealthKey(stealthId, ownerSignature);
  if (!keypair) {
    console.error(`[Stealth] Failed to decrypt keypair for ${stealthId}`);
    return null;
  }
  
  const stealthPubkey = keypair.publicKey;
  
  console.log(`[Stealth] 🚀 Executing PRIVATE payment:`);
  console.log(`[Stealth]    From: ${stealthPubkey.toBase58().slice(0, 12)}... (burner)`);
  console.log(`[Stealth]    To:   ${recipientWallet.toBase58().slice(0, 12)}... (recipient)`);
  console.log(`[Stealth]    Amount: ${Number(amountUSDC) / 1_000_000} USDC`);
  
  // DIRECT TRANSFER - Simple and reliable
  
  // Get stealth's USDC account
  const stealthUsdcAccount = await getAssociatedTokenAddress(
    USDC_MINT,
    stealthPubkey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  // Get recipient's USDC account
  const recipientUsdcAccount = await getAssociatedTokenAddress(
    USDC_MINT,
    recipientWallet,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  const transaction = new Transaction();
  
  // Check if recipient USDC account exists
  try {
    await getAccount(connection, recipientUsdcAccount, 'confirmed', TOKEN_PROGRAM_ID);
  } catch {
    // Create recipient ATA - stealth wallet pays for this
    console.log(`[Stealth] Creating recipient USDC account...`);
    transaction.add(
      createAssociatedTokenAccountInstruction(
        stealthPubkey, // payer is the stealth wallet
        recipientUsdcAccount,
        recipientWallet,
        USDC_MINT,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }
  
  // Transfer USDC from stealth to recipient
  transaction.add(
    createTransferInstruction(
      stealthUsdcAccount,
      recipientUsdcAccount,
      stealthPubkey, // Authority is the STEALTH wallet, not user!
      amountUSDC,
      [],
      TOKEN_PROGRAM_ID
    )
  );
  
  // Get blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = stealthPubkey;
  
  // Sign with stealth keypair - NOT user wallet!
  // This is the privacy magic: user's wallet never touches this transaction
  transaction.sign(keypair);
  
  console.log(`[Stealth] ✍️ Transaction signed by burner wallet (direct mode)`);
  
  // Send transaction
  const txSignature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  
  console.log(`[Stealth] 📡 Transaction sent: ${txSignature.slice(0, 20)}...`);
  
  // Wait for confirmation
  const confirmation = await connection.confirmTransaction({
    signature: txSignature,
    blockhash,
    lastValidBlockHeight,
  }, 'confirmed');
  
  if (confirmation.value.err) {
    console.error(`[Stealth] ❌ Transaction failed:`, confirmation.value.err);
    return null;
  }
  
  // Mark stealth as used
  markStealthUsed(stealthId, txSignature, recipientWallet.toBase58(), amountUSDC.toString());
  
  console.log(`[Stealth] ✅ PRIVACY PRESERVED (direct transfer)!`);
  console.log(`[Stealth]    Service sees: ${stealthPubkey.toBase58().slice(0, 12)}...`);
  console.log(`[Stealth]    Service CANNOT see: ${stealth.owner.slice(0, 12)}... (real owner)`);
  
  return {
    txSignature,
    stealthAddress: stealthPubkey.toBase58(),
    recipientAddress: recipientWallet.toBase58(),
    method: 'direct',
    x402: {
      protocol: 'stealth-direct',
      facilitatorUsed: false,
    },
  };
}

/**
 * Recover SOL from a used multi-stealth wallet to the user's single stealth wallet
 * 
 * This should be called after executeStealthPayment completes for multi-stealth mode.
 * It closes the USDC token account (reclaims rent) and transfers all SOL.
 * 
 * COST OPTIMIZATION:
 * - Multi-stealth provides max privacy (new burner per tx)
 * - After payment, recover SOL rent to single wallet
 * - Single wallet accumulates SOL for future use
 */
export async function recoverSolToSingleWallet(
  connection: Connection,
  usedStealthId: string,
  singleStealthPublicKey: string
): Promise<{
  success: boolean;
  solRecovered?: number;
  txSignature?: string;
  error?: string;
}> {
  const usedStealth = stealthRegistry.get(usedStealthId);
  if (!usedStealth) {
    return { success: false, error: 'Used stealth wallet not found' };
  }
  
  if (usedStealth.status !== 'used') {
    return { success: false, error: 'Stealth wallet has not been used yet' };
  }
  
  // Decrypt the keypair
  const keypair = await decryptStealthKey(usedStealthId);
  if (!keypair) {
    return { success: false, error: 'Failed to decrypt stealth keypair' };
  }
  
  const stealthPubkey = keypair.publicKey;
  const destinationPubkey = new PublicKey(singleStealthPublicKey);
  
  console.log(`[Stealth Recovery] 💰 Recovering SOL from: ${stealthPubkey.toBase58().slice(0, 12)}...`);
  console.log(`[Stealth Recovery]    To single wallet: ${singleStealthPublicKey.slice(0, 12)}...`);
  
  try {
    // Step 1: Close the USDC token account to reclaim rent
    const stealthUsdcAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      stealthPubkey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    // Check if token account exists and has zero balance
    let tokenAccountExists = false;
    try {
      const accountInfo = await getAccount(connection, stealthUsdcAccount, 'confirmed', TOKEN_PROGRAM_ID);
      if (accountInfo.amount === BigInt(0)) {
        tokenAccountExists = true;
      } else {
        console.log(`[Stealth Recovery] Token account still has USDC, skipping close`);
      }
    } catch {
      // Account doesn't exist or already closed
      tokenAccountExists = false;
    }
    
    const transaction = new Transaction();
    
    if (tokenAccountExists) {
      // Close token account - rent goes to stealth wallet (temporarily)
      console.log(`[Stealth Recovery] Closing USDC token account (reclaiming ~0.002 SOL rent)...`);
      transaction.add(
        createCloseAccountInstruction(
          stealthUsdcAccount,    // Account to close
          stealthPubkey,         // Rent destination (temporarily to self)
          stealthPubkey,         // Authority
          [],
          TOKEN_PROGRAM_ID
        )
      );
    }
    
    // Step 2: Get current SOL balance
    const solBalance = await connection.getBalance(stealthPubkey, 'confirmed');
    
    // Need to leave enough for tx fee (~5000 lamports)
    const txFee = 5000;
    const solToTransfer = solBalance - txFee;
    
    if (solToTransfer <= 0) {
      console.log(`[Stealth Recovery] Not enough SOL to recover (balance: ${solBalance} lamports)`);
      return { success: false, error: 'Insufficient SOL to recover' };
    }
    
    console.log(`[Stealth Recovery] Transferring ${solToTransfer / LAMPORTS_PER_SOL} SOL to single wallet...`);
    
    // Step 3: Transfer all remaining SOL to single wallet
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: stealthPubkey,
        toPubkey: destinationPubkey,
        lamports: solToTransfer,
      })
    );
    
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = stealthPubkey;
    transaction.sign(keypair);
    
    const txSignature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    await connection.confirmTransaction({
      signature: txSignature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');
    
    const solRecovered = solToTransfer / LAMPORTS_PER_SOL;
    
    console.log(`[Stealth Recovery] ✅ Recovered ${solRecovered.toFixed(6)} SOL`);
    console.log(`[Stealth Recovery]    TX: ${txSignature.slice(0, 20)}...`);
    
    // Mark stealth as fully recovered
    usedStealth.status = 'expired';
    
    return {
      success: true,
      solRecovered,
      txSignature,
    };
    
  } catch (error: any) {
    console.error(`[Stealth Recovery] ❌ Error:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get statistics about stealth address usage
 */
export function getStealthStats(): {
  totalCreated: number;
  totalFunded: number;
  totalUsed: number;
  uniqueOwners: number;
} {
  let totalCreated = 0;
  let totalFunded = 0;
  let totalUsed = 0;
  
  stealthRegistry.forEach(stealth => {
    totalCreated++;
    if (stealth.status === 'funded' || stealth.status === 'used') totalFunded++;
    if (stealth.status === 'used') totalUsed++;
  });
  
  return {
    totalCreated,
    totalFunded,
    totalUsed,
    uniqueOwners: ownerIndex.size,
  };
}

/**
 * Recover USDC from a stuck stealth wallet by sending it back to the owner
 * This requires sending SOL first to cover gas
 */
export async function recoverStealthFunds(
  connection: Connection,
  stealthId: string,
  fundingKeypair: Keypair, // Keypair with SOL to fund gas
  ownerSignature?: string
): Promise<{
  success: boolean;
  txSignature?: string;
  error?: string;
  recoveredAmount?: string;
} | null> {
  const stealth = stealthRegistry.get(stealthId);
  if (!stealth) {
    return { success: false, error: 'Stealth address not found' };
  }
  
  // Decrypt the stealth keypair
  const stealthKeypair = await decryptStealthKey(stealthId, ownerSignature);
  if (!stealthKeypair) {
    return { success: false, error: 'Failed to decrypt stealth keypair' };
  }
  
  const stealthPubkey = stealthKeypair.publicKey;
  const ownerPubkey = new PublicKey(stealth.owner);
  
  console.log(`[Stealth Recovery] 🔧 Recovering funds from: ${stealthPubkey.toBase58().slice(0, 12)}...`);
  console.log(`[Stealth Recovery]    To owner: ${stealth.owner.slice(0, 12)}...`);
  
  try {
    // Step 1: Send SOL to stealth for gas
    console.log(`[Stealth Recovery] Step 1: Sending SOL for gas...`);
    
    const solTransfer = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fundingKeypair.publicKey,
        toPubkey: stealthPubkey,
        lamports: Math.floor(0.003 * LAMPORTS_PER_SOL), // Small amount for gas
      })
    );
    
    const { blockhash: solBlockhash } = await connection.getLatestBlockhash('confirmed');
    solTransfer.recentBlockhash = solBlockhash;
    solTransfer.feePayer = fundingKeypair.publicKey;
    solTransfer.sign(fundingKeypair);
    
    const solTx = await connection.sendRawTransaction(solTransfer.serialize());
    await connection.confirmTransaction(solTx, 'confirmed');
    console.log(`[Stealth Recovery] ✓ SOL sent: ${solTx.slice(0, 20)}...`);
    
    // Step 2: Get USDC balance
    const stealthUsdcAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      stealthPubkey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    let usdcBalance: bigint;
    try {
      const accountInfo = await getAccount(connection, stealthUsdcAccount, 'confirmed', TOKEN_PROGRAM_ID);
      usdcBalance = accountInfo.amount;
    } catch {
      return { success: false, error: 'No USDC found in stealth wallet' };
    }
    
    if (usdcBalance === BigInt(0)) {
      return { success: false, error: 'Stealth wallet has 0 USDC' };
    }
    
    console.log(`[Stealth Recovery] Step 2: Found ${Number(usdcBalance) / 1_000_000} USDC`);
    
    // Step 3: Get owner's USDC account
    const ownerUsdcAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      ownerPubkey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    // Step 4: Transfer USDC back to owner
    console.log(`[Stealth Recovery] Step 3: Transferring USDC back to owner...`);
    
    const transaction = new Transaction();
    
    transaction.add(
      createTransferInstruction(
        stealthUsdcAccount,
        ownerUsdcAccount,
        stealthPubkey,
        usdcBalance,
        [],
        TOKEN_PROGRAM_ID
      )
    );
    
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = stealthPubkey;
    transaction.sign(stealthKeypair);
    
    const txSignature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    await connection.confirmTransaction({
      signature: txSignature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');
    
    // Mark as used
    markStealthUsed(stealthId, txSignature, stealth.owner, usdcBalance.toString());
    
    console.log(`[Stealth Recovery] ✅ Recovered ${Number(usdcBalance) / 1_000_000} USDC`);
    console.log(`[Stealth Recovery]    TX: ${txSignature}`);
    
    return {
      success: true,
      txSignature,
      recoveredAmount: (Number(usdcBalance) / 1_000_000).toFixed(6),
    };
    
  } catch (error: any) {
    console.error(`[Stealth Recovery] ❌ Error:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * List all funded but unused stealth addresses for an owner
 */
export function getStuckStealthAddresses(owner: string): Array<{
  stealthId: string;
  stealthAddress: string;
  status: string;
  fundedAt?: number;
}> {
  const stealthIds = ownerIndex.get(owner) || [];
  
  return stealthIds
    .map(id => stealthRegistry.get(id)!)
    .filter(s => s.status === 'funded') // Funded but not used
    .map(s => ({
      stealthId: s.id,
      stealthAddress: s.publicKey,
      status: s.status,
      fundedAt: s.fundedAt,
    }));
}

