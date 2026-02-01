'use client';

import { Zap, Lock, Cpu, Shield } from 'lucide-react';

interface ProtocolHeaderProps {
  activeAgents: number;
  encryptedCount: number;
}

export function ProtocolHeader({ activeAgents, encryptedCount }: ProtocolHeaderProps) {
  return (
    <div className="bg-[#0a0a0a] border-b border-[#1a1a1a]">
      <div className="max-w-7xl mx-auto px-4 py-2.5">
        <div className="flex items-center justify-between">
          {/* Left: x402 by PayAI */}
          <a
            href="https://payai.network"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 group"
          >
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#111111] border border-[#1a1a1a] group-hover:border-[#2a2a2a] transition-colors">
              <Zap className="w-3 h-3 text-[#444444]" />
              <span className="text-[11px] font-medium text-[#666666]">x402</span>
            </div>
            <span className="text-[11px] text-[#444444] group-hover:text-[#666666] transition-colors">
              by PayAI
            </span>
          </a>

          {/* Center: Stats */}
          <div className="hidden md:flex items-center gap-8">
            <div className="flex items-center gap-2">
              <Cpu className="w-3 h-3 text-[#333333]" />
              <span className="text-[11px] text-[#444444]">
                <span className="font-medium text-[#a1a1a1]">{activeAgents}</span> Agents
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="w-3 h-3 text-[#333333]" />
              <span className="text-[11px] text-[#444444]">
                <span className="font-medium text-[#a1a1a1]">{encryptedCount}</span> Encrypted
              </span>
            </div>
          </div>

          {/* Right: Light Protocol Compression */}
          <a
            href="https://lightprotocol.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 group"
          >
            <span className="text-[11px] text-[#444444] group-hover:text-[#666666] transition-colors">
              Compressed by
            </span>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#111111] border border-[#1a1a1a] group-hover:border-[#2a2a2a] transition-colors">
              <Lock className="w-3 h-3 text-[#444444]" />
              <span className="text-[11px] font-medium text-[#666666]">Light Protocol</span>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
