/**
 * PayAI Facilitator Integration
 * https://facilitator.payai.network/#get-started
 * 
 * No API key required - just plug and play
 * Supports: solana, solana-devnet, base, polygon, avalanche, sei, iotex, peaq, xlayer, skale
 */

const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://facilitator.payai.network';
const PAYAI_NETWORK = process.env.PAYAI_NETWORK || 'solana';

export interface PayAIVerifyRequest {
  /** The x402 payment header from the client */
  paymentHeader: string;
  /** The payment requirements that were sent */
  paymentRequirements: {
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    description?: string;
  };
}

export interface PayAIVerifyResponse {
  valid: boolean;
  payer?: string;
  amount?: string;
  error?: string;
}

export interface PayAISettleRequest {
  /** The verified payment header */
  paymentHeader: string;
  /** Merchant's receiving address */
  merchantAddress: string;
}

export interface PayAISettleResponse {
  settled: boolean;
  txSignature?: string;
  error?: string;
}

/**
 * PayAI Facilitator Client
 * Handles payment verification and settlement via PayAI
 */
export class PayAIFacilitator {
  private baseUrl: string;
  private network: string;

  constructor(baseUrl?: string, network?: string) {
    this.baseUrl = baseUrl || FACILITATOR_URL;
    this.network = network || PAYAI_NETWORK;
    console.log(`[PayAI] Facilitator initialized: ${this.baseUrl} (network: ${this.network})`);
  }

  /**
   * Verify a payment via PayAI facilitator
   * The facilitator checks if the payment is valid on-chain
   */
  async verify(request: PayAIVerifyRequest): Promise<PayAIVerifyResponse> {
    try {
      console.log(`[PayAI] Verifying payment...`);
      
      const response = await fetch(`${this.baseUrl}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...request,
          network: this.network,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[PayAI] Verify failed: ${error}`);
        return { valid: false, error: `Verification failed: ${response.status}` };
      }

      const result = await response.json() as PayAIVerifyResponse;
      console.log(`[PayAI] Verification result: ${result.valid ? 'VALID' : 'INVALID'}`);
      return result;

    } catch (error) {
      console.error(`[PayAI] Verify error:`, error);
      return { valid: false, error: (error as Error).message };
    }
  }

  /**
   * Settle a verified payment via PayAI facilitator
   * The facilitator handles the actual fund transfer
   */
  async settle(request: PayAISettleRequest): Promise<PayAISettleResponse> {
    try {
      console.log(`[PayAI] Settling payment...`);
      
      const response = await fetch(`${this.baseUrl}/settle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...request,
          network: this.network,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[PayAI] Settle failed: ${error}`);
        return { settled: false, error: `Settlement failed: ${response.status}` };
      }

      const result = await response.json() as PayAISettleResponse;
      console.log(`[PayAI] Settlement result: ${result.settled ? 'SUCCESS' : 'FAILED'}`);
      return result;

    } catch (error) {
      console.error(`[PayAI] Settle error:`, error);
      return { settled: false, error: (error as Error).message };
    }
  }

  /**
   * List available merchants from PayAI (auto-discovery)
   */
  async listMerchants(): Promise<unknown[]> {
    try {
      const response = await fetch(`${this.baseUrl}/list`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return [];
      }

      return await response.json() as unknown[];
    } catch (error) {
      console.error(`[PayAI] List error:`, error);
      return [];
    }
  }

  /**
   * Get facilitator info
   */
  getInfo() {
    return {
      url: this.baseUrl,
      network: this.network,
      features: [
        'No API keys required',
        'Gasless experience',
        'Auto-discovery in x402 Bazaar',
        'OFAC compliance screening',
      ],
    };
  }
}

// Singleton instance
let facilitatorInstance: PayAIFacilitator | null = null;

export function getPayAIFacilitator(): PayAIFacilitator {
  if (!facilitatorInstance) {
    facilitatorInstance = new PayAIFacilitator();
  }
  return facilitatorInstance;
}

/**
 * PayAI supported networks
 */
export const PAYAI_NETWORKS = {
  // Solana
  SOLANA: 'solana',
  SOLANA_DEVNET: 'solana-devnet',
  // EVM
  BASE: 'base',
  BASE_SEPOLIA: 'base-sepolia',
  POLYGON: 'polygon',
  POLYGON_AMOY: 'polygon-amoy',
  AVALANCHE: 'avalanche',
  AVALANCHE_FUJI: 'avalanche-fuji',
  SEI: 'sei',
  SEI_TESTNET: 'sei-testnet',
  PEAQ: 'peaq',
  IOTEX: 'iotex',
  XLAYER: 'xlayer',
  XLAYER_TESTNET: 'xlayer-testnet',
  SKALE: 'skale-base',
  SKALE_SEPOLIA: 'skale-base-sepolia',
} as const;

