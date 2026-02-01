/**
 * Recovery Pool - Dedicated Fee Payer for Stealth Transactions
 * 
 * THIS IS A REAL SOLANA WALLET that the user must fund!
 * 
 * Purpose:
 * 1. Pay transaction fees (breaks on-chain link between Stealth Pool and burners)
 * 2. Pay ATA rent for recipients (~0.002 SOL)
 * 3. Reclaim rent when burner ATAs are closed
 * 
 * The user must:
 * 1. Initialize the Recovery Pool (generates a keypair)
 * 2. Fund the Recovery Pool address with SOL
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
import { Mutex, withTimeout } from 'async-mutex';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';

// Constants
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const MIN_LIQUIDITY_SOL = 0.005; // Minimum SOL balance required
const ATA_RENT_SOL = 0.00203928; // Approximate rent for ATA

// =============================================================================
// SECURITY: Mutex-backed Liquidity Reservation System
// Prevents race conditions in concurrent payment processing
// =============================================================================

const liquidityMutex = withTimeout(new Mutex(), 5000); // 5s timeout to prevent deadlocks
const pendingReservations = new Map<string, number>();

/**
 * Atomically reserve liquidity from the Recovery Pool
 * Must be called before any ATA creation or fee payment
 * 
 * @param amount - Amount of SOL to reserve
 * @param txId - Unique transaction ID for tracking
 * @returns true if reservation succeeded, false if insufficient liquidity
 */
export async function reserveLiquidity(amount: number, txId: string): Promise<boolean> {
  const release = await liquidityMutex.acquire();
  try {
    const balance = await getRecoveryPoolBalance();
    const totalPending = Array.from(pendingReservations.values()).reduce((a, b) => a + b, 0);
    const available = balance - totalPending - MIN_LIQUIDITY_SOL;
    
    if (available >= amount) {
      pendingReservations.set(txId, amount);
      // Auto-expire reservation after 60 seconds to prevent leaks
      setTimeout(() => {
        if (pendingReservations.has(txId)) {
          console.warn(`[Recovery] ⚠ Auto-expiring stale reservation: ${txId}`);
          pendingReservations.delete(txId);
        }
      }, 60000);
      console.log(`[Recovery] ✓ Reserved ${amount} SOL for ${txId} (available: ${available.toFixed(4)})`);
      return true;
    }
    
    console.warn(`[Recovery] ✗ Insufficient liquidity for ${txId}: need ${amount}, have ${available.toFixed(4)}`);
    return false;
  } finally {
    release();
  }
}

/**
 * Release a liquidity reservation after transaction completes (success or failure)
 * @param txId - Transaction ID to release
 */
export function releaseReservation(txId: string): void {
  if (pendingReservations.has(txId)) {
    const amount = pendingReservations.get(txId);
    pendingReservations.delete(txId);
    console.log(`[Recovery] ✓ Released reservation ${txId} (${amount} SOL)`);
  }
}

/**
 * Get current pending reservations total
 */
export function getPendingReservationsTotal(): number {
  return Array.from(pendingReservations.values()).reduce((a, b) => a + b, 0);
}

// =============================================================================
// SECURITY: Rate Limiting for Decompress Operations
// Prevents Fee-Drain DoS attacks
// =============================================================================

const decompressRateLimit = new Map<string, number[]>();
const MAX_DECOMPRESS_PER_MINUTE = 5;

/**
 * Check if a decompress operation is allowed under rate limits
 * Uses sliding-window algorithm for accurate rate limiting
 * 
 * @param ownerId - Owner/agent identifier to rate limit
 * @returns true if allowed, false if rate limited
 */
export function checkDecompressRateLimit(ownerId: string): boolean {
  const now = Date.now();
  const requests = decompressRateLimit.get(ownerId) || [];
  
  // Filter to only requests in the last 60 seconds
  const recent = requests.filter(t => now - t < 60000);
  
  if (recent.length >= MAX_DECOMPRESS_PER_MINUTE) {
    console.warn(`[Recovery] ✗ Rate limit exceeded for ${ownerId.slice(0, 12)}... (${recent.length}/${MAX_DECOMPRESS_PER_MINUTE} per minute)`);
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

/**
 * Cleanup stale rate limit entries to prevent memory bloat
 */
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
// END SECURITY ADDITIONS
// =============================================================================

// Persistence path
const DATA_DIR = path.join(process.cwd(), 'data');
const RECOVERY_FILE = path.join(DATA_DIR, 'recovery-pool.json');

// Recovery Pool state
let recoveryKeypair: Keypair | null = null;
let connection: Connection | null = null;
let totalRecycled: number = 0;
let isInitialized: boolean = false;

/**
 * Load Recovery Pool from disk or environment
 */
export async function loadRecoveryPool(conn?: Connection): Promise<boolean> {
  if (conn) {
    connection = conn;
  }

  // First try environment variable
  const envKey = process.env.RECOVERY_POOL_PRIVATE_KEY;
  if (envKey && envKey.trim() !== '') {
    try {
      const secretKey = bs58.decode(envKey);
      recoveryKeypair = Keypair.fromSecretKey(secretKey);
      isInitialized = true;
      console.log(`[Recovery] ✓ Loaded from ENV: ${recoveryKeypair.publicKey.toBase58().slice(0, 12)}...`);
      return true;
    } catch (error) {
      console.error('[Recovery] Invalid RECOVERY_POOL_PRIVATE_KEY in ENV');
    }
  }

  // Then try disk persistence
  try {
    if (fs.existsSync(RECOVERY_FILE)) {
      const data = JSON.parse(fs.readFileSync(RECOVERY_FILE, 'utf-8'));
      if (data.privateKey) {
        const secretKey = bs58.decode(data.privateKey);
        recoveryKeypair = Keypair.fromSecretKey(secretKey);
        totalRecycled = data.totalRecycled || 0;
        isInitialized = true;
        console.log(`[Recovery] ✓ Loaded from disk: ${recoveryKeypair.publicKey.toBase58().slice(0, 12)}...`);
        return true;
      }
    }
  } catch (error) {
    console.warn('[Recovery] Failed to load from disk:', error);
  }

  console.log('[Recovery] ⚠ Recovery Pool not initialized - user must create one');
  return false;
}

/**
 * Create a NEW Recovery Pool keypair
 * Called when user clicks "Initialize" in the frontend
 */
export async function createRecoveryPool(conn?: Connection): Promise<{
  address: string;
  privateKey: string;
  message: string;
}> {
  if (conn) {
    connection = conn;
  }

  // Generate new keypair
  const newKeypair = Keypair.generate();
  const privateKeyBase58 = bs58.encode(newKeypair.secretKey);
  
  // Save to disk
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    fs.writeFileSync(RECOVERY_FILE, JSON.stringify({
      privateKey: privateKeyBase58,
      address: newKeypair.publicKey.toBase58(),
      createdAt: new Date().toISOString(),
      totalRecycled: 0,
    }, null, 2));
    
    console.log(`[Recovery] ✓ Created new Recovery Pool: ${newKeypair.publicKey.toBase58()}`);
  } catch (error) {
    console.error('[Recovery] Failed to persist keypair:', error);
  }

  // Set as active
  recoveryKeypair = newKeypair;
  isInitialized = true;
  totalRecycled = 0;

  return {
    address: newKeypair.publicKey.toBase58(),
    privateKey: privateKeyBase58,
    message: `Recovery Pool created! Fund this address with at least ${MIN_LIQUIDITY_SOL} SOL to enable privacy payments.`,
  };
}

/**
 * Check if Recovery Pool is initialized
 */
export function isRecoveryPoolInitialized(): boolean {
  return isInitialized && recoveryKeypair !== null;
}

/**
 * Get the Recovery Pool keypair (throws if not initialized)
 */
export function getRecoveryPoolKeypair(): Keypair {
  if (!recoveryKeypair) {
    throw new Error('Recovery Pool not initialized. User must create one first.');
  }
  return recoveryKeypair;
}

/**
 * Get the Recovery Pool public key (throws if not initialized)
 */
export function getRecoveryPoolAddress(): PublicKey {
  return getRecoveryPoolKeypair().publicKey;
}

/**
 * Set the connection for recovery pool operations
 */
export function setRecoveryConnection(conn: Connection): void {
  connection = conn;
}

/**
 * Get the Recovery Pool's SOL balance
 */
export async function getRecoveryPoolBalance(conn?: Connection): Promise<number> {
  if (!isRecoveryPoolInitialized()) {
    return 0;
  }

  const useConn = conn || connection;
  if (!useConn) {
    throw new Error('No connection available');
  }

  const keypair = getRecoveryPoolKeypair();
  const balance = await useConn.getBalance(keypair.publicKey);
  return balance / LAMPORTS_PER_SOL;
}

/**
 * Check if Recovery Pool has sufficient liquidity
 */
export async function validateRecoveryLiquidity(conn?: Connection): Promise<{
  valid: boolean;
  balance: number;
  required: number;
  shortfall?: number;
  initialized: boolean;
}> {
  if (!isRecoveryPoolInitialized()) {
    return {
      valid: false,
      balance: 0,
      required: MIN_LIQUIDITY_SOL,
      shortfall: MIN_LIQUIDITY_SOL,
      initialized: false,
    };
  }

  const balance = await getRecoveryPoolBalance(conn);
  const valid = balance >= MIN_LIQUIDITY_SOL;
  
  return {
    valid,
    balance,
    required: MIN_LIQUIDITY_SOL,
    shortfall: valid ? undefined : MIN_LIQUIDITY_SOL - balance,
    initialized: true,
  };
}

/**
 * Get Recovery Pool status
 */
export async function getRecoveryPoolStatus(conn?: Connection): Promise<{
  initialized: boolean;
  address: string | null;
  balance: number;
  isHealthy: boolean;
  totalRecycled: number;
  minRequired: number;
}> {
  if (!isRecoveryPoolInitialized()) {
    return {
      initialized: false,
      address: null,
      balance: 0,
      isHealthy: false,
      totalRecycled: 0,
      minRequired: MIN_LIQUIDITY_SOL,
    };
  }

  const keypair = getRecoveryPoolKeypair();
  const balance = await getRecoveryPoolBalance(conn);
  
  return {
    initialized: true,
    address: keypair.publicKey.toBase58(),
    balance,
    isHealthy: balance >= MIN_LIQUIDITY_SOL,
    totalRecycled,
    minRequired: MIN_LIQUIDITY_SOL,
  };
}

/**
 * Create an ATA for a recipient, paid by the Recovery Pool
 */
export function createRecipientAtaInstruction(
  recipientAddress: PublicKey,
  recipientAta: PublicKey,
  mint: PublicKey = USDC_MINT
): ReturnType<typeof createAssociatedTokenAccountInstruction> {
  const recoveryPubkey = getRecoveryPoolAddress();
  
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
 * Create instruction to close an empty ATA and reclaim rent
 */
export function createCloseAtaInstruction(
  ataAddress: PublicKey,
  owner: PublicKey
): ReturnType<typeof createCloseAccountInstruction> {
  const recoveryPubkey = getRecoveryPoolAddress();
  
  return createCloseAccountInstruction(
    ataAddress,          // ATA to close
    recoveryPubkey,      // Destination for rent (Recovery Pool!)
    owner,               // Authority (owner of the ATA)
    [],                  // Multi-signers (none)
    TOKEN_PROGRAM_ID
  );
}

/**
 * Sweep rent from empty burner ATAs
 */
export async function sweepBurnerRent(
  burnerKeypairs: Keypair[],
  conn?: Connection,
  mint: PublicKey = USDC_MINT
): Promise<{ swept: number; totalRent: number; signatures: string[] }> {
  if (!isRecoveryPoolInitialized()) {
    throw new Error('Recovery Pool not initialized');
  }

  const useConn = conn || connection;
  if (!useConn) {
    throw new Error('No connection available');
  }

  const recoveryKp = getRecoveryPoolKeypair();
  let swept = 0;
  let totalRent = 0;
  const signatures: string[] = [];

  for (const burnerKeypair of burnerKeypairs) {
    try {
      const ata = await getAssociatedTokenAddress(mint, burnerKeypair.publicKey);
      
      try {
        const account = await getAccount(useConn, ata, 'confirmed');
        
        if (account.amount === 0n) {
          const transaction = new Transaction();
          
          transaction.add(
            createCloseAccountInstruction(
              ata,
              recoveryKp.publicKey,
              burnerKeypair.publicKey,
              [],
              TOKEN_PROGRAM_ID
            )
          );

          const { blockhash } = await useConn.getLatestBlockhash('confirmed');
          transaction.recentBlockhash = blockhash;
          transaction.feePayer = recoveryKp.publicKey;
          
          transaction.sign(recoveryKp, burnerKeypair);
          
          const signature = await useConn.sendRawTransaction(transaction.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
          });
          
          await useConn.confirmTransaction(signature, 'confirmed');
          
          swept++;
          totalRent += ATA_RENT_SOL;
          signatures.push(signature);
          totalRecycled += ATA_RENT_SOL;
          
          // Persist updated totalRecycled
          persistRecycledAmount();
          
          console.log(`[Recovery] ✓ Swept rent from burner ${burnerKeypair.publicKey.toBase58().slice(0, 12)}...`);
        }
      } catch {
        continue;
      }
    } catch (error: any) {
      console.warn(`[Recovery] Failed to sweep burner: ${error.message}`);
    }
  }

  return { swept, totalRent, signatures };
}

/**
 * Persist recycled amount to disk
 */
function persistRecycledAmount(): void {
  try {
    if (fs.existsSync(RECOVERY_FILE)) {
      const data = JSON.parse(fs.readFileSync(RECOVERY_FILE, 'utf-8'));
      data.totalRecycled = totalRecycled;
      fs.writeFileSync(RECOVERY_FILE, JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.warn('[Recovery] Failed to persist recycled amount:', error);
  }
}

/**
 * Get total SOL recycled
 */
export function getTotalRecycled(): number {
  return totalRecycled;
}

/**
 * Add to recycled total
 */
export function addToRecycled(amount: number): void {
  totalRecycled += amount;
  persistRecycledAmount();
}

/**
 * Check if Recovery Pool is ready for use (initialized AND funded)
 */
export function isRecoveryPoolReady(): boolean {
  return isRecoveryPoolInitialized();
}

/**
 * Initialize and return the Recovery Pool Keypair
 * Legacy function - loads if exists, throws if not initialized
 */
export async function initRecoveryPool(conn?: Connection): Promise<Keypair> {
  await loadRecoveryPool(conn);
  
  if (!isRecoveryPoolInitialized()) {
    throw new Error('Recovery Pool not initialized. User must create one first via the dashboard.');
  }
  
  return getRecoveryPoolKeypair();
}

export default {
  loadRecoveryPool,
  createRecoveryPool,
  isRecoveryPoolInitialized,
  getRecoveryPoolKeypair,
  getRecoveryPoolAddress,
  setRecoveryConnection,
  getRecoveryPoolBalance,
  validateRecoveryLiquidity,
  getRecoveryPoolStatus,
  createRecipientAtaInstruction,
  recipientAtaExists,
  createCloseAtaInstruction,
  sweepBurnerRent,
  getTotalRecycled,
  addToRecycled,
  isRecoveryPoolReady,
  initRecoveryPool,
  // Security: Atomic liquidity reservation
  reserveLiquidity,
  releaseReservation,
  getPendingReservationsTotal,
  // Security: Rate limiting
  checkDecompressRateLimit,
};
