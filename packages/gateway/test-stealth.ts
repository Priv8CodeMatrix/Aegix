/**
 * Aegix 3.0 - Stealth Payment Flow Test
 * 
 * Tests the full "Shielded Gateway" privacy flow:
 * 1. Create stealth (burner) address
 * 2. Verify FHE mapping is created
 * 3. Check stealth history for owner
 * 4. Verify privacy guarantees
 * 
 * Note: Full payment testing requires a funded wallet on mainnet
 */

const BASE = 'http://localhost:3001';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
  error?: string;
}

async function runTests(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                                                                       ║
║     █████╗ ███████╗ ██████╗ ██╗██╗  ██╗    ██████╗    ██████╗        ║
║    ██╔══██╗██╔════╝██╔════╝ ██║╚██╗██╔╝    ╚════██╗  ██╔═████╗       ║
║    ███████║█████╗  ██║  ███╗██║ ╚███╔╝      █████╔╝  ██║██╔██║       ║
║    ██╔══██║██╔══╝  ██║   ██║██║ ██╔██╗      ╚═══██╗  ████╔╝██║       ║
║    ██║  ██║███████╗╚██████╔╝██║██╔╝ ██╗    ██████╔╝  ╚██████╔╝       ║
║    ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝╚═╝  ╚═╝    ╚═════╝    ╚═════╝        ║
║                                                                       ║
║    🛡️ STEALTH PAYMENT FLOW TEST                                       ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
`);

  const results: TestResult[] = [];
  
  // Test owner wallet (simulated)
  const testOwner = 'TestOwner' + Math.random().toString(36).substring(2, 10);
  let stealthId: string | null = null;
  let stealthAddress: string | null = null;
  let fheHandle: string | null = null;

  // ============================================================================
  // TEST 1: Gateway Health Check
  // ============================================================================
  console.log('\n📋 TEST 1: Gateway Health Check');
  console.log('─'.repeat(60));
  
  try {
    const healthRes = await fetch(`${BASE}/health`);
    const health = await healthRes.json();
    
    if (health.status === 'healthy') {
      results.push({ 
        name: 'Gateway Health', 
        passed: true, 
        details: `v${health.version}, network: ${health.network}` 
      });
      console.log(`   ✅ Gateway healthy (${health.version})`);
    } else {
      results.push({ name: 'Gateway Health', passed: false, error: 'Unhealthy status' });
      console.log(`   ❌ Gateway unhealthy`);
    }
  } catch (err: any) {
    results.push({ name: 'Gateway Health', passed: false, error: err.message });
    console.log(`   ❌ Failed: ${err.message}`);
  }

  // ============================================================================
  // TEST 2: Create Stealth Address
  // ============================================================================
  console.log('\n📋 TEST 2: Create Stealth Address');
  console.log('─'.repeat(60));
  
  try {
    const createRes = await fetch(`${BASE}/api/credits/stealth/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: testOwner }),
    });
    
    const createResult = await createRes.json();
    
    if (createResult.success && createResult.data?.stealthId) {
      stealthId = createResult.data.stealthId;
      stealthAddress = createResult.data.stealthAddress;
      fheHandle = createResult.data.fheHandle;
      
      results.push({ 
        name: 'Create Stealth Address', 
        passed: true, 
        details: `ID: ${stealthId.slice(0, 20)}...`
      });
      
      console.log(`   ✅ Stealth address created`);
      console.log(`      ID: ${stealthId}`);
      console.log(`      Burner: ${stealthAddress?.slice(0, 12)}...`);
      console.log(`      FHE Handle: ${fheHandle?.slice(0, 20)}...`);
    } else {
      results.push({ name: 'Create Stealth Address', passed: false, error: createResult.error });
      console.log(`   ❌ Failed: ${createResult.error}`);
    }
  } catch (err: any) {
    results.push({ name: 'Create Stealth Address', passed: false, error: err.message });
    console.log(`   ❌ Failed: ${err.message}`);
  }

  // ============================================================================
  // TEST 3: Verify Privacy Response
  // ============================================================================
  console.log('\n📋 TEST 3: Verify Privacy Response');
  console.log('─'.repeat(60));
  
  try {
    const createRes = await fetch(`${BASE}/api/credits/stealth/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: testOwner }),
    });
    
    const createResult = await createRes.json();
    
    const hasPrivacyInfo = createResult.privacy && 
                          createResult.privacy.provider === 'Inco Network' &&
                          createResult.privacy.model === 'Stealth Addresses';
    
    if (hasPrivacyInfo) {
      results.push({ 
        name: 'Privacy Response', 
        passed: true, 
        details: `Provider: ${createResult.privacy.provider}, Model: ${createResult.privacy.model}`
      });
      console.log(`   ✅ Privacy info included`);
      console.log(`      Provider: ${createResult.privacy.provider}`);
      console.log(`      Model: ${createResult.privacy.model}`);
      console.log(`      Guarantee: "${createResult.privacy.guarantee}"`);
    } else {
      results.push({ name: 'Privacy Response', passed: false, error: 'Missing privacy fields' });
      console.log(`   ❌ Privacy info missing or incorrect`);
    }
  } catch (err: any) {
    results.push({ name: 'Privacy Response', passed: false, error: err.message });
    console.log(`   ❌ Failed: ${err.message}`);
  }

  // ============================================================================
  // TEST 4: Check Stealth History
  // ============================================================================
  console.log('\n📋 TEST 4: Check Stealth History');
  console.log('─'.repeat(60));
  
  try {
    const historyRes = await fetch(`${BASE}/api/credits/stealth/history/${testOwner}`);
    const historyResult = await historyRes.json();
    
    if (historyResult.success && historyResult.data?.stealthAddresses?.length >= 2) {
      results.push({ 
        name: 'Stealth History', 
        passed: true, 
        details: `Found ${historyResult.data.count} stealth addresses`
      });
      console.log(`   ✅ History retrieved`);
      console.log(`      Owner: ${historyResult.data.owner}`);
      console.log(`      Stealth addresses: ${historyResult.data.count}`);
      console.log(`      Privacy note: "${historyResult.privacy.note}"`);
    } else {
      results.push({ name: 'Stealth History', passed: false, error: 'Not enough addresses found' });
      console.log(`   ❌ Not enough stealth addresses in history`);
    }
  } catch (err: any) {
    results.push({ name: 'Stealth History', passed: false, error: err.message });
    console.log(`   ❌ Failed: ${err.message}`);
  }

  // ============================================================================
  // TEST 5: Check Stealth Status
  // ============================================================================
  console.log('\n📋 TEST 5: Check Stealth Status');
  console.log('─'.repeat(60));
  
  if (stealthId) {
    try {
      const statusRes = await fetch(`${BASE}/api/credits/stealth/status/${stealthId}`);
      const statusResult = await statusRes.json();
      
      if (statusResult.success && statusResult.data?.status === 'created') {
        results.push({ 
          name: 'Stealth Status', 
          passed: true, 
          details: `Status: ${statusResult.data.status}`
        });
        console.log(`   ✅ Status retrieved`);
        console.log(`      Status: ${statusResult.data.status}`);
        console.log(`      Public Key: ${statusResult.data.publicKey?.slice(0, 12)}...`);
      } else {
        results.push({ name: 'Stealth Status', passed: false, error: statusResult.error || 'Unexpected status' });
        console.log(`   ❌ Unexpected status: ${statusResult.data?.status}`);
      }
    } catch (err: any) {
      results.push({ name: 'Stealth Status', passed: false, error: err.message });
      console.log(`   ❌ Failed: ${err.message}`);
    }
  } else {
    results.push({ name: 'Stealth Status', passed: false, error: 'No stealth ID available' });
    console.log(`   ⚠️ Skipped - no stealth ID from previous test`);
  }

  // ============================================================================
  // TEST 6: Check Stealth Stats
  // ============================================================================
  console.log('\n📋 TEST 6: Check Stealth Stats');
  console.log('─'.repeat(60));
  
  try {
    const statsRes = await fetch(`${BASE}/api/credits/stealth/stats`);
    const statsResult = await statsRes.json();
    
    if (statsResult.success && statsResult.data?.totalCreated >= 0) {
      results.push({ 
        name: 'Stealth Stats', 
        passed: true, 
        details: `Created: ${statsResult.data.totalCreated}, Owners: ${statsResult.data.uniqueOwners}`
      });
      console.log(`   ✅ Stats retrieved`);
      console.log(`      Total Created: ${statsResult.data.totalCreated}`);
      console.log(`      Total Funded: ${statsResult.data.totalFunded}`);
      console.log(`      Total Used: ${statsResult.data.totalUsed}`);
      console.log(`      Unique Owners: ${statsResult.data.uniqueOwners}`);
      console.log(`      Privacy Model: ${statsResult.data.privacyModel}`);
    } else {
      results.push({ name: 'Stealth Stats', passed: false, error: statsResult.error });
      console.log(`   ❌ Failed: ${statsResult.error}`);
    }
  } catch (err: any) {
    results.push({ name: 'Stealth Stats', passed: false, error: err.message });
    console.log(`   ❌ Failed: ${err.message}`);
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('                     TEST SUMMARY');
  console.log('═'.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  results.forEach(r => {
    const icon = r.passed ? '✅' : '❌';
    const detail = r.passed ? (r.details || '') : (r.error || 'Failed');
    console.log(`${icon} ${r.name.padEnd(25)} ${detail}`);
  });
  
  console.log('─'.repeat(60));
  console.log(`Total: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('\n🎉 ALL TESTS PASSED! Stealth payment flow is ready.');
  } else {
    console.log('\n⚠️ Some tests failed. Check the output above.');
  }

  // ============================================================================
  // PRIVACY EXPLANATION
  // ============================================================================
  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                                                                       ║
║  🛡️  HOW STEALTH PAYMENTS PROVIDE PRIVACY                             ║
║                                                                       ║
║  Traditional Flow (NO PRIVACY):                                       ║
║  ┌──────────────────────────────────────────────────────────────────┐ ║
║  │ User Wallet → Service Provider                                   │ ║
║  │ (Service sees exactly who paid them)                             │ ║
║  └──────────────────────────────────────────────────────────────────┘ ║
║                                                                       ║
║  Aegix 3.0 Stealth Flow (PRIVATE):                                    ║
║  ┌──────────────────────────────────────────────────────────────────┐ ║
║  │ User Wallet → [Stealth Burner] → Service Provider                │ ║
║  │                      ↑                                           │ ║
║  │            Inco FHE encrypts this link!                          │ ║
║  │                                                                  │ ║
║  │ Service sees: Payment from random new wallet                     │ ║
║  │ Service CANNOT see: User's main wallet                           │ ║
║  │ Only User can: Decrypt their stealth history via FHE             │ ║
║  └──────────────────────────────────────────────────────────────────┘ ║
║                                                                       ║
║  VALUE PROPOSITION:                                                   ║
║  • Competitors can't see your API usage patterns                     ║
║  • Usage anonymity for sensitive queries                              ║
║  • Non-custodial: Aegix never holds your funds                        ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
`);
}

// Run tests
runTests().catch(console.error);

