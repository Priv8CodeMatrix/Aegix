'use client';

/**
 * StealthPoolChannel Component - Aegix v4.0 Hierarchical Pool Management
 * 
 * Pool Hierarchy (All Compressed via Light Protocol):
 * - LEGACY Pool: Initial compressed pool, funded directly from wallet
 * - MAIN Pool: Agent bridge, funded ONLY from Legacy Pool
 * - CUSTOM Pools: Agent-specific, funded ONLY from Main Pool
 * 
 * Agents link ONLY to Main or Custom pools, never Legacy.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Transaction, Connection } from '@solana/web3.js';
import { 
  Shield, 
  Plus, 
  Loader2, 
  ExternalLink, 
  Copy, 
  Check, 
  RefreshCw,
  Database,
  Users,
  Wallet,
  Lock,
  AlertTriangle,
  X,
  ChevronDown,
  ChevronRight,
  Settings,
  Unlink,
  Cpu,
  Key,
  Trash2,
  Edit3,
  Save,
  DollarSign,
  Activity,
  ShieldCheck,
  Eye,
  EyeOff,
  ArrowDown,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import { 
  getAllPools, 
  getLegacyPool,
  getMainPool,
  getCustomPools,
  createCustomPool, 
  confirmCustomPool,
  getOrCreateMainPool,
  fundPoolFromPool,
  transferFunds,
  shieldFunds,
  deletePool,
  updatePoolName,
  exportPoolKey,
  getPoolStats,
  unlinkAgentFromPool,
  updateAgentBudgetFromPool,
  getLightHealth,
  getLightCostEstimate,
  refreshPoolBalance,
  canCreateMainPool,
  POOL_THRESHOLDS,
  type PoolData,
  type PoolType,
  type LightCostEstimate
} from '@/lib/gateway';
import { TransferModal } from './TransferModal';
import { RecoveryPoolPanel } from './RecoveryPoolPanel';

interface StealthPoolChannelProps {
  onLog?: (level: 'info' | 'success' | 'error' | 'warning', message: string) => void;
  onRefresh?: () => void;
  globalRefresh?: () => Promise<void>;
}

interface PoolStats {
  lifetimeTxCount: number;
  lifetimeVolume: number;
  last24hTxCount: number;
}

interface ExportKeyState {
  isOpen: boolean;
  poolId: string | null;
  privateKeyBase58: string | null;
  publicKey: string | null;
  poolAddress: string | null;
  format: string | null;
  importGuide: string | null;
  isLoading: boolean;
  expiresAt: number | null;
  showKey: boolean;
}

interface AgentBudgetEdit {
  agentId: string;
  maxPerTransaction: string;
  dailyLimit: string;
}

interface TransferModalState {
  isOpen: boolean;
  mode: 'deposit' | 'withdraw';
  targetPool: PoolData | null;
}

interface ShieldModalState {
  isOpen: boolean;
  pool: PoolData | null;
  amount: string;
  isShielding: boolean;
  availableBalance: number;
}

export function StealthPoolChannel({ onLog, onRefresh, globalRefresh }: StealthPoolChannelProps) {
  const { publicKey, signMessage, signTransaction, sendTransaction, connected } = useWallet();
  
  // Pool state
  const [pools, setPools] = useState<PoolData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedPoolId, setExpandedPoolId] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  
  // Transfer modal state
  const [transferModal, setTransferModal] = useState<TransferModalState>({
    isOpen: false,
    mode: 'deposit',
    targetPool: null,
  });
  const [isTransferring, setIsTransferring] = useState(false);
  
  // Shield modal state
  const [shieldModal, setShieldModal] = useState<ShieldModalState>({
    isOpen: false,
    pool: null,
    amount: '',
    isShielding: false,
    availableBalance: 0,
  });
  
  // Creation state
  const [isCreating, setIsCreating] = useState(false);
  const [createStep, setCreateStep] = useState<'idle' | 'signing' | 'broadcasting' | 'confirming'>('idle');
  const [isCreatingMain, setIsCreatingMain] = useState(false);
  
  // Funding state
  const [fundingSource, setFundingSource] = useState<string | null>(null);
  const [fundingTarget, setFundingTarget] = useState<string | null>(null);
  const [fundingAmount, setFundingAmount] = useState('');
  const [isFunding, setIsFunding] = useState(false);
  
  // Advanced state
  const [poolStats, setPoolStats] = useState<Record<string, PoolStats>>({});
  const [editingNamePoolId, setEditingNamePoolId] = useState<string | null>(null);
  const [newPoolName, setNewPoolName] = useState('');
  const [isUpdatingName, setIsUpdatingName] = useState(false);
  const [isDeletingPool, setIsDeletingPool] = useState<string | null>(null);
  const [exportKeyState, setExportKeyState] = useState<ExportKeyState>({
    isOpen: false,
    poolId: null,
    privateKeyBase58: null,
    publicKey: null,
    poolAddress: null,
    format: null,
    importGuide: null,
    isLoading: false,
    expiresAt: null,
    showKey: false,
  });
  const [agentBudgetEdit, setAgentBudgetEdit] = useState<AgentBudgetEdit | null>(null);
  const [isUnlinkingAgent, setIsUnlinkingAgent] = useState<string | null>(null);
  const [isUpdatingBudget, setIsUpdatingBudget] = useState(false);
  
  // Compression status
  const [lightHealth, setLightHealth] = useState<{ healthy: boolean; features?: string[] } | null>(null);
  const [lightCostEstimate, setLightCostEstimate] = useState<LightCostEstimate | null>(null);
  const [isLoadingLight, setIsLoadingLight] = useState(false);

  // Computed pool hierarchy
  const legacyPool = useMemo(() => getLegacyPool(pools), [pools]);
  const mainPool = useMemo(() => getMainPool(pools), [pools]);
  const customPools = useMemo(() => getCustomPools(pools), [pools]);
  const agentPools = useMemo(() => [...(mainPool ? [mainPool] : []), ...customPools], [mainPool, customPools]);
  
  // Check if Main Pool can be created
  const mainPoolStatus = useMemo(() => canCreateMainPool(legacyPool), [legacyPool]);

  // Load compression status
  const loadLightStatus = useCallback(async () => {
    setIsLoadingLight(true);
    try {
      const [health, costs] = await Promise.all([
        getLightHealth(),
        getLightCostEstimate(100),
      ]);
      setLightHealth(health);
      setLightCostEstimate(costs);
    } catch (err) {
      console.error('Failed to load compression status:', err);
    } finally {
      setIsLoadingLight(false);
    }
  }, []);

  useEffect(() => {
    loadLightStatus();
  }, [loadLightStatus]);

  // Load pools with balance refresh
  const loadPools = useCallback(async (forceRefresh = false) => {
    if (!publicKey) {
      setPools([]);
      setIsLoading(false);
      return;
    }

    try {
      const poolList = await getAllPools(publicKey.toBase58());
      
      // If force refresh, update balances for each pool
      if (forceRefresh && poolList.length > 0) {
        const updatedPools = await Promise.all(
          poolList.map(async (pool) => {
            try {
              const freshBalance = await refreshPoolBalance(pool.poolAddress);
              if (freshBalance) {
                return { ...pool, balance: freshBalance };
              }
            } catch (err) {
              console.warn(`Failed to refresh balance for ${pool.poolId}:`, err);
            }
            return pool;
          })
        );
        setPools(updatedPools);
      } else {
        setPools(poolList);
      }
    } catch (err: any) {
      console.error('[StealthPoolChannel] Failed to load pools:', err);
      setError(err.message || 'Failed to load pools');
    } finally {
      setIsLoading(false);
    }
  }, [publicKey]);

  // Initial load
  useEffect(() => {
    if (connected && publicKey) {
      loadPools();
    }
  }, [connected, publicKey, loadPools]);

  // Auto-refresh polling every 60 seconds (throttled to prevent 429)
  useEffect(() => {
    if (!connected || !publicKey) return;
    
    const interval = setInterval(() => {
      // Silently refresh using cached/throttled data
      loadPools(false);
    }, 60000); // 60 seconds - throttled for stability
    
    return () => clearInterval(interval);
  }, [connected, publicKey, loadPools]);

  // Refresh pools with force balance update
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadPools(true); // Force refresh balances
    await loadLightStatus();
    setIsRefreshing(false);
    onRefresh?.();
  };

  // Copy to clipboard
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    onLog?.('info', 'Copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Create Custom Pool (funded from Main Pool)
  const handleCreateCustomPool = async () => {
    if (!publicKey || !signMessage || !signTransaction || !sendTransaction) {
      setError('Wallet not connected');
      return;
    }

    // Check if Main Pool exists
    if (!mainPool) {
      setError('Create Main Pool first before creating Custom Pools');
      return;
    }

    setIsCreating(true);
    setCreateStep('signing');
    setError(null);
    onLog?.('info', 'Creating Custom Pool...');

    try {
      const timestamp = Date.now();
      const message = `AEGIX_CUSTOM_POOL::${publicKey.toBase58()}::${timestamp}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signature = await signMessage(encodedMessage);
      const signatureBase64 = Buffer.from(signature).toString('base64');

      onLog?.('info', 'Preparing transaction...');
      const result = await createCustomPool(
        publicKey.toBase58(),
        signatureBase64,
        message
      );

      if (!result.transaction) {
        throw new Error('No transaction returned');
      }

      setCreateStep('broadcasting');
      onLog?.('info', `Signing (${result.rentRequired.toFixed(4)} SOL)...`);
      
      const transaction = Transaction.from(Buffer.from(result.transaction, 'base64'));
      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
        'confirmed'
      );
      
      const txSignature = await sendTransaction(transaction, connection);
      onLog?.('info', `Broadcast: ${txSignature.slice(0, 16)}...`);
      
      setCreateStep('confirming');
      await connection.confirmTransaction(txSignature, 'confirmed');
      
      const confirmed = await confirmCustomPool(
        result.poolId,
        txSignature,
        publicKey.toBase58()
      );
      
      onLog?.('success', `Pool created: ${confirmed.poolAddress.slice(0, 12)}...`);
      
      setRefreshMessage('Refreshing...');
      await new Promise(resolve => setTimeout(resolve, 500));
      await loadPools();
      if (globalRefresh) await globalRefresh();
      setRefreshMessage(null);
      onRefresh?.();
      
    } catch (err: any) {
      console.error('Failed to create pool:', err);
      setError(err.message || 'Failed to create pool');
      onLog?.('error', err.message);
    } finally {
      setIsCreating(false);
      setCreateStep('idle');
      setRefreshMessage(null);
    }
  };

  // Create Main Pool (auto-create for agents)
  const handleCreateMainPool = async () => {
    if (!publicKey || !signMessage || !signTransaction || !sendTransaction) {
      setError('Wallet not connected');
      return;
    }

    // Check if Legacy Pool can create Main Pool
    if (!mainPoolStatus.canCreate) {
      setError(mainPoolStatus.reason || 'Cannot create Main Pool');
      return;
    }

    setIsCreatingMain(true);
    setError(null);
    onLog?.('info', 'Creating Main Pool...');

    try {
      const timestamp = Date.now();
      const message = `AEGIX_MAIN_POOL::${publicKey.toBase58()}::${timestamp}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signature = await signMessage(encodedMessage);
      const signatureBase64 = Buffer.from(signature).toString('base64');

      const result = await getOrCreateMainPool(
        publicKey.toBase58(),
        signatureBase64,
        message
      );

      if (result.created && result.transaction) {
        onLog?.('info', 'Signing Main Pool creation...');
        const transaction = Transaction.from(Buffer.from(result.transaction, 'base64'));
        const connection = new Connection(
          process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
          'confirmed'
        );
        
        const txSignature = await sendTransaction(transaction, connection);
        onLog?.('info', `Broadcast: ${txSignature.slice(0, 16)}...`);
        
        await connection.confirmTransaction(txSignature, 'confirmed');
        
        // Confirm and persist the Main Pool
        const confirmed = await confirmCustomPool(
          result.poolId,
          txSignature,
          publicKey.toBase58()
        );
        
        onLog?.('success', `Main Pool created: ${confirmed.poolAddress.slice(0, 12)}...`);
      } else {
        onLog?.('info', 'Main Pool already exists');
      }

      await loadPools();
      if (globalRefresh) await globalRefresh();
      onRefresh?.();
      
    } catch (err: any) {
      console.error('Failed to create Main Pool:', err);
      setError(err.message || 'Failed to create Main Pool');
      onLog?.('error', err.message);
    } finally {
      setIsCreatingMain(false);
    }
  };

  // Fund pool from another pool
  const handleFundPool = async () => {
    if (!publicKey || !signMessage || !fundingSource || !fundingTarget || !fundingAmount) {
      return;
    }

    const sourcePool = pools.find(p => p.poolId === fundingSource);
    const targetPool = pools.find(p => p.poolId === fundingTarget);
    
    if (!sourcePool || !targetPool) {
      setError('Invalid pools');
      return;
    }

    // Validate hierarchy
    if (sourcePool.type === 'LEGACY' && targetPool.type !== 'MAIN') {
      setError('Legacy Pool can only fund Main Pool');
      return;
    }
    if (sourcePool.type === 'MAIN' && targetPool.type !== 'CUSTOM') {
      setError('Main Pool can only fund Custom Pools');
      return;
    }
    if (sourcePool.type === 'CUSTOM') {
      setError('Custom Pools cannot fund other pools');
      return;
    }

    setIsFunding(true);
    setError(null);
    
    try {
      const timestamp = Date.now();
      const message = `AEGIX_FUND_POOL::${fundingSource}::${fundingTarget}::${fundingAmount}::${timestamp}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signature = await signMessage(encodedMessage);
      const signatureBase64 = Buffer.from(signature).toString('base64');

      onLog?.('info', `Funding ${targetPool.type} Pool from ${sourcePool.type}...`);
      
      const result = await fundPoolFromPool(
        fundingSource,
        fundingTarget,
        fundingAmount,
        publicKey.toBase58(),
        signatureBase64
      );

      onLog?.('success', `Funded: ${result.txSignature.slice(0, 16)}...`);
      
      setFundingSource(null);
      setFundingTarget(null);
      setFundingAmount('');
      await loadPools();
      
    } catch (err: any) {
      setError(err.message || 'Funding failed');
      onLog?.('error', err.message);
    } finally {
      setIsFunding(false);
    }
  };

  // Toggle pool expansion
  const togglePoolExpansion = async (poolId: string) => {
    if (expandedPoolId === poolId) {
      setExpandedPoolId(null);
    } else {
      setExpandedPoolId(poolId);
      if (publicKey && !poolStats[poolId]) {
        try {
          const stats = await getPoolStats(poolId, publicKey.toBase58());
          setPoolStats(prev => ({ ...prev, [poolId]: stats }));
        } catch (err) {
          console.error('Failed to load pool stats:', err);
        }
      }
    }
  };

  // Delete pool (only CUSTOM pools)
  const handleDeletePool = async (poolId: string, poolType: PoolType) => {
    if (poolType !== 'CUSTOM') {
      setError(`${poolType} Pool cannot be deleted`);
      return;
    }
    
    if (!publicKey || !signMessage) {
      setError('Wallet not connected');
      return;
    }
    
    setIsDeletingPool(poolId);
    try {
      const message = `AEGIX_DELETE_POOL::${poolId}::${publicKey.toBase58()}::${Date.now()}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signature = await signMessage(encodedMessage);
      const signatureBase64 = Buffer.from(signature).toString('base64');
      
      const result = await deletePool(poolId, publicKey.toBase58(), signatureBase64);
      if (result.success) {
        onLog?.('success', `Pool deleted: ${poolId.slice(0, 12)}...`);
        await loadPools();
      } else {
        setError(result.error || 'Failed to delete pool');
      }
    } catch (err: any) {
      if (!err.message?.includes('rejected')) {
        setError(err.message);
        onLog?.('error', err.message);
      }
    } finally {
      setIsDeletingPool(null);
    }
  };

  // Export pool key
  const handleExportKey = async (poolId: string, poolType: PoolType) => {
    if (!publicKey || !signMessage) return;
    
    setExportKeyState(prev => ({ ...prev, isLoading: true, poolId }));
    
    try {
      const message = `AEGIX_EXPORT_KEY::${poolId}::${publicKey.toBase58()}::${Date.now()}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signature = await signMessage(encodedMessage);
      const signatureBase64 = Buffer.from(signature).toString('base64');

      const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';
      const response = await fetch(`${GATEWAY_URL}/api/credits/pool/export-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          signature: signatureBase64,
          message,
          poolId,
        }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error);

      setExportKeyState({
        isOpen: true,
        poolId,
        privateKeyBase58: data.data.privateKeyBase58,
        publicKey: data.data.publicKey,
        poolAddress: data.data.poolAddress,
        format: data.data.format,
        importGuide: data.data.importGuide,
        isLoading: false,
        expiresAt: Date.now() + 60000,
        showKey: false,
      });
    } catch (err: any) {
      setError(err.message);
      setExportKeyState(prev => ({ ...prev, isLoading: false }));
    }
  };

  // Close export modal
  const closeExportModal = () => {
    setExportKeyState({
      isOpen: false,
      poolId: null,
      privateKeyBase58: null,
      publicKey: null,
      poolAddress: null,
      format: null,
      importGuide: null,
      isLoading: false,
      expiresAt: null,
      showKey: false,
    });
  };

  // Handle transfer (deposit/withdraw)
  const handleTransfer = async (sourceId: string, targetId: string, amount: string, isWalletTransfer: boolean) => {
    if (!publicKey || !signMessage || !sendTransaction) {
      throw new Error('Wallet not connected');
    }

    setIsTransferring(true);
    
    try {
      const timestamp = Date.now();
      const message = `AEGIX_TRANSFER::${sourceId}::${targetId}::${amount}::${timestamp}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(encodedMessage);
      const signature = Buffer.from(signatureBytes).toString('base64');

      const isWalletSource = sourceId === 'wallet';
      const isWalletTarget = targetId === 'wallet';

      const result = await transferFunds(
        sourceId,
        targetId,
        amount,
        publicKey.toBase58(),
        signature,
        message,
        isWalletSource,
        isWalletTarget
      );

      if (result.success) {
        onLog?.('success', `Transferred ${amount} USDC successfully`);
        
        // Refresh balances
        setRefreshMessage('Updating balances...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        await loadPools(true); // Force refresh
        setRefreshMessage(null);
        
        if (globalRefresh) await globalRefresh();
        onRefresh?.();
      }
    } catch (err: any) {
      console.error('Transfer failed:', err);
      onLog?.('error', err.message || 'Transfer failed');
      throw err;
    } finally {
      setIsTransferring(false);
    }
  };

  // Shield (compress) funds for compressed payments
  const handleShield = async (poolId: string, amount: string) => {
    if (!publicKey || !signTransaction) {
      throw new Error('Wallet not connected');
    }

    setShieldModal(prev => ({ ...prev, isShielding: true }));
    
    try {
      const result = await shieldFunds(poolId, amount, publicKey.toBase58());

      if (!result.success) {
        throw new Error(result.error || 'Failed to shield funds');
      }

      // Get unsigned transaction
      if (result.requiresPayment && result.paymentRequired) {
        throw new Error('x402 gasless flow not yet implemented for shielding');
      }

      // For now, assume we get a transaction to sign
      const txData = await fetch(`${process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001'}/api/credits/pool/shield`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poolId, amountUsdc: amount, owner: publicKey.toBase58() }),
      }).then(r => r.json());

      if (!txData.success || !txData.data?.transaction) {
        throw new Error(txData.error || 'Failed to build shield transaction');
      }

      // Deserialize and sign transaction
      const txBuffer = Buffer.from(txData.data.transaction, 'base64');
      const transaction = Transaction.from(txBuffer);

      onLog?.('info', 'Sign the transaction to compress your USDC...');
      const signed = await signTransaction(transaction);

      // Send transaction
      const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
      const signature = await connection.sendRawTransaction(signed.serialize());
      
      onLog?.('info', 'Confirming compression transaction...');
      await connection.confirmTransaction(signature, 'confirmed');

      onLog?.('success', `Successfully compressed ${amount} USDC! Compressed payments now enabled (~50x cheaper)`);
      
      // Refresh balances
      setRefreshMessage('Updating compressed balance...');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for indexing
      await loadPools(true);
      setRefreshMessage(null);
      
      if (globalRefresh) await globalRefresh();
      onRefresh?.();
      
      // Close modal
      setShieldModal({
        isOpen: false,
        pool: null,
        amount: '',
        isShielding: false,
        availableBalance: 0,
      });
    } catch (err: any) {
      console.error('Shield failed:', err);
      onLog?.('error', err.message || 'Failed to shield funds');
      throw err;
    } finally {
      setShieldModal(prev => ({ ...prev, isShielding: false }));
    }
  };

  // Open shield modal
  const openShieldModal = (pool: PoolData) => {
    const availableBalance = pool.balance?.usdc || 0;
    setShieldModal({
      isOpen: true,
      pool,
      amount: availableBalance.toFixed(2),
      isShielding: false,
      availableBalance,
    });
  };

  // Close shield modal
  const closeShieldModal = () => {
    setShieldModal({
      isOpen: false,
      pool: null,
      amount: '',
      isShielding: false,
      availableBalance: 0,
    });
  };

  // Open transfer modal
  const openTransferModal = (mode: 'deposit' | 'withdraw', pool: PoolData) => {
    setTransferModal({
      isOpen: true,
      mode,
      targetPool: pool,
    });
  };

  // Close transfer modal
  const closeTransferModal = () => {
    setTransferModal({
      isOpen: false,
      mode: 'deposit',
      targetPool: null,
    });
  };

  // Unlink agent from pool
  const handleUnlinkAgent = async (agentId: string, poolId: string) => {
    if (!publicKey || !signMessage) return;
    
    setIsUnlinkingAgent(agentId);
    try {
      const message = `AEGIX_UNLINK_AGENT::${agentId}::${poolId}::${Date.now()}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signature = await signMessage(encodedMessage);
      const signatureBase64 = Buffer.from(signature).toString('base64');
      
      const result = await unlinkAgentFromPool(agentId, poolId, publicKey.toBase58(), signatureBase64);
      if (result.success) {
        onLog?.('success', 'Agent unlinked');
        await loadPools();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUnlinkingAgent(null);
    }
  };

  // Get creation step label
  const getCreateStepLabel = () => {
    switch (createStep) {
      case 'signing': return 'Signing...';
      case 'broadcasting': return 'Broadcasting...';
      case 'confirming': return 'Confirming...';
      default: return 'Creating...';
    }
  };

  // Get pool type badge color
  const getTypeBadgeClass = (type: PoolType) => {
    switch (type) {
      case 'LEGACY': return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'MAIN': return 'bg-status-info/10 text-status-info border-status-info/30';
      case 'CUSTOM': return 'bg-status-success/10 text-status-success border-status-success/30';
    }
  };

  // Get status badge - NEVER show "SETUP" for funded pools
  const getStatusBadge = (status?: string, balance?: { sol: number; usdc: number } | null) => {
    // Check actual balance, not cached status
    const hasSol = balance && balance.sol >= POOL_THRESHOLDS.MIN_SOL_FOR_OPERATIONS;
    const hasUsdc = balance && balance.usdc >= POOL_THRESHOLDS.MIN_USDC_FUNDED;
    
    if (hasSol || hasUsdc) {
      // Pool has funds - show Ready or Low Balance
      if (balance && balance.usdc < POOL_THRESHOLDS.LOW_BALANCE_USDC && balance.sol < POOL_THRESHOLDS.MIN_SOL_FOR_OPERATIONS) {
        return <span className="text-[9px] text-status-warning font-mono">Low Balance</span>;
      }
      return <span className="text-[9px] text-status-success font-mono">Ready</span>;
    }
    
    // No funds
    return <span className="text-[9px] text-slate-500 font-mono">Unfunded</span>;
  };
  
  // Check if Legacy Pool is properly funded
  const isLegacyFunded = useMemo(() => {
    if (!legacyPool?.balance) return false;
    return legacyPool.balance.sol >= POOL_THRESHOLDS.MIN_SOL_FOR_OPERATIONS || 
           legacyPool.balance.usdc >= POOL_THRESHOLDS.MIN_USDC_FUNDED;
  }, [legacyPool]);

  // Not connected
  if (!connected || !publicKey) {
    return (
      <div className="p-8 border border-slate-800 text-center">
        <Lock className="w-8 h-8 text-slate-600 mx-auto mb-3" />
        <p className="text-xs text-slate-500 font-mono">WALLET_NOT_CONNECTED</p>
        <p className="text-[10px] text-slate-600 mt-1">
          Connect your wallet to view pools
        </p>
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <Loader2 className="w-6 h-6 text-slate-500 mx-auto mb-2 animate-spin" />
        <p className="text-xs text-slate-500 font-mono">Loading pools...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-medium text-slate-300 font-mono">STEALTH_POOL_CHANNEL</span>
          <span className="text-[10px] text-slate-600 font-mono">({pools.length} pools)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 hover:bg-slate-800 transition-colors border border-slate-700"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleCreateCustomPool}
            disabled={isCreating || !mainPool}
            className="px-3 py-1.5 bg-status-info text-white text-xs font-mono flex items-center gap-1.5 disabled:opacity-50 hover:bg-status-info/80 transition-colors"
            title={!mainPool ? 'Create Main Pool first' : 'Create Custom Pool'}
          >
            {isCreating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {getCreateStepLabel()}
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                CREATE_POOL
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 border border-status-critical/30 bg-status-critical/10 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-status-critical flex-shrink-0" />
          <span className="text-xs text-status-critical font-mono flex-1">{error}</span>
          <button onClick={() => setError(null)}>
            <X className="w-3.5 h-3.5 text-status-critical" />
          </button>
        </div>
      )}

      {/* Compression Status */}
      {lightHealth && (
        <div className="p-2.5 border border-slate-700 bg-slate-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${lightHealth.healthy ? 'bg-status-success' : 'bg-status-error'}`} />
            <span className="text-[10px] font-mono text-slate-400">
              Compressed • {lightHealth.healthy ? 'Online' : 'Offline'}
            </span>
            {lightCostEstimate && lightHealth.healthy && (
              <span className="text-[10px] text-status-success font-mono">
                ~{lightCostEstimate.forPayments.savingsMultiplier}x cheaper
              </span>
            )}
          </div>
          {lightCostEstimate && (
            <span className="text-[10px] text-slate-500 font-mono">
              {lightCostEstimate.perPayment.light}/payment
            </span>
          )}
        </div>
      )}

      {/* Refresh Message */}
      {refreshMessage && (
        <div className="p-3 border border-status-info/30 bg-status-info/10 flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-status-info animate-spin flex-shrink-0" />
          <span className="text-xs text-status-info font-mono">{refreshMessage}</span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* LEGACY POOL CARD - Dedicated Section */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {legacyPool ? (
        <div className="border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-mono text-amber-400">LEGACY_POOL</span>
              <span className="px-2 py-0.5 text-[9px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/30">
                LEGACY
              </span>
              <span className="text-[10px] text-status-success font-mono">~50x cheaper</span>
            </div>
            {getStatusBadge(legacyPool.status, legacyPool.balance)}
          </div>
          
          <div className="grid grid-cols-4 gap-4 mb-3">
            <div>
              <p className="text-[9px] text-slate-500 font-mono mb-1">ADDRESS</p>
              <div className="flex items-center gap-1">
                <code className="text-[10px] text-slate-400 font-mono truncate max-w-[120px]">
                  {legacyPool.poolAddress}
                </code>
                <button onClick={() => handleCopy(legacyPool.poolAddress, 'legacy-addr')} className="p-0.5">
                  {copiedId === 'legacy-addr' ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3 text-slate-500" />}
                </button>
              </div>
            </div>
            <div>
              <p className="text-[9px] text-slate-500 font-mono mb-1">USDC</p>
              <p className="text-sm font-mono text-slate-200">
                {legacyPool.balance?.usdc?.toFixed(2) || '0.00'}
              </p>
            </div>
            <div>
              <p className="text-[9px] text-slate-500 font-mono mb-1">SOL</p>
              <p className="text-sm font-mono text-slate-200">
                {legacyPool.balance?.sol?.toFixed(4) || '0.0000'}
              </p>
            </div>
            <div>
              <p className="text-[9px] text-slate-500 font-mono mb-1">FUNDS TO</p>
              <div className="flex items-center gap-1">
                <ArrowRight className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] text-amber-400 font-mono">MAIN POOL</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-amber-500/20">
            <a
              href={`https://solscan.io/account/${legacyPool.poolAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-1 text-[10px] font-mono text-slate-400 border border-slate-700 hover:border-slate-600 flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              View
            </a>
            <button
              onClick={() => openTransferModal('deposit', legacyPool)}
              className="px-2 py-1 text-[10px] font-mono text-status-success border border-status-success/30 hover:border-status-success/50 flex items-center gap-1"
            >
              <ArrowDown className="w-3 h-3" />
              Deposit
            </button>
            <button
              onClick={() => openTransferModal('withdraw', legacyPool)}
              disabled={!legacyPool.balance || legacyPool.balance.usdc === 0}
              className="px-2 py-1 text-[10px] font-mono text-status-warning border border-status-warning/30 hover:border-status-warning/50 flex items-center gap-1 disabled:opacity-50"
            >
              <Wallet className="w-3 h-3" />
              Withdraw
            </button>
            {legacyPool.balance && legacyPool.balance.usdc > 0 && (legacyPool.balance.compressedUsdc === undefined || legacyPool.balance.compressedUsdc === 0) && (
              <button
                onClick={() => openShieldModal(legacyPool)}
                className="px-2 py-1 text-[10px] font-mono text-purple-400 border border-purple-500/30 hover:border-purple-500/50 flex items-center gap-1 group"
                title="Compress USDC for 50x cheaper payments"
              >
                <ShieldCheck className="w-3 h-3 group-hover:animate-pulse" />
                Shield
              </button>
            )}
            <button
              onClick={() => handleExportKey(legacyPool.poolId, 'LEGACY')}
              disabled={exportKeyState.isLoading}
              className="px-2 py-1 text-[10px] font-mono text-slate-400 border border-slate-700 hover:border-slate-600 flex items-center gap-1"
            >
              <Key className="w-3 h-3" />
              Export Key
            </button>
          </div>
        </div>
      ) : (
        <div className="border border-slate-700 bg-slate-900 p-6 text-center">
          <Database className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-xs text-slate-500 font-mono mb-1">NO_LEGACY_POOL</p>
          <p className="text-[10px] text-slate-600 mb-4">
            Initialize your Legacy Pool to start using stealth payments
          </p>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* RECOVERY POOL - Dedicated Fee Payer for Privacy */}
      {/* Always show - users can initialize even before Legacy Pool */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <RecoveryPoolPanel 
        onLog={onLog}
        onRefresh={handleRefresh}
      />

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MAIN POOL + CUSTOM POOLS - For Agents */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="border border-slate-800">
        <div className="bg-slate-900 border-b border-slate-800 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-mono text-slate-400">AGENT_POOLS</span>
            <span className="text-[10px] text-slate-600 font-mono">({agentPools.length})</span>
          </div>
          {/* Show Create Main Pool button if Legacy exists and Main doesn't */}
          {!mainPool && legacyPool && (
            <button
              onClick={handleCreateMainPool}
              disabled={isCreatingMain || !mainPoolStatus.canCreate}
              className={`px-2 py-1 text-[10px] font-mono border flex items-center gap-1 disabled:opacity-50 ${
                mainPoolStatus.canCreate 
                  ? 'text-status-info border-status-info/30 hover:border-status-info/50' 
                  : 'text-slate-500 border-slate-700'
              }`}
              title={mainPoolStatus.reason || 'Create Main Pool'}
            >
              {isCreatingMain ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create Main Pool
            </button>
          )}
        </div>

        {/* Info message when no Main Pool */}
        {!mainPool && legacyPool && !mainPoolStatus.canCreate && (
          <div className="p-3 border-b border-slate-800 bg-slate-900/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-status-warning font-mono">
                  {mainPoolStatus.reason}
                </p>
                {mainPoolStatus.needed && (
                  <p className="text-[9px] text-slate-500 font-mono mt-1">
                    Add {mainPoolStatus.needed.sol?.toFixed(4)} SOL to Legacy Pool
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Prominent Main Pool Creation Card - shown when no Main exists */}
        {!mainPool && legacyPool && mainPoolStatus.canCreate && (
          <div className="p-4 border-b border-slate-800 bg-gradient-to-r from-status-info/5 to-transparent">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-status-info/10 rounded-sm border border-status-info/20">
                  <Cpu className="w-5 h-5 text-status-info" />
                </div>
                <div>
                  <p className="text-sm font-mono text-slate-200">Create Main Pool</p>
                  <p className="text-[10px] text-slate-500">
                    Shared agent bridge • Required for agent payments • ~50x cheaper
                  </p>
                </div>
              </div>
              <button
                onClick={handleCreateMainPool}
                disabled={isCreatingMain}
                className="px-4 py-2 bg-status-info text-white text-xs font-mono flex items-center gap-2 hover:bg-status-info/80 disabled:opacity-50 transition-colors"
              >
                {isCreatingMain ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    CREATE_MAIN_POOL
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {agentPools.length === 0 && !(!mainPool && legacyPool && mainPoolStatus.canCreate) ? (
          <div className="p-6 text-center">
            <p className="text-[10px] text-slate-600 font-mono">
              {!legacyPool ? 'Initialize Legacy Pool first' : 
               !mainPoolStatus.canCreate ? mainPoolStatus.reason :
               'No agent pools yet'}
            </p>
          </div>
        ) : agentPools.length === 0 ? null : (
          <>
            {/* Table Header */}
            <div className="bg-slate-900/50 border-b border-slate-800">
              <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[9px] font-mono text-slate-500 uppercase tracking-wider">
                <div className="col-span-1"></div>
                <div className="col-span-2">Pool_ID</div>
                <div className="col-span-3">Address</div>
                <div className="col-span-1">Type</div>
                <div className="col-span-1">Agents</div>
                <div className="col-span-2">USDC</div>
                <div className="col-span-2">SOL</div>
              </div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-slate-800">
              {agentPools.map((pool) => {
                const isExpanded = expandedPoolId === pool.poolId;
                const stats = poolStats[pool.poolId];
                
                return (
                  <div key={pool.poolId} className="bg-slate-950">
                    {/* Row */}
                    <div 
                      className="grid grid-cols-12 gap-2 px-3 py-3 text-xs hover:bg-slate-900/50 cursor-pointer"
                      onClick={() => togglePoolExpansion(pool.poolId)}
                    >
                      {/* Expand */}
                      <div className="col-span-1 flex items-center">
                        <button className="p-1">
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                          )}
                        </button>
                      </div>

                      {/* Pool ID */}
                      <div className="col-span-2 flex items-center">
                        <code className="text-[10px] text-slate-400 font-mono truncate">
                          {pool.poolId.slice(0, 12)}...
                        </code>
                      </div>

                      {/* Address */}
                      <div className="col-span-3 flex items-center gap-1">
                        <code className="text-[10px] text-slate-400 font-mono truncate max-w-[140px]">
                          {pool.poolAddress}
                        </code>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleCopy(pool.poolAddress, pool.poolId); }}
                          className="p-0.5"
                        >
                          {copiedId === pool.poolId ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3 text-slate-500" />}
                        </button>
                      </div>

                      {/* Type */}
                      <div className="col-span-1 flex items-center">
                        <span className={`px-1.5 py-0.5 text-[9px] font-mono border ${getTypeBadgeClass(pool.type)}`}>
                          {pool.type}
                        </span>
                      </div>

                      {/* Agents */}
                      <div className="col-span-1 flex items-center gap-1">
                        <Users className="w-3 h-3 text-slate-500" />
                        <span className="text-slate-400 font-mono">{pool.agentCount}</span>
                      </div>

                      {/* USDC */}
                      <div className="col-span-2 flex items-center">
                        <span className="text-slate-200 font-mono">
                          {pool.balance?.usdc?.toFixed(2) || '0.00'}
                        </span>
                      </div>

                      {/* SOL */}
                      <div className="col-span-2 flex items-center justify-between">
                        <span className="text-slate-300 font-mono">
                          {pool.balance?.sol?.toFixed(4) || '0.0000'}
                        </span>
                        {getStatusBadge(pool.status, pool.balance)}
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="bg-slate-900/30 border-t border-slate-800 px-4 py-4">
                        <div className="grid grid-cols-2 gap-6">
                          {/* Left: Pool Info */}
                          <div className="space-y-3">
                            <h4 className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                              Pool Details
                            </h4>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="p-2 bg-slate-900 border border-slate-700">
                                <p className="text-[9px] text-slate-500 font-mono">TYPE</p>
                                <p className="text-sm font-mono text-slate-200">{pool.type}</p>
                              </div>
                              <div className="p-2 bg-slate-900 border border-slate-700">
                                <p className="text-[9px] text-slate-500 font-mono">STATUS</p>
                                <p className="text-sm font-mono text-slate-200">
                                  {pool.status || 'Ready'}
                                </p>
                              </div>
                              {stats && (
                                <>
                                  <div className="p-2 bg-slate-900 border border-slate-700">
                                    <p className="text-[9px] text-slate-500 font-mono">TOTAL_TXS</p>
                                    <p className="text-sm font-mono text-slate-200">{stats.lifetimeTxCount}</p>
                                  </div>
                                  <div className="p-2 bg-slate-900 border border-slate-700">
                                    <p className="text-[9px] text-slate-500 font-mono">VOLUME</p>
                                    <p className="text-sm font-mono text-slate-200">${stats.lifetimeVolume.toFixed(2)}</p>
                                  </div>
                                </>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="grid grid-cols-2 gap-2 pt-2">
                              <button
                                onClick={() => openTransferModal('deposit', pool)}
                                className="px-3 py-2 text-xs font-mono text-status-success border border-status-success/30 hover:border-status-success/50 flex items-center justify-center gap-2"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                                Deposit
                              </button>
                              <button
                                onClick={() => openTransferModal('withdraw', pool)}
                                disabled={!pool.balance || pool.balance.usdc === 0}
                                className="px-3 py-2 text-xs font-mono text-status-warning border border-status-warning/30 hover:border-status-warning/50 flex items-center justify-center gap-2 disabled:opacity-50"
                              >
                                <Wallet className="w-3.5 h-3.5" />
                                Withdraw
                              </button>
                              {pool.balance && pool.balance.usdc > 0 && (pool.balance.compressedUsdc === undefined || pool.balance.compressedUsdc === 0) && (
                                <button
                                  onClick={() => openShieldModal(pool)}
                                  className="col-span-2 px-3 py-2 text-xs font-mono text-purple-400 border border-purple-500/30 hover:border-purple-500/50 hover:bg-purple-500/5 flex items-center justify-center gap-2 group"
                                  title="Compress USDC for 50x cheaper payments + ZK privacy"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5 group-hover:animate-pulse" />
                                  Shield Funds • Enable Compressed Payments
                                </button>
                              )}
                              <a
                                href={`https://solscan.io/account/${pool.poolAddress}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-2 text-xs font-mono text-slate-400 border border-slate-700 hover:border-slate-600 flex items-center justify-center gap-2"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                View
                              </a>
                              <button
                                onClick={() => handleExportKey(pool.poolId, pool.type)}
                                disabled={exportKeyState.isLoading}
                                className="px-3 py-2 text-xs font-mono text-slate-400 border border-slate-700 hover:border-slate-600 flex items-center justify-center gap-2"
                              >
                                <Key className="w-3.5 h-3.5" />
                                Export
                              </button>
                              {pool.type === 'CUSTOM' && pool.agentCount === 0 && (
                                <button
                                  onClick={() => handleDeletePool(pool.poolId, pool.type)}
                                  disabled={isDeletingPool === pool.poolId}
                                  className="col-span-2 px-3 py-2 text-xs font-mono text-status-critical border border-status-critical/30 hover:border-status-critical/50 flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                  {isDeletingPool === pool.poolId ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                  Delete Pool
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Right: Linked Agents */}
                          <div className="space-y-3">
                            <h4 className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                              Linked Agents ({pool.agentCount})
                            </h4>
                            {pool.agentIds && pool.agentIds.length > 0 ? (
                              <div className="space-y-2 max-h-40 overflow-y-auto">
                                {pool.agentIds.map((agentId) => (
                                  <div 
                                    key={agentId}
                                    className="p-2 bg-slate-900 border border-slate-700 flex items-center justify-between"
                                  >
                                    <div className="flex items-center gap-2">
                                      <Cpu className="w-3.5 h-3.5 text-slate-500" />
                                      <code className="text-[10px] text-slate-400 font-mono">
                                        {agentId.slice(0, 16)}...
                                      </code>
                                    </div>
                                    <button
                                      onClick={() => handleUnlinkAgent(agentId, pool.poolId)}
                                      disabled={isUnlinkingAgent === agentId}
                                      className="p-1 text-slate-500 hover:text-status-warning"
                                      title="Unlink agent"
                                    >
                                      {isUnlinkingAgent === agentId ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <Unlink className="w-3 h-3" />
                                      )}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="p-4 bg-slate-900 border border-slate-700 text-center">
                                <p className="text-[10px] text-slate-600 font-mono">
                                  No agents linked
                                </p>
                              </div>
                            )}

                            {/* Funding Actions */}
                            {pool.type === 'MAIN' && pool.canFundTo?.includes('CUSTOM') && (
                              <div className="pt-2 border-t border-slate-700">
                                <p className="text-[9px] text-slate-500 font-mono mb-2">
                                  MAIN Pool can fund CUSTOM pools
                                </p>
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
          </>
        )}
      </div>

      {/* Funding Modal */}
      {fundingSource && fundingTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-mono text-slate-200">Fund Pool</h3>
              <button onClick={() => { setFundingSource(null); setFundingTarget(null); setFundingAmount(''); }}>
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="p-3 bg-slate-800 border border-slate-700">
                <p className="text-[10px] text-slate-500 font-mono mb-1">FROM</p>
                <p className="text-xs text-slate-300 font-mono">
                  {pools.find(p => p.poolId === fundingSource)?.type} Pool
                </p>
              </div>
              
              <div className="flex justify-center">
                <ArrowDown className="w-4 h-4 text-slate-500" />
              </div>
              
              <div className="p-3 bg-slate-800 border border-slate-700">
                <p className="text-[10px] text-slate-500 font-mono mb-1">TO</p>
                <p className="text-xs text-slate-300 font-mono">
                  {pools.find(p => p.poolId === fundingTarget)?.type} Pool
                </p>
              </div>
              
              <div>
                <label className="text-[10px] text-slate-500 font-mono">AMOUNT (USDC)</label>
                <input
                  type="number"
                  value={fundingAmount}
                  onChange={(e) => setFundingAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full mt-1 px-3 py-2 bg-slate-800 border border-slate-700 text-slate-100 font-mono text-sm"
                />
              </div>
              
              <button
                onClick={handleFundPool}
                disabled={isFunding || !fundingAmount || parseFloat(fundingAmount) <= 0}
                className="w-full py-2.5 bg-status-info text-white text-xs font-mono disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isFunding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowDown className="w-3.5 h-3.5" />}
                Fund Pool
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Key Modal */}
      {exportKeyState.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-status-warning/30 p-6 max-w-lg w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-status-warning" />
                <h3 className="text-sm font-mono text-status-warning">Private Key Export</h3>
              </div>
              <button onClick={closeExportModal}>
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="p-3 bg-status-critical/10 border border-status-critical/30">
                <p className="text-[10px] text-status-critical font-mono">
                  WARNING: Never share this key. Anyone with access can drain funds.
                </p>
              </div>
              
              <div>
                <p className="text-[10px] text-slate-500 font-mono mb-1">POOL ADDRESS</p>
                <code className="text-xs text-slate-400 font-mono break-all">{exportKeyState.poolAddress}</code>
              </div>
              
              <div>
                <p className="text-[10px] text-slate-500 font-mono mb-1">PRIVATE KEY (BASE58)</p>
                <div className="relative">
                  <code className={`block p-3 bg-slate-800 border border-slate-700 text-xs font-mono break-all ${!exportKeyState.showKey ? 'filter blur-sm select-none' : 'text-slate-200'}`}>
                    {exportKeyState.privateKeyBase58}
                  </code>
                  <button
                    onClick={() => setExportKeyState(prev => ({ ...prev, showKey: !prev.showKey }))}
                    className="absolute top-2 right-2 p-1 hover:bg-slate-700"
                  >
                    {exportKeyState.showKey ? <EyeOff className="w-4 h-4 text-slate-500" /> : <Eye className="w-4 h-4 text-slate-500" />}
                  </button>
                </div>
              </div>
              
              {exportKeyState.showKey && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(exportKeyState.privateKeyBase58 || '');
                    onLog?.('info', 'Key copied');
                  }}
                  className="w-full py-2 border border-slate-700 text-slate-400 text-xs font-mono hover:border-slate-600 flex items-center justify-center gap-2"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy to Clipboard
                </button>
              )}
              
              <p className="text-[9px] text-slate-600 font-mono">
                {exportKeyState.importGuide}
              </p>
            </div>
          </div>
        </div>
      )}
      {/* Transfer Modal (Deposit/Withdraw) */}
      {transferModal.isOpen && transferModal.targetPool && (
        <TransferModal
          isOpen={transferModal.isOpen}
          onClose={closeTransferModal}
          mode={transferModal.mode}
          targetPool={transferModal.targetPool}
          availablePools={pools}
          onTransfer={handleTransfer}
          isProcessing={isTransferring}
        />
      )}

      {/* Shield Funds Modal */}
      {shieldModal.isOpen && shieldModal.pool && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 border border-purple-500/30 max-w-md w-full">
            {/* Header */}
            <div className="p-4 border-b border-purple-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-purple-400" />
                <h3 className="text-sm font-mono text-purple-300 uppercase tracking-wider">
                  Shield Funds
                </h3>
              </div>
              <button
                onClick={closeShieldModal}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-4">
              {/* Info */}
              <div className="bg-purple-500/10 border border-purple-500/30 p-3 space-y-2">
                <p className="text-xs text-purple-300 font-mono">
                  COMPRESS_USDC_FOR_COMPRESSED_PAYMENTS
                </p>
                <ul className="text-[10px] text-slate-400 space-y-1 pl-4 list-disc">
                  <li>50x cheaper transactions (~0.00004 SOL vs 0.002 SOL)</li>
                  <li>ZK privacy with ephemeral burners</li>
                  <li>One-time compression, permanent savings</li>
                  <li>Break on-chain linkability</li>
                </ul>
              </div>

              {/* Pool Info */}
              <div className="bg-slate-800/50 border border-slate-700 p-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-mono">POOL</span>
                  <span className="text-slate-300 font-mono">{shieldModal.pool.name}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-mono">AVAILABLE_USDC</span>
                  <span className="text-status-success font-mono">{shieldModal.availableBalance.toFixed(2)} USDC</span>
                </div>
                {shieldModal.pool.balance?.compressedUsdc !== undefined && shieldModal.pool.balance.compressedUsdc > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-mono">COMPRESSED</span>
                    <span className="text-purple-400 font-mono">{shieldModal.pool.balance.compressedUsdc.toFixed(2)} USDC</span>
                  </div>
                )}
              </div>

              {/* Amount Input */}
              <div className="space-y-2">
                <label className="text-xs text-slate-500 font-mono uppercase">
                  Amount to Compress
                </label>
                <input
                  type="number"
                  value={shieldModal.amount}
                  onChange={(e) => setShieldModal(prev => ({ ...prev, amount: e.target.value }))}
                  max={shieldModal.availableBalance}
                  step="0.01"
                  className="w-full bg-slate-800 border border-slate-700 px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-purple-500/50"
                  placeholder="0.00"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setShieldModal(prev => ({ ...prev, amount: (shieldModal.availableBalance * 0.25).toFixed(2) }))}
                    className="flex-1 px-2 py-1 text-[10px] font-mono text-slate-400 border border-slate-700 hover:border-slate-600"
                  >
                    25%
                  </button>
                  <button
                    onClick={() => setShieldModal(prev => ({ ...prev, amount: (shieldModal.availableBalance * 0.5).toFixed(2) }))}
                    className="flex-1 px-2 py-1 text-[10px] font-mono text-slate-400 border border-slate-700 hover:border-slate-600"
                  >
                    50%
                  </button>
                  <button
                    onClick={() => setShieldModal(prev => ({ ...prev, amount: (shieldModal.availableBalance * 0.75).toFixed(2) }))}
                    className="flex-1 px-2 py-1 text-[10px] font-mono text-slate-400 border border-slate-700 hover:border-slate-600"
                  >
                    75%
                  </button>
                  <button
                    onClick={() => setShieldModal(prev => ({ ...prev, amount: shieldModal.availableBalance.toFixed(2) }))}
                    className="flex-1 px-2 py-1 text-[10px] font-mono text-slate-400 border border-slate-700 hover:border-slate-600"
                  >
                    MAX
                  </button>
                </div>
              </div>

              {/* Savings Preview */}
              {parseFloat(shieldModal.amount || '0') > 0 && (
                <div className="bg-purple-500/10 border border-purple-500/30 p-3">
                  <p className="text-xs text-purple-300 font-mono mb-2">ESTIMATED_SAVINGS</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">100 payments</span>
                    <span className="text-xs text-status-success font-mono">~0.19 SOL saved</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-slate-400">1000 payments</span>
                    <span className="text-xs text-status-success font-mono">~1.96 SOL saved</span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-purple-500/30 flex gap-2">
              <button
                onClick={closeShieldModal}
                disabled={shieldModal.isShielding}
                className="flex-1 px-4 py-2 text-sm font-mono text-slate-400 border border-slate-700 hover:border-slate-600 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleShield(shieldModal.pool!.poolId, shieldModal.amount)}
                disabled={
                  shieldModal.isShielding || 
                  !shieldModal.amount || 
                  parseFloat(shieldModal.amount) <= 0 || 
                  parseFloat(shieldModal.amount) > shieldModal.availableBalance
                }
                className="flex-1 px-4 py-2 text-sm font-mono text-purple-200 bg-purple-600 hover:bg-purple-500 border border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {shieldModal.isShielding ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Compressing...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    Shield {shieldModal.amount} USDC
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
