/**
 * AI Agent Client Simulator
 * Demonstrates how an autonomous agent handles x402 payments through Aegix
 * 
 * Run with: npx tsx test/agent-client.ts
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';

interface PaymentRequired {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  paymentId: string;
  expiry: number;
  resource: string;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  payment?: PaymentRequired;
}

/**
 * Aegix Agent Client
 * Handles automatic payment for protected API resources
 */
class AegixAgentClient {
  private owner: string;
  private agentId: string;
  private gatewayUrl: string;

  constructor(owner: string, agentId: string, gatewayUrl: string = GATEWAY_URL) {
    this.owner = owner;
    this.agentId = agentId;
    this.gatewayUrl = gatewayUrl;
    console.log(`[Agent ${agentId}] Initialized for owner ${owner.slice(0, 16)}...`);
  }

  /**
   * Make a request to a protected API, handling 402 automatically
   */
  async request<T>(endpoint: string, data: unknown): Promise<T | null> {
    console.log(`\n[Agent ${this.agentId}] Requesting ${endpoint}...`);
    
    try {
      // First attempt - may return 402
      const response = await fetch(`${this.gatewayUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json() as ApiResponse<T>;

      // Handle 402 Payment Required
      if (response.status === 402 && result.payment) {
        console.log(`[Agent ${this.agentId}] ⚠️  Payment required for ${endpoint}`);
        console.log(`[Agent ${this.agentId}]    Amount: ${parseInt(result.payment.maxAmountRequired) / 1_000_000} USDC`);
        
        // Pay using confidential credits
        const paid = await this.payWithCredits(result.payment);
        
        if (paid) {
          // Retry with payment proof
          console.log(`[Agent ${this.agentId}] 🔄 Retrying request with payment proof...`);
          
          const retryResponse = await fetch(`${this.gatewayUrl}${endpoint}`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'X-Payment': this.createPaymentHeader(result.payment.paymentId),
            },
            body: JSON.stringify(data),
          });

          const retryResult = await retryResponse.json() as ApiResponse<T>;
          
          if (retryResult.success && retryResult.data) {
            console.log(`[Agent ${this.agentId}] ✅ Request successful!`);
            return retryResult.data;
          }
        }
        
        console.log(`[Agent ${this.agentId}] ❌ Payment or retry failed`);
        return null;
      }

      // Direct success (no payment needed)
      if (result.success && result.data) {
        console.log(`[Agent ${this.agentId}] ✅ Request successful (no payment needed)`);
        return result.data;
      }

      console.log(`[Agent ${this.agentId}] ❌ Request failed: ${result.error}`);
      return null;

    } catch (error) {
      console.log(`[Agent ${this.agentId}] ❌ Error: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Pay for a resource using confidential credits
   */
  private async payWithCredits(paymentInfo: PaymentRequired): Promise<boolean> {
    console.log(`[Agent ${this.agentId}] 💰 Paying with confidential credits...`);
    
    try {
      const response = await fetch(`${this.gatewayUrl}/api/credits/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: this.owner,
          paymentId: paymentInfo.paymentId,
          amount: paymentInfo.maxAmountRequired,
          service: paymentInfo.resource,
        }),
      });

      const result = await response.json() as ApiResponse<{ deductionId: string }>;
      
      if (result.success) {
        console.log(`[Agent ${this.agentId}] ✅ Payment confirmed (FHE deduction)`);
        console.log(`[Agent ${this.agentId}]    Deduction ID: ${result.data?.deductionId}`);
        return true;
      }
      
      console.log(`[Agent ${this.agentId}] ❌ Payment rejected: ${result.error}`);
      return false;
      
    } catch (error) {
      console.log(`[Agent ${this.agentId}] ❌ Payment error: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Create X-PAYMENT header for authenticated requests
   */
  private createPaymentHeader(paymentId: string): string {
    const payload = {
      paymentId,
      payer: this.owner,
      signature: `agent-${this.agentId}-sig-${Date.now()}`,
      timestamp: Date.now(),
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  /**
   * Check remaining balance (encrypted)
   */
  async checkBalance(): Promise<string | null> {
    console.log(`\n[Agent ${this.agentId}] 📊 Checking balance...`);
    
    try {
      const response = await fetch(`${this.gatewayUrl}/api/credits/balance/${this.owner}`);
      const result = await response.json() as ApiResponse<{ encryptedBalance: string }>;
      
      if (result.success && result.data) {
        console.log(`[Agent ${this.agentId}] 🔐 Balance: ${result.data.encryptedBalance.slice(0, 30)}... (encrypted)`);
        return result.data.encryptedBalance;
      }
      return null;
    } catch (error) {
      console.log(`[Agent ${this.agentId}] ❌ Balance check failed`);
      return null;
    }
  }

  /**
   * Get transaction history (encrypted entries)
   */
  async getHistory(): Promise<number> {
    console.log(`\n[Agent ${this.agentId}] 📜 Fetching transaction history...`);
    
    try {
      const response = await fetch(`${this.gatewayUrl}/api/credits/audit/${this.owner}`);
      const result = await response.json() as ApiResponse<{ entries: Array<unknown> }>;
      
      if (result.success && result.data) {
        console.log(`[Agent ${this.agentId}] 📋 Found ${result.data.entries.length} transactions (encrypted)`);
        return result.data.entries.length;
      }
      return 0;
    } catch (error) {
      console.log(`[Agent ${this.agentId}] ❌ History fetch failed`);
      return 0;
    }
  }
}

/**
 * Setup test wallet with credits
 */
async function setupTestWallet(owner: string, amount: string): Promise<boolean> {
  console.log(`\n💳 Setting up test wallet with ${parseInt(amount) / 1_000_000} USDC...`);
  
  try {
    const response = await fetch(`${GATEWAY_URL}/api/credits/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        depositor: owner,
        amount,
        txSignature: `setup-${Date.now()}`,
      }),
    });

    const result = await response.json() as ApiResponse;
    
    if (result.success) {
      console.log(`✅ Wallet funded with ${parseInt(amount) / 1_000_000} USDC`);
      return true;
    }
    console.log(`❌ Setup failed: ${result.error}`);
    return false;
  } catch (error) {
    console.log(`❌ Setup error: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Demo: Simulate multiple AI agents making requests
 */
async function runAgentDemo() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║           AEGIX AI AGENT CLIENT SIMULATOR                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(`\nGateway: ${GATEWAY_URL}`);

  // Setup owner wallet
  const OWNER_WALLET = 'DemoOwnerWallet' + Date.now().toString(36);
  const setupSuccess = await setupTestWallet(OWNER_WALLET, '100000000'); // 100 USDC
  
  if (!setupSuccess) {
    console.log('\n❌ Failed to setup test wallet. Is the gateway running?');
    process.exit(1);
  }

  // Create agents
  const researchAgent = new AegixAgentClient(OWNER_WALLET, 'research-bot');
  const codeAgent = new AegixAgentClient(OWNER_WALLET, 'code-assistant');

  console.log('\n' + '═'.repeat(60));
  console.log('SCENARIO 1: Research Agent makes API calls');
  console.log('═'.repeat(60));

  // Research agent makes completion request
  const completion = await researchAgent.request<{ completion: string }>(
    '/api/ai/completion',
    { prompt: 'What is the capital of France?' }
  );
  
  if (completion) {
    console.log(`\n📝 AI Response: "${completion.completion}"`);
  }

  // Research agent gets embeddings
  const embedding = await researchAgent.request<{ embedding: number[]; dimensions: number }>(
    '/api/ai/embedding',
    { text: 'Privacy-preserving machine learning' }
  );
  
  if (embedding) {
    console.log(`\n🔢 Embedding generated: ${embedding.dimensions} dimensions`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('SCENARIO 2: Code Assistant Agent makes API calls');
  console.log('═'.repeat(60));

  // Code agent makes completion request
  const codeCompletion = await codeAgent.request<{ completion: string }>(
    '/api/ai/completion',
    { prompt: 'Write a hello world function in TypeScript' }
  );
  
  if (codeCompletion) {
    console.log(`\n📝 AI Response: "${codeCompletion.completion}"`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('FINAL STATUS');
  console.log('═'.repeat(60));

  // Check final balance
  await researchAgent.checkBalance();
  
  // Get transaction count
  const txCount = await researchAgent.getHistory();

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    DEMO COMPLETE                          ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  Owner Wallet: ${OWNER_WALLET.slice(0, 30)}...          ║`);
  console.log(`║  Agents Used: 2 (research-bot, code-assistant)            ║`);
  console.log(`║  API Calls Made: 3                                        ║`);
  console.log(`║  Transactions Recorded: ${txCount}                                    ║`);
  console.log(`║  Balance: ENCRYPTED (FHE protected)                       ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('🔐 Privacy Status:');
  console.log('   • All payments routed through Aegix confidential layer');
  console.log('   • Balance encrypted with FHE on Inco Network');
  console.log('   • Transaction history encrypted (owner-only decryption)');
  console.log('   • No public link between wallet and API usage\n');
}

// Run the demo
runAgentDemo().catch(error => {
  console.error('Demo failed:', error);
  process.exit(1);
});

