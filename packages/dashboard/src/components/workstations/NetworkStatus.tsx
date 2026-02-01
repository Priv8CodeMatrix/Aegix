'use client';

import { useState, useEffect } from 'react';
import { Activity, ExternalLink } from 'lucide-react';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';

interface NetworkStatus {
  solana: {
    slot: number | null;
    status: 'online' | 'syncing' | 'offline';
  };
  light: {
    status: 'real' | 'simulation' | 'offline';
    compressionEnabled: boolean;
  };
  payai: {
    status: 'online' | 'offline';
  };
}

export function NetworkStatus() {
  const [status, setStatus] = useState<NetworkStatus>({
    solana: { slot: null, status: 'offline' },
    light: { status: 'offline', compressionEnabled: false },
    payai: { status: 'offline' },
  });

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch(`${GATEWAY_URL}/api/status`);
        const result = await response.json();

        if (result.success) {
          const data = result.data;
          
          // Fetch Solana slot height
          let solanaSlot: number | null = null;
          let solanaStatus: 'online' | 'syncing' | 'offline' = 'offline';
          
          if (data.rpc_url) {
            try {
              const rpcResponse = await fetch(data.rpc_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 1,
                  method: 'getSlot',
                }),
              });
              const rpcResult = await rpcResponse.json();
              if (rpcResult.result) {
                solanaSlot = rpcResult.result;
                solanaStatus = 'online';
              }
            } catch (e) {
              solanaStatus = 'syncing';
            }
          }

          setStatus({
            solana: {
              slot: solanaSlot,
              status: solanaStatus,
            },
            light: {
              status: data.light?.compressionEnabled ? 'real' : data.light ? 'simulation' : 'offline',
              compressionEnabled: data.light?.compressionEnabled || false,
            },
            payai: {
              status: data.payai?.url ? 'online' : 'offline',
            },
          });
        }
      } catch (error) {
        // Network offline
        setStatus({
          solana: { slot: null, status: 'offline' },
          light: { status: 'offline', compressionEnabled: false },
          payai: { status: 'offline' },
        });
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    if (status === 'online' || status === 'real') return 'text-emerald-400';
    if (status === 'syncing' || status === 'simulation') return 'text-amber-400';
    return 'text-slate-600';
  };

  const getStatusDot = (status: string) => {
    const color = getStatusColor(status);
    const isPulsing = status === 'syncing' || status === 'simulation';
    return (
      <div className={`w-1.5 h-1.5 rounded-full ${color.replace('text-', 'bg-')} ${isPulsing ? 'animate-pulse' : ''}`} />
    );
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 border-b border-slate-800 bg-slate-950/95 backdrop-blur-sm">
      <div className="max-w-[1920px] mx-auto px-6 py-2">
        <div className="flex items-center justify-between">
          {/* Left: Network Status */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[10px] font-mono text-slate-600">NETWORK:</span>
              {getStatusDot(status.solana.status)}
              <span className={`text-[10px] font-mono ${getStatusColor(status.solana.status)}`}>
                SOLANA_{status.solana.status.toUpperCase()}
              </span>
              {status.solana.slot && (
                <>
                  <span className="text-slate-800">|</span>
                  <code className="text-[10px] font-mono text-slate-500">
                    SLOT: {status.solana.slot.toLocaleString()}
                  </code>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              {getStatusDot(status.light.status)}
              <span className={`text-[10px] font-mono ${getStatusColor(status.light.status)}`}>
                LIGHT_{status.light.status.toUpperCase()}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {getStatusDot(status.payai.status)}
              <span className={`text-[10px] font-mono ${getStatusColor(status.payai.status)}`}>
                PAYAI_{status.payai.status.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Right: Quick Links */}
          <div className="flex items-center gap-4">
            <a
              href="https://docs.aegix.dev/api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono text-slate-500 hover:text-slate-400 transition-colors flex items-center gap-1"
            >
              API_REF
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href={`${GATEWAY_URL}/api/status`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono text-slate-500 hover:text-slate-400 transition-colors flex items-center gap-1"
            >
              STATUS
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default NetworkStatus;

