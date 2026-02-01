/**
 * Aegix Gateway Types
 * NON-CUSTODIAL: x402 Protocol and Encrypted Audit System
 */

// x402 Protocol Types
export interface PaymentRequiredResponse {
  /** Payment scheme identifier */
  scheme: 'exact';
  /** Network identifier */
  network: 'solana-devnet' | 'solana-mainnet';
  /** Payment amount in lamports or token base units */
  maxAmountRequired: string;
  /** Token mint address (USDC) */
  asset: string;
  /** Recipient address for payment (service provider, not Aegix!) */
  payTo: string;
  /** Unique payment request ID */
  paymentId: string;
  /** Unix timestamp when payment expires */
  expiry: number;
  /** Resource being accessed */
  resource: string;
  /** Human-readable description */
  description?: string;
}

export interface X402PaymentHeader {
  /** Base58 encoded transaction signature */
  signature: string;
  /** Payment request ID this fulfills */
  paymentId: string;
  /** Payer's public key */
  payer: string;
  /** Unix timestamp of payment */
  timestamp: number;
}

// Agent Types
export interface AgentConfig {
  /** Agent unique identifier */
  agentId: string;
  /** Owner's public key */
  owner: string;
  /** Agent's delegated public key */
  agentPubkey: string;
  /** Spending limit per transaction */
  maxSpendPerTx: string;
  /** Daily spending limit */
  dailyLimit: string;
  /** Privacy level */
  privacyLevel: 'standard' | 'shielded' | 'maximum';
  /** Allowed services (empty = all) */
  allowedServices: string[];
  /** Is agent active */
  active: boolean;
}

// Audit Log Types (non-custodial - activity tracking only)
export interface AuditEntry {
  /** Entry ID */
  id: string;
  /** Activity type */
  type: 'agent_payment' | 'payment_confirmed' | 'agent_created' | 'agent_deleted';
  /** Agent ID if applicable */
  agentId?: string;
  /** Resource accessed */
  resource?: string;
  /** Payment amount (for reference, not custody) */
  amount?: string;
  /** Payment ID */
  paymentId?: string;
  /** Transaction signature (on-chain proof) */
  txSignature?: string;
  /** Timestamp */
  timestamp: string;
  /** Whether entry is FHE encrypted */
  encrypted: boolean;
  /** FHE handle for encrypted data */
  fheHandle?: string;
}

// API Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface ProtectedResource {
  /** Resource path */
  path: string;
  /** Price in USDC (6 decimals) */
  price: string;
  /** Resource description */
  description: string;
  /** Accepted payment methods - now PayAI direct only */
  acceptedPayments: ('payai-direct')[];
}

// Gateway State (non-custodial)
export interface GatewayState {
  /** Active payment requests (short-lived, for x402 flow) */
  pendingPayments: Map<string, PaymentRequiredResponse>;
  /** Verified payments (for service provider verification) */
  verifiedPayments: Map<string, X402PaymentHeader>;
}

// PayAI Types
export interface PayAIPaymentRequest {
  /** Facilitator URL */
  facilitator: string;
  /** Network (solana, base, etc) */
  network: string;
  /** Payment action */
  action: 'sign_payment';
  /** Amount in micro USDC */
  amount: string;
  /** Payment ID for tracking */
  paymentId: string;
}
