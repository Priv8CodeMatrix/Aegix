# Aegix

**Privacy-First Agent Payment Gateway for Solana**

Aegix enables AI agents to pay for services (APIs, compute, data) while maintaining complete anonymity for the agent's owner and usage patterns. Built on Solana with Fully Homomorphic Encryption (FHE) via Inco Network.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         AI AGENT                                │
│                    (Client Application)                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │ HTTP 402 Payment Required
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AEGIX GATEWAY                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   x402      │  │    Inco     │  │        Solana           │ │
│  │  Protocol   │◄─┤    FHE      │◄─┤       Settlement        │ │
│  │  Handler    │  │   Vault     │  │        Layer            │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │ Confidential Payment
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SERVICE PROVIDER                             │
│                   (Resource Server)                             │
└─────────────────────────────────────────────────────────────────┘
```

## Core Features

- **🔐 Anonymous x402 Handshake** - Pay for APIs without revealing your identity
- **💰 Confidential Credit Ledger** - FHE-encrypted balances on Inco Network
- **🛡️ Metadata Shielding** - No IP-to-wallet correlation
- **📊 Private Audit Logs** - Only you can decrypt your payment history

## Tech Stack

| Component | Technology |
|-----------|------------|
| Blockchain | Solana (Devnet/Mainnet) |
| Privacy Layer | Inco Network (FHE) |
| Payment Protocol | x402 (HTTP 402) |
| Backend | Node.js + Express |
| Frontend | Next.js 14 + React |
| Styling | Tailwind CSS |

## Project Structure

```
aegix/
├── packages/
│   ├── gateway/          # x402 Payment Gateway Service
│   │   ├── src/
│   │   │   ├── x402/     # Protocol implementation
│   │   │   ├── solana/   # Blockchain client
│   │   │   ├── inco/     # FHE integration
│   │   │   └── routes/   # API endpoints
│   │   └── package.json
│   │
│   └── dashboard/        # Next.js Frontend
│       ├── src/
│       │   ├── app/      # App router pages
│       │   └── components/
│       └── package.json
│
├── pdr.md               # Preliminary Design Review
├── turbo.json           # Turborepo config
└── package.json         # Root workspace
```

## Quick Start

### Prerequisites

- Node.js 18+
- npm 10+
- Solana CLI (optional, for wallet management)

### Installation

```bash
# Clone and install
git clone <repository>
cd aegix
npm install

# Start development servers
npm run dev
```

### Individual Services

```bash
# Run only the gateway (port 3001)
npm run gateway

# Run only the dashboard (port 3000)
npm run dashboard
```

## API Reference

### Gateway Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/credits/resources` | GET | List protected resources |
| `/api/credits/deposit` | POST | Deposit USDC for credits |
| `/api/credits/balance/:owner` | GET | Get encrypted balance |
| `/api/credits/balance/decrypt` | POST | Decrypt balance (requires signature) |
| `/api/credits/pay` | POST | Pay with confidential credits |
| `/api/credits/audit/:owner` | GET | Get encrypted audit log |
| `/api/ai/completion` | POST | AI completion (402 protected) |
| `/api/ai/embedding` | POST | Embeddings (402 protected) |

### x402 Flow

1. Agent requests protected resource
2. Gateway returns `402 Payment Required` with payment details
3. Agent sends payment via Solana or confidential credits
4. Agent retries request with `X-Payment` header
5. Gateway verifies payment and grants access

## Configuration

Create a `.env` file in `packages/gateway/`:

```env
# Server
PORT=3001

# Solana
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
FACILITATOR_PRIVATE_KEY=<base58-encoded-key>
FACILITATOR_ADDRESS=<public-key>

# Inco Network
INCO_NETWORK_URL=https://lightning.inco.org
```

## Security

- **FHE Encryption**: All balances are encrypted using Fully Homomorphic Encryption
- **No Data Leakage**: Gateway cannot see user balances or audit logs
- **Signature Verification**: All operations require cryptographic signatures
- **Fresh Addresses**: Payments routed through new addresses to prevent tracking

## Roadmap

- [x] Phase 1: x402 Gateway with Solana USDC
- [x] Phase 2: Inco FHE integration (simulated)
- [x] Phase 3: Dashboard with wallet connection
- [ ] Phase 4: Production Inco Network integration
- [ ] Phase 5: Multi-chain support
- [ ] Phase 6: Agent SDK release

## License

MIT

---

**Built for the Autonomous Agent Economy** 🤖🔐

