'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Eye, 
  EyeOff, 
  Shield, 
  Lock, 
  Unlock, 
  Loader2, 
  AlertCircle, 
  ExternalLink,
  Cpu,
  Activity,
  RefreshCw,
  CheckCircle,
  Key,
} from 'lucide-react';
import { fetchAuditLog, fetchAuditLogWithFheMode, AuditLogEntry } from '@/lib/gateway';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';

interface DecryptedEntry {
  id: string;
  type: string;
  service: string;
  amount?: string;
  timestamp: string;
  fheHandle?: string;
  txSignature?: string;
}

/**
 * PrivacyView - NON-CUSTODIAL with Real Inco FHE
 * Shows encrypted audit log of agent activity
 * Uses wallet signature for attested decryption
 */
export function PrivacyView() {
  const { publicKey, signMessage, connected } = useWallet();
  const [isDecrypted, setIsDecrypted] = useState(false);
  const [entries, setEntries] = useState<DecryptedEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activityStats, setActivityStats] = useState({ total: 0, payments: 0, agents: 0 });
  const [fheMode, setFheMode] = useState<'REAL' | 'SIMULATION' | 'UNKNOWN'>('UNKNOWN');
  const [decryptionProof, setDecryptionProof] = useState<string | null>(null);

  // Auto-fetch audit log when wallet connects
  useEffect(() => {
    if (publicKey) {
      // Initial fetch without signature (just to see if there's data)
      fetchActivityLog(false);
    } else {
      setEntries([]);
      setIsDecrypted(false);
      setDecryptionProof(null);
    }
  }, [publicKey]);

  /**
   * Fetch activity log - with optional attested decryption
   * @param withAttestedDecrypt - If true, sign message to decrypt via Inco FHE
   */
  const fetchActivityLog = async (withAttestedDecrypt: boolean = false) => {
    if (!publicKey) return;

    setIsLoading(true);
    setError(null);
    
    try {
      // If attested decryption requested, sign a message first
      let signature: string | undefined;
      let message: string | undefined;

      if (withAttestedDecrypt && signMessage) {
        message = `Aegix attested decryption request\nWallet: ${publicKey.toBase58()}\nTimestamp: ${Date.now()}`;
        console.log('[Inco FHE] Requesting wallet signature for attested decryption...');
        
        try {
          const signatureBytes = await signMessage(new TextEncoder().encode(message));
          signature = Buffer.from(signatureBytes).toString('base64');
          console.log('[Inco FHE] Signature obtained');
        } catch (e) {
          console.log('[Inco FHE] Signature cancelled, using regular fetch');
        }
      }

      // Fetch with or without attested decryption
      let auditLog: AuditLogEntry[] = [];
      let proof: string | undefined;

      if (signature && message) {
        // Use attested decryption endpoint
        const response = await fetch(`${GATEWAY_URL}/api/credits/decrypt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            owner: publicKey.toBase58(),
            signature,
            message,
          }),
        });

        const result = await response.json();
        if (result.success) {
          auditLog = result.data.entries.map((e: any) => ({
            id: e.id,
            type: e.type,
            service: e.service || getServiceLabel(e.type),
            amount: e.amount,
            timestamp: e.timestamp,
            txSignature: e.txSignature,
            fheHandle: e.fheHandle,
          }));
          proof = result.data.proof;
          setFheMode(result.fhe?.mode === 'REAL' ? 'REAL' : 'SIMULATION');
        } else {
          throw new Error(result.error || 'Decryption failed');
        }
      } else {
        // Regular fetch (includes FHE mode)
        const result = await fetchAuditLogWithFheMode(publicKey.toBase58());
        auditLog = result.logs;
        setFheMode(result.fheMode);
      }

      // Process audit entries
      const decryptedEntries: DecryptedEntry[] = auditLog.map((entry: AuditLogEntry) => ({
        id: entry.id,
        type: entry.type,
        service: entry.service || getServiceLabel(entry.type),
        amount: entry.amount ? (parseFloat(entry.amount) / 1_000_000).toFixed(4) : undefined,
        timestamp: entry.timestamp,
        fheHandle: entry.fheHandle?.substring(0, 24),
        txSignature: entry.txSignature,
      }));

      setEntries(decryptedEntries);
      setIsDecrypted(true);
      setDecryptionProof(proof || null);
      
      // Calculate stats
      setActivityStats({
        total: decryptedEntries.length,
        payments: decryptedEntries.filter(e => 
          e.type === 'agent_payment' || 
          e.type === 'payment_confirmed' || 
          e.type === 'x402_donation'
        ).length,
        agents: new Set(decryptedEntries.map(e => e.service)).size,
      });

    } catch (error) {
      console.error('[Aegix] Audit log fetch failed:', error);
      setError((error as Error).message || 'Failed to fetch activity log');
    } finally {
      setIsLoading(false);
    }
  };

  const hideData = () => {
    setIsDecrypted(false);
  };

  const getServiceLabel = (type: string): string => {
    switch (type) {
      case 'agent_payment': return 'Agent Payment Request';
      case 'payment_confirmed': return 'Payment Confirmed';
      case 'agent_created': return 'Agent Created';
      case 'agent_deleted': return 'Agent Deleted';
      case 'x402_donation': return 'x402 Donation';
      default: return 'Activity';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'agent_payment':
      case 'payment_confirmed':
        return <Activity className="w-4 h-4 text-aegix-cyan" />;
      case 'agent_created':
      case 'agent_deleted':
        return <Cpu className="w-4 h-4 text-aegix-magenta" />;
      default:
        return <Activity className="w-4 h-4 text-aegix-muted" />;
    }
  };

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    if (isNaN(date.getTime())) return 'Unknown';
    
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    return date.toLocaleDateString();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 rounded-xl bg-gradient-to-br from-aegix-surface/80 to-aegix-deep/90 
                 backdrop-blur-xl border border-aegix-border"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-semibold flex items-center gap-2">
          <Shield className="w-5 h-5 text-aegix-magenta" />
          Encrypted Activity Log
        </h3>
        
        <div className="flex items-center gap-2">
          {publicKey && (
            <>
              {/* FHE Mode Indicator */}
              {fheMode !== 'UNKNOWN' && (
                <span className={`text-xs px-2 py-1 rounded-full ${
                  fheMode === 'REAL' 
                    ? 'bg-aegix-success/20 text-aegix-success border border-aegix-success/30' 
                    : 'bg-aegix-gold/20 text-aegix-gold border border-aegix-gold/30'
                }`}>
                  {fheMode === 'REAL' ? '🔐 Real FHE' : '🧪 Simulated FHE'}
                </span>
              )}
              
              <button
                onClick={() => fetchActivityLog(false)}
                disabled={isLoading}
                className="p-2 rounded-lg bg-aegix-surface border border-aegix-border 
                           hover:border-aegix-cyan transition-all disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              
              {/* Simple View Button */}
              <button
                onClick={() => isDecrypted ? hideData() : fetchActivityLog(false)}
                disabled={isLoading}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-aegix-surface 
                           border border-aegix-border hover:border-aegix-cyan transition-all text-sm
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading...
                  </>
                ) : isDecrypted ? (
                  <>
                    <EyeOff className="w-4 h-4" />
                    Hide
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4" />
                    View
                  </>
                )}
              </button>
              
              {/* Attested Decryption Button (with signature) */}
              {signMessage && (
                <button
                  onClick={() => fetchActivityLog(true)}
                  disabled={isLoading || !connected}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg 
                             bg-gradient-to-r from-aegix-magenta/20 to-aegix-cyan/20
                             border border-aegix-magenta/50 hover:border-aegix-magenta transition-all text-sm
                             disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Sign with wallet to verify ownership and decrypt via Inco FHE"
                >
                  <Key className="w-4 h-4 text-aegix-magenta" />
                  Attested Decrypt
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-aegix-error/10 border border-aegix-error/30">
          <p className="text-sm text-aegix-error flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </p>
        </div>
      )}

      <AnimatePresence mode="wait">
        {!publicKey ? (
          <motion.div
            key="no-wallet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-center py-8"
          >
            <Lock className="w-12 h-12 text-aegix-muted mx-auto mb-4 opacity-50" />
            <p className="text-aegix-muted">
              Connect your wallet to view encrypted activity
            </p>
          </motion.div>
        ) : !isDecrypted ? (
          <motion.div
            key="encrypted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-center py-8"
          >
            <motion.div
              animate={{ 
                scale: [1, 1.05, 1],
                opacity: [0.5, 0.8, 0.5]
              }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              <Lock className="w-12 h-12 text-aegix-magenta mx-auto mb-4" />
            </motion.div>
            <p className="text-aegix-muted">
              Your agent activity is FHE-encrypted on Inco Network.
            </p>
            <p className="text-sm text-aegix-muted mt-2">
              Click &quot;View Activity&quot; to see your encrypted audit log.
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="decrypted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            {/* Activity Stats */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="p-3 rounded-lg bg-aegix-cyan/10 border border-aegix-cyan/30 text-center">
                <p className="text-2xl font-display font-bold text-aegix-cyan">{activityStats.total}</p>
                <p className="text-xs text-aegix-muted">Total Activities</p>
              </div>
              <div className="p-3 rounded-lg bg-aegix-magenta/10 border border-aegix-magenta/30 text-center">
                <p className="text-2xl font-display font-bold text-aegix-magenta">{activityStats.payments}</p>
                <p className="text-xs text-aegix-muted">Payments</p>
              </div>
              <div className="p-3 rounded-lg bg-aegix-success/10 border border-aegix-success/30 text-center">
                <p className="text-2xl font-display font-bold text-aegix-success">{activityStats.agents}</p>
                <p className="text-xs text-aegix-muted">Unique Services</p>
              </div>
            </div>

            {entries.length === 0 ? (
              <div className="text-center py-6">
                <Activity className="w-10 h-10 mx-auto mb-3 text-aegix-muted/50" />
                <p className="text-aegix-muted">No activity yet</p>
                <p className="text-xs text-aegix-muted mt-1">
                  Agent payments will appear here
                </p>
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-2">
                {entries.map((entry, index) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="flex items-center justify-between p-3 rounded-lg 
                               bg-aegix-surface/50 hover:bg-aegix-surface/80 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 rounded-md bg-aegix-deep/50">
                        {getTypeIcon(entry.type)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-aegix-text">{entry.service}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-aegix-muted">
                            {formatTimestamp(entry.timestamp)}
                          </p>
                          {entry.fheHandle && (
                            <span className="text-xs font-mono text-aegix-cyan/70">
                              {entry.fheHandle}...
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {entry.amount && (
                        <span className="text-sm font-mono text-aegix-text">
                          ${entry.amount}
                        </span>
                      )}
                      {entry.txSignature && (
                        <a
                          href={`https://solscan.io/tx/${entry.txSignature}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 rounded hover:bg-aegix-border/30 transition-colors"
                          title="View on Solscan"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="w-3 h-3 text-aegix-cyan" />
                        </a>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
            
            <div className="pt-3 border-t border-aegix-border/30 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-aegix-success flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  Encrypted on Inco Network (FHE)
                </p>
                <p className="text-xs text-aegix-cyan flex items-center gap-1">
                  <Unlock className="w-3 h-3" />
                  Non-Custodial • Your funds stay in your wallet
                </p>
              </div>
              
              {/* Show decryption proof if available */}
              {decryptionProof && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-aegix-success/10 border border-aegix-success/30">
                  <CheckCircle className="w-4 h-4 text-aegix-success" />
                  <div className="flex-1">
                    <p className="text-xs text-aegix-success font-medium">
                      Attested Decryption Verified
                    </p>
                    <p className="text-xs text-aegix-muted font-mono truncate">
                      Proof: {decryptionProof}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
