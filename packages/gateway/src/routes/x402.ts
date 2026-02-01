import { Router, Request, Response } from 'express';

const router = Router();

// x402 protected services
const SERVICES = [
  { 
    id: "ai-completion", 
    name: "AI Completion", 
    price: "0.01 USDC", 
    priceRaw: "10000",
    endpoint: "/api/ai/completion",
    x402: true,
    encrypted: true,
    description: "AI text completion with FHE-encrypted audit trail"
  },
  { 
    id: "ai-image", 
    name: "Image Gen", 
    price: "0.05 USDC", 
    priceRaw: "50000",
    endpoint: "/api/ai/image",
    x402: true,
    encrypted: true,
    description: "AI image generation with privacy protection"
  },
  { 
    id: "ai-embedding", 
    name: "Embeddings", 
    price: "0.005 USDC", 
    priceRaw: "5000",
    endpoint: "/api/ai/embedding",
    x402: true,
    encrypted: true,
    description: "Vector embeddings with privacy protection"
  },
  { 
    id: "data-query", 
    name: "Data Query", 
    price: "0.025 USDC", 
    priceRaw: "25000",
    endpoint: "/api/data/query",
    x402: true,
    encrypted: true,
    description: "Premium data API with encrypted usage logs"
  },
];

// Agent actions (configurable per agent)
const AGENT_ACTIONS = [
  {
    id: "donation",
    name: "🎁 Donation",
    price: "0.01 USDC (configurable)",
    priceRaw: "10000",
    endpoint: "/api/credits/agent/donate",
    completeEndpoint: "/api/credits/agent/donate/complete",
    x402: true,
    encrypted: true,
    description: "Test real x402 transactions by donating to Aegix developer",
    recipient: "7ygijvnG8kAWYu2BKEEAU6TGLzWhoy3J3VHzPkLzCra9",
    enabledByDefault: true,
  },
];

/**
 * GET /api/x402/services
 * List available x402-protected services
 */
router.get('/services', (_req: Request, res: Response) => {
  res.json({ 
    success: true, 
    services: SERVICES,
    agentActions: AGENT_ACTIONS,
    x402Protocol: {
      version: "1.0",
      standard: "HTTP 402 Payment Required",
      description: "All services require x402 payment - NO BYPASS"
    },
    encryption: {
      provider: "Inco Network",
      type: "FHE (Fully Homomorphic Encryption)",
      description: "All audit logs and usage data are encrypted"
    },
    howToUse: {
      step1: "POST /api/credits/agent/execute with { agentApiKey, resource, body }",
      step2: "Receive payment instructions (paymentId, amount, PayAI info)",
      step3: "Sign payment with wallet via PayAI facilitator",
      step4: "POST /api/credits/agent/complete with { agentApiKey, paymentId, txSignature, resource, body }",
      step5: "Receive your result (encrypted in Inco FHE audit log)"
    }
  });
});

/**
 * GET /api/x402/donation
 * Information about the donation action - test real x402 transactions
 */
router.get('/donation', (_req: Request, res: Response) => {
  res.json({
    success: true,
    action: AGENT_ACTIONS[0],
    title: "🎁 Donation - Test Real x402 Transactions",
    description: "Use the donation action to test the full x402 + FHE encryption flow with a real USDC transaction.",
    recipient: {
      address: "7ygijvnG8kAWYu2BKEEAU6TGLzWhoy3J3VHzPkLzCra9",
      name: "Aegix Developer",
    },
    flow: [
      {
        step: 1,
        action: "POST /api/credits/agent/donate",
        body: { agentApiKey: "aegix_agent_xxx...", amount: "10000" },
        note: "Amount is optional, defaults to 0.01 USDC (10000 micro)"
      },
      {
        step: 2,
        action: "Sign USDC transfer with your wallet",
        note: "Transfer to 7ygijvnG8kAWYu2BKEEAU6TGLzWhoy3J3VHzPkLzCra9"
      },
      {
        step: 3,
        action: "POST /api/credits/agent/donate/complete",
        body: { agentApiKey: "aegix_agent_xxx...", paymentId: "from step 1", txSignature: "your tx sig" }
      }
    ],
    example: {
      curl: `
# Step 1: Request donation payment
curl -X POST http://localhost:3001/api/credits/agent/donate \\
  -H "Content-Type: application/json" \\
  -d '{"agentApiKey":"YOUR_KEY"}'

# Step 2: Sign USDC transfer in your wallet

# Step 3: Complete donation
curl -X POST http://localhost:3001/api/credits/agent/donate/complete \\
  -H "Content-Type: application/json" \\
  -d '{"agentApiKey":"YOUR_KEY","paymentId":"FROM_STEP_1","txSignature":"YOUR_TX_SIG"}'
      `.trim()
    },
    benefits: [
      "✓ Test real x402 payment flow",
      "✓ Uses real USDC on Solana mainnet",
      "✓ Transaction encrypted in Inco FHE audit log",
      "✓ Support Aegix development!"
    ],
    timestamp: Date.now()
  });
});

/**
 * GET /api/x402/info
 * Information about x402 protocol and encryption
 */
router.get('/info', (_req: Request, res: Response) => {
  res.json({
    success: true,
    x402: {
      name: "x402 Protocol",
      standard: "HTTP 402 Payment Required",
      description: "Machine-to-machine payment protocol for AI agents",
      mode: "REAL PAYMENTS ONLY - No test mode bypass",
      flow: [
        "1. Agent calls /api/credits/agent/execute with API key",
        "2. Server returns 402 with payment instructions",
        "3. Agent signs USDC payment via PayAI facilitator",
        "4. Agent calls /api/credits/agent/complete with tx signature",
        "5. Server verifies payment and executes resource",
        "6. Result returned + logged to FHE-encrypted audit trail"
      ],
      endpoints: {
        execute: "POST /api/credits/agent/execute",
        complete: "POST /api/credits/agent/complete",
        verify: "POST /api/credits/agent/verify"
      },
      benefits: [
        "✓ Real USDC payments on Solana mainnet",
        "✓ Non-custodial (funds go directly to service provider)",
        "✓ Privacy-preserving (FHE encrypted logs)",
        "✓ Pay-per-request pricing"
      ]
    },
    encryption: {
      name: "Inco FHE (Fully Homomorphic Encryption)",
      description: "Allows computation on encrypted data without decryption",
      whatIsEncrypted: [
        "• Agent usage history",
        "• Payment audit trails", 
        "• API call metadata",
        "• Spending patterns"
      ],
      whoCanDecrypt: "Only the wallet owner with signature proof",
      benefits: [
        "✓ Service providers can't see who is using their API",
        "✓ Complete privacy for AI agent operations",
        "✓ Auditable by owner only"
      ]
    },
    timestamp: Date.now()
  });
});

/**
 * GET /api/x402/flow
 * Step-by-step guide for agent x402 flow
 */
router.get('/flow', (_req: Request, res: Response) => {
  res.json({
    success: true,
    title: "x402 Agent Payment Flow",
    description: "How to make a real x402 payment as an agent",
    steps: [
      {
        step: 1,
        action: "POST /api/credits/agent/execute",
        body: {
          agentApiKey: "aegix_agent_xxx...",
          resource: "/api/ai/completion",
          body: { prompt: "Your prompt here" }
        },
        response: "Payment instructions with paymentId, amount, PayAI info"
      },
      {
        step: 2,
        action: "Sign payment with wallet",
        description: "Use PayAI facilitator to sign USDC transfer",
        amount: "As specified in step 1 response"
      },
      {
        step: 3,
        action: "POST /api/credits/agent/complete",
        body: {
          agentApiKey: "aegix_agent_xxx...",
          paymentId: "from step 1",
          txSignature: "solana tx signature from step 2",
          resource: "/api/ai/completion",
          body: { prompt: "Your prompt here" }
        },
        response: "Your result + encrypted audit entry"
      }
    ],
    example: {
      curl: `
# Step 1: Request payment
curl -X POST http://localhost:3001/api/credits/agent/execute \\
  -H "Content-Type: application/json" \\
  -d '{"agentApiKey":"YOUR_KEY","resource":"/api/ai/completion","body":{"prompt":"Hello"}}'

# Step 2: Sign payment via PayAI (in your wallet/app)

# Step 3: Complete after payment
curl -X POST http://localhost:3001/api/credits/agent/complete \\
  -H "Content-Type: application/json" \\
  -d '{"agentApiKey":"YOUR_KEY","paymentId":"FROM_STEP_1","txSignature":"YOUR_TX_SIG","resource":"/api/ai/completion","body":{"prompt":"Hello"}}'
      `.trim()
    },
    timestamp: Date.now()
  });
});

export default router;
