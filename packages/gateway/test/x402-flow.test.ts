/**
 * x402 Payment Flow Integration Test
 * Simulates AI agent paying for API access through Aegix Gateway
 * 
 * Run with: npx tsx test/x402-flow.test.ts
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';
const TEST_WALLET = 'TestWallet123456789ABCDEF';

interface PaymentRequired {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  asset: string;
  payTo: string;
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

async function fetchJson<T>(url: string, options?: RequestInit): Promise<{ status: number; data: T }> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const data = await response.json() as T;
  return { status: response.status, data };
}

async function testHealthCheck(): Promise<boolean> {
  console.log('\n📋 Test 1: Health Check');
  console.log('─'.repeat(40));
  
  try {
    const { status, data } = await fetchJson<{ status: string; version: string }>(`${GATEWAY_URL}/health`);
    
    if (status === 200 && data.status === 'healthy') {
      console.log(`✅ Gateway is healthy (v${data.version})`);
      return true;
    } else {
      console.log(`❌ Unexpected response: ${JSON.stringify(data)}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Health check failed: ${(error as Error).message}`);
    return false;
  }
}

async function testListResources(): Promise<boolean> {
  console.log('\n📋 Test 2: List Protected Resources');
  console.log('─'.repeat(40));
  
  try {
    const { status, data } = await fetchJson<ApiResponse<Array<{ path: string; price: string }>>>(
      `${GATEWAY_URL}/api/credits/resources`
    );
    
    if (status === 200 && data.success && data.data) {
      console.log(`✅ Found ${data.data.length} protected resources:`);
      data.data.forEach(r => {
        console.log(`   • ${r.path} - ${parseInt(r.price) / 1_000_000} USDC`);
      });
      return true;
    } else {
      console.log(`❌ Failed to list resources`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Error: ${(error as Error).message}`);
    return false;
  }
}

async function test402Response(): Promise<{ success: boolean; paymentId?: string }> {
  console.log('\n📋 Test 3: 402 Payment Required Response');
  console.log('─'.repeat(40));
  
  try {
    const { status, data } = await fetchJson<ApiResponse>(
      `${GATEWAY_URL}/api/ai/completion`,
      {
        method: 'POST',
        body: JSON.stringify({ prompt: 'Hello, AI!' }),
      }
    );
    
    if (status === 402 && data.payment) {
      console.log(`✅ Received 402 Payment Required`);
      console.log(`   Payment ID: ${data.payment.paymentId}`);
      console.log(`   Amount: ${parseInt(data.payment.maxAmountRequired) / 1_000_000} USDC`);
      console.log(`   Network: ${data.payment.network}`);
      console.log(`   Resource: ${data.payment.resource}`);
      console.log(`   Expires: ${new Date(data.payment.expiry * 1000).toLocaleTimeString()}`);
      return { success: true, paymentId: data.payment.paymentId };
    } else {
      console.log(`❌ Expected 402, got ${status}`);
      return { success: false };
    }
  } catch (error) {
    console.log(`❌ Error: ${(error as Error).message}`);
    return { success: false };
  }
}

async function testDepositCredits(): Promise<boolean> {
  console.log('\n📋 Test 4: Deposit Confidential Credits');
  console.log('─'.repeat(40));
  
  try {
    const { status, data } = await fetchJson<ApiResponse<{ depositId: string; status: string }>>(
      `${GATEWAY_URL}/api/credits/deposit`,
      {
        method: 'POST',
        body: JSON.stringify({
          depositor: TEST_WALLET,
          amount: '1000000', // 1 USDC
          txSignature: `test-deposit-${Date.now()}`,
        }),
      }
    );
    
    if (status === 200 && data.success && data.data) {
      console.log(`✅ Credits deposited successfully`);
      console.log(`   Deposit ID: ${data.data.depositId}`);
      console.log(`   Status: ${data.data.status}`);
      return true;
    } else {
      console.log(`❌ Deposit failed: ${data.error}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Error: ${(error as Error).message}`);
    return false;
  }
}

async function testPayWithCredits(): Promise<boolean> {
  console.log('\n📋 Test 5: Pay with Confidential Credits');
  console.log('─'.repeat(40));
  
  try {
    const { status, data } = await fetchJson<ApiResponse<{ deductionId: string; status: string }>>(
      `${GATEWAY_URL}/api/credits/pay`,
      {
        method: 'POST',
        body: JSON.stringify({
          owner: TEST_WALLET,
          paymentId: `test-payment-${Date.now()}`,
          amount: '10000', // 0.01 USDC
          service: '/api/ai/completion',
        }),
      }
    );
    
    if (status === 200 && data.success && data.data) {
      console.log(`✅ Payment successful (FHE deduction)`);
      console.log(`   Deduction ID: ${data.data.deductionId}`);
      console.log(`   Status: ${data.data.status}`);
      return true;
    } else {
      console.log(`❌ Payment failed: ${data.error}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Error: ${(error as Error).message}`);
    return false;
  }
}

async function testEncryptedBalance(): Promise<boolean> {
  console.log('\n📋 Test 6: Check Encrypted Balance');
  console.log('─'.repeat(40));
  
  try {
    const { status, data } = await fetchJson<ApiResponse<{ owner: string; encryptedBalance: string }>>(
      `${GATEWAY_URL}/api/credits/balance/${TEST_WALLET}`
    );
    
    if (status === 200 && data.success && data.data) {
      console.log(`✅ Balance retrieved (encrypted)`);
      console.log(`   Owner: ${data.data.owner.slice(0, 16)}...`);
      console.log(`   Encrypted: ${data.data.encryptedBalance.slice(0, 40)}...`);
      return true;
    } else {
      console.log(`❌ Balance check failed: ${data.error}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Error: ${(error as Error).message}`);
    return false;
  }
}

async function testAuditLog(): Promise<boolean> {
  console.log('\n📋 Test 7: Fetch Confidential Audit Log');
  console.log('─'.repeat(40));
  
  try {
    const { status, data } = await fetchJson<ApiResponse<{ entries: Array<{ service: string; amount: string }> }>>(
      `${GATEWAY_URL}/api/credits/audit/${TEST_WALLET}`
    );
    
    if (status === 200 && data.success && data.data) {
      console.log(`✅ Audit log retrieved`);
      console.log(`   Entries: ${data.data.entries.length}`);
      data.data.entries.slice(0, 3).forEach((e, i) => {
        console.log(`   ${i + 1}. ${e.service} - ${parseInt(e.amount) / 1_000_000} USDC`);
      });
      return true;
    } else {
      console.log(`❌ Audit log failed: ${data.error}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Error: ${(error as Error).message}`);
    return false;
  }
}

async function runAllTests() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║          AEGIX x402 PAYMENT FLOW TEST SUITE               ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(`\nGateway URL: ${GATEWAY_URL}`);
  console.log(`Test Wallet: ${TEST_WALLET}`);

  const results: { name: string; passed: boolean }[] = [];

  // Run all tests
  results.push({ name: 'Health Check', passed: await testHealthCheck() });
  results.push({ name: 'List Resources', passed: await testListResources() });
  
  const test402 = await test402Response();
  results.push({ name: '402 Payment Required', passed: test402.success });
  
  results.push({ name: 'Deposit Credits', passed: await testDepositCredits() });
  results.push({ name: 'Pay with Credits', passed: await testPayWithCredits() });
  results.push({ name: 'Encrypted Balance', passed: await testEncryptedBalance() });
  results.push({ name: 'Audit Log', passed: await testAuditLog() });

  // Summary
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                     TEST RESULTS                          ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  results.forEach(r => {
    const status = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`║  ${status}  ${r.name.padEnd(42)}║`);
  });
  
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  Total: ${passed}/${total} tests passed${' '.repeat(35)}║`);
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // Exit with appropriate code
  process.exit(passed === total ? 0 : 1);
}

// Run tests
runAllTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});

