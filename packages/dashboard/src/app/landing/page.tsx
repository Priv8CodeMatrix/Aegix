'use client';

import { useRouter } from 'next/navigation';
import { HeroWorkstation } from '@/components/hero';
import {
  ChainOfCustody,
  ShieldedLedger,
  ProtocolStack,
  DeveloperWorkstation,
  ComplianceFooter,
} from '@/components/landing';

export default function LandingPage() {
  const router = useRouter();

  const handleLaunchApp = () => {
    router.push('/');
  };

  return (
    <main className="relative min-h-screen bg-slate-950">
      {/* Layer 1: Base Vertical Gradient */}
      <div className="fixed inset-0 bg-gradient-to-b from-slate-950 via-slate-900/40 to-slate-950 pointer-events-none z-0" />
      
      {/* Layer 2: Subtle Radial Gradients (Top Corners) */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(15,23,42,0.3),_transparent_50%)] pointer-events-none z-0" />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(15,23,42,0.25),_transparent_50%)] pointer-events-none z-0" />
      
      {/* Layer 3: Subtle Bottom Glow */}
      <div className="fixed inset-0 bg-gradient-to-t from-slate-900/20 via-transparent to-transparent pointer-events-none z-0" />
      
      {/* Layer 4: Grid Pattern (Balanced Visibility) */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(30,41,59,0.3)_1px,transparent_1px),linear-gradient(90deg,rgba(30,41,59,0.3)_1px,transparent_1px)] bg-[size:80px_80px] pointer-events-none z-0 opacity-40" />
      
      {/* Layer 5: Subtle Noise Texture */}
      <div 
        className="fixed inset-0 pointer-events-none z-0 opacity-[0.02]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />
      
      {/* Content wrapper with z-index to appear above all layers */}
      <div className="relative z-10">
        {/* Section 1: Hero Workstation */}
        <HeroWorkstation onLaunchApp={handleLaunchApp} />

        {/* Section 2: Chain of Custody Protocol */}
        <ChainOfCustody />

        {/* Section 3: Shielded Ledger */}
        <ShieldedLedger />

        {/* Section 4: Architecture & Protocol Stack */}
        <ProtocolStack />

        {/* Section 5: Developer API Workstation */}
        <DeveloperWorkstation />

        {/* Section 6: Compliance & Safety Footer */}
        <ComplianceFooter />
      </div>
    </main>
  );
}
