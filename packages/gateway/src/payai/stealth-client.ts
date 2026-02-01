/**
 * PayAI Stealth Client
 * Signs and submits x402 payments FROM stealth wallets
 * 
 * This is the key to privacy:
 * - Stealth wallet signs the payment (NOT user's main wallet)
 * - PayAI facilitates the transaction
 * - Service provider only sees payment from random stealth address
 */

import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { v4 as uuidv4 } from 'uuid';
import { X402_CONSTANTS } from '../x402/protocol.js';

const PAYAI_FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://facilitator.payai.network';
const PAYAI_NETWORK = process.env.PAYAI_NETWORK || 'solana';

export interface PayAIPaymentRequest {
  paymentId: string;
  amount: string;
  recipient: string;
  network: string;
  asset: string;
  resource?: string;
}

export interface PayAISignedPayment {
  paymentId: string;
  payer: string;        // The stealth wallet address (NOT user's main wallet!)
  signature: string;    // Ed25519 signature from stealth keypair
  message: string;      // Signed message
  timestamp: number;
  network: string;
  asset: string;
}

/**
 * Create a PayAI-compatible signed payment from a stealth wallet
 * 
 * The stealth keypair signs the payment - user's main wallet is NEVER revealed!
 */
export function createStealthPayAIPayment(
  stealthKeypair: Keypair,
  paymentRequest: PayAIPaymentRequest
): PayAISignedPayment {
  const payer = stealthKeypair.publicKey.toBase58();
  const timestamp = Date.now();
  
  // Create the x402 payment message (what PayAI expects)
  const message = JSON.stringify({
    paymentId: paymentRequest.paymentId,
    payer: payer,  // Stealth address, NOT user
    recipient: paymentRequest.recipient,
    amount: paymentRequest.amount,
    asset: paymentRequest.asset,
    network: paymentRequest.network,
    resource: paymentRequest.resource || 'x402-stealth-payment',
    timestamp: timestamp,
  });
  
  // Sign with stealth keypair - this is the privacy magic
  // User's wallet key NEVER touches this signature!
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = nacl.sign.detached(messageBytes, stealthKeypair.secretKey);
  const signature = bs58.encode(signatureBytes);
  
  console.log(`[PayAI Stealth] 🔏 Created signed payment from stealth: ${payer.slice(0, 12)}...`);
  
  return {
    paymentId: paymentRequest.paymentId,
    payer,
    signature,
    message,
    timestamp,
    network: paymentRequest.network,
    asset: paymentRequest.asset,
  };
}

/**
 * Encode signed payment as x402 header for submission
 */
export function encodeStealthPaymentHeader(signedPayment: PayAISignedPayment): string {
  return Buffer.from(JSON.stringify({
    signature: signedPayment.signature,
    paymentId: signedPayment.paymentId,
    payer: signedPayment.payer,
    timestamp: signedPayment.timestamp,
  })).toString('base64');
}

/**
 * Submit signed stealth payment to PayAI facilitator
 * 
 * PayAI processes the payment:
 * - Service provider receives funds
 * - Service provider only sees stealth address
 * - User's main wallet remains hidden!
 */
export async function submitStealthToPayAI(signedPayment: PayAISignedPayment): Promise<{
  success: boolean;
  txSignature?: string;
  error?: string;
  method: 'payai' | 'direct';
}> {
  try {
    console.log(`[PayAI Stealth] 🚀 Submitting x402 payment from stealth wallet`);
    console.log(`[PayAI Stealth]    PaymentID: ${signedPayment.paymentId}`);
    console.log(`[PayAI Stealth]    Payer (stealth): ${signedPayment.payer.slice(0, 12)}...`);
    
    // Create the x402 payment header
    const paymentHeader = encodeStealthPaymentHeader(signedPayment);
    
    // Submit to PayAI facilitator
    // PayAI endpoint: POST /verify or /settle (depends on their API)
    const response = await fetch(`${PAYAI_FACILITATOR_URL}/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment': paymentHeader,
        'X-Payment-Signature': signedPayment.signature,
      },
      body: JSON.stringify({
        paymentHeader,
        paymentId: signedPayment.paymentId,
        payer: signedPayment.payer,
        message: signedPayment.message,
        signature: signedPayment.signature,
        timestamp: signedPayment.timestamp,
        network: signedPayment.network,
        // Note: We DON'T send user's main wallet - only stealth address
      }),
    });
    
    // If PayAI isn't available, we'll fall back to direct transfer
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.warn(`[PayAI Stealth] ⚠️ Facilitator returned ${response.status}: ${errorText}`);
      console.warn(`[PayAI Stealth] Will use direct transfer fallback`);
      return { 
        success: false, 
        error: `PayAI returned ${response.status}`,
        method: 'direct',
      };
    }
    
    const result = await response.json();
    
    if (result.txSignature || result.settled) {
      console.log(`[PayAI Stealth] ✅ x402 payment processed via PayAI!`);
      console.log(`[PayAI Stealth]    TX: ${(result.txSignature || 'unknown').slice(0, 20)}...`);
      return { 
        success: true, 
        txSignature: result.txSignature || result.transaction,
        method: 'payai',
      };
    }
    
    console.warn(`[PayAI Stealth] ⚠️ PayAI response missing txSignature:`, result);
    return { 
      success: false, 
      error: result.error || 'PayAI response missing transaction',
      method: 'direct',
    };
    
  } catch (error: any) {
    console.error(`[PayAI Stealth] ❌ Submission failed:`, error.message);
    return { 
      success: false, 
      error: error.message,
      method: 'direct',
    };
  }
}

/**
 * Helper: Create a full x402 payment request for stealth wallets
 */
export function createStealthX402Request(
  stealthKeypair: Keypair,
  recipientAddress: string,
  amountMicroUsdc: string,
  resource?: string
): { signedPayment: PayAISignedPayment; paymentId: string } {
  const paymentId = `stealth-x402-${uuidv4().substring(0, 8)}`;
  
  const paymentRequest: PayAIPaymentRequest = {
    paymentId,
    amount: amountMicroUsdc,
    recipient: recipientAddress,
    network: PAYAI_NETWORK === 'solana' ? 'solana-mainnet' : PAYAI_NETWORK,
    asset: X402_CONSTANTS.USDC_MAINNET,
    resource,
  };
  
  const signedPayment = createStealthPayAIPayment(stealthKeypair, paymentRequest);
  
  return { signedPayment, paymentId };
}

/**
 * Get PayAI facilitator info
 */
export function getStealthPayAIInfo() {
  return {
    facilitatorUrl: PAYAI_FACILITATOR_URL,
    network: PAYAI_NETWORK,
    protocol: 'x402',
    privacyFeatures: [
      'Stealth wallet signs payment (NOT user)',
      'Service provider sees random address',
      'User main wallet is NEVER revealed',
      'FHE-encrypted owner↔stealth mapping',
    ],
  };
}

