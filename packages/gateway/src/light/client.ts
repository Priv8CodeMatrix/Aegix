/**
 * Light Protocol Client - ZK Compression Integration
 * 
 * Aegix 4.0 - Helius RPC Required for Compression
 * 
 * IMPORTANT: Light Protocol compression methods require a compatible RPC.
 * Set LIGHT_RPC_URL in your .env file with a Helius API key:
 *   LIGHT_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
 * 
 * Features:
 * - createCompressedBurner() - Create ephemeral single-use burner accounts
 * - executeCompressedTransfer() - Execute ZK compressed transfers
 * - getCompressedBalance() - Query compressed token balances
 * 
 * Uses @lightprotocol/stateless.js for mainnet-ready ZK compression
 */

import {
  PublicKey,
  Keypair,
  Transaction,
  Connection,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import crypto from 'crypto';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';

// Security: Import tight expiry calculation
import { calculateTightExpiry, PAYMENT_EXPIRY_BLOCKS } from '../x402/protocol.js';

// Light Protocol imports
import { Rpc, createRpc, bn, selectStateTreeInfo, TreeInfo } from '@lightprotocol/stateless.js';
import { 
  CompressedTokenProgram, 
  selectMinCompressedTokenAccountsForTransfer,
  getTokenPoolInfos,
  selectTokenPoolInfo,
  TokenPoolInfo,
  decompress as lightDecompress,  // High-level function that handles signing
} from '@lightprotocol/compressed-token';

// Constants
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;

// =============================================================================
// RPC Configuration - Helius Required
// =============================================================================

// Get RPC URL from environment - Helius required for compression
const LIGHT_RPC_URL = process.env.LIGHT_RPC_URL || '';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Connection state
let lightConnection: Rpc | null = null;
let regularConnection: Connection | null = null;
let initialized = false;
let compressionSupported = false;
let lastHealthCheck: { healthy: boolean; timestamp: number; error?: string } = {
  healthy: false,
  timestamp: 0,
};

// Health check cache duration (30 seconds)
const HEALTH_CHECK_CACHE_MS = 30000;

// =============================================================================
// RPC Initialization - Helius Required
// =============================================================================

/**
 * Initialize Light Protocol connection with Helius RPC
 * Requires LIGHT_RPC_URL to be set in .env with a Helius endpoint
 */
export async function initLightConnection(): Promise<Rpc> {
  if (lightConnection && initialized) {
    return lightConnection;
  }

  console.log('[Light] Initializing Light Protocol connection...');
  
  // Check if LIGHT_RPC_URL is configured
  if (!LIGHT_RPC_URL || LIGHT_RPC_URL.trim() === '') {
    console.error('[Light] ════════════════════════════════════════════════════════════');
    console.error('[Light] ⚠️  LIGHT_RPC_URL not set in .env file!');
    console.error('[Light] ');
    console.error('[Light] Light Protocol compression requires Helius RPC.');
    console.error('[Light] Add to your .env file:');
    console.error('[Light]   LIGHT_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY');
    console.error('[Light] ');
    console.error('[Light] Get a free API key at: https://helius.xyz');
    console.error('[Light] ════════════════════════════════════════════════════════════');
    
    // Create basic connections for non-compressed operations
    regularConnection = new Connection(SOLANA_RPC_URL, 'confirmed');
    lightConnection = createRpc(SOLANA_RPC_URL, SOLANA_RPC_URL);
    initialized = true;
    compressionSupported = false;
    
    return lightConnection;
  }

  try {
    console.log(`[Light] Connecting to: ${LIGHT_RPC_URL.slice(0, 50)}...`);
    
    // Create Light RPC connection with Helius
    lightConnection = createRpc(LIGHT_RPC_URL, LIGHT_RPC_URL);
    regularConnection = new Connection(LIGHT_RPC_URL, 'confirmed');
    
    // Test basic connectivity
    const slot = await regularConnection.getSlot();
    console.log(`[Light] ✓ Connected to Solana (slot: ${slot})`);
    
    // Test compression support
    const compressionTest = await testCompressionMethods();
    
    if (compressionTest.supported) {
      console.log('[Light] ════════════════════════════════════════════════════════════');
      console.log('[Light] ✓ Light Protocol connected via Helius RPC');
      console.log('[Light] ✓ Compression methods: AVAILABLE');
      console.log('[Light] ✓ ZK compressed payments: ENABLED');
      console.log('[Light] ════════════════════════════════════════════════════════════');
      compressionSupported = true;
    } else {
      console.error('[Light] ════════════════════════════════════════════════════════════');
      console.error('[Light] ⚠️  RPC does not support Light Protocol compression methods!');
      console.error(`[Light] Error: ${compressionTest.error}`);
      console.error('[Light] ');
      console.error('[Light] Your LIGHT_RPC_URL may not be a valid Helius endpoint.');
      console.error('[Light] Ensure you have a Helius API key with DAS API access.');
      console.error('[Light] ════════════════════════════════════════════════════════════');
      compressionSupported = false;
    }
    
    initialized = true;
    return lightConnection;
    
  } catch (error: any) {
    console.error('[Light] ════════════════════════════════════════════════════════════');
    console.error('[Light] ⚠️  Failed to connect to Light Protocol RPC!');
    console.error(`[Light] Error: ${error.message}`);
    console.error('[Light] ');
    console.error('[Light] Check your LIGHT_RPC_URL configuration.');
    console.error('[Light] ════════════════════════════════════════════════════════════');
    
    // Fallback for basic operations
    regularConnection = new Connection(SOLANA_RPC_URL, 'confirmed');
    lightConnection = createRpc(SOLANA_RPC_URL, SOLANA_RPC_URL);
    initialized = true;
    compressionSupported = false;
    
    return lightConnection;
  }
}

/**
 * Test if RPC supports Light Protocol compression methods
 */
async function testCompressionMethods(): Promise<{ supported: boolean; error?: string }> {
  if (!lightConnection) {
    return { supported: false, error: 'No connection' };
  }
  
  try {
    // Test getCompressedTokenAccountsByOwner with a known address
    // This will return empty but confirms the method exists
    const testPubkey = new PublicKey('11111111111111111111111111111111');
    
    await lightConnection.getCompressedTokenAccountsByOwner(testPubkey, {
      mint: USDC_MINT,
    });
    
    return { supported: true };
    
  } catch (error: any) {
    const errorMsg = error.message?.toLowerCase() || '';
    
    // Check for "method not found" errors
    if (errorMsg.includes('method not found') || 
        errorMsg.includes('-32601') ||
        errorMsg.includes('not supported') ||
        errorMsg.includes('invalid method')) {
      return { 
        supported: false, 
        error: 'Invalid RPC—compression methods not available. Use Helius for Light Protocol support.',
      };
    }
    
    // Network/timeout errors
    if (errorMsg.includes('timeout') || 
        errorMsg.includes('econnrefused') ||
        errorMsg.includes('fetch')) {
      return { 
        supported: false, 
        error: `Network error: ${error.message}`,
      };
    }
    
    // Empty result or "not found" is OK - method exists
    if (errorMsg.includes('not found') || 
        errorMsg.includes('no compressed') ||
        errorMsg.includes('empty')) {
      return { supported: true };
    }
    
    // Unknown error - assume method exists
    console.warn(`[Light] Unknown compression test response: ${error.message}`);
    return { supported: true };
  }
}

/**
 * Get the Light RPC connection
 */
export function getLightConnection(): Rpc {
  if (!lightConnection || !initialized) {
    throw new Error('Light connection not initialized. Call initLightConnection() first.');
  }
  return lightConnection;
}

/**
 * Get the regular Solana connection
 */
export function getRegularConnection(): Connection {
  if (!regularConnection) {
    regularConnection = new Connection(LIGHT_RPC_URL || SOLANA_RPC_URL, 'confirmed');
  }
  return regularConnection;
}

/**
 * Check if compression is supported
 */
export function isCompressionSupported(): boolean {
  return compressionSupported;
}

// =============================================================================
// Health Check
// =============================================================================

/**
 * Check if Light Protocol is available and healthy
 * Returns cached result for 30 seconds
 */
export async function checkLightHealth(): Promise<{
  healthy: boolean;
  slot?: number;
  error?: string;
  hint?: string;
  rpcUrl?: string;
}> {
  const now = Date.now();
  
  // Return cached result if recent
  if (lastHealthCheck.timestamp > 0 && 
      now - lastHealthCheck.timestamp < HEALTH_CHECK_CACHE_MS) {
    return {
      healthy: lastHealthCheck.healthy,
      error: lastHealthCheck.error,
      rpcUrl: LIGHT_RPC_URL?.slice(0, 50) || 'not configured',
    };
  }
  
  try {
    // Ensure connection is initialized
    await initLightConnection();
    
    // Check if LIGHT_RPC_URL is configured
    if (!LIGHT_RPC_URL || LIGHT_RPC_URL.trim() === '') {
      lastHealthCheck = {
        healthy: false,
        timestamp: now,
        error: 'LIGHT_RPC_URL not configured',
      };
      return {
        healthy: false,
        error: 'LIGHT_RPC_URL not set in .env file',
        hint: 'Add LIGHT_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY to your .env file. Get a free key at helius.xyz',
        rpcUrl: 'not configured',
      };
    }
    
    // Check compression support
    if (!compressionSupported) {
      lastHealthCheck = {
        healthy: false,
        timestamp: now,
        error: 'Compression methods not available',
      };
      return {
        healthy: false,
        error: 'RPC does not support Light Protocol compression methods',
        hint: 'Ensure LIGHT_RPC_URL is a valid Helius endpoint with DAS API access.',
        rpcUrl: LIGHT_RPC_URL?.slice(0, 50),
      };
    }
    
    // Test connectivity
    const conn = getRegularConnection();
    const slot = await conn.getSlot();
    
    lastHealthCheck = { healthy: true, timestamp: now };
    
    return { 
      healthy: true, 
      slot,
      rpcUrl: LIGHT_RPC_URL?.slice(0, 50),
    };
    
  } catch (error: any) {
    lastHealthCheck = {
      healthy: false,
      timestamp: now,
      error: error.message,
    };
    
    return { 
      healthy: false, 
      error: error.message,
      hint: 'Check your LIGHT_RPC_URL configuration and network connection.',
      rpcUrl: LIGHT_RPC_URL?.slice(0, 50) || 'not configured',
    };
  }
}

/**
 * Force re-check health (bypass cache)
 */
export async function forceHealthCheck(): Promise<ReturnType<typeof checkLightHealth>> {
  lastHealthCheck = { healthy: false, timestamp: 0 };
  compressionSupported = false;
  initialized = false;
  lightConnection = null;
  return checkLightHealth();
}

// =============================================================================
// Type Definitions
// =============================================================================

export interface CompressedAccountInfo {
  address: PublicKey;
  owner: PublicKey;
  lamports: number;
  data: Buffer;
  hash: string;
}

export interface CompressedTokenBalance {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  delegate?: PublicKey;
}

export interface CompressedPoolResult {
  poolId: string;
  poolAddress: string;
  merkleTree: string;
  createdAt: string;
}

export interface CompressedBurnerResult {
  burnerAddress: string;
  merkleTree: string;
  proofHash: string;
  createdAt: string;
}

export interface CompressedTransferResult {
  signature: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  proofHash: string;
}

// =============================================================================
// Compressed Pool & Burner Operations
// =============================================================================

/**
 * Create a compressed pool account for an agent
 */
export async function createCompressedPool(
  ownerPubkey: PublicKey,
  sessionKeyPubkey: PublicKey
): Promise<CompressedPoolResult> {
  // Initialize connection FIRST to set compressionSupported flag
  await initLightConnection();
  
  if (!compressionSupported) {
    throw new Error('Light Protocol compression not available. Set LIGHT_RPC_URL with a Helius endpoint.');
  }
  
  console.log(`[Light] Creating compressed pool for owner: ${ownerPubkey.toBase58().slice(0, 8)}...`);
  
  try {
    const poolId = `light-pool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const poolAddress = sessionKeyPubkey.toBase58();
    const merkleTree = await getDefaultMerkleTree();
    
    console.log(`[Light] ✓ Compressed pool created: ${poolId}`);
    
    return {
      poolId,
      poolAddress,
      merkleTree,
      createdAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error('[Light] Failed to create compressed pool:', error.message);
    throw new Error(`Failed to create compressed pool: ${error.message}`);
  }
}

/**
 * Create an ephemeral compressed burner account for a single payment
 * This breaks the link between the pool and individual payments
 * 
 * MAXIMUM PRIVACY FLOW:
 * Pool → Compressed Burner → Recipient (two transactions)
 * 
 * Returns the burner keypair so it can sign the second transfer (burner → recipient)
 */
export async function createCompressedBurner(
  poolOwnerPubkey: PublicKey,
  sessionKey?: Keypair
): Promise<CompressedBurnerResult & { burnerKeypair: Keypair }> {
  // Initialize connection FIRST to set compressionSupported flag
  await initLightConnection();
  
  if (!compressionSupported) {
    throw new Error('Light Protocol compression not available. Set LIGHT_RPC_URL with a Helius endpoint.');
  }
  
  console.log(`[Light] Creating compressed burner for pool: ${poolOwnerPubkey.toBase58().slice(0, 8)}...`);
  
  try {
    // Generate ephemeral burner keypair - used for one payment only
    const burnerKeypair = Keypair.generate();
    const burnerAddress = burnerKeypair.publicKey.toBase58();
    const proofHash = generateProofHash(burnerAddress, Date.now().toString());
    const merkleTree = await getDefaultMerkleTree();
    
    console.log(`[Light] ✓ Compressed burner created: ${burnerAddress.slice(0, 12)}...`);
    console.log(`[Light]   This burner will receive funds from pool, then forward to recipient`);
    
    return {
      burnerAddress,
      burnerKeypair, // Return keypair so it can sign the second transfer
      merkleTree,
      proofHash,
      createdAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error('[Light] Failed to create compressed burner:', error.message);
    throw new Error(`Failed to create compressed burner: ${error.message}`);
  }
}

/**
 * Get compressed token balance for an account
 */
export async function getCompressedBalance(
  ownerPubkey: PublicKey,
  mint: PublicKey = USDC_MINT
): Promise<CompressedTokenBalance | null> {
  // IMPORTANT: Initialize connection FIRST, then check compressionSupported
  // The flag is only set during initialization!
  const connection = await initLightConnection();
  
  if (!compressionSupported) {
    console.warn('[Light] Compression not available - cannot get compressed balance');
    return null;
  }
  
  console.log(`[Light] Getting compressed balance for: ${ownerPubkey.toBase58().slice(0, 8)}...`);
  
  try {
    const compressedAccounts = await connection.getCompressedTokenAccountsByOwner(ownerPubkey, {
      mint,
    });
    
    if (!compressedAccounts || compressedAccounts.items.length === 0) {
      console.log('[Light] No compressed token accounts found');
      return null;
    }
    
    let totalAmount = BigInt(0);
    for (const account of compressedAccounts.items) {
      totalAmount += BigInt(account.parsed.amount.toString());
    }
    
    console.log(`[Light] ✓ Compressed balance: ${Number(totalAmount) / 10 ** USDC_DECIMALS} USDC`);
    
    return {
      mint,
      owner: ownerPubkey,
      amount: totalAmount,
    };
  } catch (error: any) {
    console.error('[Light] Failed to get compressed balance:', error.message);
    return null;
  }
}

// =============================================================================
// Compressed Transfer Operations
// =============================================================================

/**
 * Build a compressed token transfer transaction
 * 
 * @param ownerKeypair - The keypair that OWNS the compressed tokens (pool keypair)
 * @param toAddress - The recipient address
 * @param amount - Amount in micro units (e.g., 1000000 = 1 USDC)
 * @param mint - Token mint (defaults to USDC)
 * 
 * NOTE: The owner keypair MUST sign the transaction to authorize the transfer.
 * This is different from regular SPL transfers where only the fee payer signs.
 */
export async function buildCompressedTransfer(
  ownerKeypair: Keypair,
  toAddress: PublicKey,
  amount: bigint,
  mint: PublicKey = USDC_MINT
): Promise<{ transaction: Transaction; proofHash: string }> {
  // Initialize connection FIRST to set compressionSupported flag
  const connection = await initLightConnection();
  
  if (!compressionSupported) {
    throw new Error('Light Protocol compression not available. Set LIGHT_RPC_URL with a Helius endpoint.');
  }
  
  const regularConn = getRegularConnection();
  const fromOwner = ownerKeypair.publicKey;
  
  console.log(`[Light] Building compressed transfer: ${amount.toString()} → ${toAddress.toBase58().slice(0, 8)}...`);
  console.log(`[Light]   Owner: ${fromOwner.toBase58().slice(0, 12)}...`);
  
  try {
    const compressedAccounts = await connection.getCompressedTokenAccountsByOwner(fromOwner, {
      mint,
    });
    
    if (!compressedAccounts || compressedAccounts.items.length === 0) {
      throw new Error('No compressed token accounts found for sender');
    }
    
    console.log(`[Light]   Found ${compressedAccounts.items.length} compressed account(s)`);
    
    const [selectedAccounts, _] = selectMinCompressedTokenAccountsForTransfer(
      compressedAccounts.items,
      amount
    );
    
    if (selectedAccounts.length === 0) {
      throw new Error('Insufficient compressed token balance');
    }
    
    console.log(`[Light]   Selected ${selectedAccounts.length} account(s) for transfer`);
    
    const proof = await connection.getValidityProof(
      selectedAccounts.map(account => bn(account.compressedAccount.hash))
    );
    
    console.log(`[Light]   Validity proof obtained`);
    
    // Build transfer instruction - owner is BOTH payer and token owner
    const transferInstruction = await CompressedTokenProgram.transfer({
      payer: fromOwner, // Owner pays for the transaction
      inputCompressedTokenAccounts: selectedAccounts,
      toAddress,
      amount,
      recentInputStateRootIndices: proof.rootIndices,
      recentValidityProof: proof.compressedProof,
    });
    
    // Import ComputeBudgetProgram for setting higher compute limits
    const { ComputeBudgetProgram } = await import('@solana/web3.js');
    
    const transaction = new Transaction();
    
    // CRITICAL: Add compute budget instruction FIRST - ZK proofs need more compute
    // Light Protocol operations require ~500k-1M compute units
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })
    );
    
    // Add the actual transfer instruction
    transaction.add(transferInstruction);
    
    const { blockhash } = await regularConn.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = fromOwner; // Owner pays fees
    
    const proofHash = generateProofHash(
      fromOwner.toBase58(),
      toAddress.toBase58(),
      amount.toString()
    );
    
    console.log(`[Light] ✓ Compressed transfer built (proof: ${proofHash.slice(0, 12)}...)`);
    
    return { transaction, proofHash };
  } catch (error: any) {
    console.error('[Light] Failed to build compressed transfer:', error.message);
    throw new Error(`Failed to build compressed transfer: ${error.message}`);
  }
}

/**
 * Execute a compressed token transfer
 * 
 * @param ownerKeypair - The keypair that OWNS the compressed tokens (must sign to authorize)
 * @param toAddress - The recipient address
 * @param amount - Amount in micro units (e.g., 1000000 = 1 USDC)
 * @param mint - Token mint (defaults to USDC)
 * 
 * The owner keypair signs the transaction to authorize spending their compressed tokens.
 * This provides maximum privacy as the transfer uses ZK proofs.
 */
export async function executeCompressedTransfer(
  ownerKeypair: Keypair,
  toAddress: PublicKey,
  amount: bigint,
  mint: PublicKey = USDC_MINT
): Promise<CompressedTransferResult> {
  // Initialize connection FIRST to set compressionSupported flag
  await initLightConnection();
  
  if (!compressionSupported) {
    throw new Error('Light Protocol compression not available. Set LIGHT_RPC_URL with a Helius endpoint.');
  }
  
  const regularConn = getRegularConnection();
  const fromOwner = ownerKeypair.publicKey;
  
  console.log(`[Light] Executing compressed transfer: ${Number(amount) / 10 ** USDC_DECIMALS} USDC`);
  console.log(`[Light]   From: ${fromOwner.toBase58().slice(0, 12)}...`);
  console.log(`[Light]   To: ${toAddress.toBase58().slice(0, 12)}...`);
  
  try {
    const { transaction, proofHash } = await buildCompressedTransfer(
      ownerKeypair,
      toAddress,
      amount,
      mint
    );
    
    // Sign with the owner keypair (authorizes the compressed token transfer)
    transaction.sign(ownerKeypair);
    
    console.log(`[Light] Transaction signed by owner, broadcasting...`);
    
    const signature = await regularConn.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    console.log(`[Light] ✓ Compressed transfer submitted: ${signature.slice(0, 16)}...`);
    
    await regularConn.confirmTransaction(signature, 'confirmed');
    
    console.log(`[Light] ✓ Compressed transfer confirmed`);
    
    return {
      signature,
      fromAddress: fromOwner.toBase58(),
      toAddress: toAddress.toBase58(),
      amount: amount.toString(),
      proofHash,
    };
  } catch (error: any) {
    console.error('[Light] Failed to execute compressed transfer:', error.message);
    throw new Error(`Failed to execute compressed transfer: ${error.message}`);
  }
}

/**
 * Execute a compressed token transfer with a SEPARATE fee payer
 * 
 * This is used for the two-step burner flow:
 * - Burner owns the compressed tokens and authorizes the transfer
 * - Pool pays the transaction fees (burner has no SOL)
 * 
 * Privacy is maintained: recipient sees burner address, not pool or wallet
 * 
 * @param ownerKeypair - The keypair that OWNS the compressed tokens (burner)
 * @param feePayerKeypair - The keypair that PAYS the transaction fees (pool)
 * @param toAddress - The recipient address
 * @param amount - Amount in micro units (e.g., 1000000 = 1 USDC)
 * @param mint - Token mint (defaults to USDC)
 */
export async function executeCompressedTransferWithFeePayer(
  ownerKeypair: Keypair,
  feePayerKeypair: Keypair,
  toAddress: PublicKey,
  amount: bigint,
  mint: PublicKey = USDC_MINT
): Promise<CompressedTransferResult> {
  // Initialize connection FIRST to set compressionSupported flag
  const connection = await initLightConnection();
  
  if (!compressionSupported) {
    throw new Error('Light Protocol compression not available. Set LIGHT_RPC_URL with a Helius endpoint.');
  }
  
  const regularConn = getRegularConnection();
  const fromOwner = ownerKeypair.publicKey;
  const feePayer = feePayerKeypair.publicKey;
  
  console.log(`[Light] Executing compressed transfer with separate fee payer`);
  console.log(`[Light]   Amount: ${Number(amount) / 10 ** USDC_DECIMALS} USDC`);
  console.log(`[Light]   Token Owner: ${fromOwner.toBase58().slice(0, 12)}... (authorizes transfer)`);
  console.log(`[Light]   Fee Payer: ${feePayer.toBase58().slice(0, 12)}... (pays gas)`);
  console.log(`[Light]   To: ${toAddress.toBase58().slice(0, 12)}...`);
  
  try {
    // Get compressed token accounts for the owner (burner)
    const compressedAccounts = await connection.getCompressedTokenAccountsByOwner(fromOwner, { mint });
    
    if (!compressedAccounts || compressedAccounts.items.length === 0) {
      throw new Error('No compressed token accounts found for sender');
    }
    
    console.log(`[Light]   Found ${compressedAccounts.items.length} compressed account(s)`);
    
    const [selectedAccounts, _] = selectMinCompressedTokenAccountsForTransfer(
      compressedAccounts.items,
      amount
    );
    
    if (selectedAccounts.length === 0) {
      throw new Error('Insufficient compressed token balance');
    }
    
    console.log(`[Light]   Selected ${selectedAccounts.length} account(s) for transfer`);
    
    // Get validity proof
    const proof = await connection.getValidityProof(
      selectedAccounts.map(account => bn(account.compressedAccount.hash))
    );
    
    console.log(`[Light]   Validity proof obtained`);
    
    // Build transfer instruction with FEE PAYER as payer (for rent/fees)
    // CRITICAL: Must specify 'owner' when fee payer differs from token owner!
    // - payer: Who pays the transaction fees (pool)
    // - owner: Who owns the compressed tokens and authorizes the transfer (burner)
    const transferInstruction = await CompressedTokenProgram.transfer({
      payer: feePayer,    // Pool pays transaction fees
      owner: fromOwner,   // Burner authorizes the token transfer (REQUIRED!)
      inputCompressedTokenAccounts: selectedAccounts,
      toAddress,
      amount,
      recentInputStateRootIndices: proof.rootIndices,
      recentValidityProof: proof.compressedProof,
    });
    
    console.log(`[Light]   Transfer instruction built with owner=${fromOwner.toBase58().slice(0, 12)}...`);
    
    const { ComputeBudgetProgram } = await import('@solana/web3.js');
    
    const transaction = new Transaction();
    
    // Add compute budget for ZK proof processing
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })
    );
    
    // Add the transfer instruction
    transaction.add(transferInstruction);
    
    // Set transaction metadata
    const { blockhash } = await regularConn.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = feePayer; // Pool pays fees
    
    // BOTH must sign:
    // - Fee payer (pool) signs to authorize paying fees
    // - Owner (burner) signs to authorize the token transfer
    transaction.sign(feePayerKeypair, ownerKeypair);
    
    console.log(`[Light] Transaction signed by both fee payer and token owner`);
    
    // Submit transaction
    const signature = await regularConn.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    console.log(`[Light] ✓ Compressed transfer submitted: ${signature.slice(0, 16)}...`);
    
    await regularConn.confirmTransaction(signature, 'confirmed');
    
    console.log(`[Light] ✓ Compressed transfer confirmed`);
    
    const proofHash = generateProofHash(
      fromOwner.toBase58(),
      toAddress.toBase58(),
      amount.toString()
    );
    
    return {
      signature,
      fromAddress: fromOwner.toBase58(),
      toAddress: toAddress.toBase58(),
      amount: amount.toString(),
      proofHash,
    };
  } catch (error: any) {
    console.error('[Light] Failed to execute compressed transfer with fee payer:', error.message);
    throw new Error(`Failed to execute compressed transfer: ${error.message}`);
  }
}

// PayAI facilitator URL for gasless transactions
const PAYAI_FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://facilitator.payai.network';

// Cache for PayAI fee payer
let cachedPayAIFeePayer: string | null = null;
let feePayerCacheTime = 0;
const FEE_PAYER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get PayAI's fee payer address for gasless transactions
 */
async function getPayAIFeePayer(): Promise<string | null> {
  if (cachedPayAIFeePayer && Date.now() - feePayerCacheTime < FEE_PAYER_CACHE_TTL) {
    return cachedPayAIFeePayer;
  }
  
  try {
    console.log(`[Light PayAI] Fetching fee payer from ${PAYAI_FACILITATOR_URL}/supported...`);
    
    const response = await fetch(`${PAYAI_FACILITATOR_URL}/supported`, {
      headers: { 'Accept': 'application/json' },
    });
    
    if (!response.ok) {
      console.error(`[Light PayAI] /supported returned ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    // Look for Solana network fee payer
    if (data.kinds && Array.isArray(data.kinds)) {
      for (const kind of data.kinds) {
        if (kind.network === 'solana' || kind.network?.startsWith('solana:')) {
          if (kind.extra?.feePayer) {
            cachedPayAIFeePayer = kind.extra.feePayer as string;
            feePayerCacheTime = Date.now();
            console.log(`[Light PayAI] ✓ Found fee payer: ${cachedPayAIFeePayer?.slice(0, 12)}...`);
            return cachedPayAIFeePayer;
          }
        }
      }
    }
    
    // Check signers fallback
    if (data.signers?.['solana:*']?.[0]) {
      cachedPayAIFeePayer = data.signers['solana:*'][0] as string;
      feePayerCacheTime = Date.now();
      console.log(`[Light PayAI] ✓ Found fee payer from signers: ${cachedPayAIFeePayer?.slice(0, 12)}...`);
      return cachedPayAIFeePayer;
    }
    
    console.error('[Light PayAI] No Solana fee payer found');
    return null;
    
  } catch (error: any) {
    console.error('[Light PayAI] Failed to fetch fee payer:', error.message);
    return null;
  }
}

/**
 * Execute a GASLESS compressed token transfer using PayAI as fee payer
 * 
 * PayAI pays all SOL transaction fees - the burner only needs compressed USDC!
 * 
 * @param ownerKeypair - The keypair that OWNS the compressed tokens (must sign to authorize)
 * @param toAddress - The recipient address
 * @param amount - Amount in micro units (e.g., 1000000 = 1 USDC)
 * @param mint - Token mint (defaults to USDC)
 */
export async function executeGaslessCompressedTransfer(
  ownerKeypair: Keypair,
  toAddress: PublicKey,
  amount: bigint,
  mint: PublicKey = USDC_MINT
): Promise<CompressedTransferResult> {
  // Initialize connection FIRST to set compressionSupported flag
  const connection = await initLightConnection();
  
  if (!compressionSupported) {
    throw new Error('Light Protocol compression not available. Set LIGHT_RPC_URL with a Helius endpoint.');
  }
  
  const regularConn = getRegularConnection();
  const fromOwner = ownerKeypair.publicKey;
  
  console.log(`[Light Gasless] Executing GASLESS compressed transfer: ${Number(amount) / 10 ** USDC_DECIMALS} USDC`);
  console.log(`[Light Gasless]   From: ${fromOwner.toBase58().slice(0, 12)}...`);
  console.log(`[Light Gasless]   To: ${toAddress.toBase58().slice(0, 12)}...`);
  
  try {
    // Step 1: Get PayAI fee payer
    const feePayer = await getPayAIFeePayer();
    if (!feePayer) {
      throw new Error('PayAI fee payer not available - cannot execute gasless transfer');
    }
    
    const feePayerPubkey = new PublicKey(feePayer);
    console.log(`[Light Gasless] ✓ PayAI fee payer: ${feePayer.slice(0, 12)}... (PayAI pays gas!)`);
    
    // Step 2: Build compressed transfer (this uses our existing logic)
    console.log(`[Light Gasless] Building compressed transfer...`);
    
    const compressedAccounts = await connection.getCompressedTokenAccountsByOwner(fromOwner, { mint });
    
    if (!compressedAccounts || compressedAccounts.items.length === 0) {
      throw new Error('No compressed token accounts found for sender');
    }
    
    console.log(`[Light Gasless]   Found ${compressedAccounts.items.length} compressed account(s)`);
    
    const [selectedAccounts, _] = selectMinCompressedTokenAccountsForTransfer(
      compressedAccounts.items,
      amount
    );
    
    if (selectedAccounts.length === 0) {
      throw new Error('Insufficient compressed token balance');
    }
    
    console.log(`[Light Gasless]   Selected ${selectedAccounts.length} account(s) for transfer`);
    
    const proof = await connection.getValidityProof(
      selectedAccounts.map(account => bn(account.compressedAccount.hash))
    );
    
    console.log(`[Light Gasless]   Validity proof obtained`);
    
    // Build transfer instruction
    const transferInstruction = await CompressedTokenProgram.transfer({
      payer: feePayerPubkey, // PayAI pays for the transaction!
      inputCompressedTokenAccounts: selectedAccounts,
      toAddress,
      amount,
      recentInputStateRootIndices: proof.rootIndices,
      recentValidityProof: proof.compressedProof,
    });
    
    const { ComputeBudgetProgram } = await import('@solana/web3.js');
    
    const transaction = new Transaction();
    
    // Add compute budget instructions (required for ZK proofs)
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })
    );
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }) // Priority fee for faster processing
    );
    
    // Add the actual transfer instruction
    transaction.add(transferInstruction);
    
    const { blockhash, lastValidBlockHeight } = await regularConn.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    // SECURITY: Use tighter expiry to prevent delayed transaction submission attacks
    transaction.lastValidBlockHeight = calculateTightExpiry(lastValidBlockHeight - 150);
    transaction.feePayer = feePayerPubkey; // PayAI as fee payer
    
    // Step 3: Owner partial signs (authorizes the transfer, but not as fee payer)
    transaction.partialSign(ownerKeypair);
    
    console.log(`[Light Gasless] ✓ Transaction built and signed by owner`);
    console.log(`[Light Gasless]   Fee payer (PayAI): ${feePayer.slice(0, 12)}...`);
    console.log(`[Light Gasless]   Token owner (Burner): ${fromOwner.toBase58().slice(0, 12)}...`);
    
    // Step 4: Serialize for PayAI submission
    const serializedTx = transaction.serialize({
      requireAllSignatures: false, // PayAI will add fee payer signature
      verifySignatures: false,
    });
    const base64Tx = serializedTx.toString('base64');
    
    // Step 5: Create x402 payment payload
    const paymentPayload = {
      x402Version: 1,
      scheme: 'exact',
      network: 'solana',
      payload: {
        transaction: base64Tx,
      },
    };
    
    const paymentRequirements = {
      scheme: 'exact',
      network: 'solana',
      maxAmountRequired: amount.toString(),
      resource: `compressed-transfer-${Date.now()}`,
      description: 'Aegix compressed stealth payment',
      mimeType: 'application/json',
      outputSchema: {},
      payTo: toAddress.toBase58(),
      maxTimeoutSeconds: 300,
      asset: mint.toBase58(),
      extra: {
        feePayer: feePayer,
        compressed: true,
      },
    };
    
    console.log(`[Light Gasless] Submitting to PayAI facilitator...`);
    console.log(`[Light Gasless]   TX size: ${base64Tx.length} chars`);
    
    // Step 6: Submit to PayAI's /settle endpoint
    const settleResponse = await fetch(`${PAYAI_FACILITATOR_URL}/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentPayload,
        paymentRequirements,
      }),
    });
    
    if (!settleResponse.ok) {
      const errorText = await settleResponse.text();
      console.error(`[Light Gasless] PayAI settle failed: ${settleResponse.status} - ${errorText.slice(0, 200)}`);
      throw new Error(`PayAI gasless submission failed: ${settleResponse.status}`);
    }
    
    const settleResult = await settleResponse.json();
    console.log(`[Light Gasless] PayAI response:`, JSON.stringify(settleResult).slice(0, 300));
    
    const signature = settleResult.transaction || settleResult.signature || settleResult.txSignature;
    
    if (settleResult.success && signature) {
      console.log(`[Light Gasless] ✓ PayAI gasless transfer complete!`);
      console.log(`[Light Gasless]   TX: ${signature.slice(0, 20)}...`);
      console.log(`[Light Gasless]   Gas paid by: PayAI (${feePayer.slice(0, 12)}...)`);
      console.log(`[Light Gasless]   Burner needed: COMPRESSED USDC ONLY, NO SOL!`);
      
      // Wait for confirmation
      await regularConn.confirmTransaction(signature, 'confirmed');
      
      const proofHash = generateProofHash(
        fromOwner.toBase58(),
        toAddress.toBase58(),
        amount.toString()
      );
      
      return {
        signature,
        fromAddress: fromOwner.toBase58(),
        toAddress: toAddress.toBase58(),
        amount: amount.toString(),
        proofHash,
      };
    }
    
    // PayAI returned error
    const errorReason = settleResult.errorReason || settleResult.error || settleResult.message || 'Unknown PayAI error';
    console.error(`[Light Gasless] PayAI error: ${errorReason}`);
    throw new Error(`PayAI gasless failed: ${errorReason}`);
    
  } catch (error: any) {
    console.error('[Light Gasless] Failed:', error.message);
    throw new Error(`Failed to execute gasless compressed transfer: ${error.message}`);
  }
}

/**
 * Compress (shield) tokens from a regular account to a compressed account
 * 
 * This converts regular SPL USDC to Light Protocol compressed state.
 * First-time compression is supported - no existing compressed account required.
 * 
 * IMPORTANT: Requires a properly configured Light Protocol RPC (Helius) that supports:
 * - getStateTreeInfos() - for output state tree selection
 * - getTokenPoolInfos() - for token pool info lookup
 */
export async function compressTokens(
  ownerPubkey: PublicKey,
  amount: bigint,
  mint: PublicKey = USDC_MINT
): Promise<Transaction> {
  // Initialize connection FIRST to set compressionSupported flag
  const rpc = await initLightConnection();
  
  if (!compressionSupported) {
    throw new Error('Light Protocol compression not available. Set LIGHT_RPC_URL with a Helius endpoint.');
  }
  
  // Validate inputs
  if (!ownerPubkey || !(ownerPubkey instanceof PublicKey)) {
    throw new Error('Invalid owner public key provided');
  }
  
  if (!amount || amount <= 0n) {
    throw new Error('Invalid amount: must be greater than zero');
  }
  
  if (!mint || !(mint instanceof PublicKey)) {
    throw new Error('Invalid mint public key provided');
  }
  
  const regularConn = getRegularConnection();
  
  const amountDisplay = Number(amount) / 10 ** USDC_DECIMALS;
  console.log(`[Light] Building compress transaction: ${amountDisplay} USDC`);
  console.log(`[Light]   Owner: ${ownerPubkey.toBase58().slice(0, 12)}...`);
  console.log(`[Light]   Mint: ${mint.toBase58().slice(0, 12)}...`);
  
  try {
    // Get the source ATA (must exist and have sufficient balance)
    const sourceAta = await getAssociatedTokenAddress(mint, ownerPubkey);
    
    // Verify source ATA exists
    const ataInfo = await regularConn.getAccountInfo(sourceAta);
    if (!ataInfo) {
      throw new Error(`No USDC token account found for this wallet. Deposit USDC first.`);
    }
    
    console.log(`[Light]   Source ATA: ${sourceAta.toBase58().slice(0, 12)}...`);
    
    // Step 1: Get state tree infos from the RPC
    console.log(`[Light]   Fetching state tree infos...`);
    let outputStateTreeInfo: TreeInfo;
    try {
      const stateTreeInfos = await rpc.getStateTreeInfos();
      if (!stateTreeInfos || stateTreeInfos.length === 0) {
        throw new Error('No state trees available from RPC');
      }
      outputStateTreeInfo = selectStateTreeInfo(stateTreeInfos);
      console.log(`[Light]   Output Tree: ${outputStateTreeInfo.tree.toBase58().slice(0, 12)}...`);
      console.log(`[Light]   Queue: ${outputStateTreeInfo.queue.toBase58().slice(0, 12)}...`);
    } catch (treeError: any) {
      console.error('[Light] Failed to get state tree infos:', treeError.message);
      throw new Error(`Failed to get state tree infos from RPC: ${treeError.message}. Ensure your RPC supports Light Protocol compression.`);
    }
    
    // Step 2: Get token pool infos for the mint
    console.log(`[Light]   Fetching token pool infos for USDC...`);
    let tokenPoolInfo: TokenPoolInfo | undefined;
    try {
      const tokenPoolInfos = await getTokenPoolInfos(rpc, mint);
      if (tokenPoolInfos && tokenPoolInfos.length > 0) {
        tokenPoolInfo = selectTokenPoolInfo(tokenPoolInfos);
        console.log(`[Light]   Token Pool: ${tokenPoolInfo.tokenPoolPda.toBase58().slice(0, 12)}...`);
      } else {
        console.warn('[Light]   No token pool found for USDC - will try without');
      }
    } catch (poolError: any) {
      console.warn('[Light]   Could not fetch token pool info (will continue):', poolError.message);
    }
    
    // Step 3: Build the compress instruction with proper parameters
    console.log(`[Light]   Building compress instruction...`);
    const compressInstruction = await CompressedTokenProgram.compress({
      payer: ownerPubkey,
      owner: ownerPubkey,
      source: sourceAta,
      toAddress: ownerPubkey,
      amount,
      mint,
      outputStateTreeInfo,
      tokenPoolInfo,
    });
    
    if (!compressInstruction) {
      throw new Error('Failed to create compress instruction - Light Protocol SDK returned null');
    }
    
    // Import ComputeBudgetProgram for setting higher compute limits
    const { ComputeBudgetProgram } = await import('@solana/web3.js');
    
    // Build the transaction
    const transaction = new Transaction();
    
    // CRITICAL: Add compute budget instruction FIRST - ZK proofs need more compute
    // Light Protocol operations require ~500k-1M compute units
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })
    );
    
    // Add the actual compress instruction
    transaction.add(compressInstruction);
    
    const { blockhash } = await regularConn.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = ownerPubkey;
    
    console.log(`[Light] ✓ Compress transaction built successfully`);
    console.log(`[Light]   Blockhash: ${blockhash.slice(0, 16)}...`);
    
    return transaction;
  } catch (error: any) {
    // Provide helpful error messages
    let userFriendlyError = error.message || 'Unknown error building compress transaction';
    
    if (error.message?.includes("Cannot read properties of undefined")) {
      userFriendlyError = 'Light Protocol SDK error - missing required state tree or token pool info. Ensure your Helius RPC supports Light Protocol compression.';
    } else if (error.message?.includes('method not found')) {
      userFriendlyError = 'RPC does not support Light Protocol compression methods. Use Helius RPC with compression support.';
    } else if (error.message?.includes('state tree')) {
      userFriendlyError = error.message;
    } else if (error.message?.includes('No USDC')) {
      userFriendlyError = error.message;
    }
    
    console.error('[Light] Failed to build compress transaction:', userFriendlyError);
    console.error('[Light] Original error:', error.message);
    throw new Error(`Failed to build compress transaction: ${userFriendlyError}`);
  }
}

/**
 * Decompress (unshield) tokens from compressed account to regular account
 * 
 * @param ownerPubkey - The owner of the compressed tokens
 * @param amount - Amount in micro units to decompress
 * @param feePayerKeypair - The keypair paying for fees (can be different from owner)
 * @param mint - Token mint (defaults to USDC)
 */
export async function decompressTokens(
  ownerPubkey: PublicKey,
  amount: bigint,
  feePayerKeypair: Keypair,
  mint: PublicKey = USDC_MINT
): Promise<Transaction> {
  // Initialize connection FIRST to set compressionSupported flag
  const rpc = await initLightConnection();
  
  if (!compressionSupported) {
    throw new Error('Light Protocol compression not available. Set LIGHT_RPC_URL with a Helius endpoint.');
  }
  const regularConn = getRegularConnection();
  
  console.log(`[Light] Building decompress transaction: ${Number(amount) / 10 ** USDC_DECIMALS} USDC`);
  console.log(`[Light]   Owner: ${ownerPubkey.toBase58().slice(0, 12)}...`);
  console.log(`[Light]   Fee Payer: ${feePayerKeypair.publicKey.toBase58().slice(0, 12)}...`);
  
  try {
    // Get destination ATA (regular token account for the owner)
    const destinationAta = await getAssociatedTokenAddress(mint, ownerPubkey);
    console.log(`[Light]   Destination ATA: ${destinationAta.toBase58().slice(0, 12)}...`);
    
    // Get compressed token accounts
    const compressedAccounts = await rpc.getCompressedTokenAccountsByOwner(ownerPubkey, {
      mint,
    });
    
    if (!compressedAccounts || compressedAccounts.items.length === 0) {
      throw new Error('No compressed token accounts found');
    }
    
    console.log(`[Light]   Found ${compressedAccounts.items.length} compressed account(s)`);
    
    const [selectedAccounts, _] = selectMinCompressedTokenAccountsForTransfer(
      compressedAccounts.items,
      amount
    );
    
    if (selectedAccounts.length === 0) {
      throw new Error('Insufficient compressed balance');
    }
    
    console.log(`[Light]   Selected ${selectedAccounts.length} account(s) for decompress`);
    
    // Get validity proof
    const proof = await rpc.getValidityProof(
      selectedAccounts.map(account => bn(account.compressedAccount.hash))
    );
    
    console.log(`[Light]   Validity proof obtained`);
    
    // Fetch token pool info - REQUIRED for decompress
    // The SDK uses tokenPoolInfos (plural) to find the pool to withdraw from
    console.log(`[Light]   Fetching token pool info for mint...`);
    let tokenPoolInfo: TokenPoolInfo;
    try {
      const tokenPoolInfos = await getTokenPoolInfos(rpc, mint);
      if (!tokenPoolInfos || tokenPoolInfos.length === 0) {
        throw new Error('No token pool found for this mint');
      }
      tokenPoolInfo = selectTokenPoolInfo(tokenPoolInfos);
      console.log(`[Light]   ✓ Token Pool PDA: ${tokenPoolInfo.tokenPoolPda.toBase58().slice(0, 12)}...`);
      console.log(`[Light]   ✓ Token Program: ${tokenPoolInfo.tokenProgram.toBase58().slice(0, 12)}...`);
      console.log(`[Light]   ✓ Mint: ${tokenPoolInfo.mint.toBase58().slice(0, 12)}...`);
    } catch (poolError: any) {
      console.error('[Light]   Failed to get token pool info:', poolError.message);
      throw new Error(`Token pool info required for decompress: ${poolError.message}`);
    }
    
    // Check if destination ATA exists, if not we need to create it
    let createAtaInstruction = null;
    try {
      await getAccount(regularConn, destinationAta, 'confirmed');
      console.log(`[Light]   ✓ Destination ATA exists`);
    } catch {
      console.log(`[Light]   Destination ATA does not exist, will create it`);
      createAtaInstruction = createAssociatedTokenAccountInstruction(
        feePayerKeypair.publicKey,  // Payer
        destinationAta,              // ATA to create
        ownerPubkey,                 // Owner of the ATA
        mint,                        // Token mint
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
    }
    
    // Build decompress instruction
    // SDK expects: payer, inputCompressedTokenAccounts, toAddress, amount, 
    //              recentValidityProof, recentInputStateRootIndices, tokenPoolInfos (PLURAL!)
    console.log(`[Light]   Building decompress instruction...`);
    
    const decompressInstruction = await CompressedTokenProgram.decompress({
      payer: feePayerKeypair.publicKey,
      inputCompressedTokenAccounts: selectedAccounts,
      toAddress: destinationAta,
      amount,
      recentInputStateRootIndices: proof.rootIndices,
      recentValidityProof: proof.compressedProof,
      tokenPoolInfos: tokenPoolInfo,  // FIXED: Use PLURAL form (tokenPoolInfos not tokenPoolInfo)
    });
    
    // Import ComputeBudgetProgram for setting higher compute limits
    const { ComputeBudgetProgram } = await import('@solana/web3.js');
    
    const transaction = new Transaction();
    
    // Add compute budget for ZK proof processing
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })
    );
    
    // Add create ATA instruction if needed
    if (createAtaInstruction) {
      transaction.add(createAtaInstruction);
    }
    
    // Add the decompress instruction
    transaction.add(decompressInstruction);
    
    const { blockhash } = await regularConn.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = feePayerKeypair.publicKey;
    
    console.log(`[Light] ✓ Decompress transaction built`);
    console.log(`[Light]   Blockhash: ${blockhash.slice(0, 16)}...`);
    
    return transaction;
  } catch (error: any) {
    console.error('[Light] Failed to build decompress transaction:', error.message);
    throw new Error(`Failed to build decompress transaction: ${error.message}`);
  }
}

// =============================================================================
// Regular SPL Token Transfer (for decompressed tokens)
// =============================================================================

/**
 * Execute a REGULAR SPL token transfer (not compressed)
 * Used after decompressing tokens to send to recipient in a format they can see
 * 
 * @param senderKeypair - The keypair sending the tokens
 * @param feePayerKeypair - The keypair paying transaction fees (can be same as sender)
 * @param recipientAddress - The recipient's wallet address
 * @param amount - Amount in micro units (e.g., 1000000 = 1 USDC)
 * @param mint - Token mint (defaults to USDC)
 */
export async function executeRegularSplTransfer(
  senderKeypair: Keypair,
  feePayerKeypair: Keypair,
  recipientAddress: PublicKey,
  amount: bigint,
  mint: PublicKey = USDC_MINT
): Promise<{ signature: string; recipientAta: string }> {
  const regularConn = getRegularConnection();
  const senderPubkey = senderKeypair.publicKey;
  const feePayerPubkey = feePayerKeypair.publicKey;
  
  console.log(`[Light] Executing REGULAR SPL transfer (visible to recipient)`);
  console.log(`[Light]   Amount: ${Number(amount) / 10 ** USDC_DECIMALS} USDC`);
  console.log(`[Light]   From: ${senderPubkey.toBase58().slice(0, 12)}...`);
  console.log(`[Light]   To: ${recipientAddress.toBase58().slice(0, 12)}...`);
  console.log(`[Light]   Fee Payer: ${feePayerPubkey.toBase58().slice(0, 12)}...`);
  
  try {
    // Get sender's ATA (must have regular USDC balance)
    const senderAta = await getAssociatedTokenAddress(
      mint, senderPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    // Get recipient's ATA
    const recipientAta = await getAssociatedTokenAddress(
      mint, recipientAddress, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    console.log(`[Light]   Sender ATA: ${senderAta.toBase58().slice(0, 12)}...`);
    console.log(`[Light]   Recipient ATA: ${recipientAta.toBase58().slice(0, 12)}...`);
    
    // Check if recipient ATA exists
    let recipientAtaExists = false;
    try {
      await getAccount(regularConn, recipientAta, 'confirmed');
      recipientAtaExists = true;
      console.log(`[Light]   ✓ Recipient ATA exists`);
    } catch {
      console.log(`[Light]   Creating recipient ATA...`);
    }
    
    const transaction = new Transaction();
    
    // Create recipient ATA if needed
    if (!recipientAtaExists) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          feePayerPubkey,   // Payer
          recipientAta,     // ATA to create
          recipientAddress, // Owner of the ATA
          mint,             // Token mint
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      console.log(`[Light]   Added createATA instruction`);
    }
    
    // Add transfer instruction
    transaction.add(
      createTransferInstruction(
        senderAta,        // Source
        recipientAta,     // Destination
        senderPubkey,     // Owner of source
        amount,           // Amount
        [],               // Multisig signers (none)
        TOKEN_PROGRAM_ID
      )
    );
    console.log(`[Light]   Added transfer instruction`);
    
    // Set transaction metadata
    const { blockhash } = await regularConn.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = feePayerPubkey;
    
    // Sign with all required signers
    const signers = [feePayerKeypair];
    if (!senderPubkey.equals(feePayerPubkey)) {
      signers.push(senderKeypair);
    }
    transaction.sign(...signers);
    
    console.log(`[Light]   Sending transaction...`);
    
    const signature = await regularConn.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    console.log(`[Light] ✓ Regular SPL transfer submitted: ${signature.slice(0, 16)}...`);
    
    await regularConn.confirmTransaction(signature, 'confirmed');
    
    console.log(`[Light] ✓ Regular SPL transfer confirmed - recipient can see funds in wallet!`);
    
    return {
      signature,
      recipientAta: recipientAta.toBase58(),
    };
  } catch (error: any) {
    console.error('[Light] Failed to execute regular SPL transfer:', error.message);
    throw new Error(`Failed to execute regular SPL transfer: ${error.message}`);
  }
}

/**
 * Execute 3-step decompression flow with PayAI x402 gasless transfer
 * 
 * CORRECT FLOW (Recovery Pool Architecture + PayAI x402):
 * 1. Recovery Pool creates BURNER's ATA (pays ~0.002 SOL rent)
 * 2. Decompress compressed USDC to BURNER's ATA (burner now has regular SPL USDC)
 * 3. Burner transfers to Recipient via PayAI x402 (PayAI PAYS GAS!)
 * 4. Close burner's ATA and recover rent to Recovery Pool
 * 
 * Why this flow:
 * - Decompress happens INSIDE the burner wallet
 * - PayAI x402 protocol pays gas for the final payment leg
 * - Burner ATA rent is recovered after transfer
 * - Maximum privacy: Pool → Burner (compressed) → Recipient (x402 gasless)
 * 
 * @param burnerKeypair - Keypair that owns the compressed tokens (MUST SIGN to authorize)
 * @param recoveryKeypair - Recovery Pool keypair that pays fees for decompress
 * @param recipientAddress - Recipient's wallet address  
 * @param amount - Amount in micro units
 */
export async function decompressAndTransfer(
  burnerKeypair: Keypair,
  recoveryKeypair: Keypair,
  recipientAddress: PublicKey,
  amount: bigint,
  mint: PublicKey = USDC_MINT
): Promise<{ decompressTx: string; transferTx: string; recipientAta: string; rentRecovered?: number; payaiFeePayer?: string }> {
  const regularConn = getRegularConnection();
  const rpc = await initLightConnection();
  const burnerPubkey = burnerKeypair.publicKey;
  const recoveryPubkey = recoveryKeypair.publicKey;
  
  // PayAI Facilitator URL for x402 gasless payments
  const PAYAI_FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://facilitator.payai.network';
  
  // ==========================================================================
  // SECURITY: Rate Limiting & Liquidity Reservation
  // Prevents DoS attacks and race conditions
  // ==========================================================================
  
  // Import security functions from recovery module
  const { checkDecompressRateLimit, reserveLiquidity, releaseReservation } = await import('../solana/recovery.js');
  
  // Generate unique transaction ID for tracking
  const txId = `decompress-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  
  // Estimated cost: ~2 ATAs (burner + possibly recipient) + transaction fees
  const estimatedCost = 0.005;
  
  // Check rate limit first (fast check, no RPC calls)
  // SECURITY: Rate limit by Recovery Pool address (constant across all operations)
  // This prevents bypass by generating new ephemeral burner keypairs
  if (!checkDecompressRateLimit(recoveryPubkey.toBase58())) {
    throw new Error('Rate limit exceeded: too many decompress requests per minute');
  }
  
  // Reserve liquidity atomically
  if (!await reserveLiquidity(estimatedCost, txId)) {
    throw new Error('Insufficient Recovery Pool liquidity - please top up the Recovery Pool');
  }
  
  // Wrap entire operation in try/finally to ensure reservation is always released
  try {
  
  console.log(`[Light] ═══════════════════════════════════════════════════════════`);
  console.log(`[Light] 3-STEP DECOMPRESS FLOW (PayAI x402 Gasless)`);
  console.log(`[Light] ═══════════════════════════════════════════════════════════`);
  console.log(`[Light]   Burner (owns compressed tokens): ${burnerPubkey.toBase58().slice(0, 12)}...`);
  console.log(`[Light]   Recovery Pool (pays decompress): ${recoveryPubkey.toBase58().slice(0, 12)}...`);
  console.log(`[Light]   Recipient: ${recipientAddress.toBase58().slice(0, 12)}...`);
  console.log(`[Light]   Amount: ${Number(amount) / 10 ** USDC_DECIMALS} USDC`);
  console.log(`[Light]`);
  console.log(`[Light]   Flow: Pool → Burner(compressed) → Burner(decompressed) → Recipient(PayAI x402)`);
  
  // Get BURNER's ATA - this is where we decompress TO first!
  const burnerAta = await getAssociatedTokenAddress(mint, burnerPubkey);
  console.log(`[Light]   Burner ATA (decompress target): ${burnerAta.toBase58().slice(0, 12)}...`);
  
  // Get RECIPIENT's ATA - final destination
  const recipientAta = await getAssociatedTokenAddress(mint, recipientAddress);
  console.log(`[Light]   Recipient ATA (final destination): ${recipientAta.toBase58().slice(0, 12)}...`);
  
  // ==========================================================================
  // STEP 1: Create BURNER's ATA (Recovery Pool pays rent)
  // ==========================================================================
  console.log(`[Light]`);
  console.log(`[Light] Step 1: Creating BURNER's ATA (Recovery Pool pays rent)...`);
  
  let burnerAtaExists = false;
  try {
    await getAccount(regularConn, burnerAta, 'confirmed');
    burnerAtaExists = true;
    console.log(`[Light]   ✓ Burner ATA already exists`);
  } catch {
    console.log(`[Light]   Burner ATA does not exist, creating...`);
  }
  
  if (!burnerAtaExists) {
    const createBurnerAtaTx = new Transaction();
    createBurnerAtaTx.add(
      createAssociatedTokenAccountInstruction(
        recoveryPubkey,    // RECOVERY POOL pays rent!
        burnerAta,         // ATA to create
        burnerPubkey,      // Owner of the ATA (burner)
        mint,              // Token mint
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    
    const { blockhash: bh1 } = await regularConn.getLatestBlockhash('confirmed');
    createBurnerAtaTx.recentBlockhash = bh1;
    createBurnerAtaTx.feePayer = recoveryPubkey;
    createBurnerAtaTx.sign(recoveryKeypair);
    
    const createBurnerAtaSig = await regularConn.sendRawTransaction(createBurnerAtaTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    await regularConn.confirmTransaction(createBurnerAtaSig, 'confirmed');
    console.log(`[Light]   ✓ Burner ATA created: ${createBurnerAtaSig.slice(0, 16)}...`);
    console.log(`[Light]   Recovery Pool paid ~0.002 SOL rent`);
  }
  
  // ==========================================================================
  // STEP 2: Decompress to BURNER's ATA (burner now has regular USDC)
  // ==========================================================================
  console.log(`[Light]`);
  console.log(`[Light] Step 2: Decompressing to BURNER's ATA...`);
  console.log(`[Light]   Burner signs: Authorizes compressed token spend`);
  console.log(`[Light]   Recovery pays: Transaction fees`);
  console.log(`[Light]   Destination: Burner's own ATA (gets regular SPL USDC)`);
  
  const decompressSig = await lightDecompress(
    rpc,                           // RPC connection
    recoveryKeypair,               // RECOVERY POOL pays fees!
    mint,                          // Token mint
    Number(amount),                // Amount (converted from bigint)
    burnerKeypair,                 // Burner authorizes compressed token spend
    burnerAta,                     // Decompress to BURNER's ATA (not recipient!)
    undefined,                     // tokenPoolInfos (SDK fetches automatically)
    { commitment: 'confirmed' }    // Confirm options
  );
  
  console.log(`[Light]   ✓ Decompressed to burner: ${decompressSig.slice(0, 16)}...`);
  console.log(`[Light]   Burner now has ${Number(amount) / 10 ** USDC_DECIMALS} regular USDC`);
  
  // ==========================================================================
  // STEP 3: PayAI x402 GASLESS transfer from BURNER to RECIPIENT
  // PayAI pays the gas - burner only needs USDC!
  // ==========================================================================
  console.log(`[Light]`);
  console.log(`[Light] Step 3: PayAI x402 GASLESS transfer BURNER → RECIPIENT...`);
  console.log(`[Light]   PayAI will pay transaction gas!`);
  
  // Fetch PayAI fee payer address
  let payaiFeePayer: string | null = null;
  try {
    const supportedResponse = await fetch(`${PAYAI_FACILITATOR_URL}/supported`, {
      headers: { 'Accept': 'application/json' },
    });
    
    if (supportedResponse.ok) {
      const supportedData = await supportedResponse.json();
      
      // Look for Solana fee payer
      if (supportedData.kinds && Array.isArray(supportedData.kinds)) {
        for (const kind of supportedData.kinds) {
          if (kind.network === 'solana' || kind.network?.startsWith('solana:')) {
            if (kind.extra?.feePayer) {
              payaiFeePayer = kind.extra.feePayer;
              break;
            }
          }
        }
      }
      
      // Fallback to signers
      if (!payaiFeePayer && supportedData.signers?.['solana:*']?.[0]) {
        payaiFeePayer = supportedData.signers['solana:*'][0];
      }
    }
  } catch (err) {
    console.warn(`[Light]   ⚠ Could not fetch PayAI fee payer, will try direct submission`);
  }
  
  let transferSig: string;
  
  if (payaiFeePayer) {
    console.log(`[Light]   ✓ PayAI fee payer: ${payaiFeePayer.slice(0, 12)}... (THEY PAY GAS!)`);
    
    // Import for TransferChecked (required by x402)
    const { createTransferCheckedInstruction } = await import('@solana/spl-token');
    // ComputeBudgetProgram is already imported at the top of the file
    
    // Check if recipient ATA exists, create if needed (Recovery pays this)
    let recipientAtaExists = false;
    try {
      await getAccount(regularConn, recipientAta, 'confirmed');
      recipientAtaExists = true;
      console.log(`[Light]   ✓ Recipient ATA already exists`);
    } catch {
      console.log(`[Light]   Creating recipient ATA (Recovery Pool pays)...`);
      
      const createRecipientAtaTx = new Transaction();
      createRecipientAtaTx.add(
        createAssociatedTokenAccountInstruction(
          recoveryPubkey,      // RECOVERY POOL pays rent!
          recipientAta,        // ATA to create
          recipientAddress,    // Owner of the ATA (recipient)
          mint,                // Token mint
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      
      const { blockhash: bhAta } = await regularConn.getLatestBlockhash('confirmed');
      createRecipientAtaTx.recentBlockhash = bhAta;
      createRecipientAtaTx.feePayer = recoveryPubkey;
      createRecipientAtaTx.sign(recoveryKeypair);
      
      const createRecipientAtaSig = await regularConn.sendRawTransaction(createRecipientAtaTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      
      await regularConn.confirmTransaction(createRecipientAtaSig, 'confirmed');
      console.log(`[Light]   ✓ Recipient ATA created: ${createRecipientAtaSig.slice(0, 16)}...`);
    }
    
    // Build x402 transfer transaction with PayAI as fee payer
    const feePayerPubkey = new PublicKey(payaiFeePayer);
    
    const x402Tx = new Transaction();
    
    // x402 requires these compute budget instructions
    const { ComputeBudgetProgram: CBP } = await import('@solana/web3.js');
    x402Tx.add(CBP.setComputeUnitLimit({ units: 200000 }));
    x402Tx.add(CBP.setComputeUnitPrice({ microLamports: 10000 }));
    
    // Add TransferChecked instruction (required by x402)
    const { createTransferCheckedInstruction: createTCI } = await import('@solana/spl-token');
    x402Tx.add(
      createTCI(
        burnerAta,           // source
        mint,                // mint
        recipientAta,        // destination
        burnerPubkey,        // owner (burner signs)
        amount,              // amount
        USDC_DECIMALS,       // decimals
        [],                  // signers (burner will sign)
        TOKEN_PROGRAM_ID
      )
    );
    
    // Set PayAI as fee payer - they pay the gas!
    x402Tx.feePayer = feePayerPubkey;
    
    const { blockhash: bh2, lastValidBlockHeight } = await regularConn.getLatestBlockhash('confirmed');
    x402Tx.recentBlockhash = bh2;
    // SECURITY: Use tighter expiry to prevent delayed transaction submission attacks
    x402Tx.lastValidBlockHeight = calculateTightExpiry(lastValidBlockHeight - 150);
    
    // Burner signs (authorizes the transfer), but NOT as fee payer
    x402Tx.partialSign(burnerKeypair);
    
    console.log(`[Light]   ✓ x402 transaction built (3 instructions: ComputeLimit, ComputePrice, TransferChecked)`);
    console.log(`[Light]   Burner signed, submitting to PayAI...`);
    
    // Serialize for PayAI submission
    const serializedTx = x402Tx.serialize({
      requireAllSignatures: false,  // PayAI will add fee payer signature
      verifySignatures: false,
    });
    const base64Tx = serializedTx.toString('base64');
    
    // Create x402 PaymentPayload
    const paymentPayload = {
      x402Version: 1,
      scheme: 'exact',
      network: 'solana',
      payload: {
        transaction: base64Tx,
      },
    };
    
    // Create PaymentRequirements
    const paymentRequirements = {
      scheme: 'exact',
      network: 'solana',
      maxAmountRequired: amount.toString(),
      resource: `aegix-decompress-${Date.now().toString(36)}`,
      description: 'Aegix decompressed stealth payment',
      mimeType: 'application/json',
      outputSchema: {},
      payTo: recipientAddress.toBase58(),
      maxTimeoutSeconds: 300,
      asset: mint.toBase58(),
      extra: {
        feePayer: payaiFeePayer,
        compressed: true,
      },
    };
    
    console.log(`[Light]   📤 Submitting to PayAI facilitator...`);
    
    // Submit to PayAI's /settle endpoint
    const settleResponse = await fetch(`${PAYAI_FACILITATOR_URL}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentPayload, paymentRequirements }),
    });
    
    if (!settleResponse.ok) {
      const errorText = await settleResponse.text();
      console.error(`[Light]   ❌ PayAI settle failed: ${settleResponse.status}`);
      console.error(`[Light]   Response: ${errorText.slice(0, 200)}`);
      throw new Error(`PayAI x402 submission failed: ${settleResponse.status} - ${errorText.slice(0, 100)}`);
    }
    
    const settleResult = await settleResponse.json();
    
    if (settleResult.success && settleResult.transaction) {
      transferSig = settleResult.transaction;
      console.log(`[Light]   ✅ PayAI x402 payment successful!`);
      console.log(`[Light]   TX: ${transferSig.slice(0, 20)}...`);
      console.log(`[Light]   Gas paid by: PayAI (${payaiFeePayer.slice(0, 12)}...)`);
      console.log(`[Light]   Burner needed: USDC only, NO SOL for gas!`);
      
      // Wait for confirmation
      await regularConn.confirmTransaction(transferSig, 'confirmed');
    } else {
      const errorReason = settleResult.errorReason || settleResult.error || 'Unknown error';
      throw new Error(`PayAI x402 failed: ${errorReason}`);
    }
  } else {
    // Fallback: Recovery Pool pays gas if PayAI not available
    console.warn(`[Light]   ⚠ PayAI not available, Recovery Pool will pay gas`);
    
    // Check if recipient ATA exists, create if needed
    let recipientAtaExists = false;
    try {
      await getAccount(regularConn, recipientAta, 'confirmed');
      recipientAtaExists = true;
    } catch {
      // Will create below
    }
    
    const transferTx = new Transaction();
    
    if (!recipientAtaExists) {
      transferTx.add(
        createAssociatedTokenAccountInstruction(
          recoveryPubkey,
          recipientAta,
          recipientAddress,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }
    
    transferTx.add(
      createTransferInstruction(
        burnerAta,
        recipientAta,
        burnerPubkey,
        amount,
        [],
        TOKEN_PROGRAM_ID
      )
    );
    
    const { blockhash: bh2 } = await regularConn.getLatestBlockhash('confirmed');
    transferTx.recentBlockhash = bh2;
    transferTx.feePayer = recoveryPubkey;
    
    transferTx.sign(recoveryKeypair, burnerKeypair);
    
    transferSig = await regularConn.sendRawTransaction(transferTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    await regularConn.confirmTransaction(transferSig, 'confirmed');
    console.log(`[Light]   ✓ Transfer complete (Recovery Pool paid gas): ${transferSig.slice(0, 16)}...`);
  }
  
  console.log(`[Light]   Recipient received ${Number(amount) / 10 ** USDC_DECIMALS} USDC`);
  
  // ==========================================================================
  // STEP 4: Close BURNER's ATA and recover rent to Recovery Pool
  // ==========================================================================
  console.log(`[Light]`);
  console.log(`[Light] Step 4: Closing BURNER's ATA (recovering rent)...`);
  
  let rentRecovered = 0;
  try {
    // Verify burner ATA state before closing
    const burnerAccount = await getAccount(regularConn, burnerAta, 'confirmed');
    
    // SECURITY: Dust Sweep - handle any remaining tokens before close
    // This prevents "Dust Attack" where attacker sends micro-amounts to block ATA closure
    if (burnerAccount.amount > 0n) {
      console.log(`[Light]   ⚠ Dust detected: ${burnerAccount.amount} tokens - sweeping to Recovery Pool...`);
      
      // Get/create Recovery Pool's USDC ATA to receive swept dust
      const recoveryUsdcAta = await getAssociatedTokenAddress(mint, recoveryPubkey);
      
      let recoveryAtaExists = false;
      try {
        await getAccount(regularConn, recoveryUsdcAta, 'confirmed');
        recoveryAtaExists = true;
      } catch {
        // Will create below
      }
      
      const sweepTx = new Transaction();
      
      // Create Recovery Pool's USDC ATA if it doesn't exist
      if (!recoveryAtaExists) {
        sweepTx.add(
          createAssociatedTokenAccountInstruction(
            recoveryPubkey,      // Payer
            recoveryUsdcAta,     // ATA to create
            recoveryPubkey,      // Owner
            mint,                // Mint
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
        console.log(`[Light]   Creating Recovery Pool USDC ATA for dust collection`);
      }
      
      // Transfer all remaining tokens to Recovery Pool
      sweepTx.add(
        createTransferInstruction(
          burnerAta,           // Source
          recoveryUsdcAta,     // Destination (Recovery Pool's ATA)
          burnerPubkey,        // Owner (burner)
          burnerAccount.amount, // Transfer ALL remaining tokens
          [],                  // No multi-signers
          TOKEN_PROGRAM_ID
        )
      );
      
      const { blockhash: bhSweep } = await regularConn.getLatestBlockhash('confirmed');
      sweepTx.recentBlockhash = bhSweep;
      sweepTx.feePayer = recoveryPubkey;
      sweepTx.sign(recoveryKeypair, burnerKeypair);
      
      const sweepSig = await regularConn.sendRawTransaction(sweepTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      
      await regularConn.confirmTransaction(sweepSig, 'confirmed');
      console.log(`[Light]   ✓ Dust swept: ${sweepSig.slice(0, 16)}...`);
    }
    
    // NOW close the empty ATA
    const closeTx = new Transaction();
    
    // Import closeAccount instruction
    const { createCloseAccountInstruction } = await import('@solana/spl-token');
    
    closeTx.add(
      createCloseAccountInstruction(
        burnerAta,         // ATA to close
        recoveryPubkey,    // Destination for rent (Recovery Pool!)
        burnerPubkey,      // Authority (burner owns the ATA)
        [],                // Multi-signers (none)
        TOKEN_PROGRAM_ID
      )
    );
    
    const { blockhash: bh3 } = await regularConn.getLatestBlockhash('confirmed');
    closeTx.recentBlockhash = bh3;
    closeTx.feePayer = recoveryPubkey;
    
    // Sign with both Recovery Pool and Burner
    closeTx.sign(recoveryKeypair, burnerKeypair);
    
    const closeSig = await regularConn.sendRawTransaction(closeTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    await regularConn.confirmTransaction(closeSig, 'confirmed');
    
    rentRecovered = 0.00203928; // Approximate ATA rent
    console.log(`[Light]   ✓ Burner ATA closed: ${closeSig.slice(0, 16)}...`);
    console.log(`[Light]   ✓ Recovered ~${rentRecovered} SOL rent to Recovery Pool`);
    
  } catch (closeError: any) {
    console.warn(`[Light]   ⚠ Failed to close burner ATA: ${closeError.message}`);
    // Non-fatal - the payment succeeded, just couldn't recover rent
  }
  
  console.log(`[Light]`);
  console.log(`[Light] ═══════════════════════════════════════════════════════════`);
  console.log(`[Light] ✓ 3-STEP FLOW COMPLETE!`);
  console.log(`[Light]   Decompress TX: ${decompressSig.slice(0, 20)}...`);
  console.log(`[Light]   x402 Transfer TX: ${transferSig.slice(0, 20)}...`);
  console.log(`[Light]   Amount: ${Number(amount) / 10 ** USDC_DECIMALS} USDC`);
  console.log(`[Light]   Recipient: ${recipientAddress.toBase58().slice(0, 12)}...`);
  if (payaiFeePayer) {
    console.log(`[Light]   Gas paid by: PayAI (${payaiFeePayer.slice(0, 12)}...)`);
  }
  if (rentRecovered > 0) {
    console.log(`[Light]   Rent Recovered: ${rentRecovered} SOL`);
  }
  console.log(`[Light]`);
  console.log(`[Light]   Privacy preserved:`);
  console.log(`[Light]   - Stealth Pool NOT in any transaction`);
  console.log(`[Light]   - Decompress happened inside burner wallet`);
  console.log(`[Light]   - PayAI x402 paid gas for final transfer`);
  console.log(`[Light]   - Burner ATA closed, rent recovered`);
  console.log(`[Light] ═══════════════════════════════════════════════════════════`);
  
  return {
    decompressTx: decompressSig,
    transferTx: transferSig,
    recipientAta: recipientAta.toBase58(),
    rentRecovered,
    payaiFeePayer: payaiFeePayer || undefined,
  };
  
  } finally {
    // SECURITY: Always release the liquidity reservation
    releaseReservation(txId);
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the default merkle tree for compression
 */
async function getDefaultMerkleTree(): Promise<string> {
  // Light Protocol's shared state trees for mainnet
  const SHARED_MERKLE_TREE = 'noopb9bkMVfRPU8AsBHBNRs9nnSb94Y97B96k4cdVUd';
  return SHARED_MERKLE_TREE;
}

/**
 * Generate a deterministic proof hash for tracking
 */
function generateProofHash(...inputs: string[]): string {
  // crypto is imported at the top of the file (ESM)
  return crypto
    .createHash('sha256')
    .update(inputs.join(':'))
    .digest('hex')
    .slice(0, 32);
}

/**
 * Get cost estimate for compressed vs regular operations
 */
export function getCostEstimate(): {
  regularAccountRent: number;
  compressedAccountCost: number;
  savingsMultiplier: number;
} {
  const regularAccountRent = 0.00203928;
  const compressedAccountCost = 0.00004;
  const savingsMultiplier = regularAccountRent / compressedAccountCost;
  
  return {
    regularAccountRent,
    compressedAccountCost,
    savingsMultiplier: Math.round(savingsMultiplier),
  };
}

// NOTE: Connection is initialized lazily on first use
// This ensures environment variables are loaded first in index.ts

export default {
  initLightConnection,
  getLightConnection,
  getRegularConnection,
  isCompressionSupported,
  checkLightHealth,
  forceHealthCheck,
  createCompressedPool,
  createCompressedBurner,
  getCompressedBalance,
  buildCompressedTransfer,
  executeCompressedTransfer,
  compressTokens,
  decompressTokens,
  executeRegularSplTransfer,
  decompressAndTransfer,
  getCostEstimate,
};
