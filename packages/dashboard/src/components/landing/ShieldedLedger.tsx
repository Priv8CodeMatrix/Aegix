'use client';

import { motion } from 'framer-motion';
import { Eye, EyeOff, Lock, ExternalLink, Hash, Clock, Zap, Shield, ArrowRight } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════════
// DEMO ENTRIES - Privacy-safe demonstration of Light Protocol flow
// No real transaction data is shown on the landing page to protect user privacy.
// ═══════════════════════════════════════════════════════════════════════════════

interface LedgerEntry {
  status: string;
  burnerId: string;
  fullBurnerId?: string;
  encryptedMapping?: string;
  realValue?: string;
  merchant?: string;
  intent?: string;
  timestamp?: string;
  txHash?: string;
  fullTxHash?: string;
  lightProtocol?: {
    compressed: boolean;
    proofHash: string;
    costSavings: string;
    feePayer: string;
  };
}

// Demo entries showing Light Protocol + PayAI x402 flow
const DEMO_ENTRIES: LedgerEntry[] = [
  {
    status: 'SETTLED',
    burnerId: '7xKm9F2j...8qZv',
    fullBurnerId: '7xKm9F2jP8qRtYw3LmNb5vCx8qZv',
    encryptedMapping: '0xae3f...c91b',
    realValue: '5.00 USDC',
    merchant: 'AI_Compute_API',
    intent: 'SHIELD',
    timestamp: '14:32',
    txHash: '4siR6W...AJPM',
    fullTxHash: '4siR6WKn3Px8YtBmC2Dv9fGh1jLq5AJPM',
    lightProtocol: {
      compressed: true,
      proofHash: '0xae3f8b2c...c91b',
      costSavings: '~50x',
      feePayer: 'PayAI_x402',
    },
  },
  {
    status: 'SETTLED',
    burnerId: '9mLp4K7n...2wXt',
    fullBurnerId: '9mLp4K7nQ3RsUv8YzAb6cDe2wXt',
    encryptedMapping: '0x7c1d...f4a2',
    realValue: '0.50 USDC',
    merchant: 'Data_Query_Service',
    intent: 'SHIELD',
    timestamp: '14:28',
    txHash: '5FzR1K...ZSvc',
    fullTxHash: '5FzR1KMp9Qw2XyBn4TvH8jCd3ZSvc',
    lightProtocol: {
      compressed: true,
      proofHash: '0x7c1d4e9a...f4a2',
      costSavings: '~50x',
      feePayer: 'PayAI_x402',
    },
  },
  {
    status: 'SETTLED',
    burnerId: '3vNq8R5t...6yHj',
    fullBurnerId: '3vNq8R5tW7ZpXc2MbKf9gLe6yHj',
    encryptedMapping: '0xb5e2...8d73',
    realValue: '12.00 USDC',
    merchant: 'Embedding_Provider',
    intent: 'SHIELD',
    timestamp: '14:15',
    txHash: '2GkT8N...MpQr',
    fullTxHash: '2GkT8NJv5Sy1WzDm3PqX7cBf4MpQr',
    lightProtocol: {
      compressed: true,
      proofHash: '0xb5e24f6c...8d73',
      costSavings: '~50x',
      feePayer: 'PayAI_x402',
    },
  },
];

// Public view (only burner addresses, no decrypted data)
const PUBLIC_VIEW_ENTRIES = DEMO_ENTRIES.map((entry) => ({
  status: entry.status,
  burnerId: entry.burnerId,
  timestamp: entry.timestamp,
  txHash: entry.txHash,
  fullTxHash: entry.fullTxHash,
}));

// Operator view with full data
const OPERATOR_VIEW_ENTRIES = DEMO_ENTRIES;

export function ShieldedLedger() {

  return (
    <section className="relative py-32 px-6 lg:px-8 bg-transparent">
      {/* Section Background - Cyber-industrial gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_20%,_rgba(34,197,94,0.02)_50%,_rgba(15,23,42,0.15)_100%)] -z-10" />
      
      {/* Top Divider with industrial accent */}
      <div className="absolute top-0 left-0 right-0">
        <div className="h-px bg-slate-800/80" />
        <div className="h-px bg-gradient-to-r from-transparent via-emerald-900/30 to-transparent" />
      </div>
      
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-16 pt-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-700 bg-slate-950 mb-4"
          >
            <Lock className="w-3 h-3 text-emerald-500" />
            <span className="text-[11px] font-mono text-slate-400 tracking-wide">PRIVACY_TRANSPARENCY</span>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="text-3xl md:text-4xl font-semibold text-white mb-4 font-sans"
          >
            Shielded Ledger
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="text-slate-400 text-lg max-w-2xl font-mono"
          >
            The "Privacy Paradox" solved. Public explorers see anonymous burners. You see the full decrypted audit trail.
          </motion.p>

          {/* Light Protocol Explainer */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.3 }}
            className="mt-6 p-4 border border-purple-900/40 bg-purple-950/20"
          >
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-purple-400" />
              <span className="text-[11px] font-mono text-purple-400 tracking-wider">LIGHT_PROTOCOL_FLOW</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 flex-wrap">
              <span className="px-2 py-1 bg-slate-900 border border-slate-700">STEALTH_POOL</span>
              <ArrowRight className="w-3 h-3 text-purple-500" />
              <span className="px-2 py-1 bg-purple-950/50 border border-purple-800/50 text-purple-400">COMPRESSED_BURNER</span>
              <ArrowRight className="w-3 h-3 text-purple-500" />
              <span className="px-2 py-1 bg-purple-950/50 border border-purple-800/50 text-purple-400">DECOMPRESS_IN_BURNER</span>
              <ArrowRight className="w-3 h-3 text-blue-500" />
              <span className="px-2 py-1 bg-blue-950/50 border border-blue-800/50 text-blue-400">PayAI_x402_TRANSFER</span>
              <ArrowRight className="w-3 h-3 text-emerald-500" />
              <span className="px-2 py-1 bg-emerald-950/50 border border-emerald-800/50 text-emerald-400">RECIPIENT</span>
            </div>
            <p className="mt-3 text-[10px] font-mono text-slate-500">
              ZK Compression = ~50x cheaper • PayAI pays transfer gas • Recovery Pool pays decompress fees • Burner ATA closed, rent recovered
            </p>
          </motion.div>
        </div>

        {/* ASYMMETRIC COMPARISON LAYOUT */}
        <div className="grid lg:grid-cols-5 gap-4">
          
          {/* PUBLIC VIEW - Compact Left Side (2 columns) */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="lg:col-span-2"
          >
            <div className="border border-slate-800/80 bg-slate-950/90 h-full">
              {/* Header */}
              <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <EyeOff className="w-4 h-4 text-slate-500" />
                  <span className="text-[11px] font-mono text-slate-400 tracking-wider">PUBLIC_SOLSCAN_VIEW</span>
                </div>
                <a 
                  href="https://solscan.io" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-[9px] font-mono text-slate-600 hover:text-slate-400 transition-colors flex items-center gap-1"
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                  EXPLORER
                </a>
              </div>

              {/* Compact Table */}
              <div className="divide-y divide-slate-800/50">
                {PUBLIC_VIEW_ENTRIES.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className="text-[10px] font-mono text-slate-600">NO_TRANSACTIONS</p>
                  </div>
                ) : (
                  PUBLIC_VIEW_ENTRIES.map((entry, index) => (
                    <div key={index} className="px-4 py-3 hover:bg-slate-900/30 transition-colors">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 ${
                          entry.status === 'SETTLED' 
                            ? 'text-emerald-400 bg-emerald-950/50 border border-emerald-900/50' 
                            : 'text-amber-400 bg-amber-950/50 border border-amber-900/50'
                        }`}>
                          {entry.status}
                        </span>
                        <span className="text-[9px] font-mono text-slate-600 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {entry.timestamp}
                        </span>
                      </div>
                      <code className="text-[11px] font-mono text-slate-500 block truncate">
                        {entry.burnerId}
                      </code>
                      {entry.txHash && (
                        <a
                          href={`https://solscan.io/tx/${entry.fullTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[9px] font-mono text-slate-600 hover:text-blue-400 transition-colors mt-1 flex items-center gap-1"
                        >
                          <Hash className="w-2.5 h-2.5" />
                          {entry.txHash}
                        </a>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Footer - Compact */}
              <div className="px-4 py-2.5 border-t border-slate-800 bg-slate-900/40">
                <p className="text-[9px] font-mono text-slate-600 leading-relaxed">
                  No transaction history. Zero correlation to main wallets.
                </p>
              </div>
            </div>
          </motion.div>

          {/* OPERATOR VIEW - Expanded Right Side (3 columns) */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="lg:col-span-3"
          >
            <div className="border border-purple-900/40 bg-slate-950/95 h-full">
              {/* Header with FHE Badge */}
              <div className="px-4 py-3 border-b border-purple-900/30 bg-purple-950/20 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-purple-400" />
                  <span className="text-[11px] font-mono text-purple-400 tracking-wider">AEGIX_OPERATOR_VIEW</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-purple-950/60 border border-purple-800/40">
                  <Lock className="w-2.5 h-2.5 text-purple-400" />
                  <span className="text-[9px] font-mono text-purple-400">FHE_DECRYPTED</span>
                </div>
              </div>

              {OPERATOR_VIEW_ENTRIES.length === 0 ? (
                <div className="p-10 text-center">
                  <Lock className="w-8 h-8 text-slate-700 mx-auto mb-3" />
                  <p className="text-xs font-mono text-slate-600">NO_PAYMENTS_YET</p>
                  <p className="text-[10px] font-mono text-slate-700 mt-1">Make a payment to see audit trail</p>
                </div>
              ) : (
                <>
                  {/* Full Data Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-800/60">
                          <th className="px-3 py-2.5 text-left">
                            <span className="text-[9px] font-mono text-slate-600 tracking-wider">STATUS</span>
                          </th>
                          <th className="px-3 py-2.5 text-left">
                            <span className="text-[9px] font-mono text-slate-600 tracking-wider">BURNER</span>
                          </th>
                          <th className="px-3 py-2.5 text-left">
                            <span className="text-[9px] font-mono text-purple-600 tracking-wider">LIGHT_ZK</span>
                          </th>
                          <th className="px-3 py-2.5 text-left">
                            <span className="text-[9px] font-mono text-slate-600 tracking-wider">VALUE</span>
                          </th>
                          <th className="px-3 py-2.5 text-left">
                            <span className="text-[9px] font-mono text-blue-600 tracking-wider">FEE_PAYER</span>
                          </th>
                          <th className="px-3 py-2.5 text-left">
                            <span className="text-[9px] font-mono text-slate-600 tracking-wider">SERVICE</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40">
                        {OPERATOR_VIEW_ENTRIES.map((entry, index) => (
                          <tr key={index} className="hover:bg-slate-900/40 transition-colors">
                            <td className="px-3 py-3">
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 ${
                                entry.status === 'SETTLED' 
                                  ? 'text-emerald-400 bg-emerald-950/50 border border-emerald-900/50' 
                                  : 'text-amber-400 bg-amber-950/50 border border-amber-900/50'
                              }`}>
                                {entry.status}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <code className="text-[10px] font-mono text-slate-400">{entry.burnerId}</code>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-1">
                                {entry.lightProtocol?.compressed && (
                                  <Shield className="w-3 h-3 text-purple-400" />
                                )}
                                <code className="text-[9px] font-mono text-purple-400 bg-purple-950/30 px-1 py-0.5 border border-purple-900/30">
                                  {entry.lightProtocol?.costSavings || '---'}
                                </code>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <span className="text-[11px] font-mono text-white font-medium">
                                {entry.realValue}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <code className="text-[9px] font-mono text-blue-400 bg-blue-950/30 px-1 py-0.5 border border-blue-900/30">
                                {entry.lightProtocol?.feePayer || 'SELF'}
                              </code>
                            </td>
                            <td className="px-3 py-3">
                              <div className="space-y-0.5">
                                <p className="text-[9px] font-mono text-slate-500">{entry.merchant}</p>
                                <p className="text-[9px] font-mono text-emerald-400">{entry.intent}</p>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Footer with Light Protocol Info */}
                  <div className="px-4 py-3 border-t border-purple-900/30 bg-purple-950/10">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <Shield className="w-3 h-3 text-purple-400" />
                          <span className="text-[9px] font-mono text-purple-400">LIGHT_PROTOCOL</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Zap className="w-3 h-3 text-blue-400" />
                          <span className="text-[9px] font-mono text-blue-400">PayAI_x402</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                        <span className="text-[8px] font-mono text-emerald-500">GASLESS_ENABLED</span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </div>

        {/* Visual Explanation - Asymmetric Message */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mt-8 flex items-center justify-center gap-4"
        >
          <div className="h-px w-16 bg-gradient-to-r from-transparent to-slate-700" />
          <p className="text-[10px] font-mono text-slate-600 text-center max-w-md">
            The world sees burner addresses. You see the complete picture — encrypted at rest, decrypted on-demand.
          </p>
          <div className="h-px w-16 bg-gradient-to-l from-transparent to-slate-700" />
        </motion.div>
      </div>
      
      {/* Bottom Spacer */}
      <div className="h-16" />
    </section>
  );
}

export default ShieldedLedger;
