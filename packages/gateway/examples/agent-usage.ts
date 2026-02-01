/**
 * Aegix Agent SDK Example
 * 
 * This file demonstrates how an AI agent can use the Aegix gateway
 * to make anonymous payments for API services.
 * 
 * Requirements:
 * 1. Agent must be registered via the dashboard
 * 2. Agent receives an API key (aegix_agent_xxx...)
 * 3. Owner must have deposited confidential credits
 * 
 * Run with: npx tsx examples/agent-usage.ts
 */

const GATEWAY_URL = process.env.AEGIX_GATEWAY_URL || 'http://localhost:3001';

/**
 * AegixAgent - SDK for making anonymous payments
 */
class AegixAgent {
  private apiKey: string;
  private gatewayUrl: string;

  constructor(apiKey: string, gatewayUrl: string = GATEWAY_URL) {
    this.apiKey = apiKey;
    this.gatewayUrl = gatewayUrl;
    
    if (!apiKey.startsWith('aegix_agent_')) {
      throw new Error('Invalid API key format. Keys should start with aegix_agent_');
    }
  }

  /**
   * Make a payment for accessing a protected resource
   * The payment is anonymous - the service provider cannot identify the owner
   */
  async pay(resource: string, amount?: string): Promise<{ paymentId: string; success: boolean }> {
    const response = await fetch(`${this.gatewayUrl}/api/credits/agent/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Key': this.apiKey,
      },
      body: JSON.stringify({
        resource,
        amount,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Payment failed');
    }

    return {
      paymentId: data.data.paymentId,
      success: true,
    };
  }

  /**
   * Access a protected API with automatic payment
   * This is the main method agents should use
   */
  async accessProtectedAPI(
    url: string, 
    options: RequestInit = {}
  ): Promise<Response> {
    // First attempt - might get 402
    const initialResponse = await fetch(url, options);

    if (initialResponse.status === 402) {
      console.log('[Agent] Received 402 Payment Required');
      
      // Parse the payment details from response
      const paymentDetails = await initialResponse.json();
      const resource = paymentDetails.payment?.resource || new URL(url).pathname;
      const amount = paymentDetails.payment?.maxAmountRequired;

      console.log(`[Agent] Paying ${parseInt(amount || '10000') / 1_000_000} USDC for ${resource}`);

      // Make the payment
      const payment = await this.pay(resource, amount);
      console.log(`[Agent] Payment complete: ${payment.paymentId}`);

      // Retry the request with payment proof
      const retryResponse = await fetch(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          'X-Payment': JSON.stringify({
            paymentId: payment.paymentId,
            scheme: 'aegix-confidential',
          }),
        },
      });

      return retryResponse;
    }

    return initialResponse;
  }
}

// ============================================================
// EXAMPLE USAGE
// ============================================================

async function main() {
  console.log('========================================');
  console.log('   Aegix Agent SDK Example');
  console.log('========================================\n');

  // Your agent API key (get this from the Aegix Dashboard)
  // IMPORTANT: Never hardcode this in production!
  const AGENT_API_KEY = process.env.AEGIX_AGENT_KEY || 'aegix_agent_demo_key_for_testing';

  // Check if using demo key
  if (AGENT_API_KEY.includes('demo')) {
    console.log('⚠️  Using demo API key. Create a real agent at http://localhost:3000\n');
  }

  try {
    // Initialize the agent
    const agent = new AegixAgent(AGENT_API_KEY);
    console.log('✅ Agent initialized\n');

    // Example 1: Direct payment
    console.log('--- Example 1: Direct Payment ---');
    try {
      const payment = await agent.pay('/api/ai/completion');
      console.log(`Payment ID: ${payment.paymentId}`);
      console.log('Service provider only sees the payment ID - your identity is hidden!\n');
    } catch (error: any) {
      console.log(`Payment failed: ${error.message}`);
      console.log('Tip: Make sure the owner has deposited credits first.\n');
    }

    // Example 2: Access protected API with auto-payment
    console.log('--- Example 2: Protected API Access ---');
    try {
      const response = await agent.accessProtectedAPI(
        `${GATEWAY_URL}/api/ai/completion`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Hello from AI agent!' }),
        }
      );
      
      const data = await response.json();
      console.log('API Response:', JSON.stringify(data, null, 2), '\n');
    } catch (error: any) {
      console.log(`API access failed: ${error.message}\n`);
    }

    // Example 3: Check available resources
    console.log('--- Example 3: Available Resources ---');
    const resourcesResponse = await fetch(`${GATEWAY_URL}/api/credits/resources`);
    const resources = await resourcesResponse.json();
    
    if (resources.success) {
      console.log('Protected APIs you can access:');
      resources.data.forEach((r: any) => {
        console.log(`  • ${r.path} - ${parseInt(r.price) / 1_000_000} USDC`);
      });
    }

  } catch (error: any) {
    console.error('Error:', error.message);
  }

  console.log('\n========================================');
  console.log('   How it works:');
  console.log('========================================');
  console.log(`
1. Owner registers an agent in the Aegix Dashboard
2. Owner deposits USDC to get Confidential Credits
3. Agent receives an API key (aegix_agent_xxx...)
4. Agent uses the API key to make anonymous payments
5. Service providers verify payments without seeing WHO paid
6. Owner can view their agent's activity in encrypted audit logs

Privacy Guarantees:
✓ Service provider cannot see owner's wallet address
✓ Service provider cannot link payments to owner
✓ Agent activity is encrypted in Inco FHE
✓ Only owner can decrypt their own audit logs
`);
}

main().catch(console.error);

// ============================================================
// EXPORT FOR USE AS A MODULE
// ============================================================

export { AegixAgent };

