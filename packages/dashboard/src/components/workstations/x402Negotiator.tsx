'use client';

import { useState, useEffect } from 'react';
import { Zap, ArrowRight, CheckCircle, Loader2 } from 'lucide-react';

interface NegotiationStep {
  phase: string;
  from: string;
  to: string;
  amount: string;
  status: 'pending' | 'negotiating' | 'agreed' | 'settled';
  timestamp: string;
}

export function X402Negotiator() {
  const [negotiation, setNegotiation] = useState<NegotiationStep | null>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    // Simulate real-time x402 negotiations
    const simulateNegotiation = () => {
      setIsActive(true);
      setNegotiation({
        phase: 'PRICE_NEGOTIATION',
        from: 'AGENT_#abc123',
        to: 'SERVICE_PROVIDER',
        amount: '0.05 USDC',
        status: 'negotiating',
        timestamp: new Date().toISOString().split('T')[1].split('.')[0],
      });

      // Progress through negotiation
      setTimeout(() => {
        setNegotiation((prev) =>
          prev
            ? {
                ...prev,
                status: 'agreed',
                timestamp: new Date().toISOString().split('T')[1].split('.')[0],
              }
            : null
        );
      }, 2000);

      // Complete negotiation
      setTimeout(() => {
        setNegotiation((prev) =>
          prev
            ? {
                ...prev,
                status: 'settled',
                phase: 'SETTLEMENT_COMPLETE',
                timestamp: new Date().toISOString().split('T')[1].split('.')[0],
              }
            : null
        );
        setIsActive(false);
      }, 4000);
    };

    // Run negotiation simulation every 10 seconds
    const interval = setInterval(simulateNegotiation, 10000);
    
    // Initial simulation
    simulateNegotiation();

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="border border-slate-800 bg-slate-950 h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-xs font-mono text-slate-400">x402_NEGOTIATOR</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-blue-400 animate-pulse' : 'bg-slate-600'}`} />
          <span className="text-[10px] font-mono text-slate-600">
            {isActive ? 'ACTIVE' : 'IDLE'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 flex flex-col justify-center">
        {negotiation ? (
          <div className="space-y-4">
            {/* Phase */}
            <div className="text-center">
              <p className="text-[10px] font-mono text-slate-500 mb-1">PHASE</p>
              <p className="text-sm font-mono text-white">{negotiation.phase}</p>
            </div>

            {/* Handshake Flow */}
            <div className="flex items-center justify-between px-4">
              <div className="flex-1">
                <p className="text-[10px] font-mono text-slate-500 mb-2">FROM</p>
                <p className="text-xs font-mono text-slate-300">{negotiation.from}</p>
              </div>
              
              <div className="flex flex-col items-center gap-2 mx-4">
                {negotiation.status === 'negotiating' && (
                  <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                )}
                {negotiation.status === 'agreed' && (
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                )}
                {negotiation.status === 'settled' && (
                  <ArrowRight className="w-5 h-5 text-emerald-400" />
                )}
              </div>

              <div className="flex-1 text-right">
                <p className="text-[10px] font-mono text-slate-500 mb-2">TO</p>
                <p className="text-xs font-mono text-slate-300">{negotiation.to}</p>
              </div>
            </div>

            {/* Amount */}
            <div className="p-3 border border-slate-800 bg-slate-900 text-center">
              <p className="text-[10px] font-mono text-slate-500 mb-1">NEGOTIATED_AMOUNT</p>
              <p className="text-lg font-mono text-white">{negotiation.amount}</p>
            </div>

            {/* Status */}
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-slate-600">{negotiation.timestamp}</span>
              <span
                className={
                  negotiation.status === 'settled'
                    ? 'text-emerald-400'
                    : negotiation.status === 'agreed'
                    ? 'text-blue-400'
                    : 'text-amber-400'
                }
              >
                {negotiation.status.toUpperCase()}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-[10px] font-mono text-slate-600">WAITING_FOR_NEGOTIATION</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-slate-800 bg-slate-900/30">
        <div className="flex items-center justify-between text-[10px] font-mono text-slate-600">
          <span>PAYAI_FACILITATOR</span>
          <span>GASLESS_MODE</span>
        </div>
      </div>
    </div>
  );
}

export default X402Negotiator;
