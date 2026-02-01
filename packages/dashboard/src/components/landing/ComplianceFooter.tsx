'use client';

import { motion } from 'framer-motion';
import { CheckCircle, Shield, Lock, Eye, FileText } from 'lucide-react';

interface Guarantee {
  id: string;
  icon: any;
  title: string;
  description: string;
}

const GUARANTEES: Guarantee[] = [
  {
    id: 'non-custodial',
    icon: Lock,
    title: 'Zero-Storage of Private Keys',
    description: 'Your private keys never leave your wallet. All signing operations require explicit user authorization via wallet adapter.',
  },
  {
    id: 'audit-trail',
    icon: FileText,
    title: 'Verifiable On-Chain Audit Trail',
    description: 'All transactions are recorded on Solana blockchain. Public explorers can verify transaction authenticity and amounts.',
  },
  {
    id: 'fhe-encryption',
    icon: Eye,
    title: 'ZK Compressed Privacy',
    description: 'The link between your main wallet and burner addresses is hidden via Light Protocol ZK compression. Ephemeral burners ensure your stealth pool is never linked to recipients.',
  },
  {
    id: 'open-source',
    icon: Shield,
    title: 'Open-Source Protocol',
    description: 'Aegix codebase is publicly auditable. No hidden backdoors or centralized control points. Community-driven security.',
  },
];

export function ComplianceFooter() {
  return (
    <footer className="relative py-32 px-6 lg:px-8 bg-transparent">
      {/* Section Background - Outside-in gradient with slight cyan tint */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_30%,_rgba(34,211,238,0.03)_60%,_rgba(15,23,42,0.12)_100%)] -z-10" />
      
      {/* Top Divider */}
      <div className="absolute top-0 left-0 right-0 h-px bg-slate-800/80" />
      
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="mb-20 pt-8"
        >
          <div className="inline-block px-3 py-1.5 border border-slate-700 bg-slate-900/50 mb-4">
            <span className="text-[11px] font-mono text-slate-400 tracking-wide">COMPLIANCE_SAFETY</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4 font-sans">
            Non-Custodial Guarantees
          </h2>
          <p className="text-slate-400 max-w-2xl font-sans">
            Mitigating "Mixer" concerns with transparent, verifiable privacy infrastructure.
          </p>
        </motion.div>

        {/* Guarantees Grid */}
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {GUARANTEES.map((guarantee, index) => {
            const Icon = guarantee.icon;
            return (
              <motion.div
                key={guarantee.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
                className="border border-slate-800 bg-slate-900 p-6 flex gap-4"
              >
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 border border-slate-700 bg-slate-950 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-emerald-400" />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-start gap-2 mb-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <h3 className="text-base font-semibold text-white font-sans">{guarantee.title}</h3>
                  </div>
                  <p className="text-sm text-slate-400 font-sans leading-relaxed">{guarantee.description}</p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Footer Bottom */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.5 }}
          className="pt-8 border-t border-slate-800"
        >
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <p className="text-sm font-mono text-slate-400">AEGIX 3.0</p>
              <p className="text-xs text-slate-600 font-mono mt-1">
                Privacy Layer for Autonomous Commerce
              </p>
            </div>
            <div className="flex items-center gap-6 text-xs font-mono text-slate-500">
              <a href="https://docs.aegix.dev" target="_blank" rel="noopener noreferrer" className="hover:text-slate-400 transition-colors">
                DOCUMENTATION
              </a>
              <span className="text-slate-800">•</span>
              <a href="https://github.com/aegix" target="_blank" rel="noopener noreferrer" className="hover:text-slate-400 transition-colors">
                GITHUB
              </a>
              <span className="text-slate-800">•</span>
              <a href="https://twitter.com/aegix" target="_blank" rel="noopener noreferrer" className="hover:text-slate-400 transition-colors">
                TWITTER
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </footer>
  );
}

export default ComplianceFooter;
