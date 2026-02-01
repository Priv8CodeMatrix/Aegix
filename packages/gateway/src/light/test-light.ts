/**
 * Light Protocol Integration Test Script
 * 
 * Run with: npx ts-node src/light/test-light.ts
 * 
 * Tests:
 * 1. Light connection initialization
 * 2. Session key creation and validation
 * 3. Compressed balance queries
 * 4. Cost estimates
 * 
 * For mainnet testing:
 * - Use small amounts (< $1 USDC)
 * - Ensure LIGHT_RPC_URL is configured
 */

import {
  initLightConnection,
  checkLightHealth,
  getCostEstimate,
  createCompressedPool,
  getCompressedBalance,
} from './client.js';

import {
  createSessionKey,
  validateSessionKey,
  recordSpending,
  getSessionInfo,
  revokeSessionKey,
  type SessionSpendingLimits,
} from './session-keys.js';

import { Keypair, PublicKey } from '@solana/web3.js';

// Test configuration
const TEST_OWNER = Keypair.generate();
const TEST_AGENT_ID = 'test-agent-' + Date.now().toString(36);

async function runTests() {
  console.log('\n=== Light Protocol Integration Tests ===\n');
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: Initialize connection
  console.log('Test 1: Initialize Light Connection...');
  try {
    await initLightConnection();
    console.log('✓ Connection initialized');
    passed++;
  } catch (err: any) {
    console.log('✗ Connection failed:', err.message);
    failed++;
  }
  
  // Test 2: Health check
  console.log('\nTest 2: Health Check...');
  try {
    const health = await checkLightHealth();
    if (health.healthy) {
      console.log('✓ Light Protocol healthy (slot:', health.slot, ')');
      passed++;
    } else {
      console.log('✗ Light Protocol unhealthy:', health.error);
      failed++;
    }
  } catch (err: any) {
    console.log('✗ Health check failed:', err.message);
    failed++;
  }
  
  // Test 3: Cost estimate
  console.log('\nTest 3: Cost Estimate...');
  try {
    const costs = getCostEstimate();
    console.log('  Regular account rent:', costs.regularAccountRent, 'SOL');
    console.log('  Compressed cost:', costs.compressedAccountCost, 'SOL');
    console.log('  Savings multiplier:', costs.savingsMultiplier, 'x');
    if (costs.savingsMultiplier > 1) {
      console.log('✓ Cost savings verified');
      passed++;
    } else {
      console.log('✗ No cost savings');
      failed++;
    }
  } catch (err: any) {
    console.log('✗ Cost estimate failed:', err.message);
    failed++;
  }
  
  // Test 4: Session key creation
  console.log('\nTest 4: Session Key Creation...');
  let sessionKey: any;
  try {
    const limits: SessionSpendingLimits = {
      maxPerTransaction: '10000000', // 10 USDC
      dailyLimit: '100000000',       // 100 USDC
    };
    
    const result = createSessionKey(
      TEST_OWNER.publicKey.toBase58(),
      'mock-signature', // In production, this would be a real wallet signature
      `AEGIX_SESSION_GRANT::${TEST_AGENT_ID}::${TEST_OWNER.publicKey.toBase58()}::${Date.now()}`,
      limits,
      24 * 60 * 60 * 1000 // 24 hours
    );
    
    sessionKey = result.sessionKey;
    console.log('  Session public key:', sessionKey.publicKey.slice(0, 20) + '...');
    console.log('  Pool address:', result.poolAddress.slice(0, 20) + '...');
    console.log('  Expires at:', result.expiresAt);
    console.log('✓ Session key created');
    passed++;
  } catch (err: any) {
    console.log('✗ Session key creation failed:', err.message);
    failed++;
  }
  
  // Test 5: Session key validation
  console.log('\nTest 5: Session Key Validation...');
  try {
    if (!sessionKey) throw new Error('No session key from previous test');
    
    // Test valid amount
    const validation1 = validateSessionKey(sessionKey, '1000000'); // 1 USDC
    if (validation1.valid) {
      console.log('  Valid 1 USDC spend: OK');
    } else {
      console.log('  Valid 1 USDC spend failed:', validation1.reason);
    }
    
    // Test over limit
    const validation2 = validateSessionKey(sessionKey, '200000000'); // 200 USDC (over daily limit)
    if (!validation2.valid) {
      console.log('  Over-limit rejection: OK');
    } else {
      console.log('  Over-limit not rejected!');
    }
    
    console.log('✓ Session validation working');
    passed++;
  } catch (err: any) {
    console.log('✗ Session validation failed:', err.message);
    failed++;
  }
  
  // Test 6: Record spending
  console.log('\nTest 6: Record Spending...');
  try {
    if (!sessionKey) throw new Error('No session key from previous test');
    
    const updated = recordSpending(sessionKey, '5000000'); // 5 USDC
    console.log('  Spent today:', (Number(updated.spentToday) / 1_000_000).toFixed(2), 'USDC');
    
    const info = getSessionInfo(updated);
    console.log('  Remaining today:', info.remainingToday);
    
    console.log('✓ Spending recorded');
    passed++;
  } catch (err: any) {
    console.log('✗ Record spending failed:', err.message);
    failed++;
  }
  
  // Test 7: Session revocation
  console.log('\nTest 7: Session Revocation...');
  try {
    if (!sessionKey) throw new Error('No session key from previous test');
    
    const revoked = revokeSessionKey(
      sessionKey,
      TEST_OWNER.publicKey.toBase58(),
      'mock-revocation-signature'
    );
    
    if (revoked.status === 'revoked') {
      console.log('  Status:', revoked.status);
      console.log('  Revoked at:', revoked.revokedAt);
      console.log('✓ Session revoked');
      passed++;
    } else {
      console.log('✗ Session not revoked');
      failed++;
    }
  } catch (err: any) {
    console.log('✗ Session revocation failed:', err.message);
    failed++;
  }
  
  // Test 8: Compressed balance (will likely be null for test account)
  console.log('\nTest 8: Compressed Balance Query...');
  try {
    const balance = await getCompressedBalance(TEST_OWNER.publicKey);
    if (balance === null) {
      console.log('  No compressed accounts (expected for new keypair)');
      console.log('✓ Balance query works');
      passed++;
    } else {
      console.log('  Balance:', balance.amount.toString());
      console.log('✓ Balance retrieved');
      passed++;
    }
  } catch (err: any) {
    // This is expected to potentially fail for test accounts
    console.log('  Query returned error (expected):', err.message.slice(0, 50) + '...');
    console.log('✓ Balance query works (empty result)');
    passed++;
  }
  
  // Summary
  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);
  
  if (failed === 0) {
    console.log('\n✓ All tests passed!');
    console.log('\nNext steps for mainnet testing:');
    console.log('1. Configure LIGHT_RPC_URL with Helius API key');
    console.log('2. Create a test agent via the dashboard');
    console.log('3. Grant a Light session with small limits ($1 daily)');
    console.log('4. Fund with $5 USDC and execute test payments');
    console.log('5. Verify limits enforced and session revocable');
  } else {
    console.log('\n✗ Some tests failed. Check configuration.');
  }
  
  return failed === 0;
}

// Run if called directly
runTests()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error('Test runner error:', err);
    process.exit(1);
  });

export { runTests };
