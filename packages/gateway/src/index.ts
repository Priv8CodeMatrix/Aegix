/**
 * Aegix Gateway Server
 * Privacy-First Agent Payment Gateway
 */

// ═══════════════════════════════════════════════════════════════════════
// LOAD ENVIRONMENT VARIABLES FIRST (before any imports that use env vars)
// ═══════════════════════════════════════════════════════════════════════
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from gateway package root
dotenv.config({ path: path.join(__dirname, '../.env') });

console.log('[ENV] ✓ Environment variables loaded');
console.log(`[ENV] LIGHT_RPC_URL: ${process.env.LIGHT_RPC_URL ? 'configured (' + process.env.LIGHT_RPC_URL.slice(0, 50) + '...)' : 'NOT SET'}`);

// ═══════════════════════════════════════════════════════════════════════
// NOW import modules that depend on environment variables
// ═══════════════════════════════════════════════════════════════════════
import express from 'express';
import cors from 'cors';
import paymentRoutes, { paymentRequired } from './routes/payment.js';
import agentRoutes from './routes/agents.js';
import x402Routes from './routes/x402.js';
import shadowLinkRoutes from './routes/shadow-links.js';
import { X402_CONSTANTS } from './x402/protocol.js';
import { getPayAIFacilitator } from './payai/facilitator.js';
import { getIncoClient } from './inco/lightning-client.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (_req, res) => {
  const network = process.env.SOLANA_NETWORK || 'mainnet-beta';
  res.json({
    status: 'healthy',
    service: 'aegix-gateway',
    version: '1.1.0',
    network,
    timestamp: Date.now(),
  });
});

// Status endpoint - returns current configuration
app.get('/api/status', (_req, res) => {
  const network = process.env.SOLANA_NETWORK || 'mainnet-beta';
  const isMainnet = network === 'mainnet-beta';
  const payai = getPayAIFacilitator();
  const incoClient = getIncoClient();
  const incoStatus = incoClient.getStatus();
  
  res.json({
    success: true,
    data: {
      version: '1.1.0',
      network: isMainnet ? 'solana-mainnet' : 'solana-devnet',
      rpc_url: process.env.SOLANA_RPC_URL || (isMainnet 
        ? 'https://api.mainnet-beta.solana.com' 
        : 'https://api.devnet.solana.com'),
      usdc_mint: isMainnet ? X402_CONSTANTS.USDC_MAINNET : X402_CONSTANTS.USDC_DEVNET,
      payai: payai.getInfo(),
      fhe: {
        provider: 'Inco Network',
        mode: incoStatus.loaded ? 'REAL' : 'SIMULATION',
        sdkLoaded: incoStatus.loaded,
        error: incoStatus.error,
      },
    },
    timestamp: Date.now(),
  });
});

// Payment routes (deposit, balance, audit, etc.)
app.use('/api/credits', paymentRoutes);

// Agent management routes
app.use('/api/agents', agentRoutes);

// x402 service discovery
app.use('/api/x402', x402Routes);

// Shadow Link / Ghost Invoice routes
app.use('/api/shadow-link', shadowLinkRoutes);

// Protected API endpoints (require x402 payment)
app.use('/api/ai', paymentRequired);
app.use('/api/data', paymentRequired);

// Example protected endpoint: AI Completion
app.post('/api/ai/completion', (req, res) => {
  const { prompt } = req.body;
  
  // Payment was verified by middleware
  console.log(`[AI] Processing completion request`);
  
  res.json({
    success: true,
    data: {
      completion: `[Aegix AI Response] Processed: "${prompt?.slice(0, 50) || 'No prompt'}"`,
      model: 'aegix-demo-v1',
      tokens: 42,
    },
    timestamp: Date.now(),
  });
});

// Example protected endpoint: Embeddings
app.post('/api/ai/embedding', (req, res) => {
  const { text } = req.body;
  
  console.log(`[AI] Generating embedding`);
  
  // Demo embedding (in production, call actual model)
  const embedding = Array.from({ length: 384 }, () => Math.random() * 2 - 1);
  
  res.json({
    success: true,
    data: {
      embedding,
      dimensions: 384,
      model: 'aegix-embed-v1',
    },
    timestamp: Date.now(),
  });
});

// Example protected endpoint: Data Query
app.post('/api/data/query', (req, res) => {
  const { query } = req.body;
  
  console.log(`[Data] Processing query`);
  
  res.json({
    success: true,
    data: {
      results: [
        { id: 1, content: 'Sample result 1' },
        { id: 2, content: 'Sample result 2' },
      ],
      query: query?.slice(0, 100),
      totalResults: 2,
    },
    timestamp: Date.now(),
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    timestamp: Date.now(),
  });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Gateway] Error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp: Date.now(),
  });
});

// Start server
app.listen(PORT, () => {
  const payai = getPayAIFacilitator();
  const payaiInfo = payai.getInfo();
  
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
║    🛡️  THE SHIELDED GATEWAY - Stealth Address Privacy                 ║
║    Version 3.0.0 - Non-Custodial + Private Payments                   ║
║                                                                       ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║    Gateway: http://localhost:${PORT}                                     ║
║    PayAI:   ${payaiInfo.url.padEnd(51)}║
║    Network: ${payaiInfo.network.padEnd(51)}║
║                                                                       ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║    🔐 STEALTH PAYMENT FLOW (x402 Gasless!):                           ║
║    • POST /api/credits/pool/init        - Create pool wallet          ║
║    • POST /api/credits/pool/pay         - Private payment (PayAI gas!)║
║    • GET  /api/credits/pool/gasless-info - Check gasless availability ║
║                                                                       ║
║    👻 SHADOW LINK / GHOST INVOICE (NEW!):                             ║
║    • POST /api/shadow-link/create       - Create payment invoice      ║
║    • GET  /api/shadow-link/:id          - Get invoice (for payer)     ║
║    • POST /api/shadow-link/:id/sweep    - Sweep to pool (auto-destruct)║
║    • GET  /api/shadow-link/owner/:owner - List your invoices          ║
║                                                                       ║
║    📡 OTHER ENDPOINTS:                                                ║
║    • GET  /health                       - Health check                ║
║    • GET  /api/status                   - Configuration status        ║
║    • GET  /api/credits/resources        - List protected resources    ║
║    • POST /api/ai/completion            - AI completion (402 + x402)  ║
║                                                                       ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║    ✨ PRIVACY GUARANTEE:                                              ║
║    "Service providers see random burner wallets, NOT your main wallet"║
║    "Owner↔Stealth mapping is FHE-encrypted on Inco Network"           ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
  `);
});

export default app;

