'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import { Copy, Check, Code2 } from 'lucide-react';

interface ApiExample {
  id: string;
  method: string;
  endpoint: string;
  title: string;
  description: string;
  code: string;
}

const API_EXAMPLES: ApiExample[] = [
  {
    id: 'create',
    method: 'POST',
    endpoint: '/api/credits/pool/init',
    title: 'Initialize Stealth Pool',
    description: 'Create and initialize a stealth pool wallet for private payments',
    code: `POST /api/credits/pool/init
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY

{
  "owner": "7ygiJvnG8kAWYu2BKEEAU6TGLzWhoy3J3VHzPkLzCra9",
  "signature": "base64_encoded_signature",
  "message": "AEGIX_POOL_AUTH::..."
}

Response:
{
  "success": true,
  "data": {
    "poolId": "pool_abc123",
    "poolAddress": "9xK2m...7pQz",
    "status": "created",
    "legacyPoolAddress": "4nP8r...2mLx"
  }
}`,
  },
  {
    id: 'execute',
    method: 'POST',
    endpoint: '/api/credits/pool/pay',
    title: 'Execute Stealth Payment',
    description: 'Execute a private payment via x402 protocol with PayAI gasless support',
    code: `POST /api/credits/pool/pay
Content-Type: application/json

{
  "owner": "7ygiJvnG8kAWYu2BKEEAU6TGLzWhoy3J3VHzPkLzCra9",
  "recipient": "Recipient_Wallet_Address",
  "amountUSDC": "0.05",
  "useX402": true,
  "signature": "base64_encoded_signature",
  "message": "AEGIX_PAYMENT::..."
}

Response:
{
  "success": true,
  "data": {
    "paymentId": "pay_xyz789",
    "burnerAddress": "9xK2m...7pQz",
    "transaction": {
      "signature": "5xK9m...8pQz",
      "status": "pending",
      "method": "x402"
    },
    "fheHandle": "0x8f3a...c91d"
  }
}`,
  },
  {
    id: 'history',
    method: 'GET',
    endpoint: '/api/credits/audit/:owner',
    title: 'Retrieve Audit History',
    description: 'Get FHE-decrypted audit trail for all payments',
    code: `GET /api/credits/audit/7ygiJvnG8kAWYu2BKEEAU6TGLzWhoy3J3VHzPkLzCra9
Authorization: Bearer YOUR_API_KEY

Response:
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": "session_123",
        "timestamp": "2026-01-15T23:18:42Z",
        "amount": "0.05",
        "recipient": "Recipient_Address",
        "burnerAddress": "9xK2m...7pQz",
        "fheHandle": "0x8f3a...c91d",
        "status": "confirmed",
        "transactions": [
          {
            "type": "pool_to_burner",
            "signature": "5xK9m...8pQz"
          },
          {
            "type": "x402_payment",
            "signature": "7yP2k...9nRw"
          }
        ]
      }
    ]
  }
}`,
  },
];

export function DeveloperWorkstation() {
  const [activeTab, setActiveTab] = useState<string>(API_EXAMPLES[0].id);
  const [copied, setCopied] = useState<string | null>(null);

  const activeExample = API_EXAMPLES.find((ex) => ex.id === activeTab) || API_EXAMPLES[0];

  const copyCode = () => {
    navigator.clipboard.writeText(activeExample.code);
    setCopied(activeTab);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <section className="relative py-32 px-6 lg:px-8 bg-transparent">
      {/* Section Background - Outside-in gradient with slight amber tint */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_30%,_rgba(245,158,11,0.03)_60%,_rgba(15,23,42,0.12)_100%)] -z-10" />
      
      {/* Top Divider */}
      <div className="absolute top-0 left-0 right-0 h-px bg-slate-800/80" />
      
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-20 pt-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="inline-block px-3 py-1.5 border border-slate-700 bg-slate-950 mb-4"
          >
            <span className="text-[11px] font-mono text-slate-400 tracking-wide">DEVELOPER_INTEGRATION</span>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="text-3xl md:text-4xl font-semibold text-white mb-4 font-sans"
          >
            Developer API Workstation
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="text-slate-400 text-lg max-w-2xl font-sans"
          >
            Integrate stealth payments in minutes. RESTful API with FHE-encrypted audit trails and x402 gasless support.
          </motion.p>
        </div>

        {/* API Workstation */}
        <div className="border border-slate-800 bg-slate-950">
          {/* Tabs */}
          <div className="flex border-b border-slate-800">
            {API_EXAMPLES.map((example) => (
              <button
                key={example.id}
                onClick={() => setActiveTab(example.id)}
                className={`px-6 py-4 text-sm font-mono flex items-center gap-2 transition-colors border-b-2 ${
                  activeTab === example.id
                    ? 'border-blue-500 text-white bg-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-300 hover:bg-slate-900/50'
                }`}
              >
                <Code2 className="w-4 h-4" />
                <div className="text-left">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono ${
                      example.method === 'POST' ? 'text-emerald-400' : 'text-blue-400'
                    }`}>
                      {example.method}
                    </span>
                    <span className="text-xs text-slate-600">/</span>
                    <span className="text-xs">{example.endpoint}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{example.title}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Active Tab Content */}
          <div className="p-6">
            {/* Description */}
            <p className="text-sm text-slate-400 mb-4 font-sans">{activeExample.description}</p>

            {/* Code Block */}
            <div className="relative">
              <button
                onClick={copyCode}
                className="absolute top-4 right-4 p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
                title="Copy Code"
              >
                {copied === activeTab ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4 text-slate-400" />
                )}
              </button>
              <pre className="p-6 bg-slate-900 border border-slate-800 overflow-x-auto">
                <code className="text-xs font-mono text-slate-300 leading-relaxed whitespace-pre">
                  {activeExample.code}
                </code>
              </pre>
            </div>
          </div>
        </div>
      </div>
      
      {/* Bottom Spacer */}
      <div className="h-20" />
    </section>
  );
}

export default DeveloperWorkstation;

