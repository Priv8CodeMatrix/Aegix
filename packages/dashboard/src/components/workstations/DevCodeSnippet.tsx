'use client';

import { useState } from 'react';
import { Copy, Check, Code2, ExternalLink } from 'lucide-react';

const API_CODE = `POST /api/credits/pool/pay
Content-Type: application/json

{
  "owner": "YOUR_WALLET_ADDRESS",
  "recipient": "RECIPIENT_ADDRESS",
  "amountUSDC": "0.05",
  "useX402": true,
  "signature": "base64_signature",
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
}`;

export function DevCodeSnippet() {
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    navigator.clipboard.writeText(API_CODE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border border-slate-800 bg-slate-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-xs font-mono text-slate-400">DEVELOPER_INTEGRATION</span>
        </div>
        <a
          href="https://docs.aegix.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-mono text-slate-500 hover:text-slate-400 flex items-center gap-1 transition-colors"
        >
          VIEW_FULL_SPECS
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Code Block */}
      <div className="p-4 relative">
        <button
          onClick={copyCode}
          className="absolute top-6 right-6 p-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 transition-colors"
          title="Copy Code"
        >
          {copied ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <Copy className="w-4 h-4 text-slate-500" />
          )}
        </button>
        <pre className="overflow-x-auto">
          <code className="text-xs font-mono text-slate-300 leading-relaxed whitespace-pre">
            {API_CODE}
          </code>
        </pre>
      </div>
    </div>
  );
}

export default DevCodeSnippet;
