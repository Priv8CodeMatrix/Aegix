'use client';

import { useState, useCallback, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { 
  X, Lock, Unlock, Loader2, Shield, AlertCircle, 
  ExternalLink, CheckCircle, Copy, Check, DollarSign, ChevronDown
} from 'lucide-react';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';

interface AuditEntry {
  id: string;
  type: string;
  amount?: string;
  timestamp: string;
  fheHandle?: string;
  txSignature?: string;
  service?: string;
  agentId?: string;
  decrypted?: boolean;
  // Pool payment specific fields
  stealthPoolAddress?: string;
  recipient?: string;
  tempBurner?: string;
  solRecovered?: number;
  method?: string;
  feePayer?: string;
  paymentFlow?: {
    setupTx?: string;
    usdcTransferTx?: string;
    paymentTx?: string;
    recoveryTx?: string;
  };
}

interface DecryptionViewProps {
  isOpen: boolean;
  onClose: () => void;
  auditLog: AuditEntry[];
}

export function DecryptionView({ isOpen, onClose, auditLog }: DecryptionViewProps) {
  const { publicKey, signMessage, connected } = useWallet();
  const [activeTab, setActiveTab] = useState<'all' | 'agents'>('all');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptedAll, setDecryptedAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [fheMode, setFheMode] = useState<string>('UNKNOWN');
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  // Update entries when auditLog changes, but preserve decryption state
  useEffect(() => {
    setEntries(prevEntries => {
      // If we already have entries and they're decrypted, preserve the decrypted data
      if (prevEntries.length > 0 && decryptedAll) {
        return prevEntries;
      }
      return auditLog.map(e => ({ ...e, decrypted: false }));
    });
    // Don't reset decryptedAll here - only reset when modal closes
  }, [auditLog, decryptedAll]);

  // Reset decryption state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setDecryptedAll(false);
      setExpandedEntryId(null);
      // Reset entries to encrypted state when modal closes
      setEntries(auditLog.map(e => ({ ...e, decrypted: false })));
    }
  }, [isOpen, auditLog]);

  // Filter entries by tab
  const filteredEntries = entries.filter(e => {
    if (activeTab === 'agents') {
      return e.type.includes('agent') || e.agentId;
    }
    return true; // 'all' shows everything
  });

  // Decrypt all entries with wallet signature
  const handleDecryptAll = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setError('Wallet not connected or does not support signing');
      return;
    }

    setIsDecrypting(true);
    setError(null);

    try {
      // Create signature message
      const nonce = Math.random().toString(36).substring(7);
      const timestamp = new Date().toISOString();
      const message = `Decrypt ALL Aegix payment data\nOwner: ${publicKey.toBase58()}\nTimestamp: ${timestamp}\nNonce: ${nonce}`;
      
      // Sign with wallet - this triggers the wallet popup
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);
      const signatureBase64 = Buffer.from(signature).toString('base64');

      // Send to gateway for batch decryption
      const response = await fetch(`${GATEWAY_URL}/api/credits/decrypt-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          signature: signatureBase64,
          message,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Batch decryption failed');
      }

      // Set FHE mode from response
      if (result.fhe?.mode) {
        setFheMode(result.fhe.mode);
      }

      // Update entries with decrypted data
      if (result.data?.entries && Array.isArray(result.data.entries)) {
        console.log('[DecryptionView] Received entries:', result.data.entries);
        console.log('[DecryptionView] First entry amount:', result.data.entries[0]?.amount);
        console.log('[DecryptionView] First entry type:', result.data.entries[0]?.type);
        console.log('[DecryptionView] First entry method:', result.data.entries[0]?.method);
        
        setEntries(result.data.entries.map((e: AuditEntry) => ({
          ...e,
          decrypted: true,
        })));
        setDecryptedAll(true);
      }

    } catch (err: any) {
      console.error('[Decrypt] Error:', err);
      if (err.message?.includes('User rejected') || err.message?.includes('rejected')) {
        setError('Signature request was rejected');
      } else {
        setError(err.message || 'Failed to decrypt');
      }
    } finally {
      setIsDecrypting(false);
    }
  }, [publicKey, signMessage]);

  // Copy to clipboard
  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[#111111] border border-[#1a1a1a] rounded-2xl shadow-2xl max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#1a1a1a]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#1a1a1a] border border-[#222222]">
              <Shield className="w-5 h-5 text-[#444444]" />
            </div>
            <div>
              <h2 className="font-semibold text-lg text-[#fafafa]">Decryption Center</h2>
              <p className="text-xs text-[#444444]">Sign to decrypt your FHE-protected payment data</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#1a1a1a] transition-colors">
            <X className="w-5 h-5 text-[#666666]" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#1a1a1a]">
          <button
            onClick={() => setActiveTab('all')}
            className={`flex-1 py-3.5 px-4 text-sm font-medium transition-colors ${
              activeTab === 'all'
                ? 'text-[#fafafa] border-b-2 border-[#fafafa] -mb-px'
                : 'text-[#444444] hover:text-[#666666]'
            }`}
          >
            <Lock className="w-4 h-4 inline mr-2" />
            All Payments ({entries.length})
          </button>
          <button
            onClick={() => setActiveTab('agents')}
            className={`flex-1 py-3.5 px-4 text-sm font-medium transition-colors ${
              activeTab === 'agents'
                ? 'text-[#fafafa] border-b-2 border-[#fafafa] -mb-px'
                : 'text-[#444444] hover:text-[#666666]'
            }`}
          >
            <Shield className="w-4 h-4 inline mr-2" />
            Agent Payments
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Error */}
          {error && (
            <div className="mb-4 p-3.5 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/20 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-[#ef4444] flex-shrink-0" />
              <span className="text-sm text-[#ef4444]">{error}</span>
            </div>
          )}

          {/* Decrypt Button */}
          {!decryptedAll && filteredEntries.length > 0 && (
            <button
              onClick={handleDecryptAll}
              disabled={isDecrypting || !connected || !signMessage}
              className="w-full mb-4 py-3.5 px-4 rounded-lg bg-[#0066ff] 
                         text-white font-medium hover:bg-[#0052cc] 
                         transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isDecrypting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Signing & Decrypting...
                </>
              ) : (
                <>
                  <Unlock className="w-5 h-5" />
                  Sign Message to Decrypt All ({filteredEntries.length} entries)
                </>
              )}
            </button>
          )}

          {/* Decrypted Status */}
          {decryptedAll && (
            <div className="mb-4 p-3.5 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-[#10b981]" />
              <span className="text-sm text-[#10b981]">
                ✓ Data decrypted successfully • FHE Mode: {fheMode}
              </span>
            </div>
          )}

          {/* Entries List */}
          {filteredEntries.length === 0 ? (
            <div className="text-center py-12">
              <Lock className="w-12 h-12 mx-auto mb-3 text-[#222222]" />
              <p className="text-[#444444]">No payment data found</p>
              <p className="text-xs text-[#333333] mt-1">Make a stealth payment to create encrypted entries</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredEntries.map((entry) => {
                const isExpanded = expandedEntryId === entry.id;
                const isDecrypted = entry.decrypted || decryptedAll;
                
                return (
                  <div
                    key={entry.id}
                    onClick={() => isDecrypted && setExpandedEntryId(isExpanded ? null : entry.id)}
                    className={`p-4 rounded-xl border transition-all ${
                      isDecrypted
                        ? 'bg-[#0a0a0a] border-[#10b981]/20 hover:border-[#10b981]/40 cursor-pointer'
                        : 'bg-[#111111] border-[#1a1a1a]'
                    }`}
                  >
                    {/* Entry Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {isDecrypted ? (
                          <Unlock className="w-4 h-4 text-[#10b981]" />
                        ) : (
                          <Lock className="w-4 h-4 text-[#444444]" />
                        )}
                        <span className="font-medium text-sm text-[#fafafa]">{entry.type}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          isDecrypted
                            ? 'bg-[#10b981]/20 text-[#10b981]'
                            : 'bg-[#1a1a1a] text-[#444444]'
                        }`}>
                          {isDecrypted ? 'DECRYPTED' : 'ENCRYPTED'}
                        </span>
                        {/* Method badge for pool payments (collapsed view) */}
                        {isDecrypted && entry.type === 'pool_payment' && !isExpanded && (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                            entry.method === 'gasless' 
                              ? 'bg-[#10b981]/20 text-[#10b981]' 
                              : 'bg-[#1a1a1a] text-[#666666]'
                          }`}>
                            {entry.method === 'gasless' ? '⚡ GASLESS' : '💸 DIRECT'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[#444444]">
                          {formatTimeAgo(entry.timestamp)}
                        </span>
                        {isDecrypted && (
                          <ChevronDown className={`w-4 h-4 text-[#444444] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                        )}
                      </div>
                    </div>

                    {/* PROMINENT AMOUNT DISPLAY - Always visible when decrypted (pool_payment) */}
                    {isDecrypted && entry.type === 'pool_payment' && (
                      <div className="mb-3 p-3.5 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <DollarSign className="w-5 h-5 text-[#10b981]" />
                            <span className="text-lg font-bold font-mono text-[#10b981]">
                              {entry.amount ? (parseFloat(entry.amount) / 1_000_000).toFixed(4) : '0.0000'} USDC
                            </span>
                          </div>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            entry.method === 'gasless' 
                              ? 'bg-[#10b981]/30 text-[#10b981]' 
                              : 'bg-[#1a1a1a] text-[#666666]'
                          }`}>
                            {entry.method === 'gasless' ? '⚡ GASLESS' : '💸 DIRECT'}
                          </span>
                        </div>
                        {entry.solRecovered && entry.solRecovered > 0 && (
                          <p className="text-xs text-[#f59e0b] mt-1.5">+{entry.solRecovered.toFixed(6)} SOL recovered</p>
                        )}
                      </div>
                    )}

                    {/* Collapsed View - Basic info */}
                    {!isExpanded && (
                      <div className="space-y-2">
                        {/* Amount - Always visible after decryption for ANY entry with amount */}
                        {isDecrypted && entry.type !== 'pool_payment' && (
                          <div className="flex items-center gap-2 p-3 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a]">
                            <DollarSign className="w-4 h-4 text-[#10b981]" />
                            <span className="text-sm text-[#666666]">Amount:</span>
                            <span className="font-bold font-mono text-[#10b981]">
                              {entry.amount 
                                ? `${(parseFloat(entry.amount) / 1_000_000).toFixed(4)} USDC`
                                : 'N/A'
                              }
                            </span>
                          </div>
                        )}

                        {/* FHE Handle - Shown when not decrypted */}
                        {!isDecrypted && entry.fheHandle && (
                          <div className="p-3 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a]">
                            <p className="text-[10px] text-[#444444] mb-1">FHE Handle (encrypted)</p>
                            <code className="text-xs text-[#666666] font-mono break-all">
                              {entry.fheHandle.slice(0, 60)}...
                            </code>
                          </div>
                        )}

                        {/* Transaction Link (collapsed) */}
                        {entry.txSignature && (
                          <div className="flex items-center justify-between p-3 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a]">
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] text-[#444444] mb-1">Transaction</p>
                              <code className="text-xs text-[#666666] font-mono truncate block">
                                {entry.txSignature.slice(0, 32)}...
                              </code>
                            </div>
                            <div className="flex items-center gap-1 ml-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCopy(entry.txSignature!, entry.id + '-tx'); }}
                                className="p-1.5 rounded hover:bg-[#1a1a1a] transition-colors"
                              >
                                {copiedId === entry.id + '-tx' ? (
                                  <Check className="w-3.5 h-3.5 text-[#10b981]" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5 text-[#444444]" />
                                )}
                              </button>
                              <a
                                href={`https://solscan.io/tx/${entry.txSignature}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="p-1.5 rounded hover:bg-[#1a1a1a] transition-colors"
                              >
                                <ExternalLink className="w-3.5 h-3.5 text-[#0066ff]" />
                              </a>
                            </div>
                          </div>
                        )}

                        {/* Service info if available */}
                        {entry.service && (
                          <div className="p-3 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a]">
                            <p className="text-[10px] text-[#444444] mb-1">Service</p>
                            <p className="text-sm text-[#a1a1a1]">{entry.service}</p>
                          </div>
                        )}

                        {/* Click to expand hint */}
                        {isDecrypted && entry.type === 'pool_payment' && (
                          <p className="text-[10px] text-[#333333] text-center mt-2">Click to view full transaction flow</p>
                        )}
                      </div>
                    )}

                    {/* Expanded View - Full details */}
                    {isExpanded && isDecrypted && (
                      <div className="space-y-4">
                        {/* Transaction Summary Header */}
                        <div className="flex items-center justify-between pt-2 border-t border-[#1a1a1a]">
                          <h4 className="text-sm font-medium text-[#fafafa]">Transaction Details</h4>
                          <span className="text-xs text-[#444444]">
                            {new Date(entry.timestamp).toLocaleString()}
                          </span>
                        </div>
                        
                        {/* Amount and Method Grid */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="p-3.5 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a]">
                            <p className="text-[10px] text-[#444444] mb-1">Amount</p>
                            <p className="text-lg font-bold font-mono text-[#10b981]">
                              {entry.amount ? (parseFloat(entry.amount) / 1_000_000).toFixed(4) : '0'} USDC
                            </p>
                          </div>
                          <div className="p-3.5 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a]">
                            <p className="text-[10px] text-[#444444] mb-1">Method</p>
                            <p className={`text-sm font-medium ${entry.method === 'gasless' ? 'text-[#10b981]' : 'text-[#666666]'}`}>
                              {entry.method === 'gasless' ? '⚡ PayAI Gasless' : '💸 Direct Transfer'}
                            </p>
                            {entry.solRecovered && entry.solRecovered > 0 && (
                              <p className="text-xs text-[#f59e0b] mt-1">+{entry.solRecovered.toFixed(6)} SOL recovered</p>
                            )}
                          </div>
                        </div>
                        
                        {/* Addresses - Full Flow: Pool → Burner → Recipient */}
                        <div className="space-y-2">
                          {/* Stealth Pool Address */}
                          {entry.stealthPoolAddress && (
                            <div className="flex items-center justify-between p-3.5 rounded-lg bg-[#1a1a1a] border border-[#222222]" onClick={(e) => e.stopPropagation()}>
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] text-[#666666]">Stealth Pool (Source)</p>
                                <code className="text-xs text-[#a1a1a1] font-mono truncate block">{entry.stealthPoolAddress}</code>
                              </div>
                              <a 
                                href={`https://solscan.io/account/${entry.stealthPoolAddress}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="p-2 rounded hover:bg-[#222222] text-[#0066ff] ml-2 transition-colors"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            </div>
                          )}
                          {/* Burner Wallet */}
                          {entry.tempBurner && (
                            <div className="flex items-center justify-between p-3.5 rounded-lg bg-[#111111] border border-[#1a1a1a]" onClick={(e) => e.stopPropagation()}>
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] text-[#444444]">↓ Burner Wallet (ephemeral)</p>
                                <code className="text-xs text-[#666666] font-mono truncate block">{entry.tempBurner}</code>
                              </div>
                              <a 
                                href={`https://solscan.io/account/${entry.tempBurner}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="p-2 rounded hover:bg-[#1a1a1a] text-[#0066ff] ml-2 transition-colors"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            </div>
                          )}
                          {/* Recipient */}
                          {entry.recipient && (
                            <div className="flex items-center justify-between p-3.5 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20" onClick={(e) => e.stopPropagation()}>
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] text-[#10b981]">↓ Recipient (Destination)</p>
                                <code className="text-xs text-[#10b981] font-mono truncate block">{entry.recipient}</code>
                              </div>
                              <a 
                                href={`https://solscan.io/account/${entry.recipient}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="p-2 rounded hover:bg-[#10b981]/20 text-[#0066ff] ml-2 transition-colors"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            </div>
                          )}
                        </div>
                        
                        {/* Transaction Flow Timeline */}
                        {entry.paymentFlow && (
                          <div className="p-4 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a]" onClick={(e) => e.stopPropagation()}>
                            <p className="text-xs font-medium text-[#fafafa] mb-4">Transaction Flow</p>
                            <div className="space-y-4">
                              {entry.paymentFlow.setupTx && (
                                <div className="flex items-center gap-3">
                                  <div className="w-7 h-7 rounded-full bg-[#1a1a1a] flex items-center justify-center text-xs text-[#666666] font-bold flex-shrink-0">1</div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-[#666666]">Setup (SOL + ATA Creation)</p>
                                    <code className="text-[10px] text-[#444444] truncate block">{entry.paymentFlow.setupTx}</code>
                                  </div>
                                  <a 
                                    href={`https://solscan.io/tx/${entry.paymentFlow.setupTx}`} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-[#0066ff] text-xs hover:bg-[#222222] flex-shrink-0 border border-[#222222] transition-colors"
                                  >
                                    View TX
                                  </a>
                                </div>
                              )}
                              {entry.paymentFlow.usdcTransferTx && (
                                <div className="flex items-center gap-3">
                                  <div className="w-7 h-7 rounded-full bg-[#1a1a1a] flex items-center justify-center text-xs text-[#666666] font-bold flex-shrink-0">2</div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-[#666666]">USDC to Burner</p>
                                    <code className="text-[10px] text-[#444444] truncate block">{entry.paymentFlow.usdcTransferTx}</code>
                                  </div>
                                  <a 
                                    href={`https://solscan.io/tx/${entry.paymentFlow.usdcTransferTx}`} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-[#0066ff] text-xs hover:bg-[#222222] flex-shrink-0 border border-[#222222] transition-colors"
                                  >
                                    View TX
                                  </a>
                                </div>
                              )}
                              {entry.paymentFlow.paymentTx && (
                                <div className="flex items-center gap-3">
                                  <div className="w-7 h-7 rounded-full bg-[#10b981]/20 flex items-center justify-center text-xs text-[#10b981] font-bold flex-shrink-0">3</div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-[#666666]">Payment to Recipient {entry.method === 'gasless' ? '(PayAI Gas)' : ''}</p>
                                    <code className="text-[10px] text-[#444444] truncate block">{entry.paymentFlow.paymentTx}</code>
                                  </div>
                                  <a 
                                    href={`https://solscan.io/tx/${entry.paymentFlow.paymentTx}`} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="px-3 py-1.5 rounded-lg bg-[#10b981]/10 text-[#10b981] text-xs hover:bg-[#10b981]/20 flex-shrink-0 border border-[#10b981]/20 transition-colors"
                                  >
                                    View TX
                                  </a>
                                </div>
                              )}
                              {entry.paymentFlow.recoveryTx && (
                                <div className="flex items-center gap-3">
                                  <div className="w-7 h-7 rounded-full bg-[#f59e0b]/20 flex items-center justify-center text-xs text-[#f59e0b] font-bold flex-shrink-0">4</div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-[#666666]">Rent Recovery to Pool</p>
                                    <code className="text-[10px] text-[#444444] truncate block">{entry.paymentFlow.recoveryTx}</code>
                                  </div>
                                  <a 
                                    href={`https://solscan.io/tx/${entry.paymentFlow.recoveryTx}`} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="px-3 py-1.5 rounded-lg bg-[#f59e0b]/10 text-[#f59e0b] text-xs hover:bg-[#f59e0b]/20 flex-shrink-0 border border-[#f59e0b]/20 transition-colors"
                                  >
                                    View TX
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {/* Main TX Link Button */}
                        {entry.txSignature && (
                          <a 
                            href={`https://solscan.io/tx/${entry.txSignature}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center justify-center gap-2 w-full p-3.5 rounded-lg bg-[#1a1a1a] text-[#0066ff] hover:bg-[#222222] border border-[#222222] transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                            View Main Transaction on Solscan
                          </a>
                        )}

                        {/* Service info if available */}
                        {entry.service && (
                          <div className="p-3.5 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a]">
                            <p className="text-[10px] text-[#444444] mb-1">Service</p>
                            <p className="text-sm text-[#a1a1a1]">{entry.service}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#1a1a1a] bg-[#0a0a0a]">
          <p className="text-[11px] text-[#444444] text-center flex items-center justify-center gap-2">
            <Shield className="w-3 h-3" />
            Protected by Light Protocol ZK Compression • Maximum Privacy
          </p>
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
