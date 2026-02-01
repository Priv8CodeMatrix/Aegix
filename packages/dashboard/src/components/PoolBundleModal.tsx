'use client';

import { useState } from 'react';
import { X, Loader2, Link2, Check, AlertTriangle } from 'lucide-react';
import { Agent, bundleAgentsToPool } from '@/lib/gateway';

interface PoolBundleModalProps {
  agents: Agent[];
  poolId: string;
  poolAddress: string;
  owner: string;
  onClose: () => void;
  onSuccess: () => void;
  onLog?: (level: 'info' | 'success' | 'error' | 'warning', message: string) => void;
}

export function PoolBundleModal({
  agents,
  poolId,
  poolAddress,
  owner,
  onClose,
  onSuccess,
  onLog,
}: PoolBundleModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBundling, setIsBundling] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const toggleAgent = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    const availableIds = availableAgents.map(a => a.id);
    setSelectedIds(availableIds);
  };

  const deselectAll = () => {
    setSelectedIds([]);
  };

  const handleBundle = async () => {
    if (selectedIds.length === 0) return;
    
    setIsBundling(true);
    setError(null);
    onLog?.('info', `BUNDLING ${selectedIds.length} AGENTS TO POOL`);
    
    try {
      const bundleResults = await bundleAgentsToPool(selectedIds, poolId, poolAddress, owner);
      setResults(bundleResults);
      
      const successCount = bundleResults.filter(r => r.success).length;
      onLog?.('success', `BUNDLED ${successCount}/${selectedIds.length} AGENTS`);
      
      if (successCount > 0) {
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1500);
      }
    } catch (err: any) {
      setError(err.message);
      onLog?.('error', `BUNDLE_ERROR: ${err.message}`);
    } finally {
      setIsBundling(false);
    }
  };

  // Agents that don't already have stealth enabled
  const availableAgents = agents.filter(a => !a.stealthSettings?.enabled);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-sm">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-200 font-mono">BUNDLE_AGENTS_TO_POOL</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-sm">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="p-2 border border-slate-800 bg-slate-950">
            <p className="text-[9px] text-slate-500 font-mono mb-1">TARGET_POOL</p>
            <code className="text-[10px] font-mono text-slate-400">{poolAddress.slice(0, 24)}...</code>
          </div>

          {error && (
            <div className="p-2 border border-status-critical/30 bg-status-critical/10 flex items-center gap-2 rounded-sm">
              <AlertTriangle className="w-4 h-4 text-status-critical flex-shrink-0" />
              <span className="text-xs text-status-critical font-mono">{error}</span>
            </div>
          )}

          {results.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-400 font-mono">RESULTS:</p>
              {results.map(r => (
                <div key={r.agentId} className="flex items-center gap-2 text-xs font-mono p-2 border border-slate-800 bg-slate-950 rounded-sm">
                  {r.success ? (
                    <Check className="w-3.5 h-3.5 text-status-success flex-shrink-0" />
                  ) : (
                    <X className="w-3.5 h-3.5 text-status-critical flex-shrink-0" />
                  )}
                  <span className={r.success ? 'text-slate-300' : 'text-status-critical'}>
                    {r.name || r.agentId.slice(0, 12)}
                  </span>
                  {r.success && (
                    <span className="ml-auto text-[9px] text-status-success">LINKED</span>
                  )}
                </div>
              ))}
            </div>
          ) : availableAgents.length === 0 ? (
            <div className="py-8 text-center">
              <Link2 className="w-8 h-8 text-slate-700 mx-auto mb-2" />
              <p className="text-xs text-slate-500 font-mono">ALL_AGENTS_ALREADY_HAVE_POOLS</p>
              <p className="text-[10px] text-slate-600 mt-1">Create new agents or remove existing pool links first</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500 font-mono">
                  Select agents to share this pool:
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={selectAll}
                    className="text-[10px] text-status-info font-mono hover:underline"
                  >
                    SELECT_ALL
                  </button>
                  <span className="text-slate-600">|</span>
                  <button
                    onClick={deselectAll}
                    className="text-[10px] text-slate-500 font-mono hover:underline"
                  >
                    CLEAR
                  </button>
                </div>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {availableAgents.map(agent => (
                  <button
                    key={agent.id}
                    onClick={() => toggleAgent(agent.id)}
                    className={`w-full p-2 border text-left flex items-center gap-2 transition-colors rounded-sm ${
                      selectedIds.includes(agent.id)
                        ? 'border-status-info bg-status-info/10'
                        : 'border-slate-700 bg-slate-950 hover:border-slate-600'
                    }`}
                  >
                    <div className={`w-4 h-4 border flex items-center justify-center rounded-sm ${
                      selectedIds.includes(agent.id)
                        ? 'border-status-info bg-status-info'
                        : 'border-slate-600'
                    }`}>
                      {selectedIds.includes(agent.id) && (
                        <Check className="w-3 h-3 text-white" />
                      )}
                    </div>
                    <span className="text-xs font-mono text-slate-300">{agent.name}</span>
                    <span className="ml-auto text-[10px] text-slate-600 font-mono">
                      {agent.status}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {results.length === 0 && availableAgents.length > 0 && (
            <button
              onClick={handleBundle}
              disabled={selectedIds.length === 0 || isBundling}
              className="w-full py-2.5 bg-status-info text-white text-xs font-mono disabled:opacity-50 flex items-center justify-center gap-2 rounded-sm"
            >
              {isBundling ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  BUNDLING...
                </>
              ) : (
                <>
                  <Link2 className="w-3.5 h-3.5" />
                  BUNDLE_{selectedIds.length}_AGENTS
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default PoolBundleModal;

