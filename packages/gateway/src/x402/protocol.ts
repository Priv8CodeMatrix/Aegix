/**
 * x402 Protocol Implementation
 * Handles HTTP 402 Payment Required flow for AI agents
 */

import { v4 as uuidv4 } from 'uuid';
import type { PaymentRequiredResponse, X402PaymentHeader, ProtectedResource } from '../types.js';

// USDC Mint Addresses
const USDC_DEVNET_MINT = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';
const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PAYMENT_EXPIRY_SECONDS = 300; // 5 minutes

// =============================================================================
// SECURITY: On-Chain Block Height Expiry
// Prevents delayed transaction submission attacks
// =============================================================================

/**
 * Number of blocks for on-chain transaction expiry
 * At ~400ms per slot, 50 blocks = ~25 seconds
 * This is tighter than Solana's default ~150 blocks (~60 seconds)
 * to prevent attackers from holding signed transactions
 */
export const PAYMENT_EXPIRY_BLOCKS = 50;

/**
 * Calculate a tight on-chain expiry block height for payment transactions
 * This ensures transactions cannot be submitted after a short window
 * 
 * @param currentBlockHeight - Current block height from getLatestBlockhash
 * @returns Tightened lastValidBlockHeight
 */
export function calculateTightExpiry(currentBlockHeight: number): number {
  // Solana's default is currentBlockHeight + 150
  // We tighten this to currentBlockHeight + PAYMENT_EXPIRY_BLOCKS
  return currentBlockHeight + PAYMENT_EXPIRY_BLOCKS;
}

/**
 * Create a 402 Payment Required response for a protected resource
 */
export function createPaymentRequired(
  resource: ProtectedResource,
  payToAddress: string,
  network: 'solana-devnet' | 'solana-mainnet' = 'solana-mainnet'
): PaymentRequiredResponse {
  const paymentId = uuidv4();
  const expiry = Math.floor(Date.now() / 1000) + PAYMENT_EXPIRY_SECONDS;
  
  // Use correct USDC mint based on network
  const usdcMint = network === 'solana-mainnet' ? USDC_MAINNET_MINT : USDC_DEVNET_MINT;

  return {
    scheme: 'exact',
    network,
    maxAmountRequired: resource.price,
    asset: usdcMint,
    payTo: payToAddress,
    paymentId,
    expiry,
    resource: resource.path,
    description: resource.description,
  };
}

/**
 * Parse X-PAYMENT header from incoming request
 */
export function parsePaymentHeader(headerValue: string): X402PaymentHeader | null {
  try {
    // Header format: base64 encoded JSON
    const decoded = Buffer.from(headerValue, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);

    // Validate required fields
    if (!parsed.signature || !parsed.paymentId || !parsed.payer || !parsed.timestamp) {
      console.error('[x402] Invalid payment header: missing required fields');
      return null;
    }

    return {
      signature: parsed.signature,
      paymentId: parsed.paymentId,
      payer: parsed.payer,
      timestamp: parsed.timestamp,
    };
  } catch (error) {
    console.error('[x402] Failed to parse payment header:', error);
    return null;
  }
}

/**
 * Encode payment header for agent response
 */
export function encodePaymentHeader(payment: X402PaymentHeader): string {
  const json = JSON.stringify(payment);
  return Buffer.from(json).toString('base64');
}

/**
 * Validate payment hasn't expired
 */
export function isPaymentValid(payment: PaymentRequiredResponse): boolean {
  const now = Math.floor(Date.now() / 1000);
  return payment.expiry > now;
}

/**
 * Generate 402 response headers
 */
export function get402Headers(payment: PaymentRequiredResponse): Record<string, string> {
  return {
    'WWW-Authenticate': `X402 scheme="${payment.scheme}", network="${payment.network}"`,
    'X-Payment-Required': Buffer.from(JSON.stringify(payment)).toString('base64'),
    'Content-Type': 'application/json',
  };
}

/**
 * x402 Protocol constants
 */
export const X402_CONSTANTS = {
  HEADER_NAME: 'X-Payment',
  REQUIRED_HEADER: 'X-Payment-Required',
  AUTH_SCHEME: 'X402',
  USDC_DEVNET: USDC_DEVNET_MINT,
  USDC_MAINNET: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDC_DECIMALS: 6,
} as const;

