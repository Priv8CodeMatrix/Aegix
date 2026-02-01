/**
 * Shadow Links / Ghost Invoice Routes
 * 
 * Creates temporary payment invoices where payer pays to a stealth burn wallet
 * which self-destructs after sweeping funds to the owner's pool wallet.
 * 
 * Privacy Flow:
 * 1. Owner creates Shadow Link with amount
 * 2. Payer visits link, sees clean payment UI
 * 3. Payer sends USDC to ephemeral stealth address
 * 4. Auto-sweep moves funds to owner's pool
 * 5. Link self-destructs → Privacy preserved!
 */

import { Router, Request, Response } from 'express';
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
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  createCloseAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import crypto from 'crypto';
import { getIncoClient } from '../inco/lightning-client.js';

// Light Protocol imports (Aegix 4.0 - Default for Ghost Invoices)
import {
  initLightConnection,
  createCompressedPool,
  createCompressedBurner,
  executeCompressedTransfer,
  getCompressedBalance,
  checkLightHealth,
  getCostEstimate,
  getRegularConnection,
} from '../light/client.js';

const router = Router();

// USDC Mainnet mint
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Solana connection
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

// =============================================================================
// TYPES
// =============================================================================

interface ShadowLink {
  id: string;
  alias: string;                 // "ghost-wolf-42" style alias
  stealthAddress: string;        // Ephemeral payment address
  encryptedSecretKey: string;    // For auto-sweep (encrypted)
  encryptionSalt: string;        // Salt for decryption
  ownerPool: string;             // Owner's pool wallet (sweep destination)
  owner: string;                 // Owner wallet address
  amount: string;                // Amount in USDC
  memo?: string;                 // Optional memo (encrypted)
  ttl: number;                   // Expires at timestamp
  createdAt: number;
  status: 'waiting' | 'paid' | 'swept' | 'expired' | 'cancelled';
  paymentTx?: string;            // Payer's transaction
  sweepTx?: string;              // Sweep to pool transaction
  paidAt?: number;
  sweptAt?: number;
  paidFrom?: string;             // Payer's address (for owner's record only)
  
  // Light Protocol fields (Aegix 4.0 - Default)
  mode: 'light' | 'legacy';      // Payment mode
  lightEnabled?: boolean;        // Whether Light is available
  compressedBurner?: string;     // Compressed burner address (Light mode)
  proofHash?: string;            // ZK proof hash (Light mode)
  costSavings?: string;          // Estimated savings vs legacy
}

// In-memory storage (use Redis/DB in production)
const shadowLinks = new Map<string, ShadowLink>();
const aliasIndex = new Map<string, string>(); // alias -> linkId

// =============================================================================
// ENCRYPTION HELPERS
// =============================================================================

function encryptPrivateKey(secretKey: Uint8Array, owner: string, signature: string): { encrypted: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.createHash('sha256')
    .update(owner + signature + salt)
    .digest();
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', derivedKey, iv);
  
  let encrypted = cipher.update(Buffer.from(secretKey));
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  return {
    encrypted: Buffer.concat([iv, encrypted]).toString('base64'),
    salt,
  };
}

function decryptPrivateKey(encryptedKey: string, owner: string, signature: string, salt: string): Uint8Array {
  const derivedKey = crypto.createHash('sha256')
    .update(owner + signature + salt)
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
// ALIAS GENERATION
// =============================================================================

const adjectives = [
  'ghost', 'shadow', 'stealth', 'phantom', 'silent', 'dark', 'neon', 
  'cyber', 'void', 'black', 'hidden', 'masked', 'secret', 'cryptic'
];

const nouns = [
  'ninja', 'wolf', 'hawk', 'cobra', 'tiger', 'dragon', 'raven', 
  'falcon', 'viper', 'panther', 'sphinx', 'oracle', 'cipher', 'shade'
];

function generateAlias(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}-${noun}-${num}`;
}

function generateUniqueAlias(): string {
  let alias = generateAlias();
  let attempts = 0;
  while (aliasIndex.has(alias) && attempts < 100) {
    alias = generateAlias();
    attempts++;
  }
  return alias;
}

// =============================================================================
// ROUTES
// =============================================================================

/**
 * POST /api/shadow-link/create
 * Create a new shadow link / invoice
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { owner, poolAddress, amount, ttlMinutes = 60, memo, signature, mode: requestedMode } = req.body;
    
    if (!owner || !poolAddress || !amount || !signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: owner, poolAddress, amount, signature',
        timestamp: Date.now(),
      });
    }
    
    console.log(`[Shadow Link] 🔗 Creating invoice for ${owner.slice(0, 8)}...`);
    console.log(`[Shadow Link]    Amount: ${amount} USDC`);
    console.log(`[Shadow Link]    TTL: ${ttlMinutes} minutes`);
    
    // ═══════════════════════════════════════════════════════════════════════
    // CHECK LIGHT PROTOCOL AVAILABILITY (Default mode)
    // ═══════════════════════════════════════════════════════════════════════
    let useLightMode = requestedMode !== 'legacy';
    let lightHealth = { healthy: false, slot: 0 };
    let costEstimate = getCostEstimate();
    let compressedBurnerAddress: string | undefined;
    let proofHash: string | undefined;
    
    if (useLightMode) {
      try {
        lightHealth = await checkLightHealth();
        useLightMode = lightHealth.healthy;
        if (lightHealth.healthy) {
          console.log(`[Shadow Link] 🌟 Light Protocol enabled (slot: ${lightHealth.slot})`);
        } else {
          console.log(`[Shadow Link] ⚠️ Light unavailable, using legacy mode`);
        }
      } catch (err) {
        console.log(`[Shadow Link] Light check failed, using legacy mode`);
        useLightMode = false;
      }
    }
    
    // Generate ephemeral keypair for this invoice
    const keypair = Keypair.generate();
    const linkId = crypto.randomBytes(8).toString('hex');
    const alias = generateUniqueAlias();
    
    // If Light mode, prepare compressed burner
    if (useLightMode) {
      try {
        const burnerResult = await createCompressedBurner(
          new PublicKey(poolAddress),
          keypair
        );
        compressedBurnerAddress = burnerResult.burnerAddress;
        proofHash = burnerResult.proofHash;
        console.log(`[Shadow Link] ✓ Compressed burner ready: ${compressedBurnerAddress.slice(0, 12)}...`);
      } catch (err: any) {
        console.warn(`[Shadow Link] Compressed burner failed, falling back to legacy:`, err.message);
        useLightMode = false;
      }
    }
    
    // Encrypt private key
    const { encrypted, salt } = encryptPrivateKey(keypair.secretKey, owner, signature);
    
    // Encrypt memo with Inco if provided
    let encryptedMemo = memo;
    if (memo) {
      try {
        const inco = getIncoClient();
        // Simple encryption of memo
        const memoHash = crypto.createHash('sha256').update(memo).digest();
        const memoValue = BigInt('0x' + memoHash.subarray(0, 8).toString('hex'));
        const encrypted = await inco.encrypt(memoValue, 'uint64');
        encryptedMemo = encrypted.handle;
      } catch (err) {
        console.log('[Shadow Link] Note: FHE memo encryption skipped');
      }
    }
    
    // Calculate cost savings for display
    const savingsVsLegacy = useLightMode 
      ? `${(costEstimate.regularAccountRent - costEstimate.compressedAccountCost).toFixed(6)} SOL`
      : '0 SOL';
    
    const link: ShadowLink = {
      id: linkId,
      alias,
      stealthAddress: keypair.publicKey.toBase58(),
      encryptedSecretKey: encrypted,
      encryptionSalt: salt,
      ownerPool: poolAddress,
      owner,
      amount,
      memo: encryptedMemo,
      ttl: Date.now() + (ttlMinutes * 60 * 1000),
      createdAt: Date.now(),
      status: 'waiting',
      // Light Protocol fields
      mode: useLightMode ? 'light' : 'legacy',
      lightEnabled: useLightMode,
      compressedBurner: compressedBurnerAddress,
      proofHash,
      costSavings: savingsVsLegacy,
    };
    
    shadowLinks.set(linkId, link);
    aliasIndex.set(alias, linkId);
    
    // Auto-expire after TTL
    setTimeout(() => {
      const existingLink = shadowLinks.get(linkId);
      if (existingLink && existingLink.status === 'waiting') {
        existingLink.status = 'expired';
        console.log(`[Shadow Link] ⏰ Link expired: ${linkId}`);
      }
    }, ttlMinutes * 60 * 1000);
    
    // Generate URLs
    const baseUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
    
    console.log(`[Shadow Link] ✓ Invoice created: ${alias} (${useLightMode ? 'Light' : 'Legacy'} mode)`);
    console.log(`[Shadow Link]    Stealth: ${keypair.publicKey.toBase58().slice(0, 12)}...`);
    if (useLightMode) {
      console.log(`[Shadow Link]    Compressed Burner: ${compressedBurnerAddress?.slice(0, 12)}...`);
      console.log(`[Shadow Link]    Est. savings: ${savingsVsLegacy}`);
    }
    
    res.json({
      success: true,
      data: {
        linkId,
        alias,
        paymentUrl: `${baseUrl}/pay/${linkId}`,
        aliasUrl: `${baseUrl}/p/${alias}`,
        stealthAddress: link.stealthAddress,
        amount: link.amount,
        expiresAt: link.ttl,
        expiresIn: ttlMinutes * 60, // seconds
        qrData: `${baseUrl}/pay/${linkId}`,
        // Light Protocol info
        light: {
          enabled: useLightMode,
          mode: link.mode,
          compressedBurner: compressedBurnerAddress,
          proofHash,
          costSavings: savingsVsLegacy,
          multiplier: costEstimate.savingsMultiplier,
          benefits: useLightMode ? [
            'ZK Compression: ~50x cheaper than legacy',
            'Maximum privacy: Compressed burner hides sender',
            'Fast settlement with validity proofs',
          ] : undefined,
          warning: !useLightMode ? 'Legacy mode: Higher costs. Light Protocol recommended.' : undefined,
        },
      },
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error('[Shadow Link] Create error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create shadow link',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/shadow-link/owner/:owner
 * List all shadow links for an owner
 * NOTE: This route MUST be before /:id to avoid Express matching "owner" as an ID
 */
router.get('/owner/:owner', (req: Request, res: Response) => {
  try {
    const { owner } = req.params;
    
    const ownerLinks: ShadowLink[] = [];
    shadowLinks.forEach(link => {
      if (link.owner === owner) {
        ownerLinks.push(link);
      }
    });
    
    // Sort by creation time (newest first)
    ownerLinks.sort((a, b) => b.createdAt - a.createdAt);
    
    // Calculate stats
    const stats = {
      total: ownerLinks.length,
      waiting: ownerLinks.filter(l => l.status === 'waiting').length,
      paid: ownerLinks.filter(l => l.status === 'paid').length,
      swept: ownerLinks.filter(l => l.status === 'swept').length,
      expired: ownerLinks.filter(l => l.status === 'expired').length,
    };
    
    res.json({
      success: true,
      data: {
        links: ownerLinks.map(link => ({
          id: link.id,
          alias: link.alias,
          stealthAddress: link.stealthAddress,
          amount: link.amount,
          status: link.status,
          createdAt: link.createdAt,
          expiresAt: link.ttl,
          paidAt: link.paidAt,
          sweptAt: link.sweptAt,
          paymentTx: link.paymentTx,
          sweepTx: link.sweepTx,
          // Include paidFrom only for owner (shows who paid)
          paidFrom: link.paidFrom,
        })),
        stats,
      },
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error('[Shadow Link] List error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list links',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/shadow-link/:id/confirm
 * Called after payer sends transaction - marks link as paid
 */
router.post('/:id/confirm', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { txSignature, payerAddress } = req.body;
    
    if (!txSignature) {
      return res.status(400).json({
        success: false,
        error: 'Transaction signature required',
        timestamp: Date.now(),
      });
    }
    
    let link = shadowLinks.get(id);
    if (!link) {
      const linkId = aliasIndex.get(id);
      if (linkId) link = shadowLinks.get(linkId);
    }
    
    if (!link) {
      return res.status(404).json({
        success: false,
        error: 'Link not found',
        timestamp: Date.now(),
      });
    }
    
    if (link.status !== 'waiting') {
      return res.status(400).json({
        success: false,
        error: `Cannot confirm payment - link is ${link.status}`,
        timestamp: Date.now(),
      });
    }
    
    // Mark as paid
    link.status = 'paid';
    link.paymentTx = txSignature;
    link.paidAt = Date.now();
    link.paidFrom = payerAddress;
    
    console.log(`[Shadow Link] 💰 Payment confirmed: ${link.alias}`);
    console.log(`[Shadow Link]    TX: ${txSignature.slice(0, 20)}...`);
    
    res.json({
      success: true,
      message: 'Payment confirmed! Funds will be swept to recipient.',
      data: {
        linkId: link.id,
        alias: link.alias,
        status: 'paid',
        txSignature,
      },
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error('[Shadow Link] Confirm error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm payment',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/shadow-link/:id/sweep
 * Sweep funds from stealth address to owner's pool
 * Can be called manually or automatically after payment confirmation
 */
router.post('/:id/sweep', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { owner, signature } = req.body;
    
    if (!owner || !signature) {
      return res.status(400).json({
        success: false,
        error: 'Owner and signature required for sweep',
        timestamp: Date.now(),
      });
    }
    
    const link = shadowLinks.get(id);
    
    if (!link) {
      return res.status(404).json({
        success: false,
        error: 'Link not found',
        timestamp: Date.now(),
      });
    }
    
    if (link.owner !== owner) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
        timestamp: Date.now(),
      });
    }
    
    if (link.status !== 'paid') {
      return res.status(400).json({
        success: false,
        error: `Cannot sweep - link status is ${link.status}`,
        timestamp: Date.now(),
      });
    }
    
    console.log(`[Shadow Link] 🧹 Sweeping funds to pool: ${link.alias}`);
    
    // Decrypt stealth keypair
    const secretKey = decryptPrivateKey(
      link.encryptedSecretKey,
      link.owner,
      signature,
      link.encryptionSalt
    );
    const stealthKeypair = Keypair.fromSecretKey(secretKey);
    
    const stealthPubkey = stealthKeypair.publicKey;
    const poolPubkey = new PublicKey(link.ownerPool);
    
    // Get stealth USDC account
    const stealthUsdcAccount = await getAssociatedTokenAddress(
      USDC_MINT, stealthPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    // Get pool USDC account
    const poolUsdcAccount = await getAssociatedTokenAddress(
      USDC_MINT, poolPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    // Check stealth USDC balance
    let usdcBalance: bigint;
    try {
      const accountInfo = await getAccount(connection, stealthUsdcAccount, 'confirmed', TOKEN_PROGRAM_ID);
      usdcBalance = accountInfo.amount;
    } catch {
      return res.status(400).json({
        success: false,
        error: 'No USDC found in stealth address',
        timestamp: Date.now(),
      });
    }
    
    if (usdcBalance === BigInt(0)) {
      return res.status(400).json({
        success: false,
        error: 'Stealth address has 0 USDC',
        timestamp: Date.now(),
      });
    }
    
    console.log(`[Shadow Link]    Found ${Number(usdcBalance) / 1_000_000} USDC`);
    
    // Build sweep transaction
    const transaction = new Transaction();
    
    // Check if pool USDC account exists
    try {
      await getAccount(connection, poolUsdcAccount, 'confirmed', TOKEN_PROGRAM_ID);
    } catch {
      // Create pool ATA if needed
      transaction.add(
        createAssociatedTokenAccountInstruction(
          stealthPubkey, poolUsdcAccount, poolPubkey, USDC_MINT,
          TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }
    
    // Transfer USDC to pool
    transaction.add(
      createTransferInstruction(
        stealthUsdcAccount, poolUsdcAccount, stealthPubkey, usdcBalance,
        [], TOKEN_PROGRAM_ID
      )
    );
    
    // Close stealth USDC account (reclaim rent)
    transaction.add(
      createCloseAccountInstruction(
        stealthUsdcAccount, stealthPubkey, stealthPubkey,
        [], TOKEN_PROGRAM_ID
      )
    );
    
    // Transfer remaining SOL to pool (self-destruct!)
    const solBalance = await connection.getBalance(stealthPubkey, 'confirmed');
    const txFee = 10000; // Reserve for this tx
    const solToSweep = solBalance - txFee;
    
    if (solToSweep > 0) {
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: stealthPubkey,
          toPubkey: poolPubkey,
          lamports: solToSweep,
        })
      );
    }
    
    // Sign and send
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = stealthPubkey;
    transaction.sign(stealthKeypair);
    
    const sweepTx = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    await connection.confirmTransaction({
      signature: sweepTx,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');
    
    // Update link status
    link.status = 'swept';
    link.sweepTx = sweepTx;
    link.sweptAt = Date.now();
    
    console.log(`[Shadow Link] ✅ Swept to pool: ${sweepTx.slice(0, 20)}...`);
    console.log(`[Shadow Link]    Stealth address destroyed! 🔥`);
    
    res.json({
      success: true,
      data: {
        linkId: link.id,
        alias: link.alias,
        status: 'swept',
        sweepTx,
        usdcSwept: (Number(usdcBalance) / 1_000_000).toFixed(6),
        solSwept: (solToSweep / LAMPORTS_PER_SOL).toFixed(6),
        solscanUrl: `https://solscan.io/tx/${sweepTx}`,
      },
      message: 'Funds swept to pool! Stealth address destroyed.',
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error('[Shadow Link] Sweep error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to sweep funds',
      timestamp: Date.now(),
    });
  }
});

/**
 * DELETE /api/shadow-link/:id
 * Cancel/destroy a shadow link
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { owner } = req.body;
    
    if (!owner) {
      return res.status(400).json({
        success: false,
        error: 'Owner required',
        timestamp: Date.now(),
      });
    }
    
    const link = shadowLinks.get(id);
    
    if (!link) {
      return res.status(404).json({
        success: false,
        error: 'Link not found',
        timestamp: Date.now(),
      });
    }
    
    if (link.owner !== owner) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
        timestamp: Date.now(),
      });
    }
    
    if (link.status === 'paid' || link.status === 'swept') {
      return res.status(400).json({
        success: false,
        error: 'Cannot cancel - link has been paid',
        timestamp: Date.now(),
      });
    }
    
    // Mark as cancelled
    link.status = 'cancelled';
    aliasIndex.delete(link.alias);
    
    console.log(`[Shadow Link] 🗑️ Link cancelled: ${link.alias}`);
    
    res.json({
      success: true,
      message: 'Shadow link cancelled',
      data: { linkId: id, alias: link.alias },
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error('[Shadow Link] Delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel link',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/shadow-link/:id/balance
 * Check balance of stealth address (for polling)
 */
router.get('/:id/balance', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    let link = shadowLinks.get(id);
    if (!link) {
      const linkId = aliasIndex.get(id);
      if (linkId) link = shadowLinks.get(linkId);
    }
    
    if (!link) {
      return res.status(404).json({
        success: false,
        error: 'Link not found',
        timestamp: Date.now(),
      });
    }
    
    const stealthPubkey = new PublicKey(link.stealthAddress);
    
    // Get SOL balance
    const solBalance = await connection.getBalance(stealthPubkey, 'confirmed');
    
    // Get USDC balance
    let usdcBalance = 0;
    try {
      const stealthUsdcAccount = await getAssociatedTokenAddress(
        USDC_MINT, stealthPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const accountInfo = await getAccount(connection, stealthUsdcAccount, 'confirmed', TOKEN_PROGRAM_ID);
      usdcBalance = Number(accountInfo.amount) / 1_000_000;
    } catch {
      // No USDC account yet
    }
    
    const expectedUsdc = parseFloat(link.amount);
    const isPaid = usdcBalance >= expectedUsdc;
    
    // Auto-update status if paid
    if (isPaid && link.status === 'waiting') {
      link.status = 'paid';
      link.paidAt = Date.now();
      console.log(`[Shadow Link] 💰 Payment detected via balance check: ${link.alias}`);
    }
    
    res.json({
      success: true,
      data: {
        sol: solBalance / LAMPORTS_PER_SOL,
        usdc: usdcBalance,
        expectedUsdc,
        isPaid,
        status: link.status,
      },
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error('[Shadow Link] Balance check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check balance',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/shadow-link/:id
 * Get link info for payer (minimal info, no owner details!)
 * NOTE: This generic route MUST be LAST to avoid matching other routes
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Try by ID first, then by alias
    let link = shadowLinks.get(id);
    if (!link) {
      const linkId = aliasIndex.get(id);
      if (linkId) link = shadowLinks.get(linkId);
    }
    
    if (!link) {
      return res.status(404).json({
        success: false,
        error: 'Payment link not found',
        timestamp: Date.now(),
      });
    }
    
    // Check if already used
    if (link.status === 'paid' || link.status === 'swept') {
      return res.status(410).json({
        success: false,
        error: 'Link already used - Privacy Protected',
        message: 'This payment link has been used and destroyed to protect privacy.',
        status: 'used',
        timestamp: Date.now(),
      });
    }
    
    // Check if expired
    if (link.status === 'expired' || Date.now() > link.ttl) {
      link.status = 'expired';
      return res.status(410).json({
        success: false,
        error: 'Payment link expired',
        status: 'expired',
        timestamp: Date.now(),
      });
    }
    
    // Check if cancelled
    if (link.status === 'cancelled') {
      return res.status(410).json({
        success: false,
        error: 'Payment link cancelled',
        status: 'cancelled',
        timestamp: Date.now(),
      });
    }
    
    // Return ONLY what payer needs - NO owner info!
    res.json({
      success: true,
      data: {
        stealthAddress: link.stealthAddress,
        amount: link.amount,
        expiresIn: Math.max(0, Math.floor((link.ttl - Date.now()) / 1000)),
        status: link.status,
        alias: link.alias,
      },
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error('[Shadow Link] Get error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get link info',
      timestamp: Date.now(),
    });
  }
});

export default router;

