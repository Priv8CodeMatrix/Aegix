'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ExternalLink, Check } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES & DATA
// ═══════════════════════════════════════════════════════════════════════════════

interface Integration {
  id: string;
  name: string;
  logo: string;
  tagline: string;
  color: string;
  borderColor: string;
  bgColor: string;
  glowColor: string;
  description: string;
  howWeUseIt: string;
  capabilities: string[];
  docsUrl: string;
}

const INTEGRATIONS: Integration[] = [
  {
    id: 'solana',
    name: 'SOLANA',
    logo: '◎',
    tagline: 'High-Performance Settlement',
    color: 'text-emerald-400',
    borderColor: 'border-emerald-800/50',
    bgColor: 'bg-emerald-950/20',
    glowColor: 'rgba(52, 211, 153, 0.3)',
    description: 'Solana is a high-performance blockchain supporting 65,000+ TPS with sub-second finality.',
    howWeUseIt: 'AEGIX deploys stealth pool wallets and executes all USDC payments on Solana mainnet. The 400ms block times enable near-instant settlement while keeping transaction costs under $0.001.',
    capabilities: ['Native USDC (SPL Token) support', '400ms block finality', 'Sub-cent transaction fees', 'Parallel transaction processing'],
    docsUrl: 'https://solana.com/docs',
  },
  {
    id: 'light',
    name: 'LIGHT_PROTOCOL',
    logo: '⚡',
    tagline: 'ZK State Compression',
    color: 'text-purple-400',
    borderColor: 'border-purple-800/50',
    bgColor: 'bg-purple-950/20',
    glowColor: 'rgba(192, 132, 252, 0.3)',
    description: 'Light Protocol provides ZK state compression for Solana, reducing costs by ~50x.',
    howWeUseIt: 'AEGIX uses Light Protocol for compressed token transfers. Ephemeral burner wallets break the link between stealth pools and recipients, providing maximum privacy at minimal cost.',
    capabilities: ['ZK State Compression (~50x cheaper)', 'Compressed Token Accounts', 'Ephemeral Burner Privacy', 'On-chain verifiable proofs'],
    docsUrl: 'https://lightprotocol.com',
  },
  {
    id: 'x402',
    name: 'x402_PROTOCOL',
    logo: '⚡',
    tagline: 'Async Payment Rails',
    color: 'text-blue-400',
    borderColor: 'border-blue-800/50',
    bgColor: 'bg-blue-950/20',
    glowColor: 'rgba(96, 165, 250, 0.3)',
    description: 'x402 is an HTTP-native payment protocol enabling non-interactive micropayments.',
    howWeUseIt: 'AEGIX implements x402 for seamless AI service payments. When an AI agent needs to pay for an API call, x402 handles the handshake automatically—no user interaction required.',
    capabilities: ['HTTP 402 Payment Required flow', 'Non-interactive settlement', 'Automatic retry handling', 'Built-in receipt verification'],
    docsUrl: 'https://www.x402.org',
  },
  {
    id: 'payai',
    name: 'PAYAI',
    logo: '💳',
    tagline: 'Gasless Facilitation',
    color: 'text-amber-400',
    borderColor: 'border-amber-800/50',
    bgColor: 'bg-amber-950/20',
    glowColor: 'rgba(251, 191, 36, 0.3)',
    description: 'PayAI is an x402 facilitator that sponsors gas fees for payment transactions.',
    howWeUseIt: 'PayAI pays the Solana transaction fees so your stealth pool doesn\'t need to hold SOL for gas. This enables true gasless payments—you only need USDC in your pool.',
    capabilities: ['Gas fee sponsorship', 'Automatic SOL rent handling', 'Burner wallet lifecycle management', 'Fee recovery optimization'],
    docsUrl: 'https://payai.network',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
const CARD_WIDTH = 280;
const CARD_GAP = 20;
const CARD_SLOT = CARD_WIDTH + CARD_GAP;
const CARD_HEIGHT = 72;
const SCROLL_SPEED = 50;
const EXPANSION_EASE: [number, number, number, number] = [0.05, 0.7, 0.1, 1.0];

const NEON_GREEN = '#00ff88';

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function IntegrationCarousel() {
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const offsetRef = useRef<number>(0);
  
  const [offset, setOffset] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [openCardIndex, setOpenCardIndex] = useState<number | null>(null);
  const [hoveredCardIndex, setHoveredCardIndex] = useState<number | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Dual-buffer cloning for seamless infinite loop
  const items = [...INTEGRATIONS, ...INTEGRATIONS];
  const singleSetWidth = INTEGRATIONS.length * CARD_SLOT;

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIMATION LOOP
  // ═══════════════════════════════════════════════════════════════════════════
  const tick = useCallback((timestamp: number) => {
    if (!lastTimeRef.current) {
      lastTimeRef.current = timestamp;
    }

    const delta = timestamp - lastTimeRef.current;
    lastTimeRef.current = timestamp;

    const movement = (SCROLL_SPEED * delta) / 1000;
    offsetRef.current -= movement;

    if (Math.abs(offsetRef.current) >= singleSetWidth) {
      offsetRef.current = offsetRef.current % singleSetWidth;
    }

    setOffset(offsetRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [singleSetWidth]);

  useEffect(() => {
    const shouldAnimate = isReady && !isPaused && openCardIndex === null;

    if (shouldAnimate) {
      lastTimeRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    } else if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isReady, isPaused, openCardIndex, tick]);

  useEffect(() => {
    const timer = setTimeout(() => setIsReady(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERACTION HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════
  const handleCardClick = useCallback((index: number, event: React.MouseEvent<HTMLDivElement>) => {
    if (openCardIndex === index) {
      setOpenCardIndex(null);
    } else {
      const clickedCard = event.currentTarget;
      const cardRect = clickedCard.getBoundingClientRect();
      const containerRect = clickedCard.closest('[role="region"]')?.getBoundingClientRect();
      
      if (containerRect) {
        const viewportLeft = containerRect.left + 40;
        const viewportRight = containerRect.right - 40;
        
        let adjustment = 0;
        
        if (cardRect.right > viewportRight) {
          adjustment = -(cardRect.right - viewportRight + 60);
        } else if (cardRect.left < viewportLeft) {
          adjustment = viewportLeft - cardRect.left + 60;
        }
        
        if (adjustment !== 0) {
          offsetRef.current += adjustment;
          setOffset(offsetRef.current);
        }
      }
      
      setOpenCardIndex(index);
    }
  }, [openCardIndex]);

  const handleContainerEnter = useCallback(() => {
    if (openCardIndex === null) setIsPaused(true);
  }, [openCardIndex]);

  const handleContainerLeave = useCallback(() => {
    if (openCardIndex === null) setIsPaused(false);
    setHoveredCardIndex(null);
  }, [openCardIndex]);

  const handleCardEnter = useCallback((index: number) => {
    setHoveredCardIndex(index);
  }, []);

  const handleCardLeave = useCallback(() => {
    setHoveredCardIndex(null);
  }, []);

  const hasExpandedCard = openCardIndex !== null;
  const progress = Math.abs(offset % singleSetWidth) / singleSetWidth;

  return (
    <div className="w-full select-none" role="region" aria-label="Infrastructure Stack">
      {/* Top Divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-slate-700/50 to-transparent mb-6" />
      
      {/* Label */}
      <div className="flex items-center gap-2 mb-5">
        <div 
          className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ backgroundColor: NEON_GREEN, boxShadow: `0 0 8px ${NEON_GREEN}` }}
        />
        <span className="text-[10px] font-mono text-slate-500 tracking-widest uppercase">
          Infrastructure Stack
        </span>
        <span className="text-[10px] font-mono text-slate-600 ml-2">Click to explore</span>
        <div className="flex-1 h-px bg-gradient-to-r from-slate-800 to-transparent ml-3" />
      </div>

      {/* CAROUSEL CONTAINER */}
      <div 
        className="relative"
        onMouseEnter={handleContainerEnter}
        onMouseLeave={handleContainerLeave}
        style={{
          minHeight: CARD_HEIGHT + 30,
          overflowX: 'clip',
          overflowY: 'visible',
        }}
      >
        {/* Edge Gradients */}
        {!hasExpandedCard && (
          <>
            <div 
              className="absolute left-0 top-0 w-8 z-30 pointer-events-none"
              style={{
                height: CARD_HEIGHT,
                background: 'linear-gradient(to right, rgba(2, 6, 23, 0.95) 0%, transparent 100%)',
              }}
            />
            <div 
              className="absolute right-0 top-0 w-8 z-30 pointer-events-none"
              style={{
                height: CARD_HEIGHT,
                background: 'linear-gradient(to left, rgba(2, 6, 23, 0.95) 0%, transparent 100%)',
              }}
            />
          </>
        )}

        {/* CARD TRACK */}
        <div
          style={{
            transform: `translate3d(${offset}px, 0, 0)`,
            willChange: 'transform',
            transition: openCardIndex !== null ? 'transform 0.4s cubic-bezier(0.05, 0.7, 0.1, 1.0)' : undefined,
          }}
        >
          <div 
            className="flex items-start"
            style={{ gap: `${CARD_GAP}px` }}
          >
            {items.map((item, idx) => {
              const isOpen = openCardIndex === idx;
              const isHovered = hoveredCardIndex === idx && !hasExpandedCard;
              const isInactive = hasExpandedCard && !isOpen;
              
              return (
                <div
                  key={`card-${idx}`}
                  onClick={(e) => handleCardClick(idx, e)}
                  onMouseEnter={() => handleCardEnter(idx)}
                  onMouseLeave={handleCardLeave}
                  className={`flex-shrink-0 cursor-pointer border backdrop-blur-sm ${item.borderColor} ${item.bgColor}`}
                  style={{
                    width: CARD_WIDTH,
                    minHeight: CARD_HEIGHT,
                    willChange: 'transform, opacity',
                    transition: `
                      transform 0.4s cubic-bezier(${EXPANSION_EASE.join(',')}),
                      opacity 0.35s ease,
                      filter 0.35s ease,
                      box-shadow 0.4s cubic-bezier(${EXPANSION_EASE.join(',')})
                    `,
                    transform: isOpen 
                      ? 'scale(1.03) translateY(-6px)' 
                      : isHovered 
                        ? 'scale(1.02)' 
                        : isInactive 
                          ? 'scale(0.96)' 
                          : 'scale(1)',
                    opacity: isInactive ? 0.6 : 1,
                    filter: isInactive ? 'brightness(0.8)' : 'none',
                    boxShadow: isOpen 
                      ? `0 25px 50px -12px ${item.glowColor}`
                      : isHovered
                        ? `0 10px 25px -8px ${item.glowColor}`
                        : 'none',
                    zIndex: isOpen ? 20 : isHovered ? 10 : 1,
                    position: 'relative',
                  }}
                >
                  {/* Card Header */}
                  <div 
                    className="px-5 flex items-center justify-between"
                    style={{ height: CARD_HEIGHT }}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 flex items-center justify-center bg-slate-900/80 border border-slate-700/50 rounded-lg flex-shrink-0">
                        <span className="text-xl">{item.logo}</span>
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm font-mono font-semibold tracking-wide ${item.color}`}>
                          {item.name}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                          {item.tagline}
                        </p>
                      </div>
                    </div>
                    <motion.div
                      animate={{ rotate: isOpen ? 180 : 0 }}
                      transition={{ duration: 0.4, ease: EXPANSION_EASE }}
                    >
                      <ChevronDown className={`w-4 h-4 ${item.color} opacity-60`} />
                    </motion.div>
                  </div>

                  {/* Expanded Content */}
                  <AnimatePresence mode="sync">
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ 
                          height: { duration: 0.45, ease: EXPANSION_EASE },
                          opacity: { duration: 0.3, delay: 0.08 },
                        }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div className="px-5 pb-5 pt-3 space-y-4 border-t border-slate-800/50">
                          <p className="text-[12px] text-slate-400 leading-relaxed">
                            {item.description}
                          </p>

                          <div className="p-3 border border-slate-800/50 bg-slate-900/60 rounded-lg">
                            <p className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-1.5">
                              How AEGIX Uses This
                            </p>
                            <p className="text-[11px] text-slate-300 leading-relaxed">
                              {item.howWeUseIt}
                            </p>
                          </div>

                          <div>
                            <p className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-2">
                              Capabilities
                            </p>
                            <div className="space-y-1.5">
                              {item.capabilities.map((cap, i) => (
                                <motion.div 
                                  key={i} 
                                  className="flex items-center gap-2"
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ 
                                    delay: 0.12 + i * 0.05, 
                                    duration: 0.3, 
                                    ease: EXPANSION_EASE 
                                  }}
                                >
                                  <Check className={`w-3 h-3 ${item.color} flex-shrink-0`} />
                                  <span className="text-[11px] text-slate-400">{cap}</span>
                                </motion.div>
                              ))}
                            </div>
                          </div>

                          <a
                            href={item.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className={`flex items-center justify-between p-3 border ${item.borderColor} bg-slate-900/70 rounded-lg hover:bg-slate-800/80 transition-all duration-200 group`}
                          >
                            <span className={`text-[11px] font-mono ${item.color}`}>
                              Documentation →
                            </span>
                            <ExternalLink className={`w-3 h-3 ${item.color} group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-200`} />
                          </a>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* PROGRESS INDICATOR */}
      <div className="mt-5 relative h-[1px] bg-slate-800/30 rounded-full overflow-hidden">
        <div
          style={{
            width: `${progress * 100}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${NEON_GREEN}30, ${NEON_GREEN}60)`,
            boxShadow: `0 0 4px ${NEON_GREEN}20`,
            borderRadius: '1px',
          }}
        />
      </div>
    </div>
  );
}

export default IntegrationCarousel;
