'use client';

import { motion } from 'framer-motion';
import { Shield, Activity } from 'lucide-react';
import { useMemo } from 'react';
import HeroText from './HeroText';
import ProtocolSimulation from './ProtocolSimulation';
import PrivacyPreview from './PrivacyPreview';
import IntegrationCarousel from './IntegrationCarousel';
import { useGateway } from '@/hooks/useGateway';

interface HeroWorkstationProps {
  onLaunchApp: () => void;
}

export function HeroWorkstation({ onLaunchApp }: HeroWorkstationProps) {
  const { auditLog } = useGateway();

  // Count unique pools from audit logs
  const activePoolsCount = useMemo(() => {
    const pools = new Set(
      auditLog
        .filter((entry) => entry.stealthPoolAddress)
        .map((entry) => entry.stealthPoolAddress)
    );
    return pools.size;
  }, [auditLog]);
  return (
    <section className="relative min-h-screen overflow-hidden">
      {/* Verified Audit Badge - Top Right */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.8 }}
        className="absolute top-6 right-6 z-10"
      >
        <div className="flex items-center gap-2 px-3 py-2 border border-emerald-900/50 bg-emerald-950/30">
          <Shield className="w-4 h-4 text-emerald-500" />
          <div className="flex flex-col">
            <span className="text-[10px] font-mono text-emerald-400">VERIFIED_AUDIT</span>
            <span className="text-[9px] font-mono text-slate-500">Institutional Ready</span>
          </div>
        </div>
      </motion.div>

      {/* Main Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8 pt-24 pb-32">
        {/* 60/40 Split Layout */}
        <div className="grid lg:grid-cols-5 gap-12 lg:gap-8 items-start">
          {/* Left Column - The Proposition (60%) */}
          <div className="lg:col-span-3 space-y-8">
            <HeroText onLaunchApp={onLaunchApp} />
            
            {/* Privacy Preview - Below Hero Text */}
            <div className="pt-2">
              <PrivacyPreview />
            </div>
          </div>

          {/* Right Column - The Proof (40%) */}
          <div className="lg:col-span-2">
            <div className="sticky top-24 space-y-4">
              {/* Label */}
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-[10px] font-mono text-slate-500 tracking-wider">
                  LIVE_PROTOCOL_DEMONSTRATION
                </span>
              </div>
              
              {/* Terminal */}
              <ProtocolSimulation />
            </div>
          </div>
        </div>

        {/* Integration Carousel - Full Width Below Grid */}
        <div className="mt-12">
          <IntegrationCarousel />
        </div>
      </div>

      {/* Status Bar Footer */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1 }}
        className="fixed bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-950/95 backdrop-blur-sm z-20"
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              <StatusItem
                label="NETWORK"
                value="SOLANA_MAINNET"
                status="active"
              />
              <StatusItem
                label="PRIVACY_PROTOCOL"
                value="LIGHT_ZK_COMPRESSION"
                status="secure"
              />
              <StatusItem
                label="AVG_SETTLEMENT"
                value="1.2s"
                status="normal"
              />
              <StatusItem
                label="ACTIVE_STEALTH_POOLS"
                value={activePoolsCount.toLocaleString()}
                status="normal"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-mono text-emerald-400">ALL_SYSTEMS_OPERATIONAL</span>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

interface StatusItemProps {
  label: string;
  value: string;
  status: 'active' | 'secure' | 'normal';
}

function StatusItem({ label, value, status }: StatusItemProps) {
  const valueColor = {
    active: 'text-emerald-400',
    secure: 'text-purple-400',
    normal: 'text-slate-300',
  }[status];

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-slate-600">{label}:</span>
      <span className={`text-[10px] font-mono ${valueColor}`}>{value}</span>
    </div>
  );
}

export default HeroWorkstation;

