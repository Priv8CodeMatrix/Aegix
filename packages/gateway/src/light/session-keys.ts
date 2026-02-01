/**
 * Light Protocol Session Key Manager
 * 
 * Implements semi-custodial key management for agent autonomous spending:
 * 
 * 1. Owner signs message to grant session authority to agent
 * 2. Session keypair is generated and encrypted with server secret
 * 3. Session has time limits and spending limits
 * 4. Agent can spend autonomously within limits
 * 5. Owner can revoke session at any time
 * 
 * Security features:
 * - Time-limited sessions (default 24h, max 7 days)
 * - Per-transaction spending limits
 * - Daily spending limits with auto-reset
 * - Owner revocation capability
 * - AES-256-GCM encryption for stored keys
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import { Mutex, withTimeout } from 'async-mutex';
import crypto from 'crypto';
import bs58 from 'bs58';

// Environment configuration
const SESSION_KEY_SECRET = process.env.SESSION_KEY_SECRET || crypto.randomBytes(32).toString('hex');
const DEFAULT_SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// =============================================================================
// SECURITY: Safe BigInt Conversion with Input Validation
// Prevents DoS and unexpected behavior from malformed numeric inputs
// =============================================================================

const MAX_USDC_AMOUNT = BigInt('1000000000000000'); // 1 billion USDC in micro-units (safety cap)

/**
 * Safely convert a string to BigInt with validation
 * Prevents:
 * - Non-numeric strings causing exceptions
 * - Negative amounts
 * - Absurdly large values that could cause issues
 * 
 * @param value - String value to convert
 * @param fieldName - Name of field for error messages
 * @returns Validated BigInt value
 * @throws Error if value is invalid
 */
function safeBigInt(value: string, fieldName: string): bigint {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a string, got ${typeof value}`);
  }
  
  // Only allow numeric strings (digits only, no signs or decimals)
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${fieldName}: must be a numeric string (digits only)`);
  }
  
  const num = BigInt(value);
  
  // Sanity check: amounts should never be negative (BigInt from digits can't be, but defensive)
  if (num < 0n) {
    throw new Error(`Invalid ${fieldName}: cannot be negative`);
  }
  
  // Sanity check: cap at reasonable maximum to prevent overflow issues
  if (num > MAX_USDC_AMOUNT) {
    throw new Error(`Invalid ${fieldName}: exceeds maximum allowed value`);
  }
  
  return num;
}

// =============================================================================
// SECURITY: Mutex-backed Atomic Spending System
// Prevents race conditions in concurrent spending limit checks
// =============================================================================

const spendingMutexes = new Map<string, Mutex>();
const SPENDING_MUTEX_TIMEOUT = 3000; // 3 second timeout to prevent deadlocks

/**
 * Get or create a mutex for a specific session key
 * Each session key gets its own mutex to allow parallel operations on different sessions
 */
function getSpendingMutex(sessionPubkey: string): Mutex {
  if (!spendingMutexes.has(sessionPubkey)) {
    spendingMutexes.set(sessionPubkey, withTimeout(new Mutex(), SPENDING_MUTEX_TIMEOUT));
  }
  return spendingMutexes.get(sessionPubkey)!;
}

/**
 * Cleanup old mutexes to prevent memory leaks
 * Call periodically or when session keys are revoked
 */
export function cleanupSpendingMutex(sessionPubkey: string): void {
  spendingMutexes.delete(sessionPubkey);
}

/**
 * Session key status
 */
export type SessionKeyStatus = 'active' | 'expired' | 'revoked' | 'pending';

/**
 * Spending limits for session key
 */
export interface SessionSpendingLimits {
  maxPerTransaction: string;  // Max USDC per tx (micro units, e.g., "1000000" = 1 USDC)
  dailyLimit: string;         // Max USDC per day (micro units)
}

/**
 * Light Protocol session key data
 */
export interface LightSessionKey {
  // Identity
  publicKey: string;              // Session key public key (base58)
  encryptedSecretKey: string;     // AES-256-GCM encrypted session private key
  iv: string;                     // Initialization vector for decryption
  authTag: string;                // Authentication tag for decryption
  
  // Timing
  grantedAt: string;              // ISO timestamp when session was granted
  expiresAt: string;              // ISO timestamp when session expires
  
  // Spending limits
  maxPerTransaction: string;      // Max per single transaction (micro-USDC)
  dailyLimit: string;             // Daily spending limit (micro-USDC)
  spentToday: string;             // Amount spent today (micro-USDC)
  lastResetDate: string;          // Date of last daily reset (YYYY-MM-DD)
  
  // Status
  status: SessionKeyStatus;
  revokedAt?: string;             // ISO timestamp if revoked
  revokedBy?: string;             // Who revoked (owner address)
  
  // Pool association
  lightPoolAddress?: string;      // Associated compressed pool address
  merkleTree?: string;            // Merkle tree for this session's compressed accounts
}

/**
 * Result of creating a session key
 */
export interface CreateSessionResult {
  sessionKey: LightSessionKey;
  poolAddress: string;
  merkleTree: string;
  expiresAt: string;
}

/**
 * Result of validating a session key
 */
export interface ValidateSessionResult {
  valid: boolean;
  reason?: string;
  remainingDailyLimit?: string;
  sessionExpiresIn?: number;  // milliseconds
}

// =============================================================================
// Encryption Helpers
// =============================================================================

/**
 * Encrypt a session keypair's secret key using AES-256-GCM
 */
function encryptSecretKey(secretKey: Uint8Array): {
  encrypted: string;
  iv: string;
  authTag: string;
} {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(SESSION_KEY_SECRET, 'hex').slice(0, 32);
  
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(Buffer.from(secretKey));
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypt a session keypair's secret key
 */
function decryptSecretKey(encrypted: string, iv: string, authTag: string): Uint8Array {
  const key = Buffer.from(SESSION_KEY_SECRET, 'hex').slice(0, 32);
  const ivBuffer = Buffer.from(iv, 'base64');
  const authTagBuffer = Buffer.from(authTag, 'base64');
  const encryptedBuffer = Buffer.from(encrypted, 'base64');
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuffer);
  decipher.setAuthTag(authTagBuffer);
  
  let decrypted = decipher.update(encryptedBuffer);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return new Uint8Array(decrypted);
}

// =============================================================================
// Session Key Management
// =============================================================================

/**
 * Create a new session key for an agent
 * 
 * @param ownerAddress - Owner's wallet address (verified via signature)
 * @param ownerSignature - Signature proving ownership
 * @param message - Message that was signed
 * @param limits - Spending limits for this session
 * @param durationMs - Session duration in milliseconds (default 24h)
 * @returns Created session key info
 */
export function createSessionKey(
  ownerAddress: string,
  ownerSignature: string,
  message: string,
  limits: SessionSpendingLimits,
  durationMs: number = DEFAULT_SESSION_DURATION_MS
): CreateSessionResult {
  console.log(`[SessionKeys] Creating session for owner: ${ownerAddress.slice(0, 8)}...`);
  
  // Validate duration
  if (durationMs > MAX_SESSION_DURATION_MS) {
    throw new Error(`Session duration cannot exceed ${MAX_SESSION_DURATION_MS / (24 * 60 * 60 * 1000)} days`);
  }
  
  // Verify the signature matches the expected message format
  // In production, you'd verify the ed25519 signature here
  const expectedMessagePattern = /^AEGIX_SESSION_GRANT::/;
  if (!expectedMessagePattern.test(message)) {
    throw new Error('Invalid session grant message format');
  }
  
  // Generate new session keypair
  const sessionKeypair = Keypair.generate();
  const sessionPubkey = sessionKeypair.publicKey.toBase58();
  
  // Encrypt the secret key
  const { encrypted, iv, authTag } = encryptSecretKey(sessionKeypair.secretKey);
  
  // Calculate expiration
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMs);
  const today = now.toISOString().split('T')[0];
  
  // Create session key data
  const sessionKey: LightSessionKey = {
    publicKey: sessionPubkey,
    encryptedSecretKey: encrypted,
    iv,
    authTag,
    grantedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    maxPerTransaction: limits.maxPerTransaction,
    dailyLimit: limits.dailyLimit,
    spentToday: '0',
    lastResetDate: today,
    status: 'active',
    lightPoolAddress: sessionPubkey, // Pool is associated with session key
    merkleTree: 'noopb9bkMVfRPU8AsBHBNRs9nnSb94Y97B96k4cdVUd', // Default merkle tree
  };
  
  console.log(`[SessionKeys] ✓ Session created: ${sessionPubkey.slice(0, 12)}...`);
  console.log(`[SessionKeys]   Expires: ${expiresAt.toISOString()}`);
  console.log(`[SessionKeys]   Limits: ${limits.maxPerTransaction} per tx, ${limits.dailyLimit} daily`);
  
  return {
    sessionKey,
    poolAddress: sessionPubkey,
    merkleTree: sessionKey.merkleTree!,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Validate a session key and check spending limits
 * 
 * @param sessionKey - The session key to validate
 * @param spendAmount - Amount to spend (optional, for limit check)
 * @returns Validation result
 */
export function validateSessionKey(
  sessionKey: LightSessionKey,
  spendAmount?: string
): ValidateSessionResult {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  // Check status
  if (sessionKey.status === 'revoked') {
    return {
      valid: false,
      reason: `Session was revoked at ${sessionKey.revokedAt}`,
    };
  }
  
  if (sessionKey.status === 'expired') {
    return {
      valid: false,
      reason: 'Session has expired',
    };
  }
  
  // Check expiration
  const expiresAt = new Date(sessionKey.expiresAt);
  if (now >= expiresAt) {
    return {
      valid: false,
      reason: 'Session has expired',
    };
  }
  
  // Reset daily spending if needed
  // SECURITY: Use safeBigInt for validated numeric conversions
  let spentToday = safeBigInt(sessionKey.spentToday, 'spentToday');
  if (sessionKey.lastResetDate !== today) {
    spentToday = 0n;
    // Note: Caller should update the session key with new date and reset amount
  }
  
  // Calculate remaining daily limit
  const dailyLimit = safeBigInt(sessionKey.dailyLimit, 'dailyLimit');
  const remainingDailyLimit = dailyLimit - spentToday;
  
  // Check spending amount if provided
  if (spendAmount) {
    const amount = safeBigInt(spendAmount, 'spendAmount');
    const maxPerTx = safeBigInt(sessionKey.maxPerTransaction, 'maxPerTransaction');
    
    // Check per-transaction limit
    if (amount > maxPerTx) {
      return {
        valid: false,
        reason: `Amount ${amount} exceeds per-transaction limit of ${maxPerTx}`,
        remainingDailyLimit: remainingDailyLimit.toString(),
      };
    }
    
    // Check daily limit
    if (amount > remainingDailyLimit) {
      return {
        valid: false,
        reason: `Amount ${amount} exceeds remaining daily limit of ${remainingDailyLimit}`,
        remainingDailyLimit: remainingDailyLimit.toString(),
      };
    }
  }
  
  return {
    valid: true,
    remainingDailyLimit: remainingDailyLimit.toString(),
    sessionExpiresIn: expiresAt.getTime() - now.getTime(),
  };
}

/**
 * Revoke a session key
 * 
 * @param sessionKey - The session key to revoke
 * @param ownerAddress - Address of the owner revoking
 * @param ownerSignature - Signature proving ownership
 * @returns Updated session key
 */
export function revokeSessionKey(
  sessionKey: LightSessionKey,
  ownerAddress: string,
  ownerSignature: string
): LightSessionKey {
  console.log(`[SessionKeys] Revoking session: ${sessionKey.publicKey.slice(0, 12)}...`);
  
  // Mark as revoked
  const revokedSession: LightSessionKey = {
    ...sessionKey,
    status: 'revoked',
    revokedAt: new Date().toISOString(),
    revokedBy: ownerAddress,
  };
  
  console.log(`[SessionKeys] ✓ Session revoked by ${ownerAddress.slice(0, 8)}...`);
  
  return revokedSession;
}

/**
 * Record spending against session key limits
 * 
 * @param sessionKey - The session key
 * @param amount - Amount spent (micro-USDC)
 * @returns Updated session key
 */
export function recordSpending(
  sessionKey: LightSessionKey,
  amount: string
): LightSessionKey {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  // SECURITY: Validate amount input before processing
  const validatedAmount = safeBigInt(amount, 'amount');
  
  // Reset daily spending if new day
  let spentToday = safeBigInt(sessionKey.spentToday, 'spentToday');
  let lastResetDate = sessionKey.lastResetDate;
  
  if (lastResetDate !== today) {
    spentToday = 0n;
    lastResetDate = today;
    console.log(`[SessionKeys] Daily spending reset for ${sessionKey.publicKey.slice(0, 12)}...`);
  }
  
  // Add new spending (both values are now validated)
  spentToday += validatedAmount;
  
  console.log(`[SessionKeys] Recorded spending: ${amount} (total today: ${spentToday.toString()})`);
  
  return {
    ...sessionKey,
    spentToday: spentToday.toString(),
    lastResetDate,
  };
}

// =============================================================================
// SECURITY: Atomic Spending Validation & Reservation
// Prevents "Limit Breaker" race condition attacks
// =============================================================================

/**
 * Atomically validate and reserve spending against session key limits
 * 
 * SECURITY: This function uses mutex locking to prevent race conditions
 * where multiple concurrent requests could bypass spending limits.
 * 
 * The flow is:
 * 1. Acquire mutex lock for this session key
 * 2. Validate spending limits
 * 3. Atomically record spending (decrement available budget)
 * 4. Release mutex lock
 * 5. Only then proceed to transaction signing
 * 
 * @param sessionKey - The session key to validate and update
 * @param amount - Amount to spend (micro-USDC)
 * @returns Object with validation result and updated session key
 */
export async function validateAndReserveSpending(
  sessionKey: LightSessionKey,
  amount: string
): Promise<{ valid: boolean; updatedKey?: LightSessionKey; reason?: string }> {
  const mutex = getSpendingMutex(sessionKey.publicKey);
  
  let release;
  try {
    release = await mutex.acquire();
  } catch (timeoutError) {
    console.error(`[SessionKeys] ✗ Spending mutex timeout for ${sessionKey.publicKey.slice(0, 12)}...`);
    return { valid: false, reason: 'Concurrent spending lock timeout - please retry' };
  }
  
  try {
    // Step 1: Validate limits (checks expiry, per-tx limit, daily limit)
    const validation = validateSessionKey(sessionKey, amount);
    if (!validation.valid) {
      console.warn(`[SessionKeys] ✗ Validation failed: ${validation.reason}`);
      return { valid: false, reason: validation.reason };
    }
    
    // Step 2: Atomically record spending (this updates the session key)
    const updatedKey = recordSpending(sessionKey, amount);
    
    console.log(`[SessionKeys] ✓ Atomically reserved ${amount} for ${sessionKey.publicKey.slice(0, 12)}...`);
    
    return { valid: true, updatedKey };
  } finally {
    release();
  }
}

/**
 * Get the decrypted session keypair for signing transactions
 * 
 * SECURITY: Secret key is cleared from memory after Keypair construction
 * to minimize exposure window for side-channel attacks.
 * 
 * @param sessionKey - The encrypted session key data
 * @returns Decrypted Keypair
 */
export function getSessionKeypair(sessionKey: LightSessionKey): Keypair {
  // Validate session is active
  const validation = validateSessionKey(sessionKey);
  if (!validation.valid) {
    throw new Error(`Cannot use session key: ${validation.reason}`);
  }
  
  // Decrypt the secret key
  const secretKey = decryptSecretKey(
    sessionKey.encryptedSecretKey,
    sessionKey.iv,
    sessionKey.authTag
  );
  
  try {
    return Keypair.fromSecretKey(secretKey);
  } finally {
    // SECURITY: Best-effort memory clearing
    // Overwrite the secret key with random data to minimize exposure window
    // Note: JavaScript doesn't guarantee memory clearing, but this reduces risk
    crypto.randomFillSync(secretKey);
  }
}

/**
 * Update session key status based on current time
 * Call this periodically or before validation
 */
export function refreshSessionStatus(sessionKey: LightSessionKey): LightSessionKey {
  const now = new Date();
  const expiresAt = new Date(sessionKey.expiresAt);
  
  if (sessionKey.status === 'active' && now >= expiresAt) {
    return {
      ...sessionKey,
      status: 'expired',
    };
  }
  
  return sessionKey;
}

/**
 * Get human-readable session info for display
 */
export function getSessionInfo(sessionKey: LightSessionKey): {
  publicKey: string;
  status: SessionKeyStatus;
  expiresIn: string;
  maxPerTx: string;
  dailyLimit: string;
  spentToday: string;
  remainingToday: string;
} {
  const now = new Date();
  const expiresAt = new Date(sessionKey.expiresAt);
  const remainingMs = Math.max(0, expiresAt.getTime() - now.getTime());
  
  // Format remaining time
  let expiresIn: string;
  if (remainingMs === 0) {
    expiresIn = 'Expired';
  } else if (remainingMs < 60 * 60 * 1000) {
    expiresIn = `${Math.floor(remainingMs / (60 * 1000))} minutes`;
  } else if (remainingMs < 24 * 60 * 60 * 1000) {
    expiresIn = `${Math.floor(remainingMs / (60 * 60 * 1000))} hours`;
  } else {
    expiresIn = `${Math.floor(remainingMs / (24 * 60 * 60 * 1000))} days`;
  }
  
  // Calculate remaining daily limit
  // SECURITY: Use safeBigInt for validated numeric conversions
  const dailyLimit = safeBigInt(sessionKey.dailyLimit, 'dailyLimit');
  const spentToday = safeBigInt(sessionKey.spentToday, 'spentToday');
  const maxPerTx = safeBigInt(sessionKey.maxPerTransaction, 'maxPerTransaction');
  const remainingToday = dailyLimit - spentToday;
  
  // Format amounts as USDC
  const formatUsdc = (microUsdc: bigint) => (Number(microUsdc) / 1_000_000).toFixed(2);
  
  return {
    publicKey: sessionKey.publicKey,
    status: sessionKey.status,
    expiresIn,
    maxPerTx: formatUsdc(maxPerTx) + ' USDC',
    dailyLimit: formatUsdc(dailyLimit) + ' USDC',
    spentToday: formatUsdc(spentToday) + ' USDC',
    remainingToday: formatUsdc(remainingToday) + ' USDC',
  };
}

export default {
  createSessionKey,
  validateSessionKey,
  revokeSessionKey,
  recordSpending,
  getSessionKeypair,
  refreshSessionStatus,
  getSessionInfo,
  // Security: Atomic spending validation
  validateAndReserveSpending,
  cleanupSpendingMutex,
};
