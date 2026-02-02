'use client';

/**
 * RecoveryPoolPanel Component - Aegix v4.0 Recovery Pool Management
 * 
 * This is a REAL Solana wallet that the user must:
 * 1. Initialize (creates a keypair)
 * 2. Fund with SOL (for ATA rent + transaction fees)
 * 3. Top up when balance is low
 */

import { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { 
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { 
  Shield, 
  RefreshCw, 
  Copy, 
  Check, 
  ExternalLink, 
  AlertTriangle,
  Loader2,
  Wallet,
  Recycle,
  Plus,
  Database,
  ChevronDown,
  ChevronRight,
  ArrowDown,
  AlertCircle
} from 'lucide-react';
import { gatewayFetch, clearCache } from '@/lib/gatewayFetch';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';

interface RecoveryPoolStatus {
  initialized: boolean;
  address: string | null;
  balance: number;
  balanceFormatted: string;
  isHealthy: boolean;
  totalRecycled: number;
  totalRecycledFormatted: string;
  minRequired: number;
  minRequiredFormatted: string;
  status: 'NOT_INITIALIZED' | 'NEEDS_FUNDING' | 'HEALTHY' | 'LOCKED';
  isLocked?: boolean;
  poolId?: string;
  message?: string;
}

interface RecoveryPoolPanelProps {
  onLog?: (level: 'info' | 'success' | 'error' | 'warning', message: string) => void;
  onRefresh?: () => void;
  defaultExpanded?: boolean;
}

export function RecoveryPoolPanel({ onLog, onRefresh, defaultExpanded = false }: RecoveryPoolPanelProps) {
  const { publicKey, connected, signTransaction, signMessage } = useWallet();
  const { connection } = useConnection();
  const [status, setStatus] = useState<RecoveryPoolStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);
  
  // Deposit modal state
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState('0.01');
  const [isDepositing, setIsDepositing] = useState(false);

  const log = useCallback((level: 'info' | 'success' | 'error' | 'warning', message: string) => {
    onLog?.(level, message);
  }, [onLog]);

  // Fetch status from backend (per-user)
  const fetchStatus = useCallback(async (force = false) => {
    if (loading || !publicKey) return;
    
    setLoading(true);
    setError(null);
    
    try {
      if (force) {
        clearCache('/api/credits/recovery/status');
      }
      
      // Pass owner wallet address to get this user's Recovery Pool
      const response = await fetch(`${GATEWAY_URL}/api/credits/recovery/status?owner=${publicKey.toBase58()}`);
      const result = await response.json();
      
      if (result.success && result.data) {
        setStatus(result.data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch status');
    } finally {
      setLoading(false);
    }
  }, [loading, publicKey]);

  // Load on mount
  useEffect(() => {
    if (connected) {
      fetchStatus();
    }
  }, [connected]);

  // Initialize Recovery Pool - SIMPLE: Just create wallet and fund it with ONE transaction
  const handleInitialize = useCallback(async () => {
    if (!publicKey || !signTransaction) {
      setError('Wallet not connected');
      return;
    }
    
    setInitializing(true);
    setError(null);
    
    try {
      log('info', 'Creating Recovery Pool...');
      
      // STEP 1: Call backend to create wallet AND get funding transaction in ONE call
      const response = await fetch(`${GATEWAY_URL}/api/credits/recovery/create-and-fund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          amountSOL: 0.01,
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to create Recovery Pool');
      }
      
      log('info', 'Approve the transaction to fund your Recovery Pool...');
      
      // STEP 2: Sign the funding transaction (shows real SOL amount in Phantom!)
      const txBuffer = Buffer.from(result.data.transaction, 'base64');
      const transaction = Transaction.from(txBuffer);
      
      const signedTx = await signTransaction(transaction);
      
      // STEP 3: Submit and confirm
      log('info', 'Submitting transaction...');
      
      const txSignature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      await connection.confirmTransaction({ 
        signature: txSignature, 
        blockhash, 
        lastValidBlockHeight 
      }, 'confirmed');
      
      // STEP 4: Confirm with backend
      await fetch(`${GATEWAY_URL}/api/credits/recovery/confirm-fund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          txSignature,
          recoveryPoolAddress: result.data.address,
        }),
      });
      
      log('success', `✓ Recovery Pool created and funded!`);
      log('success', `Address: ${result.data.address.slice(0, 12)}...`);
      log('success', `Tx: ${txSignature.slice(0, 16)}...`);
      
      // Refresh status
      await fetchStatus(true);
      setExpanded(true);
      onRefresh?.();
      
    } catch (err: any) {
      if (!err.message?.includes('rejected') && !err.message?.includes('User rejected')) {
        setError(err.message || 'Failed to create Recovery Pool');
        log('error', `Failed: ${err.message}`);
      } else {
        log('warning', 'Cancelled by user');
      }
    } finally {
      setInitializing(false);
    }
  }, [publicKey, signTransaction, connection, log, fetchStatus, onRefresh]);

  // Copy address to clipboard
  const copyAddress = useCallback(() => {
    if (status?.address) {
      navigator.clipboard.writeText(status.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [status?.address]);

  // Sweep burner rent
  const handleSweep = useCallback(async () => {
    if (!publicKey) return;
    
    setSweeping(true);
    
    try {
      const response = await fetch(`${GATEWAY_URL}/api/credits/recovery/sweep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
        }),
      });
      const data = await response.json();
      
      if (data.success) {
        log('success', `Sweep complete`);
        await fetchStatus(true);
      }
    } catch (err: any) {
      log('error', `Sweep failed`);
    } finally {
      setSweeping(false);
    }
  }, [publicKey, log, fetchStatus]);

  // Deposit SOL to Recovery Pool
  const handleDeposit = useCallback(async () => {
    if (!publicKey || !signTransaction || !status?.address || !connection) {
      setError('Wallet not connected');
      return;
    }
    
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      setError('Invalid amount');
      return;
    }
    
    setIsDepositing(true);
    setError(null);
    
    try {
      log('info', `Depositing ${amount} SOL to Recovery Pool...`);
      
      const recoveryPubkey = new PublicKey(status.address);
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
      
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: recoveryPubkey,
          lamports,
        })
      );
      
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;
      
      const signed = await signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      
      log('success', `Deposited ${amount} SOL to Recovery Pool`);
      setShowDeposit(false);
      setDepositAmount('0.01');
      
      // Refresh after deposit
      setTimeout(() => fetchStatus(true), 2000);
      onRefresh?.();
      
    } catch (err: any) {
      setError(err.message || 'Deposit failed');
      log('error', `Deposit failed: ${err.message}`);
    } finally {
      setIsDepositing(false);
    }
  }, [publicKey, signTransaction, status?.address, connection, depositAmount, log, fetchStatus, onRefresh]);

  // Not connected
  if (!connected || !publicKey) {
    return null;
  }

  // Loading initial state
  if (!status && loading) {
    return (
      <div className="border border-slate-700 bg-slate-900 p-3">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
          <span className="text-sm font-mono text-slate-500">Loading Recovery Pool...</span>
        </div>
      </div>
    );
  }

  // Not initialized - show prominent initialize button
  if (!status?.initialized) {
    return (
      <div className="border border-slate-700 bg-slate-900">
        <div 
          className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-slate-800/50"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            {expanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
            <Shield className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-mono text-slate-400">RECOVERY_POOL</span>
            <span className="px-2 py-0.5 text-[9px] font-mono bg-slate-800 text-slate-500 border border-slate-700">
              FEE PAYER
            </span>
          </div>
          <span className="text-[9px] font-mono text-status-warning">NOT INITIALIZED</span>
        </div>

        {expanded && (
          <div className="p-4 border-t border-slate-800">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-slate-300 mb-1">Your Recovery Pool Required</p>
                <p className="text-[11px] text-slate-500">
                  Create your personal Recovery Pool - a real Solana wallet that pays transaction fees and ATA rent 
                  for your privacy payments. This breaks the on-chain link between your pool and recipients.
                </p>
              </div>
            </div>
            
            <div className="bg-slate-800/50 p-3 mb-4 border border-slate-700">
              <p className="text-[10px] text-slate-400 font-mono mb-2">SETUP STEPS:</p>
              <ol className="text-[11px] text-slate-500 space-y-1 list-decimal list-inside">
                <li>Click <span className="text-slate-300">Initialize</span> to create the wallet</li>
                <li>Copy the wallet address</li>
                <li>Send at least <span className="text-status-warning">0.01 SOL</span> to fund it</li>
                <li>Use <span className="text-slate-300">Deposit</span> button for easy top-ups</li>
              </ol>
            </div>
            
            <button
              onClick={handleInitialize}
              disabled={initializing}
              className="w-full py-2.5 text-sm font-mono text-white bg-status-info hover:bg-status-info/80 border border-status-info flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {initializing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  CREATING WALLET...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  INITIALIZE RECOVERY POOL
                </>
              )}
            </button>
            
            {error && (
              <p className="text-[10px] text-red-400 mt-2">{error}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // Initialized - show collapsible panel with status
  return (
    <div className="border border-slate-700 bg-slate-900">
      {/* Header - Always visible */}
      <div 
        className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-slate-800/50"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
          <Shield className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-mono text-slate-400">RECOVERY_POOL</span>
          <span className="px-2 py-0.5 text-[9px] font-mono bg-slate-800 text-slate-500 border border-slate-700">
            FEE PAYER
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono ${status.isHealthy ? 'text-slate-300' : 'text-status-warning'}`}>
            {status.balance.toFixed(4)} SOL
          </span>
          <span className={`text-[9px] font-mono ${status.isHealthy ? 'text-status-success' : 'text-status-warning'}`}>
            {status.isHealthy ? 'Ready' : 'Fund'}
          </span>
          {loading && <Loader2 className="w-3 h-3 text-slate-500 animate-spin" />}
        </div>
      </div>

      {/* Warning banner if needs funding */}
      {!status.isHealthy && (
        <div className="px-3 py-2 bg-status-warning/10 border-t border-status-warning/20 flex items-center gap-2">
          <AlertTriangle className="w-3 h-3 text-status-warning" />
          <span className="text-[10px] text-status-warning font-mono">
            Fund with at least {status.minRequired} SOL to enable privacy payments
          </span>
        </div>
      )}

      {/* Error */}
      {error && expanded && (
        <div className="px-3 py-2 bg-red-500/10 border-t border-red-500/20">
          <div className="flex items-center gap-2 text-red-400 text-xs">
            <AlertTriangle className="w-3 h-3" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Expanded Content */}
      {expanded && (
        <div className="p-3 border-t border-slate-800">
          {/* Address */}
          <div className="mb-3">
            <div className="text-[9px] text-slate-500 font-mono mb-1">WALLET ADDRESS (fund this)</div>
            <div className="flex items-center gap-2 bg-slate-800/50 p-2 border border-slate-700">
              <code className="text-xs font-mono text-slate-200 flex-1 break-all">
                {status.address}
              </code>
              <button 
                onClick={(e) => { e.stopPropagation(); copyAddress(); }} 
                className="p-1 hover:bg-slate-700/50 rounded flex-shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              </button>
              <a 
                href={`https://solscan.io/account/${status.address}`} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="p-1 hover:bg-slate-700/50 rounded flex-shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              </a>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <div className="text-[9px] text-slate-500 font-mono mb-1">BALANCE</div>
              <div className={`text-sm font-mono ${status.isHealthy ? 'text-slate-100' : 'text-status-warning'}`}>
                {status.balance.toFixed(4)} SOL
              </div>
            </div>
            <div>
              <div className="text-[9px] text-slate-500 font-mono mb-1">RECYCLED</div>
              <div className="text-sm font-mono text-slate-100">{status.totalRecycled.toFixed(4)} SOL</div>
            </div>
            <div>
              <div className="text-[9px] text-slate-500 font-mono mb-1">MIN_REQUIRED</div>
              <div className="text-sm font-mono text-slate-100">{status.minRequired.toFixed(4)} SOL</div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
            <button
              onClick={(e) => { e.stopPropagation(); setShowDeposit(true); }}
              className="px-3 py-1.5 text-[10px] font-mono text-status-success border border-status-success/30 hover:border-status-success/50 hover:bg-status-success/10 flex items-center gap-1.5"
            >
              <ArrowDown className="w-3 h-3" />
              Deposit SOL
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleSweep(); }}
              disabled={sweeping}
              className="px-3 py-1.5 text-[10px] font-mono text-slate-400 border border-slate-700 hover:border-slate-600 flex items-center gap-1.5 disabled:opacity-50"
            >
              {sweeping ? <Loader2 className="w-3 h-3 animate-spin" /> : <Recycle className="w-3 h-3" />}
              Sweep
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); fetchStatus(true); }}
              disabled={loading}
              className="px-2 py-1.5 text-[10px] font-mono text-slate-400 border border-slate-700 hover:border-slate-600 flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Info */}
          <div className="mt-3 text-[9px] text-slate-500">
            Your personal Recovery Pool pays transaction fees and ATA rent for your privacy payments, 
            breaking the on-chain link between your pool and recipients.
          </div>
        </div>
      )}

      {/* Deposit Modal */}
      {showDeposit && status?.address && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowDeposit(false)}>
          <div className="bg-slate-900 border border-slate-700 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-sm font-mono text-slate-300">Deposit SOL to Recovery Pool</h3>
              <button onClick={() => setShowDeposit(false)} className="text-slate-400 hover:text-slate-200 text-lg">×</button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-[10px] font-mono text-slate-500 mb-1">AMOUNT (SOL)</label>
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  min="0.001"
                  step="0.001"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 text-slate-100 font-mono text-sm"
                />
                <div className="flex gap-2 mt-2">
                  {['0.01', '0.05', '0.1'].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setDepositAmount(amt)}
                      className="px-2 py-1 text-[10px] font-mono text-slate-400 border border-slate-700 hover:border-slate-600"
                    >
                      {amt} SOL
                    </button>
                  ))}
                </div>
              </div>

              <div className="text-[10px] text-slate-500 space-y-1">
                <div className="flex justify-between">
                  <span>To:</span>
                  <span className="font-mono">{status.address.slice(0, 16)}...</span>
                </div>
                <div className="flex justify-between">
                  <span>Current Balance:</span>
                  <span className="font-mono">{status.balance.toFixed(4)} SOL</span>
                </div>
                <div className="flex justify-between">
                  <span>After Deposit:</span>
                  <span className="font-mono text-status-success">
                    {(status.balance + parseFloat(depositAmount || '0')).toFixed(4)} SOL
                  </span>
                </div>
              </div>

              {error && (
                <div className="text-[10px] text-red-400">{error}</div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeposit(false)}
                  className="flex-1 px-4 py-2 text-sm font-mono text-slate-400 border border-slate-700 hover:border-slate-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeposit}
                  disabled={isDepositing || !parseFloat(depositAmount)}
                  className="flex-1 px-4 py-2 text-sm font-mono text-white bg-status-success hover:bg-status-success/80 border border-status-success flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isDepositing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                  {isDepositing ? 'Depositing...' : 'Deposit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RecoveryPoolPanel;
