'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, CheckCircle, Loader2, Lock } from 'lucide-react';

interface LogEntry {
  id: number;
  prefix: string;
  prefixColor: string;
  message: string;
  status?: 'pending' | 'success' | 'info';
  delay: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEMO TRANSACTION - Locked for privacy (no real transaction data shown)
// This demonstrates the Light Protocol + PayAI x402 flow without exposing
// actual user transactions on the landing page.
// ═══════════════════════════════════════════════════════════════════════════════
const DEMO_TRANSACTION = {
  burnerAddress: '7xKm9F2j...8qZv',
  proofHash: '0xae3f...c91b',
  recipient: 'PayAI_Service',
  method: 'PAYAI_x402',
  gasRecovered: '0.00234',
  latency: '1.24s',
};

export function ProtocolSimulation() {
  const [visibleLogs, setVisibleLogs] = useState<LogEntry[]>([]);
  const [isComplete, setIsComplete] = useState(false);

  // Build logs from DEMO transaction (privacy-safe)
  const buildLogs = (): LogEntry[] => {
    return [
      {
        id: 1,
        prefix: 'SYS',
        prefixColor: 'text-slate-400',
        message: 'Init Recovery Pool Architecture...',
        status: 'pending',
        delay: 0,
      },
      {
        id: 2,
        prefix: 'SYS',
        prefixColor: 'text-slate-400',
        message: `Burner Generated: ${DEMO_TRANSACTION.burnerAddress}`,
        status: 'success',
        delay: 800,
      },
      {
        id: 3,
        prefix: 'LIGHT',
        prefixColor: 'text-purple-400',
        message: 'Pool → Burner (Compressed USDC)...',
        status: 'pending',
        delay: 1400,
      },
      {
        id: 4,
        prefix: 'LIGHT',
        prefixColor: 'text-purple-400',
        message: `ZK Proof: ${DEMO_TRANSACTION.proofHash}`,
        status: 'success',
        delay: 2200,
      },
      {
        id: 5,
        prefix: 'LIGHT',
        prefixColor: 'text-purple-400',
        message: 'Decompress → Burner ATA (Recovery Pool pays)...',
        status: 'pending',
        delay: 2800,
      },
      {
        id: 6,
        prefix: 'LIGHT',
        prefixColor: 'text-purple-400',
        message: 'USDC Decompressed in Burner Wallet ✓',
        status: 'success',
        delay: 3400,
      },
      {
        id: 7,
        prefix: 'PAYAI',
        prefixColor: 'text-blue-400',
        message: 'x402 Transfer: PayAI Pays Gas...',
        status: 'pending',
        delay: 4000,
      },
      {
        id: 8,
        prefix: 'PAYAI',
        prefixColor: 'text-blue-400',
        message: 'Burner → Recipient: GASLESS ✓',
        status: 'success',
        delay: 4800,
      },
      {
        id: 9,
        prefix: 'TX',
        prefixColor: 'text-emerald-400',
        message: 'Closing Burner ATA, Recovering Rent...',
        status: 'pending',
        delay: 5400,
      },
      {
        id: 10,
        prefix: 'TX',
        prefixColor: 'text-emerald-400',
        message: `Settlement CONFIRMED (+${DEMO_TRANSACTION.gasRecovered} SOL)`,
        status: 'success',
        delay: 6000,
      },
      {
        id: 11,
        prefix: 'AUDIT',
        prefixColor: 'text-amber-400',
        message: 'ZK Compressed audit logged',
        status: 'info',
        delay: 6600,
      },
    ];
  };

  const runSimulation = () => {
    setVisibleLogs([]);
    setIsComplete(false);

    const logs = buildLogs();
    logs.forEach((log) => {
      setTimeout(() => {
        setVisibleLogs((prev) => [...prev, log]);
      }, log.delay);
    });

    // Mark complete after all logs
    setTimeout(() => {
      setIsComplete(true);
    }, 7200);
  };

  // Run simulation once on mount
  useEffect(() => {
    runSimulation();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.3, duration: 0.4 }}
      className="border border-slate-700 bg-slate-950 h-full flex flex-col"
    >
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50">
        <div className="flex items-center gap-3">
          <Terminal className="w-4 h-4 text-slate-500" />
          <span className="text-xs font-mono text-slate-400">LIVE_HANDSHAKE_TERMINAL</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${isComplete ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
          <span className="text-[10px] font-mono text-slate-500">
            {isComplete ? 'COMPLETE' : 'RUNNING'}
          </span>
        </div>
      </div>

      {/* Terminal Content */}
      <div className="flex-1 p-4 overflow-y-auto font-mono text-sm space-y-2 min-h-[320px]">
        <AnimatePresence>
          {visibleLogs.map((log) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-start gap-3"
            >
              <span className={`${log.prefixColor} text-[11px] w-12 flex-shrink-0`}>
                [{log.prefix}]
              </span>
              <span className="text-slate-300 text-[12px] flex-1">
                {log.message}
              </span>
              <span className="flex-shrink-0">
                {log.status === 'pending' && (
                  <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                )}
                {log.status === 'success' && (
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                )}
                {log.status === 'info' && (
                  <span className="text-[10px] text-amber-500 font-mono">✓</span>
                )}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Completion Summary */}
        <AnimatePresence>
          {isComplete && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="mt-6 pt-4 border-t border-slate-800"
            >
              <div className="p-3 border border-emerald-900/50 bg-emerald-950/30">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-emerald-400">
                    TRANSACTION_SUMMARY
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    LATENCY: 1.24s
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[9px] text-slate-500">METHOD</p>
                    <p className="text-sm text-blue-400">{DEMO_TRANSACTION.method}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-500">GAS_RECOVERED</p>
                    <p className="text-sm text-emerald-400">+{DEMO_TRANSACTION.gasRecovered} SOL</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-500">PRIVACY_LEVEL</p>
                    <p className="text-sm text-purple-400">LIGHT_ZK</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-500">FEE_PAYER</p>
                    <p className="text-sm text-amber-400">PAYAI_x402</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Terminal Footer */}
      <div className="px-4 py-2 border-t border-slate-800 bg-slate-900/30">
        <div className="flex items-center justify-between text-[10px] font-mono text-slate-600">
          <div className="flex items-center gap-1.5">
            <Lock className="w-3 h-3" />
            <span>DEMO_TRANSACTION</span>
          </div>
          <span>POOL → BURNER → DECOMPRESS → PayAI_x402 → RECIPIENT</span>
        </div>
      </div>
    </motion.div>
  );
}

export default ProtocolSimulation;
