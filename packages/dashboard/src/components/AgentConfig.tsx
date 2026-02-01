'use client';

import { useState, useEffect } from 'react';
import { 
  X, Settings, Trash2, Loader2, Key, Eye, EyeOff, Copy, Check, RefreshCw, 
  Shield, Power, PowerOff, AlertTriangle, Zap, Lock, DollarSign, ExternalLink
} from 'lucide-react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';
const DONATION_RECIPIENT = '7ygijvnG8kAWYu2BKEEAU6TGLzWhoy3J3VHzPkLzCra9';

interface Agent {
  id: string;
  owner: string;
  name: string;
  status: 'active' | 'paused' | 'revoked';
  privacyLevel: string;
  spent24h: string;
  totalSpent: string;
  apiCalls: number;
  createdAt: string;
  lastActivity: string;
  apiKey?: string;
  apiKeyVisible?: string;
  spendingLimits?: {
    maxPerTransaction: string;
    dailyLimit: string;
  };
  stealthSettings?: {
    enabled: boolean;
    poolId?: string;        // Pool wallet ID (Aegix 3.1)
    poolAddress?: string;   // Pool wallet public address
    totalPayments?: number;
    totalSolRecovered?: number;
  };
}

interface AgentConfigProps {
  agent: Agent;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (agent: Agent) => void;
  onDelete: (agentId: string) => void;
}

const PRIVACY_LEVELS = [
  { value: 'maximum', label: 'Maximum', desc: 'Full FHE encryption, no metadata exposure', color: 'violet' },
  { value: 'shielded', label: 'Shielded', desc: 'Encrypted amounts, basic audit trail', color: 'cyan' },
  { value: 'standard', label: 'Standard', desc: 'Encrypted balance, public usage counts', color: 'zinc' },
];

export function AgentConfig({ agent, isOpen, onClose, onUpdate, onDelete }: AgentConfigProps) {
  const { publicKey, signTransaction, signMessage, connected } = useWallet();
  const { connection } = useConnection();
  
  // Form state
  const [name, setName] = useState(agent.name);
  const [status, setStatus] = useState<'active' | 'paused' | 'revoked'>(agent.status);
  const [privacyLevel, setPrivacyLevel] = useState(agent.privacyLevel || 'shielded');
  const [maxPerTx, setMaxPerTx] = useState(
    agent.spendingLimits?.maxPerTransaction 
      ? (parseInt(agent.spendingLimits.maxPerTransaction) / 1_000_000).toString()
      : '100'
  );
  const [dailyLimit, setDailyLimit] = useState(
    agent.spendingLimits?.dailyLimit 
      ? (parseInt(agent.spendingLimits.dailyLimit) / 1_000_000).toString()
      : '1000'
  );
  
  // Pool wallet settings (Aegix 3.1)
  const [stealthEnabled, setStealthEnabled] = useState(agent.stealthSettings?.enabled ?? false);
  const [poolAddress, setPoolAddress] = useState(agent.stealthSettings?.poolAddress || null);
  const [poolId, setPoolId] = useState(agent.stealthSettings?.poolId || null);
  const [isSettingUpPool, setIsSettingUpPool] = useState(false);
  
  // Key export state
  const [exportedPoolKey, setExportedPoolKey] = useState<string | null>(null);
  const [showExportedPoolKey, setShowExportedPoolKey] = useState(false);
  const [isExportingPoolKey, setIsExportingPoolKey] = useState(false);
  
  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(agent.apiKey || null);
  
  // Test payment state
  const [donationAmount, setDonationAmount] = useState('0.01');
  const [donating, setDonating] = useState(false);
  const [donationResult, setDonationResult] = useState<{ success: boolean; tx?: string } | null>(null);

  useEffect(() => {
    setName(agent.name);
    setStatus(agent.status);
    setPrivacyLevel(agent.privacyLevel || 'shielded');
    setNewApiKey(agent.apiKey || null);
    setStealthEnabled(agent.stealthSettings?.enabled ?? false);
    setPoolAddress(agent.stealthSettings?.poolAddress || null);
    setPoolId(agent.stealthSettings?.poolId || null);
    // Reset export state when agent changes
    setExportedPoolKey(null);
    setShowExportedPoolKey(false);
    if (agent.spendingLimits) {
      setMaxPerTx((parseInt(agent.spendingLimits.maxPerTransaction) / 1_000_000).toString());
      setDailyLimit((parseInt(agent.spendingLimits.dailyLimit) / 1_000_000).toString());
    }
  }, [agent]);

  const displayKey = showApiKey && newApiKey ? newApiKey : agent.apiKeyVisible || 'aegix_agent_•••••••••••';
  const hasChanges = name !== agent.name || status !== agent.status || privacyLevel !== agent.privacyLevel;

  const handleSave = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${GATEWAY_URL}/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name, 
          status, 
          privacyLevel,
          spendingLimits: {
            maxPerTransaction: (parseFloat(maxPerTx) * 1_000_000).toString(),
            dailyLimit: (parseFloat(dailyLimit) * 1_000_000).toString(),
          }
        }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      onUpdate({ ...agent, name, status, privacyLevel });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${GATEWAY_URL}/api/agents/${agent.id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      onDelete(agent.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegenerateKey = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${GATEWAY_URL}/api/agents/${agent.id}/regenerate-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      setNewApiKey(result.data.apiKey);
      setShowApiKey(true);
      setShowRegenerateConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Key regeneration failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyKey = async () => {
    const keyToCopy = newApiKey || agent.apiKeyVisible || '';
    if (keyToCopy) {
      await navigator.clipboard.writeText(keyToCopy);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  // Setup pool wallet for agent (Aegix 3.1)
  const handleSetupPool = async () => {
    if (!publicKey || !signMessage) {
      setError('Wallet with message signing required');
      return;
    }
    setIsSettingUpPool(true);
    try {
      // Sign message to encrypt the pool private key
      const nonce = Math.random().toString(36).substring(7);
      const message = `Create Aegix Pool Wallet\nOwner: ${publicKey.toBase58()}\nAgent: ${agent.id}\nNonce: ${nonce}`;
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(messageBytes);
      const signature = Buffer.from(signatureBytes).toString('base64');
      
      const createRes = await fetch(`${GATEWAY_URL}/api/credits/pool/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          owner: publicKey.toBase58(),
          signature,
          message,
        }),
      });
      const createResult = await createRes.json();
      if (!createResult.success) throw new Error(createResult.error);
      
      const linkRes = await fetch(`${GATEWAY_URL}/api/agents/${agent.id}/stealth/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poolId: createResult.data.poolId,
          poolAddress: createResult.data.poolAddress,
        }),
      });
      const linkResult = await linkRes.json();
      if (!linkResult.success) throw new Error(linkResult.error);
      
      setPoolAddress(createResult.data.poolAddress);
      setPoolId(createResult.data.poolId);
    } catch (err: any) {
      setError(err.message || 'Setup failed');
    } finally {
      setIsSettingUpPool(false);
    }
  };
  
  // Export pool private key
  const handleExportPoolKey = async () => {
    if (!publicKey || !signMessage || !poolId) {
      setError('Missing wallet or pool ID');
      return;
    }
    
    setIsExportingPoolKey(true);
    setError(null);
    
    try {
      // Sign a new message for export authentication
      const message = `Export Aegix Pool Key\nAgent: ${agent.id}\nPool: ${poolId}\nTimestamp: ${Date.now()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(messageBytes);
      const signature = Buffer.from(signatureBytes).toString('base64');
      
      const response = await fetch(`${GATEWAY_URL}/api/credits/pool/export-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          signature,
          message,
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to export key');
      }
      
      setExportedPoolKey(result.data.privateKey);
      setShowExportedPoolKey(true);
      
    } catch (err: any) {
      setError(err.message || 'Failed to export key');
    } finally {
      setIsExportingPoolKey(false);
    }
  };

  const handleUpdateStealth = async (enabled: boolean) => {
    try {
      await fetch(`${GATEWAY_URL}/api/agents/${agent.id}/stealth`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    } catch (err) {
      console.error('Failed to update stealth:', err);
    }
  };

  const handleDonation = async () => {
    if (!publicKey || !signTransaction || !connected) return;
    
    setDonating(true);
    setDonationResult(null);
    
    try {
      const amountMicro = Math.floor(parseFloat(donationAmount) * 1_000_000);
      
      // Create stealth
      const stealthRes = await fetch(`${GATEWAY_URL}/api/credits/stealth/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: publicKey.toBase58() }),
      });
      const stealthResult = await stealthRes.json();
      if (!stealthResult.success) throw new Error(stealthResult.error);
      
      // Get funding transaction
      const fundRes = await fetch(`${GATEWAY_URL}/api/credits/stealth/fund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stealthId: stealthResult.data.stealthId,
          userWallet: publicKey.toBase58(),
          amountUSDC: amountMicro.toString(),
        }),
      });
      const fundResult = await fundRes.json();
      if (!fundResult.success) throw new Error(fundResult.error);
      
      // Sign and send
      const txBuffer = Buffer.from(fundResult.data.transaction, 'base64');
      const transaction = Transaction.from(txBuffer);
      const signedTx = await signTransaction(transaction);
      const fundingSig = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      await connection.confirmTransaction({ signature: fundingSig, blockhash, lastValidBlockHeight }, 'confirmed');
      
      // Execute stealth payment
      const execRes = await fetch(`${GATEWAY_URL}/api/credits/stealth/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stealthId: stealthResult.data.stealthId,
          recipient: DONATION_RECIPIENT,
          amountUSDC: amountMicro.toString(),
        }),
      });
      const execResult = await execRes.json();
      if (!execResult.success) throw new Error(execResult.error);
      
      setDonationResult({ success: true, tx: execResult.data.txSignature });
    } catch (err: any) {
      setDonationResult({ success: false });
      setError(err.message || 'Donation failed');
    } finally {
      setDonating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl my-8"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-aegix-cyan" />
            <h2 className="font-semibold">Configure Agent</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-800">
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 p-3 rounded-lg bg-zinc-800/50">
            <div className="text-center">
              <p className="text-xs text-zinc-500">24h</p>
              <p className="font-mono text-sm">${parseFloat(agent.spent24h || '0').toFixed(2)}</p>
            </div>
            <div className="text-center border-x border-zinc-700">
              <p className="text-xs text-zinc-500">Total</p>
              <p className="font-mono text-sm">${parseFloat(agent.totalSpent || '0').toFixed(2)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-zinc-500">Calls</p>
              <p className="font-mono text-sm">{agent.apiCalls}</p>
            </div>
          </div>

          {/* API Key */}
          <div className="p-3 rounded-lg bg-aegix-cyan/5 border border-aegix-cyan/20">
            <div className="flex items-center gap-2 mb-2">
              <Key className="w-4 h-4 text-aegix-cyan" />
              <span className="text-sm font-medium">API Key</span>
              {newApiKey && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">NEW</span>
              )}
            </div>
            <div className="flex items-center gap-2 mb-2">
              <code className="flex-1 font-mono text-xs p-2 rounded bg-zinc-800 truncate">
                {displayKey}
              </code>
              <button onClick={() => setShowApiKey(!showApiKey)} className="p-1.5 rounded hover:bg-zinc-800">
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button onClick={handleCopyKey} className="p-1.5 rounded hover:bg-zinc-800">
                {copiedKey ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            {showRegenerateConfirm ? (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowRegenerateConfirm(false)}
                  className="flex-1 py-1.5 text-xs rounded border border-zinc-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRegenerateKey}
                  disabled={isLoading}
                  className="flex-1 py-1.5 text-xs rounded bg-amber-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center gap-1"
                >
                  {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                  Confirm
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowRegenerateConfirm(true)}
                className="w-full py-1.5 text-xs rounded border border-zinc-700 hover:border-zinc-600 flex items-center justify-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Regenerate Key
              </button>
            )}
          </div>

          {/* Agent Name */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 focus:border-aegix-cyan focus:outline-none text-sm"
            />
          </div>

          {/* Privacy Level */}
          <div>
            <label className="block text-xs text-zinc-500 mb-2">Privacy Level</label>
            <div className="space-y-2">
              {PRIVACY_LEVELS.map((level) => (
                <button
                  key={level.value}
                  onClick={() => setPrivacyLevel(level.value)}
                  className={`w-full p-3 rounded-lg border text-left transition-all ${
                    privacyLevel === level.value
                      ? level.color === 'violet' 
                        ? 'border-violet-500 bg-violet-500/10'
                        : level.color === 'cyan'
                        ? 'border-aegix-cyan bg-aegix-cyan/10'
                        : 'border-zinc-500 bg-zinc-700/30'
                      : 'border-zinc-700 hover:border-zinc-600'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full border-2 ${
                      privacyLevel === level.value 
                        ? level.color === 'violet' ? 'border-violet-500 bg-violet-500' 
                          : level.color === 'cyan' ? 'border-aegix-cyan bg-aegix-cyan' 
                          : 'border-zinc-500 bg-zinc-500'
                        : 'border-zinc-600'
                    }`} />
                    <span className="font-medium text-sm">{level.label}</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1 ml-5">{level.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Spending Limits */}
          <div className="p-3 rounded-lg bg-zinc-800/30 border border-zinc-700/50">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-medium">Spending Limits</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-zinc-500 mb-1">Max per TX (USDC)</label>
                <input
                  type="number"
                  value={maxPerTx}
                  onChange={(e) => setMaxPerTx(e.target.value)}
                  step="0.01"
                  className="w-full px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 mb-1">Daily Limit (USDC)</label>
                <input
                  type="number"
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(e.target.value)}
                  step="1"
                  className="w-full px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-sm font-mono"
                />
              </div>
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Status</label>
            <button
              onClick={() => setStatus(status === 'active' ? 'paused' : 'active')}
              className={`w-full py-2.5 rounded-lg border text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                status === 'active'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
              }`}
            >
              {status === 'active' ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
              {status === 'active' ? 'Active' : 'Paused'}
            </button>
          </div>

          {/* Pool Wallet Settings (Aegix 3.1) */}
          <div className="p-3 rounded-lg bg-violet-500/5 border border-violet-500/20">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-medium">Pool Wallet</span>
              </div>
              <button
                onClick={() => {
                  setStealthEnabled(!stealthEnabled);
                  handleUpdateStealth(!stealthEnabled);
                }}
                className={`w-10 h-5 rounded-full transition-colors ${
                  stealthEnabled ? 'bg-violet-500' : 'bg-zinc-600'
                }`}
              >
                <div className={`w-4 h-4 rounded-full bg-white transition-transform ${
                  stealthEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
            </div>

            <p className="text-xs text-zinc-500 mb-3">
              Each agent has a pool wallet. Payments use temp burners → SOL auto-recycles.
            </p>

            {stealthEnabled && (
              <div className="space-y-3">
                {poolAddress ? (
                  <div className="p-2 rounded bg-zinc-800/50 text-xs space-y-2">
                    <div>
                      <p className="text-zinc-500 mb-1">Pool Wallet:</p>
                      <code className="text-violet-400 break-all">{poolAddress}</code>
                    </div>
                    
                    {/* Pool Stats */}
                    {agent.stealthSettings?.totalPayments !== undefined && (
                      <div className="flex items-center justify-between text-xs py-1 border-t border-zinc-700/50 mt-2">
                        <span className="text-zinc-500">Payments:</span>
                        <span className="text-zinc-400">{agent.stealthSettings.totalPayments} tx</span>
                      </div>
                    )}
                    {agent.stealthSettings?.totalSolRecovered !== undefined && agent.stealthSettings.totalSolRecovered > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">SOL Recycled:</span>
                        <span className="text-amber-400">{agent.stealthSettings.totalSolRecovered.toFixed(6)} SOL</span>
                      </div>
                    )}
                    
                    {/* Key Export Section */}
                    {!exportedPoolKey ? (
                      <button
                        onClick={handleExportPoolKey}
                        disabled={isExportingPoolKey || !signMessage}
                        className="w-full py-1.5 text-xs rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center gap-1 hover:bg-amber-500/20 disabled:opacity-50"
                      >
                        {isExportingPoolKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <Key className="w-3 h-3" />}
                        Export Private Key
                      </button>
                    ) : (
                      <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-amber-400 font-bold">⚠️ PRIVATE KEY</span>
                          <button
                            onClick={() => setShowExportedPoolKey(!showExportedPoolKey)}
                            className="p-1 rounded hover:bg-zinc-700"
                          >
                            {showExportedPoolKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                        </div>
                        <code className="text-[10px] font-mono text-amber-300 break-all block">
                          {showExportedPoolKey ? exportedPoolKey : '••••••••••••••••••••••••••••••••'}
                        </code>
                        <button
                          onClick={() => { navigator.clipboard.writeText(exportedPoolKey); }}
                          className="mt-1 w-full py-1 text-[10px] rounded bg-zinc-800 text-zinc-400 flex items-center justify-center gap-1 hover:bg-zinc-700"
                        >
                          <Copy className="w-3 h-3" /> Copy Key
                        </button>
                        <p className="text-[8px] text-amber-500/70 mt-1">Import to Phantom: Settings → Manage Wallets → Import</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={handleSetupPool}
                    disabled={isSettingUpPool || !connected || !signMessage}
                    className="w-full py-2 text-xs rounded bg-violet-500/10 border border-violet-500/30 text-violet-300 flex items-center justify-center gap-1"
                  >
                    {isSettingUpPool ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                    Setup Pool Wallet
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Test Payment */}
          <div className="p-3 rounded-lg bg-aegix-cyan/5 border border-aegix-cyan/20">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-aegix-cyan" />
              <span className="text-sm font-medium">Donation x402 Payment</span>
            </div>
            <p className="text-xs text-zinc-500 mb-2">Send a donation with FHE encryption</p>
            <div className="flex gap-2 mb-2">
              <input
                type="number"
                value={donationAmount}
                onChange={(e) => setDonationAmount(e.target.value)}
                step="0.01"
                min="0.01"
                className="flex-1 px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-sm font-mono"
              />
              <span className="py-1.5 text-sm text-zinc-400">USDC</span>
            </div>
            <button
              onClick={handleDonation}
              disabled={donating || !connected}
              className="w-full py-2 rounded-lg bg-gradient-to-r from-aegix-cyan to-violet-500 text-black text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {donating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {donating ? 'Processing...' : `Pay ${donationAmount} USDC`}
            </button>
            {donationResult && (
              <div className={`mt-2 p-2 rounded text-xs ${
                donationResult.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
              }`}>
                {donationResult.success ? (
                  <span className="flex items-center gap-1">
                    ✓ Sent! <a href={`https://solscan.io/tx/${donationResult.tx}`} target="_blank" rel="noopener noreferrer" className="underline flex items-center gap-0.5">View <ExternalLink className="w-3 h-3" /></a>
                  </span>
                ) : 'Failed'}
              </div>
            )}
            <p className="text-[10px] text-zinc-500 mt-2 flex items-center gap-1">
              <Lock className="w-3 h-3 text-violet-400" />
              Payment uses Light Protocol ZK Compression
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* Actions */}
          {showDeleteConfirm ? (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <p className="text-sm mb-2 flex items-center gap-1">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                Delete &quot;{agent.name}&quot;?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-1.5 rounded border border-zinc-700 text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isLoading}
                  className="flex-1 py-1.5 rounded bg-red-500 text-white text-xs font-medium flex items-center justify-center gap-1"
                >
                  {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="p-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={handleSave}
                disabled={isLoading || !hasChanges}
                className="flex-1 py-2 rounded-lg bg-aegix-cyan text-black font-medium hover:bg-aegix-cyan/80 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-800">
          <p className="text-xs text-zinc-600 font-mono">ID: {agent.id}</p>
        </div>
      </div>
    </div>
  );
}
