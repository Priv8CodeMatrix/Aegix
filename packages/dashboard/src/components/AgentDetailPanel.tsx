'use client';

import { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  X, Key, Copy, Check, Eye, EyeOff, Loader2, Wallet,
  Shield, Trash2, RefreshCw, ExternalLink, AlertTriangle,
  Send, DollarSign, Link2, Edit3, Save
} from 'lucide-react';
import { 
  Agent, 
  getAgentStealth, 
  setupAgentStealth, 
  linkAgentPool, 
  updateAgentStealth, 
  regenerateAgentKey, 
  deleteAgentById,
  linkAgentToMainPool,
  updateAgentConfig,
  getAllPools,
  assignAgentToPool,
  createAgentPool,
  unlinkAgentPool,
  createCustomPool,
  confirmCustomPool,
  getOrCreateMainPool,
  canCreateMainPool,
  getLegacyPool,
  getMainPool,
  POOL_THRESHOLDS,
  // Light Protocol (Aegix 4.0)
  createLightSession,
  fundLightPool,
  revokeLightSession,
  getLightStatus,
  type LightSessionStatus,
  type PoolData,
} from '@/lib/gateway';
import { Transaction, Connection } from '@solana/web3.js';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';

interface AgentDetailPanelProps {
  agent: Agent;
  onClose: () => void;
  onUpdate: () => void;
  onDelete: () => void;
  mainPoolAddress?: string;
  mainPoolId?: string;
  onLog?: (level: 'info' | 'success' | 'error' | 'warning', message: string) => void;
}

export function AgentDetailPanel({ 
  agent, 
  onClose, 
  onUpdate, 
  onDelete,
  mainPoolAddress,
  mainPoolId,
  onLog
}: AgentDetailPanelProps) {
  const { publicKey, signMessage, signTransaction, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [fullApiKey, setFullApiKey] = useState<string | null>(null);
  const [isLoadingFullKey, setIsLoadingFullKey] = useState(false);
  const [stealthInfo, setStealthInfo] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingUpStealth, setIsSettingUpStealth] = useState(false);
  const [isRegeneratingKey, setIsRegeneratingKey] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLinkingMain, setIsLinkingMain] = useState(false);
  
  // Pool assignment
  const [availablePools, setAvailablePools] = useState<Array<{
    poolId: string;
    poolAddress: string;
    isMain: boolean;
    name: string;
    agentCount: number;
  }>>([]);
  const [isLoadingPools, setIsLoadingPools] = useState(false);
  const [showPoolSelector, setShowPoolSelector] = useState(false);
  const [isAssigningPool, setIsAssigningPool] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  
  // Payment form
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentRecipient, setPaymentRecipient] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  
  // Spending limits editing
  const [isEditingLimits, setIsEditingLimits] = useState(false);
  const [editMaxPerTx, setEditMaxPerTx] = useState('');
  const [editDailyLimit, setEditDailyLimit] = useState('');
  const [isSavingLimits, setIsSavingLimits] = useState(false);
  
  // Light Protocol (Aegix 4.0)
  const [isCreatingLightSession, setIsCreatingLightSession] = useState(false);
  const [isRevokingLightSession, setIsRevokingLightSession] = useState(false);
  const [lightStatus, setLightStatus] = useState<LightSessionStatus | null>(null);
  const [isLoadingLightStatus, setIsLoadingLightStatus] = useState(false);

  useEffect(() => {
    loadStealthInfo();
    if (publicKey) {
      loadAvailablePools();
    }
    // Load Light status if agent is in Light mode
    if (agent.stealthSettings?.mode === 'light') {
      loadLightStatus();
    }
  }, [agent.id, publicKey]);

  // Load Light Protocol status for this agent
  const loadLightStatus = async () => {
    setIsLoadingLightStatus(true);
    try {
      const status = await getLightStatus(agent.id);
      setLightStatus(status);
    } catch (err) {
      console.error('Failed to load Light status:', err);
    } finally {
      setIsLoadingLightStatus(false);
    }
  };

  /**
   * Create Custom Pool for this agent
   * REQUIRES: Main Pool must exist (Custom pools fund from Main only)
   */
  const handleCreateLightSession = async () => {
    if (!publicKey || !signMessage) {
      setError('Wallet connection required');
      return;
    }

    // Enforce hierarchy: Custom pools require Main Pool to exist
    if (!mainPoolAddress) {
      setError('Create Main Pool first. Custom pools are funded from Main Pool only.');
      onLog?.('warning', 'Main Pool required before creating Custom pools');
      return;
    }

    setIsCreatingLightSession(true);
    setError(null);
    onLog?.('info', `Creating Custom Pool for agent ${agent.name}...`);

    try {
      // Sign the session grant message
      const timestamp = Date.now();
      const message = `AEGIX_SESSION_GRANT::${agent.id}::${publicKey.toBase58()}::${timestamp}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(encodedMessage);
      const signature = Buffer.from(signatureBytes).toString('base64');

      // Create session via API (creates Custom Pool linked to agent)
      const result = await createLightSession(
        agent.id,
        signature,
        message,
        {
          maxPerTransaction: agent.spendingLimits?.maxPerTransaction,
          dailyLimit: agent.spendingLimits?.dailyLimit,
        },
        24 // 24 hour session
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to create Custom Pool');
      }

      onLog?.('success', `Custom Pool created: ${result.poolAddress?.slice(0, 12)}...`);
      onLog?.('info', `Fund from Main Pool to activate agent payments`);

      // Reload agent data
      onUpdate();
      loadLightStatus();
    } catch (err: any) {
      console.error('Failed to create Custom Pool:', err);
      setError(err.message || 'Failed to create Custom Pool');
      onLog?.('error', `Custom Pool creation failed: ${err.message}`);
    } finally {
      setIsCreatingLightSession(false);
    }
  };

  // Revoke Light Protocol session
  const handleRevokeLightSession = async () => {
    if (!publicKey || !signMessage) {
      setError('Wallet connection required');
      return;
    }

    setIsRevokingLightSession(true);
    setError(null);
    onLog?.('info', `Revoking Light session for agent ${agent.name}...`);

    try {
      // Sign the revocation message
      const timestamp = Date.now();
      const message = `AEGIX_SESSION_REVOKE::${agent.id}::${publicKey.toBase58()}::${timestamp}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(encodedMessage);
      const signature = Buffer.from(signatureBytes).toString('base64');

      // Revoke session via API
      const result = await revokeLightSession(agent.id, signature, message);

      if (!result.success) {
        throw new Error(result.error || 'Failed to revoke session');
      }

      onLog?.('success', `Light session revoked for agent ${agent.name}`);
      
      // Reload agent data
      onUpdate();
      setLightStatus(null);
    } catch (err: any) {
      console.error('Failed to revoke Light session:', err);
      setError(err.message || 'Failed to revoke session');
      onLog?.('error', `Revoke failed: ${err.message}`);
    } finally {
      setIsRevokingLightSession(false);
    }
  };

  const loadAvailablePools = async () => {
    if (!publicKey) return;
    
    setIsLoadingPools(true);
    try {
      const pools = await getAllPools(publicKey.toBase58());
      setAvailablePools(pools);
      onLog?.('info', `LOADED_${pools.length}_POOLS`);
    } catch (err) {
      console.error('Failed to load pools:', err);
    } finally {
      setIsLoadingPools(false);
    }
  };

  const loadStealthInfo = async () => {
    setIsLoading(true);
    try {
      const info = await getAgentStealth(agent.id);
      setStealthInfo(info);
      onLog?.('info', `LOADED_AGENT_STEALTH: ${agent.name}`);
    } catch (err) {
      console.error('Failed to load stealth info:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetupStealth = async () => {
    if (!publicKey || !signMessage || !signTransaction) {
      setError('Wallet connection required to create pool');
      return;
    }
    
    setIsSettingUpStealth(true);
    setError(null);
    onLog?.('info', `CREATING_ATOMIC_POOL: ${agent.name}`);
    
    try {
      // Step 1: Sign message for pool creation
      const message = `AEGIX_CREATE_POOL::${publicKey.toBase58()}::${Date.now()}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signature = await signMessage(encodedMessage);
      const signatureBase64 = Buffer.from(signature).toString('base64');
      
      // Step 2: Request atomic pool creation transaction from backend
      onLog?.('info', 'Requesting pool creation transaction...');
      const createResult = await createCustomPool(
        publicKey.toBase58(),
        signatureBase64,
        message
      );
      
      onLog?.('info', `Pool prepared: ${createResult.poolAddress.slice(0, 12)}... (rent: ${createResult.rentRequired.toFixed(4)} SOL)`);
      
      // Step 3: Deserialize and sign the transaction
      const connection = new Connection(
        process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com',
        'confirmed'
      );
      
      const transaction = Transaction.from(Buffer.from(createResult.transaction, 'base64'));
      const signedTx = await signTransaction(transaction);
      
      // Step 4: Broadcast the transaction
      onLog?.('info', 'Broadcasting pool creation...');
      const txSignature = await connection.sendRawTransaction(signedTx.serialize());
      
      // Step 5: Confirm the transaction and persist the pool
      onLog?.('info', 'Confirming on-chain...');
      const confirmResult = await confirmCustomPool(
        createResult.poolId,
        txSignature,
        publicKey.toBase58()
      );
      
      onLog?.('success', `POOL_CREATED_ATOMIC: ${confirmResult.poolAddress.slice(0, 12)}... (tx: ${txSignature.slice(0, 8)}...)`);
      
      // Step 6: Link the new pool to the agent
      await assignAgentToPool(agent.id, confirmResult.poolId, confirmResult.poolAddress);
      onLog?.('success', `POOL_LINKED: ${agent.name} → ${confirmResult.poolId.slice(0, 12)}...`);
      
      await loadStealthInfo();
      await loadAvailablePools();
      onUpdate();
      
    } catch (err: any) {
      // User rejected or error
      if (err.message?.includes('User rejected')) {
        onLog?.('info', 'Pool creation cancelled');
      } else {
        setError(err.message || 'Failed to create pool');
        onLog?.('error', `POOL_CREATION_ERROR: ${err.message}`);
      }
    } finally {
      setIsSettingUpStealth(false);
    }
  };

  const handleUseMainPool = async () => {
    if (!publicKey || !signMessage) {
      setError('Wallet not connected');
      return;
    }
    
    setIsLinkingMain(true);
    setError(null);
    
    try {
      // If Main Pool exists, just link to it
      if (mainPoolAddress && mainPoolId) {
        onLog?.('info', `Linking to Main Pool: ${agent.name}`);
        await linkAgentToMainPool(agent.id, mainPoolId, mainPoolAddress);
        onLog?.('success', `Agent linked to Main Pool`);
        await loadStealthInfo();
        await loadAvailablePools();
        onUpdate();
        return;
      }
      
      // No Main Pool - check if we can create one
      const pools = await getAllPools(publicKey.toBase58());
      const legacyPool = getLegacyPool(pools);
      const existingMain = getMainPool(pools);
      
      if (existingMain) {
        // Main already exists, link to it
        onLog?.('info', `Linking to existing Main Pool`);
        await linkAgentToMainPool(agent.id, existingMain.poolId, existingMain.poolAddress);
        onLog?.('success', `Agent linked to Main Pool`);
        await loadStealthInfo();
        await loadAvailablePools();
        onUpdate();
        return;
      }
      
      // Check if Legacy can create Main
      const canCreate = canCreateMainPool(legacyPool);
      if (!canCreate.canCreate) {
        setError(canCreate.reason || 'Cannot create Main Pool');
        onLog?.('warning', canCreate.reason || 'Cannot create Main Pool');
        return;
      }
      
      // Auto-create Main Pool
      onLog?.('info', `Creating Main Pool for agent...`);
      
      const timestamp = Date.now();
      const message = `AEGIX_MAIN_POOL::${publicKey.toBase58()}::${timestamp}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(encodedMessage);
      const signature = Buffer.from(signatureBytes).toString('base64');
      
      const result = await getOrCreateMainPool(
        publicKey.toBase58(),
        signature,
        message
      );
      
      if (result.created && result.transaction && sendTransaction && connection) {
        // Sign and send the transaction to create Main Pool
        onLog?.('info', `Signing Main Pool creation transaction...`);
        
        const transaction = Transaction.from(Buffer.from(result.transaction, 'base64'));
        
        const txSignature = await sendTransaction(transaction, connection);
        onLog?.('info', `Broadcast: ${txSignature.slice(0, 16)}...`);
        
        await connection.confirmTransaction(txSignature, 'confirmed');
        onLog?.('success', `Main Pool created: ${result.poolAddress.slice(0, 12)}...`);
      } else if (result.existed) {
        onLog?.('info', `Using existing Main Pool: ${result.poolAddress.slice(0, 12)}...`);
      }
      
      // Link agent to the Main Pool
      await linkAgentToMainPool(agent.id, result.poolId, result.poolAddress);
      onLog?.('success', `Agent linked to Main Pool`);
      
      await loadStealthInfo();
      await loadAvailablePools();
      onUpdate();
      
    } catch (err: any) {
      if (err.message?.includes('rejected')) {
        onLog?.('info', 'Cancelled by user');
      } else {
        setError(err.message || 'Failed to link to Main Pool');
        onLog?.('error', err.message);
      }
    } finally {
      setIsLinkingMain(false);
    }
  };

  const handleAssignToPool = async (poolId: string, poolAddress: string) => {
    setIsAssigningPool(true);
    setError(null);
    onLog?.('info', `ASSIGNING_TO_POOL: ${poolId.slice(0, 8)}...`);
    
    try {
      await assignAgentToPool(agent.id, poolId, poolAddress);
      onLog?.('success', `ASSIGNED_TO_POOL: ${agent.name}`);
      await loadStealthInfo();
      await loadAvailablePools(); // Refresh pool list
      setShowPoolSelector(false);
      onUpdate();
    } catch (err: any) {
      setError(err.message || 'Failed to assign to pool');
      onLog?.('error', `POOL_ASSIGN_ERROR: ${err.message}`);
    } finally {
      setIsAssigningPool(false);
    }
  };

  const handleUnlinkPool = async () => {
    if (!confirm('Unlink this agent from its pool? Agent will no longer be able to make stealth payments until reassigned.')) return;
    
    setIsUnlinking(true);
    setError(null);
    onLog?.('info', `UNLINKING_POOL: ${agent.name}`);
    
    try {
      await unlinkAgentPool(agent.id);
      onLog?.('success', `POOL_UNLINKED: ${agent.name}`);
      await loadStealthInfo();
      await loadAvailablePools();
      onUpdate();
    } catch (err: any) {
      setError(err.message || 'Failed to unlink pool');
      onLog?.('error', `UNLINK_ERROR: ${err.message}`);
    } finally {
      setIsUnlinking(false);
    }
  };

  const handleEditLimits = () => {
    // Initialize with current values (convert from micro-USDC to USDC)
    const currentMaxPerTx = agent.spendingLimits?.maxPerTransaction 
      ? (parseInt(agent.spendingLimits.maxPerTransaction) / 1000000).toString()
      : '100';
    const currentDailyLimit = agent.spendingLimits?.dailyLimit
      ? (parseInt(agent.spendingLimits.dailyLimit) / 1000000).toString()
      : '1000';
    
    setEditMaxPerTx(currentMaxPerTx);
    setEditDailyLimit(currentDailyLimit);
    setIsEditingLimits(true);
  };

  const handleSaveLimits = async () => {
    setIsSavingLimits(true);
    setError(null);
    onLog?.('info', `UPDATING_LIMITS: ${agent.name}`);
    
    try {
      // Convert USDC to micro-USDC
      const maxPerTxMicro = (parseFloat(editMaxPerTx) * 1000000).toString();
      const dailyLimitMicro = (parseFloat(editDailyLimit) * 1000000).toString();
      
      const result = await updateAgentConfig(agent.id, {
        spendingLimits: {
          maxPerTransaction: maxPerTxMicro,
          dailyLimit: dailyLimitMicro,
        },
      });
      
      if (result) {
        onLog?.('success', `LIMITS_UPDATED: MAX_TX=$${editMaxPerTx}, DAILY=$${editDailyLimit}`);
        setIsEditingLimits(false);
        onUpdate();
      } else {
        throw new Error('Failed to update limits');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save limits');
      onLog?.('error', `LIMITS_ERROR: ${err.message}`);
    } finally {
      setIsSavingLimits(false);
    }
  };

  const fetchFullApiKey = async () => {
    if (!publicKey) {
      setError('Wallet not connected');
      return;
    }
    
    setIsLoadingFullKey(true);
    setError(null);
    
    try {
      // For now, we'll use owner query param only (signature verification can be added later)
      const response = await fetch(
        `${GATEWAY_URL}/api/agents/${agent.id}/api-key?owner=${publicKey.toBase58()}`,
        { method: 'GET' }
      );
      
      const result = await response.json();
      
      if (result.success && result.data?.apiKey) {
        setFullApiKey(result.data.apiKey);
        onLog?.('info', 'FULL_API_KEY_RETRIEVED');
      } else {
        throw new Error(result.error || 'Failed to retrieve full key');
      }
    } catch (err: any) {
      console.error('Failed to fetch full API key:', err);
      onLog?.('error', `KEY_RETRIEVAL_ERROR: ${err.message}`);
      // Show user-friendly message
      if (err.message?.includes('not available') || err.message?.includes('expires')) {
        setError('API key is only shown once when created/regenerated. Please regenerate the key to see it again.');
      } else {
        setError(err.message || 'Failed to retrieve full API key');
      }
    } finally {
      setIsLoadingFullKey(false);
    }
  };

  const handleRegenerateKey = async () => {
    if (!confirm('Regenerate API key? The old key will stop working immediately.')) return;
    
    setIsRegeneratingKey(true);
    setFullApiKey(null); // Clear cached full key
    onLog?.('info', `REGENERATING_KEY: ${agent.name}`);
    
    try {
      const result = await regenerateAgentKey(agent.id);
      if (result) {
        setNewApiKey(result.apiKey);
        setFullApiKey(result.apiKey); // Store new key as full key
        onLog?.('success', `KEY_REGENERATED: ${agent.name}`);
        onUpdate();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to regenerate key');
      onLog?.('error', `KEY_ERROR: ${err.message}`);
    } finally {
      setIsRegeneratingKey(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;
    
    setIsDeleting(true);
    onLog?.('info', `DELETING_AGENT: ${agent.name}`);
    
    try {
      await deleteAgentById(agent.id);
      onLog?.('success', `AGENT_DELETED: ${agent.name}`);
      onDelete();
    } catch (err: any) {
      setError(err.message || 'Failed to delete agent');
      onLog?.('error', `DELETE_ERROR: ${err.message}`);
      setIsDeleting(false);
    }
  };

  const copyApiKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(true);
    onLog?.('info', 'API_KEY_COPIED');
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    onLog?.('info', `COPIED: ${label}`);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-sm">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-slate-200 font-mono">{agent.name}</h2>
            <p className="text-[10px] font-mono text-slate-500">{agent.id}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-sm">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="m-4 p-3 border border-status-critical/30 bg-status-critical/10 flex items-center gap-2 rounded-sm">
            <AlertTriangle className="w-4 h-4 text-status-critical flex-shrink-0" />
            <span className="text-xs text-status-critical font-mono">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="w-3.5 h-3.5 text-status-critical" />
            </button>
          </div>
        )}

        <div className="p-4 space-y-4">
          {/* Status & Stats */}
          <div className="grid grid-cols-4 gap-2">
            <div className="p-3 border border-slate-800 bg-slate-950">
              <p className="text-[9px] text-slate-500 mb-1 font-mono">STATUS</p>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-mono ${
                  agent.status === 'active' ? 'text-status-success' : 
                  agent.status === 'idle' ? 'text-status-warning' : 'text-slate-400'
                }`}>
                  {agent.status.toUpperCase()}
                </span>
                {/* Enable/Disable Toggle */}
                <button
                  onClick={async () => {
                    const newStatus = agent.status === 'active' ? 'paused' : 'active';
                    onLog?.('info', `TOGGLING_STATUS: ${agent.name} -> ${newStatus.toUpperCase()}`);
                    try {
                      const result = await updateAgentConfig(agent.id, { status: newStatus });
                      if (result) {
                        onLog?.('success', `STATUS_UPDATED: ${newStatus.toUpperCase()}`);
                        onUpdate();
                      }
                    } catch (err: any) {
                      onLog?.('error', `STATUS_ERROR: ${err.message}`);
                    }
                  }}
                  className={`p-1 rounded-sm transition-colors ${
                    agent.status === 'active' 
                      ? 'bg-status-success/20 hover:bg-status-success/30' 
                      : 'bg-slate-700 hover:bg-slate-600'
                  }`}
                  title={agent.status === 'active' ? 'Click to pause agent' : 'Click to activate agent'}
                >
                  <div className={`w-6 h-3 rounded-full relative transition-colors ${
                    agent.status === 'active' ? 'bg-status-success' : 'bg-slate-600'
                  }`}>
                    <div className={`absolute top-0.5 w-2 h-2 rounded-full bg-white transition-all ${
                      agent.status === 'active' ? 'right-0.5' : 'left-0.5'
                    }`} />
                  </div>
                </button>
              </div>
            </div>
            <div className="p-3 border border-slate-800 bg-slate-950">
              <p className="text-[9px] text-slate-500 mb-1 font-mono">PRIVACY</p>
              <span className="text-xs font-mono text-slate-200">
                {agent.privacyLevel.toUpperCase()}
              </span>
            </div>
            <div className="p-3 border border-slate-800 bg-slate-950">
              <p className="text-[9px] text-slate-500 mb-1 font-mono">24H_SPEND</p>
              <span className="text-xs font-mono text-slate-200">
                ${parseFloat(agent.spent24h || '0').toFixed(2)}
              </span>
            </div>
            <div className="p-3 border border-slate-800 bg-slate-950">
              <p className="text-[9px] text-slate-500 mb-1 font-mono">API_CALLS</p>
              <span className="text-xs font-mono text-slate-200">{agent.apiCalls}</span>
            </div>
          </div>

          {/* API Key Section */}
          <div className="border border-slate-800 bg-slate-950 p-4 rounded-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-slate-300 flex items-center gap-2 font-mono">
                <Key className="w-3.5 h-3.5" />
                API_KEY
              </h3>
              <button
                onClick={handleRegenerateKey}
                disabled={isRegeneratingKey}
                className="text-[10px] text-status-warning hover:underline flex items-center gap-1 font-mono"
              >
                {isRegeneratingKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                REGENERATE
              </button>
            </div>
            
            {newApiKey ? (
              <div className="p-2 border border-status-success/30 bg-status-success/10 mb-2 rounded-sm">
                <p className="text-[9px] text-status-success mb-1 font-mono">NEW_KEY_GENERATED (save it now!)</p>
                <div className="flex items-center gap-2">
                  <code className="text-[10px] font-mono text-status-success flex-1 break-all select-all">
                    {newApiKey}
                  </code>
                  <button onClick={() => copyApiKey(newApiKey)} className="p-1 hover:bg-slate-800 rounded-sm">
                    {copiedKey ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3 text-slate-400" />}
                  </button>
                </div>
                <p className="text-[9px] text-status-warning mt-2 font-mono">
                  ⚠️ This key will NOT be shown again. Copy it now!
                </p>
              </div>
            ) : agent.apiKey ? (
              // Show full API key if available (just created)
              <div className="p-2 border border-status-info/30 bg-status-info/10 mb-2 rounded-sm">
                <p className="text-[9px] text-status-info mb-1 font-mono">YOUR_API_KEY (copy now!)</p>
                <div className="flex items-center gap-2">
                  <code className="text-[10px] font-mono text-status-info flex-1 break-all select-all">
                    {agent.apiKey}
                  </code>
                  <button onClick={() => copyApiKey(agent.apiKey!)} className="p-1 hover:bg-slate-800 rounded-sm">
                    {copiedKey ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3 text-slate-400" />}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <code className="text-[10px] font-mono text-slate-400 flex-1 select-all break-all">
                    {showApiKey ? (
                      fullApiKey || agent.apiKeyVisible || `aegix_${agent.id.slice(0, 8)}...`
                    ) : (
                      '••••••••••••••••••••••••'
                    )}
                  </code>
                  <button 
                    onClick={async () => {
                      if (!showApiKey) {
                        // Fetch full key from backend
                        await fetchFullApiKey();
                      }
                      setShowApiKey(!showApiKey);
                    }} 
                    className="p-1 hover:bg-slate-800 rounded-sm disabled:opacity-50"
                    disabled={isLoadingFullKey}
                    title={showApiKey ? "Hide full API key" : "Show full API key"}
                  >
                    {isLoadingFullKey ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
                    ) : showApiKey ? (
                      <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                    ) : (
                      <Eye className="w-3.5 h-3.5 text-slate-500" />
                    )}
                  </button>
                  {showApiKey && (fullApiKey || agent.apiKeyVisible) && (
                    <button 
                      onClick={() => copyApiKey(fullApiKey || agent.apiKeyVisible!)}
                      className="p-1 hover:bg-slate-800 rounded-sm"
                      title="Copy full API key"
                    >
                      {copiedKey ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3 text-slate-400" />}
                    </button>
                  )}
                </div>
                <p className="text-[9px] text-slate-600 font-mono">
                  {showApiKey && fullApiKey 
                    ? 'Full API key retrieved. Copy it now!'
                    : 'Click the eye icon to retrieve the full API key (if available).'
                  }
                </p>
              </div>
            )}
            <p className="text-[9px] text-slate-500 mt-2 font-mono border-t border-slate-800 pt-2">
              Header: <code className="text-status-info">X-Agent-Key: your_key_here</code>
            </p>
          </div>

          {/* Stealth Pool Section */}
          <div className="border border-slate-800 bg-slate-950 p-4 rounded-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-slate-300 flex items-center gap-2 font-mono">
                <Shield className="w-3.5 h-3.5" />
                STEALTH_POOL
              </h3>
              {stealthInfo?.enabled && (
                <span className="text-[10px] font-mono text-status-success bg-status-success/10 px-1.5 py-0.5 rounded-sm">
                  ENABLED
                </span>
              )}
            </div>

            {isLoading ? (
              <div className="py-4 text-center">
                <Loader2 className="w-5 h-5 text-slate-500 mx-auto animate-spin" />
              </div>
            ) : agent.stealthSettings?.mode === 'light' && agent.stealthSettings?.lightSessionKey ? (
              // Compressed Pool Session Active
              <div className="space-y-3">
                {/* Status Badge */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${agent.stealthSettings.lightSessionKey.status === 'active' ? 'bg-status-success' : 'bg-status-warning'}`} />
                    <span className="text-xs font-mono text-slate-400">Compressed • {agent.stealthSettings.lightSessionKey.status}</span>
                    <span className="text-[9px] text-status-success font-mono">~50x cheaper</span>
                  </div>
                </div>
                
                {/* Pool Address */}
                <div className="p-2 border border-slate-700 bg-slate-900/50 rounded-sm">
                  <p className="text-[9px] text-slate-500 mb-1 font-mono">POOL_ADDRESS</p>
                  <div className="flex items-center gap-2">
                    <code className="text-[10px] font-mono text-slate-400 flex-1 truncate">
                      {agent.stealthSettings.lightPoolAddress}
                    </code>
                    <button 
                      onClick={() => copyToClipboard(agent.stealthSettings?.lightPoolAddress || '', 'POOL')}
                      className="p-1 hover:bg-slate-800 rounded-sm"
                    >
                      <Copy className="w-3 h-3 text-slate-500" />
                    </button>
                    <a
                      href={`https://solscan.io/account/${agent.stealthSettings.lightPoolAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 hover:bg-slate-800 rounded-sm"
                    >
                      <ExternalLink className="w-3 h-3 text-slate-500" />
                    </a>
                  </div>
                </div>

                {/* Session Info */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 border border-slate-800 bg-slate-900 rounded-sm">
                    <p className="text-[9px] text-slate-500 mb-1 font-mono">EXPIRES</p>
                    <p className="text-[10px] font-mono text-slate-200">
                      {new Date(agent.stealthSettings.lightSessionKey.expiresAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-2 border border-slate-800 bg-slate-900 rounded-sm">
                    <p className="text-[9px] text-slate-500 mb-1 font-mono">SPENT_TODAY</p>
                    <p className="text-sm font-mono text-slate-200">
                      ${(Number(agent.stealthSettings.lightSessionKey.spentToday) / 1_000_000).toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Spending Limits */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 border border-slate-800 bg-slate-900 rounded-sm">
                    <p className="text-[9px] text-slate-500 mb-1 font-mono">MAX_PER_TX</p>
                    <p className="text-sm font-mono text-slate-200">
                      ${(Number(agent.stealthSettings.lightSessionKey.maxPerTransaction) / 1_000_000).toFixed(2)}
                    </p>
                  </div>
                  <div className="p-2 border border-slate-800 bg-slate-900 rounded-sm">
                    <p className="text-[9px] text-slate-500 mb-1 font-mono">DAILY_LIMIT</p>
                    <p className="text-sm font-mono text-slate-200">
                      ${(Number(agent.stealthSettings.lightSessionKey.dailyLimit) / 1_000_000).toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Cost Savings Banner */}
                <div className="p-2 border border-status-success/20 bg-status-success/5 rounded-sm">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-3 h-3 text-status-success" />
                    <p className="text-[10px] text-status-success font-mono">
                      ~50x cheaper payments with ZK Compression
                    </p>
                  </div>
                </div>

                {/* Session Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowPaymentForm(true)}
                    className="flex-1 py-2 bg-status-info text-white text-xs font-mono flex items-center justify-center gap-2 hover:bg-status-info/80"
                  >
                    <Send className="w-3.5 h-3.5" />
                    EXECUTE_PAYMENT
                  </button>
                  
                  <button
                    onClick={handleRevokeLightSession}
                    disabled={isRevokingLightSession}
                    className="px-3 py-2 border border-status-error/30 bg-status-error/10 text-status-error text-xs font-mono flex items-center justify-center gap-1.5 hover:border-status-error/50 disabled:opacity-50"
                    title="Revoke session authority"
                  >
                    {isRevokingLightSession ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <X className="w-3.5 h-3.5" />
                    )}
                    REVOKE
                  </button>
                </div>

                {/* Payment Form */}
                {showPaymentForm && (
                  <div className="border border-slate-700 bg-slate-900/50 p-3 space-y-2 rounded-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-slate-400">PAYMENT</span>
                      <button onClick={() => setShowPaymentForm(false)} className="p-0.5">
                        <X className="w-3 h-3 text-slate-500" />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={paymentRecipient}
                      onChange={(e) => setPaymentRecipient(e.target.value)}
                      placeholder="recipient_address"
                      className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 text-xs font-mono text-slate-100 placeholder:text-slate-600"
                    />
                    <input
                      type="text"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="amount_usdc"
                      className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 text-xs font-mono text-slate-100 placeholder:text-slate-600"
                    />
                    <button
                      onClick={async () => {
                        if (!paymentRecipient || !paymentAmount) return;
                        setIsProcessingPayment(true);
                        onLog?.('info', `LIGHT_TX: ${paymentAmount} USDC -> ${paymentRecipient.slice(0, 8)}...`);
                        // Use agent's API key to execute Light payment
                        try {
                          const response = await fetch(`${GATEWAY_URL}/api/credits/light/pay`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              agentApiKey: agent.apiKeyVisible,
                              recipient: paymentRecipient,
                              amount: paymentAmount,
                            }),
                          });
                          const result = await response.json();
                          if (result.success) {
                            onLog?.('success', `Light payment complete: ${result.data.txSignature?.slice(0, 16)}...`);
                          } else {
                            throw new Error(result.error || 'Payment failed');
                          }
                        } catch (err: any) {
                          onLog?.('error', `Payment failed: ${err.message}`);
                        }
                        setIsProcessingPayment(false);
                        setShowPaymentForm(false);
                        setPaymentRecipient('');
                        setPaymentAmount('');
                        loadLightStatus();
                      }}
                      disabled={isProcessingPayment || !paymentRecipient || !paymentAmount}
                      className="w-full py-1.5 bg-purple-500 text-white text-xs font-mono disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {isProcessingPayment ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          PROCESSING...
                        </>
                      ) : (
                        <>
                          <DollarSign className="w-3 h-3" />
                          SEND_COMPRESSED_USDC
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            ) : stealthInfo?.enabled && stealthInfo?.poolAddress ? (
              // Legacy Pool Mode
              <div className="space-y-3">
                {/* Pool Address */}
                <div className="p-2 border border-slate-800 bg-slate-900 rounded-sm">
                  <p className="text-[9px] text-slate-500 mb-1 font-mono">POOL_ADDRESS</p>
                  <div className="flex items-center gap-2">
                    <code className="text-[10px] font-mono text-slate-400 flex-1 truncate">
                      {stealthInfo.poolAddress}
                    </code>
                    <button 
                      onClick={() => copyToClipboard(stealthInfo.poolAddress, 'POOL_ADDRESS')}
                      className="p-1 hover:bg-slate-800 rounded-sm"
                    >
                      <Copy className="w-3 h-3 text-slate-500" />
                    </button>
                    <a
                      href={`https://solscan.io/account/${stealthInfo.poolAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 hover:bg-slate-800 rounded-sm"
                    >
                      <ExternalLink className="w-3 h-3 text-slate-500" />
                    </a>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 border border-slate-800 bg-slate-900 rounded-sm">
                    <p className="text-[9px] text-slate-500 mb-1 font-mono">USDC_BALANCE</p>
                    <p className="text-sm font-mono text-slate-200">
                      ${stealthInfo.balance?.usdc?.toFixed(2) || '0.00'}
                    </p>
                  </div>
                  <div className="p-2 border border-slate-800 bg-slate-900 rounded-sm">
                    <p className="text-[9px] text-slate-500 mb-1 font-mono">SOL_BALANCE</p>
                    <p className="text-sm font-mono text-slate-200">
                      {stealthInfo.balance?.sol?.toFixed(4) || '0.0000'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 border border-slate-800 bg-slate-900 rounded-sm">
                    <p className="text-[9px] text-slate-500 mb-1 font-mono">PAYMENTS</p>
                    <p className="text-sm font-mono text-slate-200">{stealthInfo.totalPayments}</p>
                  </div>
                  <div className="p-2 border border-slate-800 bg-slate-900 rounded-sm">
                    <p className="text-[9px] text-slate-500 mb-1 font-mono">SOL_RECOVERED</p>
                    <p className="text-sm font-mono text-status-success">
                      +{stealthInfo.totalSolRecovered?.toFixed(6) || '0'}
                    </p>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  {/* Execute Payment Button */}
                  {!showPaymentForm ? (
                    <button
                      onClick={() => setShowPaymentForm(true)}
                      className="flex-1 py-2 bg-status-info text-white text-xs font-mono flex items-center justify-center gap-2 hover:bg-status-info/80"
                    >
                      <Send className="w-3.5 h-3.5" />
                      EXECUTE_STEALTH_PAYMENT
                    </button>
                  ) : null}
                  
                  {/* Unlink Pool Button */}
                  <button
                    onClick={handleUnlinkPool}
                    disabled={isUnlinking}
                    className="px-3 py-2 border border-status-warning/30 bg-status-warning/10 text-status-warning text-xs font-mono flex items-center justify-center gap-1.5 hover:border-status-warning/50 disabled:opacity-50"
                    title="Unlink agent from this pool"
                  >
                    {isUnlinking ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Link2 className="w-3.5 h-3.5" />
                    )}
                    UNLINK
                  </button>
                </div>
                
                {/* Payment Form (expanded) */}
                {showPaymentForm && (
                  <div className="border border-slate-700 bg-slate-900 p-3 space-y-2 rounded-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-slate-400">STEALTH_TX</span>
                      <button onClick={() => setShowPaymentForm(false)} className="p-0.5">
                        <X className="w-3 h-3 text-slate-500" />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={paymentRecipient}
                      onChange={(e) => setPaymentRecipient(e.target.value)}
                      placeholder="recipient_address"
                      className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 text-xs font-mono text-slate-100 placeholder:text-slate-600"
                    />
                    <input
                      type="text"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="amount_usdc"
                      className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 text-xs font-mono text-slate-100 placeholder:text-slate-600"
                    />
                    <button
                      onClick={async () => {
                        if (!paymentRecipient || !paymentAmount) return;
                        setIsProcessingPayment(true);
                        onLog?.('info', `AGENT_TX: ${paymentAmount} USDC -> ${paymentRecipient.slice(0, 8)}...`);
                        // TODO: Implement actual agent payment execution
                        setTimeout(() => {
                          onLog?.('success', `PAYMENT_SIMULATED (implement backend)`);
                          setIsProcessingPayment(false);
                          setShowPaymentForm(false);
                          setPaymentRecipient('');
                          setPaymentAmount('');
                        }, 2000);
                      }}
                      disabled={isProcessingPayment || !paymentRecipient || !paymentAmount}
                      className="w-full py-1.5 bg-status-success text-white text-xs font-mono disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {isProcessingPayment ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          PROCESSING...
                        </>
                      ) : (
                        <>
                          <DollarSign className="w-3 h-3" />
                          SEND_USDC
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Pool Mode Selection - Agents link to MAIN or CUSTOM only */}
                <p className="text-xs text-slate-500 font-mono text-center mb-4">
                  Agents link to Main Pool or Custom Pools (never Legacy)
                </p>
                
                {/* Option 1: Use Main Pool (Default) - Auto-creates if needed */}
                <button
                  onClick={handleUseMainPool}
                  disabled={isLinkingMain}
                  className="w-full p-3 border border-status-info/30 bg-status-info/5 hover:border-status-info/50 disabled:opacity-50 text-left rounded-sm transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-status-info/10 rounded-sm">
                      <Link2 className="w-4 h-4 text-status-info" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-mono text-slate-200">USE_MAIN_POOL</p>
                        <span className="text-[9px] text-status-info font-mono">Recommended</span>
                        {!mainPoolAddress && (
                          <span className="text-[9px] text-status-success font-mono">+ Auto-Create</span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-500">
                        {mainPoolAddress 
                          ? 'Shared agent bridge pool (~50x cheaper)'
                          : 'Will create Main Pool from Legacy, then link agent'}
                      </p>
                    </div>
                    {isLinkingMain && <Loader2 className="w-4 h-4 animate-spin text-status-info" />}
                  </div>
                </button>
                
                {/* Option 2: Create Dedicated Custom Pool - REQUIRES MAIN POOL */}
                <button
                  onClick={handleCreateLightSession}
                  disabled={isCreatingLightSession || !publicKey || !signMessage || !mainPoolAddress}
                  className={`w-full p-3 border text-left rounded-sm transition-colors ${
                    mainPoolAddress 
                      ? 'border-status-success/30 bg-status-success/5 hover:border-status-success/50 disabled:opacity-50'
                      : 'border-slate-700 bg-slate-900/50 opacity-50 cursor-not-allowed'
                  }`}
                  title={!mainPoolAddress ? 'Create Main Pool first' : 'Create dedicated Custom Pool'}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-sm ${mainPoolAddress ? 'bg-status-success/10' : 'bg-slate-800'}`}>
                      <Wallet className={`w-4 h-4 ${mainPoolAddress ? 'text-status-success' : 'text-slate-500'}`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className={`text-xs font-mono ${mainPoolAddress ? 'text-slate-200' : 'text-slate-500'}`}>
                          CREATE_CUSTOM_POOL
                        </p>
                        <span className={`text-[9px] font-mono ${mainPoolAddress ? 'text-status-success' : 'text-slate-600'}`}>
                          Isolated
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500">
                        {mainPoolAddress 
                          ? 'Dedicated compressed pool for this agent'
                          : 'Requires Main Pool (shared bridge)'}
                      </p>
                    </div>
                    {isCreatingLightSession && <Loader2 className="w-4 h-4 animate-spin text-status-success" />}
                  </div>
                </button>
                
                {/* Option 3: Assign Existing Custom Pool - REQUIRES MAIN POOL */}
                <button
                  onClick={async () => {
                    if (!mainPoolAddress) return;
                    if (availablePools.length === 0) {
                      await loadAvailablePools();
                    }
                    setShowPoolSelector(true);
                  }}
                  disabled={isLoadingPools || !mainPoolAddress}
                  className={`w-full p-3 border text-left rounded-sm transition-colors ${
                    mainPoolAddress
                      ? 'border-slate-700 bg-slate-900 hover:border-slate-600 disabled:opacity-50'
                      : 'border-slate-700 bg-slate-900/50 opacity-50 cursor-not-allowed'
                  }`}
                  title={!mainPoolAddress ? 'Create Main Pool first' : 'Assign existing Custom Pool'}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-800 rounded-sm">
                      <Link2 className={`w-4 h-4 ${mainPoolAddress ? 'text-slate-400' : 'text-slate-600'}`} />
                    </div>
                    <div className="flex-1">
                      <p className={`text-xs font-mono ${mainPoolAddress ? 'text-slate-200' : 'text-slate-500'}`}>
                        ASSIGN_CUSTOM_POOL
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {mainPoolAddress
                          ? `Link to existing Custom pool (${availablePools.filter(p => !p.isMain).length} available)`
                          : 'Requires Main Pool (shared bridge)'}
                      </p>
                    </div>
                    {isLoadingPools && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                  </div>
                </button>
                
                {/* Info: Main Pool Required */}
                {!mainPoolAddress && (
                  <div className="p-3 border border-status-warning/20 bg-status-warning/5 rounded-sm">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[10px] text-status-warning font-mono">
                          Main Pool Required
                        </p>
                        <p className="text-[9px] text-slate-500 mt-0.5">
                          Click "Use Main Pool" above to create. Custom pools fund from Main Pool only.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {/* Pool Selector Modal (NEW) */}
            {showPoolSelector && (
              <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
                <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-sm">
                  <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-slate-200 font-mono">SELECT_POOL</h3>
                    <button
                      onClick={() => setShowPoolSelector(false)}
                      className="p-1.5 hover:bg-slate-800 rounded-sm"
                    >
                      <X className="w-4 h-4 text-slate-500" />
                    </button>
                  </div>
                  
                  <div className="p-4 space-y-2 max-h-[400px] overflow-y-auto">
                    {availablePools.length === 0 ? (
                      <p className="text-xs text-slate-500 font-mono text-center py-8">
                        NO_POOLS_AVAILABLE
                      </p>
                    ) : (
                      availablePools
                        .filter(pool => !pool.isMain) // Only show custom/sub stealth pools (main pool has its own button)
                        .map((pool) => (
                          <button
                            key={pool.poolId}
                            onClick={() => handleAssignToPool(pool.poolId, pool.poolAddress)}
                            disabled={isAssigningPool || agent.stealthSettings?.poolId === pool.poolId}
                            className="w-full p-3 border border-slate-700 bg-slate-950 hover:border-slate-600 disabled:opacity-50 text-left rounded-sm transition-colors"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <p className="text-xs font-mono text-slate-200">
                                    {pool.isMain ? 'MAIN_POOL' : pool.name}
                                  </p>
                                  {agent.stealthSettings?.poolId === pool.poolId && (
                                    <span className="text-[9px] font-mono text-status-success bg-status-success/10 px-1.5 py-0.5 rounded">
                                      CURRENT
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] font-mono text-slate-500 mb-1">
                                  {pool.poolAddress.slice(0, 16)}...{pool.poolAddress.slice(-8)}
                                </p>
                                <p className="text-[9px] text-slate-600 font-mono">
                                  {pool.agentCount} {pool.agentCount === 1 ? 'agent' : 'agents'} assigned
                                </p>
                              </div>
                              {isAssigningPool && agent.stealthSettings?.poolId !== pool.poolId && (
                                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                              )}
                            </div>
                          </button>
                        ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Spending Limits */}
          <div className="border border-slate-800 bg-slate-950 p-4 rounded-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-slate-300 flex items-center gap-2 font-mono">
                <DollarSign className="w-3.5 h-3.5" />
                SPENDING_LIMITS
              </h3>
              {!isEditingLimits ? (
                <button
                  onClick={handleEditLimits}
                  className="text-[10px] text-status-info hover:underline flex items-center gap-1 font-mono"
                >
                  <Edit3 className="w-3 h-3" />
                  EDIT
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsEditingLimits(false)}
                    disabled={isSavingLimits}
                    className="text-[10px] text-slate-500 hover:text-slate-300 font-mono"
                  >
                    CANCEL
                  </button>
                  <button
                    onClick={handleSaveLimits}
                    disabled={isSavingLimits}
                    className="text-[10px] text-status-success hover:underline flex items-center gap-1 font-mono"
                  >
                    {isSavingLimits ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    SAVE
                  </button>
                </div>
              )}
            </div>
            
            {isEditingLimits ? (
              <div className="space-y-3">
                <div>
                  <label className="text-[9px] text-slate-500 mb-1 font-mono block">MAX_PER_TX (USDC)</label>
                  <input
                    type="number"
                    value={editMaxPerTx}
                    onChange={(e) => setEditMaxPerTx(e.target.value)}
                    step="0.01"
                    min="0"
                    className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-slate-500 mb-1 font-mono block">DAILY_LIMIT (USDC)</label>
                  <input
                    type="number"
                    value={editDailyLimit}
                    onChange={(e) => setEditDailyLimit(e.target.value)}
                    step="0.01"
                    min="0"
                    className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100"
                  />
                </div>
                <p className="text-[9px] text-slate-600 font-mono">
                  Agent payments exceeding these limits will be blocked
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 border border-slate-800 bg-slate-900 rounded-sm">
                  <p className="text-[9px] text-slate-500 mb-1 font-mono">MAX_PER_TX</p>
                  <p className="text-sm font-mono text-slate-200">
                    ${agent.spendingLimits ? (parseInt(agent.spendingLimits.maxPerTransaction) / 1000000).toFixed(2) : '100.00'}
                  </p>
                </div>
                <div className="p-2 border border-slate-800 bg-slate-900 rounded-sm">
                  <p className="text-[9px] text-slate-500 mb-1 font-mono">DAILY_LIMIT</p>
                  <p className="text-sm font-mono text-slate-200">
                    ${agent.spendingLimits ? (parseInt(agent.spendingLimits.dailyLimit) / 1000000).toFixed(2) : '1000.00'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Danger Zone */}
          <div className="border border-status-critical/30 bg-status-critical/5 p-4 rounded-sm">
            <h3 className="text-xs font-medium text-status-critical mb-3 font-mono">DANGER_ZONE</h3>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="px-4 py-2 border border-status-critical/50 bg-status-critical/10 text-status-critical text-xs font-mono disabled:opacity-50 flex items-center gap-2"
            >
              {isDeleting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              DELETE_AGENT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AgentDetailPanel;

