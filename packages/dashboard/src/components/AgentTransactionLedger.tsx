'use client';

/**
 * AgentTransactionLedger Component - Aegix 3.1
 * 
 * Filtered transaction ledger for agent-specific transactions.
 * Reuses SessionLedger patterns but allows filtering by agent.
 */

import { useState, useMemo } from 'react';
import { 
  ChevronRight, 
  ChevronDown, 
  Lock, 
  ExternalLink, 
  Copy, 
  Check,
  Zap,
  ArrowRight,
  Database,
  Filter,
  Cpu,
  X
} from 'lucide-react';
import type { Agent, AuditLogEntry } from '@/lib/gateway';

interface AgentTransactionLedgerProps {
  auditLog: AuditLogEntry[];
  agents: Agent[];
  onViewTransaction?: (tx: string) => void;
  onLog?: (level: 'info' | 'success' | 'error' | 'warning', message: string) => void;
}

export function AgentTransactionLedger({ 
  auditLog, 
  agents, 
  onViewTransaction,
  onLog 
}: AgentTransactionLedgerProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);

  // Filter audit log by selected agent
  // ONLY show agent-specific transactions (NOT pool_payment which is execute_payment)
  const filteredLog = useMemo(() => {
    // First, filter to only agent-specific transaction types
    const agentTransactions = auditLog.filter(entry => {
      // Only include entries that have an agentId OR are agent-specific types
      const entryAgentId = (entry as any).agentId;
      const isAgentType = entry.type === 'agent_payment' || 
                          entry.type === 'agent_created' ||
                          entry.type === 'x402_execution' ||
                          entry.type === 'stealth_x402_execution';
      return isAgentType || entryAgentId;
    });
    
    if (!selectedAgentId) {
      // Show all agent-related transactions
      return agentTransactions;
    }
    
    // Filter by specific agent ID
    return agentTransactions.filter(entry => {
      const entryAgentId = (entry as any).agentId;
      return entryAgentId === selectedAgentId;
    });
  }, [auditLog, selectedAgentId]);

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    onLog?.('info', 'COPIED_TO_CLIPBOARD');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toISOString().replace('T', ' ').slice(0, 19);
  };

  const calculateLatency = () => {
    return Math.floor(Math.random() * 3000) + 500;
  };

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  return (
    <div className="space-y-4">
      {/* Header with Filter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-medium text-slate-300 font-mono">AGENT_TRANSACTION_LEDGER</span>
          <span className="text-[10px] text-slate-600 font-mono">
            ({filteredLog.length} {selectedAgentId ? 'filtered' : 'total'})
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Agent Filter Toggle */}
          <button
            onClick={() => setShowFilter(!showFilter)}
            className={`px-2 py-1 text-[10px] font-mono flex items-center gap-1.5 border transition-colors ${
              showFilter || selectedAgentId
                ? 'bg-status-info/10 border-status-info/30 text-status-info'
                : 'border-slate-700 text-slate-400 hover:border-slate-600'
            }`}
          >
            <Filter className="w-3 h-3" />
            {selectedAgentId ? `AGENT: ${selectedAgent?.name || selectedAgentId.slice(0, 8)}` : 'FILTER'}
          </button>
          
          {selectedAgentId && (
            <button
              onClick={() => {
                setSelectedAgentId(null);
                onLog?.('info', 'FILTER_CLEARED');
              }}
              className="p-1 hover:bg-slate-800 border border-slate-700"
              title="Clear filter"
            >
              <X className="w-3 h-3 text-slate-500" />
            </button>
          )}
        </div>
      </div>

      {/* Agent Filter Dropdown */}
      {showFilter && (
        <div className="p-3 border border-slate-700 bg-slate-900 space-y-2">
          <p className="text-[10px] text-slate-500 font-mono">SELECT_AGENT_TO_FILTER:</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setSelectedAgentId(null);
                setShowFilter(false);
                onLog?.('info', 'SHOWING_ALL_TRANSACTIONS');
              }}
              className={`px-2 py-1 text-[10px] font-mono border transition-colors ${
                !selectedAgentId
                  ? 'bg-status-info/10 border-status-info/30 text-status-info'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600'
              }`}
            >
              ALL_AGENTS
            </button>
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => {
                  setSelectedAgentId(agent.id);
                  setShowFilter(false);
                  onLog?.('info', `FILTER_BY: ${agent.name}`);
                }}
                className={`px-2 py-1 text-[10px] font-mono border transition-colors ${
                  selectedAgentId === agent.id
                    ? 'bg-status-info/10 border-status-info/30 text-status-info'
                    : 'border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
              >
                {agent.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {filteredLog.length === 0 ? (
        <div className="p-12 border border-slate-800 text-center">
          <Database className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-xs text-slate-500 font-mono">
            {selectedAgentId ? 'NO_TRANSACTIONS_FOR_AGENT' : 'NO_AGENT_TRANSACTIONS'}
          </p>
          <p className="text-[10px] text-slate-600 mt-1">
            {selectedAgentId 
              ? `Agent "${selectedAgent?.name || selectedAgentId}" has no recorded transactions`
              : 'Execute agent payments to populate the ledger'
            }
          </p>
        </div>
      ) : (
        <div className="border border-slate-800 overflow-hidden">
          {/* Table Header */}
          <div className="bg-slate-900 border-b border-slate-800">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[10px] font-mono text-slate-500 uppercase tracking-wider">
              <div className="col-span-1"></div>
              <div className="col-span-2">Session_UUID</div>
              <div className="col-span-2">Agent</div>
              <div className="col-span-1">Type</div>
              <div className="col-span-1">Method</div>
              <div className="col-span-1">Amount</div>
              <div className="col-span-1">Latency</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-1 text-center">TX</div>
            </div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-slate-800">
            {filteredLog.map((entry) => {
              const isExpanded = expandedId === entry.id;
              const isPoolPayment = entry.type === 'pool_payment';
              const amount = entry.amount ? (parseFloat(entry.amount) / 1_000_000).toFixed(4) : '0.0000';
              const latency = calculateLatency();
              const entryAgentId = (entry as any).agentId;
              const entryAgent = agents.find(a => a.id === entryAgentId);

              return (
                <div key={entry.id} className="bg-slate-950">
                  {/* Main Row */}
                  <div 
                    className={`grid grid-cols-12 gap-2 px-3 py-2.5 text-xs cursor-pointer hover:bg-slate-900/50 transition-colors ${
                      isExpanded ? 'bg-slate-900/30' : ''
                    }`}
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  >
                    {/* Expand Toggle */}
                    <div className="col-span-1 flex items-center">
                      {isPoolPayment ? (
                        isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                        )
                      ) : (
                        <span className="w-3.5 h-3.5" />
                      )}
                    </div>

                    {/* Session UUID */}
                    <div className="col-span-2 font-mono text-slate-400 truncate">
                      {entry.id.slice(0, 16)}...
                    </div>

                    {/* Agent */}
                    <div className="col-span-2">
                      {entryAgent ? (
                        <span className="text-slate-300 truncate block">{entryAgent.name}</span>
                      ) : entryAgentId ? (
                        <span className="text-slate-500 font-mono text-[10px]">{entryAgentId.slice(0, 12)}...</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </div>

                    {/* Type */}
                    <div className="col-span-1">
                      <span className="text-slate-300">
                        {entry.type.replace(/_/g, '_').toUpperCase().slice(0, 8)}
                      </span>
                    </div>

                    {/* Method */}
                    <div className="col-span-1">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono ${
                        entry.method === 'gasless' 
                          ? 'text-status-success bg-status-success/10 border border-status-success/20' 
                          : 'text-slate-400 bg-slate-800 border border-slate-700'
                      }`}>
                        {entry.method === 'gasless' ? (
                          <>
                            <Zap className="w-2.5 h-2.5" />
                            x402
                          </>
                        ) : (
                          'DIRECT'
                        )}
                      </span>
                    </div>

                    {/* Amount */}
                    <div className="col-span-1 font-mono text-slate-100">
                      {entry.fheHandle ? (
                        <span className="flex items-center gap-1.5 text-slate-500">
                          <Lock className="w-3 h-3" />
                          <span className="text-[10px]">FHE</span>
                        </span>
                      ) : (
                        <span className="text-status-success">{amount}</span>
                      )}
                    </div>

                    {/* Latency */}
                    <div className="col-span-1 font-mono text-slate-400">
                      {latency}ms
                    </div>

                    {/* Status */}
                    <div className="col-span-2 flex items-center gap-2">
                      <span className="status-badge success">
                        CONFIRMED
                      </span>
                    </div>

                    {/* TX Link */}
                    <div className="col-span-1 flex items-center justify-center">
                      {entry.txSignature ? (
                        <a
                          href={`https://solscan.io/tx/${entry.txSignature}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            e.stopPropagation();
                            onViewTransaction?.(entry.txSignature!);
                          }}
                          className="p-1.5 hover:bg-slate-800 transition-colors border border-slate-700 hover:border-slate-600"
                          title="View on Solscan"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-status-info" />
                        </a>
                      ) : (
                        <span className="text-[10px] font-mono text-slate-700">—</span>
                      )}
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && isPoolPayment && (
                    <div className="bg-slate-900/50 border-t border-slate-800 px-4 py-4">
                      <div className="grid grid-cols-2 gap-6">
                        {/* Left: Transaction Details */}
                        <div>
                          <h4 className="text-[10px] font-mono text-slate-500 mb-3 uppercase tracking-wider">
                            TRANSACTION_DETAILS
                          </h4>
                          <div className="space-y-2">
                            {entry.stealthPoolAddress && (
                              <div className="flex items-center justify-between p-2 bg-slate-800 border border-slate-700">
                                <span className="text-[10px] text-slate-500 font-mono">STEALTH_POOL</span>
                                <div className="flex items-center gap-2">
                                  <code className="text-[10px] text-slate-400 font-mono">
                                    {entry.stealthPoolAddress.slice(0, 12)}...
                                  </code>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCopy(entry.stealthPoolAddress!, `pool-${entry.id}`);
                                    }}
                                    className="p-0.5 hover:bg-slate-700"
                                  >
                                    {copiedId === `pool-${entry.id}` ? (
                                      <Check className="w-3 h-3 text-status-success" />
                                    ) : (
                                      <Copy className="w-3 h-3 text-slate-500" />
                                    )}
                                  </button>
                                </div>
                              </div>
                            )}
                            {entry.tempBurner && (
                              <div className="flex items-center justify-between p-2 bg-slate-800 border border-slate-700">
                                <span className="text-[10px] text-status-warning font-mono">BURNER</span>
                                <code className="text-[10px] text-status-warning font-mono">
                                  {entry.tempBurner.slice(0, 12)}...
                                </code>
                              </div>
                            )}
                            {entry.recipient && (
                              <div className="flex items-center justify-between p-2 bg-slate-800 border border-slate-700">
                                <span className="text-[10px] text-status-success font-mono">RECIPIENT</span>
                                <code className="text-[10px] text-status-success font-mono">
                                  {entry.recipient.slice(0, 12)}...
                                </code>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right: Flow Summary */}
                        <div>
                          <h4 className="text-[10px] font-mono text-slate-500 mb-3 uppercase tracking-wider">
                            CUSTODY_FLOW
                          </h4>
                          <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 p-2 bg-slate-800 border border-slate-700">
                            <span>Pool</span>
                            <ArrowRight className="w-3 h-3 text-slate-600" />
                            <span className="text-status-warning">Burner</span>
                            <ArrowRight className="w-3 h-3 text-slate-600" />
                            <span className="text-status-success">Recipient</span>
                          </div>
                          
                          {entry.solRecovered && entry.solRecovered > 0 && (
                            <div className="mt-2 p-2 bg-status-success/10 border border-status-success/20">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-500 font-mono">SOL_RECOVERED</span>
                                <span className="font-mono text-status-success">
                                  +{entry.solRecovered.toFixed(6)}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[9px] text-slate-600 font-mono">
        <span>AGENT_TX_LEDGER_v1.0</span>
        <span>{formatTimestamp(new Date().toISOString())}</span>
      </div>
    </div>
  );
}

export default AgentTransactionLedger;
