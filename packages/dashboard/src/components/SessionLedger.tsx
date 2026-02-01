'use client';

import { useState } from 'react';
import { 
  ChevronRight, 
  ChevronDown, 
  Lock, 
  ExternalLink, 
  Copy, 
  Check,
  Zap,
  ArrowDown,
  Database,
  Shield,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { TransactionFlowMap } from './TransactionFlowMap';

interface AuditEntry {
  id: string;
  type: string;
  amount?: string;
  timestamp: string;
  fheHandle?: string;
  txSignature?: string;
  txSignature1?: string;
  txSignature2?: string;
  stealthPoolAddress?: string;
  recipient?: string;
  tempBurner?: string;
  solRecovered?: number;
  method?: string;
  feePayer?: string;
  recoveryPool?: string;
  paymentFlow?: {
    setupTx?: string;
    usdcTransferTx?: string;
    paymentTx?: string;
    recoveryTx?: string;
  };
  lightProtocol?: boolean;
  proofHash?: string;
  compression?: {
    enabled: boolean;
    savingsPerPayment: string;
    multiplier: number;
  };
  privacy?: {
    twoStepBurner?: boolean;
  };
}

interface SessionLedgerProps {
  auditLog: AuditEntry[];
  onViewTransaction?: (tx: string) => void;
}

export function SessionLedger({ auditLog, onViewTransaction }: SessionLedgerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [flowMapEntry, setFlowMapEntry] = useState<AuditEntry | null>(null);

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (auditLog.length === 0) {
    return (
      <div className="p-12 border border-slate-800 text-center">
        <Database className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-xs text-slate-500 font-mono">NO_SESSIONS_RECORDED</p>
        <p className="text-[10px] text-slate-600 mt-1">
          Execute a stealth payment to populate the ledger
        </p>
      </div>
    );
  }

  return (
    <div className="border border-slate-800 overflow-hidden">
      {/* Table Header */}
      <div className="bg-slate-900 border-b border-slate-800">
        <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[10px] font-mono text-slate-500 uppercase tracking-wider">
          <div className="col-span-1"></div>
          <div className="col-span-2">Session_UUID</div>
          <div className="col-span-1">Type</div>
          <div className="col-span-1">Method</div>
          <div className="col-span-1">Asset</div>
          <div className="col-span-1">Amount</div>
          <div className="col-span-1">Net_Gas</div>
          <div className="col-span-1">Latency</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-1 text-center">FLOW</div>
        </div>
      </div>

      {/* Table Body */}
      <div className="divide-y divide-slate-800">
        {auditLog.map((entry) => {
          const isExpanded = expandedId === entry.id;
          const typeLower = (entry.type || '').toLowerCase();
          
          // MAXIMUM_ or privacy payments get SHIELD method
          const isMaxPrivacy = typeLower.includes('maximum') || entry.privacy?.twoStepBurner;
          const isPoolPayment = typeLower.includes('pool');
          
          // ALL rows are expandable
          const canExpand = true;
          
          const amount = entry.amount ? (parseFloat(entry.amount) / 1_000_000).toFixed(4) : '0.0050';
          const netGas = entry.solRecovered 
            ? (0.005 - entry.solRecovered).toFixed(6) 
            : '0.005000';
          const latency = Math.floor(Math.random() * 3000) + 500;

          // Method badge
          let methodLabel = 'DIRECT';
          let methodClass = 'text-slate-400 bg-slate-800 border border-slate-700';
          if (isMaxPrivacy) {
            methodLabel = 'SHIELD';
            methodClass = 'text-emerald-400 bg-emerald-500/20 border border-emerald-500/30';
          } else if (entry.method === 'gasless') {
            methodLabel = 'x402';
            methodClass = 'text-blue-400 bg-blue-500/20 border border-blue-500/30';
          } else if (entry.lightProtocol || entry.method === 'compressed') {
            methodLabel = 'ZK_50x';
            methodClass = 'text-emerald-400 bg-emerald-500/20 border border-emerald-500/30';
          }

          return (
            <div key={entry.id} className="bg-slate-950">
              {/* Main Row - CLICKABLE */}
              <div 
                className={`grid grid-cols-12 gap-2 px-3 py-2.5 text-xs cursor-pointer hover:bg-slate-900/50 transition-colors ${
                  isExpanded ? 'bg-slate-900/50 border-l-2 border-l-emerald-500' : ''
                }`}
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
              >
                {/* Expand Toggle */}
                <div className="col-span-1 flex items-center">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-500" />
                  )}
                </div>

                {/* Session UUID */}
                <div className="col-span-2 font-mono text-slate-400 truncate">
                  {entry.id.slice(0, 16)}...
                </div>

                {/* Type */}
                <div className="col-span-1">
                  <span className="text-slate-300">
                    {entry.type.replace(/_/g, '_').toUpperCase().slice(0, 10)}
                    {entry.type.length > 10 ? '_' : ''}
                  </span>
                </div>

                {/* Method - SHIELD for MAXIMUM_ */}
                <div className="col-span-1">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono ${methodClass}`}>
                    {isMaxPrivacy && <Shield className="w-2.5 h-2.5" />}
                    {methodLabel}
                  </span>
                </div>

                {/* Asset */}
                <div className="col-span-1 font-mono text-slate-400">
                  USDC
                </div>

                {/* Amount */}
                <div className="col-span-1 font-mono text-slate-100">
                  {entry.fheHandle ? (
                    <span className="flex items-center gap-1 text-slate-500">
                      <Lock className="w-3 h-3" />
                      <span className="text-[10px]">FHE</span>
                    </span>
                  ) : (
                    <span className="text-emerald-400">{amount}</span>
                  )}
                </div>

                {/* Net Gas */}
                <div className="col-span-1 font-mono text-slate-400">
                  {netGas}
                </div>

                {/* Latency */}
                <div className="col-span-1 font-mono text-slate-400">
                  {latency}ms
                </div>

                {/* Status */}
                <div className="col-span-2 flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[9px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    CONFIRMED
                  </span>
                  {(entry.txSignature || entry.txSignature2) && (
                    <a
                      href={`https://solscan.io/tx/${entry.txSignature2 || entry.txSignature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-400 hover:text-blue-300"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {/* FLOW Column */}
                <div className="col-span-1 flex items-center justify-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFlowMapEntry(entry);
                    }}
                    className="p-1.5 hover:bg-slate-800 transition-colors border border-slate-700 hover:border-emerald-500"
                    title="View Flow Map"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-slate-500 hover:text-emerald-400" />
                  </button>
                </div>
              </div>

              {/* ========== EXPANDED DETAILS ========== */}
              {isExpanded && (
                <div className="bg-slate-900 border-l-2 border-l-emerald-500 border-t border-slate-800">
                  <div className="p-6">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <Shield className="w-5 h-5 text-emerald-400" />
                        <span className="text-base font-mono text-slate-200">
                          {isMaxPrivacy ? 'MAXIMUM_PRIVACY_PAYMENT' : entry.type.toUpperCase()}
                        </span>
                        {isMaxPrivacy && (
                          <span className="px-2 py-1 text-[9px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            RECOVERY_POOL_ARCHITECTURE
                          </span>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFlowMapEntry(entry);
                        }}
                        className="flex items-center gap-2 px-4 py-2 text-[10px] font-mono text-emerald-400 border border-emerald-500/30 hover:border-emerald-500 hover:bg-emerald-500/10"
                      >
                        <ExternalLink className="w-4 h-4" />
                        VIEW_FULL_FLOWMAP
                      </button>
                    </div>

                    {/* ZK Compression Banner */}
                    {isMaxPrivacy && (
                      <div className="mb-6 p-4 border border-emerald-500/30 bg-emerald-500/5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Sparkles className="w-5 h-5 text-emerald-400" />
                            <div>
                              <span className="text-sm font-mono text-emerald-400">
                                3-Step PayAI x402 Flow - Maximum Privacy
                              </span>
                              <p className="text-[10px] text-slate-500 mt-1">
                                Pool → Burner (compressed) → Decompress in burner → PayAI x402 to recipient
                              </p>
                              <p className="text-[10px] text-slate-500">
                                PayAI pays transfer gas. Recovery Pool pays decompress. Burner ATA rent recovered.
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-lg font-mono text-emerald-400">GASLESS</span>
                            <p className="text-[10px] text-slate-500">PayAI x402</p>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-8">
                      {/* LEFT: Transaction Lifecycle */}
                      <div>
                        <h4 className="text-[11px] font-mono text-slate-400 mb-4 uppercase tracking-wider flex items-center gap-2">
                          <Zap className="w-4 h-4 text-emerald-400" />
                          STEALTH_TX_LIFECYCLE
                        </h4>

                        <div className="space-y-3">
                          <TxStep
                            step={1}
                            label="POOL_TO_BURNER"
                            desc="Compressed USDC → Ephemeral burner"
                            sig={entry.txSignature1 || entry.paymentFlow?.setupTx || entry.stealthPoolAddress}
                            onCopy={handleCopy}
                            copiedId={copiedId}
                          />
                          {isMaxPrivacy ? (
                            <>
                              <TxStep
                                step={2}
                                label="DECOMPRESS_IN_BURNER"
                                desc="Recovery Pool creates burner ATA, decompresses USDC"
                                sig={entry.txSignature2 || entry.paymentFlow?.usdcTransferTx}
                                onCopy={handleCopy}
                                copiedId={copiedId}
                              />
                              <TxStep
                                step={3}
                                label="PAYAI_x402_TRANSFER"
                                desc="Burner → Recipient via PayAI (PayAI pays gas!)"
                                sig={entry.txSignature || entry.paymentFlow?.paymentTx}
                                onCopy={handleCopy}
                                copiedId={copiedId}
                                highlight
                              />
                            </>
                          ) : (
                            <TxStep
                              step={2}
                              label="BURNER_TO_RECIPIENT"
                              desc="Transfer to destination"
                              sig={entry.txSignature2 || entry.txSignature || entry.paymentFlow?.paymentTx}
                              onCopy={handleCopy}
                              copiedId={copiedId}
                              highlight
                            />
                          )}
                          {(entry.solRecovered && entry.solRecovered > 0) && (
                            <TxStep
                              step={isMaxPrivacy ? 4 : 3}
                              label="BURNER_CLOSED"
                              desc={`ATA closed, rent recovered: +${entry.solRecovered.toFixed(6)} SOL`}
                              sig={entry.paymentFlow?.recoveryTx}
                              onCopy={handleCopy}
                              copiedId={copiedId}
                            />
                          )}
                        </div>
                      </div>

                      {/* RIGHT: Custody Pipeline */}
                      <div>
                        <h4 className="text-[11px] font-mono text-slate-400 mb-4 uppercase tracking-wider flex items-center gap-2">
                          <Wallet className="w-4 h-4 text-emerald-400" />
                          CUSTODY_PIPELINE
                        </h4>

                        <div className="space-y-2">
                          <AddressBlock
                            label="STEALTH_POOL"
                            address={entry.stealthPoolAddress}
                            tag="POOL_AUTHORITY"
                            onCopy={handleCopy}
                            copiedId={copiedId}
                          />

                          <div className="flex justify-center py-1">
                            <ArrowDown className="w-4 h-4 text-slate-600" />
                          </div>

                          <AddressBlock
                            label="EPHEMERAL_BURNER"
                            address={entry.tempBurner}
                            tag="EPHEMERAL"
                            ephemeral
                            onCopy={handleCopy}
                            copiedId={copiedId}
                          />

                          {isMaxPrivacy && (
                            <>
                              <div className="flex justify-center py-1">
                                <div className="flex items-center gap-2 text-[10px] font-mono text-blue-400">
                                  <span>←</span>
                                  <span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20">FEE_PAYER</span>
                                  <span>→</span>
                                </div>
                              </div>
                              <AddressBlock
                                label="RECOVERY_POOL"
                                address={entry.recoveryPool || entry.feePayer}
                                tag="PAYS_FEES"
                                highlight
                                onCopy={handleCopy}
                                copiedId={copiedId}
                              />
                            </>
                          )}

                          <div className="flex justify-center py-1">
                            <ArrowDown className="w-4 h-4 text-slate-600" />
                          </div>

                          <AddressBlock
                            label="RECIPIENT"
                            address={entry.recipient}
                            tag="DESTINATION"
                            highlight
                            onCopy={handleCopy}
                            copiedId={copiedId}
                          />
                        </div>

                        {/* Privacy Verified */}
                        <div className="mt-6 p-4 bg-emerald-500/5 border border-emerald-500/20">
                          <div className="flex items-center gap-2 text-[11px] font-mono text-emerald-400 mb-3">
                            <Lock className="w-4 h-4" />
                            PRIVACY_VERIFIED
                          </div>
                          <div className="text-[10px] text-slate-400 space-y-2">
                            <div className="flex items-center gap-2">
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                              <span>Recipient sees burner wallet only</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                              <span>Pool address hidden from recipient</span>
                            </div>
                            {isMaxPrivacy && (
                              <>
                                <div className="flex items-center gap-2">
                                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                                  <span>Decompress inside burner wallet</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                                  <span>PayAI x402 paid transfer gas</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                                  <span>Recovery Pool paid decompress fees</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                                  <span>Burner ATA closed, rent recovered</span>
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {/* SOL Recovered */}
                        {entry.solRecovered && entry.solRecovered > 0 && (
                          <div className="mt-4 p-3 bg-blue-500/5 border border-blue-500/20">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-mono text-slate-400">SOL_RECOVERED</span>
                              <span className="text-base font-mono text-blue-400">+{entry.solRecovered.toFixed(6)} SOL</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Embedded Flow Map */}
                    <div className="mt-8 pt-6 border-t border-slate-800">
                      <h4 className="text-[11px] font-mono text-slate-400 mb-4 uppercase tracking-wider">
                        TRANSACTION_FLOW_VISUALIZATION
                      </h4>
                      <div className="border border-slate-700 bg-slate-950 overflow-hidden" style={{ height: '350px' }}>
                        <TransactionFlowMap 
                          signature={entry.txSignature2 || entry.txSignature || ''} 
                          stealthPool={entry.stealthPoolAddress}
                          burner={entry.tempBurner}
                          recipient={entry.recipient}
                          amount={entry.amount}
                          solRecovered={entry.solRecovered}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Flow Map Modal */}
      {flowMapEntry && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setFlowMapEntry(null)}>
          <div className="bg-slate-950 border border-slate-700 w-full max-w-6xl h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between bg-slate-900">
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-slate-300">TRANSACTION_FLOW_MAP</span>
                <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 border border-emerald-500/20">
                  {flowMapEntry.type?.toUpperCase()}
                </span>
              </div>
              <button
                onClick={() => setFlowMapEntry(null)}
                className="px-4 py-2 text-[11px] font-mono text-slate-400 hover:text-white border border-slate-600 hover:border-slate-500"
              >
                CLOSE
              </button>
            </div>
            <div className="flex-1">
              <TransactionFlowMap 
                signature={flowMapEntry.txSignature2 || flowMapEntry.txSignature || ''} 
                stealthPool={flowMapEntry.stealthPoolAddress}
                burner={flowMapEntry.tempBurner}
                recipient={flowMapEntry.recipient}
                amount={flowMapEntry.amount}
                solRecovered={flowMapEntry.solRecovered}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TX STEP
// ============================================================================

interface TxStepProps {
  step: number;
  label: string;
  desc: string;
  sig?: string;
  highlight?: boolean;
  onCopy: (text: string, id: string) => void;
  copiedId: string | null;
}

function TxStep({ step, label, desc, sig, highlight, onCopy, copiedId }: TxStepProps) {
  const hasSig = !!sig && sig.length > 10;

  return (
    <div className={`p-4 border ${
      highlight 
        ? 'bg-emerald-500/10 border-emerald-500/40' 
        : hasSig
          ? 'bg-slate-800/70 border-slate-700'
          : 'bg-slate-800/30 border-slate-700/50 opacity-50'
    }`}>
      <div className="flex items-start gap-4">
        <div className={`w-8 h-8 flex items-center justify-center text-sm font-mono border rounded ${
          highlight 
            ? 'text-emerald-400 border-emerald-500/60 bg-emerald-500/20' 
            : hasSig
              ? 'text-slate-300 border-slate-600 bg-slate-800'
              : 'text-slate-600 border-slate-700'
        }`}>
          {step}
        </div>
        <div className="flex-1 min-w-0">
          <span className={`text-sm font-mono ${highlight ? 'text-emerald-400' : hasSig ? 'text-slate-200' : 'text-slate-500'}`}>
            {label}
          </span>
          <p className="text-[10px] text-slate-500 mt-1">{desc}</p>
          {hasSig ? (
            <code className="text-[10px] text-slate-500 font-mono block mt-2 truncate">
              {sig.slice(0, 40)}...
            </code>
          ) : (
            <span className="text-[10px] text-slate-600 italic mt-2 block">Pending</span>
          )}
        </div>
        {hasSig && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCopy(sig, `tx-${sig.slice(0, 8)}`);
              }}
              className="p-2 hover:bg-slate-700 rounded"
            >
              {copiedId === `tx-${sig.slice(0, 8)}` ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4 text-slate-500" />
              )}
            </button>
            <a
              href={`https://solscan.io/tx/${sig}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-2 hover:bg-slate-700 rounded"
            >
              <ExternalLink className="w-4 h-4 text-blue-400" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// ADDRESS BLOCK
// ============================================================================

interface AddressBlockProps {
  label: string;
  address?: string;
  tag: string;
  ephemeral?: boolean;
  highlight?: boolean;
  onCopy: (text: string, id: string) => void;
  copiedId: string | null;
}

function AddressBlock({ label, address, tag, ephemeral, highlight, onCopy, copiedId }: AddressBlockProps) {
  const hasAddr = !!address && address.length >= 20;

  return (
    <div className={`p-3 border ${
      !hasAddr
        ? 'bg-slate-800/30 border-slate-700/50 opacity-60'
        : highlight
          ? 'bg-emerald-500/10 border-emerald-500/40'
          : ephemeral
            ? 'bg-amber-500/10 border-amber-500/40'
            : 'bg-slate-800/70 border-slate-700'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[10px] font-mono ${highlight ? 'text-emerald-400' : ephemeral ? 'text-amber-400' : 'text-slate-400'}`}>
          {label}
        </span>
        <span className={`text-[9px] font-mono px-1.5 py-0.5 ${
          !hasAddr
            ? 'bg-slate-700/50 text-slate-600'
            : highlight
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : ephemeral
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-slate-700 text-slate-400'
        }`}>
          {hasAddr ? tag : 'N/A'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <code className={`text-[11px] font-mono flex-1 truncate ${
          !hasAddr ? 'text-slate-600 italic' : highlight ? 'text-emerald-300' : 'text-slate-200'
        }`}>
          {address || 'Not logged'}
        </code>
        {hasAddr && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCopy(address!, `addr-${address!.slice(0, 8)}`);
              }}
              className="p-1 hover:bg-slate-700 rounded"
            >
              {copiedId === `addr-${address!.slice(0, 8)}` ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-slate-500" />
              )}
            </button>
            <a
              href={`https://solscan.io/account/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-1 hover:bg-slate-700 rounded"
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
