# TPDR: Aegix Technical Protocol Design Review

**Version:** 5.0 (Recovery Pool Architecture + PayAI x402 Gasless Transfers)  
**Document Type:** LLM Onboarding & Technical Reference  
**Last Updated:** January 29, 2026  
**Architecture:** Non-Custodial + Privacy-Preserving + ZK Compressed Payment Gateway + Gasless x402

### What's New in 5.0:
- ✅ **Recovery Pool Architecture**: Dedicated fee payer that preserves privacy (unlinks legacy wallet from burners)
- ✅ **3-Step PayAI x402 Flow**: Pool → Burner (compressed) → Decompress in burner → PayAI x402 to recipient
- ✅ **PayAI Gasless Transfers**: PayAI pays gas for burner → recipient transfers
- ✅ **ATA Rent Recovery**: Burner ATAs closed automatically, rent returned to Recovery Pool
- ✅ **Light Protocol ZK Compression**: Default payment path for ALL flows (~50x cheaper)
- ✅ **Compressed Pools & Burners**: Ultra-low cost ephemeral accounts
- ✅ **Session Keys**: Semi-custodial time-limited agent spending authority
- ✅ **Light-Enabled Ghost Invoices**: Shadow links use compressed burners
- ✅ **Migration Tools**: Legacy → Light migration endpoints
- ✅ **Updated Ledger Visualization**: Shows compressed payment flows with PayAI x402

---

## 1. Project Overview

Aegix 5.0 is a **privacy-first payment gateway** for the autonomous AI agent economy AND human users on Solana. It enables AI agents and humans to pay for services (APIs, compute, data) while **completely hiding the link** between the user's wallet and the payment recipient using **Light Protocol ZK Compression + PayAI x402 Gasless Transfers**.

**Key Architecture Components:**
- **Light Protocol**: ZK state compression for ~50x cheaper accounts
- **Recovery Pool**: Dedicated fee payer infrastructure that preserves privacy
- **PayAI x402**: Gasless transfers where PayAI pays gas for burner→recipient

### Core Innovation: Light Protocol + Recovery Pool + PayAI x402 Gasless

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  AEGIX 5.0: 3-STEP PayAI x402 FLOW (MAXIMUM PRIVACY)                          │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  STEP 1: COMPRESSED TRANSFER                                                   │
│  ┌──────────────┐         ┌─────────────────────┐                             │
│  │ STEALTH_POOL │ ──────► │ COMPRESSED_BURNER   │  (Light ZK ~50x cheaper)    │
│  │ (User funds) │         │ (Ephemeral wallet)  │                             │
│  └──────────────┘         └─────────────────────┘                             │
│                                      │                                         │
│  STEP 2: DECOMPRESS IN BURNER        ▼                                         │
│  ┌──────────────────┐    ┌─────────────────────┐                              │
│  │  RECOVERY_POOL   │───►│ BURNER_ATA_CREATED  │  (Recovery Pool pays rent)   │
│  │ (Fee Payer)      │    │ (Regular SPL USDC)  │  (Decompress to burner ATA)  │
│  └──────────────────┘    └─────────────────────┘                              │
│                                      │                                         │
│  STEP 3: PAYAI x402 GASLESS TRANSFER ▼                                         │
│  ┌──────────────────┐    ┌─────────────────────┐    ┌────────────────┐        │
│  │     PAYAI        │───►│   BURNER_WALLET     │───►│   RECIPIENT    │        │
│  │ (Pays Gas!)      │    │ (Signs transfer)    │    │ (Sees burner)  │        │
│  └──────────────────┘    └─────────────────────┘    └────────────────┘        │
│                                      │                                         │
│  STEP 4: CLEANUP                     ▼                                         │
│  ┌──────────────────┐    ┌─────────────────────┐                              │
│  │  RECOVERY_POOL   │◄───│ CLOSE_BURNER_ATA    │  (+0.002 SOL rent recovered) │
│  │ (Rent recovered) │    │ (Rent returned)     │                              │
│  └──────────────────┘    └─────────────────────┘                              │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘

PRIVACY GUARANTEES:
  ✅ Recipient sees burner wallet only
  ✅ Pool address hidden from recipient
  ✅ Legacy wallet unlinked from burners (Recovery Pool pays, not legacy)
  ✅ Decompress happens inside burner wallet
  ✅ PayAI x402 paid transfer gas
  ✅ Recovery Pool paid decompress fees
  ✅ Burner ATA closed, rent recovered
```

Service providers see payment from a **random ephemeral burner wallet**. They have **NO knowledge** it's linked to the user's main account. The Recovery Pool architecture ensures the legacy wallet is never linked to burner operations.

### Default Payment Mode: Light Protocol

**All payment flows default to Light Protocol:**
- ✅ Human manual stealth payments (`/api/credits/pool/pay`)
- ✅ Ghost invoices / shadow links (`/api/shadow-link/create`)
- ✅ Autonomous agent payments (`/api/credits/light/pay`)

Legacy mode available as fallback but shows warnings and migration prompts.

---

## 2. Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **State Compression** | **Light Protocol (ZK Compression)** | ~50x cheaper accounts, compressed state storage |
| **Blockchain** | Solana Mainnet | Fast, cheap USDC settlement (400ms blocks, <$0.001 fees) |
| **Payment Protocol** | x402 Protocol | HTTP-native async payment handshake |
| **Gas Abstraction** | **PayAI Facilitator** | **Third-party gas sponsorship for gasless burner→recipient transfers** |
| **Fee Payer Infrastructure** | **Recovery Pool** | **Dedicated fee payer for decompress + ATA rent (preserves privacy)** |
| **Privacy Layer** | Light Protocol ZK Proofs | Zero-knowledge proofs for compressed state verification |
| **Agent Autonomy** | **Session Keys (AES-256-GCM)** | Time-limited, revocable spending authority |
| **Backend** | Express.js + TypeScript | Gateway API server |
| **Frontend** | Next.js 14 + React | Dashboard with wallet integration |
| **Wallet** | Solana Wallet Adapter | Phantom, Solflare, etc. |

---

## 3. Repository Structure

```
Aegix/
├── packages/
│   ├── gateway/                    # Backend Express.js server
│   │   ├── src/
│   │   │   ├── index.ts           # Main server entry point
│   │   │   ├── types.ts           # TypeScript interfaces
│   │   │   ├── routes/
│   │   │   │   ├── payment.ts     # Stealth pool & payment endpoints (Light default)
│   │   │   │   ├── agents.ts      # Agent management CRUD + Light sessions
│   │   │   │   ├── x402.ts        # x402 service discovery
│   │   │   │   └── shadow-links.ts # Ghost invoice system (Light enabled)
│   │   │   ├── light/              # Light Protocol integration (NEW!)
│   │   │   │   ├── client.ts      # Light SDK wrapper (compressed transfers)
│   │   │   │   ├── session-keys.ts # Session key management (AES-256-GCM)
│   │   │   │   ├── migrate.ts     # Legacy → Light migration tools
│   │   │   │   └── index.ts       # Exports
│   │   │   ├── payai/
│   │   │   │   ├── facilitator.ts # PayAI integration
│   │   │   │   ├── stealth-client.ts # Stealth wallet payment signing
│   │   │   │   └── gasless-stealth.ts # Gasless payment flow (Light routing)
│   │   │   ├── inco/
│   │   │   │   ├── confidential.ts # FHE encryption/decryption
│   │   │   │   └── lightning-client.ts # Inco SDK wrapper (@deprecated for FHE)
│   │   │   ├── solana/
│   │   │   │   ├── client.ts      # Solana RPC interactions
│   │   │   │   └── recovery.ts    # Recovery Pool management (New in 5.0)
│   │   │   ├── stealth/
│   │   │   │   └── index.ts       # Stealth address generation
│   │   │   └── x402/
│   │   │       └── protocol.ts    # x402 constants & helpers
│   │   └── data/
│   │       ├── audit-logs.json    # Encrypted audit log storage
│   │       ├── pools.json         # Stealth pool registry
│   │       └── agents.json        # Persistent agent registry (NEW!)
│   │
│   └── dashboard/                  # Frontend Next.js application
│       └── src/
│           ├── app/
│           │   ├── page.tsx       # Main dashboard
│           │   ├── landing/page.tsx # Public landing page
│           │   ├── p/[alias]/page.tsx # Shadow link payment pages
│           │   └── pay/[id]/page.tsx  # Direct payment pages
│           ├── components/
│           │   ├── hero/          # Landing page hero section
│           │   ├── landing/       # Landing page components
│           │   │   ├── ProtocolStack.tsx    # Tech stack visualization
│           │   │   ├── ShieldedLedger.tsx   # Privacy comparison
│           │   │   └── ChainOfCustody.tsx   # Payment flow diagram
│           │   ├── workstations/  # Dashboard widgets
│           │   ├── AgentDetailPanel.tsx # Agent management UI (Light sessions)
│           │   ├── StealthPayment.tsx   # Pool funding UI (Light toggle)
│           │   ├── StealthPoolChannel.tsx # Pool management (Light status)
│           │   ├── SessionLedger.tsx    # Transaction history (Light badges)
│           │   └── TransactionFlowMap.tsx # Visual flow diagram (compressed flows)
│           ├── hooks/
│           │   └── useGateway.ts  # Main data fetching hook
│           └── lib/
│               ├── gateway.ts     # API client functions
│               ├── inco.ts        # Frontend Inco SDK
│               └── formatters.ts  # Number/currency formatting
│
├── pdr.md                          # Product Design Review
├── TPDR.md                         # This file - Technical PDR
└── turbo.json                      # Turborepo config
```

---

## 4. Core Concepts

### 4.1 Stealth Pools (Legacy) vs Compressed Pools (Light)

#### Legacy Stealth Pool
A **Stealth Pool** is a server-managed wallet that holds user funds for private payments.

```typescript
interface StealthPool {
  id: string;                    // Unique pool identifier
  owner: string;                 // User's main wallet (Solana pubkey)
  poolAddress: string;           // Stealth pool Solana address
  poolKeypair: Keypair;          // Server holds this for signing
  balanceUsdc: number;           // Current USDC balance
  balanceSol: number;            // SOL for rent/fees
  fheHandle: string;             // Inco FHE encrypted owner mapping
  totalDeposits: number;         // Lifetime deposits
  totalPayments: number;         // Lifetime payments
  createdAt: string;
  mode?: 'legacy' | 'light';     // Payment mode
}
```

#### Light Compressed Pool (Default - Aegix 4.0)
A **Compressed Pool** uses Light Protocol ZK Compression for ~50x cheaper state storage.

```typescript
interface CompressedPool {
  poolId: string;                // Unique pool identifier
  poolAddress: string;           // Compressed account address
  merkleTree: string;             // Light Protocol merkle tree
  owner: string;                  // User's main wallet
  sessionKey?: string;            // Session key public key (for agents)
  lightEnabled: true;             // Always true for compressed pools
  compressedBalance: bigint;      // Compressed USDC balance
  createdAt: string;
}
```

**Light Flow:**
1. User shields USDC into compressed account (one-time signature)
2. Server creates compressed burner for each payment (~50x cheaper)
3. Compressed burner pays service provider (service sees random compressed wallet)
4. ZK proofs ensure correctness without revealing details

**Cost Comparison:**
- Legacy ephemeral account: ~0.002 SOL rent
- Compressed account: ~0.00004 SOL compression cost
- **Savings: ~50x cheaper**

### 4.2 Recovery Pool Architecture (New in 5.0)

The **Recovery Pool** is a dedicated infrastructure layer that acts as a non-linked fee payer for all burner wallet operations. This ensures the user's legacy wallet is never linked to burner transactions on-chain.

```typescript
// packages/gateway/src/solana/recovery.ts
interface RecoveryPool {
  address: string;                // Recovery Pool public key
  keypair: Keypair;               // Persisted to data/recovery-pool.json
  balance: number;                // SOL balance for fees
  totalRecycled: number;          // Total SOL recovered from closed ATAs
  initialized: boolean;           // Whether pool has been created
}
```

**Why Recovery Pool Exists:**
- Legacy wallet should NEVER sign burner transactions (breaks privacy)
- Burner wallets need SOL for ATA rent (~0.002 SOL per account)
- Someone must pay for decompression transaction fees
- ATA rent should be recovered and recycled

**Recovery Pool Responsibilities:**
1. **Create Burner ATAs**: Pays ~0.002 SOL rent for each burner's USDC ATA
2. **Pay Decompress Fees**: Signs and pays for Light Protocol decompression transactions
3. **Recover Rent**: Receives SOL back when burner ATAs are closed
4. **Maintain Liquidity**: User tops up Recovery Pool periodically

```
┌────────────────────────────────────────────────────────────────┐
│  RECOVERY POOL FLOW                                            │
│                                                                 │
│  User Tops Up ─────► Recovery_Pool (0.1 SOL)                   │
│                           │                                     │
│  For each payment:        ▼                                     │
│  [1] Recovery_Pool ──► Create Burner ATA (-0.002 SOL)          │
│  [2] Recovery_Pool ──► Pay Decompress Fees (-0.0001 SOL)       │
│  [3] After payment:   Close Burner ATA (+0.002 SOL recovered)  │
│                                                                 │
│  Net cost per payment: ~0.0001 SOL (only tx fees)              │
└────────────────────────────────────────────────────────────────┘
```

### 4.3 Chain of Custody (3-Step PayAI x402 Flow - Default)

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: COMPRESSED TRANSFER (Pool → Burner)                    │
│  Stealth_Pool ──────────────────────► Compressed_Burner         │
│  Light ZK Compression: ~50x cheaper than regular account         │
│  Burner receives compressed USDC tokens                          │
├─────────────────────────────────────────────────────────────────┤
│  STEP 2: DECOMPRESS IN BURNER (Recovery Pool pays)              │
│  Recovery_Pool ──────────────────────► Burner_ATA_Created       │
│  Recovery Pool creates burner's USDC ATA (~0.002 SOL rent)      │
│  Light_Protocol ─────────────────────► Decompress_to_Burner_ATA │
│  Compressed USDC becomes regular SPL USDC in burner wallet       │
├─────────────────────────────────────────────────────────────────┤
│  STEP 3: PAYAI x402 GASLESS TRANSFER (Burner → Recipient)       │
│  Burner_Wallet ──────────────────────► Recipient_Wallet         │
│  PayAI pays gas fees (gasless for burner!)                       │
│  Recipient sees random burner address, NOT user's pool           │
├─────────────────────────────────────────────────────────────────┤
│  STEP 4: CLEANUP (Recovery Pool recovers rent)                   │
│  Close_Burner_ATA ───────────────────► Recovery_Pool            │
│  ~0.002 SOL rent returned to Recovery Pool                       │
│  Burner wallet deleted, no trace remains                         │
└─────────────────────────────────────────────────────────────────┘
```

**Privacy Guarantees:**
- ✅ Recipient sees burner wallet only
- ✅ Pool address hidden from recipient
- ✅ Decompress inside burner wallet (never direct to recipient)
- ✅ PayAI x402 pays transfer gas (not user's wallet)
- ✅ Recovery Pool pays decompress fees (not legacy wallet)
- ✅ Burner ATA closed, rent recovered
- ✅ On-chain: no link between legacy wallet and burner operations

**Legacy Flow (Fallback):**
- Available when Light Protocol or PayAI unavailable
- Higher costs, potential clustering risk
- Recovery Pool still used for fee paying

### 4.4 x402 Protocol

HTTP-native payment protocol using status code `402 Payment Required`.

```typescript
// Server returns 402 with payment instructions
interface PaymentRequiredResponse {
  scheme: 'exact';
  network: 'solana-mainnet';
  maxAmountRequired: string;      // Amount in micro-USDC
  asset: string;                  // USDC mint address
  payTo: string;                  // Service provider address
  paymentId: string;              // Unique payment request ID
  expiry: number;                 // Unix timestamp
  resource: string;               // Resource being accessed
}

// Client includes payment proof in header
interface X402PaymentHeader {
  signature: string;              // Transaction signature
  paymentId: string;
  payer: string;                  // Stealth wallet (NOT user!)
  timestamp: number;
}
```

### 4.5 Agent System

AI agents operate autonomously with delegated spending authority. **Agents persist to disk** (`data/agents.json`) and survive server restarts.

```typescript
interface Agent {
  id: string;
  owner: string;                  // Creator's wallet
  name: string;
  apiKeyHash: string;             // SHA-256 hash (never stored plaintext)
  apiKeyPrefix: string;           // First 20 chars for UI display
  privacyLevel: 'standard' | 'shielded' | 'maximum';
  status: 'active' | 'idle' | 'paused';  // Paused agents reject all payments
  spendingLimits: {
    maxPerTransaction: string;    // Max USDC per tx (micro units)
    dailyLimit: string;           // Max USDC per day
    allowedResources: string[];   // Which API paths agent can access
  };
  stealthSettings: {
    enabled: boolean;
    mode?: 'legacy' | 'light' | 'single' | 'multi';  // Payment mode
    poolId?: string;              // Linked stealth pool
    poolAddress?: string;         // Pool public address
    fhePoolKeyHandle?: string;    // FHE-encrypted pool private key (NEVER raw!)
    // Light Protocol fields (Aegix 4.0)
    lightPoolAddress?: string;    // Compressed pool address
    lightSessionKey?: string;     // Session key public key
    lightMerkleRoot?: string;     // Light Protocol merkle root
    fundingThreshold: string;     // Alert threshold
    totalPayments: number;
    totalSolRecovered: number;
  };
  spent24h: string;
  totalSpent: string;
  apiCalls: number;
  createdAt: string;
  lastActivity: string;
}
```

**Pool Assignment Modes:**
| Mode | Behavior |
|------|----------|
| `USE_MAIN_POOL` | Share owner's main stealth pool (legacy or Light) |
| `CREATE_OWN_POOL` | Generate dedicated pool with FHE-encrypted private key |
| `ASSIGN_TO_POOL` | Link to existing custom pool |
| `LIGHT_SESSION` | Create Light Protocol compressed pool with session key (NEW!) |

**Light Protocol Session Keys:**
- Time-limited spending authority (e.g., 30 days)
- Revocable by owner at any time
- Encrypted with AES-256-GCM (server-side)
- Spending limits: `maxPerTransaction`, `dailyLimit`
- Autonomous agent payments without owner signatures after initial setup

### 4.6 Agent Persistence

Agents are **persisted to disk** in `data/agents.json`:

```typescript
// Saved on every mutation (debounced 1s)
{
  "agents": [...],
  "savedAt": "2026-01-22T...",
  "version": "1.0"
}
```

**CREATE_OWN_POOL Flow (FHE-Encrypted Private Keys):**
```
1. Generate new Solana Keypair
2. Encrypt secretKey with Inco FHE → fhePoolKeyHandle
3. Store ONLY the FHE handle (never raw key!)
4. Pool address returned for funding
5. Payments: decrypt key with attested signature, sign tx, re-encrypt
```

Private keys are encrypted using `encryptBytes()` in `lightning-client.ts`:
```typescript
// Format: inco:fhe:v1:bytes:{iv}:{encrypted_data}
const handle = await inco.encryptBytes(poolSecretKey);
agent.stealthSettings.fhePoolKeyHandle = handle.handle;
```

---

## 5. API Reference

### 5.1 Gateway Endpoints (Port 3001)

#### Health & Status
```
GET  /health                      → Service health check
GET  /api/status                  → Full gateway status + FHE mode
```

#### Stealth Pool Management
```
POST /api/credits/pool/create     → Create stealth pool for owner
GET  /api/credits/pool/:owner     → Get owner's pool info
POST /api/credits/pool/deposit    → Deposit USDC to pool
POST /api/credits/pool/withdraw   → Withdraw from pool
POST /api/credits/pool/pay        → Execute gasless payment from pool
GET  /api/credits/audit/:owner    → Get FHE-encrypted audit log
```

#### Agent Management
```
POST   /api/agents/register       → Create agent, returns API key (SAVE IT!)
GET    /api/agents/:owner         → List owner's agents
GET    /api/agents/:id/api-key    → Retrieve full API key (24h window)
PATCH  /api/agents/:id            → Update agent config (status, privacy, limits)
DELETE /api/agents/:id            → Delete agent
POST   /api/agents/:id/regenerate-key → Regenerate API key
```

#### Agent Stealth Pool Management
```
GET    /api/agents/:id/stealth           → Get agent's stealth settings
PATCH  /api/agents/:id/stealth           → Enable/disable stealth mode
POST   /api/agents/:id/stealth/create-pool → Create FHE-encrypted pool
POST   /api/agents/:id/stealth/link      → Link existing pool to agent
POST   /api/agents/:id/stealth/use-main  → Use owner's main pool
POST   /api/agents/:id/stealth/assign-pool → Assign to specific pool
GET    /api/agents/pools/list?owner=...  → List all pools for owner
POST   /api/agents/bundle                → Bundle multiple agents to one pool
```

#### Light Protocol Endpoints (Aegix 4.0 - Default)
```
POST   /api/agents/:id/light/create-session → Create Light session key (owner signs)
POST   /api/agents/:id/light/fund-pool      → Get compress transaction (shield funds)
POST   /api/agents/:id/light/revoke-session → Revoke agent session
GET    /api/agents/:id/light/status         → Get Light session status & balance
GET    /api/agents/light/health             → Check Light Protocol health
GET    /api/credits/light/estimate          → Get cost estimates (Light vs legacy)
POST   /api/credits/light/pay               → Execute Light compressed payment
```

#### Migration Endpoints
```
GET    /api/agents/migration/status         → Overview of migration status
GET    /api/agents/:id/migration/prepare    → Preview migration steps
POST   /api/agents/:id/migration/execute    → Execute migration to Light
```

#### x402 Protected Resources
```
GET  /api/x402/resources          → List available paid resources
POST /api/ai/completion           → AI completion (402 protected)
POST /api/ai/embedding            → Embeddings (402 protected)
POST /api/data/query              → Data query (402 protected)
```

#### Shadow Links (Ghost Invoices - Light Enabled)
```
POST /api/shadow-link/create      → Create payment link (Light compressed burner default)
GET  /api/shadow-link/:id         → Get link details (includes Light mode info)
POST /api/shadow-link/:id/pay     → Execute payment (Light mode)
POST /api/shadow-link/:id/sweep   → Sweep to pool
GET  /api/shadow-link/owner/:owner → List owner's invoices
```

**Light Protocol Fields in Shadow Links:**
```typescript
interface ShadowLink {
  // ... existing fields
  mode: 'light' | 'legacy';      // Payment mode (default: 'light')
  lightEnabled?: boolean;        // Whether Light is available
  compressedBurner?: string;     // Compressed burner address
  proofHash?: string;            // ZK proof hash
  costSavings?: string;          // Estimated savings vs legacy
}
```

### 5.2 Request/Response Examples

#### Create Stealth Pool
```typescript
// Request
POST /api/credits/pool/create
{
  "owner": "7xK...user-wallet...9Qz",
  "signedMessage": "base64-signature"
}

// Response
{
  "success": true,
  "data": {
    "poolId": "pool-abc123",
    "poolAddress": "5Yx...pool-address...eU",
    "fheHandle": "0x8f3a...",
    "balanceUsdc": 0,
    "balanceSol": 0
  }
}
```

#### Execute Private Payment
```typescript
// Request
POST /api/credits/pool/pay
{
  "poolId": "pool-abc123",
  "recipient": "ServiceProviderAddress",
  "amountUsdc": 0.05,
  "memo": "API call payment"
}

// Response
{
  "success": true,
  "data": {
    "txSignature": "4siR6W...AJPM",
    "burnerUsed": "5YxfX...9XeU",
    "amountUsdc": 0.05,
    "paymentFlow": {
      "setupTx": "...",
      "paymentTx": "4siR6W...AJPM",
      "recoveryTx": "5FzR1K...ZSvc"
    }
  }
}
```

#### Create Agent Pool (FHE-Encrypted) - NEW!
```typescript
// Request
POST /api/agents/agent-abc123/stealth/create-pool
{
  "ownerSignature": "base64-wallet-signature",
  "message": "AEGIX_AGENT_POOL::7xK...::agent-abc123::1706000000"
}

// Response
{
  "success": true,
  "data": {
    "agentId": "agent-abc123",
    "poolId": "pool-xyz789",
    "poolAddress": "5Yx...new-pool...eU",
    "fheEncrypted": true,
    "isRealFhe": false,  // true when real Inco SDK available
    "message": "Pool created with FHE-encrypted private key.",
    "fundingInstructions": "Send SOL and USDC to 5Yx...eU"
  }
}
```

#### Toggle Agent Status (Enable/Disable)
```typescript
// Request - Pause an agent
PATCH /api/agents/agent-abc123
{
  "status": "paused"
}

// Response
{
  "success": true,
  "data": {
    "id": "agent-abc123",
    "status": "paused",  // Agent will reject all payments!
    "lastActivity": "2026-01-22T..."
  }
}
```

---

## 6. Frontend Architecture

### 6.1 Key Components

| Component | Purpose |
|-----------|---------|
| `useGateway` hook | Central data fetching, caches status/agents/auditLog |
| `WalletProvider` | Solana wallet adapter context |
| `AgentDetailPanel` | Agent CRUD, **pool assignment**, **Enable/Disable toggle**, API key management |
| `StealthPayment` | Pool funding/withdrawal UI |
| `SessionLedger` | Transaction history with flow visualization |
| `TransactionFlowMap` | React Flow graph of payment custody chain |
| `ProtocolStack` | Landing page tech stack visualization |
| `ChainOfCustody` | 4-step privacy flow diagram |
| `ShieldedLedger` | Public vs Private view comparison |

**AgentDetailPanel Features:**
- Status toggle (active ↔ paused) with visual switch
- Pool assignment: USE_MAIN_POOL / CREATE_OWN_POOL / ASSIGN_TO_POOL
- API key visibility (eye icon to reveal full key)
- Spending limits editor (maxPerTx, dailyLimit)
- Stealth payment execution form

### 6.2 State Management

```typescript
// useGateway hook provides all gateway state
const {
  isConnected,        // Gateway health
  isLoading,          // Loading state
  error,              // Error message
  status,             // Gateway config (network, FHE mode)
  auditLog,           // Encrypted transaction history
  resources,          // Available x402 resources
  agents,             // User's AI agents
  fheMode,            // 'REAL' | 'SIMULATION' | 'UNKNOWN'
  refresh,            // Manual refresh trigger
  createAgent,        // Create new agent
  updateAgent,        // Update agent config
  deleteAgent,        // Delete agent
} = useGateway();
```

### 6.3 Routing

```
/                     → Main dashboard (wallet connected)
/landing              → Public landing page
/p/[alias]            → Shadow link payment page
/pay/[id]             → Direct payment page
```

---

## 7. Privacy Guarantees

### What Service Providers See:
- ✅ Payment from a random, new wallet address
- ✅ Payment confirmation on Solscan
- ❌ User's main wallet address (HIDDEN)
- ❌ User's payment history (HIDDEN)
- ❌ Connection to other payments (HIDDEN)

### What Users Can See (via FHE decryption):
- ✅ Full stealth pool history
- ✅ Which services they paid
- ✅ How much they spent
- ✅ Cryptographic proof of ownership

### What On-Chain Observers See:
- ✅ User wallet → Stealth Pool (funding)
- ✅ Burner Wallet → Service Provider (payment)
- ❌ Direct link from user to service (BROKEN!)

---

## 8. Security Model

### Non-Custodial Principles:
- Aegix **never holds user private keys** (main wallet)
- Stealth pool keypairs are server-managed but funds are user-owned
- User can withdraw anytime by signing with main wallet
- All transactions are on-chain and verifiable

### FHE Encryption (Inco Network):
- Owner↔Pool mapping stored as FHE ciphertext
- Only wallet owner can decrypt their history
- Audit logs encrypted before storage
- Zero-knowledge ownership proofs possible
- **Agent pool private keys FHE-encrypted** (never stored plaintext!)

### Agent Pool Key Security (NEW!):
```typescript
// Pool private keys are NEVER stored in plaintext
// Flow for CREATE_OWN_POOL:
1. Keypair.generate() → secretKey (64 bytes)
2. inco.encryptBytes(secretKey) → fhePoolKeyHandle
3. Store ONLY fhePoolKeyHandle in agents.json
4. To sign payment: decryptBytes(handle, owner, signature) → secretKey
5. Sign tx, then secretKey is garbage collected (not persisted)
```

### API Authentication:
- Agents authenticate with API keys (SHA-256 hashed, never stored plaintext)
- Full API keys temporarily AES-encrypted for 24h retrieval window
- Wallet signature required for sensitive operations (pool creation, etc.)
- Rate limiting on all endpoints
- **Paused agents automatically reject all payment requests**

---

## 9. Environment Configuration

### Gateway (.env)
```bash
# Solana
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# Light Protocol (Aegix 4.0)
LIGHT_RPC_URL=https://api.mainnet-beta.solana.com  # Or Helius RPC
SESSION_KEY_SECRET=your-32-byte-secret-key  # AES-256-GCM encryption key

# PayAI
FACILITATOR_URL=https://facilitator.payai.network
PAYAI_NETWORK=solana

# Inco Network (Deprecated for FHE, retained for audit logs)
INCO_NETWORK_URL=https://validator.rivest.inco.org
INCO_PRIVATE_KEY=your-inco-key

# Server
PORT=3001
```

### Dashboard (.env.local)
```bash
NEXT_PUBLIC_GATEWAY_URL=http://localhost:3001
NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

---

## 10. Running the Project

```bash
# Install dependencies (from root)
npm install

# Start both gateway and dashboard
npm run dev

# Or start individually
cd packages/gateway && npm run dev    # Port 3001
cd packages/dashboard && npm run dev  # Port 3000
```

### Ports:
- **Gateway API:** http://localhost:3001
- **Dashboard:** http://localhost:3000

---

## 11. Key Type Definitions

```typescript
// Audit Log Entry (stored encrypted)
interface AuditLogEntry {
  id: string;
  type: 'pool_deposit' | 'pool_payment' | 'pool_withdrawal' | 'agent_created';
  owner: string;
  poolId?: string;
  stealthPoolAddress?: string;
  tempBurner?: string;
  recipient?: string;
  amount?: number;
  asset?: string;
  fheHandle?: string;
  paymentFlow?: {
    setupTx?: string;
    paymentTx?: string;
    recoveryTx?: string;
  };
  timestamp: string;
  encrypted: boolean;
}

// Gateway Status
interface GatewayStatus {
  version: string;
  network: 'solana-mainnet' | 'solana-devnet';
  rpc_url: string;
  usdc_mint: string;
  payai: {
    facilitator: string;
    network: string;
  };
  fhe: {
    provider: string;
    mode: 'REAL' | 'SIMULATION';
    sdkLoaded: boolean;
  };
}

// Protected Resource (x402)
interface ProtectedResource {
  path: string;
  price: string;          // micro-USDC
  description: string;
  acceptedPayments: ('payai-direct')[];
}
```

---

## 12. Light Protocol Implementation Details

### 12.1 Light Client (`packages/gateway/src/light/client.ts`)

**Key Functions:**
```typescript
// Initialize Light connection
initLightConnection(): Promise<Rpc>

// Create compressed pool
createCompressedPool(ownerPubkey, sessionKeyPubkey): Promise<CompressedPoolResult>

// Create compressed burner
createCompressedBurner(poolOwnerPubkey, sessionKey): Promise<CompressedBurnerResult>

// Execute compressed transfer
executeCompressedTransfer(fromOwner, toAddress, amount, sessionKey): Promise<CompressedTransferResult>

// Compress (shield) tokens
compressTokens(ownerPubkey, amount, mint): Promise<Transaction>

// Get compressed balance
getCompressedBalance(ownerPubkey, mint): Promise<CompressedTokenBalance | null>

// Health check
checkLightHealth(): Promise<{ healthy: boolean; slot?: number }>

// Cost estimates
getCostEstimate(): { regularAccountRent, compressedAccountCost, savingsMultiplier }
```

### 12.2 Session Keys (`packages/gateway/src/light/session-keys.ts`)

**Session Key Interface:**
```typescript
interface LightSessionKey {
  publicKey: string;              // Session key public key
  encryptedSecret: string;         // AES-256-GCM encrypted secret key
  iv: string;                     // Initialization vector
  authTag: string;                // Authentication tag
  expiresAt: number;              // Unix timestamp
  maxPerTransaction: string;     // Micro-USDC
  dailyLimit: string;            // Micro-USDC
  spentToday: string;            // Micro-USDC (resets daily)
  status: 'active' | 'expired' | 'revoked';
}
```

**Key Functions:**
```typescript
// Create session key
createSessionKey(ownerAddress, limits, duration): Promise<LightSessionKey>

// Validate session
validateSessionKey(sessionKey, amount): Promise<boolean>

// Record spending
recordSpending(sessionKey, amount): void

// Revoke session
revokeSessionKey(sessionKey): void

// Get keypair for signing
getSessionKeypair(sessionKey): Keypair
```

### 12.3 Payment Routing Logic

**Default Behavior:**
```typescript
// In payment.ts POST /api/credits/pool/pay
const useLightMode = req.body.mode !== 'legacy';  // Default: true

if (useLightMode) {
  // Check Light health
  const lightHealth = await checkLightHealth();
  if (lightHealth.healthy) {
    // Execute Light compressed transfer
    const result = await executeCompressedTransfer(...);
  } else {
    // Fallback to legacy
    const result = await executePoolPayment(...);
  }
}
```

## 13. Common Tasks for LLMs

### Adding a New API Endpoint:
1. Create route in `packages/gateway/src/routes/`
2. Register in `packages/gateway/src/index.ts`
3. Add types to `packages/gateway/src/types.ts`
4. Add client function in `packages/dashboard/src/lib/gateway.ts`
5. Update `useGateway` hook if needed

### Adding Light Protocol Support to Existing Endpoint:
1. Import Light client functions from `../light/client.js`
2. Check Light health: `await checkLightHealth()`
3. Route to Light if healthy: `executeCompressedTransfer()` or `buildCompressedTransfer()`
4. Fallback to legacy if Light unavailable
5. Update response to include Light-specific fields (`proofHash`, `compression`, etc.)

### Adding a New Dashboard Component:
1. Create component in `packages/dashboard/src/components/`
2. Use `useGateway()` hook for data
3. Use `useWallet()` for wallet state
4. Follow existing styling (Tailwind + framer-motion)

### Modifying the Landing Page:
- Hero section: `packages/dashboard/src/components/hero/`
- Landing sections: `packages/dashboard/src/components/landing/`
- Main page: `packages/dashboard/src/app/landing/page.tsx`

### Testing Payment Flows:
1. Connect wallet on dashboard
2. Create stealth pool via StealthPayment component
3. Deposit USDC + SOL
4. Execute payment via API or dashboard
5. Check SessionLedger for transaction history

### Working with Agent Persistence:
**Key files:**
- `packages/gateway/src/routes/agents.ts` - Agent CRUD + persistence
- `packages/gateway/data/agents.json` - Persistent agent storage

**Important functions:**
```typescript
// Called on server startup
loadAgents();  // Restores agents from disk to memory Maps

// Called after every mutation (debounced 1s)
saveAgents();  // Persists agents to disk
```

**Always call `saveAgents()` after mutating agent state:**
```typescript
agent.status = 'paused';
agent.lastActivity = new Date().toISOString();
saveAgents();  // Don't forget this!
```

### Working with FHE-Encrypted Pool Keys:
**Key file:** `packages/gateway/src/inco/lightning-client.ts`

```typescript
// Encrypt pool private key
const encryptedKey = await inco.encryptBytes(poolSecretKey);
// Returns: { handle: "inco:fhe:v1:bytes:...", type: 'bytes', isReal: false }

// Decrypt pool private key (requires owner signature)
const secretKey = await inco.decryptBytes(handle, owner, signature);
// Returns: Buffer (64 bytes - Solana secret key)
```

---

## 13. Design Principles

1. **Non-Custodial First:** User funds are always user-controlled
2. **Privacy by Default:** Stealth addresses break on-chain correlation
3. **Gasless UX:** PayAI sponsors gas fees for smooth experience
4. **Developer Friendly:** Clear APIs, TypeScript throughout
5. **Industrial Aesthetic:** Monospace fonts, dark theme, cyber-industrial UI

---

## 14. Glossary

| Term | Definition |
|------|------------|
| **Light Protocol** | ZK Compression protocol for ~50x cheaper accounts |
| **Recovery Pool** | Dedicated fee payer infrastructure that preserves privacy by paying for burner operations (New in 5.0) |
| **PayAI x402** | Gasless transfer mechanism where PayAI pays gas for burner→recipient transfers (New in 5.0) |
| **3-Step Flow** | Pool→Burner (compressed) → Decompress in burner → PayAI x402 to recipient (Default in 5.0) |
| **Burner ATA** | Associated Token Account created in burner wallet, rent paid by Recovery Pool |
| **ATA Rent Recovery** | Closing burner ATA returns ~0.002 SOL to Recovery Pool |
| **Compressed Pool** | Light Protocol compressed account for holding funds |
| **Compressed Burner** | Ephemeral compressed account for single payment |
| **ZK Proof** | Zero-knowledge proof ensuring correctness without revealing details |
| **Merkle Tree** | Light Protocol state tree for compressed accounts |
| **Session Key** | Time-limited, revocable spending authority for agents |
| **Shield/Compress** | Move tokens from regular account to compressed account |
| **Unshield/Decompress** | Move tokens from compressed account to regular account |
| **Stealth Pool** | Server-managed wallet for private payments |
| **Burner Wallet** | Ephemeral keypair used for single payment |
| **x402** | HTTP payment protocol using 402 status code |
| **PayAI** | Third-party gas fee sponsor/facilitator |
| **Shadow Link** | One-time payment link (ghost invoice) |
| **Agent Persistence** | Agents saved to `data/agents.json` survive restarts |
| **Pool Assignment Mode** | USE_MAIN_POOL / CREATE_OWN_POOL / ASSIGN_TO_POOL / LIGHT_SESSION |
| **Paused Agent** | Agent with status='paused', rejects all payment requests |
| **Legacy Mode** | Pre-Light payment mode (higher costs, clustering risk) |

## 15. Cost & Privacy Comparison

### Legacy vs Light Protocol

| Metric | Legacy | Light Protocol | Improvement |
|--------|--------|----------------|-------------|
| **Account Rent** | ~0.002 SOL | ~0.00004 SOL | **50x cheaper** |
| **100 Payments Cost** | ~0.2 SOL | ~0.004 SOL | **~0.196 SOL saved** |
| **Privacy** | Ephemeral burner | Compressed burner | Better (less clustering) |
| **On-Chain Footprint** | Full account data | Compressed state | Reduced |
| **ZK Proofs** | None | Validity proofs | Correctness guarantees |

### Example Savings Calculation

For 1000 payments:
- Legacy: 1000 × 0.002 SOL = **2.0 SOL**
- Light: 1000 × 0.00004 SOL = **0.04 SOL**
- **Total Savings: 1.96 SOL (~$200 at $100/SOL)**

---

*Aegix 5.0: The Shielded Gateway with Light Protocol + PayAI x402. Private payments without custody, ~50x cheaper, fully gasless.* 🛡️✨

**Service providers see random burner wallets, not YOU. PayAI pays gas, Recovery Pool recovers rent.**
