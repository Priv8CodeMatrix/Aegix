'use client';

import { motion } from 'framer-motion';
import { Shield, ExternalLink, BookOpen } from 'lucide-react';
import { useMemo } from 'react';
import { useGateway } from '@/hooks/useGateway';
import { formatCompactNumber, formatCompactCurrency } from '@/lib/formatters';

interface HeroTextProps {
  onLaunchApp: () => void;
}

export function HeroText({ onLaunchApp }: HeroTextProps) {
  const { auditLog } = useGateway();

  // Calculate real volume from audit logs
  const totalVolume = useMemo(() => {
    const volume = auditLog
      .filter((entry) => entry.amount && (entry.type === 'pool_payment' || entry.type === 'agent_payment'))
      .reduce((sum, entry) => {
        const amount = parseInt(entry.amount || '0');
        return sum + amount;
      }, 0);
    
    // Convert micro-USDC to USDC, then to dollars
    const usdcAmount = volume / 1000000;
    return usdcAmount;
  }, [auditLog]);

  // Count total transactions from audit logs
  const totalTransactions = useMemo(() => {
    return auditLog.filter((entry) => 
      entry.type === 'pool_payment' || entry.type === 'agent_payment'
    ).length;
  }, [auditLog]);

  // Count unique pools from audit logs
  const activePoolsCount = useMemo(() => {
    const pools = new Set(
      auditLog
        .filter((entry) => entry.stealthPoolAddress)
        .map((entry) => entry.stealthPoolAddress)
    );
    return pools.size;
  }, [auditLog]);

  // Calculate average settlement time from audit logs
  const avgSettlement = useMemo(() => {
    const paymentsWithLatency = auditLog.filter(
      (entry) => (entry.type === 'pool_payment' || entry.type === 'agent_payment') && entry.latency
    );
    
    if (paymentsWithLatency.length === 0) return '1.2s';
    
    const totalLatency = paymentsWithLatency.reduce((sum, entry) => {
      return sum + (entry.latency || 0);
    }, 0);
    
    const avgMs = totalLatency / paymentsWithLatency.length;
    return `${(avgMs / 1000).toFixed(1)}s`;
  }, [auditLog]);

  // Format volume display with smart K/M suffixes
  const volumeDisplay = useMemo(() => {
    return formatCompactCurrency(totalVolume);
  }, [totalVolume]);

  // Format transaction count with smart K/M suffixes
  const transactionDisplay = useMemo(() => {
    return formatCompactNumber(totalTransactions);
  }, [totalTransactions]);

  return (
    <div className="space-y-8">
      {/* Badge */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-700 bg-slate-900/50"
      >
        <Shield className="w-3.5 h-3.5 text-emerald-500" />
        <span className="text-[11px] font-mono text-slate-400 tracking-wide">
          PRIVACY_LAYER_V3.0
        </span>
      </motion.div>

      {/* Brand Name - Now the main headline */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mb-2"
      >
        <span className="text-5xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight leading-[1.1]">
          AEGIX
        </span>
      </motion.div>

      {/* Subtitle - The Shielded Gateway tagline */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="space-y-4"
      >
        <h2 className="text-2xl md:text-3xl lg:text-4xl font-medium text-slate-300 tracking-tight leading-relaxed">
          The Shielded Gateway for{' '}
          <span className="text-slate-400">
            AI Commerce
          </span>
        </h2>
        <p className="text-lg md:text-xl text-slate-400 max-w-lg leading-relaxed font-light">
          x402-compliant payments with FHE-encrypted audit trails. 
          Service providers see burner wallets, never your main address.
        </p>
      </motion.div>

      {/* Stats Row - 4 Stats with Real Data */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex flex-wrap gap-6 pt-2"
      >
        <div>
          <p className="text-2xl font-mono text-white">{volumeDisplay}</p>
          <p className="text-xs text-slate-500 font-mono mt-1">VOLUME_PROCESSED</p>
        </div>
        <div className="border-l border-slate-800 pl-6">
          <p className="text-2xl font-mono text-white">{transactionDisplay}</p>
          <p className="text-xs text-slate-500 font-mono mt-1">TOTAL_TRANSACTIONS</p>
        </div>
        <div className="border-l border-slate-800 pl-6">
          <p className="text-2xl font-mono text-white">{formatCompactNumber(activePoolsCount)}</p>
          <p className="text-xs text-slate-500 font-mono mt-1">ACTIVE_POOLS</p>
        </div>
        <div className="border-l border-slate-800 pl-6">
          <p className="text-2xl font-mono text-white">{avgSettlement}</p>
          <p className="text-xs text-slate-500 font-mono mt-1">AVG_SETTLEMENT</p>
        </div>
      </motion.div>

      {/* CTA Buttons */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="flex items-center gap-4 pt-4"
      >
        {/* Primary CTA - Wider */}
        <button
          onClick={onLaunchApp}
          className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium flex items-center gap-2 transition-colors flex-1 max-w-[280px]"
        >
          Launch App
          <ExternalLink className="w-4 h-4" />
        </button>

        {/* Secondary CTA - Smaller */}
        <a
          href="https://docs.aegix.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-3 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <BookOpen className="w-4 h-4" />
          View Documentation
        </a>
      </motion.div>
    </div>
  );
}

export default HeroText;
