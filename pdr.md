# PDR: Aegix — Privacy-First Agent Payment Gateway

**Version:** 4.0 (Light Protocol Integration)  
**Status:** Production Ready  
**Core Stack:** Solana, Light Protocol (ZK Compression), Inco Network (FHE), x402 Protocol, PayAI, Stealth Addresses  
**Architecture:** 🛡️ **NON-CUSTODIAL + PRIVATE + COMPRESSED**

---

## 1. Executive Summary

Aegix 4.0 is a **non-custodial, privacy-preserving** payment gateway designed for the autonomous agent economy on Solana. It enables AI agents AND humans to pay for services (APIs, compute, data) while **completely hiding the link between the user's wallet and the payment** using **Light Protocol ZK Compression**.

**Key Innovation: Light Protocol ZK Compression + Stealth Addresses**

Aegix 4.0 combines two powerful privacy technologies:
1. **Light Protocol ZK Compression**: ~50x cheaper than regular accounts, compressed state reduces on-chain footprint
2. **Stealth Addresses**: One-time burner wallets break sender linkage

**How It Works:**
```
User Wallet → [Compressed Pool] → [Compressed Burner] → Service Provider
                    ↑                      ↑
          Light ZK Compression    Inco FHE encrypts link!
```

The service provider sees a payment from a random compressed burner wallet. They have **NO idea** it's linked to the user's main account. Payments are ~50x cheaper than legacy ephemeral accounts.

**Default Mode:** Light Protocol is now the **default payment path** for ALL flows:
- ✅ Human manual stealth payments
- ✅ Ghost invoices (shadow links)
- ✅ Autonomous agent payments

---

## 2. The Non-Custodial Privacy Paradox (Solved!)

### The Problem with v2.0

In v2.0, we encrypted audit logs but payments were still public on Solana:
- ❌ Anyone could see: "Wallet ABC paid Service XYZ for an API call"
- ❌ Competitors could track your usage patterns
- ❌ The "FHE audit log" was like locking your diary while broadcasting your bank statement

### The Solution: Stealth Addresses

```
┌─────────────────────────────────────────────────────────────┐
│              AEGIX 3.0 STEALTH PAYMENT FLOW                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   User Wallet                                                │
│        │                                                     │
│        ▼ (fund stealth)                                     │
│   ┌────────────────┐                                        │
│   │ Stealth Burner │ ◄── Fresh keypair for this payment    │
│   │    (one-time)  │                                        │
│   └───────┬────────┘                                        │
│           │                                                  │
│           │ ◄── Inco FHE encrypts the owner↔stealth link    │
│           │                                                  │
│           ▼ (pay service)                                   │
│   Service Provider                                          │
│        │                                                     │
│        ▼ (sees)                                             │
│   "Payment from random wallet 7xK...9Qz"                    │
│   "NO link to user's main wallet!"                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Privacy Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **State Compression** | **Light Protocol (ZK Compression)** | ~50x cheaper accounts, reduced on-chain footprint |
| Payment Handshake | x402 Protocol | Automates the "How much do I pay?" negotiation |
| Identity Obfuscation | **Stealth Addresses + Compressed Burners** | Service provider never sees the owner's main wallet |
| Confidential Linkage | Inco Network (FHE) | Maps Stealth↔Owner so **only you** can see your history |
| Settlement | Solana + PayAI | Fast, cheap USDC movement |
| **Agent Autonomy** | **Session Keys (Semi-Custodial)** | Time-limited, revocable spending authority for agents |

---

## 4. Technical Flow

### Light Protocol Payment Flow (Default - Aegix 4.0)

#### Step 1: Create Compressed Pool (Light Mode)
```typescript
POST /api/credits/pool/init
{
  "owner": "UserMainWalletAddress",
  "signedMessage": "base64-signature"
}

Response:
{
  "poolId": "pool-abc123",
  "poolAddress": "5Yx...pool...eU",
  "mode": "light",  // Light Protocol enabled
  "lightEnabled": true
}
```

#### Step 2: Shield/Compress Funds (User Signs Once)
```typescript
POST /api/agents/:id/light/fund-pool
{
  "owner": "UserMainWalletAddress",
  "amount": "1000000"  // 1 USDC in micro-units
}

// Returns compressed transaction for user to sign
// User shields USDC into compressed account (one-time signature)
```

#### Step 3: Execute Compressed Payment (Autonomous!)
```typescript
POST /api/credits/pool/pay
{
  "owner": "UserMainWalletAddress",
  "recipient": "ServiceProviderAddress",
  "amountUSDC": "0.05",
  "mode": "light"  // Default, can omit
}

Response:
{
  "success": true,
  "data": {
    "paymentTx": "4siR6W...AJPM",
    "tempBurnerAddress": "compressed-burner-address",
    "method": "light_compressed",
    "light": {
      "enabled": true,
      "proofHash": "abc123...",
      "compression": {
        "savingsPerPayment": "0.001999 SOL",
        "multiplier": 50
      }
    }
  }
}

// Server creates compressed burner, executes ZK transfer
// NO USER SIGNATURE NEEDED after initial shielding!
// Service provider sees random compressed burner
```

#### Step 4: View Compressed History
```typescript
GET /api/credits/audit/:owner

// Returns compressed payment history with proof hashes
// Shows compression savings vs legacy
```

### Legacy Flow (Fallback)

Legacy mode still works but shows warnings:
- Higher costs (~50x more expensive)
- Potential clustering risk
- Migration prompts in UI

---

## 5. Privacy Guarantees

### What Service Providers See:
- ✅ Payment from a random, new wallet address
- ✅ Payment confirmation
- ❌ User's main wallet address (HIDDEN!)
- ❌ User's payment history (HIDDEN!)
- ❌ Connection to other payments (HIDDEN!)

### What Users Can See (via FHE decryption):
- ✅ Full stealth address history
- ✅ Which services they paid
- ✅ How much they spent
- ✅ Proof of ownership

### What On-Chain Observers See:
- ✅ Stealth wallet funded from user
- ✅ Stealth wallet paid service
- ❌ Direct link from user to service (BROKEN!)

---

## 6. Value Proposition

### Who Needs This?

1. **AI Agent Companies**
   - Competitors can't see your API usage patterns
   - Hide which models/services you're integrating

2. **Enterprise Users**
   - Usage anonymity for sensitive queries
   - No public trail of AI service consumption

3. **Privacy-Conscious Individuals**
   - Pay for services without linking to your identity
   - Financial privacy on a public blockchain

### What You're Selling: **Usage Anonymity**

> "Companies don't want their competitors to see they are querying a 'Bankrupt Companies' API 50,000 times a day. Aegix masks that pattern."

---

## 7. API Reference

### Light Protocol Endpoints (Aegix 4.0 - Default)
```
POST /api/agents/:id/light/create-session → Create Light session key (owner signs once)
POST /api/agents/:id/light/fund-pool       → Get compress transaction (shield funds)
POST /api/agents/:id/light/revoke-session  → Revoke agent session
GET  /api/agents/:id/light/status         → Get Light session status & balance
GET  /api/agents/light/health              → Check Light Protocol health
GET  /api/credits/light/estimate          → Get cost estimates (Light vs legacy)
```

### Stealth Payment Endpoints (Light by Default)
```
POST /api/credits/pool/init               → Create pool (Light mode default)
POST /api/credits/pool/pay                 → Execute payment (Light compressed default)
GET  /api/credits/pool/:owner              → Get pool info
POST /api/credits/pool/deposit             → Deposit to pool
POST /api/credits/pool/withdraw            → Withdraw from pool
GET  /api/credits/audit/:owner             → View encrypted history
```

### Shadow Links / Ghost Invoices (Light Enabled)
```
POST /api/shadow-link/create              → Create invoice (Light compressed burner)
GET  /api/shadow-link/:id                  → Get invoice details
POST /api/shadow-link/:id/pay              → Execute payment (Light mode)
POST /api/shadow-link/:id/sweep            → Sweep to pool
GET  /api/shadow-link/owner/:owner         → List owner's invoices
```

### Agent Management
```
POST /api/agents/register                  → Create agent, get API key
GET  /api/agents/:owner                    → List owner's agents
PATCH /api/agents/:agentId                  → Update agent config
DELETE /api/agents/:agentId                 → Delete agent
```

### Migration Endpoints
```
GET  /api/agents/migration/status           → Overview of migration status
GET  /api/agents/:id/migration/prepare      → Preview migration steps
POST /api/agents/:id/migration/execute      → Execute migration to Light
```

### x402 Protected Resources
```
POST /api/ai/completion                    → AI completion (402 protected)
POST /api/ai/embedding                     → Embeddings (402 protected)
POST /api/data/query                       → Data query (402 protected)
```

---

## 8. Implementation Status

### ✅ Phase 1: Non-Custodial Gateway (Complete)
- Express.js gateway with x402 support
- Agent registration and API key management
- PayAI integration for direct payments

### ✅ Phase 2: Dashboard (Complete)
- Next.js frontend with wallet connection
- Agent management (create, configure, delete)
- Activity log viewer

### ✅ Phase 3: Stealth Addresses (Complete)
- One-time burner wallet generation
- Server-side signing for stealth payments
- FHE encrypted owner↔stealth mapping
- StealthPayment dashboard component

### ✅ Phase 4: Light Protocol Integration (Complete - Aegix 4.0)
- **Light Protocol ZK Compression** as default payment path
- Compressed pools and burners for ~50x cost savings
- Session keys for autonomous agent spending
- Light-enabled ghost invoices (shadow links)
- Migration tools from legacy to Light
- Updated ledger visualization for compressed payments
- Real-time cost savings display

### 🔄 Phase 5: Production Optimization (In Progress)
- Production Inco SDK integration
- On-chain encrypted audit storage
- Multi-stealth batching for high-volume users
- Light Protocol v3 private transfers (when mainnet-ready)

---

## 9. Security Model

**Non-Custodial:**
- Aegix never holds user funds
- Stealth keypairs are ephemeral (used once, discarded)
- No private key storage required

**Privacy:**
- Owner↔Stealth mapping encrypted with Inco FHE
- Only wallet owner can decrypt their stealth history
- Service providers cannot trace payments

**Integrity:**
- All stealth transactions are on-chain and verifiable
- FHE handles provide cryptographic proof of ownership

---

## 10. Cost & Privacy Benefits

### Light Protocol Advantages

**Cost Savings:**
- Regular account rent: ~0.002 SOL per ephemeral account
- Compressed account cost: ~0.00004 SOL
- **Savings multiplier: ~50x cheaper**

**Privacy Benefits:**
- Compressed burners break sender linkage
- Reduced on-chain footprint (less clustering)
- ZK proofs ensure correctness without revealing details
- Each payment uses unique compressed burner

**Example Savings:**
- 100 payments legacy: ~0.2 SOL in rent
- 100 payments Light: ~0.004 SOL in compression
- **Total savings: ~0.196 SOL per 100 payments**

## 11. Future Roadmap

1. **Light Protocol v3 Private Transfers:** Full shielded transfers when mainnet-ready
2. **Stealth Batching:** Create multiple compressed addresses upfront
3. **Cross-Chain:** Extend to Base, Polygon, Arbitrum with Light
4. **Hardware Wallets:** Ledger/Trezor signing for funding transactions
5. **Spending Limits:** Enforce limits per compressed pool
6. **Mixer Integration:** Optional mixing before compression for additional privacy

---

*Aegix 4.0: The Shielded Gateway with Light Protocol. Private payments without custody, ~50x cheaper.* 🛡️✨

**Service providers see random compressed wallets, not YOU.**
