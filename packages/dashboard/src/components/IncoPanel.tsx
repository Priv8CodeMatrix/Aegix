'use client';

import { Lock, Unlock, Shield, ExternalLink, Clock, Check } from 'lucide-react';

interface AuditEntry {
  id: string;
  type: string;
  amount?: string;
  timestamp: string;
  fheHandle?: string;
  txSignature?: string;
}

interface IncoPanelProps {
  auditLog: AuditEntry[];
  onOpenDecryption: () => void;
  fheMode: 'REAL' | 'SIMULATION' | 'UNKNOWN';
}

export function IncoPanel({ auditLog, onOpenDecryption, fheMode }: IncoPanelProps) {
  const encryptedCount = auditLog.filter(e => e.fheHandle).length;
  const latestEntry = auditLog[0];
  const isRealFhe = fheMode === 'REAL';

  return (
    <div className="rounded-xl border border-[#1a1a1a] overflow-hidden bg-[#111111]">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-[#1a1a1a] bg-[#0a0a0a]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#444444]" />
            <h3 className="font-medium text-sm text-[#fafafa]">INCO Encryption</h3>
          </div>
          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
            isRealFhe 
              ? 'bg-[#10b981]/10 text-[#10b981]' 
              : 'bg-[#f59e0b]/10 text-[#f59e0b]'
          }`}>
            {isRealFhe ? '✓ Real FHE' : 'Simulated'}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a]">
            <div className="flex items-center gap-2 mb-1.5">
              <Shield className="w-3.5 h-3.5 text-[#333333]" />
              <span className="text-[10px] uppercase tracking-wider text-[#444444]">Encrypted</span>
            </div>
            <p className="text-2xl font-bold font-mono text-[#fafafa]">{encryptedCount}</p>
          </div>
          <div className="p-3.5 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a]">
            <div className="flex items-center gap-2 mb-1.5">
              <Clock className="w-3.5 h-3.5 text-[#333333]" />
              <span className="text-[10px] uppercase tracking-wider text-[#444444]">Latest</span>
            </div>
            <p className="text-sm font-mono text-[#a1a1a1]">
              {latestEntry ? formatTimeAgo(latestEntry.timestamp) : 'None'}
            </p>
          </div>
        </div>

        {/* Decrypt Button */}
        <button
          onClick={onOpenDecryption}
          className="w-full py-3.5 px-4 rounded-lg bg-[#0066ff] text-white font-medium 
                     hover:bg-[#0052cc] transition-colors flex items-center justify-center gap-2"
        >
          <Unlock className="w-4 h-4" />
          View & Decrypt Data
        </button>

        {/* Info */}
        <div className="space-y-2 pt-2">
          <p className="text-[11px] text-[#444444] flex items-center gap-1.5">
            <Check className="w-3 h-3 text-[#10b981]" />
            Powered by @inco/solana-sdk
          </p>
          <p className="text-[11px] text-[#444444] flex items-center gap-1.5">
            <Check className="w-3 h-3 text-[#10b981]" />
            Only wallet owner can decrypt
          </p>
          <a
            href="https://docs.inco.org/svm"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-[#0066ff] hover:text-[#0052cc] flex items-center gap-1 transition-colors"
          >
            Learn more about Inco FHE
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(timestamp: string): string {
  const now = Date.now();
  const time = new Date(timestamp).getTime();
  const diff = now - time;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}
