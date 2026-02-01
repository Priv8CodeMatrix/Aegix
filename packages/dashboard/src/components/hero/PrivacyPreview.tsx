'use client';

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Lock, Unlock, Copy, Check, ExternalLink } from 'lucide-react';

export function PrivacyPreview() {
  // Hardcoded test transaction for landing page demo
  const TEST_TRANSACTION = {
    tempBurner: '7p3ZGjrN1kKfXQz8m9P2eY1PMR4nL6vC8wT3jH5dF7qB9sX',
    stealthPoolAddress: '6su2FJJY8kAWYu2BKEEAU6TGLzWhoy3J3VHzPkLzCra9gPjb7q',
    recipient: '7ygijvnG8kAWYu2BKEEAU6TGLzWhoy3J3VHzPkLzCra9',
    amount: '100000', // 0.10 USDC in micro-USDC
    timestamp: '2026-01-16T01:09:05.000Z',
    fheHandle: '0x04d4597c8a3f2e1b9d4c8e5f6a7b3c9d1e4f8a2b5c7d9e3f1a6b8c4d2e7f9a1b3c',
    id: 'test_tx_landing_demo_2026',
    method: 'x402',
    service: 'Test Merchant',
  };

  // Use test transaction instead of dynamic data
  const latestPayment = TEST_TRANSACTION;

  const [view, setView] = useState<'merchant' | 'user'>('merchant');
  const [copied, setCopied] = useState(false);
  const [clientTimestamp, setClientTimestamp] = useState<string>('');

  // Set client timestamp only on client side after hydration
  useEffect(() => {
    setClientTimestamp(new Date().toISOString().replace('T', ' ').split('.')[0]);
  }, []);

  const merchantData = useMemo(() => {
    if (!latestPayment?.tempBurner) {
      return {
        sender: 'No payments yet',
        label: 'BURNER_WALLET',
        amount: '0.00 USDC',
        timestamp: clientTimestamp || '—', // Use state or placeholder
        note: 'Make a payment to see burner address',
      };
    }
    return {
      sender: `${latestPayment.tempBurner.slice(0, 6)}...${latestPayment.tempBurner.slice(-4)}`,
      label: 'BURNER_WALLET_EPHEMERAL',
      amount: latestPayment.amount
        ? `${(parseInt(latestPayment.amount) / 1000000).toFixed(2)} USDC`
        : '0.00 USDC',
      timestamp: new Date(latestPayment.timestamp).toISOString().replace('T', ' ').split('.')[0],
      note: 'One-time ephemeral address',
    };
  }, [latestPayment, clientTimestamp]);

  const userData = useMemo(() => {
    // Use fixed test main wallet for demo
    const mainWallet = '7ygiJvnG8kAWYu2BKEEAU6TGLzWhoy3J3VHzPkLzCra9';
    
    if (!latestPayment) {
      return {
        sender: mainWallet,
        label: 'YOUR_MAIN_WALLET',
        stealthPool: 'N/A',
        burner: 'N/A',
        recipient: 'N/A',
        amount: '0.00 USDC',
        fheHandle: 'N/A',
        auditId: 'N/A',
      };
    }
    
    return {
      sender: mainWallet,
      label: 'YOUR_MAIN_WALLET',
      stealthPool: latestPayment.stealthPoolAddress
        ? `${latestPayment.stealthPoolAddress.slice(0, 8)}...${latestPayment.stealthPoolAddress.slice(-6)}`
        : 'N/A',
      burner: latestPayment.tempBurner
        ? `${latestPayment.tempBurner.slice(0, 8)}...${latestPayment.tempBurner.slice(-6)}`
        : 'N/A',
      recipient: latestPayment.recipient
        ? `${latestPayment.recipient.slice(0, 8)}...${latestPayment.recipient.slice(-6)}`
        : 'N/A',
      amount: latestPayment.amount
        ? `${(parseInt(latestPayment.amount) / 1000000).toFixed(2)} USDC`
        : '0.00 USDC',
      fheHandle: latestPayment.fheHandle
        ? `${latestPayment.fheHandle.slice(0, 6)}...${latestPayment.fheHandle.slice(-4)}`
        : 'N/A',
      auditId: latestPayment.id || 'N/A',
    };
  }, [latestPayment]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6 }}
      className="border border-slate-700 bg-slate-950"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-slate-400">PRIVACY_PREVIEW</span>
          <span className="text-[10px] font-mono text-slate-600">Zero-Knowledge Payment View</span>
        </div>
      </div>

      {/* Toggle */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex gap-2">
          <button
            onClick={() => setView('merchant')}
            className={`flex-1 py-2.5 px-4 text-xs font-mono flex items-center justify-center gap-2 transition-all ${
              view === 'merchant'
                ? 'bg-slate-800 text-white border border-slate-600'
                : 'bg-slate-900 text-slate-500 border border-slate-800 hover:border-slate-700'
            }`}
          >
            <EyeOff className="w-3.5 h-3.5" />
            MERCHANT_VIEW
          </button>
          <button
            onClick={() => setView('user')}
            className={`flex-1 py-2.5 px-4 text-xs font-mono flex items-center justify-center gap-2 transition-all ${
              view === 'user'
                ? 'bg-slate-800 text-white border border-slate-600'
                : 'bg-slate-900 text-slate-500 border border-slate-800 hover:border-slate-700'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            YOUR_VIEW
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 min-h-[200px]">
        <AnimatePresence mode="wait">
          {view === 'merchant' ? (
            <motion.div
              key="merchant"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {/* What Merchant Sees Header */}
              <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                <Lock className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-mono text-emerald-400">
                  MERCHANT SEES: Anonymous Burner
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 border border-slate-800 bg-slate-900">
                  <div>
                    <p className="text-[9px] text-slate-500 font-mono">SENDER_ADDRESS</p>
                    <p className="text-sm text-white font-mono">{merchantData.sender}</p>
                  </div>
                  <div className="px-2 py-1 bg-amber-950/50 border border-amber-900/50">
                    <span className="text-[10px] font-mono text-amber-400">EPHEMERAL</span>
                  </div>
                </div>

                <div className="p-3 border border-slate-800 bg-slate-900">
                  <p className="text-[9px] text-slate-500 font-mono">WALLET_TYPE</p>
                  <p className="text-sm text-slate-300 font-mono">{merchantData.label}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 border border-slate-800 bg-slate-900">
                    <p className="text-[9px] text-slate-500 font-mono">AMOUNT</p>
                    <p className="text-sm text-white font-mono">{merchantData.amount}</p>
                  </div>
                  <div className="p-3 border border-slate-800 bg-slate-900">
                    <p className="text-[9px] text-slate-500 font-mono">TIMESTAMP</p>
                    <p className="text-[11px] text-slate-400 font-mono">{merchantData.timestamp}</p>
                  </div>
                </div>

                <div className="p-3 border border-amber-900/30 bg-amber-950/20">
                  <p className="text-[10px] font-mono text-amber-400">
                    ⚡ {merchantData.note}
                  </p>
                  <p className="text-[9px] font-mono text-slate-500 mt-1">
                    Merchant cannot trace this to your main wallet
                  </p>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="user"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {/* What You See Header */}
              <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                <Unlock className="w-4 h-4 text-purple-500" />
                <span className="text-xs font-mono text-purple-400">
                  YOU SEE: Full Audit Trail (Decrypted)
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 border border-slate-800 bg-slate-900">
                  <div>
                    <p className="text-[9px] text-slate-500 font-mono">YOUR_MAIN_WALLET</p>
                    <p className="text-sm text-white font-mono">{userData.sender}</p>
                  </div>
                  <button
                    onClick={() => handleCopy(userData.sender)}
                    className="p-1.5 hover:bg-slate-800 transition-colors"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                    )}
                  </button>
                </div>

                {/* Payment Flow Chain: Main Wallet → Stealth Pool → Burner → Recipient */}
                <div className="p-3 border border-slate-800 bg-slate-900">
                  <p className="text-[9px] text-slate-500 font-mono mb-3">PAYMENT_FLOW</p>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] text-slate-500 font-mono mb-1">MAIN_WALLET</p>
                      <p className="text-xs text-blue-400 font-mono truncate">{userData.sender.slice(0, 8)}...{userData.sender.slice(-6)}</p>
                    </div>
                    <span className="text-[9px] font-mono text-slate-600 flex-shrink-0">→</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] text-slate-500 font-mono mb-1">STEALTH_POOL</p>
                      <p className="text-xs text-slate-300 font-mono truncate">{userData.stealthPool}</p>
                    </div>
                    <span className="text-[9px] font-mono text-slate-600 flex-shrink-0">→</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] text-slate-500 font-mono mb-1">BURNER</p>
                      <p className="text-xs text-amber-400 font-mono truncate">{userData.burner}</p>
                    </div>
                    <span className="text-[9px] font-mono text-slate-600 flex-shrink-0">→</span>
                    <div className="flex-1 min-w-0 text-right">
                      <p className="text-[9px] text-slate-500 font-mono mb-1">RECIPIENT</p>
                      <p className="text-xs text-emerald-400 font-mono truncate">{userData.recipient}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 border border-purple-900/30 bg-purple-950/20">
                    <p className="text-[9px] text-purple-400 font-mono">FHE_HANDLE</p>
                    <p className="text-[11px] text-purple-300 font-mono">{userData.fheHandle}</p>
                  </div>
                  <div className="p-3 border border-slate-800 bg-slate-900">
                    <p className="text-[9px] text-slate-500 font-mono">AUDIT_ID</p>
                    <p className="text-[11px] text-slate-400 font-mono">{userData.auditId}</p>
                  </div>
                </div>

                <a
                  href="#"
                  className="flex items-center justify-between p-3 border border-blue-900/30 bg-blue-950/20 hover:border-blue-800/50 transition-colors"
                >
                  <span className="text-[10px] font-mono text-blue-400">
                    View on Solscan →
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export default PrivacyPreview;

