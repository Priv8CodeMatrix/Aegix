'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  X,
  Lock,
  Unlock,
  Activity,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  AlertCircle,
  RefreshCw,
  Shield,
  Clock,
  ArrowRight,
  Zap,
  ChevronDown,
  ChevronRight,
  DollarSign,
} from 'lucide-react';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';

interface AuditTrailProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TransactionRecord {
  signature: string;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'failed';
  feeSol?: number;
  feeLamports?: number;
  solscanUrl: string;
}

interface PaymentSession {
  sessionId: string;
  method: 'gasless' | 'direct';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  stealthPoolAddress: string;
  burnerAddress: string;
  recipientAddress: string;
  totalUsdcMicros: number;
  totalUsdcDisplay: string;
  solFunded: number;
  solRecovered: number;
  netSolCost: number;
  fees: {
    totalFeesSol: number;
    totalFeesLamports: number;
    byTransaction: Record<string, number>;
  };
  chainOfCustody: {
    burnerBirth: number;
    burnerDeath: number | null;
    lifespanSeconds: number;
  };
  transactions: {
    tx1_funding_sol?: TransactionRecord;
    tx2_funding_usdc?: TransactionRecord;
    tx3_payment?: TransactionRecord;
    tx4_recovery?: TransactionRecord;
  };
  fheHandle?: string;
  createdAt: number;
  completedAt?: number;
  feePayer?: string;
}

interface EncryptedSession {
  sessionId: string;
  fheHandle: string;
  createdAt: number;
  status: string;
  method: string;
  txCount: number;
}

export function AuditTrail({ isOpen, onClose }: AuditTrailProps) {
  const { publicKey, signMessage, connected } = useWallet();
  
  const [encryptedSessions, setEncryptedSessions] = useState<EncryptedSession[]>([]);
  const [decryptedSessions, setDecryptedSessions] = useState<Map<string, PaymentSession>>(new Map());
  const [decryptedAll, setDecryptedAll] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [fheMode, setFheMode] = useState<string>('SIMULATION');

  // Load sessions on open
  useEffect(() => {
    if (isOpen && publicKey) {
      loadSessions();
    }
  }, [isOpen, publicKey]);

  const loadSessions = async () => {
    if (!publicKey) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${GATEWAY_URL}/api/credits/sessions/${publicKey.toBase58()}`);
      const result = await response.json();
      
      if (result.success) {
        setEncryptedSessions(result.data.sessions || []);
        setFheMode(result.data.fheMode || 'SIMULATION');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load sessions');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadSessions();
    setIsRefreshing(false);
  };

  const handleDecryptAll = async () => {
    if (!publicKey || !signMessage) return;
    
    setIsDecrypting(true);
    setError(null);
    
    try {
      const message = `AEGIX_DECRYPT_SESSIONS::${publicKey.toBase58()}::${Date.now()}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signature = await signMessage(encodedMessage);
      const signatureBase64 = Buffer.from(signature).toString('base64');
      
      const response = await fetch(`${GATEWAY_URL}/api/credits/sessions/${publicKey.toBase58()}/decrypt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature: signatureBase64,
          message,
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        const newDecrypted = new Map<string, PaymentSession>();
        for (const session of result.data.sessions) {
          newDecrypted.set(session.sessionId, session);
        }
        setDecryptedSessions(newDecrypted);
        setDecryptedAll(true);
      } else {
        throw new Error(result.error || 'Decryption failed');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsDecrypting(false);
    }
  };

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getSessionDisplay = (encrypted: EncryptedSession): PaymentSession | null => {
    return decryptedSessions.get(encrypted.sessionId) || null;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-700 overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 border border-slate-700 flex items-center justify-center">
              <Activity className="w-4 h-4 text-slate-400" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-slate-100">PAYMENT_AUDIT_TRAIL</h2>
              <p className="text-[10px] font-mono text-slate-500">
                Full lifecycle tracking: Pool → Burner → Recipient → Cleanup
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 hover:bg-slate-800 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4 text-slate-500" />
            </button>
          </div>
        </div>
        
        {/* FHE Status Bar */}
        <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[10px] font-mono text-slate-400">
              FHE_MODE: <span className={fheMode === 'REAL' ? 'text-status-success' : 'text-status-warning'}>{fheMode}</span>
            </span>
          </div>
          <span className="text-[10px] font-mono text-slate-500">
            {encryptedSessions.length} session{encryptedSessions.length !== 1 ? 's' : ''} found
          </span>
        </div>
        
        {/* Decrypt Button */}
        {!decryptedAll && encryptedSessions.length > 0 && (
          <div className="px-4 py-3 border-b border-slate-700">
            <button
              onClick={handleDecryptAll}
              disabled={isDecrypting || !connected}
              className="w-full py-2 bg-status-info text-white text-xs font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isDecrypting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  DECRYPTING_SESSIONS...
                </>
              ) : (
                <>
                  <Unlock className="w-3.5 h-3.5" />
                  SIGN_TO_DECRYPT_ALL
                </>
              )}
            </button>
          </div>
        )}
        
        {/* Error */}
        {error && (
          <div className="mx-4 mt-3 p-2 border border-status-critical/30 bg-status-critical/10 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-status-critical" />
            <span className="text-xs text-status-critical font-mono">{error}</span>
          </div>
        )}
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
              <span className="text-xs text-slate-500 font-mono">LOADING_SESSIONS...</span>
            </div>
          ) : encryptedSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Activity className="w-10 h-10 text-slate-600" />
              <p className="text-xs text-slate-500 font-mono">NO_SESSIONS_RECORDED</p>
              <p className="text-[10px] text-slate-600">Sessions are logged when you make pool payments</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {encryptedSessions.map((encrypted) => {
                const session = getSessionDisplay(encrypted);
                const isExpanded = expandedSessionId === encrypted.sessionId;
                
                return (
                  <div key={encrypted.sessionId} className="bg-slate-950">
                    {/* Session Row */}
                    <div
                      onClick={() => session && setExpandedSessionId(isExpanded ? null : encrypted.sessionId)}
                      className={`px-4 py-3 ${session ? 'cursor-pointer hover:bg-slate-900/50' : ''} transition-colors`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {session ? (
                            isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                            )
                          ) : (
                            <Lock className="w-3.5 h-3.5 text-slate-600" />
                          )}
                          
                          <div>
                            <div className="flex items-center gap-2 mb-0.5">
                              <code className="text-xs font-mono text-slate-400">
                                {encrypted.sessionId.slice(0, 16)}...
                              </code>
                              <span className={`px-1.5 py-0.5 text-[9px] font-mono ${
                                encrypted.status === 'completed' ? 'text-status-success bg-status-success/10' :
                                encrypted.status === 'failed' ? 'text-status-critical bg-status-critical/10' :
                                'text-status-warning bg-status-warning/10'
                              }`}>
                                {encrypted.status.toUpperCase()}
                              </span>
                              <span className={`px-1.5 py-0.5 text-[9px] font-mono ${
                                encrypted.method === 'gasless'
                                  ? 'text-status-success bg-status-success/10'
                                  : 'text-slate-400 bg-slate-800'
                              }`}>
                                {encrypted.method === 'gasless' ? 'x402' : 'DIRECT'}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500">
                              {new Date(encrypted.createdAt).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        
                        {session && !isExpanded && (
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <span className="text-xs font-mono text-status-success block">
                                {session.totalUsdcDisplay} USDC
                              </span>
                              <span className="text-[10px] text-slate-500">
                                Net: {session.netSolCost.toFixed(6)} SOL
                              </span>
                            </div>
                          </div>
                        )}
                        
                        {!session && (
                          <div className="text-right">
                            <code className="text-[10px] font-mono text-slate-600">
                              {encrypted.fheHandle.slice(0, 20)}...
                            </code>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Expanded Details */}
                    {isExpanded && session && (
                      <div className="px-4 pb-4 pt-2 bg-slate-900/30 border-t border-slate-800">
                        <div className="grid grid-cols-2 gap-6">
                          {/* Left Column: Transaction Flow */}
                          <div>
                            <h4 className="text-[10px] font-mono text-slate-500 mb-3 uppercase tracking-wider">
                              4-TX_LIFECYCLE
                            </h4>
                            <div className="space-y-2">
                              <TxRow
                                step={1}
                                label="FUNDING_SOL_ATA"
                                tx={session.transactions.tx1_funding_sol}
                                onCopy={handleCopy}
                                copiedId={copiedId}
                              />
                              <TxRow
                                step={2}
                                label="TOKEN_TRANSFER"
                                tx={session.transactions.tx2_funding_usdc}
                                onCopy={handleCopy}
                                copiedId={copiedId}
                              />
                              <TxRow
                                step={3}
                                label="x402_EXECUTION"
                                tx={session.transactions.tx3_payment}
                                highlight
                                onCopy={handleCopy}
                                copiedId={copiedId}
                              />
                              <TxRow
                                step={4}
                                label="SOL_RECOVERY"
                                tx={session.transactions.tx4_recovery}
                                onCopy={handleCopy}
                                copiedId={copiedId}
                              />
                            </div>
                          </div>
                          
                          {/* Right Column: Addresses & Stats */}
                          <div className="space-y-4">
                            {/* Amount & Method */}
                            <div className="grid grid-cols-2 gap-3">
                              <div className="p-2 bg-slate-800 border border-slate-700">
                                <span className="text-[9px] text-slate-500 block mb-1">AMOUNT</span>
                                <span className="text-lg font-mono text-status-success">
                                  {session.totalUsdcDisplay} USDC
                                </span>
                              </div>
                              <div className="p-2 bg-slate-800 border border-slate-700">
                                <span className="text-[9px] text-slate-500 block mb-1">NET_GAS</span>
                                <span className="text-lg font-mono text-status-warning">
                                  {session.netSolCost.toFixed(6)}
                                </span>
                              </div>
                            </div>
                            
                            {/* Addresses */}
                            <div className="space-y-2">
                              <AddressRow
                                label="STEALTH_POOL"
                                address={session.stealthPoolAddress}
                                onCopy={handleCopy}
                                copiedId={copiedId}
                              />
                              <div className="flex justify-center">
                                <ArrowRight className="w-3 h-3 text-slate-600" />
                              </div>
                              <AddressRow
                                label="EPHEMERAL_BURNER"
                                address={session.burnerAddress}
                                ephemeral
                                onCopy={handleCopy}
                                copiedId={copiedId}
                              />
                              <div className="flex justify-center">
                                <ArrowRight className="w-3 h-3 text-slate-600" />
                              </div>
                              <AddressRow
                                label="RECIPIENT"
                                address={session.recipientAddress}
                                highlight
                                onCopy={handleCopy}
                                copiedId={copiedId}
                              />
                            </div>
                            
                            {/* Chain of Custody */}
                            <div className="p-2 bg-slate-800 border border-slate-700">
                              <span className="text-[9px] text-slate-500 block mb-2">CHAIN_OF_CUSTODY</span>
                              <div className="grid grid-cols-3 gap-2 text-center">
                                <div>
                                  <span className="text-[9px] text-slate-500 block">BIRTH</span>
                                  <span className="text-[10px] font-mono text-slate-400">
                                    {session.chainOfCustody.burnerBirth
                                      ? new Date(session.chainOfCustody.burnerBirth).toLocaleTimeString()
                                      : '-'}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[9px] text-slate-500 block">DEATH</span>
                                  <span className="text-[10px] font-mono text-slate-400">
                                    {session.chainOfCustody.burnerDeath
                                      ? new Date(session.chainOfCustody.burnerDeath).toLocaleTimeString()
                                      : '-'}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[9px] text-slate-500 block">LIFESPAN</span>
                                  <span className="text-[10px] font-mono text-status-success">
                                    {session.chainOfCustody.lifespanSeconds || 0}s
                                  </span>
                                </div>
                              </div>
                            </div>
                            
                            {/* SOL Flow */}
                            <div className="p-2 bg-slate-800 border border-slate-700">
                              <span className="text-[9px] text-slate-500 block mb-2">SOL_FLOW</span>
                              <div className="flex items-center justify-between text-xs">
                                <div className="text-center">
                                  <span className="text-[9px] text-slate-500 block">FUNDED</span>
                                  <span className="font-mono text-status-critical">-{session.solFunded.toFixed(6)}</span>
                                </div>
                                <ArrowRight className="w-3 h-3 text-slate-600" />
                                <div className="text-center">
                                  <span className="text-[9px] text-slate-500 block">RECOVERED</span>
                                  <span className="font-mono text-status-success">+{session.solRecovered.toFixed(6)}</span>
                                </div>
                                <ArrowRight className="w-3 h-3 text-slate-600" />
                                <div className="text-center">
                                  <span className="text-[9px] text-slate-500 block">NET</span>
                                  <span className="font-mono text-status-warning">{session.netSolCost.toFixed(6)}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-700 bg-slate-950">
          <p className="text-[9px] font-mono text-slate-600 text-center">
            Protected by Light Protocol ZK Compression • Maximum Privacy
          </p>
        </div>
      </div>
    </div>
  );
}

// Helper Components
function TxRow({
  step,
  label,
  tx,
  highlight,
  onCopy,
  copiedId,
}: {
  step: number;
  label: string;
  tx?: TransactionRecord;
  highlight?: boolean;
  onCopy: (text: string, id: string) => void;
  copiedId: string | null;
}) {
  if (!tx) {
    return (
      <div className="flex items-center gap-2 p-2 bg-slate-800/50 border border-slate-700/50 opacity-50">
        <div className="w-5 h-5 flex items-center justify-center text-[10px] font-mono text-slate-600 border border-slate-700">
          {step}
        </div>
        <span className="text-[10px] text-slate-600 font-mono">{label}</span>
        <span className="text-[9px] text-slate-600 ml-auto">SKIPPED</span>
      </div>
    );
  }
  
  return (
    <div className={`flex items-center gap-2 p-2 border ${
      highlight ? 'bg-status-success/5 border-status-success/30' : 'bg-slate-800/50 border-slate-700/50'
    }`}>
      <div className={`w-5 h-5 flex items-center justify-center text-[10px] font-mono border ${
        highlight ? 'text-status-success border-status-success/50' : 'text-slate-500 border-slate-600'
      }`}>
        {step}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[10px] text-slate-400 font-mono block">{label}</span>
        <code className="text-[9px] text-slate-500 font-mono truncate block">
          {tx.signature.slice(0, 20)}...
        </code>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy(tx.signature, `tx-${tx.signature.slice(0, 8)}`);
          }}
          className="p-1 hover:bg-slate-700 transition-colors"
        >
          {copiedId === `tx-${tx.signature.slice(0, 8)}` ? (
            <Check className="w-3 h-3 text-status-success" />
          ) : (
            <Copy className="w-3 h-3 text-slate-500" />
          )}
        </button>
        <a
          href={tx.solscanUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="p-1 hover:bg-slate-700 transition-colors"
        >
          <ExternalLink className="w-3 h-3 text-status-info" />
        </a>
      </div>
    </div>
  );
}

function AddressRow({
  label,
  address,
  ephemeral,
  highlight,
  onCopy,
  copiedId,
}: {
  label: string;
  address: string;
  ephemeral?: boolean;
  highlight?: boolean;
  onCopy: (text: string, id: string) => void;
  copiedId: string | null;
}) {
  return (
    <div className={`p-2 border ${
      highlight ? 'bg-status-success/5 border-status-success/30' :
      ephemeral ? 'bg-status-warning/5 border-status-warning/30' :
      'bg-slate-800/50 border-slate-700/50'
    }`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] text-slate-500 font-mono">{label}</span>
        {ephemeral && <span className="text-[8px] text-status-warning px-1 bg-status-warning/10">EPHEMERAL</span>}
      </div>
      <div className="flex items-center gap-1">
        <code className={`text-[10px] font-mono flex-1 truncate ${
          highlight ? 'text-status-success' : 'text-slate-300'
        }`}>
          {address}
        </code>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy(address, `addr-${address.slice(0, 8)}`);
          }}
          className="p-1 hover:bg-slate-700 transition-colors"
        >
          {copiedId === `addr-${address.slice(0, 8)}` ? (
            <Check className="w-3 h-3 text-status-success" />
          ) : (
            <Copy className="w-3 h-3 text-slate-500" />
          )}
        </button>
        <a
          href={`https://solscan.io/account/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="p-1 hover:bg-slate-700 transition-colors"
        >
          <ExternalLink className="w-3 h-3 text-status-info" />
        </a>
      </div>
    </div>
  );
}
