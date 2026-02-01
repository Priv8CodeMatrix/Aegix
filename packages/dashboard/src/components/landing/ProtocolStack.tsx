'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChevronDown, 
  ExternalLink, 
  Check, 
  Zap, 
  Shield, 
  Wallet, 
  CreditCard, 
  Lock,
  Plus,
  Activity
} from 'lucide-react';
import { useState, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

type StackType = 'PAYMENT' | 'PRIVACY';

interface Protocol {
  id: string;
  name: string;
  icon: React.ReactNode;
  stackType: StackType;
  categoryTag: string;
  description: string;
  technicalSummary: string;
  capabilities: string[];
  docsUrl: string;
  facilitatedBy?: string;
  accentColor: string;
  borderColor: string;
  bgColor: string;
  glowColor: string;
  isPlaceholder?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROTOCOL DATA - Dual Stack Architecture
// ═══════════════════════════════════════════════════════════════════════════════

const PAYMENT_STACK: Protocol[] = [
  {
    id: 'x402',
    name: 'x402 Protocol',
    icon: <Zap className="w-5 h-5" />,
    stackType: 'PAYMENT',
    categoryTag: 'SETTLEMENT_LAYER',
    description: 'Non-interactive payment settlement',
    technicalSummary: 'HTTP-native async handshake protocol for non-interactive micropayments. Implements the 402 Payment Required flow with automatic retry handling and built-in receipt verification for AI service commerce.',
    capabilities: [
      'HTTP 402 Payment Required flow',
      'Non-interactive async settlement',
      'Automatic retry & recovery',
      'Cryptographic receipt verification',
    ],
    docsUrl: 'https://www.x402.org',
    facilitatedBy: 'PayAI',
    accentColor: 'text-blue-400',
    borderColor: 'border-blue-800/60',
    bgColor: 'bg-blue-950/10',
    glowColor: 'rgba(59, 130, 246, 0.15)',
  },
  {
    id: 'payai',
    name: 'PayAI Facilitator',
    icon: <CreditCard className="w-5 h-5" />,
    stackType: 'PAYMENT',
    categoryTag: 'GAS_ABSTRACTION',
    description: 'x402 transaction facilitator',
    technicalSummary: 'Third-party gas sponsorship layer for x402 transactions. Handles SOL rent prepayment, burner wallet lifecycle management, and automatic fee recovery to enable true gasless payment experiences.',
    capabilities: [
      'Gas fee sponsorship',
      'SOL rent prepayment',
      'Burner wallet lifecycle',
      'Automatic fee recovery',
    ],
    docsUrl: 'https://payai.network',
    accentColor: 'text-amber-400',
    borderColor: 'border-amber-800/60',
    bgColor: 'bg-amber-950/10',
    glowColor: 'rgba(251, 191, 36, 0.15)',
  },
  {
    id: 'solana',
    name: 'Solana Mainnet',
    icon: <Wallet className="w-5 h-5" />,
    stackType: 'PAYMENT',
    categoryTag: 'SETTLEMENT_FINALITY',
    description: 'High-performance blockchain infrastructure',
    technicalSummary: 'Mainnet deployment with commitment-level finality guarantees. 400ms block times enable near-instant settlement. Native USDC (SPL Token) support with sub-cent transaction costs.',
    capabilities: [
      'Native USDC (SPL Token)',
      '400ms block finality',
      'Sub-cent transaction fees',
      'Parallel transaction processing',
    ],
    docsUrl: 'https://solana.com/docs',
    accentColor: 'text-emerald-400',
    borderColor: 'border-emerald-800/60',
    bgColor: 'bg-emerald-950/10',
    glowColor: 'rgba(52, 211, 153, 0.15)',
  },
];

const PRIVACY_STACK: Protocol[] = [
  {
    id: 'light',
    name: 'Light Protocol',
    icon: <Lock className="w-5 h-5" />,
    stackType: 'PRIVACY',
    categoryTag: 'ZK_COMPRESSION',
    description: 'ZK Compression for Solana',
    technicalSummary: 'State compression via zero-knowledge proofs. Compressed token accounts reduce costs by ~50x while maintaining full privacy. Ephemeral burner wallets ensure stealth pool addresses are never linked to recipients.',
    capabilities: [
      'ZK State Compression (~50x cheaper)',
      'Compressed Token Accounts',
      'Ephemeral Burner Privacy',
      'On-chain verifiable proofs',
    ],
    docsUrl: 'https://lightprotocol.com',
    accentColor: 'text-purple-400',
    borderColor: 'border-purple-800/60',
    bgColor: 'bg-purple-950/10',
    glowColor: 'rgba(168, 85, 247, 0.15)',
  },
  // Placeholder for future privacy integrations
  {
    id: 'privacy-expansion',
    name: 'Expanding Soon',
    icon: <Plus className="w-5 h-5" />,
    stackType: 'PRIVACY',
    categoryTag: 'ROADMAP',
    description: 'Additional privacy integrations',
    technicalSummary: 'The Privacy Stack is architected for horizontal scaling. Upcoming integrations include ZK proof systems, multi-party computation protocols, and cross-chain privacy bridges.',
    capabilities: [
      'ZK Proof Systems (Q2 2026)',
      'MPC Protocols (Research)',
      'Cross-Chain Privacy (Planned)',
      'Threshold Encryption (Roadmap)',
    ],
    docsUrl: '#',
    accentColor: 'text-slate-500',
    borderColor: 'border-slate-700/40',
    bgColor: 'bg-slate-900/20',
    glowColor: 'rgba(100, 116, 139, 0.1)',
    isPlaceholder: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// NEON GREEN ACCENT
// ═══════════════════════════════════════════════════════════════════════════════
const NEON_GREEN = '#00ff88';

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function ProtocolStack() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId(expandedId === id ? null : id);
  }, [expandedId]);

  // Render a single protocol card
  const renderProtocolCard = (protocol: Protocol, index: number, stackIndex: number) => {
    const isExpanded = expandedId === protocol.id;
    const isHovered = hoveredId === protocol.id;
    const isPlaceholder = protocol.isPlaceholder;
    
    return (
      <motion.div
        key={protocol.id}
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, delay: (stackIndex * 0.15) + (index * 0.1) }}
        onMouseEnter={() => setHoveredId(protocol.id)}
        onMouseLeave={() => setHoveredId(null)}
        className="relative group"
      >
        {/* Scanline Hover Effect */}
        {isHovered && !isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 pointer-events-none z-10 overflow-hidden"
          >
            <div 
              className="absolute inset-0"
              style={{
                background: `repeating-linear-gradient(
                  0deg,
                  transparent,
                  transparent 2px,
                  rgba(0, 255, 136, 0.03) 2px,
                  rgba(0, 255, 136, 0.03) 4px
                )`,
                animation: 'scanline 8s linear infinite',
              }}
            />
          </motion.div>
        )}

        {/* Card Container */}
        <div
          className={`
            relative border transition-all duration-300
            ${protocol.borderColor} ${protocol.bgColor}
            ${isHovered && !isExpanded ? 'shadow-lg' : ''}
            ${isPlaceholder ? 'border-dashed' : ''}
          `}
          style={{
            boxShadow: isHovered || isExpanded 
              ? `0 0 20px ${protocol.glowColor}, inset 0 1px 0 rgba(255,255,255,0.03)` 
              : 'inset 0 1px 0 rgba(255,255,255,0.02)',
          }}
        >
          {/* Industrial Corner Accents */}
          <div className={`absolute top-0 left-0 w-2 h-2 border-t border-l ${protocol.borderColor}`} />
          <div className={`absolute top-0 right-0 w-2 h-2 border-t border-r ${protocol.borderColor}`} />
          <div className={`absolute bottom-0 left-0 w-2 h-2 border-b border-l ${protocol.borderColor}`} />
          <div className={`absolute bottom-0 right-0 w-2 h-2 border-b border-r ${protocol.borderColor}`} />

          {/* Protocol Header - Clickable */}
          <button
            onClick={() => toggleExpand(protocol.id)}
            className="w-full px-5 py-4 flex items-center justify-between text-left transition-colors hover:bg-slate-900/50"
          >
            <div className="flex items-center gap-4">
              {/* Icon Container */}
              <div 
                className={`
                  w-12 h-12 border bg-slate-950/90 flex items-center justify-center
                  ${protocol.borderColor} ${protocol.accentColor}
                  ${isPlaceholder ? 'border-dashed' : ''}
                `}
              >
                {protocol.icon}
              </div>
              
              {/* Text Content */}
              <div className="min-w-0">
                {/* Category Tag */}
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[9px] font-mono tracking-widest ${protocol.accentColor}`}>
                    STACK_TYPE: {protocol.stackType}
                  </span>
                  <span className="text-[8px] font-mono text-slate-600">|</span>
                  <span className="text-[9px] font-mono text-slate-600 tracking-wider">
                    {protocol.categoryTag}
                  </span>
                </div>
                
                {/* Protocol Name */}
                <h3 className={`text-base font-mono font-bold text-white mb-0.5 ${isPlaceholder ? 'opacity-60' : ''}`}>
                  {protocol.name}
                </h3>
                
                {/* Description */}
                <p className={`text-xs font-mono ${isPlaceholder ? 'text-slate-600 italic' : 'text-slate-500'}`}>
                  {protocol.description}
                </p>

                {/* Facilitated By Badge */}
                {protocol.facilitatedBy && (
                  <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 border border-amber-800/50 bg-amber-950/30">
                    <Activity className="w-2.5 h-2.5 text-amber-400" />
                    <span className="text-[8px] font-mono text-amber-400 tracking-wider">
                      FACILITATED_BY: {protocol.facilitatedBy}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Expand Indicator */}
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.3 }}
              className={`flex-shrink-0 ${protocol.accentColor}`}
            >
              <ChevronDown className="w-5 h-5 opacity-60" />
            </motion.div>
          </button>

          {/* Expanded Content */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.04, 0.62, 0.23, 0.98] }}
                style={{ overflow: 'hidden' }}
              >
                <div className={`px-5 pb-5 pt-3 border-t ${protocol.borderColor} space-y-4`}>
                  {/* Technical Summary */}
                  <div className={`p-4 border ${protocol.borderColor} bg-slate-950/70`}>
                    <p className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-2">
                      TECHNICAL_SUMMARY
                    </p>
                    <p className={`text-[12px] font-mono leading-relaxed ${isPlaceholder ? 'text-slate-500 italic' : 'text-slate-400'}`}>
                      {protocol.technicalSummary}
                    </p>
                  </div>

                  {/* Capabilities */}
                  <div>
                    <p className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-3">
                      {isPlaceholder ? 'ROADMAP' : 'CAPABILITIES'}
                    </p>
                    <div className="space-y-2">
                      {protocol.capabilities.map((cap, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.1 + i * 0.05, duration: 0.25 }}
                          className="flex items-center gap-2"
                        >
                          <Check className={`w-3 h-3 ${isPlaceholder ? 'text-slate-600' : protocol.accentColor} flex-shrink-0`} />
                          <span className={`text-[11px] font-mono ${isPlaceholder ? 'text-slate-500 italic' : 'text-slate-400'}`}>
                            {cap}
                          </span>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  {/* Documentation Link */}
                  {!isPlaceholder && (
                    <a
                      href={protocol.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`
                        flex items-center justify-between p-3 border ${protocol.borderColor} 
                        bg-slate-950/50 hover:bg-slate-900/50 transition-all duration-200 group/link
                      `}
                    >
                      <span className={`text-[11px] font-mono ${protocol.accentColor}`}>
                        VIEW_DOCUMENTATION →
                      </span>
                      <ExternalLink className={`w-3.5 h-3.5 ${protocol.accentColor} group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform`} />
                    </a>
                  )}

                  {/* Placeholder CTA */}
                  {isPlaceholder && (
                    <div className="p-3 border border-dashed border-slate-700/50 bg-slate-900/30 text-center">
                      <p className="text-[10px] font-mono text-slate-600 tracking-wider">
                        PRIVACY_INTEGRATIONS_EXPANDING
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    );
  };

  return (
    <section className="relative py-32 px-6 lg:px-8 bg-transparent overflow-hidden">
      {/* Industrial Background Pattern */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_transparent_30%,_rgba(59,130,246,0.02)_50%,_transparent_70%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_transparent_30%,_rgba(168,85,247,0.02)_50%,_transparent_70%)]" />
        {/* Subtle Grid */}
        <div 
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)
            `,
            backgroundSize: '80px 80px',
          }}
        />
      </div>
      
      {/* Top Industrial Divider */}
      <div className="absolute top-0 left-0 right-0">
        <div className="h-px bg-slate-800" />
        <div className="h-px bg-gradient-to-r from-blue-900/30 via-slate-800 to-purple-900/30" />
      </div>

      {/* Scanline Animation Keyframes */}
      <style jsx>{`
        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
        @keyframes pulse-line {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.6; }
        }
      `}</style>
      
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-16 pt-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-3 mb-6"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-700 bg-slate-950">
              <div 
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: NEON_GREEN, boxShadow: `0 0 8px ${NEON_GREEN}` }}
              />
              <span className="text-[11px] font-mono text-slate-400 tracking-widest">ARCHITECTURE_STACK</span>
            </div>
            <div className="h-px w-12 bg-gradient-to-r from-slate-700 to-transparent" />
          </motion.div>
          
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="text-3xl md:text-4xl font-mono font-bold text-white mb-4 tracking-tight"
          >
            Protocol Stack
          </motion.h2>
          
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="text-slate-500 text-base max-w-2xl font-mono leading-relaxed"
          >
            Institutional-grade infrastructure stack. Each protocol layer provides verifiable guarantees for privacy and settlement finality.
          </motion.p>
        </div>

        {/* DUAL STACK LAYOUT */}
        <div className="grid lg:grid-cols-2 gap-8">
          
          {/* PAYMENT STACK - Foundational Layer */}
          <div>
            {/* Stack Header */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="flex items-center gap-3 mb-5"
            >
              <div className="flex items-center gap-2 px-3 py-1.5 border border-blue-800/50 bg-blue-950/30">
                <Zap className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-[10px] font-mono text-blue-400 tracking-widest font-semibold">PAYMENT_STACK</span>
              </div>
              <div className="flex-1 h-px bg-gradient-to-r from-blue-800/50 to-transparent" />
              <span className="text-[9px] font-mono text-slate-600">FOUNDATIONAL_LAYER</span>
            </motion.div>
            
            {/* Payment Protocols */}
            <div className="space-y-3">
              {PAYMENT_STACK.map((protocol, index) => renderProtocolCard(protocol, index, 0))}
            </div>
          </div>

          {/* PRIVACY STACK - Security Layer */}
          <div>
            {/* Stack Header */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="flex items-center gap-3 mb-5"
            >
              <div className="flex items-center gap-2 px-3 py-1.5 border border-purple-800/50 bg-purple-950/30">
                <Shield className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-[10px] font-mono text-purple-400 tracking-widest font-semibold">PRIVACY_STACK</span>
              </div>
              <div className="flex-1 h-px bg-gradient-to-r from-purple-800/50 to-transparent" />
              <span className="text-[9px] font-mono text-slate-600">SECURITY_LAYER</span>
            </motion.div>
            
            {/* Privacy Protocols */}
            <div className="space-y-3">
              {PRIVACY_STACK.map((protocol, index) => renderProtocolCard(protocol, index, 1))}
            </div>
          </div>
        </div>

        {/* PROGRESSION LINE - ECG drawn by moving pen */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.5 }}
          className="mt-20 relative"
        >
          <div className="h-12 relative">
            {/* Faded baseline - just a straight horizontal line */}
            <div 
              className="absolute top-1/2 left-0 right-0 h-[1px] -translate-y-1/2"
              style={{ backgroundColor: `${NEON_GREEN}20` }}
            />
            
            {/* ECG Pattern - revealed by clip-path as pen moves */}
            <motion.div
              className="absolute inset-0"
              animate={{ clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'linear', repeatDelay: 0 }}
            >
              <svg 
                className="w-full h-full"
                viewBox="0 0 1000 48" 
                preserveAspectRatio="none"
              >
                <path
                  d={`
                    M0,24 L30,24 L40,22 L45,24 L60,24 L68,24 L72,26 L75,8 L78,40 L81,20 L84,24 L100,24
                    L130,24 L140,22 L145,24 L160,24 L168,24 L172,26 L175,8 L178,40 L181,20 L184,24 L200,24
                    L230,24 L240,22 L245,24 L260,24 L268,24 L272,26 L275,8 L278,40 L281,20 L284,24 L300,24
                    L330,24 L340,22 L345,24 L360,24 L368,24 L372,26 L375,8 L378,40 L381,20 L384,24 L400,24
                    L430,24 L440,22 L445,24 L460,24 L468,24 L472,26 L475,8 L478,40 L481,20 L484,24 L500,24
                    L530,24 L540,22 L545,24 L560,24 L568,24 L572,26 L575,8 L578,40 L581,20 L584,24 L600,24
                    L630,24 L640,22 L645,24 L660,24 L668,24 L672,26 L675,8 L678,40 L681,20 L684,24 L700,24
                    L730,24 L740,22 L745,24 L760,24 L768,24 L772,26 L775,8 L778,40 L781,20 L784,24 L800,24
                    L830,24 L840,22 L845,24 L860,24 L868,24 L872,26 L875,8 L878,40 L881,20 L884,24 L900,24
                    L930,24 L940,22 L945,24 L960,24 L968,24 L972,26 L975,8 L978,40 L981,20 L984,24 L1000,24
                  `}
                  fill="none"
                  stroke={NEON_GREEN}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ filter: `drop-shadow(0 0 3px ${NEON_GREEN}) drop-shadow(0 0 6px ${NEON_GREEN})` }}
                />
              </svg>
            </motion.div>
            
          </div>
          
          <div className="flex justify-between mt-3">
            <span className="text-[8px] font-mono text-blue-500/60 tracking-widest">PAYMENT_LAYER</span>
            <span className="text-[8px] font-mono text-slate-600 tracking-widest flex items-center gap-1">
              <Activity className="w-2.5 h-2.5" style={{ color: NEON_GREEN }} />
              PROCESSING
            </span>
            <span className="text-[8px] font-mono text-purple-500/60 tracking-widest">PRIVACY_LAYER</span>
          </div>
        </motion.div>
      </div>
      
      {/* Bottom Spacer */}
      <div className="h-16" />
    </section>
  );
}

export default ProtocolStack;
