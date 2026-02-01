'use client';

import { useState, useEffect } from 'react';
import { Activity, ExternalLink } from 'lucide-react';
import { Connection } from '@solana/web3.js';

const RPC_ENDPOINT = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

export function UtilityHeader() {
  const [slotHeight, setSlotHeight] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const updateStatus = async () => {
      try {
        const slot = await connection.getSlot();
        setSlotHeight(slot);
        setIsOnline(true);
      } catch (error) {
        setIsOnline(false);
      }
    };

    updateStatus();
    const interval = setInterval(updateStatus, 5000);

    return () => clearInterval(interval);
  }, [connection]);

  return (
    <div className="border-b border-slate-800 bg-slate-950 px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Left: Network Status */}
        <div className="flex items-center gap-6">
          {isOnline ? (
            <>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-[10px] font-mono text-slate-400">NETWORK_ONLINE</span>
              </div>
              {slotHeight && (
                <span className="text-[10px] font-mono text-slate-600">
                  SLOT: {slotHeight.toLocaleString()}
                </span>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-[10px] font-mono text-amber-400">NETWORK_SYNCING</span>
            </div>
          )}
        </div>

        {/* Right: Utility Links */}
        <div className="flex items-center gap-4">
          <a
            href="https://docs.aegix.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-mono text-slate-500 hover:text-slate-400 transition-colors flex items-center gap-1"
          >
            API_REF
            <ExternalLink className="w-3 h-3" />
          </a>
          <span className="text-slate-800">•</span>
          <a
            href="https://github.com/aegix"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-mono text-slate-500 hover:text-slate-400 transition-colors flex items-center gap-1"
          >
            STATUS
            <ExternalLink className="w-3 h-3" />
          </a>
          <span className="text-slate-800">•</span>
          <a
            href="#"
            className="text-[10px] font-mono text-slate-500 hover:text-slate-400 transition-colors"
          >
            SECURITY_AUDIT
          </a>
        </div>
      </div>
    </div>
  );
}

export default UtilityHeader;

