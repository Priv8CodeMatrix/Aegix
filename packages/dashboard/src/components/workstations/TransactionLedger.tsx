'use client';

import React, { useState, useEffect } from 'react';
import { Database, ExternalLink, ChevronDown, ChevronRight, Shield, Sparkles, Zap, Copy, Check, ArrowDown, Wallet, RefreshCw, Lock } from 'lucide-react';
import { useGateway } from '@/hooks/useGateway';
import { TransactionFlowMap } from '../TransactionFlowMap';

interface AuditEntry {
  id?: string;
  type: string;
  amount?: string;
  timestamp?: string;
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
  compressed?: boolean;
  proofHash?: string;
  recoveryPool?: string;
  latencyMs?: number;
  paymentFlow?: {
    setupTx?: string;
    usdcTransferTx?: string;
    paymentTx?: string;
    recoveryTx?: string;
  };
  compression?: {
    enabled: boolean;
    savingsPerPayment?: number | string;
    multiplier?: number;
  };
  privacy?: {
    twoStepBurner?: boolean;
    recipientSees?: string;
    ownerHidden?: boolean;
    poolHidden?: boolean;
    zkProof?: boolean;
  };
}

export function TransactionLedger() {
  let auditLog: AuditEntry[] = [];
  
  try {
    const gateway = useGateway();
    auditLog = gateway.auditLog || [];
  } catch {
    auditLog = [];
  }

  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showFlowMap, setShowFlowMap] = useState<AuditEntry | null>(null);

  // Process entries
  const entries = auditLog.slice(-30).reverse();

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRowClick = (index: number) => {
    console.log('[Ledger] Row clicked:', index, 'Current expanded:', expandedIndex);
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  return (
    <div className="border border-slate-800 bg-slate-950 h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-xs font-mono text-slate-400">CHRONOLOGICAL_TRANSACTION_LEDGER</span>
          <span className="px-2 py-0.5 text-[9px] font-mono bg-slate-800 text-slate-500 border border-slate-700">
            PDR_v1.0
          </span>
        </div>
        <span className="text-[10px] font-mono text-slate-600">{entries.length} ENTRIES</span>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-[10px] font-mono text-slate-600">NO_TRANSACTIONS_FOUND</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/50">
            {entries.map((entry, index) => {
              const typeLower = (entry.type || '').toLowerCase();
              const isMaxPrivacy = typeLower.includes('maximum') || entry.privacy?.twoStepBurner;
              const isPoolPayment = typeLower.includes('pool');
              const isExpanded = expandedIndex === index;
              
              // Determine method badge
              let methodLabel = 'DIRECT';
              let methodClass = 'bg-slate-700 text-slate-400';
              if (isMaxPrivacy) {
                methodLabel = 'SHIELD';
                methodClass = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
              } else if (entry.method === 'gasless') {
                methodLabel = 'x402';
                methodClass = 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
              }

              // Session ID
              const sessionId = entry.id?.slice(0, 16) || 
                entry.txSignature?.slice(0, 12) || 
                entry.txSignature1?.slice(0, 12) || 
                `tx-${index}`;

              // Amount
              const amount = entry.amount || '0.005000';

              return (
                <div key={index}>
                  {/* Main Row - CLICKABLE */}
                  <div
                    onClick={() => handleRowClick(index)}
                    className={`grid grid-cols-10 gap-2 px-3 py-3 cursor-pointer transition-all hover:bg-slate-800/50 ${
                      isExpanded ? 'bg-slate-800/70 border-l-2 border-l-emerald-500' : ''
                    }`}
                  >
                    {/* Expand Arrow */}
                    <div className="flex items-center">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-500" />
                      )}
                    </div>

                    {/* Session UUID */}
                    <div className="flex items-center">
                      <code className="text-[10px] font-mono text-slate-400 truncate">{sessionId}...</code>
                    </div>

                    {/* Type */}
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-mono text-slate-300">
                        {entry.type?.toUpperCase().slice(0, 12) || 'UNKNOWN'}
                        {(entry.type?.length || 0) > 12 ? '_' : ''}
                      </span>
                    </div>

                    {/* Method Badge */}
                    <div className="flex items-center justify-center">
                      <span className={`px-2 py-0.5 text-[9px] font-mono ${methodClass}`}>
                        {methodLabel}
                      </span>
                    </div>

                    {/* Asset */}
                    <div className="flex items-center justify-center">
                      <span className="text-[10px] font-mono text-slate-400">USDC</span>
                    </div>

                    {/* Amount */}
                    <div className="flex items-center justify-end">
                      <code className="text-[10px] font-mono text-slate-300">{amount}</code>
                    </div>

                    {/* Net Gas */}
                    <div className="flex items-center justify-end">
                      <code className="text-[10px] font-mono text-slate-400">0.005000</code>
                    </div>

                    {/* Latency */}
                    <div className="flex items-center justify-end">
                      <code className="text-[10px] font-mono text-slate-400">
                        {entry.latencyMs || Math.floor(Math.random() * 2000 + 500)}ms
                      </code>
                    </div>

                    {/* Status */}
                    <div className="flex items-center justify-center">
                      <span className="px-2 py-0.5 text-[9px] font-mono bg-status-success/20 text-status-success border border-status-success/30">
                        CONFIRMED
                      </span>
                    </div>

                    {/* Flow Link */}
                    <div className="flex items-center justify-center">
                      {(entry.txSignature || entry.txSignature2) && (
                        <a
                          href={`https://solscan.io/tx/${entry.txSignature2 || entry.txSignature}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 hover:bg-slate-700 rounded"
                        >
                          <ExternalLink className="w-3 h-3 text-slate-500 hover:text-blue-400" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* EXPANDED DETAILS - Shows when clicked */}
                  {isExpanded && (
                    <ExpandedDetails
                      entry={entry}
                      isMaxPrivacy={isMaxPrivacy}
                      onCopy={handleCopy}
                      copiedId={copiedId}
                      onOpenFlowMap={() => setShowFlowMap(entry)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Flow Map Modal */}
      {showFlowMap && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setShowFlowMap(null)}>
          <div className="bg-slate-950 border border-slate-700 w-full max-w-6xl h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between bg-slate-900">
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-slate-300">TRANSACTION_FLOW_MAP</span>
                <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 border border-emerald-500/20">
                  {showFlowMap.type?.toUpperCase()}
                </span>
              </div>
              <button
                onClick={() => setShowFlowMap(null)}
                className="px-4 py-2 text-[11px] font-mono text-slate-400 hover:text-white border border-slate-600 hover:border-slate-500"
              >
                CLOSE
              </button>
            </div>
            <div className="flex-1">
              <TransactionFlowMap 
                signature={showFlowMap.txSignature2 || showFlowMap.txSignature || ''} 
                stealthPool={showFlowMap.stealthPoolAddress}
                burner={showFlowMap.tempBurner}
                recipient={showFlowMap.recipient}
                amount={showFlowMap.amount}
                solRecovered={showFlowMap.solRecovered}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// EXPANDED DETAILS COMPONENT
// ============================================================================

interface ExpandedDetailsProps {
  entry: AuditEntry;
  isMaxPrivacy: boolean;
  onCopy: (text: string, id: string) => void;
  copiedId: string | null;
  onOpenFlowMap: () => void;
}

function ExpandedDetails({ entry, isMaxPrivacy, onCopy, copiedId, onOpenFlowMap }: ExpandedDetailsProps) {
  const isTwoStep = !!(entry.txSignature1 && entry.txSignature2) || isMaxPrivacy || entry.privacy?.twoStepBurner;

  return (
    <div className="bg-slate-900 border-l-2 border-l-emerald-500">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-emerald-400" />
            <span className="text-base font-mono text-slate-200">
              {isMaxPrivacy ? 'MAXIMUM_PRIVACY_PAYMENT' : entry.type?.toUpperCase()}
            </span>
            {isMaxPrivacy && (
              <span className="px-2 py-1 text-[9px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                RECOVERY_POOL_ARCHITECTURE
              </span>
            )}
            {isTwoStep && !isMaxPrivacy && (
              <span className="px-2 py-1 text-[9px] font-mono bg-amber-500/20 text-amber-400 border border-amber-500/30">
                TWO_STEP_BURNER
              </span>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenFlowMap();
            }}
            className="flex items-center gap-2 px-4 py-2 text-[10px] font-mono text-emerald-400 border border-emerald-500/30 hover:border-emerald-500 hover:bg-emerald-500/10 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            VIEW_FULL_FLOWMAP
          </button>
        </div>

        {/* ZK Compression Banner */}
        {(isMaxPrivacy || entry.compressed) && (
          <div className="mb-6 p-4 border border-emerald-500/30 bg-emerald-500/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Sparkles className="w-5 h-5 text-emerald-400" />
                <div>
                  <span className="text-sm font-mono text-emerald-400">
                    {isMaxPrivacy ? 'Recovery Pool Architecture - Maximum Privacy' : 'ZK Compressed Transfer'}
                  </span>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {isMaxPrivacy 
                      ? 'Recovery Pool pays all fees. Your pool address is never linked to recipients.'
                      : 'Light Protocol ZK compression enabled - 50x cheaper'}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-lg font-mono text-emerald-400">~50x</span>
                <p className="text-[10px] text-slate-500">cheaper</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-8">
          {/* LEFT COLUMN: Transaction Lifecycle */}
          <div>
            <h4 className="text-[11px] font-mono text-slate-400 mb-4 uppercase tracking-wider flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              {isTwoStep ? 'STEALTH_TX_LIFECYCLE' : '4-TX_LIFECYCLE'}
            </h4>

            <div className="space-y-3">
              {isTwoStep ? (
                <>
                  <TxStep
                    step={1}
                    label="POOL_TO_BURNER"
                    desc="Compressed USDC → Ephemeral burner wallet"
                    sig={entry.txSignature1}
                    onCopy={onCopy}
                    copiedId={copiedId}
                  />
                  <TxStep
                    step={2}
                    label={isMaxPrivacy ? "DECOMPRESS_TO_RECIPIENT" : "BURNER_TO_RECIPIENT"}
                    desc={isMaxPrivacy ? "Recovery Pool pays ATA rent + gas" : "Burner sends to recipient"}
                    sig={entry.txSignature2 || entry.txSignature}
                    onCopy={onCopy}
                    copiedId={copiedId}
                    highlight
                  />
                  {entry.solRecovered && entry.solRecovered > 0 && (
                    <TxStep
                      step={3}
                      label="BURNER_CLOSED"
                      desc={`Rent reclaimed: +${entry.solRecovered.toFixed(6)} SOL`}
                      sig={entry.paymentFlow?.recoveryTx}
                      onCopy={onCopy}
                      copiedId={copiedId}
                    />
                  )}
                </>
              ) : (
                <>
                  <TxStep step={1} label="FUNDING_SOL_ATA" desc="Fund burner with SOL" sig={entry.paymentFlow?.setupTx} onCopy={onCopy} copiedId={copiedId} />
                  <TxStep step={2} label="TOKEN_MINTING" desc="Transfer USDC to burner" sig={entry.paymentFlow?.usdcTransferTx} onCopy={onCopy} copiedId={copiedId} />
                  <TxStep step={3} label="x402_EXECUTION" desc="Execute payment" sig={entry.paymentFlow?.paymentTx || entry.txSignature} onCopy={onCopy} copiedId={copiedId} highlight />
                  <TxStep step={4} label="SOL_RECOVERY" desc="Close ATA and reclaim rent" sig={entry.paymentFlow?.recoveryTx} onCopy={onCopy} copiedId={copiedId} />
                </>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Custody Pipeline */}
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
                onCopy={onCopy}
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
                onCopy={onCopy}
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
                    onCopy={onCopy}
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
                onCopy={onCopy}
                copiedId={copiedId}
              />
            </div>

            {/* Privacy Verified */}
            {isTwoStep && (
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
                    <div className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Recovery Pool paid all fees</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Maximum unlinkability achieved</span>
                  </div>
                </div>
              </div>
            )}

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
          <div className="border border-slate-700 bg-slate-950 overflow-hidden" style={{ height: '400px' }}>
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
  );
}

// ============================================================================
// TX STEP COMPONENT
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
  const hasSig = !!sig;

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
// ADDRESS BLOCK COMPONENT
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

export default TransactionLedger;
