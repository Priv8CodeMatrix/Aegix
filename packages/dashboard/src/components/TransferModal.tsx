'use client';

/**
 * TransferModal - Deposit/Withdraw Funds Between Pools
 * 
 * Enforces hierarchy:
 * - Deposit: Wallet → Legacy, Legacy → Main, Main → Custom
 * - Withdraw: Custom → Main, Main → Legacy, any → Wallet
 */

import { useState, useMemo } from 'react';
import { X, ArrowRight, Wallet as WalletIcon, Loader2, AlertTriangle, Check } from 'lucide-react';
import { type PoolData, type PoolType } from '@/lib/gateway';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'deposit' | 'withdraw';
  targetPool: PoolData;
  availablePools: PoolData[];
  onTransfer: (sourceId: string, targetId: string, amount: string, isWallet: boolean) => Promise<void>;
  isProcessing: boolean;
}

export function TransferModal({
  isOpen,
  onClose,
  mode,
  targetPool,
  availablePools,
  onTransfer,
  isProcessing,
}: TransferModalProps) {
  const [amount, setAmount] = useState('');
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [selectedTarget, setSelectedTarget] = useState<string>('');
  const [useWallet, setUseWallet] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine allowed sources/targets based on hierarchy
  const allowedPools = useMemo(() => {
    if (mode === 'deposit') {
      // Depositing TO targetPool
      // Legacy accepts from: Wallet
      // Main accepts from: Legacy
      // Custom accepts from: Main
      if (targetPool.type === 'LEGACY') {
        return { pools: [], allowWallet: true };
      } else if (targetPool.type === 'MAIN') {
        const legacy = availablePools.find(p => p.type === 'LEGACY');
        return { pools: legacy ? [legacy] : [], allowWallet: false };
      } else if (targetPool.type === 'CUSTOM') {
        const main = availablePools.find(p => p.type === 'MAIN');
        return { pools: main ? [main] : [], allowWallet: false };
      }
    } else {
      // Withdrawing FROM targetPool
      // Legacy can send to: Wallet
      // Main can send to: Legacy or Wallet
      // Custom can send to: Main or Wallet
      if (targetPool.type === 'LEGACY') {
        return { pools: [], allowWallet: true };
      } else if (targetPool.type === 'MAIN') {
        const legacy = availablePools.find(p => p.type === 'LEGACY');
        return { pools: legacy ? [legacy] : [], allowWallet: true };
      } else if (targetPool.type === 'CUSTOM') {
        const main = availablePools.find(p => p.type === 'MAIN');
        return { pools: main ? [main] : [], allowWallet: true };
      }
    }
    return { pools: [], allowWallet: false };
  }, [mode, targetPool, availablePools]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    // Determine source and target based on mode
    let sourceId: string;
    let targetId: string;
    let isWalletTransfer = false;

    if (mode === 'deposit') {
      // Depositing TO targetPool
      targetId = targetPool.poolId;
      if (useWallet) {
        sourceId = 'wallet';
        isWalletTransfer = true;
      } else if (selectedSource) {
        sourceId = selectedSource;
      } else {
        setError('Please select a source');
        return;
      }
    } else {
      // Withdrawing FROM targetPool
      sourceId = targetPool.poolId;
      if (useWallet) {
        targetId = 'wallet';
        isWalletTransfer = true;
      } else if (selectedTarget) {
        targetId = selectedTarget;
      } else {
        setError('Please select a target');
        return;
      }
    }

    try {
      await onTransfer(sourceId, targetId, amount, isWalletTransfer);
      onClose();
      setAmount('');
      setSelectedSource('');
      setSelectedTarget('');
      setUseWallet(false);
    } catch (err: any) {
      setError(err.message || 'Transfer failed');
    }
  };

  if (!isOpen) return null;

  const poolLabel = (pool: PoolData) => {
    const typeLabel = pool.type === 'LEGACY' ? 'Legacy' : pool.type === 'MAIN' ? 'Main' : 'Custom';
    const balance = pool.balance ? `${pool.balance.usdc.toFixed(2)} USDC` : '0.00 USDC';
    return `${typeLabel} Pool (${balance})`;
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-md">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-mono text-slate-200 uppercase">
            {mode === 'deposit' ? '↓ Deposit Funds' : '↑ Withdraw Funds'}
          </h3>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Target Pool Info */}
          <div className="p-3 border border-slate-700 bg-slate-950">
            <p className="text-[10px] text-slate-500 font-mono mb-1">
              {mode === 'deposit' ? 'DEPOSIT TO' : 'WITHDRAW FROM'}
            </p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-mono text-slate-200">
                  {targetPool.type === 'LEGACY' ? 'Legacy Pool' : 
                   targetPool.type === 'MAIN' ? 'Main Pool' : 
                   targetPool.customName || 'Custom Pool'}
                </p>
                <p className="text-[10px] text-slate-500 font-mono">
                  {targetPool.poolAddress.slice(0, 12)}...{targetPool.poolAddress.slice(-8)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-mono text-slate-200">
                  {targetPool.balance?.usdc.toFixed(2) || '0.00'} USDC
                </p>
                <p className="text-[10px] text-slate-500">
                  {targetPool.balance?.sol.toFixed(4) || '0.0000'} SOL
                </p>
              </div>
            </div>
          </div>

          {/* Source/Target Selector */}
          <div className="space-y-2">
            <label className="text-[10px] text-slate-500 font-mono uppercase">
              {mode === 'deposit' ? 'From' : 'To'}
            </label>
            
            {/* Wallet Option */}
            {allowedPools.allowWallet && (
              <button
                type="button"
                onClick={() => {
                  setUseWallet(true);
                  setSelectedSource('');
                  setSelectedTarget('');
                }}
                className={`w-full p-3 border text-left transition-colors ${
                  useWallet
                    ? 'border-status-info bg-status-info/10'
                    : 'border-slate-700 hover:border-slate-600 bg-slate-950'
                }`}
              >
                <div className="flex items-center gap-2">
                  <WalletIcon className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-mono text-slate-200">Your Wallet</span>
                  {useWallet && <Check className="w-3.5 h-3.5 text-status-info ml-auto" />}
                </div>
              </button>
            )}

            {/* Pool Options */}
            {allowedPools.pools.map((pool) => (
              <button
                key={pool.poolId}
                type="button"
                onClick={() => {
                  if (mode === 'deposit') {
                    setSelectedSource(pool.poolId);
                  } else {
                    setSelectedTarget(pool.poolId);
                  }
                  setUseWallet(false);
                }}
                className={`w-full p-3 border text-left transition-colors ${
                  (mode === 'deposit' ? selectedSource === pool.poolId : selectedTarget === pool.poolId)
                    ? 'border-status-info bg-status-info/10'
                    : 'border-slate-700 hover:border-slate-600 bg-slate-950'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-mono text-slate-200">{poolLabel(pool)}</p>
                    <p className="text-[10px] text-slate-500 font-mono">
                      {pool.poolAddress.slice(0, 12)}...
                    </p>
                  </div>
                  {((mode === 'deposit' && selectedSource === pool.poolId) || 
                    (mode === 'withdraw' && selectedTarget === pool.poolId)) && (
                    <Check className="w-3.5 h-3.5 text-status-info" />
                  )}
                </div>
              </button>
            ))}

            {allowedPools.pools.length === 0 && !allowedPools.allowWallet && (
              <div className="p-3 border border-status-warning/30 bg-status-warning/5">
                <p className="text-[10px] text-status-warning font-mono">
                  No valid {mode === 'deposit' ? 'sources' : 'targets'} available
                </p>
              </div>
            )}
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <label className="text-[10px] text-slate-500 font-mono uppercase">Amount (USDC)</label>
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 text-sm font-mono text-slate-100 placeholder:text-slate-600 focus:border-status-info focus:outline-none"
              disabled={isProcessing}
            />
          </div>

          {/* Flow Visualization */}
          {(selectedSource || selectedTarget || useWallet) && amount && (
            <div className="p-3 border border-slate-700 bg-slate-950">
              <p className="text-[10px] text-slate-500 font-mono mb-2">TRANSFER FLOW</p>
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-slate-400">
                  {mode === 'deposit' 
                    ? (useWallet ? 'Wallet' : allowedPools.pools.find(p => p.poolId === selectedSource)?.type || 'Source')
                    : targetPool.type}
                </span>
                <ArrowRight className="w-3 h-3 text-slate-600" />
                <span className="text-status-info">{amount} USDC</span>
                <ArrowRight className="w-3 h-3 text-slate-600" />
                <span className="text-slate-400">
                  {mode === 'deposit'
                    ? targetPool.type
                    : (useWallet ? 'Wallet' : allowedPools.pools.find(p => p.poolId === selectedTarget)?.type || 'Target')}
                </span>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 border border-status-critical/30 bg-status-critical/10 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-status-critical flex-shrink-0" />
              <span className="text-xs text-status-critical font-mono">{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="flex-1 py-2 border border-slate-700 bg-slate-900 text-slate-400 text-xs font-mono hover:border-slate-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isProcessing || !amount || (!useWallet && !selectedSource && !selectedTarget)}
              className="flex-1 py-2 bg-status-info text-white text-xs font-mono flex items-center justify-center gap-2 hover:bg-status-info/80 disabled:opacity-50 transition-colors"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>Transfer</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
