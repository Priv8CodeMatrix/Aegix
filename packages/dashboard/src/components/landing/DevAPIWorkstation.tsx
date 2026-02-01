'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Terminal, Copy, Check, ExternalLink, 
  Plus, Zap, History, BookOpen
} from 'lucide-react';

interface CodeExample {
  id: string;
  method: string;
  endpoint: string;
  description: string;
  icon: React.ReactNode;
  code: string;
  response: string;
}

const CODE_EXAMPLES: CodeExample[] = [
  {
    id: 'create',
    method: 'POST',
    endpoint: '/stealth/create',
    description: 'Initialize a new stealth pool for your wallet',
    icon: <Plus className="w-4 h-4" />,
    code: `// Initialize Stealth Pool
const response = await fetch('https://api.aegix.dev/stealth/create', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    owner: 'YOUR_WALLET_ADDRESS',
    signature: 'WALLET_SIGNATURE',
    message: 'AEGIX_POOL_AUTH::...'
  })
});

const { poolId, poolAddress, status } = await response.json();`,
    response: `{
  "success": true,
  "data": {
    "poolId": "pool_a8f3c91d",
    "poolAddress": "9xK2m...7pQz",
    "status": "initialized",
    "createdAt": "2026-01-15T23:18:42Z"
  }
}`,
  },
  {
    id: 'execute',
    method: 'POST',
    endpoint: '/stealth/execute',
    description: 'Execute a privacy-preserving payment via x402',
    icon: <Zap className="w-4 h-4" />,
    code: `// Execute Stealth Payment
const payment = await fetch('https://api.aegix.dev/stealth/execute', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    poolId: 'pool_a8f3c91d',
    recipient: 'RECIPIENT_ADDRESS',
    amountUSDC: 0.05,
    useX402: true,  // Enable gasless mode
    metadata: {
      intentTag: 'API_Payment',
      merchantId: 'merchant_123'
    }
  })
});

const { sessionId, transactions, recovered } = await payment.json();`,
    response: `{
  "success": true,
  "data": {
    "sessionId": "sess_7b2e4f1a",
    "burnerUsed": "4pLx9...2mWk",
    "transactions": {
      "funding": "5xK2m...sig1",
      "ataCreation": "8nQz3...sig2", 
      "x402Payment": "2kMn7...sig3",
      "cleanup": "9vRt2...sig4"
    },
    "amounts": {
      "sent": "0.05 USDC",
      "gasUsed": "0.00089 SOL",
      "recovered": "0.00234 SOL"
    },
    "fheHandle": "0x8f3a...c91d",
    "latencyMs": 1240
  }
}`,
  },
  {
    id: 'history',
    method: 'GET',
    endpoint: '/stealth/history',
    description: 'Retrieve FHE-decrypted audit trail',
    icon: <History className="w-4 h-4" />,
    code: `// Get Decrypted Payment History
const history = await fetch(
  'https://api.aegix.dev/stealth/history?poolId=pool_a8f3c91d',
  {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY',
      'X-Decrypt-Signature': 'WALLET_SIGNATURE'  // Required for FHE decryption
    }
  }
);

const { sessions, totalVolume, totalRecovered } = await history.json();`,
    response: `{
  "success": true,
  "data": {
    "poolId": "pool_a8f3c91d",
    "sessions": [
      {
        "sessionId": "sess_7b2e4f1a",
        "timestamp": "2026-01-15T23:18:42Z",
        "burner": "4pLx9...2mWk",
        "recipient": "OpenAI_API",
        "amount": "0.05 USDC",
        "intentTag": "GPT-4_Completion",
        "fheHandle": "0x8f3a...c91d",
        "status": "confirmed"
      }
    ],
    "summary": {
      "totalSessions": 42,
      "totalVolume": "2.45 USDC",
      "totalRecovered": "0.0892 SOL",
      "avgLatencyMs": 1180
    }
  }
}`,
  },
];

export function DevAPIWorkstation() {
  const [activeTab, setActiveTab] = useState('create');
  const [copied, setCopied] = useState<string | null>(null);
  const [showResponse, setShowResponse] = useState(true);

  const activeExample = CODE_EXAMPLES.find((e) => e.id === activeTab)!;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <section className="py-24 bg-slate-950 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Section Header */}
        <div className="mb-16">
          <div className="flex items-center gap-3 mb-4">
            <Terminal className="w-5 h-5 text-slate-500" />
            <span className="text-xs font-mono text-slate-500 tracking-wider">
              SECTION_05
            </span>
          </div>
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-3xl font-semibold text-white mb-4">
                Developer API Workstation
              </h2>
              <p className="text-slate-400 max-w-2xl">
                Integrate privacy-preserving payments in minutes. Full TypeScript SDK 
                with comprehensive documentation.
              </p>
            </div>
            <a
              href="https://docs.aegix.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 border border-slate-700 hover:border-slate-600 text-slate-400 hover:text-slate-300 text-xs font-mono transition-colors"
            >
              <BookOpen className="w-4 h-4" />
              Full_Documentation
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* API Workstation */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="border border-slate-800 bg-slate-900/50"
        >
          {/* Tabs */}
          <div className="flex border-b border-slate-800">
            {CODE_EXAMPLES.map((example) => (
              <button
                key={example.id}
                onClick={() => setActiveTab(example.id)}
                className={`flex items-center gap-2 px-4 py-3 text-xs font-mono border-b-2 transition-colors ${
                  activeTab === example.id
                    ? 'border-blue-500 text-white bg-slate-800/50'
                    : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/30'
                }`}
              >
                {example.icon}
                <span className={activeTab === example.id ? 'text-blue-400' : ''}>
                  {example.method}
                </span>
                <span>{example.endpoint}</span>
              </button>
            ))}
          </div>

          {/* Description Bar */}
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/50">
            <p className="text-[11px] font-mono text-slate-500">
              {activeExample.description}
            </p>
          </div>

          {/* Code Content */}
          <div className="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
            {/* Request */}
            <div className="relative">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-950/50">
                <span className="text-[10px] font-mono text-slate-500">REQUEST</span>
                <button
                  onClick={() => handleCopy(activeExample.code, 'code')}
                  className="flex items-center gap-1.5 px-2 py-1 hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {copied === 'code' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span className="text-[10px] font-mono">
                    {copied === 'code' ? 'Copied!' : 'Copy'}
                  </span>
                </button>
              </div>
              <div className="p-4 overflow-x-auto">
                <pre className="text-[11px] font-mono text-slate-300 leading-relaxed whitespace-pre-wrap">
                  {activeExample.code.split('\n').map((line, i) => (
                    <div key={i} className="flex">
                      <span className="text-slate-600 w-6 flex-shrink-0 select-none">
                        {i + 1}
                      </span>
                      <span>
                        {line.includes('//') ? (
                          <span className="text-slate-600">{line}</span>
                        ) : line.includes("'") || line.includes('"') ? (
                          <span>
                            {line.split(/(['"][^'"]*['"])/).map((part, j) =>
                              part.match(/^['"]/) ? (
                                <span key={j} className="text-emerald-400">{part}</span>
                              ) : (
                                <span key={j}>{part}</span>
                              )
                            )}
                          </span>
                        ) : (
                          line
                        )}
                      </span>
                    </div>
                  ))}
                </pre>
              </div>
            </div>

            {/* Response */}
            <div className="relative">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-950/50">
                <span className="text-[10px] font-mono text-slate-500">RESPONSE</span>
                <button
                  onClick={() => handleCopy(activeExample.response, 'response')}
                  className="flex items-center gap-1.5 px-2 py-1 hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {copied === 'response' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span className="text-[10px] font-mono">
                    {copied === 'response' ? 'Copied!' : 'Copy'}
                  </span>
                </button>
              </div>
              <div className="p-4 overflow-x-auto bg-slate-950/30">
                <pre className="text-[11px] font-mono text-slate-400 leading-relaxed">
                  {activeExample.response}
                </pre>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-slate-800 bg-slate-900/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="text-[10px] font-mono text-slate-600">
                  Base_URL: https://api.aegix.dev
                </span>
                <span className="text-slate-800">|</span>
                <span className="text-[10px] font-mono text-slate-600">
                  Auth: Bearer Token
                </span>
                <span className="text-slate-800">|</span>
                <span className="text-[10px] font-mono text-slate-600">
                  Format: JSON
                </span>
              </div>
              <a
                href="https://docs.aegix.dev/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-mono text-blue-400 hover:text-blue-300"
              >
                View_Full_API_Spec →
              </a>
            </div>
          </div>
        </motion.div>

        {/* Quick Start */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-8 grid md:grid-cols-3 gap-4"
        >
          <div className="p-4 border border-slate-800 bg-slate-900/30">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 flex items-center justify-center border border-emerald-800 bg-emerald-900/30 text-[10px] font-mono text-emerald-400">
                1
              </div>
              <span className="text-xs font-mono text-slate-300">INSTALL_SDK</span>
            </div>
            <code className="text-[11px] font-mono text-slate-500 block mt-2 p-2 bg-slate-950 border border-slate-800">
              npm install @aegix/sdk
            </code>
          </div>

          <div className="p-4 border border-slate-800 bg-slate-900/30">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 flex items-center justify-center border border-blue-800 bg-blue-900/30 text-[10px] font-mono text-blue-400">
                2
              </div>
              <span className="text-xs font-mono text-slate-300">GET_API_KEY</span>
            </div>
            <code className="text-[11px] font-mono text-slate-500 block mt-2 p-2 bg-slate-950 border border-slate-800">
              aegix auth login
            </code>
          </div>

          <div className="p-4 border border-slate-800 bg-slate-900/30">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 flex items-center justify-center border border-purple-800 bg-purple-900/30 text-[10px] font-mono text-purple-400">
                3
              </div>
              <span className="text-xs font-mono text-slate-300">START_BUILDING</span>
            </div>
            <code className="text-[11px] font-mono text-slate-500 block mt-2 p-2 bg-slate-950 border border-slate-800">
              aegix init my-project
            </code>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export default DevAPIWorkstation;

