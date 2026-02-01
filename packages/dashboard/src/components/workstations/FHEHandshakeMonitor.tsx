'use client';

import { useState, useEffect } from 'react';
import { Terminal, Loader2 } from 'lucide-react';
import { useGateway } from '@/hooks/useGateway';

// Fallback if gateway context not available
const getDefaultAuditLog = () => [];
const getDefaultFheMode = () => false;

interface FHELog {
  id: string;
  timestamp: string;
  handle: string;
  operation: string;
  status: 'pending' | 'mapped' | 'decrypted';
}

export function FHEHandshakeMonitor() {
  let auditLog: any[] = [];
  let fheMode = false;
  
  try {
    const gateway = useGateway();
    auditLog = gateway.auditLog || [];
    fheMode = gateway.fheMode || false;
  } catch (error) {
    // Gateway context not available - use defaults
    auditLog = [];
    fheMode = false;
  }
  const [logs, setLogs] = useState<FHELog[]>([]);

  useEffect(() => {
    // Map audit log entries to FHE handshake logs
    const fheLogs: FHELog[] = auditLog
      .filter((entry) => entry.fheHandle)
      .slice(-10) // Last 10 FHE operations
      .reverse()
      .map((entry, idx) => ({
        id: entry.id || `log-${idx}`,
        timestamp: new Date(entry.timestamp || Date.now()).toISOString().split('T')[1].split('.')[0],
        handle: entry.fheHandle?.slice(0, 16) + '...' || '0x0000...0000',
        operation: entry.type || 'UNKNOWN',
        status: entry.fheHandle ? 'mapped' : 'pending',
      }));

    setLogs(fheLogs);
  }, [auditLog]);

  return (
    <div className="border border-slate-800 bg-slate-950 h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-xs font-mono text-slate-400">FHE_HANDSHAKE_MONITOR</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${fheMode ? 'bg-emerald-500' : 'bg-slate-600'}`} />
          <span className="text-[10px] font-mono text-slate-600">
            {fheMode ? 'LIGHT_ZK_ACTIVE' : 'INACTIVE'}
          </span>
        </div>
      </div>

      {/* Terminal Content */}
      <div className="flex-1 p-4 overflow-y-auto space-y-2 font-mono text-xs">
        {logs.length > 0 ? (
          logs.map((log) => (
            <div key={log.id} className="flex items-start gap-3 text-[11px]">
              <span className="text-slate-600 w-16 flex-shrink-0 font-mono">{log.timestamp}</span>
              <span className="text-purple-400 font-mono">{log.handle}</span>
              <span className="text-slate-400 flex-1 font-mono">{log.operation}</span>
              <span className={`font-mono ${
                log.status === 'mapped' ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                {log.status === 'mapped' ? 'MAPPED' : 'PENDING'}
              </span>
            </div>
          ))
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader2 className="w-5 h-5 text-slate-600 mx-auto mb-2 animate-spin" />
              <p className="text-[10px] font-mono text-slate-600">WAITING_FOR_FHE_EVENTS</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-slate-800 bg-slate-900/30">
        <div className="flex items-center justify-between text-[10px] font-mono text-slate-600">
          <span>LIGHT_PROTOCOL_ZK</span>
          <span>{logs.length} HANDLES</span>
        </div>
      </div>
    </div>
  );
}

export default FHEHandshakeMonitor;
