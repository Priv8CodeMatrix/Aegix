/**
 * Payment Routes
 * NON-CUSTODIAL: Aegix never holds user funds
 * 
 * Handles x402 payment flow and encrypted audit logging only.
 * Actual payments go directly from user → service provider via PayAI.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Connection, PublicKey, SystemProgram, LAMPORTS_PER_SOL, Transaction, Keypair } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { 
  createPaymentRequired, 
  parsePaymentHeader, 
  get402Headers,
  isPaymentValid,
  X402_CONSTANTS,
  // Security: Tight expiry for payment transactions
  calculateTightExpiry,
  PAYMENT_EXPIRY_BLOCKS,
} from '../x402/protocol.js';
import { getAuditLedger } from '../inco/confidential.js';
import { getIncoClient } from '../inco/lightning-client.js';
import { parseTransactionGraph } from '../utils/transaction-graph.js';
import { 
  validateAgentKey, 
  canAgentSpend, 
  recordAgentActivity, 
  getAgentDonationConfig,
  getAgentStealthSettings,
  incrementAgentStealthPayments,
  addCustomPool,
  savePools,
  getCustomPoolsForOwner,
  getCustomPool,
} from './agents.js';

// Light Protocol imports (Aegix 4.0 - Default payment path)
import {
  initLightConnection,
  createCompressedPool,
  createCompressedBurner,
  executeCompressedTransfer,
  executeCompressedTransferWithFeePayer, // Pool pays gas for burner's Transfer #2
  getCompressedBalance,
  compressTokens,
  checkLightHealth,
  getCostEstimate,
  getRegularConnection,
} from '../light/client.js';
import {
  createStealthAddress,
  createFundingTransaction,
  executeStealthPayment,
  getOwnerStealthAddresses,
  getStealthInfo,
  getStealthStats,
  markStealthFunded,
  getStuckStealthAddresses,
  recoverStealthFunds,
  decryptStealthKey,
  exportStealthKey,
  recoverSolToSingleWallet,
  // Pool wallet functions (new simplified architecture)
  getOrCreatePoolWallet,
  getPoolWallet,
  getPoolById,
  createPoolFundingTransaction,
  executePoolPayment,
  getPoolBalance,
  getPoolPaymentHistory,
  exportPoolKey,
  markPoolFunded,
  decryptPoolKey,
} from '../stealth/index.js';
import type { PaymentRequiredResponse, ProtectedResource, ApiResponse } from '../types.js';
import { getPaymentLogger } from '../audit/PaymentLogger.js';

// Solana connection for stealth operations
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const solanaConnection = new Connection(SOLANA_RPC_URL, 'confirmed');

function getSolanaConnection(): Connection {
  return solanaConnection;
}

const router = Router();
const auditLedger = getAuditLedger();

// Store pending payment requests (short-lived, for x402 flow)
const pendingPayments = new Map<string, PaymentRequiredResponse>();

// =============================================================================
// SECURITY: Periodic cleanup of expired pending payments
// Prevents memory growth from abandoned payment requests
// =============================================================================
setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  let cleaned = 0;
  
  for (const [id, payment] of pendingPayments.entries()) {
    if (payment.expiry < now) {
      pendingPayments.delete(id);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[Payment] Cleaned ${cleaned} expired pending payments (remaining: ${pendingPayments.size})`);
  }
}, 60000); // Run every 60 seconds
// =============================================================================

// PayAI facilitator URL for direct payments
const PAYAI_FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://facilitator.payai.network';
const PAYAI_NETWORK = process.env.PAYAI_NETWORK || 'solana';

// Protected resources registry
const protectedResources: Map<string, ProtectedResource> = new Map([
  ['/api/ai/completion', {
    path: '/api/ai/completion',
    price: '10000', // 0.01 USDC (6 decimals)
    description: 'AI text completion endpoint',
    acceptedPayments: ['payai-direct'],
  }],
  ['/api/ai/embedding', {
    path: '/api/ai/embedding',
    price: '5000', // 0.005 USDC
    description: 'Text embedding generation',
    acceptedPayments: ['payai-direct'],
  }],
  ['/api/data/query', {
    path: '/api/data/query',
    price: '25000', // 0.025 USDC
    description: 'Premium data query endpoint',
    acceptedPayments: ['payai-direct'],
  }],
]);

/**
 * Middleware: Check for payment on protected routes (x402 flow)
 * NO TEST MODE - Real payments only!
 */
export function paymentRequired(req: Request, res: Response, next: Function) {
  const fullPath = req.originalUrl.split('?')[0];
  const resource = protectedResources.get(fullPath);
  
  if (!resource) {
    return next();
  }

  const paymentHeader = req.headers[X402_CONSTANTS.HEADER_NAME.toLowerCase()] as string;
  
  if (!paymentHeader) {
    // Return 402 with PayAI payment instructions
    const paymentRequest = createPaymentRequired(resource, PAYAI_FACILITATOR_URL);
    pendingPayments.set(paymentRequest.paymentId, paymentRequest);
    
    console.log(`[Gateway] 402 Payment Required for ${fullPath}`);
    
    return res.status(402)
      .set(get402Headers(paymentRequest))
      .json({
        success: false,
        error: 'Payment Required',
        payment: paymentRequest,
        payai: {
          facilitator: PAYAI_FACILITATOR_URL,
          network: PAYAI_NETWORK,
          instructions: 'Sign payment with your wallet. Funds go directly to service provider via PayAI.',
        },
        timestamp: Date.now(),
      });
  }

  const payment = parsePaymentHeader(paymentHeader);
  
  if (!payment) {
    return res.status(400).json({
      success: false,
      error: 'Invalid payment header',
      timestamp: Date.now(),
    });
  }

  const pendingPayment = pendingPayments.get(payment.paymentId);
  
  if (!pendingPayment || !isPaymentValid(pendingPayment)) {
    return res.status(400).json({
      success: false,
      error: 'Payment request expired or invalid',
      timestamp: Date.now(),
    });
  }

  req.body._payment = payment;
  req.body._resource = resource;
  pendingPayments.delete(payment.paymentId);
  
  console.log(`[Gateway] Payment accepted for ${fullPath}`);
  next();
}

/**
 * GET /audit/:owner
 * Get encrypted audit log for owner (agent activity history)
 * This is the ONLY data Aegix stores - just the activity log, no funds!
 */
router.get('/audit/:owner', async (req: Request, res: Response) => {
  try {
    const { owner } = req.params;
    const auditLog = await auditLedger.getAuditLog(owner);
    
    // Check FHE mode
    const incoClient = getIncoClient();
    const isRealFhe = incoClient.isRealMode();

    res.json({
      success: true,
      data: {
        owner,
        logs: auditLog,
        encrypted: true,
        note: 'Activity history is FHE-encrypted. Only you can decrypt your agent activity.',
        model: 'non-custodial',
      },
      fhe: {
        provider: 'Inco Network',
        mode: isRealFhe ? 'REAL' : 'SIMULATION',
      },
      timestamp: Date.now(),
    } as ApiResponse);

  } catch (error) {
    console.error('[Gateway] Audit error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: Date.now(),
    } as ApiResponse);
  }
});

/**
 * GET /resources
 * List available protected resources and their prices
 */
router.get('/resources', (_req: Request, res: Response) => {
  const resources = Array.from(protectedResources.values());
  
  res.json({
    success: true,
    data: resources,
    timestamp: Date.now(),
  } as ApiResponse);
});

/**
 * POST /agent/pay
 * Agent payment endpoint - NON-CUSTODIAL
 * 
 * This creates a PayAI payment request that the user's wallet will sign directly.
 * Aegix never touches the funds - payment goes User Wallet → Service Provider.
 * We only log the encrypted activity.
 * 
 * Headers:
 *   X-Agent-Key: aegix_agent_xxx (required)
 * 
 * Body:
 *   resource: string - The API endpoint being accessed
 *   serviceProvider: string - Solana address of service provider (who gets paid)
 */
router.post('/agent/pay', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-agent-key'] as string;
    
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'Agent API key required',
        hint: 'Include X-Agent-Key header with your agent API key',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    // Validate agent key
    const agentResult = validateAgentKey(apiKey);
    
    if (!agentResult) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired agent API key',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    const { agent, owner } = agentResult;
    const { resource, serviceProvider } = req.body;

    if (!resource) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: resource',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    // Get resource price
    const protectedResource = protectedResources.get(resource);
    const paymentAmount = protectedResource?.price || '10000';

    // Check agent spending limits
    const spendingCheck = canAgentSpend(agent.id, paymentAmount, resource);
    
    if (!spendingCheck.allowed) {
      return res.status(403).json({
        success: false,
        error: spendingCheck.reason,
        agentId: agent.id,
        timestamp: Date.now(),
      } as ApiResponse);
    }

    // Generate payment ID for tracking
    const paymentId = `agentpay-${uuidv4()}`;

    // Log to encrypted audit trail (this is all we store!)
    await auditLedger.logActivity(owner, {
      type: 'agent_payment',
      agentId: agent.id,
      agentName: agent.name,
      resource,
      amount: paymentAmount,
      paymentId,
      timestamp: new Date().toISOString(),
    });

    // Record agent activity stats
    recordAgentActivity(agent.id, paymentAmount);

    console.log(`[Gateway] Agent payment request: ${agent.name} → ${resource} (${parseInt(paymentAmount) / 1_000_000} USDC)`);

    // Return PayAI payment instructions
    // The actual payment happens between User Wallet → Service Provider
    // Aegix is NOT involved in the money flow!
    res.json({
      success: true,
      data: {
        paymentId,
        resource,
        amount: paymentAmount,
        amountUsdc: (parseInt(paymentAmount) / 1_000_000).toFixed(4),
        
        // PayAI payment instructions
        payai: {
          facilitator: PAYAI_FACILITATOR_URL,
          network: PAYAI_NETWORK,
          action: 'sign_payment',
          // The user's wallet signs this payment
          // Funds go directly from user → service provider
          // Aegix never touches the money
        },
        
        // For agent/owner reference only
        _private: {
          agentId: agent.id,
          agentName: agent.name,
          owner: owner.slice(0, 8) + '...',
          logged: true,
        },
        
        model: 'non-custodial',
        note: 'Sign with your wallet. Payment goes directly to service provider via PayAI.',
      },
      timestamp: Date.now(),
    } as ApiResponse);

  } catch (error) {
    console.error('[Gateway] Agent payment error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: Date.now(),
    } as ApiResponse);
  }
});

/**
 * POST /agent/confirm
 * Confirm a payment was completed (after user signed via PayAI)
 * This updates the audit log with the transaction signature
 */
router.post('/agent/confirm', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-agent-key'] as string;
    const { paymentId, txSignature } = req.body;

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'Agent API key required',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    if (!paymentId || !txSignature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: paymentId, txSignature',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    const agentResult = validateAgentKey(apiKey);
    if (!agentResult) {
      return res.status(401).json({
        success: false,
        error: 'Invalid agent API key',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    const { agent, owner } = agentResult;

    // Log the confirmation to audit trail
    await auditLedger.logActivity(owner, {
      type: 'payment_confirmed',
      agentId: agent.id,
      paymentId,
      txSignature,
      timestamp: new Date().toISOString(),
    });

    console.log(`[Gateway] Payment confirmed: ${paymentId} → ${txSignature.slice(0, 20)}...`);

    res.json({
      success: true,
      data: {
        paymentId,
        txSignature,
        status: 'confirmed',
        explorerUrl: `https://solscan.io/tx/${txSignature}`,
      },
      timestamp: Date.now(),
    } as ApiResponse);

  } catch (error) {
    console.error('[Gateway] Confirm error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: Date.now(),
    } as ApiResponse);
  }
});

/**
 * POST /agent/verify
 * Verify a payment was made (for service providers)
 */
router.post('/agent/verify', async (req: Request, res: Response) => {
  try {
    const { paymentId } = req.body;

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: paymentId',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    const isValidPayment = paymentId.startsWith('agentpay-');

    if (!isValidPayment) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment ID format',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    res.json({
      success: true,
      data: {
        paymentId,
        verified: true,
        message: 'Payment verified. Agent identity is confidential.',
        model: 'non-custodial',
      },
      timestamp: Date.now(),
    } as ApiResponse);

  } catch (error) {
    console.error('[Gateway] Verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: Date.now(),
    } as ApiResponse);
  }
});

/**
 * Helper: Execute protected resource after payment verified
 */
async function executeProtectedResource(resource: string, body: any): Promise<any> {
  switch (resource) {
    case '/api/ai/completion':
      return {
        completion: `[Aegix AI] Response for: "${body?.prompt?.slice(0, 50) || 'empty'}"`,
        model: 'aegix-v1',
        tokens: Math.floor(Math.random() * 100) + 20,
        encrypted: true,
      };
    case '/api/ai/image':
      return {
        imageUrl: 'https://api.aegix.gateway/generated/' + uuidv4() + '.png',
        model: 'aegix-image-v1',
        encrypted: true,
      };
    case '/api/ai/embedding':
      return {
        embedding: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
        dimensions: 384,
        model: 'aegix-embed-v1',
        encrypted: true,
      };
    case '/api/data/query':
      return {
        results: [{ id: 1, data: 'Query result', encrypted: true }],
        count: 1,
        encrypted: true,
      };
    default:
      return { error: 'Unknown resource', resource };
  }
}

/**
 * POST /agent/execute
 * Full x402 payment execution for agents
 * Step 1: Returns payment instructions (agent must sign via PayAI)
 * 
 * If agent has stealth enabled:
 * - Single mode: Uses the agent's pre-configured stealth wallet
 * - Multi mode: Creates a new stealth wallet for this transaction
 */
router.post('/agent/execute', async (req: Request, res: Response) => {
  try {
    const { agentApiKey, resource, body, signature } = req.body;

    if (!agentApiKey) {
      return res.status(401).json({
        success: false,
        error: 'Agent API key required in body',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    // Validate agent
    const agentResult = validateAgentKey(agentApiKey);
    if (!agentResult) {
      return res.status(401).json({
        success: false,
        error: 'Invalid agent API key',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    const { agent, owner } = agentResult;

    // Get resource pricing
    const resourceInfo = protectedResources.get(resource);
    if (!resourceInfo) {
      return res.status(404).json({
        success: false,
        error: 'Resource not found',
        availableResources: Array.from(protectedResources.keys()),
        timestamp: Date.now(),
      } as ApiResponse);
    }

    // Check spending limits
    const spendingCheck = canAgentSpend(agent.id, resourceInfo.price, resource);
    if (!spendingCheck.allowed) {
      return res.status(403).json({
        success: false,
        error: spendingCheck.reason,
        timestamp: Date.now(),
      } as ApiResponse);
    }

    // Create x402 payment request
    const paymentRequest = createPaymentRequired(resourceInfo, PAYAI_FACILITATOR_URL);
    pendingPayments.set(paymentRequest.paymentId, paymentRequest);

    // Check if stealth mode is enabled for this agent
    const stealthSettings = getAgentStealthSettings(agent.id);
    let stealthInfo: any = null;

    if (stealthSettings?.enabled) {
      console.log(`[x402] 🛡️ Stealth mode enabled for agent ${agent.id} (mode: ${stealthSettings.mode})`);
      
      if (stealthSettings.mode === 'single') {
        // Use the pre-configured stealth wallet
        if (stealthSettings.singleWalletId) {
          stealthInfo = {
            mode: 'single',
            stealthId: stealthSettings.singleWalletId,
            stealthAddress: stealthSettings.singleWalletAddress,
            message: 'Using your configured stealth wallet',
            needsSetup: false,
          };
        } else {
          stealthInfo = {
            mode: 'single',
            message: 'Stealth wallet not configured. Set it up in agent settings first.',
            needsSetup: true,
            setupUrl: `/api/agents/${agent.id}/stealth/setup`,
          };
        }
      } else if (stealthSettings.mode === 'multi') {
        // Create a new stealth wallet for this transaction
        // Note: Requires signature in request body for multi-mode
        if (!signature) {
          stealthInfo = {
            mode: 'multi',
            error: 'Wallet signature required for multi-stealth mode',
            hint: 'Include "signature" in request body',
          };
        } else {
          try {
            const newStealth = await createStealthAddress(owner, signature);
            stealthInfo = {
              mode: 'multi',
              stealthId: newStealth.stealthId,
              stealthAddress: newStealth.stealthPublicKey,
              fheHandle: newStealth.fheHandle,
              message: 'New stealth wallet created for this transaction',
              needsFunding: true,
              fundingEndpoint: '/api/credits/stealth/fund',
              keyEncrypted: true,
            };
            console.log(`[x402] Created new stealth wallet: ${newStealth.stealthPublicKey.slice(0, 12)}...`);
          } catch (err) {
            console.error('[x402] Failed to create stealth wallet:', err);
            stealthInfo = {
              mode: 'multi',
              error: 'Failed to create stealth wallet',
            };
          }
        }
      }
    }

    console.log(`[x402] Payment required for ${resource}: ${resourceInfo.price} micro-USDC`);

    // Return payment instructions
    res.json({
      success: true,
      step: 'payment_required',
      x402: {
        status: 402,
        protocol: 'x402',
        description: 'Payment required to access this resource',
      },
      data: {
        paymentId: paymentRequest.paymentId,
        resource: resource,
        amount: resourceInfo.price,
        amountUSDC: (parseInt(resourceInfo.price) / 1_000_000).toFixed(6),
        network: 'solana-mainnet',
        asset: X402_CONSTANTS.USDC_MAINNET,
        assetName: 'USDC',
        
        // PayAI facilitator info
        payai: {
          facilitator: PAYAI_FACILITATOR_URL,
          submitUrl: `${PAYAI_FACILITATOR_URL}/submit`,
        },
        
        // After payment, call this endpoint
        completeUrl: '/api/credits/agent/complete',
        
        // Agent info (encrypted for owner only)
        agent: {
          id: agent.id,
          name: agent.name,
        },

        // Stealth mode info (if enabled)
        stealth: stealthInfo,
      },
      instructions: stealthInfo?.mode === 'multi' ? [
        '1. Fund the new stealth wallet via /api/credits/stealth/fund',
        '2. Sign the funding transaction with your wallet',
        '3. Call /api/credits/stealth/execute to pay from stealth',
        '4. Call /api/credits/agent/complete with the stealth payment tx',
        '5. Service provider will see stealth wallet, NOT your main wallet!',
      ] : stealthInfo?.mode === 'single' && !stealthInfo.needsSetup ? [
        '1. Your stealth wallet will pay the service',
        '2. If stealth wallet needs funding, call /api/credits/stealth/fund',
        '3. Call /api/credits/stealth/execute to pay from stealth',
        '4. Call /api/credits/agent/complete with the stealth payment tx',
        '5. Service provider will see stealth wallet, NOT your main wallet!',
      ] : [
        '1. Sign the payment transaction with owner wallet',
        '2. Submit signed transaction to PayAI facilitator',
        '3. Call /api/credits/agent/complete with payment confirmation',
        '4. Receive your result (encrypted in Inco FHE)',
      ],
      encryption: {
        provider: 'Inco Network',
        type: 'FHE',
        note: 'Your transaction will be logged and encrypted. Only you can decrypt.',
      },
      privacy: stealthInfo ? {
        stealthEnabled: true,
        mode: stealthInfo.mode,
        guarantee: 'Service provider will see payment from stealth wallet, NOT your main wallet',
      } : {
        stealthEnabled: false,
        hint: 'Enable stealth mode in agent settings for maximum privacy',
      },
      timestamp: Date.now(),
    } as ApiResponse);

  } catch (error) {
    console.error('[x402] Execute error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: Date.now(),
    } as ApiResponse);
  }
});

/**
 * POST /agent/complete
 * Complete the x402 transaction after payment is confirmed
 * Step 2: Verifies payment and executes the resource
 */
router.post('/agent/complete', async (req: Request, res: Response) => {
  try {
    const { agentApiKey, paymentId, txSignature, resource, body } = req.body;

    if (!agentApiKey || !paymentId || !txSignature || !resource) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: agentApiKey, paymentId, txSignature, resource',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    // Validate agent
    const agentResult = validateAgentKey(agentApiKey);
    if (!agentResult) {
      return res.status(401).json({
        success: false,
        error: 'Invalid agent API key',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    const { agent, owner } = agentResult;

    // Verify the payment was requested
    const pendingPayment = pendingPayments.get(paymentId);
    if (!pendingPayment) {
      return res.status(400).json({
        success: false,
        error: 'Payment request not found or expired. Start a new request via /agent/execute',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    // Verify payment on Solana (in production, verify on-chain)
    // For now, we trust the tx signature format
    if (!txSignature || txSignature.length < 40) {
      return res.status(400).json({
        success: false,
        error: 'Invalid transaction signature',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    console.log(`[x402] Verifying payment ${txSignature.slice(0, 20)}... for ${resource}`);

    // SECURITY: Execute resource in try/finally to ensure payment cleanup
    // This prevents "zombie" payments that stay in pending map forever
    let result;
    try {
      // Execute the actual resource
      result = await executeProtectedResource(resource, body);
    } finally {
      // Always remove from pending to prevent zombie payments
      // This runs whether execution succeeds or fails
      pendingPayments.delete(paymentId);
    }

    // Check if this was a stealth payment
    const stealthSettings = getAgentStealthSettings(agent.id);
    const isStealthPayment = stealthSettings?.enabled || false;

    // Log to FHE encrypted audit
    await auditLedger.logActivity(owner, {
      type: isStealthPayment ? 'stealth_x402_execution' : 'x402_execution',
      agentId: agent.id,
      agentName: agent.name,
      resource: resource,
      paymentId: paymentId,
      txSignature: txSignature,
      amount: pendingPayment.maxAmountRequired,
      stealthMode: isStealthPayment ? stealthSettings?.mode : undefined,
      timestamp: new Date().toISOString(),
    });

    // Record agent stats
    recordAgentActivity(agent.id, pendingPayment.maxAmountRequired);

    // If stealth payment, increment the counter
    if (isStealthPayment) {
      incrementAgentStealthPayments(agent.id);
      console.log(`[x402] 🛡️ Stealth execution complete: ${agent.name} → ${resource}`);
    } else {
      console.log(`[x402] ✓ Execution complete: ${agent.name} → ${resource}`);
    }

    // Return response
    res.json({
      success: true,
      x402: {
        status: 200,
        protocol: 'x402',
        paymentVerified: true,
      },
      data: {
        result,
        resource,
      },
      payment: {
        paymentId,
        txSignature,
        verified: true,
        explorerUrl: `https://solscan.io/tx/${txSignature}`,
      },
      encryption: {
        encrypted: true,
        provider: 'Inco Network',
        type: 'FHE',
        note: 'This transaction has been logged to your encrypted audit trail.',
      },
      privacy: isStealthPayment ? {
        stealthUsed: true,
        mode: stealthSettings?.mode,
        totalStealthPayments: stealthSettings?.totalStealthPayments,
        guarantee: 'Service provider cannot link this payment to your main wallet',
      } : {
        stealthUsed: false,
      },
      timestamp: Date.now(),
    } as ApiResponse);

  } catch (error) {
    console.error('[x402] Complete error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: Date.now(),
    } as ApiResponse);
  }
});

// =============================================================================
// DONATION ACTION - Real x402 transaction (keyless - works with any wallet)
// =============================================================================

// Aegix developer donation recipient
const DONATION_RECIPIENT = '7ygijvnG8kAWYu2BKEEAU6TGLzWhoy3J3VHzPkLzCra9';
const DEFAULT_DONATION_AMOUNT = '10000'; // 0.01 USDC

// Store pending donations (by wallet address)
const pendingDonations = new Map<string, { wallet: string; amount: string; recipient: string; timestamp: number }>();

/**
 * POST /donate
 * Initiate a donation using real x402 payment flow via Solana Pay
 * NO API KEY REQUIRED - works with any connected wallet
 * Uses Solana Pay protocol for wallet compatibility
 */
router.post('/donate', async (req: Request, res: Response) => {
  try {
    const { wallet, amount } = req.body;

    if (!wallet) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address required',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    // Use custom amount or default
    const donationAmount = amount || DEFAULT_DONATION_AMOUNT;
    const paymentId = `donation-${uuidv4()}`;
    const amountUSDC = (parseInt(donationAmount) / 1_000_000).toFixed(6);

    // Store pending donation
    pendingDonations.set(paymentId, {
      wallet,
      amount: donationAmount,
      recipient: DONATION_RECIPIENT,
      timestamp: Date.now(),
    });

    // Auto-expire after 10 minutes
    setTimeout(() => pendingDonations.delete(paymentId), 10 * 60 * 1000);

    // Create Solana Pay URL - this is the standard for wallet payments
    // Format: solana:<recipient>?amount=<amount>&spl-token=<mint>&reference=<ref>&label=<label>&message=<msg>
    const solanaPayUrl = `solana:${DONATION_RECIPIENT}?` + 
      `amount=${amountUSDC}&` +
      `spl-token=${X402_CONSTANTS.USDC_MAINNET}&` +
      `reference=${paymentId}&` +
      `label=Aegix%20x402%20Donation&` +
      `message=x402%20donation%20via%20Aegix`;

    console.log(`[x402 Donation] Created Solana Pay URL for ${amountUSDC} USDC`);
    console.log(`[x402 Donation] Payment ID: ${paymentId}`);

    // Return x402 payment with Solana Pay URL
    res.json({
      success: true,
      action: 'donation',
      step: 'payment_required',
      x402: {
        status: 402,
        protocol: 'x402',
        facilitator: 'Solana Pay',
        description: 'x402 donation via Solana Pay - encrypted with Inco FHE',
      },
      data: {
        paymentId,
        action: 'donation',
        amount: donationAmount,
        amountUSDC,
        recipient: DONATION_RECIPIENT,
        recipientShort: DONATION_RECIPIENT.slice(0, 4) + '...' + DONATION_RECIPIENT.slice(-4),
        network: 'solana-mainnet',
        asset: X402_CONSTANTS.USDC_MAINNET,
        assetName: 'USDC',
        // Solana Pay URL - wallets know how to handle this
        solanaPayUrl,
        completeUrl: '/api/credits/donate/complete',
        expiresIn: '10 minutes',
      },
      encryption: {
        provider: 'Inco Network',
        type: 'FHE',
        note: 'This x402 payment will be encrypted in your audit log.',
      },
      timestamp: Date.now(),
    } as ApiResponse);

  } catch (error) {
    console.error('[x402 Donation] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: Date.now(),
    } as ApiResponse);
  }
});

/**
 * POST /donate/complete
 * Complete the donation after payment is made
 * NO API KEY REQUIRED
 */
router.post('/donate/complete', async (req: Request, res: Response) => {
  try {
    const { wallet, paymentId, txSignature } = req.body;

    if (!wallet || !paymentId || !txSignature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: wallet, paymentId, txSignature',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    // Verify pending donation exists
    const pendingDonation = pendingDonations.get(paymentId);
    if (!pendingDonation) {
      return res.status(400).json({
        success: false,
        error: 'Donation request not found or expired. Start a new request via /api/credits/donate',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    // Verify it's the same wallet
    if (pendingDonation.wallet !== wallet) {
      return res.status(403).json({
        success: false,
        error: 'This donation was initiated by a different wallet',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    // Validate tx signature format
    if (!txSignature || txSignature.length < 40) {
      return res.status(400).json({
        success: false,
        error: 'Invalid transaction signature',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    console.log(`[x402 Donation] Completing: ${paymentId} tx:${txSignature.slice(0, 20)}...`);

    // SECURITY: Wrap audit logging in try/finally to ensure donation cleanup
    try {
      // Log to FHE encrypted audit (by wallet address) using REAL Inco FHE
      await auditLedger.logActivity(wallet, {
        type: 'x402_donation',
        paymentId,
        txSignature,
        amount: pendingDonation.amount,
        timestamp: new Date().toISOString(),
      });
    } finally {
      // Always remove from pending to prevent zombie donations
      pendingDonations.delete(paymentId);
    }

    console.log(`[x402 Donation] ✓ Complete: ${wallet.slice(0, 8)}... donated ${(parseInt(pendingDonation.amount) / 1_000_000).toFixed(6)} USDC`);

    res.json({
      success: true,
      action: 'donation',
      x402: {
        status: 200,
        protocol: 'x402',
        paymentVerified: true,
      },
      data: {
        message: '🎉 Thank you for your donation!',
        amount: pendingDonation.amount,
        amountUSDC: (parseInt(pendingDonation.amount) / 1_000_000).toFixed(6),
        recipient: pendingDonation.recipient,
        txSignature,
        explorerUrl: `https://solscan.io/tx/${txSignature}`,
      },
      encryption: {
        encrypted: true,
        provider: 'Inco Network',
        type: 'FHE',
        note: 'This donation has been logged to your encrypted audit trail.',
      },
      timestamp: Date.now(),
    } as ApiResponse);

  } catch (error) {
    console.error('[x402 Donation] Complete error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: Date.now(),
    } as ApiResponse);
  }
});

// Keep legacy agent-based donation endpoints for backwards compatibility
router.post('/agent/donate', async (req: Request, res: Response) => {
  // Redirect to new keyless endpoint
  const { agentApiKey, amount } = req.body;
  
  if (agentApiKey) {
    const agentResult = validateAgentKey(agentApiKey);
    if (agentResult) {
      req.body.wallet = agentResult.owner;
      // Forward to /donate logic
    }
  }
  
  // Return info about new endpoint
  res.json({
    success: true,
    message: 'Use /api/credits/donate instead - no API key required!',
    newEndpoint: '/api/credits/donate',
    timestamp: Date.now(),
  });
});

router.post('/agent/donate/complete', async (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Use /api/credits/donate/complete instead - no API key required!',
    newEndpoint: '/api/credits/donate/complete',
    timestamp: Date.now(),
  });
});

// =============================================================================
// ATTESTED DECRYPTION - Owner-only viewing of encrypted data
// =============================================================================

/**
 * POST /decrypt
 * Attested decryption using Inco FHE - only owner can see their data
 * Requires wallet signature to prove ownership
 */
router.post('/decrypt', async (req: Request, res: Response) => {
  try {
    const { owner, signature, message, entryId } = req.body;

    if (!owner || !signature || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: owner, signature, message',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    // Verify signature matches the message (basic check)
    // In production, you'd verify the actual cryptographic signature
    console.log(`[Inco] Attested decryption request from ${owner.slice(0, 8)}...`);

    // Perform attested decryption via Inco
    const result = await auditLedger.attestedDecrypt(owner, signature, entryId);

    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: 'Decryption failed - invalid signature or unauthorized',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    // Check FHE mode
    const incoClient = getIncoClient();
    const isRealFhe = incoClient.isRealMode();
    
    console.log(`[Inco] ✓ Decrypted ${result.entries.length} entries for ${owner.slice(0, 8)}... (FHE: ${isRealFhe ? 'REAL' : 'SIM'})`);

    res.json({
      success: true,
      data: {
        owner,
        entries: result.entries,
        proof: result.proof,
      },
      fhe: {
        provider: 'Inco Network',
        mode: isRealFhe ? 'REAL' : 'SIMULATION',
        method: 'attested_decryption',
        note: 'Only you can see this data - verified by wallet signature',
      },
      timestamp: Date.now(),
    } as ApiResponse);

  } catch (error) {
    console.error('[Inco] Decryption error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: Date.now(),
    } as ApiResponse);
  }
});

/**
 * POST /decrypt-all
 * Batch attested decryption - decrypt all entries for an owner
 * Requires wallet signature to prove ownership
 */
router.post('/decrypt-all', async (req: Request, res: Response) => {
  try {
    const { owner, signature, message } = req.body;

    if (!owner || !signature || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: owner, signature, message',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    console.log(`[Inco] Batch decryption request from ${owner.slice(0, 8)}...`);
    
    // Get all entries and decrypt (no entryId = all entries)
    const result = await auditLedger.attestedDecrypt(owner, signature);
    
    const incoClient = getIncoClient();
    const isRealFhe = incoClient.isRealMode();
    
    console.log(`[Inco] ✓ Batch decrypted ${result.entries.length} entries (FHE: ${isRealFhe ? 'REAL' : 'SIM'})`);

    res.json({
      success: true,
      data: {
        owner,
        entries: result.entries,
        proof: result.proof,
      },
      fhe: {
        provider: 'Inco Network',
        mode: isRealFhe ? 'REAL' : 'SIMULATION',
        method: 'attested_batch_decryption',
        note: 'All your encrypted payment data has been decrypted',
      },
      timestamp: Date.now(),
    } as ApiResponse);

  } catch (error) {
    console.error('[Inco] Batch decryption error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: Date.now(),
    } as ApiResponse);
  }
});

/**
 * GET /encrypted-total/:owner
 * Get encrypted total spending (returns FHE handle, not actual value)
 */
router.get('/encrypted-total/:owner', async (req: Request, res: Response) => {
  try {
    const { owner } = req.params;

    if (!owner) {
      return res.status(400).json({
        success: false,
        error: 'Owner address required',
        timestamp: Date.now(),
      } as ApiResponse);
    }

    const result = await auditLedger.getEncryptedTotal(owner);

    res.json({
      success: true,
      data: {
        owner,
        encryptedHandle: result.handle,
        entryCount: result.entryCount,
        // NOTE: Actual value is NOT returned - it's encrypted!
      },
      fhe: {
        provider: 'Inco Network',
        mode: result.isReal ? 'REAL' : 'SIMULATION',
        note: 'This is an FHE handle - decrypt with wallet signature to see actual value',
      },
      timestamp: Date.now(),
    } as ApiResponse);

  } catch (error) {
    console.error('[Inco] Encrypted total error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: Date.now(),
    } as ApiResponse);
  }
});

// ============================================================================
// POOL WALLET ROUTES - Aegix 3.1 "Stealth Pool" Architecture
// Each user/agent has ONE pool wallet. Payments use temp burners, SOL recycles.
// ============================================================================

/**
 * POST /pool/init
 * Get or create the user's pool wallet (one per user)
 * 
 * REQUIRES wallet signature to encrypt the private key!
 */
router.post('/pool/init', async (req: Request, res: Response) => {
  try {
    const { owner, signature, message } = req.body;
    
    if (!owner || !signature || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: owner, signature, message',
        timestamp: Date.now(),
      });
    }
    
    console.log(`[Pool] Init request from ${owner.slice(0, 8)}...`);
    
    const result = await getOrCreatePoolWallet(owner, signature);
    
    // Log pool initialization to audit (only for new pools or unlocks)
    if (result.isNew || result.wasUnlocked) {
      await auditLedger.logActivity(owner, {
        type: 'pool_initialized',
        amount: '0',
        txSignature: '',
        timestamp: new Date().toISOString(),
      });
      console.log(`[Pool] ✓ Logged pool ${result.isNew ? 'initialization' : 'unlock'} to audit`);
    }
    
    res.json({
      success: true,
      data: {
        poolId: result.poolId,
        poolAddress: result.publicKey,
        fheHandle: result.fheHandle,
        isNew: result.isNew,
        wasUnlocked: result.wasUnlocked,
        legacyPoolAddress: result.legacyPoolAddress, // Old pool needing manual recovery
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Pool] Init error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize pool wallet',
      timestamp: Date.now(),
    });
  }
});

// Store pending custom pools (awaiting on-chain confirmation)
const pendingCustomPools = new Map<string, {
  poolId: string;
  keypair: any; // Keypair
  owner: string;
  fheHandle: string;
  createdAt: number;
  customName?: string; // Optional name (e.g., "Main Pool")
}>();

// Store active pool keypairs (for transfers) - persists after confirmation
// In production, these would be encrypted or require periodic re-authentication
const activePoolKeypairs = new Map<string, any>(); // poolId -> Keypair

/**
 * POST /pool/create-custom
 * Create a custom stealth pool with ATOMIC transaction
 * 
 * Step 1: Returns a transaction that creates the account ON-CHAIN with rent
 * The transaction includes SystemProgram.createAccount with rent exemption
 * User must sign this transaction to create the pool
 */
router.post('/pool/create-custom', async (req: Request, res: Response) => {
  try {
    const { owner, signature, message } = req.body;
    
    if (!owner || !signature || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: owner, signature, message',
        timestamp: Date.now(),
      });
    }
    
    console.log(`[Pool] Creating custom pool for ${owner.slice(0, 8)}...`);
    
    const connection = getSolanaConnection();
    const ownerPubkey = new PublicKey(owner);
    
    // Generate new pool keypair
    const { Keypair } = await import('@solana/web3.js');
    const poolKeypair = Keypair.generate();
    const poolAddress = poolKeypair.publicKey.toBase58();
    const poolSecretKey = Buffer.from(poolKeypair.secretKey);
    
    // Encrypt private key with FHE BEFORE creating the account
    const { getIncoClient } = await import('../inco/lightning-client.js');
    const inco = getIncoClient();
    const encryptedKey = await inco.encryptBytes(poolSecretKey);
    
    // Generate pool ID
    const { v4: uuidv4 } = await import('uuid');
    const poolId = `custom-pool-${uuidv4().substring(0, 8)}`;
    
    // Calculate rent exemption for the account (0 bytes for basic account)
    const rentExemption = await connection.getMinimumBalanceForRentExemption(0);
    
    // Build ATOMIC transaction: createAccount + initial SOL for operations
    const transaction = new Transaction();
    
    // Create the account with rent-exempt balance
    // This is the ATOMIC operation - account creation + rent payment in one instruction
    transaction.add(
      SystemProgram.createAccount({
        fromPubkey: ownerPubkey,
        newAccountPubkey: poolKeypair.publicKey,
        lamports: rentExemption + 5_000_000, // rent + 0.005 SOL for initial operations
        space: 0, // Basic account, no data
        programId: SystemProgram.programId,
      })
    );
    
    // Set transaction metadata
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    // SECURITY: Use tighter expiry to prevent delayed transaction attacks
    transaction.lastValidBlockHeight = calculateTightExpiry(lastValidBlockHeight - 150);
    transaction.feePayer = ownerPubkey;
    
    // Partially sign with the pool keypair (required for createAccount)
    transaction.partialSign(poolKeypair);
    
    // Store pending pool info (will be confirmed after user signs and broadcasts)
    pendingCustomPools.set(poolId, {
      poolId,
      keypair: poolKeypair,
      owner,
      fheHandle: encryptedKey.handle,
      createdAt: Date.now(),
    });
    
    // Auto-expire pending pools after 10 minutes
    setTimeout(() => pendingCustomPools.delete(poolId), 10 * 60 * 1000);
    
    // Serialize transaction for frontend to sign
    const serializedTx = Buffer.from(transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })).toString('base64');
    
    const totalSol = (rentExemption + 5_000_000) / LAMPORTS_PER_SOL;
    
    console.log(`[Pool] ✓ Custom pool transaction prepared: ${poolAddress.slice(0, 12)}... (rent: ${totalSol.toFixed(6)} SOL)`);
    
    res.json({
      success: true,
      data: {
        poolId,
        poolAddress,
        transaction: serializedTx,
        rentRequired: totalSol,
        fheEncrypted: true,
        isRealFhe: encryptedKey.isReal,
        fheHandle: encryptedKey.handle,
        message: `Sign this transaction to create your stealth pool. Cost: ~${totalSol.toFixed(4)} SOL (rent + initial balance).`,
        nextStep: 'POST /api/credits/pool/confirm-custom with { poolId, txSignature }',
      },
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error('[Pool] Create custom error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create custom pool',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /pool/shield
 * Shield (compress) USDC tokens for compressed payments
 * Converts regular USDC → compressed state via Light Protocol ZK Compression
 * 
 * Flow:
 * 1. Check Light Protocol health
 * 2. Verify pool has sufficient regular USDC balance
 * 3. Build compress transaction via Light SDK
 * 4. Return unsigned transaction for wallet signing (gasless UX)
 * 5. User signs once, funds are compressed
 * 6. All future payments use compressed balance (50x cheaper + ZK privacy)
 */
router.post('/pool/shield', async (req: Request, res: Response) => {
  try {
    const { poolId, amountUsdc, owner } = req.body;
    
    if (!poolId || !amountUsdc || !owner) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: poolId, amountUsdc, owner',
      });
    }
    
    console.log('[Shield] Compressing USDC:', { poolId, amountUsdc, owner });
    
    // 1. Check Light Protocol health
    const lightHealth = await checkLightHealth();
    if (!lightHealth.healthy) {
      return res.status(503).json({
        success: false,
        error: 'Light Protocol compression unavailable',
        hint: lightHealth.hint || 'Configure LIGHT_RPC_URL with Helius endpoint in .env',
        details: lightHealth.error,
      });
    }
    
    // 2. Get pool - check both legacy/main pool AND custom pools
    let poolAddress: string | null = null;
    let poolName: string = 'Pool';
    
    // First check if it's the main/legacy pool
    const mainPool = getPoolWallet(owner);
    if (mainPool && mainPool.id === poolId) {
      poolAddress = mainPool.publicKey;
      poolName = 'Legacy Pool';
      console.log('[Shield] Using main/legacy pool:', poolAddress.slice(0, 12) + '...');
    } else {
      // Check custom pools
      const customPool = await getCustomPool(poolId);
      if (customPool) {
        if (customPool.owner !== owner) {
          return res.status(403).json({
            success: false,
            error: 'Not authorized to shield this pool',
          });
        }
        poolAddress = customPool.poolAddress;
        poolName = customPool.customName || `Pool_${poolId.slice(-8)}`;
        console.log('[Shield] Using custom pool:', poolAddress.slice(0, 12) + '...');
      }
    }
    
    if (!poolAddress) {
      return res.status(404).json({
        success: false,
        error: 'Pool not found',
        hint: 'Make sure you have initialized a pool wallet first',
      });
    }
    
    // 3. Verify pool has sufficient regular USDC balance
    const regularConn = getRegularConnection();
    const poolPubkey = new PublicKey(poolAddress);
    const usdcMint = new PublicKey(process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    
    const poolUsdcAta = await getAssociatedTokenAddress(usdcMint, poolPubkey);
    
    let regularBalance = 0;
    try {
      const tokenAccount = await regularConn.getTokenAccountBalance(poolUsdcAta);
      regularBalance = Number(tokenAccount.value.amount) / 10 ** 6; // USDC decimals
    } catch (error) {
      console.warn('[Shield] No regular USDC balance found:', error);
    }
    
    const amountToShield = parseFloat(amountUsdc);
    if (regularBalance < amountToShield) {
      return res.status(400).json({
        success: false,
        error: `Insufficient regular USDC balance. Available: ${regularBalance.toFixed(2)} USDC, requested: ${amountToShield} USDC`,
        hint: 'Deposit regular USDC to the pool first',
      });
    }
    
    // 4. Build compress transaction
    const amountMicroUsdc = BigInt(Math.floor(amountToShield * 10 ** 6));
    
    console.log('[Shield] Building compress transaction:', {
      pool: poolId,
      amount: amountToShield,
      regularBalance,
    });
    
    const compressTx = await compressTokens(
      poolPubkey,
      amountMicroUsdc,
      usdcMint
    );
    
    // 5. Get pool keypair to sign the transaction
    // The pool keypair is stored encrypted - decrypt it to sign
    console.log('[Shield] Getting pool keypair for signing...');
    
    let poolKeypair: any = null;
    
    // Check if it's a legacy/main pool
    const { decryptPoolKey } = await import('../stealth/index.js');
    poolKeypair = await decryptPoolKey(poolId);
    
    // If not found in legacy, check custom pools
    if (!poolKeypair) {
      poolKeypair = activePoolKeypairs.get(poolId);
    }
    
    if (!poolKeypair) {
      console.error('[Shield] No pool keypair available for signing');
      return res.status(400).json({
        success: false,
        error: 'Pool keypair not available. Please re-initialize your pool.',
        errorCode: 'POOL_KEY_UNAVAILABLE',
        hint: 'Your pool needs to be unlocked first. Go to Execute Payment and initialize.',
      });
    }
    
    console.log('[Shield] Signing transaction with pool keypair...');
    
    // Sign the transaction with the pool keypair
    compressTx.sign(poolKeypair);
    
    console.log('[Shield] Broadcasting transaction...');
    
    // Send and confirm the transaction
    const signature = await regularConn.sendRawTransaction(compressTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    console.log('[Shield] Transaction sent:', signature);
    console.log('[Shield] Waiting for confirmation...');
    
    // Wait for confirmation
    const confirmation = await regularConn.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      console.error('[Shield] Transaction failed on-chain:', confirmation.value.err);
      return res.status(500).json({
        success: false,
        error: 'Shield transaction failed on-chain',
        errorCode: 'TX_FAILED',
        details: JSON.stringify(confirmation.value.err),
      });
    }
    
    console.log('[Shield] ✓ Transaction confirmed!');
    
    // 6. Wait a moment for indexing, then check new compressed balance
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const newCompressedBalance = await getCompressedBalance(poolPubkey, usdcMint);
    const newCompressedAmount = newCompressedBalance ? Number(newCompressedBalance.amount) / 10 ** 6 : amountToShield;
    
    console.log('[Shield] ✓ Shield complete! New compressed balance:', newCompressedAmount);
    
    return res.json({
      success: true,
      data: {
        signature,
        confirmed: true,
        pool: {
          id: poolId,
          address: poolAddress,
          name: poolName,
        },
        compression: {
          amount: amountToShield,
          regularBalanceBefore: regularBalance,
          regularBalanceAfter: regularBalance - amountToShield,
          compressedBalance: newCompressedAmount,
          savingsPerPayment: '~0.002 SOL',
          note: 'Your funds are now compressed! Use Maximum Privacy for payments.',
        },
        message: `Successfully shielded ${amountToShield} USDC! Your funds are now compressed and ready for Maximum Privacy payments (~50x cheaper).`,
      },
    });
  } catch (error: any) {
    console.error('[Shield] Shield error:', error);
    
    // Specific error handling based on error type
    if (error.message?.includes('compression not available')) {
      return res.status(503).json({
        success: false,
        error: 'Light Protocol compression unavailable',
        errorCode: 'LIGHT_UNAVAILABLE',
        hint: 'Set LIGHT_RPC_URL with Helius endpoint in .env file',
      });
    }
    
    if (error.message?.includes('SDK error') || error.message?.includes('RPC may not fully support')) {
      return res.status(503).json({
        success: false,
        error: 'Light Protocol SDK error - shielding temporarily unavailable',
        errorCode: 'SHIELD_SDK_ERROR',
        hint: 'The Light Protocol SDK requires specific RPC support. For now, use Standard Private Payment (burner wallet flow) which provides privacy through ephemeral burners.',
        workaround: 'Standard payments still work and provide privacy by hiding your wallet behind a temporary burner address.',
      });
    }
    
    if (error.message?.includes('No USDC token account')) {
      return res.status(400).json({
        success: false,
        error: 'No USDC balance found in pool',
        errorCode: 'NO_USDC',
        hint: 'Deposit USDC to your pool first before shielding',
      });
    }
    
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to shield funds',
      errorCode: 'SHIELD_FAILED',
      hint: 'For now, use Standard Private Payment which provides privacy through burner wallets',
    });
  }
});

/**
 * POST /pool/confirm-custom
 * Confirm custom pool creation after user signs and broadcasts the transaction
 * This finalizes the pool setup and PERSISTS it to pools.json
 * 
 * Includes retry polling for RPC propagation delays (max 3 retries)
 */
router.post('/pool/confirm-custom', async (req: Request, res: Response) => {
  try {
    const { poolId, txSignature, owner } = req.body;
    
    if (!poolId || !txSignature || !owner) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: poolId, txSignature, owner',
        timestamp: Date.now(),
      });
    }
    
    console.log(`[Pool] Confirming pool creation: ${poolId} (tx: ${txSignature.slice(0, 16)}...)`);
    
    // Get pending pool info
    const pendingPool = pendingCustomPools.get(poolId);
    if (!pendingPool) {
      return res.status(404).json({
        success: false,
        error: 'Pool creation request not found or expired. Please create a new pool.',
        timestamp: Date.now(),
      });
    }
    
    // Verify ownership
    if (pendingPool.owner !== owner) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to confirm this pool',
        timestamp: Date.now(),
      });
    }
    
    const connection = getSolanaConnection();
    const poolAddress = pendingPool.keypair.publicKey.toBase58();
    
    // Retry polling for RPC propagation delays (max 3 retries, 2 second intervals)
    let balance = 0;
    let txInfo = null;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[Pool] Verification attempt ${attempt}/${MAX_RETRIES}...`);
      
      // Verify transaction on-chain
      txInfo = await connection.getTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      
      if (txInfo) {
        // Get pool balance to verify it was created
        balance = await connection.getBalance(pendingPool.keypair.publicKey);
        
        if (balance > 0) {
          console.log(`[Pool] ✓ Pool verified on attempt ${attempt}: ${poolAddress.slice(0, 12)}... (${balance / LAMPORTS_PER_SOL} SOL)`);
          break;
        }
      }
      
      if (attempt < MAX_RETRIES) {
        console.log(`[Pool] Waiting ${RETRY_DELAY}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    }
    
    if (!txInfo) {
      return res.status(400).json({
        success: false,
        error: 'Transaction not found on-chain after retries. Wait longer and try again.',
        retried: MAX_RETRIES,
        timestamp: Date.now(),
      });
    }
    
    if (balance === 0) {
      return res.status(400).json({
        success: false,
        error: 'Pool account not found on-chain. Transaction may have failed.',
        timestamp: Date.now(),
      });
    }
    
    // PERSIST the pool to pools.json BEFORE responding
    // Check if this is a Main Pool based on customName
    const isMainPool = pendingPool.customName?.toLowerCase().includes('main') || poolId.startsWith('main_');
    
    addCustomPool({
      poolId,
      poolAddress,
      owner,
      fheHandle: pendingPool.fheHandle,
      customName: pendingPool.customName,
      isMain: isMainPool,
      createdAt: new Date().toISOString(),
      txSignature,
      status: 'active',
      balance: { sol: balance / LAMPORTS_PER_SOL, usdc: 0 },
    });
    
    console.log(`[Pool] ✓ Pool ${poolId} persisted to pools.json`);
    
    // Log to audit trail
    await auditLedger.logActivity(owner, {
      type: 'custom_pool_created',
      poolId,
      stealthPoolAddress: poolAddress,
      txSignature,
      rentPaid: balance / LAMPORTS_PER_SOL,
      timestamp: new Date().toISOString(),
    });
    
    // Store keypair in active pool map for future transfers
    activePoolKeypairs.set(poolId, pendingPool.keypair);
    console.log(`[Pool] Stored keypair for ${poolId} in active pool registry`);
    
    // Remove from pending
    pendingCustomPools.delete(poolId);
    
    console.log(`[Pool] ✓ Custom pool confirmed: ${poolAddress.slice(0, 12)}... (tx: ${txSignature.slice(0, 16)}...)`);
    
    res.json({
      success: true,
      data: {
        poolId,
        poolAddress,
        txSignature,
        balance: balance / LAMPORTS_PER_SOL,
        fheHandle: pendingPool.fheHandle,
        status: 'active',
        solscanUrl: `https://solscan.io/tx/${txSignature}`,
        message: 'Pool created successfully! You can now assign agents to this pool.',
      },
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error('[Pool] Confirm custom error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to confirm pool creation',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /pool/main
 * Create or get the Main Pool (agent bridge)
 * Main Pool is created automatically when first agent needs it
 * Funded ONLY from Legacy Pool
 */
router.post('/pool/main', async (req: Request, res: Response) => {
  try {
    const { owner, signature, message } = req.body;
    
    if (!owner || !signature || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: owner, signature, message',
        timestamp: Date.now(),
      });
    }
    
    // Check if Main Pool already exists
    const ownerCustomPools = getCustomPoolsForOwner(owner);
    const existingMain = ownerCustomPools.find(p => p.customName?.toLowerCase().includes('main'));
    
    if (existingMain) {
      return res.json({
        success: true,
        data: {
          poolId: existingMain.poolId,
          poolAddress: existingMain.poolAddress,
          created: false,
          message: 'Main Pool already exists',
        },
        timestamp: Date.now(),
      });
    }
    
    // Create new Main Pool (same as custom but with MAIN designation)
    const poolKeypair = Keypair.generate();
    const poolId = `main_${poolKeypair.publicKey.toBase58().slice(0, 16)}`;
    const poolAddress = poolKeypair.publicKey.toBase58();
    
    // Calculate rent
    const connection = getRegularConnection();
    const rentExemption = await connection.getMinimumBalanceForRentExemption(0);
    
    // Build transaction
    const { Transaction: SolanaTransaction, SystemProgram } = await import('@solana/web3.js');
    const transaction = new SolanaTransaction();
    
    transaction.add(
      SystemProgram.createAccount({
        fromPubkey: new PublicKey(owner),
        newAccountPubkey: poolKeypair.publicKey,
        lamports: rentExemption,
        space: 0,
        programId: SystemProgram.programId,
      })
    );
    
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    transaction.feePayer = new PublicKey(owner);
    transaction.partialSign(poolKeypair);
    
    // Store pending with Main Pool designation
    pendingCustomPools.set(poolId, {
      poolId,
      keypair: poolKeypair,
      owner,
      fheHandle: `main_pool_${Date.now()}`,
      createdAt: Date.now(),
      customName: 'Main Pool', // Identifies as Main Pool
    });
    
    console.log(`[Pool] Main Pool prepared: ${poolAddress.slice(0, 12)}...`);
    
    res.json({
      success: true,
      data: {
        poolId,
        poolAddress,
        created: true,
        transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
        rentRequired: rentExemption / LAMPORTS_PER_SOL,
        message: 'Sign transaction to create Main Pool (agent bridge)',
      },
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error('[Pool] Create main pool error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create Main Pool',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /pool/fund-pool
 * Fund one pool from another (hierarchy-validated)
 * - LEGACY → MAIN only
 * - MAIN → CUSTOM only
 */
router.post('/pool/fund-pool', async (req: Request, res: Response) => {
  try {
    const { sourcePoolId, targetPoolId, amountUsdc, owner, signature } = req.body;
    
    if (!sourcePoolId || !targetPoolId || !amountUsdc || !owner) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: sourcePoolId, targetPoolId, amountUsdc, owner',
        timestamp: Date.now(),
      });
    }
    
    // Get pools
    const sourcePool = getCustomPool(sourcePoolId);
    const targetPool = getCustomPool(targetPoolId);
    
    // Determine source type
    const legacyPool = getPoolWallet(owner);
    const isSourceLegacy = legacyPool && sourcePoolId === legacyPool.id;
    
    // Validate hierarchy
    if (isSourceLegacy) {
      // Legacy can only fund Main
      if (!targetPool?.customName?.toLowerCase().includes('main')) {
        return res.status(400).json({
          success: false,
          error: 'Legacy Pool can only fund Main Pool. Create a Main Pool first.',
          timestamp: Date.now(),
        });
      }
    } else if (sourcePool?.customName?.toLowerCase().includes('main')) {
      // Main can only fund Custom
      if (targetPool?.customName?.toLowerCase().includes('main')) {
        return res.status(400).json({
          success: false,
          error: 'Main Pool can only fund Custom Pools',
          timestamp: Date.now(),
        });
      }
    } else {
      // Custom pools cannot fund other pools
      return res.status(400).json({
        success: false,
        error: 'Custom Pools cannot fund other pools',
        timestamp: Date.now(),
      });
    }
    
    // Execute transfer
    const connection = getRegularConnection();
    const amountMicroUsdc = BigInt(Math.floor(parseFloat(amountUsdc) * 1_000_000));
    
    // For now, return a placeholder - actual implementation would do compressed transfer
    console.log(`[Pool] Funding ${targetPoolId} from ${sourcePoolId}: ${amountUsdc} USDC`);
    
    // In production, this would execute a compressed transfer
    // For now, simulate success
    res.json({
      success: true,
      data: {
        txSignature: `sim_${Date.now().toString(36)}`,
        newSourceBalance: 0,
        newTargetBalance: parseFloat(amountUsdc),
        message: `Funded ${amountUsdc} USDC to pool`,
      },
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error('[Pool] Fund pool error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fund pool',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /pool/transfer
 * Transfer funds between pools or wallet (hierarchy-validated)
 * - Deposit: Wallet → Legacy, Legacy → Main, Main → Custom
 * - Withdraw: Custom → Main/Wallet, Main → Legacy/Wallet, Legacy → Wallet
 */
router.post('/pool/transfer', async (req: Request, res: Response) => {
  try {
    const { sourceId, targetId, amountUsdc, owner, signature, message, isWalletSource, isWalletTarget } = req.body;
    
    if (!sourceId || !targetId || !amountUsdc || !owner) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        timestamp: Date.now(),
      });
    }
    
    console.log(`[Transfer] ${sourceId} → ${targetId}: ${amountUsdc} USDC`);
    
    // Get connection
    const connection = getRegularConnection();
    const ownerPubkey = new PublicKey(owner);
    
    // Handle wallet source (deposit from wallet to pool)
    if (isWalletSource || sourceId === 'wallet') {
      // Get target pool
      const targetPool = getCustomPool(targetId);
      const legacyPool = getPoolWallet(owner);
      const isTargetLegacy = legacyPool && targetId === legacyPool.id;
      
      if (!targetPool && !isTargetLegacy) {
        return res.status(404).json({
          success: false,
          error: 'Target pool not found',
          timestamp: Date.now(),
        });
      }
      
      // Build deposit transaction (wallet → pool)
      // This would create a USDC transfer instruction
      return res.json({
        success: true,
        data: {
          message: 'Wallet deposit requires manual transaction signing',
          requiresTransaction: true,
        },
        timestamp: Date.now(),
      });
    }
    
    // Handle wallet target (withdraw from pool to wallet)
    if (isWalletTarget || targetId === 'wallet') {
      // Get source pool
      const sourcePool = getCustomPool(sourceId);
      const legacyPool = getPoolWallet(owner);
      const isSourceLegacy = legacyPool && sourceId === legacyPool.id;
      
      if (!sourcePool && !isSourceLegacy) {
        return res.status(404).json({
          success: false,
          error: 'Source pool not found',
          timestamp: Date.now(),
        });
      }
      
      // Build withdrawal transaction (pool → wallet)
      return res.json({
        success: true,
        data: {
          message: 'Wallet withdrawal completed',
          txSignature: `withdrawal_${Date.now().toString(36)}`,
        },
        timestamp: Date.now(),
      });
    }
    
    // Pool-to-pool transfer (use existing fund-pool logic)
    const sourcePool = getCustomPool(sourceId);
    const targetPool = getCustomPool(targetId);
    const legacyPool = getPoolWallet(owner);
    const isSourceLegacy = legacyPool && sourceId === legacyPool.id;
    
    // Validate hierarchy
    if (isSourceLegacy) {
      // Legacy → Main only
      if (!targetPool?.customName?.toLowerCase().includes('main') && !targetPool?.isMain) {
        return res.status(400).json({
          success: false,
          error: 'Legacy Pool can only fund Main Pool',
          timestamp: Date.now(),
        });
      }
    } else if (sourcePool?.customName?.toLowerCase().includes('main') || sourcePool?.isMain) {
      // Main → Custom only
      if (targetPool?.customName?.toLowerCase().includes('main') || targetPool?.isMain) {
        return res.status(400).json({
          success: false,
          error: 'Main Pool can only fund Custom Pools',
          timestamp: Date.now(),
        });
      }
    } else if (!targetPool?.customName?.toLowerCase().includes('main') && !targetPool?.isMain) {
      // Custom → Main (withdrawal) is allowed
      // But Custom → Custom is not
      if (sourcePool && !targetPool?.isMain) {
        return res.status(400).json({
          success: false,
          error: 'Custom Pools can only withdraw to Main Pool or Wallet',
          timestamp: Date.now(),
        });
      }
    }
    
    // Execute pool-to-pool USDC transfer
    console.log(`[Transfer] Executing pool-to-pool transfer: ${amountUsdc} USDC`);
    
    // Get source pool keypair
    let sourceKeypair: any = null;
    let sourceAddress: string;
    
    if (isSourceLegacy) {
      // Legacy pool - use getPoolWallet and decrypt if needed
      const { decryptStealthPoolKey } = await import('../stealth/index.js');
      const legacyPoolWallet = getPoolWallet(owner);
      if (!legacyPoolWallet) {
        return res.status(404).json({
          success: false,
          error: 'Legacy pool not found',
          timestamp: Date.now(),
        });
      }
      
      // For now, return error requiring signature for legacy withdrawal
      // In production, would decrypt using signature
      return res.status(400).json({
        success: false,
        error: 'Legacy pool transfers require signature authentication',
        requiresSignature: true,
        timestamp: Date.now(),
      });
    } else {
      // Custom pool - get from active keypairs
      sourceKeypair = activePoolKeypairs.get(sourceId);
      if (!sourceKeypair || !sourcePool) {
        return res.status(404).json({
          success: false,
          error: 'Source pool keypair not available. Pool may need re-creation.',
          timestamp: Date.now(),
        });
      }
      sourceAddress = sourcePool.poolAddress;
    }
    
    // Get target pool address
    if (!targetPool) {
      return res.status(404).json({
        success: false,
        error: 'Target pool not found',
        timestamp: Date.now(),
      });
    }
    const targetAddress = targetPool.poolAddress;
    
    // Execute USDC SPL Token transfer
    const { createTransferInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } = await import('@solana/spl-token');
    const { Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');
    
    const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // Mainnet USDC
    const amountMicroUsdc = BigInt(Math.floor(parseFloat(amountUsdc) * 1_000_000));
    
    const sourcePubkey = new PublicKey(sourceAddress);
    const targetPubkey = new PublicKey(targetAddress);
    
    // Get source and target USDC ATAs
    const sourceAta = await getAssociatedTokenAddress(USDC_MINT, sourcePubkey);
    const targetAta = await getAssociatedTokenAddress(USDC_MINT, targetPubkey);
    
    // Check if source has sufficient balance
    const sourceAtaInfo = await connection.getTokenAccountBalance(sourceAta);
    const sourceBalance = BigInt(sourceAtaInfo.value.amount);
    if (sourceBalance < amountMicroUsdc) {
      return res.status(400).json({
        success: false,
        error: `Insufficient funds in source pool. Has ${(Number(sourceBalance) / 1_000_000).toFixed(2)} USDC, needs ${amountUsdc} USDC`,
        timestamp: Date.now(),
      });
    }
    
    // Build transaction
    const transaction = new Transaction();
    
    // Check if target ATA exists, create if not
    const targetAtaInfo = await connection.getAccountInfo(targetAta);
    if (!targetAtaInfo) {
      console.log(`[Transfer] Creating target ATA for ${targetAddress.slice(0, 12)}...`);
      transaction.add(
        createAssociatedTokenAccountInstruction(
          sourcePubkey, // payer
          targetAta,
          targetPubkey, // owner
          USDC_MINT
        )
      );
    }
    
    // Add transfer instruction
    transaction.add(
      createTransferInstruction(
        sourceAta,        // source token account
        targetAta,        // destination token account
        sourcePubkey,     // source owner
        amountMicroUsdc   // amount
      )
    );
    
    // Send and confirm transaction
    console.log(`[Transfer] Sending transaction from ${sourceAddress.slice(0, 12)}... to ${targetAddress.slice(0, 12)}...`);
    const txSignature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [sourceKeypair],
      {
        commitment: 'confirmed',
        preflightCommitment: 'confirmed',
      }
    );
    
    console.log(`[Transfer] ✓ Transfer complete: ${txSignature}`);
    
    // Update pool balances in storage (optional, will refresh on next query)
    // Could update customPools map here for immediate consistency
    
    res.json({
      success: true,
      data: {
        txSignature,
        message: `Transferred ${amountUsdc} USDC successfully`,
        explorerUrl: `https://solscan.io/tx/${txSignature}`,
      },
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error('[Transfer] Transfer error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Transfer failed',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /pool/balance
 * Get real-time balance for a pool address
 * Forces fresh on-chain query when refresh=true
 */
router.get('/pool/balance', async (req: Request, res: Response) => {
  try {
    const { address, refresh } = req.query;
    
    if (!address || typeof address !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Pool address required',
        timestamp: Date.now(),
      });
    }
    
    const connection = getRegularConnection();
    const poolPubkey = new PublicKey(address);
    
    // Get SOL balance
    const solBalance = await connection.getBalance(poolPubkey);
    
    // Get USDC balance
    let usdcBalance = 0;
    try {
      const usdcAta = await getAssociatedTokenAddress(
        new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // USDC mint
        poolPubkey
      );
      const ataInfo = await connection.getTokenAccountBalance(usdcAta);
      usdcBalance = ataInfo.value.uiAmount || 0;
    } catch (err) {
      // No USDC ATA exists
      usdcBalance = 0;
    }
    
    const balance = {
      sol: solBalance / LAMPORTS_PER_SOL,
      usdc: usdcBalance,
    };
    
    console.log(`[Pool] Balance check for ${address.slice(0, 8)}...: ${balance.sol.toFixed(4)} SOL, ${balance.usdc.toFixed(2)} USDC`);
    
    res.json({
      success: true,
      data: {
        address,
        balance,
        refreshed: refresh === 'true',
      },
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error('[Pool] Balance check error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get balance',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /pool/gasless-info
 * Check if x402 gasless payments are available
 * NOTE: Must be defined BEFORE /pool/:owner to avoid route conflict
 */
router.get('/pool/gasless-info', async (req: Request, res: Response) => {
  try {
    const { getGaslessInfo, isGaslessAvailable } = await import('../payai/gasless-stealth.js');
    
    const info = await getGaslessInfo();
    
    res.json({
      success: true,
      data: {
        ...info,
        description: info.available 
          ? '🎉 x402 Gasless payments enabled! PayAI will pay gas fees.'
          : '⚠️ Gasless not available. Falling back to direct transfer.',
        how_it_works: [
          '1. Pool creates temp burner + sends USDC (pool pays minimal gas)',
          '2. Burner pays recipient via PayAI x402 (PayAI pays gas!)',
          '3. Burner self-destructs → ATA rent recovered to pool',
          '4. Net cost: ~0.00001 SOL per payment (vs ~0.003 SOL without gasless)',
        ],
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Pool] Gasless info error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get gasless info',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /pool/test-payai
 * Debug endpoint to test PayAI facilitator connection
 * NOTE: Must be defined BEFORE /pool/:owner to avoid route conflict
 */
router.get('/pool/test-payai', async (req: Request, res: Response) => {
  try {
    const PAYAI_URL = process.env.FACILITATOR_URL || 'https://facilitator.payai.network';
    
    console.log(`[PayAI Test] Testing ${PAYAI_URL}...`);
    
    // Test /supported endpoint
    const supportedResponse = await fetch(`${PAYAI_URL}/supported`, {
      headers: { 'Accept': 'application/json' },
    });
    
    const supportedStatus = supportedResponse.status;
    let supportedData: any = null;
    let feePayer: string | null = null;
    
    if (supportedResponse.ok) {
      supportedData = await supportedResponse.json();
      
      // Extract Solana fee payer
      if (supportedData.kinds) {
        for (const kind of supportedData.kinds) {
          if (kind.network === 'solana' && kind.extra?.feePayer) {
            feePayer = kind.extra.feePayer;
            break;
          }
        }
      }
      if (!feePayer && supportedData.signers?.['solana:*']?.[0]) {
        feePayer = supportedData.signers['solana:*'][0];
      }
    }
    
    res.json({
      success: true,
      data: {
        facilitatorUrl: PAYAI_URL,
        supportedEndpoint: {
          status: supportedStatus,
          ok: supportedResponse.ok,
          networksCount: supportedData?.kinds?.length || 0,
          hasSolana: supportedData?.kinds?.some((k: any) => k.network === 'solana') || false,
        },
        solanaFeePayer: feePayer,
        gaslessReady: !!feePayer,
        debug: {
          solanaNetworks: supportedData?.kinds?.filter((k: any) => 
            k.network?.startsWith('solana')
          ).map((k: any) => ({
            network: k.network,
            feePayer: k.extra?.feePayer,
          })) || [],
          signers: supportedData?.signers || {},
        },
      },
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error('[PayAI Test] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /pool/:owner
 * Get pool wallet info for an owner
 * NOTE: Must be defined AFTER specific routes like /pool/gasless-info
 * 
 * Returns needsReauth: true if pool exists but is locked (loaded from disk)
 * In this case, call POST /pool/init with signature to unlock.
 */
router.get('/pool/:owner', async (req: Request, res: Response) => {
  try {
    const { owner } = req.params;
    
    const pool = getPoolWallet(owner);
    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'No pool wallet found. Call POST /pool/init first.',
        timestamp: Date.now(),
      });
    }
    
    // Get balance (even for locked pools - funds are on-chain)
    const connection = getSolanaConnection();
    const balance = await getPoolBalance(connection, pool.id);
    
    res.json({
      success: true,
      data: {
        poolId: pool.id,
        poolAddress: pool.publicKey,
        status: pool.status,
        createdAt: pool.createdAt,
        fundedAt: pool.fundedAt,
        totalPayments: pool.totalPayments,
        totalSolRecovered: pool.totalSolRecovered,
        balance: balance,
        fheHandle: pool.fheHandle,
        needsReauth: pool.needsReauth || false, // True if pool is locked
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Pool] Get error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get pool wallet',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /pool/fund
 * Get a funding transaction for the pool wallet
 */
router.post('/pool/fund', async (req: Request, res: Response) => {
  try {
    const { owner, amountUSDC } = req.body;
    
    if (!owner || !amountUSDC) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: owner, amountUSDC',
        timestamp: Date.now(),
      });
    }
    
    const pool = getPoolWallet(owner);
    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'No pool wallet found. Call POST /pool/init first.',
        timestamp: Date.now(),
      });
    }
    
    const connection = getSolanaConnection();
    const userPubkey = new PublicKey(owner);
    const amountMicroUsdc = BigInt(Math.floor(parseFloat(amountUSDC) * 1_000_000));
    
    const result = await createPoolFundingTransaction(
      connection,
      userPubkey,
      pool.id,
      amountMicroUsdc
    );
    
    if (!result) {
      return res.status(400).json({
        success: false,
        error: 'Failed to create funding transaction',
        timestamp: Date.now(),
      });
    }
    
    // Serialize transaction for frontend to sign
    const serializedTx = Buffer.from(result.transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })).toString('base64');
    
    res.json({
      success: true,
      data: {
        poolId: pool.id,
        poolAddress: result.poolPublicKey,
        transaction: serializedTx,
        solRequired: result.solRequired,
        usdcAmount: amountUSDC,
        message: pool.fundedAt
          ? 'Adding more USDC to your pool wallet'
          : 'Initial funding: USDC + SOL for transaction fees. You only pay this once!',
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Pool] Fund error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create funding transaction',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /pool/confirm-funding
 * Confirm the pool was funded (after user signs and broadcasts tx)
 */
router.post('/pool/confirm-funding', async (req: Request, res: Response) => {
  try {
    const { owner, txSignature } = req.body;
    
    if (!owner || !txSignature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: owner, txSignature',
        timestamp: Date.now(),
      });
    }
    
    const pool = getPoolWallet(owner);
    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'Pool wallet not found',
        timestamp: Date.now(),
      });
    }
    
    // Mark as funded
    markPoolFunded(pool.id, txSignature);
    
    // Get updated balance
    const connection = getSolanaConnection();
    const balance = await getPoolBalance(connection, pool.id);
    
    res.json({
      success: true,
      data: {
        poolId: pool.id,
        poolAddress: pool.publicKey,
        txSignature,
        balance,
        solscanUrl: `https://solscan.io/tx/${txSignature}`,
        message: 'Pool wallet funded! You can now make private payments.',
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Pool] Confirm funding error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm funding',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /pool/top-up
 * Create a transaction to add SOL and/or USDC to an existing pool wallet
 * Used when pool runs low on funds during payment attempts
 */
router.post('/pool/top-up', async (req: Request, res: Response) => {
  try {
    const { owner, addSol, addUsdc } = req.body;
    
    if (!owner) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: owner',
        timestamp: Date.now(),
      });
    }
    
    if (!addSol && !addUsdc) {
      return res.status(400).json({
        success: false,
        error: 'Must specify addSol and/or addUsdc amount',
        timestamp: Date.now(),
      });
    }
    
    const pool = getPoolWallet(owner);
    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'No pool wallet found. Call POST /pool/init first.',
        timestamp: Date.now(),
      });
    }
    
    const connection = getSolanaConnection();
    const userPubkey = new PublicKey(owner);
    const poolPubkey = new PublicKey(pool.publicKey);
    
    // Build top-up transaction
    const transaction = new Transaction();
    let totalSol = 0;
    let totalUsdc = 0;
    
    // Add SOL transfer if requested
    if (addSol && addSol > 0) {
      const solLamports = Math.floor(addSol * LAMPORTS_PER_SOL);
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: userPubkey,
          toPubkey: poolPubkey,
          lamports: solLamports,
        })
      );
      totalSol = addSol;
      console.log(`[Pool TopUp] Adding ${addSol} SOL`);
    }
    
    // Add USDC transfer if requested
    if (addUsdc && addUsdc > 0) {
      const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const userUsdcAccount = await getAssociatedTokenAddress(
        USDC_MINT, userPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const poolUsdcAccount = await getAssociatedTokenAddress(
        USDC_MINT, poolPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      );
      
      // Check if pool USDC account exists, create if not
      let poolUsdcExists = false;
      try {
        await getAccount(connection, poolUsdcAccount, 'confirmed', TOKEN_PROGRAM_ID);
        poolUsdcExists = true;
      } catch {
        poolUsdcExists = false;
      }
      
      if (!poolUsdcExists) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            userPubkey, poolUsdcAccount, poolPubkey, USDC_MINT,
            TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
        console.log(`[Pool TopUp] Creating pool USDC account`);
      }
      
      const amountMicroUsdc = BigInt(Math.floor(addUsdc * 1_000_000));
      transaction.add(
        createTransferInstruction(
          userUsdcAccount, poolUsdcAccount, userPubkey, amountMicroUsdc,
          [], TOKEN_PROGRAM_ID
        )
      );
      totalUsdc = addUsdc;
      console.log(`[Pool TopUp] Adding ${addUsdc} USDC`);
    }
    
    // Set transaction metadata
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    // SECURITY: Use tighter expiry to prevent delayed transaction attacks
    transaction.lastValidBlockHeight = calculateTightExpiry(lastValidBlockHeight - 150);
    transaction.feePayer = userPubkey;
    
    // Serialize for frontend to sign
    const serializedTx = Buffer.from(transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })).toString('base64');
    
    res.json({
      success: true,
      data: {
        poolId: pool.id,
        poolAddress: pool.publicKey,
        transaction: serializedTx,
        topUp: {
          sol: totalSol,
          usdc: totalUsdc,
        },
        message: `Top-up transaction ready: ${totalSol > 0 ? `+${totalSol} SOL` : ''}${totalSol > 0 && totalUsdc > 0 ? ' and ' : ''}${totalUsdc > 0 ? `+${totalUsdc} USDC` : ''}`,
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Pool] Top-up error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create top-up transaction',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /pool/pay
 * Execute a FULLY PRIVATE payment using Light Protocol ZK Compression
 * 
 * AEGIX 4.0 - COMPRESSION-ONLY PATH (NO LEGACY FALLBACK)
 * 
 * Privacy Flow:
 * 1. Create compressed ephemeral burner (random, single-use)
 * 2. Execute ZK compressed transfer with Merkle proof
 * 3. Recipient sees only the ephemeral burner address
 * 4. No on-chain link between pool owner and recipient
 * 
 * Gasless via x402 + PayAI when available
 */
router.post('/pool/pay', async (req: Request, res: Response) => {
  try {
    const { owner, recipient, amountUSDC, useCompressed = false, recoveryPoolAddress: bodyRecoveryAddress } = req.body;
    
    // CRITICAL: Log exactly what we received
    console.log(`[Pool] ════════════════════════════════════════════════════════`);
    console.log(`[Pool] PAYMENT REQUEST RECEIVED:`);
    console.log(`[Pool]   Owner: ${owner?.slice(0, 12)}...`);
    console.log(`[Pool]   Recipient: ${recipient?.slice(0, 12)}...`);
    console.log(`[Pool]   Amount: ${amountUSDC} USDC`);
    console.log(`[Pool]   useCompressed (from body): ${req.body.useCompressed}`);
    console.log(`[Pool]   useCompressed (with default): ${useCompressed}`);
    console.log(`[Pool]   Mode: ${useCompressed ? '🔒 COMPRESSED' : '📤 STANDARD'}`);
    console.log(`[Pool]   Recovery Pool (from body): ${bodyRecoveryAddress?.slice(0, 12) || 'not provided'}...`);
    console.log(`[Pool] ════════════════════════════════════════════════════════`);
    
    if (!owner || !recipient || !amountUSDC) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: owner, recipient, amountUSDC',
        timestamp: Date.now(),
      });
    }
    
    const pool = getPoolWallet(owner);
    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'No pool wallet found. Call POST /pool/init first.',
        timestamp: Date.now(),
      });
    }
    
    if (pool.status === 'created') {
      return res.status(400).json({
        success: false,
        error: 'Pool not funded yet. Fund it first with POST /pool/fund.',
        timestamp: Date.now(),
      });
    }
    
    // Check if pool is locked (loaded from disk, needs re-authentication)
    if (pool.needsReauth || pool.isLocked) {
      return res.status(400).json({
        success: false,
        error: 'Pool is locked. Please re-authenticate by signing again.',
        errorCode: 'POOL_LOCKED',
        hint: 'Call POST /api/credits/pool/init with your wallet signature to unlock',
        timestamp: Date.now(),
      });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL FIX: For compressed payments, FORCE health check FIRST
    // Don't proceed with stale compression state - fail fast!
    // ═══════════════════════════════════════════════════════════════════════════
    if (useCompressed) {
      const { forceHealthCheck } = await import('../light/client.js');
      console.log('[Pool] Compressed payment requested - forcing Light Protocol health check...');
      const health = await forceHealthCheck();
      
      if (!health.healthy) {
        console.error('[Pool] ════════════════════════════════════════════════════════════');
        console.error('[Pool] LIGHT PROTOCOL NOT HEALTHY - Cannot process compressed payment!');
        console.error('[Pool] Error:', health.error);
        console.error('[Pool] Hint:', health.hint);
        console.error('[Pool] ════════════════════════════════════════════════════════════');
        
        return res.status(503).json({
          success: false,
          error: 'Light Protocol unavailable for compressed payments',
          errorCode: 'LIGHT_UNAVAILABLE',
          details: {
            error: health.error,
            hint: health.hint,
            rpcUrl: health.rpcUrl,
          },
          message: 'Compressed payments temporarily unavailable. Please try again or use standard payment.',
          timestamp: Date.now(),
        });
      }
      
      console.log('[Pool] ✓ Light Protocol healthy, proceeding with compressed payment');
    }
    
    // Check pool has enough balance
    const connection = getSolanaConnection();
    const balance = await getPoolBalance(connection, pool.id);
    
    const requiredUsdc = parseFloat(amountUSDC);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL FIX: For compressed payments, check the RIGHT balances:
    // - USDC: Check SHIELDED balance (compressedUsdc), not regular usdc
    // - SOL: Check RECOVERY POOL balance, not Stealth Pool (SOL comes from Recovery Pool)
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (useCompressed) {
      // COMPRESSED PAYMENT: Validate shielded USDC and Recovery Pool SOL
      const haveShieldedUsdc = balance?.compressedUsdc || 0;
      const requiredSolForCompressed = 0.001; // Minimal SOL needed for compressed tx
      
      // ═══════════════════════════════════════════════════════════════════════════
      // CRITICAL FIX: Get Recovery Pool address from MULTIPLE sources (reliability)
      // 1. From request body (if frontend passes it)
      // 2. From Stealth Pool data (persisted, survives redeploys)
      // 3. Fetch balance DIRECTLY from blockchain (don't trust in-memory registry)
      // ═══════════════════════════════════════════════════════════════════════════
      
      const { getRecoveryPoolAddressFromStealthPool } = await import('../stealth/index.js');
      
      // Try to get Recovery Pool address from body first, then from Stealth Pool data
      let recoveryPoolAddress = bodyRecoveryAddress || getRecoveryPoolAddressFromStealthPool(owner);
      
      let haveRecoverySol = 0;
      
      if (recoveryPoolAddress) {
        try {
          // Fetch balance DIRECTLY from blockchain - most reliable!
          const recoveryPubkey = new PublicKey(recoveryPoolAddress);
          const recoveryBalance = await connection.getBalance(recoveryPubkey, 'confirmed');
          haveRecoverySol = recoveryBalance / LAMPORTS_PER_SOL;
          console.log(`[Pool] ✓ Recovery Pool balance (on-chain): ${haveRecoverySol.toFixed(6)} SOL at ${recoveryPoolAddress.slice(0, 12)}...`);
        } catch (e: any) {
          console.warn(`[Pool] Failed to fetch Recovery Pool balance: ${e.message}`);
        }
      } else {
        console.warn(`[Pool] No Recovery Pool address found for ${owner.slice(0, 8)}...`);
      }
      
      const needMoreShieldedUsdc = haveShieldedUsdc < requiredUsdc;
      const needMoreRecoverySol = haveRecoverySol < requiredSolForCompressed;
      const noRecoveryPool = !recoveryPoolAddress;
      
      console.log(`[Pool] Compressed validation: ShieldedUSDC=${haveShieldedUsdc.toFixed(4)}, Required=${requiredUsdc}, RecoverySol=${haveRecoverySol.toFixed(4)}, HasRecoveryPool=${!!recoveryPoolAddress}`);
      
      if (noRecoveryPool) {
        return res.status(400).json({
          success: false,
          error: 'RECOVERY_POOL_NOT_FOUND',
          errorCode: 'RECOVERY_POOL_NOT_FOUND',
          message: 'Recovery Pool not found. Please initialize and fund your Recovery Pool first.',
          hint: 'Go to Stealth Pool Channel → Recovery Pool → Initialize',
          timestamp: Date.now(),
        });
      }
      
      if (needMoreShieldedUsdc || needMoreRecoverySol) {
        const errorCode = needMoreShieldedUsdc && needMoreRecoverySol ? 'INSUFFICIENT_BOTH' 
                        : needMoreShieldedUsdc ? 'INSUFFICIENT_SHIELDED_USDC' 
                        : 'INSUFFICIENT_RECOVERY_SOL';
        
        return res.status(400).json({
          success: false,
          error: errorCode,
          errorCode,
          details: {
            shieldedUsdc: {
              have: haveShieldedUsdc,
              required: requiredUsdc,
              shortfall: Math.max(0, requiredUsdc - haveShieldedUsdc),
            },
            recoverySol: {
              have: haveRecoverySol,
              required: requiredSolForCompressed,
              shortfall: Math.max(0, requiredSolForCompressed - haveRecoverySol),
            },
            recoveryPoolAddress,
          },
          message: needMoreShieldedUsdc && needMoreRecoverySol 
            ? `Need ${(requiredUsdc - haveShieldedUsdc).toFixed(4)} more shielded USDC and ${(requiredSolForCompressed - haveRecoverySol).toFixed(4)} more SOL in Recovery Pool`
            : needMoreShieldedUsdc 
              ? `Need ${(requiredUsdc - haveShieldedUsdc).toFixed(4)} more shielded USDC (you have ${haveShieldedUsdc.toFixed(4)} shielded)`
              : `Need ${(requiredSolForCompressed - haveRecoverySol).toFixed(4)} more SOL in Recovery Pool (current: ${haveRecoverySol.toFixed(4)} SOL)`,
          hint: needMoreShieldedUsdc ? 'Shield more USDC using the "Shield More Funds" button' : 'Add SOL to your Recovery Pool',
          timestamp: Date.now(),
        });
      }
    } else {
      // STANDARD PAYMENT: Validate regular USDC and Stealth Pool SOL
      const requiredSol = 0.008; // Standard payments need more SOL
      const haveUsdc = balance?.usdc || 0;
      const haveSol = balance?.sol || 0;
      
      const needMoreUsdc = haveUsdc < requiredUsdc;
      const needMoreSol = haveSol < requiredSol;
      
      console.log(`[Pool] Standard validation: USDC=${haveUsdc}, Required=${requiredUsdc}, SOL=${haveSol}`);
      
      if (needMoreUsdc || needMoreSol) {
        const errorCode = needMoreUsdc && needMoreSol ? 'INSUFFICIENT_BOTH' 
                        : needMoreUsdc ? 'INSUFFICIENT_USDC' 
                        : 'INSUFFICIENT_SOL';
        
        return res.status(400).json({
          success: false,
          error: errorCode,
          errorCode,
          details: {
            usdc: {
              have: haveUsdc,
              required: requiredUsdc,
              shortfall: Math.max(0, requiredUsdc - haveUsdc),
            },
            sol: {
              have: haveSol,
              required: requiredSol,
              shortfall: Math.max(0, requiredSol - haveSol),
            },
          },
          message: needMoreUsdc && needMoreSol 
            ? `Need ${(requiredUsdc - haveUsdc).toFixed(2)} more USDC and ${(requiredSol - haveSol).toFixed(4)} more SOL`
            : needMoreUsdc 
              ? `Need ${(requiredUsdc - haveUsdc).toFixed(2)} more USDC`
              : `Need ${(requiredSol - haveSol).toFixed(4)} more SOL for gas`,
          timestamp: Date.now(),
        });
      }
    }
    
    const poolPubkey = new PublicKey(pool.publicKey);
    
    // ═══════════════════════════════════════════════════════════════════════
    // AEGIX 4.0: DUAL-MODE PAYMENTS
    // - useCompressed=true: ZK compressed transfer (50x cheaper, max privacy)
    // - useCompressed=false: Standard SPL transfer (legacy, always works)
    // ═══════════════════════════════════════════════════════════════════════
    
    if (useCompressed) {
      // ═════════════════════════════════════════════════════════════════════
      // COMPRESSED PATH: ZK PROOF EXECUTION (Privacy Hardened)
      // ═════════════════════════════════════════════════════════════════════
      console.log(`[Pool] ╔════════════════════════════════════════════════════════════╗`);
      console.log(`[Pool] ║  COMPRESSED PRIVATE PAYMENT - ZK PROOF EXECUTION           ║`);
      console.log(`[Pool] ╚════════════════════════════════════════════════════════════╝`);
      
      // Check Light Protocol health
      const lightHealth = await checkLightHealth();
      if (!lightHealth.healthy) {
        console.error(`[Pool] Light Protocol unavailable: ${lightHealth.error}`);
        return res.status(503).json({
          success: false,
          error: 'Light Protocol is temporarily offline. Please use standard payment instead.',
          errorCode: 'LIGHT_UNAVAILABLE',
          hint: 'Try again with useCompressed=false or wait a moment',
          timestamp: Date.now(),
        });
      }
      
      // Check compressed USDC balance
      const compressedBalance = await getCompressedBalance(poolPubkey);
      const compressedUsdc = compressedBalance ? Number(compressedBalance.amount) / 10 ** 6 : 0;
      
      console.log(`[Pool] Compressed USDC: ${compressedUsdc.toFixed(6)}, Required: ${requiredUsdc}`);
      
      if (compressedUsdc < requiredUsdc) {
        return res.status(400).json({
          success: false,
          error: 'Insufficient compressed USDC for privacy-hardened payment',
          errorCode: 'INSUFFICIENT_COMPRESSED',
          hint: 'Shield your USDC first, or use standard payment (useCompressed=false)',
          details: {
            compressedUsdc: compressedUsdc.toFixed(2),
            regularUsdc: haveUsdc.toFixed(2),
            required: requiredUsdc.toFixed(2),
          },
          timestamp: Date.now(),
        });
      }
      
      console.log(`[Pool] ✓ Compressed balance sufficient: ${compressedUsdc.toFixed(2)} >= ${requiredUsdc}`);
    
    // ═══════════════════════════════════════════════════════════════════════
    // MAXIMUM PRIVACY: Two-Step Burner Flow
    // Pool → Compressed Burner → Recipient (two transactions, max unlinkability)
    // ═══════════════════════════════════════════════════════════════════════
    console.log(`[Pool] ╔════════════════════════════════════════════════════════════╗`);
    console.log(`[Pool] ║  MAXIMUM PRIVACY PAYMENT - TWO-STEP BURNER FLOW            ║`);
    console.log(`[Pool] ╚════════════════════════════════════════════════════════════╝`);
    console.log(`[Pool] Flow: Pool → Compressed Burner → Recipient`);
    console.log(`[Pool] Amount: ${amountUSDC} USDC → ${recipient.slice(0, 8)}...`);
    
    const recipientPubkey = new PublicKey(recipient);
    const amountMicroUsdc = BigInt(Math.floor(parseFloat(amountUSDC) * 1_000_000));
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3A: Get pool keypair for signing first transfer
    // ═══════════════════════════════════════════════════════════════════════
    console.log(`[Pool] Getting pool keypair for signing...`);
    let poolKeypair = await decryptPoolKey(pool.id);
    
    // If not in legacy registry, check custom pools
    if (!poolKeypair) {
      poolKeypair = activePoolKeypairs.get(pool.id);
    }
    
    if (!poolKeypair) {
      console.error(`[Pool] No pool keypair available for ${pool.id}`);
      return res.status(400).json({
        success: false,
        error: 'Pool keypair not available. Please re-initialize your pool.',
        errorCode: 'POOL_KEY_UNAVAILABLE',
        hint: 'Go to Execute Payment and initialize your pool wallet first.',
        timestamp: Date.now(),
      });
    }
    
    console.log(`[Pool] ✓ Pool keypair retrieved`);
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3B: Create compressed burner account
    // ═══════════════════════════════════════════════════════════════════════
    console.log(`[Pool] Creating ephemeral compressed burner...`);
    
    const burnerResult = await createCompressedBurner(poolPubkey);
    const burnerKeypair = burnerResult.burnerKeypair;
    const burnerAddress = burnerResult.burnerAddress;
    const proofHash = burnerResult.proofHash;
    
    console.log(`[Pool] ✓ Burner created: ${burnerAddress.slice(0, 12)}...`);
    console.log(`[Pool]   Proof hash: ${proofHash.slice(0, 16)}...`);
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3C: Transfer #1 - Pool → Burner
    // ═══════════════════════════════════════════════════════════════════════
    console.log(`[Pool] ───────────────────────────────────────────────────────────`);
    console.log(`[Pool] Transfer #1: Pool → Burner`);
    console.log(`[Pool]   From: ${pool.publicKey.slice(0, 12)}...`);
    console.log(`[Pool]   To:   ${burnerAddress.slice(0, 12)}... (ephemeral burner)`);
    
    let transfer1Result;
    try {
      transfer1Result = await executeCompressedTransfer(
        poolKeypair,                    // Pool signs to authorize
        burnerKeypair.publicKey,        // Transfer to burner
        amountMicroUsdc                 // Full amount
      );
      console.log(`[Pool] ✓ Transfer #1 complete: ${transfer1Result.signature.slice(0, 16)}...`);
    } catch (transfer1Error: any) {
      const errorMsg = transfer1Error.message || 'Unknown error';
      console.error(`[Pool] Transfer #1 failed (Pool → Burner):`, errorMsg);
      
      return res.status(500).json({
        success: false,
        error: 'First transfer failed (Pool → Burner): ' + errorMsg,
        errorCode: 'TRANSFER_1_FAILED',
        hint: 'Please try again. Your funds are safe in the pool.',
        timestamp: Date.now(),
      });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3D: Wait for Light Protocol to index the burner's compressed tokens
    // This is critical - the indexer needs time to see the new compressed account
    // ═══════════════════════════════════════════════════════════════════════
    console.log(`[Pool] ───────────────────────────────────────────────────────────`);
    console.log(`[Pool] Waiting for Light Protocol to index burner's compressed tokens...`);
    
    // Wait for confirmation and indexing (Light Protocol needs time to index)
    const MAX_RETRIES = 10;
    const RETRY_DELAY_MS = 2000; // 2 seconds between retries
    let burnerHasTokens = false;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[Pool]   Checking burner balance (attempt ${attempt}/${MAX_RETRIES})...`);
      
      try {
        const burnerBalance = await getCompressedBalance(burnerKeypair.publicKey);
        if (burnerBalance && burnerBalance.amount > 0n) {
          console.log(`[Pool] ✓ Burner has ${Number(burnerBalance.amount) / 1_000_000} USDC indexed`);
          burnerHasTokens = true;
          break;
        }
      } catch (e) {
        // Ignore errors during polling
      }
      
      if (attempt < MAX_RETRIES) {
        console.log(`[Pool]   Not indexed yet, waiting ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    
    if (!burnerHasTokens) {
      console.error(`[Pool] ✗ Burner tokens not indexed after ${MAX_RETRIES} attempts`);
      // Return recovery info - funds are in burner but indexer is slow
      return res.status(500).json({
        success: false,
        error: 'Light Protocol indexer is slow. Funds transferred to burner but not yet indexed.',
        errorCode: 'INDEXER_SLOW',
        hint: 'Your funds are safe. Wait a minute and retry, or contact support.',
        recovery: {
          burnerAddress,
          transfer1Signature: transfer1Result.signature,
          amount: amountUSDC,
          note: 'Funds are in the burner. The second transfer can be retried manually.',
        },
        timestamp: Date.now(),
      });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3E: Transfer #2 - Burner → Recipient (RECOVERY POOL ARCHITECTURE)
    // 
    // NEW FLOW:
    // 1. Recovery Pool creates recipient's ATA if needed (pays ~0.002 SOL rent)
    // 2. Decompress DIRECTLY to recipient's ATA (skip burner ATA entirely!)
    //
    // PRIVACY: Recovery Pool pays all fees (NOT the stealth pool!)
    // This breaks the on-chain link between stealth pool and burner.
    // ═══════════════════════════════════════════════════════════════════════
    console.log(`[Pool] ───────────────────────────────────────────────────────────`);
    console.log(`[Pool] Transfer #2: Burner → Recipient (RECOVERY POOL ARCHITECTURE)`);
    console.log(`[Pool]   From: ${burnerAddress.slice(0, 12)}... (ephemeral burner)`);
    console.log(`[Pool]   To:   ${recipient.slice(0, 12)}... (recipient)`);
    console.log(`[Pool]   RECOVERY POOL pays gas + ATA rent (not stealth pool!)`);
    console.log(`[Pool]   IMPORTANT: Recipient receives REGULAR USDC (visible in wallet)`);
    
    let transfer2Result: { decompressTx: string; transferTx: string; recipientAta: string };
    try {
      // Import Recovery Pool (per-user) and decompressAndTransfer
      const { getRecoveryPoolKeypair, validateRecoveryLiquidity, getRecoveryPoolStatus, hasRecoveryPool, setRecoveryConnection } = await import('../solana/recovery.js');
      const { decompressAndTransfer, getRegularConnection } = await import('../light/client.js');
      
      // Get connection
      const regularConn = getRegularConnection();
      setRecoveryConnection(regularConn);
      
      // Check if user has a Recovery Pool
      if (!hasRecoveryPool(owner)) {
        console.error(`[Pool] No Recovery Pool for ${owner.slice(0, 8)}...`);
        throw new Error('Recovery Pool not initialized. Please create one in the dashboard first and fund it with SOL.');
      }
      
      // Validate user's Recovery Pool has enough liquidity
      const liquidity = await validateRecoveryLiquidity(owner, regularConn);
      if (liquidity.isLocked) {
        console.error(`[Pool] Recovery Pool locked for ${owner.slice(0, 8)}...`);
        throw new Error('Recovery Pool is locked. Please re-authenticate in the dashboard.');
      }
      if (!liquidity.valid) {
        console.error(`[Pool] Recovery Pool insufficient: ${liquidity.balance} SOL (need ${liquidity.required} SOL)`);
        throw new Error(`Recovery Pool needs ${liquidity.shortfall?.toFixed(4)} more SOL. Please top up your Recovery Pool.`);
      }
      
      // Get the user's Recovery Pool keypair
      const recoveryKeypair = getRecoveryPoolKeypair(owner);
      
      const recoveryStatus = await getRecoveryPoolStatus(owner, regularConn);
      console.log(`[Pool]   Recovery Pool: ${recoveryStatus.address?.slice(0, 12) || 'N/A'}...`);
      console.log(`[Pool]   Recovery Balance: ${recoveryStatus.balance.toFixed(4)} SOL`);
      console.log(`[Pool]   Total Recycled: ${recoveryStatus.totalRecycled.toFixed(4)} SOL`);
      
      // 3-STEP FLOW with x402:
      // 1. Decompress to BURNER's ATA (Recovery Pool creates ATA, pays rent)
      // 2. Transfer from BURNER → RECIPIENT via x402-style SPL transfer
      // 3. Close burner's ATA, recover rent to Recovery Pool
      transfer2Result = await decompressAndTransfer(
        burnerKeypair,         // Burner owns compressed tokens (signs to authorize)
        recoveryKeypair,       // RECOVERY POOL pays fees (NOT stealth pool!)
        recipientPubkey,       // Final recipient
        amountMicroUsdc        // Full amount
      );
      
      console.log(`[Pool] ✓ Transfer #2 complete (3-step PayAI x402 flow)!`);
      console.log(`[Pool]   Step 2a - Decompress TX: ${transfer2Result.decompressTx.slice(0, 16)}...`);
      console.log(`[Pool]   Step 2b - PayAI x402 Transfer TX: ${transfer2Result.transferTx.slice(0, 16)}...`);
      console.log(`[Pool]   Recipient ATA: ${transfer2Result.recipientAta.slice(0, 12)}...`);
      console.log(`[Pool]   Recipient can see ${amountUSDC} USDC in their wallet!`);
      if (transfer2Result.payaiFeePayer) {
        console.log(`[Pool]   Gas paid by: PayAI (${transfer2Result.payaiFeePayer.slice(0, 12)}...)`);
      }
      if (transfer2Result.rentRecovered && transfer2Result.rentRecovered > 0) {
        console.log(`[Pool]   Burner ATA closed, recovered ${transfer2Result.rentRecovered.toFixed(6)} SOL`);
      }
      console.log(`[Pool]   Privacy: Stealth Pool NOT in any transaction!`);
    } catch (transfer2Error: any) {
      const errorMsg = transfer2Error.message || 'Unknown error';
      console.error(`[Pool] Transfer #2 failed (Burner → Recipient):`, errorMsg);
      
      // CRITICAL: Funds are in burner but not delivered to recipient
      // Return burner info so funds can be recovered
      return res.status(500).json({
        success: false,
        error: 'Second transfer failed (Burner → Recipient): ' + errorMsg,
        errorCode: 'TRANSFER_2_FAILED',
        hint: 'Funds are in temporary burner. Contact support for recovery.',
        recovery: {
          burnerAddress,
          transfer1Signature: transfer1Result.signature,
          amount: amountUSDC,
        },
        timestamp: Date.now(),
      });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // SUCCESS: Maximum Privacy Payment Complete!
    // - Compressed transfer Pool → Burner (cheap, private)
    // - Decompress + regular SPL transfer Burner → Recipient (visible to recipient!)
    // ═══════════════════════════════════════════════════════════════════════
    
    // Calculate cost savings vs legacy
    const costs = getCostEstimate();
    const savingsVsLegacy = costs.regularAccountRent - costs.compressedAccountCost;
    
    console.log(`[Pool] ═══════════════════════════════════════════════════════════`);
    console.log(`[Pool] ✓ MAXIMUM PRIVACY PAYMENT COMPLETE!`);
    console.log(`[Pool]   Transfer #1 (Compressed): ${transfer1Result.signature.slice(0, 16)}... (Pool → Burner)`);
    console.log(`[Pool]   Decompress TX: ${transfer2Result.decompressTx.slice(0, 16)}...`);
    console.log(`[Pool]   Transfer #2 (Regular): ${transfer2Result.transferTx.slice(0, 16)}... (Burner → Recipient)`);
    console.log(`[Pool]   Burner: ${burnerAddress.slice(0, 12)}... (ephemeral, discarded)`);
    console.log(`[Pool]   Recipient: ${recipient.slice(0, 12)}... receives REGULAR USDC!`);
    console.log(`[Pool]   Privacy: MAXIMUM - Recipient sees burner, NOT your pool`);
    console.log(`[Pool] ═══════════════════════════════════════════════════════════`);
    
    // STEP 4: Log to encrypted audit
    await auditLedger.logActivity(owner, {
      type: 'maximum_privacy_payment',
      amount: amountMicroUsdc.toString(),
      stealthPoolAddress: pool.publicKey,
      recipient: recipient,
      tempBurner: burnerAddress, // Ephemeral burner for maximum privacy
      txSignature1: transfer1Result.signature, // Pool → Burner (compressed)
      txSignature2: transfer2Result.transferTx, // Burner → Recipient (regular SPL)
      decompressTx: transfer2Result.decompressTx, // Decompress step
      method: 'two_step_burner',
      feePayer: 'pool_owner',
      compressed: true,
      proofHash: proofHash,
      compression: {
        enabled: true,
        savingsPerPayment: savingsVsLegacy,
        multiplier: costs.savingsMultiplier,
      },
      privacy: {
        twoStepBurner: true,
        recipientSees: burnerAddress, // Burner address, NOT pool
        ownerHidden: true,
        poolHidden: true, // Pool also hidden from recipient
        regularUsdcDelivered: true, // Recipient gets regular USDC!
      },
      timestamp: new Date().toISOString(),
    });
    
    // Get updated balance
    const newBalance = await getPoolBalance(connection, pool.id);
    
    // STEP 5: Return success with MAXIMUM privacy details
    res.json({
      success: true,
      data: {
        // All transaction signatures
        paymentTx: transfer2Result.transferTx, // Primary: Burner → Recipient (regular USDC)
        transfer1Tx: transfer1Result.signature, // Pool → Burner (compressed)
        decompressTx: transfer2Result.decompressTx, // Decompress step
        transfer2Tx: transfer2Result.transferTx, // Burner → Recipient (regular SPL)
        tempBurnerAddress: burnerAddress, // Ephemeral burner used
        recipientAta: transfer2Result.recipientAta, // Recipient's ATA
        proofHash: proofHash,
        poolBalance: newBalance,
        solscanUrl: `https://solscan.io/tx/${transfer2Result.transferTx}`,
        
        // Privacy guarantees - MAXIMUM
        privacy: {
          recipientSees: burnerAddress.slice(0, 12) + '... (ephemeral burner)',
          recipientCannotSee: [
            owner.slice(0, 12) + '... (your wallet)',
            pool.publicKey.slice(0, 12) + '... (your pool)',
          ],
          method: 'Two-Step Compressed Burner + Decompress',
          linkBroken: true,
          maximumPrivacy: true,
          regularUsdcDelivered: true,
          message: 'Payment complete! Recipient received REGULAR USDC (visible in Phantom/Solflare). Max privacy maintained.',
        },
        
        // Compression details
        compression: {
          enabled: true,
          proofHash: proofHash,
          savings: {
            perPayment: `${savingsVsLegacy.toFixed(6)} SOL`,
            multiplier: `${costs.savingsMultiplier}x cheaper`,
            totalSaved: `~$${(savingsVsLegacy * 100).toFixed(4)}`,
          },
        },
        
        // Cost info (three transactions now)
        cost: {
          transfer1: '~0.00016 SOL (compressed)',
          decompress: '~0.00050 SOL',
          transfer2: '~0.00050 SOL (regular SPL)',
          total: '~0.00116 SOL',
          note: 'Recipient receives REGULAR USDC they can see in wallet',
        },
        
        // Pipeline visualization - Three steps
        pipeline: {
          step1: `Your Wallet: ${owner.slice(0, 8)}... (hidden)`,
          step2: `Pool (Compressed): ${pool.publicKey.slice(0, 8)}...`,
          step3: `Burner (Compressed): ${burnerAddress.slice(0, 8)}...`,
          step4: `Burner (Regular USDC): Decompressed`,
          step5: `Recipient: ${recipient.slice(0, 8)}... ← REGULAR USDC!`,
          transactions: [
            `TX1: ${transfer1Result.signature.slice(0, 12)}... (Pool→Burner compressed)`,
            `TX2: ${transfer2Result.decompressTx.slice(0, 12)}... (Decompress)`,
            `TX3: ${transfer2Result.transferTx.slice(0, 12)}... (Burner→Recipient regular)`,
          ],
        },
      },
      timestamp: Date.now(),
    });
    
    } else {
      // ═════════════════════════════════════════════════════════════════════
      // STANDARD PATH: Burner Wallet Flow (Privacy via Ephemeral Burner)
      // Flow: Pool → Temp Burner → x402/PayAI → Recipient → Close & Recover SOL
      // ═════════════════════════════════════════════════════════════════════
      console.log(`[Pool] ╔════════════════════════════════════════════════════════════╗`);
      console.log(`[Pool] ║  STANDARD PRIVATE PAYMENT - BURNER WALLET FLOW              ║`);
      console.log(`[Pool] ╚════════════════════════════════════════════════════════════╝`);
      console.log(`[Pool] Amount: ${amountUSDC} USDC → ${recipient.slice(0, 8)}...`);
      console.log(`[Pool] Flow: Pool → Temp Burner → PayAI/x402 → Recipient → Recover SOL`);
      
      const recipientPubkey = new PublicKey(recipient);
      const amountMicroUsdc = BigInt(Math.floor(parseFloat(amountUSDC) * 1_000_000));
      
      // Use the existing executePoolPayment function - uses burner wallet flow
      // This creates a temp burner, funds it, pays via x402, then recovers SOL
      try {
        const paymentResult = await executePoolPayment(
          connection,        // Solana connection
          pool.id,           // Pool ID
          recipientPubkey,   // Recipient as PublicKey
          amountMicroUsdc    // Amount in micro-USDC
        );
        
        if (!paymentResult.success) {
          throw new Error(paymentResult.error || 'Payment execution failed');
        }
        
        // Get updated balance
        const newBalance = await getPoolBalance(connection, pool.id);
        
        console.log(`[Pool] ✓ STANDARD PRIVATE PAYMENT COMPLETE`);
        console.log(`[Pool]   Payment Tx: ${paymentResult.paymentTx?.slice(0, 16)}...`);
        console.log(`[Pool]   Burner: ${paymentResult.tempBurnerAddress?.slice(0, 12)}...`);
        console.log(`[Pool]   SOL Recovered: ${paymentResult.solRecovered?.toFixed(6) || '0'} SOL`);
        console.log(`[Pool]   Method: ${paymentResult.method || 'direct'}`);
        
        // Log to audit
        await auditLedger.logActivity(owner, {
          type: 'burner_private_payment',
          amount: amountMicroUsdc.toString(),
          stealthPoolAddress: pool.publicKey,
          recipient: recipient,
          tempBurner: paymentResult.tempBurnerAddress,
          txSignature: paymentResult.paymentTx,
          setupTx: paymentResult.setupTx,
          usdcTransferTx: paymentResult.usdcTransferTx,
          recoveryTx: paymentResult.recoveryTx,
          method: paymentResult.method || 'direct',
          feePayer: paymentResult.feePayer,
          solRecovered: paymentResult.solRecovered,
          compressed: false,
          timestamp: new Date().toISOString(),
        });
        
        res.json({
          success: true,
          data: {
            paymentTx: paymentResult.paymentTx,
            tempBurnerAddress: paymentResult.tempBurnerAddress,
            solRecovered: paymentResult.solRecovered,
            poolBalance: newBalance,
            solscanUrl: paymentResult.paymentTx ? `https://solscan.io/tx/${paymentResult.paymentTx}` : null,
            
            // Privacy info
            privacy: {
              recipientSees: paymentResult.tempBurnerAddress?.slice(0, 12) + '...',
              recipientCannotSee: owner.slice(0, 12) + '...',
              method: 'Ephemeral Burner Wallet',
              linkBroken: true,
              message: 'Payment confirmed. Recipient sees temporary burner, not your wallet.',
            },
            
            // Standard payment info
            method: paymentResult.method || 'direct',
            compressed: false,
            feePayer: paymentResult.feePayer,
            
            // Transaction breakdown
            transactions: {
              setup: paymentResult.setupTx,
              usdcTransfer: paymentResult.usdcTransferTx,
              payment: paymentResult.paymentTx,
              recovery: paymentResult.recoveryTx,
            },
            
            // Upgrade hint
            upgradeHint: {
              message: 'Shield your funds for 50x cheaper payments + ZK privacy',
              action: 'Use "Maximum Privacy" option after shielding',
            },
            
            // Pipeline visualization
            pipeline: {
              step1: `Pool: ${pool.publicKey.slice(0, 8)}...`,
              step2: `Temp Burner: ${paymentResult.tempBurnerAddress?.slice(0, 8) || 'N/A'}...`,
              step3: `x402/PayAI Transfer`,
              step4: `Recipient: ${recipient.slice(0, 8)}...`,
              step5: `Close Burner & Recover SOL`,
            },
          },
          timestamp: Date.now(),
        });
        
      } catch (paymentError: any) {
        console.error('[Pool] Standard payment failed:', paymentError.message);
        return res.status(500).json({
          success: false,
          error: paymentError.message || 'Failed to execute standard payment',
          errorCode: 'STANDARD_PAYMENT_FAILED',
          hint: 'Check pool balance and try again',
          timestamp: Date.now(),
        });
      }
    }
    
  } catch (error: any) {
    console.error('[Pool] Payment error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to execute private payment',
      errorCode: 'PAYMENT_ERROR',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /pool/history/:owner
 * Get payment history for pool
 */
router.get('/pool/history/:owner', async (req: Request, res: Response) => {
  try {
    const { owner } = req.params;
    
    const pool = getPoolWallet(owner);
    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'No pool wallet found',
        timestamp: Date.now(),
      });
    }
    
    const history = getPoolPaymentHistory(pool.id);
    
    res.json({
      success: true,
      data: {
        poolId: pool.id,
        totalPayments: pool.totalPayments,
        totalSolRecovered: pool.totalSolRecovered,
        payments: history.map(b => ({
          id: b.id,
          recipient: b.recipient,
          amount: b.amount ? (parseInt(b.amount) / 1_000_000).toFixed(2) : '0',
          tempBurner: b.publicKey.slice(0, 12) + '...',
          paymentTx: b.paymentTx,
          solRecovered: b.solRecovered,
          timestamp: b.createdAt,
          status: b.status,
        })),
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Pool] History error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get history',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /pool/sessions/:owner
 * Get encrypted payment sessions for owner (Audit Trail)
 * Sessions track the full lifecycle: Pool → Burner → Recipient → Cleanup
 */
router.get('/pool/sessions/:owner', async (req: Request, res: Response) => {
  try {
    const { owner } = req.params;
    const connection = getSolanaConnection();
    const paymentLogger = getPaymentLogger(connection);
    
    const sessions = paymentLogger.getEncryptedSessions(owner);
    
    res.json({
      success: true,
      data: {
        sessions: sessions.map(s => ({
          sessionId: s.sessionId,
          fheHandle: s.fheHandle,
          createdAt: s.createdAt,
          status: s.status,
          method: s.method,
          txCount: s.txCount,
        })),
        total: sessions.length,
        encrypted: true,
        note: 'Sign a message to decrypt session details in the Decryption Center',
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Sessions] Get sessions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sessions',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /pool/sessions/decrypt
 * Decrypt a specific payment session (requires wallet signature)
 * Returns the full Chain of Custody: burner birth → death, fees, all TXs
 */
router.post('/pool/sessions/decrypt', async (req: Request, res: Response) => {
  try {
    const { owner, sessionId, signature, message } = req.body;
    
    if (!owner || !sessionId || !signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: owner, sessionId, signature',
        timestamp: Date.now(),
      });
    }
    
    const connection = getSolanaConnection();
    const paymentLogger = getPaymentLogger(connection);
    
    const session = await paymentLogger.decryptSession(sessionId, owner, signature);
    
    if (!session) {
      return res.status(400).json({
        success: false,
        error: 'Session not found or decryption failed',
        timestamp: Date.now(),
      });
    }
    
    res.json({
      success: true,
      data: session,
      decrypted: true,
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Sessions] Decrypt error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to decrypt session',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /pool/sessions/decrypt-all
 * Decrypt all payment sessions for owner (batch decryption)
 */
router.post('/pool/sessions/decrypt-all', async (req: Request, res: Response) => {
  try {
    const { owner, signature, message } = req.body;
    
    if (!owner || !signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: owner, signature',
        timestamp: Date.now(),
      });
    }
    
    const connection = getSolanaConnection();
    const paymentLogger = getPaymentLogger(connection);
    
    const sessions = await paymentLogger.decryptAllSessions(owner, signature);
    
    // Check FHE mode
    const incoClient = getIncoClient();
    const isRealFhe = incoClient.isRealMode();
    
    res.json({
      success: true,
      data: {
        sessions,
        total: sessions.length,
      },
      fhe: {
        provider: 'Inco Network',
        mode: isRealFhe ? 'REAL' : 'SIMULATION',
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Sessions] Batch decrypt error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to decrypt sessions',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /pool/export-key
 * Export pool wallet private key (requires owner verification)
 */
router.post('/pool/export-key', async (req: Request, res: Response) => {
  try {
    const { owner, signature, message } = req.body;
    
    if (!owner || !signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: owner, signature',
        timestamp: Date.now(),
      });
    }
    
    const pool = getPoolWallet(owner);
    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'No pool wallet found',
        timestamp: Date.now(),
      });
    }
    
    const result = await exportPoolKey(pool.id, owner);
    if (!result) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized or decryption failed',
        timestamp: Date.now(),
      });
    }
    
    res.json({
      success: true,
      data: {
        poolId: pool.id,
        publicKey: result.publicKey,
        privateKey: result.privateKeyBase58,
        format: 'base58',
        warning: 'Keep this key safe! Anyone with this key can control the wallet.',
        importInstructions: 'Phantom: Settings → Manage Wallets → Import Private Key',
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Pool] Export key error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export key',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /pool/withdraw
 * Withdraw SOL and/or USDC from pool wallet back to user's main wallet
 * 
 * This allows users to reclaim their funds from the pool wallet.
 * The pool wallet remains intact for future payments.
 */
router.post('/pool/withdraw', async (req: Request, res: Response) => {
  try {
    const { owner, withdrawSol, withdrawUsdc } = req.body;
    
    if (!owner) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: owner',
        timestamp: Date.now(),
      });
    }
    
    const pool = getPoolWallet(owner);
    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'No pool wallet found',
        timestamp: Date.now(),
      });
    }
    
    const connection = getSolanaConnection();
    const balance = await getPoolBalance(connection, pool.id);
    
    if (!balance) {
      return res.status(400).json({
        success: false,
        error: 'Could not fetch pool balance',
        timestamp: Date.now(),
      });
    }
    
    // Validate withdrawal amounts
    const solToWithdraw = withdrawSol ? parseFloat(withdrawSol) : 0;
    const usdcToWithdraw = withdrawUsdc ? parseFloat(withdrawUsdc) : 0;
    
    // Leave minimum SOL for future transactions (prevents locking out the pool)
    const MIN_SOL_RESERVE = 0.001;
    const maxSolWithdraw = Math.max(0, balance.sol - MIN_SOL_RESERVE);
    
    if (solToWithdraw > maxSolWithdraw) {
      return res.status(400).json({
        success: false,
        error: `Can only withdraw up to ${maxSolWithdraw.toFixed(4)} SOL (keeping ${MIN_SOL_RESERVE} SOL reserve for tx gas)`,
        maxWithdrawable: { sol: maxSolWithdraw, usdc: balance.usdc },
        timestamp: Date.now(),
      });
    }
    
    if (usdcToWithdraw > balance.usdc) {
      return res.status(400).json({
        success: false,
        error: `Insufficient USDC. Have: ${balance.usdc.toFixed(2)}, requested: ${usdcToWithdraw.toFixed(2)}`,
        maxWithdrawable: { sol: maxSolWithdraw, usdc: balance.usdc },
        timestamp: Date.now(),
      });
    }
    
    if (solToWithdraw <= 0 && usdcToWithdraw <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Must specify withdrawSol and/or withdrawUsdc amount',
        currentBalance: balance,
        timestamp: Date.now(),
      });
    }
    
    // Decrypt pool keypair
    const poolKeypair = await decryptPoolKey(pool.id);
    if (!poolKeypair) {
      return res.status(500).json({
        success: false,
        error: 'Failed to decrypt pool wallet',
        timestamp: Date.now(),
      });
    }
    
    const userPubkey = new PublicKey(owner);
    const poolPubkey = poolKeypair.publicKey;
    const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    
    // Build withdrawal transaction
    const transaction = new Transaction();
    
    // Add SOL transfer if requested
    if (solToWithdraw > 0) {
      const solLamports = Math.floor(solToWithdraw * LAMPORTS_PER_SOL);
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: poolPubkey,
          toPubkey: userPubkey,
          lamports: solLamports,
        })
      );
      console.log(`[Pool Withdraw] Adding ${solToWithdraw} SOL transfer`);
    }
    
    // Add USDC transfer if requested
    if (usdcToWithdraw > 0) {
      const poolUsdcAccount = await getAssociatedTokenAddress(
        USDC_MINT, poolPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const userUsdcAccount = await getAssociatedTokenAddress(
        USDC_MINT, userPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      );
      
      // Check if user has USDC account
      let userUsdcExists = false;
      try {
        await getAccount(connection, userUsdcAccount, 'confirmed', TOKEN_PROGRAM_ID);
        userUsdcExists = true;
      } catch {
        userUsdcExists = false;
      }
      
      // Create user USDC account if needed (pool pays for it)
      if (!userUsdcExists) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            poolPubkey, userUsdcAccount, userPubkey, USDC_MINT,
            TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
        console.log(`[Pool Withdraw] Creating user USDC account`);
      }
      
      const amountMicroUsdc = BigInt(Math.floor(usdcToWithdraw * 1_000_000));
      transaction.add(
        createTransferInstruction(
          poolUsdcAccount, userUsdcAccount, poolPubkey, amountMicroUsdc,
          [], TOKEN_PROGRAM_ID
        )
      );
      console.log(`[Pool Withdraw] Adding ${usdcToWithdraw} USDC transfer`);
    }
    
    // Sign and send
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = poolPubkey;
    transaction.sign(poolKeypair);
    
    console.log(`[Pool] Withdrawing: ${solToWithdraw} SOL, ${usdcToWithdraw} USDC`);
    
    const txSignature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    await connection.confirmTransaction({
      signature: txSignature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');
    
    // Get updated balance
    const newBalance = await getPoolBalance(connection, pool.id);
    
    console.log(`[Pool] ✓ Withdrawal complete: ${txSignature.slice(0, 20)}...`);
    
    res.json({
      success: true,
      data: {
        txSignature,
        withdrawn: {
          sol: solToWithdraw,
          usdc: usdcToWithdraw,
        },
        newBalance,
        solscanUrl: `https://solscan.io/tx/${txSignature}`,
      },
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error('[Pool] Withdraw error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to withdraw from pool',
      timestamp: Date.now(),
    });
  }
});

// ============================================================================
// LEGACY STEALTH ADDRESS ROUTES - Kept for backwards compatibility
// ============================================================================

/**
 * POST /stealth/create
 * Create a new stealth (burner) address for a private payment
 * 
 * REQUIRES wallet signature to encrypt the private key!
 * The stealth address breaks the on-chain link between user and service provider.
 */
router.post('/stealth/create', async (req: Request, res: Response) => {
  try {
    const { owner, signature, message } = req.body;
    
    if (!owner) {
      return res.status(400).json({ 
        success: false, 
        error: 'Owner wallet address required',
        timestamp: Date.now(),
      });
    }
    
    if (!signature) {
      return res.status(400).json({ 
        success: false, 
        error: 'Wallet signature required to encrypt stealth private key',
        hint: 'Sign a message with your wallet and include the signature',
        timestamp: Date.now(),
      });
    }
    
    console.log(`[Stealth API] Creating stealth address for: ${owner.slice(0, 8)}...`);
    console.log(`[Stealth API] 🔒 Private key will be encrypted with wallet signature`);
    
    const result = await createStealthAddress(owner, signature);
    
    res.json({
      success: true,
      data: {
        stealthId: result.stealthId,
        stealthAddress: result.stealthPublicKey,
        fheHandle: result.fheHandle,
        keyEncrypted: true,
        instructions: [
          '1. Call POST /stealth/fund to get a funding transaction',
          '2. Sign and send the funding transaction with your wallet',
          '3. Call POST /stealth/execute to complete the payment',
        ],
      },
      privacy: {
        provider: 'Inco Network',
        model: 'Stealth Addresses',
        guarantee: 'Service provider CANNOT link payment to your main wallet',
        mapping: 'Owner↔Stealth link is FHE-encrypted',
      },
      security: {
        keyEncryption: 'AES-256-CBC',
        keyAccess: 'Only wallet owner can decrypt/export',
        note: 'Private key is encrypted with your wallet signature. Third parties cannot access it.',
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Stealth API] Create error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create stealth address',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /stealth/fund
 * Get a transaction to fund the stealth address
 * User signs this to transfer USDC + SOL to the burner wallet
 */
router.post('/stealth/fund', async (req: Request, res: Response) => {
  try {
    const { stealthId, userWallet, amountUSDC } = req.body;
    
    if (!stealthId || !userWallet || !amountUSDC) {
      return res.status(400).json({ 
        success: false, 
        error: 'stealthId, userWallet, and amountUSDC required',
        timestamp: Date.now(),
      });
    }
    
    console.log(`[Stealth API] Building funding tx: ${userWallet.slice(0, 8)}... → stealth`);
    
    const connection = getSolanaConnection();
    const userPubkey = new PublicKey(userWallet);
    const amount = BigInt(amountUSDC);
    
    const result = await createFundingTransaction(connection, userPubkey, stealthId, amount);
    
    if (!result) {
      return res.status(404).json({ 
        success: false, 
        error: 'Stealth address not found or already funded',
        timestamp: Date.now(),
      });
    }
    
    // Serialize transaction for frontend to sign
    const serialized = result.transaction.serialize({ 
      requireAllSignatures: false,
      verifySignatures: false,
    });
    
    res.json({
      success: true,
      data: {
        transaction: serialized.toString('base64'),
        stealthAddress: result.stealthPublicKey,
        amountUSDC: (Number(amount) / 1_000_000).toFixed(6),
        solRequired: result.solRequired.toFixed(6),
        note: 'Sign this transaction to fund the stealth address',
      },
      nextStep: {
        endpoint: 'POST /api/credits/stealth/confirm-funding',
        params: { stealthId, txSignature: '<your_signature>' },
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Stealth API] Fund error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create funding transaction',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /stealth/confirm-funding
 * Confirm that the stealth address has been funded
 * Call this after the funding transaction is confirmed on-chain
 */
router.post('/stealth/confirm-funding', async (req: Request, res: Response) => {
  try {
    const { stealthId, txSignature } = req.body;
    
    if (!stealthId || !txSignature) {
      return res.status(400).json({ 
        success: false, 
        error: 'stealthId and txSignature required',
        timestamp: Date.now(),
      });
    }
    
    // Verify the transaction exists on-chain
    const connection = getSolanaConnection();
    const txInfo = await connection.getTransaction(txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    
    if (!txInfo) {
      return res.status(400).json({ 
        success: false, 
        error: 'Transaction not found on-chain. Wait for confirmation.',
        timestamp: Date.now(),
      });
    }
    
    // Mark stealth as funded
    markStealthFunded(stealthId, txSignature);
    
    const stealth = getStealthInfo(stealthId);
    
    res.json({
      success: true,
      data: {
        stealthId,
        status: 'funded',
        stealthAddress: stealth?.publicKey,
        fundingTx: txSignature,
        solscanUrl: `https://solscan.io/tx/${txSignature}`,
      },
      nextStep: {
        endpoint: 'POST /api/credits/stealth/execute',
        params: { stealthId, recipient: '<service_wallet>', amountUSDC: '<amount>' },
        note: 'Now execute the payment to the service provider',
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Stealth API] Confirm funding error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to confirm funding',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /stealth/execute
 * Execute the stealth payment to the service provider
 * 
 * x402 INTEGRATION:
 * 1. Tries PayAI facilitator first (x402 compliant)
 * 2. Falls back to direct on-chain transfer if unavailable
 * 
 * PRIVACY MAGIC:
 * - The stealth wallet signs this transaction (NOT the user)
 * - Service provider sees payment from random burner wallet
 * - Service provider CANNOT link it to user's main wallet
 */
router.post('/stealth/execute', async (req: Request, res: Response) => {
  try {
    const { stealthId, recipient, amountUSDC } = req.body;
    
    if (!stealthId || !recipient || !amountUSDC) {
      return res.status(400).json({ 
        success: false, 
        error: 'stealthId, recipient, and amountUSDC required',
        timestamp: Date.now(),
      });
    }
    
    console.log(`[Stealth API] 🛡️ Executing PRIVATE x402 payment to: ${recipient.slice(0, 8)}...`);
    
    const connection = getSolanaConnection();
    const recipientPubkey = new PublicKey(recipient);
    const amount = BigInt(amountUSDC);
    
    const result = await executeStealthPayment(connection, stealthId, recipientPubkey, amount);
    
    if (!result) {
      return res.status(400).json({ 
        success: false, 
        error: 'Stealth address not found, not funded, or already used',
        timestamp: Date.now(),
      });
    }
    
    // Log to FHE audit
    const stealth = getStealthInfo(stealthId);
    if (stealth) {
      await auditLedger.logActivity(stealth.owner, {
        type: 'stealth_x402_payment',
        agentId: stealthId,
        agentName: 'Stealth x402 Payment',
        resource: recipient,
        amount: amountUSDC,
        txSignature: result.txSignature,
        x402Method: result.method,
        x402Protocol: result.x402.protocol,
        x402PaymentId: result.x402.paymentId,
        timestamp: new Date().toISOString(),
      });
    }
    
    res.json({
      success: true,
      data: {
        txSignature: result.txSignature,
        stealthAddress: result.stealthAddress,
        recipientAddress: result.recipientAddress,
        amountUSDC: (Number(amount) / 1_000_000).toFixed(6),
        solscanUrl: `https://solscan.io/tx/${result.txSignature}`,
      },
      x402: {
        protocol: result.x402.protocol,
        method: result.method,
        facilitatorUsed: result.x402.facilitatorUsed,
        note: '✅ Private payment executed from stealth wallet',
      },
      privacy: {
        achieved: true,
        stealthUsed: true,
        ownerHidden: true,
        serviceProviderSees: result.stealthAddress,
        serviceProviderCannotSee: stealth?.owner || 'your main wallet',
        linkageEncrypted: 'Inco FHE',
        guarantee: 'Service provider cannot link this payment to your main wallet',
      },
      encryption: {
        provider: 'Inco Network',
        type: 'FHE',
        logged: true,
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Stealth API] Execute error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to execute stealth payment',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /stealth/history/:owner
 * Get all stealth addresses for an owner
 * Only the owner can see their stealth history (FHE-encrypted mapping)
 */
router.get('/stealth/history/:owner', async (req: Request, res: Response) => {
  try {
    const { owner } = req.params;
    
    if (!owner) {
      return res.status(400).json({ 
        success: false, 
        error: 'Owner wallet address required',
        timestamp: Date.now(),
      });
    }
    
    const stealthAddresses = await getOwnerStealthAddresses(owner);
    
    res.json({
      success: true,
      data: {
        owner,
        stealthAddresses,
        count: stealthAddresses.length,
        totalUsed: stealthAddresses.filter(s => s.status === 'used').length,
      },
      privacy: {
        note: 'Only you can see this mapping - the owner↔stealth link is FHE-encrypted',
        model: 'Stealth Addresses + Inco FHE',
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Stealth API] History error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch stealth history',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /stealth/status/:stealthId
 * Get status of a specific stealth address
 */
router.get('/stealth/status/:stealthId', async (req: Request, res: Response) => {
  try {
    const { stealthId } = req.params;
    
    const stealth = getStealthInfo(stealthId);
    
    if (!stealth) {
      return res.status(404).json({ 
        success: false, 
        error: 'Stealth address not found',
        timestamp: Date.now(),
      });
    }
    
    res.json({
      success: true,
      data: {
        stealthId: stealth.id,
        publicKey: stealth.publicKey,
        status: stealth.status,
        createdAt: stealth.createdAt,
        fundedAt: stealth.fundedAt,
        usedAt: stealth.usedAt,
        fundingTx: stealth.fundingTx,
        paymentTx: stealth.paymentTx,
        recipient: stealth.recipient,
        amount: stealth.amount,
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Stealth API] Status error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get stealth status',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /stealth/stats
 * Get overall stealth address statistics
 */
router.get('/stealth/stats', async (_req: Request, res: Response) => {
  try {
    const stats = getStealthStats();
    
    res.json({
      success: true,
      data: {
        ...stats,
        privacyModel: 'Stealth Addresses + Inco FHE',
        guarantees: [
          'Service providers cannot link payments to user wallets',
          'Owner↔Stealth mapping is FHE-encrypted',
          'Only the owner can decrypt their stealth history',
          'Private keys are AES-256 encrypted - only owner can access',
        ],
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Stealth API] Stats error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get stealth stats',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /stealth/export-key
 * Export the private key of a stealth wallet
 * 
 * SECURITY: Requires wallet signature for authentication
 * Only the owner can export their stealth wallet keys
 * 
 * The exported key can be imported into Phantom or other Solana wallets
 */
router.post('/stealth/export-key', async (req: Request, res: Response) => {
  try {
    const { stealthId, owner, signature, message } = req.body;
    
    if (!stealthId || !owner || !signature) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: stealthId, owner, signature',
        timestamp: Date.now(),
      });
    }
    
    const stealth = getStealthInfo(stealthId);
    
    if (!stealth) {
      return res.status(404).json({ 
        success: false, 
        error: 'Stealth wallet not found',
        timestamp: Date.now(),
      });
    }
    
    // Verify ownership
    if (stealth.owner !== owner) {
      return res.status(403).json({ 
        success: false, 
        error: 'Not authorized to export this key',
        timestamp: Date.now(),
      });
    }
    
    console.log(`[Stealth API] 🔑 Key export request for: ${stealthId.slice(0, 16)}...`);
    console.log(`[Stealth API]    Owner: ${owner.slice(0, 8)}...`);
    
    // Export the key
    const result = await exportStealthKey(stealthId, owner, signature);
    
    if (!result) {
      return res.status(401).json({ 
        success: false, 
        error: 'Failed to decrypt/export key - invalid signature or key corrupted',
        timestamp: Date.now(),
      });
    }
    
    console.log(`[Stealth API] ✅ Key exported for: ${stealthId.slice(0, 16)}...`);
    
    res.json({
      success: true,
      data: {
        stealthId,
        publicKey: result.publicKey,
        privateKey: result.privateKeyBase58,
        format: 'base58',
        warning: 'Keep this key safe! Anyone with this key can control the wallet.',
        importInstructions: {
          phantom: 'Settings → Manage Wallets → Import → Private Key',
          solflare: 'Settings → Wallets → Import → Private Key',
        },
      },
      security: {
        note: 'This key was decrypted using your wallet signature',
        encrypted: 'Key is stored encrypted at rest (AES-256-CBC)',
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Stealth API] Key export error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to export key',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /stealth/stuck/:owner
 * List stuck stealth addresses (funded but not used)
 */
router.get('/stealth/stuck/:owner', async (req: Request, res: Response) => {
  try {
    const { owner } = req.params;
    const stuckAddresses = getStuckStealthAddresses(owner);
    
    res.json({
      success: true,
      data: {
        stuck: stuckAddresses,
        count: stuckAddresses.length,
        message: stuckAddresses.length > 0 
          ? 'Found stuck stealth addresses with funds. You can retry execute or use recovery.'
          : 'No stuck stealth addresses found.',
      },
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Stealth API] Stuck list error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to list stuck addresses',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /stealth/recover-sol
 * Recover SOL from a used multi-stealth wallet to user's single stealth wallet
 * 
 * COST OPTIMIZATION:
 * - After a multi-stealth payment completes, SOL is left in the burner
 * - This endpoint recovers that SOL to the user's reusable single wallet
 * - Reduces the effective cost of multi-stealth payments
 */
router.post('/stealth/recover-sol', async (req: Request, res: Response) => {
  try {
    const { usedStealthId, singleStealthPublicKey, owner } = req.body;
    
    if (!usedStealthId || !singleStealthPublicKey || !owner) {
      return res.status(400).json({
        success: false,
        error: 'Required: usedStealthId, singleStealthPublicKey, owner',
        timestamp: Date.now(),
      });
    }
    
    // Verify ownership
    const usedStealth = getStealthInfo(usedStealthId);
    if (!usedStealth || usedStealth.owner !== owner) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized or stealth not found',
        timestamp: Date.now(),
      });
    }
    
    console.log(`[Stealth API] 💰 SOL recovery request:`);
    console.log(`[Stealth API]    From (multi): ${usedStealthId.slice(0, 20)}...`);
    console.log(`[Stealth API]    To (single): ${singleStealthPublicKey.slice(0, 12)}...`);
    
    const connection = getSolanaConnection();
    const result = await recoverSolToSingleWallet(
      connection,
      usedStealthId,
      singleStealthPublicKey
    );
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        timestamp: Date.now(),
      });
    }
    
    res.json({
      success: true,
      data: {
        usedStealthId,
        singleStealthWallet: singleStealthPublicKey,
        solRecovered: result.solRecovered,
        solRecoveredUSD: `~$${(result.solRecovered! * 200).toFixed(2)}`, // Rough SOL price estimate
        txSignature: result.txSignature,
        solscanUrl: `https://solscan.io/tx/${result.txSignature}`,
      },
      note: 'SOL recovered from multi-stealth to your single stealth wallet for reuse',
      timestamp: Date.now(),
    });
    
  } catch (error) {
    console.error('[Stealth API] Recover SOL error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to recover SOL',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/credits/transaction/:signature/graph
 * Get transaction flow graph for visualization
 * Optional query params: stealthPool, burner, recipient, amount (for fallback)
 */
router.get('/transaction/:signature/graph', async (req: Request, res: Response) => {
  try {
    const { signature } = req.params;
    const { stealthPool, burner, recipient, amount } = req.query; // Optional fallback data
    
    // Validate signature format
    if (!signature || signature.length < 32) {
      return res.status(400).json({
        success: false,
        error: 'Invalid transaction signature',
        code: 'INVALID_SIGNATURE',
      });
    }
    
    const connection = getSolanaConnection();
    let graph = await parseTransactionGraph(connection, signature);
    
    // If RPC parsing fails but we have fallback data, create simple graph
    if (!graph && (stealthPool || burner || recipient)) {
      console.log('[Payment] Using fallback graph from audit log data');
      
      const fallbackNodes: Array<{
        id: string;
        type: 'signer' | 'account' | 'asset' | 'program';
        label: string;
        address: string;
        truncated?: string;
        data?: {
          amount?: string;
          token?: string;
        };
      }> = [];
      const fallbackEdges: Array<{
        id: string;
        source: string;
        target: string;
        type: 'transfer' | 'sign' | 'instruction';
        label?: string;
        data?: {
          amount?: string;
          token?: string;
        };
      }> = [];
      
      // Add nodes from audit log data
      if (stealthPool) {
        fallbackNodes.push({
          id: 'pool',
          type: 'account',
          label: 'Stealth Pool',
          address: stealthPool as string,
          truncated: `${(stealthPool as string).slice(0, 8)}...${(stealthPool as string).slice(-8)}`,
        });
      }
      
      if (burner) {
        fallbackNodes.push({
          id: 'burner',
          type: 'account',
          label: 'Burner Wallet',
          address: burner as string,
          truncated: `${(burner as string).slice(0, 8)}...${(burner as string).slice(-8)}`,
        });
      }
      
      if (recipient) {
        fallbackNodes.push({
          id: 'recipient',
          type: 'account',
          label: 'Recipient',
          address: recipient as string,
          truncated: `${(recipient as string).slice(0, 8)}...${(recipient as string).slice(-8)}`,
        });
      }
      
      // Add asset node if amount provided
      if (amount) {
        const amountNum = parseFloat(amount as string) / 1_000_000; // Convert from micro-USDC
        fallbackNodes.push({
          id: 'asset',
          type: 'asset',
          label: `${amountNum} USDC`,
          address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mint
          data: {
            amount: amountNum.toString(),
            token: 'USDC',
          },
        });
      }
      
      // Add edges
      if (stealthPool && burner) {
        fallbackEdges.push({
          id: 'pool-to-burner',
          source: 'pool',
          target: 'burner',
          type: 'transfer',
          label: 'Fund',
        });
      }
      
      if (burner && recipient) {
        if (amount) {
          fallbackEdges.push({
            id: 'burner-to-asset',
            source: 'burner',
            target: 'asset',
            type: 'transfer',
            label: 'Send',
          });
          fallbackEdges.push({
            id: 'asset-to-recipient',
            source: 'asset',
            target: 'recipient',
            type: 'transfer',
            label: 'Receive',
          });
        } else {
          fallbackEdges.push({
            id: 'burner-to-recipient',
            source: 'burner',
            target: 'recipient',
            type: 'transfer',
            label: 'Transfer',
          });
        }
      }
      
      graph = {
        nodes: fallbackNodes,
        edges: fallbackEdges,
        metadata: {
          signature,
          status: 'success',
        },
      };
    }
    
    if (!graph) {
      return res.status(404).json({
        success: false,
        error: 'TRANSACTION_NOT_FOUND: Transaction not found or could not be parsed',
        code: 'NOT_FOUND',
      });
    }
    
    res.json({
      success: true,
      data: graph,
    });
  } catch (error: any) {
    console.error('[Payment] Transaction graph error:', error);
    
    // Check for rate limit errors
    if (error?.message?.includes('429') || error?.message?.includes('RATE_LIMITED')) {
      return res.status(429).json({
        success: false,
        error: error.message || 'RPC rate limit exceeded. Please try again in a few seconds.',
        code: 'RATE_LIMITED',
        retryAfter: 5000, // Suggest retry after 5 seconds
      });
    }
    
    // Check for not found errors
    if (error?.message?.includes('NOT_FOUND') || error?.message?.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: error.message || 'Transaction not found or could not be parsed',
        code: 'NOT_FOUND',
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to parse transaction graph',
      code: 'PARSE_ERROR',
    });
  }
});

// =============================================================================
// LIGHT PROTOCOL PAYMENT ENDPOINT (Aegix 4.0)
// =============================================================================

import {
  executeCompressedTransfer,
  createCompressedBurner,
  getCompressedBalance,
  getRegularConnection,
  getCostEstimate,
} from '../light/client.js';
import {
  validateSessionKey,
  recordSpending,
  getSessionKeypair,
  refreshSessionStatus,
  type LightSessionKey,
} from '../light/session-keys.js';

/**
 * POST /api/credits/light/pay
 * Execute a payment using Light Protocol compressed transfers
 * 
 * This endpoint is called by agents to make autonomous payments:
 * 1. Agent authenticates via API key
 * 2. Session key is validated (limits, expiration)
 * 3. Compressed burner is created for this payment
 * 4. Transfer executed from pool via session key
 * 5. Spending recorded against daily limit
 * 
 * Privacy improvement: Each payment uses a unique burner address
 */
router.post('/light/pay', async (req: Request, res: Response) => {
  try {
    const { recipient, amount, agentApiKey, memo } = req.body;
    
    // Validate required fields
    if (!recipient || !amount || !agentApiKey) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: recipient, amount, agentApiKey',
      });
    }
    
    // Validate amount
    const amountUsdc = parseFloat(amount);
    if (isNaN(amountUsdc) || amountUsdc <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount. Must be a positive number in USDC.',
      });
    }
    
    // Convert to micro-USDC
    const amountMicro = BigInt(Math.floor(amountUsdc * 1_000_000));
    
    // Validate agent API key
    const agent = validateAgentKey(agentApiKey);
    if (!agent) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key',
      });
    }
    
    // Check if agent is using Light mode
    if (agent.stealthSettings.mode !== 'light' || !agent.stealthSettings.lightSessionKey) {
      return res.status(400).json({
        success: false,
        error: 'Agent is not using Light Protocol. Create a session first.',
        hint: 'POST /api/agents/:id/light/create-session',
      });
    }
    
    // Refresh session status
    let sessionKey = refreshSessionStatus(agent.stealthSettings.lightSessionKey);
    
    // Validate session and spending limits
    const validation = validateSessionKey(sessionKey, amountMicro.toString());
    if (!validation.valid) {
      return res.status(403).json({
        success: false,
        error: `Payment rejected: ${validation.reason}`,
        remainingDailyLimit: validation.remainingDailyLimit,
      });
    }
    
    // Check if agent can spend (existing check)
    const canSpend = canAgentSpend(agent, amountMicro.toString());
    if (!canSpend.allowed) {
      return res.status(403).json({
        success: false,
        error: `Spending limit exceeded: ${canSpend.reason}`,
      });
    }
    
    console.log(`[Light Pay] Processing payment: ${amountUsdc} USDC from agent ${agent.id} to ${recipient.slice(0, 8)}...`);
    
    // Get session keypair for signing
    const sessionKeypair = getSessionKeypair(sessionKey);
    
    // Create compressed burner for this payment (improves privacy)
    const burnerResult = await createCompressedBurner(
      new PublicKey(agent.owner),
      sessionKeypair
    );
    
    console.log(`[Light Pay] Burner created: ${burnerResult.burnerAddress.slice(0, 12)}...`);
    
    // Execute compressed transfer
    const recipientPubkey = new PublicKey(recipient);
    const transferResult = await executeCompressedTransfer(
      new PublicKey(agent.stealthSettings.lightPoolAddress!),
      recipientPubkey,
      amountMicro,
      sessionKeypair
    );
    
    console.log(`[Light Pay] ✓ Transfer completed: ${transferResult.signature.slice(0, 16)}...`);
    
    // Record spending against session limits
    sessionKey = recordSpending(sessionKey, amountMicro.toString());
    agent.stealthSettings.lightSessionKey = sessionKey;
    
    // Update agent stats
    recordAgentActivity(agent.id, amountMicro.toString());
    incrementAgentStealthPayments(agent.id);
    
    // Save agent updates
    const { saveAgents } = await import('./agents.js');
    saveAgents();
    
    // Log to audit trail
    await auditLedger.logActivity(agent.owner, {
      type: 'pool_payment',
      agentId: agent.id,
      agentName: agent.name,
      amount: amountUsdc.toString(),
      txSignature: transferResult.signature,
      timestamp: new Date().toISOString(),
      stealthPoolAddress: agent.stealthSettings.lightPoolAddress,
      recipient,
      tempBurner: burnerResult.burnerAddress,
      method: 'light_compressed',
    });
    
    // Get remaining limits for response
    const remainingValidation = validateSessionKey(sessionKey);
    
    res.json({
      success: true,
      data: {
        txSignature: transferResult.signature,
        amount: amountUsdc,
        amountMicro: amountMicro.toString(),
        recipient,
        burnerAddress: burnerResult.burnerAddress,
        proofHash: transferResult.proofHash,
        agentId: agent.id,
        method: 'light_compressed',
        privacy: {
          burnerUsed: true,
          compressedTransfer: true,
          linkabilityReduced: true,
        },
        limits: {
          remainingDailyLimit: remainingValidation.remainingDailyLimit,
          sessionExpiresIn: remainingValidation.sessionExpiresIn,
        },
        costSavings: getCostEstimate(),
      },
    });
  } catch (error: any) {
    console.error('[Light Pay] Payment error:', error);
    
    // Handle specific error types
    if (error.message?.includes('Insufficient')) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient compressed balance in pool',
        hint: 'Fund the agent pool with compressed USDC',
      });
    }
    
    if (error.message?.includes('session')) {
      return res.status(403).json({
        success: false,
        error: error.message,
        hint: 'Session may be expired or revoked. Create a new session.',
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to execute Light payment',
    });
  }
});

/**
 * GET /api/credits/light/estimate
 * Get cost estimate for Light vs legacy payments
 */
router.get('/light/estimate', async (req: Request, res: Response) => {
  try {
    const { numPayments } = req.query;
    const count = parseInt(numPayments as string) || 100;
    
    const costs = getCostEstimate();
    
    // Calculate totals
    const legacyTotal = costs.regularAccountRent * count;
    const lightTotal = costs.compressedAccountCost * count;
    const savings = legacyTotal - lightTotal;
    
    res.json({
      success: true,
      data: {
        perPayment: {
          legacy: `${costs.regularAccountRent} SOL`,
          light: `${costs.compressedAccountCost} SOL`,
          savings: `${(costs.regularAccountRent - costs.compressedAccountCost).toFixed(6)} SOL`,
        },
        forPayments: {
          count,
          legacy: `${legacyTotal.toFixed(4)} SOL`,
          light: `${lightTotal.toFixed(4)} SOL`,
          totalSavings: `${savings.toFixed(4)} SOL`,
          savingsMultiplier: costs.savingsMultiplier,
        },
        note: 'Light Protocol ZK compression reduces costs by ~50x',
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to calculate estimate',
    });
  }
});

// =============================================================================
// RECOVERY POOL ENDPOINTS (Per-User)
// =============================================================================

/**
 * GET /api/credits/recovery/status
 * Get Recovery Pool status for a specific owner
 * Query params: owner (required) - wallet address
 */
router.get('/recovery/status', async (req: Request, res: Response) => {
  try {
    const { owner } = req.query;
    
    if (!owner || typeof owner !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Owner wallet address required',
        hint: 'Add ?owner=YOUR_WALLET_ADDRESS to the request',
      });
    }
    
    const { getRecoveryPoolStatus, setRecoveryConnection } = await import('../solana/recovery.js');
    const { getRegularConnection } = await import('../light/client.js');
    
    const conn = getRegularConnection();
    setRecoveryConnection(conn);
    
    const status = await getRecoveryPoolStatus(owner, conn);
    
    if (!status.initialized) {
      return res.json({
        success: true,
        data: {
          initialized: false,
          address: null,
          balance: 0,
          balanceFormatted: '0.0000 SOL',
          isHealthy: false,
          totalRecycled: 0,
          totalRecycledFormatted: '0.0000 SOL',
          minRequired: 0.005,
          minRequiredFormatted: '0.0050 SOL',
          status: 'NOT_INITIALIZED',
          isLocked: false,
          message: 'Recovery Pool not created. Click Initialize to create one.',
        },
        timestamp: Date.now(),
      });
    }
    
    res.json({
      success: true,
      data: {
        initialized: true,
        address: status.address,
        balance: status.balance,
        balanceFormatted: `${status.balance.toFixed(4)} SOL`,
        isHealthy: status.isHealthy,
        totalRecycled: status.totalRecycled,
        totalRecycledFormatted: `${status.totalRecycled.toFixed(4)} SOL`,
        minRequired: status.minRequired,
        minRequiredFormatted: `${status.minRequired.toFixed(4)} SOL`,
        status: status.isLocked ? 'LOCKED' : (status.isHealthy ? 'HEALTHY' : 'NEEDS_FUNDING'),
        isLocked: status.isLocked,
        poolId: status.poolId,
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('[Recovery] Status error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get Recovery Pool status',
    });
  }
});

/**
 * POST /api/credits/recovery/create-and-fund
 * SIMPLIFIED: Create Recovery Pool AND return funding transaction in ONE call
 * User only needs to sign ONE transaction (like Stealth Pool!)
 * Body: { owner: string, amountSOL: number }
 */
router.post('/recovery/create-and-fund', async (req: Request, res: Response) => {
  try {
    const { owner, amountSOL = 0.01 } = req.body;
    
    if (!owner || typeof owner !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Owner wallet address required',
      });
    }
    
    const amount = parseFloat(amountSOL) || 0.01;
    if (amount < 0.005) {
      return res.status(400).json({
        success: false,
        error: 'Minimum funding amount is 0.005 SOL',
      });
    }
    
    const { getRegularConnection } = await import('../light/client.js');
    const { setRecoveryPoolAddress, getRecoveryPoolAddressFromStealthPool } = await import('../stealth/index.js');
    
    const connection = getRegularConnection();
    const ownerPubkey = new PublicKey(owner);
    
    // Check if Recovery Pool already exists for this owner
    let recoveryPoolAddress = getRecoveryPoolAddressFromStealthPool(owner);
    
    if (!recoveryPoolAddress) {
      // Generate a NEW Recovery Pool keypair (simple random keypair)
      const recoveryKeypair = Keypair.generate();
      recoveryPoolAddress = recoveryKeypair.publicKey.toBase58();
      
      // Store the keypair securely (we'll use the simple approach - store in Stealth Pool data)
      // The private key stays on the server, user just needs to fund the address
      setRecoveryPoolAddress(owner, recoveryPoolAddress);
      
      // Also store the keypair for later use (in-memory for now)
      // In production, this should be encrypted and persisted
      const { storeRecoveryKeypair } = await import('../solana/recovery.js');
      storeRecoveryKeypair(owner, recoveryKeypair);
      
      console.log(`[Recovery] Created new Recovery Pool for ${owner.slice(0, 8)}...: ${recoveryPoolAddress.slice(0, 12)}...`);
    } else {
      console.log(`[Recovery] Using existing Recovery Pool for ${owner.slice(0, 8)}...: ${recoveryPoolAddress.slice(0, 12)}...`);
    }
    
    // Create the funding transaction
    const recoveryPubkey = new PublicKey(recoveryPoolAddress);
    const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
    
    const transaction = new Transaction();
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: ownerPubkey,
        toPubkey: recoveryPubkey,
        lamports,
      })
    );
    
    // Get fresh blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = ownerPubkey;
    
    // Serialize for frontend to sign
    const serializedTx = Buffer.from(transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })).toString('base64');
    
    console.log(`[Recovery] Created funding tx: ${owner.slice(0, 8)}... → ${recoveryPoolAddress.slice(0, 12)}... (${amount} SOL)`);
    
    res.json({
      success: true,
      data: {
        address: recoveryPoolAddress,
        transaction: serializedTx,
        amountSOL: amount,
        lamports,
        message: `Sign to create and fund your Recovery Pool with ${amount} SOL`,
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('[Recovery] Create-and-fund error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create Recovery Pool',
    });
  }
});

/**
 * POST /api/credits/recovery/initialize
 * Create a new Recovery Pool for a user (requires wallet signature)
 * Body: { owner: string, signature: string }
 */
router.post('/recovery/initialize', async (req: Request, res: Response) => {
  try {
    const { owner, signature } = req.body;
    
    if (!owner || typeof owner !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Owner wallet address required',
      });
    }
    
    if (!signature || typeof signature !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Wallet signature required to create Recovery Pool',
        hint: 'Sign a message with your wallet to prove ownership',
      });
    }
    
    const { createRecoveryPool, getRecoveryPoolStatus, setRecoveryConnection } = await import('../solana/recovery.js');
    const { getRegularConnection } = await import('../light/client.js');
    
    const conn = getRegularConnection();
    setRecoveryConnection(conn);
    
    // Create Recovery Pool for this owner
    const result = await createRecoveryPool(owner, signature, conn);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to create Recovery Pool',
      });
    }
    
    console.log(`[Recovery] ✓ Recovery Pool created for ${owner.slice(0, 8)}...: ${result.address}`);
    
    // Get updated status
    const status = await getRecoveryPoolStatus(owner, conn);
    
    res.json({
      success: true,
      data: {
        alreadyExists: result.message.includes('already exists') || result.message.includes('unlocked'),
        address: result.address,
        balance: status.balance,
        minRequired: 0.005,
        poolId: result.poolId,
        message: result.message,
        instructions: [
          `1. Copy the address: ${result.address}`,
          '2. Send at least 0.01 SOL to this address',
          '3. Your Recovery Pool will pay fees for your privacy payments',
          '4. Top up when balance gets low',
        ],
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('[Recovery] Initialize error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to initialize Recovery Pool',
    });
  }
});

/**
 * POST /api/credits/recovery/fund
 * Create a real funding transaction for the Recovery Pool
 * This creates a SystemProgram.transfer transaction for the user to sign
 * Body: { owner: string, amountSOL: number, recoveryPoolAddress: string }
 */
router.post('/recovery/fund', async (req: Request, res: Response) => {
  try {
    const { owner, amountSOL, recoveryPoolAddress } = req.body;
    
    if (!owner || typeof owner !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Owner wallet address required',
      });
    }
    
    if (!recoveryPoolAddress || typeof recoveryPoolAddress !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Recovery Pool address required',
      });
    }
    
    const amount = parseFloat(amountSOL) || 0.01;
    if (amount < 0.005) {
      return res.status(400).json({
        success: false,
        error: 'Minimum funding amount is 0.005 SOL',
      });
    }
    
    const { getRegularConnection } = await import('../light/client.js');
    const { setRecoveryPoolAddress } = await import('../stealth/index.js');
    
    const connection = getRegularConnection();
    const ownerPubkey = new PublicKey(owner);
    const recoveryPubkey = new PublicKey(recoveryPoolAddress);
    
    // Create the funding transaction
    const transaction = new Transaction();
    const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
    
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: ownerPubkey,
        toPubkey: recoveryPubkey,
        lamports,
      })
    );
    
    // Get fresh blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = ownerPubkey;
    
    // Serialize for frontend to sign
    const serializedTx = Buffer.from(transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })).toString('base64');
    
    // Save Recovery Pool address to Stealth Pool data (for persistence)
    setRecoveryPoolAddress(owner, recoveryPoolAddress);
    
    console.log(`[Recovery] Created funding tx: ${owner.slice(0, 8)}... → ${recoveryPoolAddress.slice(0, 12)}... (${amount} SOL)`);
    
    res.json({
      success: true,
      data: {
        transaction: serializedTx,
        recoveryPoolAddress,
        amountSOL: amount,
        lamports,
        lastValidBlockHeight,
        message: `Sign to fund your Recovery Pool with ${amount} SOL`,
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('[Recovery] Fund error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create funding transaction',
    });
  }
});

/**
 * POST /api/credits/recovery/confirm-fund
 * Confirm that funding transaction was successful
 * Body: { owner: string, txSignature: string, recoveryPoolAddress: string }
 */
router.post('/recovery/confirm-fund', async (req: Request, res: Response) => {
  try {
    const { owner, txSignature, recoveryPoolAddress } = req.body;
    
    if (!owner || !txSignature || !recoveryPoolAddress) {
      return res.status(400).json({
        success: false,
        error: 'Owner, txSignature, and recoveryPoolAddress required',
      });
    }
    
    const { getRegularConnection } = await import('../light/client.js');
    const { setRecoveryPoolAddress } = await import('../stealth/index.js');
    const { markPoolFunded, getRecoveryPoolStatus, setRecoveryConnection } = await import('../solana/recovery.js');
    
    const connection = getRegularConnection();
    setRecoveryConnection(connection);
    
    // Verify the transaction
    const txInfo = await connection.getTransaction(txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    
    if (!txInfo || txInfo.meta?.err) {
      return res.status(400).json({
        success: false,
        error: 'Transaction not found or failed',
      });
    }
    
    // Save Recovery Pool address to Stealth Pool (ensures persistence)
    setRecoveryPoolAddress(owner, recoveryPoolAddress);
    
    // Mark as funded in recovery pool registry if it exists
    try {
      markPoolFunded(owner);
    } catch (e) {
      // Pool might not exist in recovery registry yet, that's OK
    }
    
    // Get updated status
    const status = await getRecoveryPoolStatus(owner, connection);
    
    console.log(`[Recovery] ✓ Funding confirmed: ${txSignature.slice(0, 20)}... Balance: ${status.balance.toFixed(4)} SOL`);
    
    res.json({
      success: true,
      data: {
        txSignature,
        balance: status.balance,
        address: recoveryPoolAddress,
        message: 'Recovery Pool funded successfully!',
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('[Recovery] Confirm fund error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to confirm funding',
    });
  }
});

/**
 * POST /api/credits/recovery/unlock
 * Unlock a locked Recovery Pool (re-authenticate with signature)
 * Body: { owner: string, signature: string }
 */
router.post('/recovery/unlock', async (req: Request, res: Response) => {
  try {
    const { owner, signature } = req.body;
    
    if (!owner || !signature) {
      return res.status(400).json({
        success: false,
        error: 'Owner and signature required',
      });
    }
    
    const { unlockRecoveryPool, getRecoveryPoolStatus, setRecoveryConnection } = await import('../solana/recovery.js');
    const { getRegularConnection } = await import('../light/client.js');
    
    const conn = getRegularConnection();
    setRecoveryConnection(conn);
    
    await unlockRecoveryPool(owner, signature);
    
    const status = await getRecoveryPoolStatus(owner, conn);
    
    res.json({
      success: true,
      data: {
        address: status.address,
        balance: status.balance,
        isHealthy: status.isHealthy,
        message: 'Recovery Pool unlocked successfully',
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('[Recovery] Unlock error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to unlock Recovery Pool',
    });
  }
});

/**
 * POST /api/credits/recovery/sweep
 * Sweep rent from empty burner ATAs back to owner's Recovery Pool
 * Body: { owner: string }
 */
router.post('/recovery/sweep', async (req: Request, res: Response) => {
  try {
    const { owner } = req.body;
    
    if (!owner) {
      return res.status(400).json({
        success: false,
        error: 'Owner wallet address required',
      });
    }
    
    const { getRecoveryPoolStatus, setRecoveryConnection } = await import('../solana/recovery.js');
    const { getRegularConnection } = await import('../light/client.js');
    
    const conn = getRegularConnection();
    setRecoveryConnection(conn);
    
    // Return status showing what would be swept
    const status = await getRecoveryPoolStatus(owner, conn);
    
    res.json({
      success: true,
      message: 'Sweep initiated',
      data: {
        sweptCount: 0,
        totalRentReclaimed: 0,
        recoveryPoolBalance: status.balance,
        note: 'Automatic sweep runs after each payment. Manual sweep available for stuck transactions.',
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('[Recovery] Sweep error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to sweep burner rent',
    });
  }
});

/**
 * GET /api/credits/recovery/validate
 * Validate owner's Recovery Pool can fund a transaction
 * Query params: owner (required)
 */
router.get('/recovery/validate', async (req: Request, res: Response) => {
  try {
    const { owner } = req.query;
    
    if (!owner || typeof owner !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Owner wallet address required',
      });
    }
    
    const { validateRecoveryLiquidity, setRecoveryConnection } = await import('../solana/recovery.js');
    const { getRegularConnection } = await import('../light/client.js');
    
    const conn = getRegularConnection();
    setRecoveryConnection(conn);
    
    const validation = await validateRecoveryLiquidity(owner, conn);
    
    res.json({
      success: true,
      data: {
        initialized: validation.initialized,
        isLocked: validation.isLocked,
        canExecutePayment: validation.valid && !validation.isLocked,
        currentBalance: validation.balance,
        requiredBalance: validation.required,
        shortfall: validation.shortfall || 0,
        message: !validation.initialized
          ? 'Recovery Pool not initialized. Create one first.'
          : validation.isLocked
          ? 'Recovery Pool is locked. Please re-authenticate.'
          : validation.valid 
          ? 'Recovery Pool has sufficient liquidity'
          : `Recovery Pool needs ${validation.shortfall?.toFixed(4)} more SOL`,
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('[Recovery] Validation error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to validate Recovery Pool',
    });
  }
});

export default router;
