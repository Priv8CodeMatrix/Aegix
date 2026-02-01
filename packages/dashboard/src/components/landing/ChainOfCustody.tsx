'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, ArrowDown, Wallet, Lock, Zap, RefreshCw, Shield } from 'lucide-react';
import { useState } from 'react';

interface Step {
  id: number;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  from: string;
  to: string;
  accentColor: string;
}

export function ChainOfCustody() {
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);

  // Static steps for display
  const STEPS: Step[] = [
    {
      id: 1,
      title: 'FUNDING',
      description: 'User funds stealth pool from main wallet',
      icon: Wallet,
      from: 'User_Wallet',
      to: 'Stealth_Pool',
      accentColor: '#3b82f6', // blue for icon only
    },
    {
      id: 2,
      title: 'ENCRYPTION',
      description: 'FHE encryption of ownership mapping',
      icon: Lock,
      from: 'Light_ZK_Compression',
      to: 'Ciphertext_Handle',
      accentColor: '#a855f7',
    },
    {
      id: 3,
      title: 'EXECUTION',
      description: 'x402 negotiated payment via burner',
      icon: Zap,
      from: 'Burner_Wallet',
      to: 'Recipient_Wallet',
      accentColor: '#10b981', // emerald for icon only
    },
    {
      id: 4,
      title: 'SETTLEMENT',
      description: 'SOL rent recovery to pool',
      icon: RefreshCw,
      from: 'Recovery_Facilitator',
      to: 'Pool_Cleanup',
      accentColor: '#f59e0b', // amber for icon only
    },
  ];

  return (
    <section className="relative py-32 px-6 lg:px-8 bg-transparent overflow-hidden">
      {/* Industrial Background Pattern */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_transparent_20%,_rgba(9,9,11,0.9)_70%)]" />
        {/* Grid Pattern */}
        <div 
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px',
          }}
        />
      </div>
      
      {/* Top Industrial Divider - Single neutral line */}
      <div className="absolute top-0 left-0 right-0">
        <div className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />
      </div>
      
      <div className="max-w-7xl mx-auto">
        {/* Header - Clean Industrial Style */}
        <div className="mb-16 pt-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-3 mb-6"
          >
            <div 
              className="flex items-center gap-2 px-3 py-1.5 backdrop-blur-sm"
              style={{
                background: 'linear-gradient(to bottom right, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <Shield className="w-3 h-3 text-zinc-500" />
              <span className="text-[10px] font-mono text-zinc-500 tracking-[0.2em] uppercase">Protocol Mechanics</span>
            </div>
            <div className="h-px w-16 bg-gradient-to-r from-zinc-800 to-transparent" />
          </motion.div>
          
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="text-3xl md:text-4xl font-bold text-white mb-4 font-mono tracking-tight"
          >
            CHAIN_OF_CUSTODY
          </motion.h2>
          
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="text-zinc-500 text-sm max-w-2xl font-mono leading-relaxed"
          >
            Link-breaking mechanism from the PDR. Four discrete steps ensure zero correlation between main wallet and payment recipients.
          </motion.p>
        </div>

        {/* Step Flow - Glassmorphism Style */}
        <div className="relative">
          {/* Central Vertical Dashed Line (Desktop) */}
          <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 -translate-x-1/2">
            <div 
              className="h-full w-px"
              style={{
                backgroundImage: 'repeating-linear-gradient(to bottom, #3f3f46 0px, #3f3f46 6px, transparent 6px, transparent 12px)',
              }}
            />
          </div>
          
          {/* Steps */}
          <div className="space-y-6 lg:space-y-0">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              const isEven = index % 2 === 0;
              const isHovered = hoveredStep === step.id;
              
              return (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                  className={`relative lg:flex ${isEven ? '' : 'lg:flex-row-reverse'}`}
                >
                  {/* Step Card */}
                  <div className={`lg:w-[calc(50%-2rem)] ${isEven ? 'lg:pr-8' : 'lg:pl-8'}`}>
                    <motion.div 
                      className="relative backdrop-blur-[12px] overflow-hidden"
                      style={{
                        background: 'linear-gradient(to bottom right, rgba(255,255,255,0.02), rgba(255,255,255,0.005))',
                        border: '1px solid',
                        borderImage: isHovered 
                          ? 'linear-gradient(to bottom right, rgba(255,255,255,0.2), rgba(255,255,255,0.05)) 1'
                          : 'linear-gradient(to bottom right, rgba(255,255,255,0.08), rgba(255,255,255,0.02)) 1',
                        boxShadow: isHovered 
                          ? '0 0 30px rgba(255,255,255,0.03), inset 0 1px 0 0 rgba(255,255,255,0.03)'
                          : 'inset 0 1px 0 0 rgba(255,255,255,0.02)',
                        transition: 'all 0.3s ease',
                      }}
                      onMouseEnter={() => setHoveredStep(step.id)}
                      onMouseLeave={() => setHoveredStep(null)}
                    >
                      {/* Scanning Animation on Hover */}
                      <AnimatePresence>
                        {isHovered && (
                          <motion.div
                            className="absolute inset-0 pointer-events-none z-10"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <motion.div
                              className="absolute left-0 right-0 h-[2px]"
                              style={{ 
                                background: `linear-gradient(90deg, transparent, ${step.accentColor}90, transparent)`,
                                boxShadow: `0 0 20px ${step.accentColor}60`,
                              }}
                              initial={{ top: '0%' }}
                              animate={{ top: '100%' }}
                              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                      
                      {/* Card Header */}
                      <div 
                        className="px-5 py-4 flex items-center justify-between"
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-9 h-9 flex items-center justify-center"
                            style={{
                              background: 'rgba(0,0,0,0.4)',
                              border: '1px solid rgba(255,255,255,0.06)',
                            }}
                          >
                            <Icon className="w-4 h-4" style={{ color: step.accentColor }} />
                          </div>
                          <div>
                            <h3 className="text-[11px] font-mono font-bold text-white tracking-[0.15em] uppercase">{step.title}</h3>
                            <p className="text-[9px] font-mono text-zinc-600 tracking-wider">STEP_{String(step.id).padStart(2, '0')}</p>
                          </div>
                        </div>
                      </div>
                      
                      {/* Card Body */}
                      <div className="p-5 space-y-4">
                        <p className="text-[11px] font-mono text-zinc-500 leading-relaxed">{step.description}</p>
                        
                        {/* Flow Direction - Recessed Box */}
                        <div 
                          className="flex items-center gap-3 py-3 px-3"
                          style={{
                            background: '#0a0a0a',
                            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(255,255,255,0.02)',
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[8px] font-mono text-zinc-600 mb-0.5 tracking-wider">FROM</p>
                            <code className="text-[10px] font-mono text-zinc-300 block truncate">{step.from}</code>
                          </div>
                          <ArrowRight className="w-4 h-4 text-zinc-600 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[8px] font-mono text-zinc-600 mb-0.5 tracking-wider">TO</p>
                            <code className="text-[10px] font-mono text-zinc-300 block truncate">{step.to}</code>
                          </div>
                        </div>
                        
                      </div>
                    </motion.div>
                  </div>
                  
                  {/* Center Node (Desktop) - Sharp edged with subtle glow when active */}
                  <div className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                    <div 
                      className="w-9 h-9 flex items-center justify-center transition-all duration-300"
                      style={{
                        background: '#0a0a0a',
                        border: '1px solid rgba(255,255,255,0.1)',
                        boxShadow: isHovered 
                          ? `0 0 20px ${step.accentColor}30, 0 0 40px ${step.accentColor}10`
                          : 'none',
                      }}
                    >
                      <span 
                        className="text-sm font-mono font-bold transition-colors duration-300"
                        style={{ color: isHovered ? step.accentColor : '#71717a' }}
                      >
                        {step.id}
                      </span>
                    </div>
                  </div>
                  
                  {/* Connector Arrow to Next Step (Desktop) */}
                  {index < STEPS.length - 1 && (
                    <div className="hidden lg:flex absolute left-1/2 -translate-x-1/2 -bottom-3 z-10">
                      <ArrowDown className="w-3 h-3 text-zinc-700" />
                    </div>
                  )}
                  
                  {/* Spacer for alternating layout */}
                  <div className="hidden lg:block lg:w-[calc(50%-2rem)]" />
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Bottom Summary - Minimal Industrial Style */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.5 }}
          className="mt-16 py-4"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.04)',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}
        >
          <div className="flex items-center justify-center gap-6 flex-wrap">
            {STEPS.map((step, index) => (
              <div key={step.id} className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div 
                    className="w-1.5 h-1.5"
                    style={{ backgroundColor: step.accentColor }}
                  />
                  <span className="text-[9px] font-mono text-zinc-600 tracking-wider">{step.title}</span>
                </div>
                {index < STEPS.length - 1 && (
                  <ArrowRight className="w-3 h-3 text-zinc-800" />
                )}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
      
      {/* Bottom Spacer */}
      <div className="h-16" />
    </section>
  );
}

export default ChainOfCustody;
