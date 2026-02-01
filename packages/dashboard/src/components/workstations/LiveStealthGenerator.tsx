'use client';

import { useState, useEffect } from 'react';
import { Keypair } from '@solana/web3.js';
import { Copy, Check, RefreshCw, ExternalLink } from 'lucide-react';
import { Connection } from '@solana/web3.js';

const RPC_ENDPOINT = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

export function LiveStealthGenerator() {
  const [burner, setBurner] = useState<Keypair | null>(null);
  const [copied, setCopied] = useState(false);
  const [slotHeight, setSlotHeight] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const generateBurner = async () => {
    setIsGenerating(true);
    try {
      const newKeypair = Keypair.generate();
      setBurner(newKeypair);
      // Update slot height
      const slot = await connection.getSlot();
      setSlotHeight(slot);
    } catch (error) {
      console.error('Failed to generate burner:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    // Generate initial burner
    generateBurner();
    
    // Update slot height periodically
    const interval = setInterval(async () => {
      try {
        const slot = await connection.getSlot();
        setSlotHeight(slot);
      } catch (error) {
        console.error('Failed to fetch slot:', error);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [connection]);

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border border-slate-800 bg-slate-950 h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-400">LIVE_STEALTH_GENERATOR</span>
          {slotHeight && (
            <span className="text-[10px] font-mono text-slate-600">
              SLOT: {slotHeight.toLocaleString()}
            </span>
          )}
        </div>
        <button
          onClick={generateBurner}
          disabled={isGenerating}
          className="p-1.5 hover:bg-slate-800 border border-slate-700 disabled:opacity-50 transition-colors"
          title="Generate New Burner"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${isGenerating ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 flex flex-col justify-center">
        {burner ? (
          <div className="space-y-4">
            {/* Generated Address */}
            <div className="p-4 border border-slate-800 bg-slate-900">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono text-slate-500">EPHEMERAL_BURNER_ADDRESS</span>
                <button
                  onClick={() => copyAddress(burner.publicKey.toBase58())}
                  className="p-1 hover:bg-slate-800 transition-colors"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-slate-500" />
                  )}
                </button>
              </div>
              <code className="text-sm font-mono text-slate-200 block break-all">
                {burner.publicKey.toBase58()}
              </code>
              <div className="mt-3 flex items-center gap-2">
                <a
                  href={`https://solscan.io/account/${burner.publicKey.toBase58()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono text-blue-400 hover:underline flex items-center gap-1"
                >
                  VIEW_ON_SOLSCAN
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            {/* Info */}
            <div className="p-3 border border-slate-800 bg-slate-900">
              <p className="text-[10px] font-mono text-slate-500 mb-2">BURNER_SPEC</p>
              <div className="space-y-1 text-[10px] font-mono text-slate-400">
                <div>TYPE: Ephemeral (one-time use)</div>
                <div>NETWORK: Solana Mainnet</div>
                <div>PRIVACY: Zero correlation to main wallet</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-slate-800 w-3/4 mx-auto" />
              <div className="h-4 bg-slate-800 w-1/2 mx-auto" />
            </div>
            <p className="text-[10px] font-mono text-slate-600 mt-4">NETWORK_SYNCING...</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default LiveStealthGenerator;
