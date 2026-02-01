/**
 * Test PayAI Facilitator API endpoints
 */

const FACILITATOR_URL = 'https://facilitator.payai.network';

async function testEndpoint(url: string, method: string = 'GET', body?: any) {
  console.log(`\n📡 Testing: ${method} ${url}`);
  try {
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, options);
    const text = await response.text();
    console.log(`   Status: ${response.status}`);
    console.log(`   Headers:`, Object.fromEntries(response.headers.entries()));
    console.log(`   Body: ${text.slice(0, 1000)}`);
    
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (error: any) {
    console.log(`   Error: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('=== PayAI Facilitator API Test ===\n');
  
  // Test various endpoints
  const endpoints = [
    { url: FACILITATOR_URL, method: 'GET' },
    { url: `${FACILITATOR_URL}/health`, method: 'GET' },
    { url: `${FACILITATOR_URL}/docs`, method: 'GET' },
    { url: `${FACILITATOR_URL}/api`, method: 'GET' },
    { url: `${FACILITATOR_URL}/verify`, method: 'GET' },
    { url: `${FACILITATOR_URL}/settle`, method: 'GET' },
    { url: `${FACILITATOR_URL}/list`, method: 'GET' },
  ];
  
  for (const ep of endpoints) {
    await testEndpoint(ep.url, ep.method);
  }
  
  // Test POST to verify
  console.log('\n--- Testing POST endpoints ---');
  
  await testEndpoint(`${FACILITATOR_URL}/verify`, 'POST', {
    network: 'solana',
    paymentHeader: 'test',
  });
  
  await testEndpoint(`${FACILITATOR_URL}/settle`, 'POST', {
    network: 'solana',
    paymentHeader: 'test',
    merchantAddress: '7ygijvnG8kAWYu2BKEEAU6TGLzWhoy3J3VHzPkLzCra9',
  });
  
  console.log('\n=== Test Complete ===');
}

main().catch(console.error);

