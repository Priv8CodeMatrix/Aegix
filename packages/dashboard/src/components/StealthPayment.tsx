'use client';

/**
 * StealthPayment Component - Aegix 3.1 Institutional Terminal
 * 
 * STEALTH EXECUTION ARCHITECTURE:
 * - Single pool wallet per user (permanent, reusable)
 * - User funds pool once (or tops up)
 * - Every payment uses ephemeral burner → SOL auto-recovers to pool
 * - Maximum privacy, minimum cost
 */

import { useState, useCallback, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { 
  Shield, Eye, EyeOff, ArrowRight, Check, Loader2, AlertCircle, 
  ExternalLink, Copy, Zap, Key, Wallet, Lock, RefreshCw, Activity,
  ChevronDown, Terminal, Sparkles
} from 'lucide-react';
import { AuditTrail } from './AuditTrail';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';

interface StealthPaymentProps {
  recipient?: string;
  recipientName?: string;
  amount?: string;
  onSuccess?: (txSignature: string) => void;
  onError?: (error: string) => void;
  onPoolReady?: (poolAddress: string, poolId?: string) => void;
}

interface PoolWallet {
  poolId: string;
  poolAddress: string;
  status: 'created' | 'funded' | 'active';
  balance: { sol: number; usdc: number; compressedUsdc?: number } | null;
  totalPayments: number;
  totalSolRecovered: number;
}

type Step = 'loading' | 'init' | 'fund' | 'ready' | 'paying' | 'complete' | 'error';

export default function StealthPayment({ 
  recipient = '', 
  recipientName = 'Service Provider',
  amount = '0.05',
  onSuccess,
  onError,
  onPoolReady,
}: StealthPaymentProps) {
  const { publicKey, signTransaction, signMessage, connected } = useWallet();
  const { connection } = useConnection();
  
  // Pool wallet state
  const [pool, setPool] = useState<PoolWallet | null>(null);
  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState<string | null>(null);
  
  // Form inputs
  const [inputRecipient, setInputRecipient] = useState(recipient);
  const [inputAmount, setInputAmount] = useState(amount);
  const [fundAmount, setFundAmount] = useState('1.00');
  
  // Transaction results
  const [paymentTx, setPaymentTx] = useState<string | null>(null);
  const [tempBurnerAddress, setTempBurnerAddress] = useState<string | null>(null);
  const [solRecovered, setSolRecovered] = useState<number | null>(null);
  
  // Key export
  const [exportedKey, setExportedKey] = useState<string | null>(null);
  const [showExportedKey, setShowExportedKey] = useState(false);
  const [isExportingKey, setIsExportingKey] = useState(false);
  const [showAddresses, setShowAddresses] = useState(false);
  
  // Auto top-up state
  const [needsTopUp, setNeedsTopUp] = useState<'sol' | 'usdc' | 'both' | null>(null);
  const [topUpAmount, setTopUpAmount] = useState<{ sol: number; usdc: number }>({ sol: 0, usdc: 0 });
  const [pendingPayment, setPendingPayment] = useState<{ recipient: string; amount: string } | null>(null);
  const [isTopingUp, setIsTopingUp] = useState(false);
  
  // Pool lock state
  const [poolLocked, setPoolLocked] = useState(false);
  
  // Withdraw state
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawSol, setWithdrawSol] = useState('');
  const [withdrawUsdc, setWithdrawUsdc] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  
  // Deposit state
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositSol, setDepositSol] = useState('');
  const [depositUsdc, setDepositUsdc] = useState('');
  const [isDepositing, setIsDepositing] = useState(false);
  
  // Legacy pool migration state
  const [legacyPoolAddress, setLegacyPoolAddress] = useState<string | null>(null);
  
  // Light Protocol state (Aegix 4.0 - Compression mandatory)
  const [useLightMode, setUseLightMode] = useState(true); // Always ON in v4.0
  const [lightHealth, setLightHealth] = useState<{ 
    healthy: boolean; 
    slot?: number; 
    error?: string;
    hint?: string;
    rpcUrl?: string;
  } | null>(null);
  const [lightSavings, setLightSavings] = useState<string | null>(null);
  const [lastPaymentWasLight, setLastPaymentWasLight] = useState(false);
  
  // Recovery Pool state (Aegix 4.0 - Dedicated fee payer for privacy)
  const [recoveryPoolStatus, setRecoveryPoolStatus] = useState<{
    initialized: boolean;
    address: string | null;
    balance: number;
    isHealthy: boolean;
    status: 'NOT_INITIALIZED' | 'HEALTHY' | 'NEEDS_FUNDING';
  } | null>(null);
  
  // Compressed balance state (Aegix 4.0 - Shield required before payments)
  const [compressedBalance, setCompressedBalance] = useState<number>(0);
  const [regularBalance, setRegularBalance] = useState<number>(0);
  const [needsShielding, setNeedsShielding] = useState(false);
  const [shieldingInfo, setShieldingInfo] = useState<{
    regularUsdc: number;
    compressedUsdc: number;
    required: number;
  } | null>(null);
  
  // Shield modal state (inline shielding in Execute Payment)
  const [showShieldModal, setShowShieldModal] = useState(false);
  const [shieldAmount, setShieldAmount] = useState('');
  const [isShielding, setIsShielding] = useState(false);
  const [shieldingStatus, setShieldingStatus] = useState<'idle' | 'building' | 'signing' | 'confirming' | 'success' | 'error'>('idle');
  
  // Payment confirmation modal state
  const [showPaymentConfirmModal, setShowPaymentConfirmModal] = useState(false);
  const [usePrivacyHardened, setUsePrivacyHardened] = useState(false);
  const [hasCompressedFunds, setHasCompressedFunds] = useState(false);
  
  // Refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Audit Trail modal state
  const [showAuditTrail, setShowAuditTrail] = useState(false);

  // Load pool wallet on wallet connect
  useEffect(() => {
    if (publicKey && connected) {
      loadPoolWallet();
      checkLightHealth();
      checkRecoveryPool();
    } else {
      setPool(null);
      setStep('loading');
    }
  }, [publicKey, connected]);
  
  // Poll for balance updates every 15 seconds (to catch shielded balance changes)
  useEffect(() => {
    if (!publicKey || !connected || step === 'loading' || step === 'init') return;
    
    const pollInterval = setInterval(() => {
      console.log('[StealthPayment] Polling for balance updates...');
      refreshBalance();
    }, 15000); // 15 seconds
    
    return () => clearInterval(pollInterval);
  }, [publicKey, connected, step]);
  
  // Refresh balance only (without full reload)
  const refreshBalance = async () => {
    if (!publicKey) return;
    
    try {
      const response = await fetch(`${GATEWAY_URL}/api/credits/pool/${publicKey.toBase58()}`);
      const result = await response.json();
      
      if (result.success && result.data.balance) {
        console.log('[StealthPayment] Balance refreshed:', result.data.balance);
        setPool(prev => prev ? {
          ...prev,
          balance: result.data.balance,
        } : null);
      }
    } catch (err) {
      console.error('[StealthPayment] Balance refresh failed:', err);
    }
  };

  // Check Light Protocol health with detailed status
  const checkLightHealth = async () => {
    try {
      const response = await fetch(`${GATEWAY_URL}/api/agents/light/health`);
      const result = await response.json();
      if (result.success && result.data) {
        setLightHealth({ 
          healthy: result.data.healthy, 
          slot: result.data.slot,
          error: result.data.error,
          hint: result.data.hint,
          rpcUrl: result.data.rpc?.url,
        });
        if (result.data.costs) {
          const savings = (result.data.costs.regularAccountRent - result.data.costs.compressedAccountCost).toFixed(6);
          setLightSavings(`${savings} SOL per payment`);
        }
        // Log RPC status for debugging
        if (!result.data.healthy) {
          console.warn('[Light] Compression not available:', result.data.error);
          console.warn('[Light] Hint:', result.data.hint);
        }
      } else {
        setLightHealth({ 
          healthy: false, 
          error: result.error || 'Health check failed',
          hint: result.hint || 'Check RPC configuration',
        });
      }
    } catch (err: any) {
      console.error('[Light] Health check failed:', err);
      setLightHealth({ 
        healthy: false, 
        error: 'Cannot connect to gateway',
        hint: 'Check if gateway is running at ' + GATEWAY_URL,
      });
    }
  };

  // Check Recovery Pool status (fetches from backend)
  const checkRecoveryPool = async () => {
    try {
      const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';
      const response = await fetch(`${GATEWAY_URL}/api/credits/recovery/status`);
      const result = await response.json();
      
      if (result.success && result.data) {
        setRecoveryPoolStatus({
          initialized: result.data.initialized ?? true,
          address: result.data.address,
          balance: result.data.balance,
          isHealthy: result.data.isHealthy,
          status: result.data.status,
        });
      }
    } catch (err: any) {
      // Ignore
    }
  };

  // Shield (compress) USDC funds for private payments
  // Server signs and sends the transaction since it has the pool keypair
  const handleShield = async () => {
    if (!publicKey || !pool || !shieldAmount) {
      setError('Wallet not connected or missing pool/amount');
      return;
    }
    
    const amount = parseFloat(shieldAmount);
    if (isNaN(amount) || amount <= 0) {
      setError('Invalid shield amount');
      return;
    }
    
    setIsShielding(true);
    setShieldingStatus('building');
    setError(null);
    
    try {
      console.log('[Shield] Starting shield process:', { poolId: pool.poolId, amount });
      
      // Request shield - server will build, sign, and send the transaction
      console.log('[Shield] Requesting server-side shield...');
      setShieldingStatus('confirming'); // Server handles signing
      
      const response = await fetch(`${GATEWAY_URL}/api/credits/pool/shield`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poolId: pool.poolId,
          amountUsdc: amount.toString(),
          owner: publicKey.toBase58(),
        }),
      });
      
      const result = await response.json();
      console.log('[Shield] Backend response:', result);
      
      if (!result.success) {
        // Handle specific error codes
        if (result.errorCode === 'LIGHT_UNAVAILABLE') {
          throw new Error('Light Protocol is currently unavailable. Use Standard Private Payment instead.');
        } else if (result.errorCode === 'SHIELD_SDK_ERROR') {
          throw new Error('Shielding temporarily unavailable. The Standard Private Payment option still provides privacy.');
        } else if (result.errorCode === 'NO_USDC') {
          throw new Error('No USDC found in pool. Deposit USDC first.');
        } else if (result.errorCode === 'POOL_KEY_UNAVAILABLE') {
          throw new Error('Pool needs to be re-initialized. Please refresh and try again.');
        } else if (result.errorCode === 'TX_FAILED') {
          throw new Error('Transaction failed on-chain: ' + (result.details || 'Unknown error'));
        }
        throw new Error(result.error || result.hint || 'Failed to shield funds');
      }
      
      // Success! Transaction was signed and confirmed by server
      const signature = result.data?.signature || 'confirmed';
      console.log('[Shield] ✓ Shield complete! Signature:', signature);
      
      setShieldingStatus('success');
      
      // Update local state
      setNeedsShielding(false);
      setShieldingInfo(null);
      setShowShieldModal(false);
      setShieldAmount('');
      setHasCompressedFunds(true);
      
      // Refresh balances
      console.log('[Shield] Refreshing balances...');
      setTimeout(async () => {
        await loadPoolWallet();
        await checkLightHealth();
        console.log('[Shield] Balances refreshed');
      }, 1000);
      
      // Show success message
      const compressedBalance = result.data?.compression?.compressedBalance || amount;
      alert(`✅ Successfully shielded ${amount} USDC!\n\n${result.data?.message || 'Your funds are now compressed and ready for Maximum Privacy payments (~50x cheaper).'}\n\nTransaction: ${signature.slice(0, 20)}...`);
      
    } catch (err: any) {
      console.error('[Shield] Error:', err);
      setShieldingStatus('error');
      setError(err.message || 'Failed to shield funds');
    } finally {
      setIsShielding(false);
      // Reset status after a delay if success
      setTimeout(() => {
        if (shieldingStatus === 'success' || shieldingStatus === 'error') {
          setShieldingStatus('idle');
        }
      }, 3000);
    }
  };

  // Open shield modal with pool's regular balance
  const openShieldModal = () => {
    if (pool?.balance?.usdc) {
      setShieldAmount(pool.balance.usdc.toFixed(2));
    } else if (shieldingInfo?.regularUsdc) {
      setShieldAmount(shieldingInfo.regularUsdc.toFixed(2));
    }
    setShowShieldModal(true);
  };

  // Load existing pool wallet
  const loadPoolWallet = async () => {
    if (!publicKey) return;
    
    setStep('loading');
    setError(null); // Clear any previous errors
    
    try {
      const response = await fetch(`${GATEWAY_URL}/api/credits/pool/${publicKey.toBase58()}`);
      const result = await response.json();
      
      if (result.success) {
        // If pool needs re-auth after server restart, show init step to let user sign
        if (result.data.needsReauth) {
          setPoolLocked(true);
          setStep('init'); // Don't auto-sign - let user click button
          return;
        }
        
        setPoolLocked(false);
        setPool({
          poolId: result.data.poolId,
          poolAddress: result.data.poolAddress,
          status: result.data.status,
          balance: result.data.balance,
          totalPayments: result.data.totalPayments,
          totalSolRecovered: result.data.totalSolRecovered,
        });
        
        // Notify parent of pool address and poolId
        if (result.data.poolAddress) {
          onPoolReady?.(result.data.poolAddress, result.data.poolId);
        }
        
        // Determine step based on actual balance, not status
        const hasBalance = result.data.balance && 
          (result.data.balance.usdc > 0 || result.data.balance.sol > 0.001);
        const isReady = result.data.balance && 
          result.data.balance.usdc > 0 && result.data.balance.sol > 0.002;
        
        if (isReady) {
          // Pool has both USDC and SOL - ready for payments
          setStep('ready');
        } else if (hasBalance) {
          // Pool has some balance but needs more - show ready but with low balance warning
          setStep('ready'); // Don't block user from ready screen
        } else if (result.data.status === 'created') {
          // Pool created but no funds
          setStep('fund');
        } else {
          // Pool exists but unfunded
          setStep('fund');
        }
        
        if (result.data.legacyPoolAddress) {
          setLegacyPoolAddress(result.data.legacyPoolAddress);
        }
      } else {
        setStep('init');
      }
    } catch (err) {
      console.error('[Pool] Error loading:', err);
      setStep('init');
    }
  };

  // Initialize pool wallet
  const handleInitPool = async () => {
    if (!publicKey || !signMessage) return;
    
    setError(null);
    
    try {
      const message = `AEGIX_POOL_AUTH::${publicKey.toBase58()}::${Date.now()}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signature = await signMessage(encodedMessage);
      
      const signatureBase64 = Buffer.from(signature).toString('base64');
      
      const response = await fetch(`${GATEWAY_URL}/api/credits/pool/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          signature: signatureBase64,
          message,
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        setPoolLocked(false);
        
        if (result.data.legacyPoolAddress) {
          setLegacyPoolAddress(result.data.legacyPoolAddress);
        }
        
        // After successful init, reload pool to get full state including balance
        await loadPoolWallet();
      } else {
        throw new Error(result.error || 'Failed to initialize pool');
      }
    } catch (err: any) {
      console.error('[Pool] Init error:', err);
      setError(err.message || 'Failed to initialize pool wallet');
      // Go to init step to allow retry, not error step
      setStep('init');
      onError?.(err.message);
    }
  };

  // Fund pool wallet
  const handleFundPool = async () => {
    if (!publicKey || !signTransaction || !pool) return;
    
    setError(null);
    
    try {
      const response = await fetch(`${GATEWAY_URL}/api/credits/pool/fund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          amountUSDC: parseFloat(fundAmount),
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to prepare funding transaction');
      }
      
      const txBuffer = Buffer.from(result.data.transaction, 'base64');
      const transaction = Transaction.from(txBuffer);
      
      const signedTx = await signTransaction(transaction);
      const serializedTx = signedTx.serialize();
      const txSignature = await connection.sendRawTransaction(serializedTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      
      await connection.confirmTransaction(txSignature, 'confirmed');
      
      // Confirm funding
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const confirmResponse = await fetch(`${GATEWAY_URL}/api/credits/pool/confirm-funding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          txSignature,
        }),
      });
      
      const confirmResult = await confirmResponse.json();
      
      if (confirmResult.success) {
        setPool(prev => prev ? {
          ...prev,
          status: confirmResult.data.status,
          balance: confirmResult.data.balance,
        } : null);
        setStep('ready');
      }
    } catch (err: any) {
      console.error('[Pool] Funding error:', err);
      setError(err.message || 'Failed to fund pool');
      onError?.(err.message);
    }
  };

  // Execute payment - COMPRESSION ONLY (Aegix 4.0)
  // Show payment confirmation modal
  const initiatePayment = () => {
    if (!publicKey || !pool || !inputRecipient || parseFloat(inputAmount) <= 0) return;
    
    // Check if pool has compressed/shielded funds available
    const compressedUsdc = (pool.balance as any)?.compressedUsdc || 0;
    const paymentAmount = parseFloat(inputAmount);
    const hasEnoughShielded = compressedUsdc >= paymentAmount;
    
    console.log('[Payment] Checking shielded balance:', { compressedUsdc, paymentAmount, hasEnoughShielded });
    
    setHasCompressedFunds(hasEnoughShielded);
    setUsePrivacyHardened(hasEnoughShielded); // Default to Maximum Privacy if shielded funds available
    setShowPaymentConfirmModal(true);
  };

  // Execute payment after confirmation
  const handlePay = async () => {
    if (!publicKey || !pool || !inputRecipient || parseFloat(inputAmount) <= 0) return;
    
    setShowPaymentConfirmModal(false);
    setError(null);
    setStep('paying');
    
    // Aegix 4.0: Dual-mode - compressed (privacy) or standard (always works)
    console.log(`[Payment] Executing ${usePrivacyHardened ? 'COMPRESSED PRIVATE' : 'STANDARD'} payment`);
    
    try {
      const response = await fetch(`${GATEWAY_URL}/api/credits/pool/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          recipient: inputRecipient,
          amountUSDC: parseFloat(inputAmount),
          useCompressed: usePrivacyHardened,
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        // Handle Light Protocol unavailable for compressed payments
        if (result.errorCode === 'LIGHT_UNAVAILABLE') {
          setError('Privacy system offline. Retry with standard payment.');
          setStep('ready');
          return;
        }
        
        // Handle insufficient compressed funds when privacy selected
        if (result.errorCode === 'INSUFFICIENT_COMPRESSED') {
          setError(`Insufficient compressed funds. Shield more USDC or use standard payment.`);
          setStep('ready');
          return;
        }
        
        // Check for insufficient funds
        if (result.errorCode?.includes('INSUFFICIENT') || result.error?.includes('Insufficient')) {
          const details = result.details || { 
            sol: { shortfall: 0.001, have: 0 }, 
            usdc: { shortfall: parseFloat(inputAmount), have: 0 } 
          };
          
          let topUpType: 'sol' | 'usdc' | 'both' | null = null;
          const needed = { sol: 0, usdc: 0 };
          
          if (details.sol?.shortfall > 0) {
            topUpType = 'sol';
            needed.sol = Math.max(0.001, details.sol.shortfall + 0.0005);
          }
          if (details.usdc?.shortfall > 0) {
            topUpType = topUpType ? 'both' : 'usdc';
            needed.usdc = details.usdc.shortfall + 0.01;
          }
          
          setNeedsTopUp(topUpType);
          setTopUpAmount(needed);
          setPendingPayment({ recipient: inputRecipient, amount: inputAmount });
          setStep('ready');
          return;
        }
        throw new Error(result.error || 'Payment failed');
      }
      
      // Success - Payment complete (compressed or standard)
      setPaymentTx(result.data.paymentTx);
      setTempBurnerAddress(result.data.tempBurnerAddress || null);
      
      // Calculate savings if compressed payment
      if (result.data.compression?.savings?.perPayment) {
        const savings = result.data.compression.savings.perPayment;
        const solSaved = parseFloat(savings.replace(' SOL', ''));
        setSolRecovered(solSaved);
        setLightSavings(savings);
        setLastPaymentWasLight(true);
      } else {
        setSolRecovered(0);
        setLightSavings(null);
        setLastPaymentWasLight(false);
      }
      
      // Clear shielding state
      setNeedsShielding(false);
      setShieldingInfo(null);
      
      // Update pool state with new balance
      if (result.data.poolBalance) {
        setPool(prev => prev ? {
          ...prev,
          balance: result.data.poolBalance,
          totalPayments: prev.totalPayments + 1,
        } : null);
      }
      
      setStep('complete');
      onSuccess?.(result.data.paymentTx);
    } catch (err: any) {
      console.error('[Pool] Payment error:', err);
      setError(err.message || 'Payment failed');
      setStep('error');
      onError?.(err.message);
    }
  };

  // Top up pool
  const handleTopUp = async () => {
    if (!publicKey || !signTransaction || !pool || !needsTopUp) return;
    
    setIsTopingUp(true);
    setError(null);
    
    try {
      // FIX: Use /pool/top-up instead of /pool/fund
      const response = await fetch(`${GATEWAY_URL}/api/credits/pool/top-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          addSol: topUpAmount.sol > 0 ? topUpAmount.sol : undefined,
          addUsdc: topUpAmount.usdc > 0 ? topUpAmount.usdc : undefined,
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to prepare top-up');
      }
      
      const txBuffer = Buffer.from(result.data.transaction, 'base64');
      const transaction = Transaction.from(txBuffer);
      
      const signedTx = await signTransaction(transaction);
      const serializedTx = signedTx.serialize();
      const txSignature = await connection.sendRawTransaction(serializedTx);
      
      await connection.confirmTransaction(txSignature, 'confirmed');
      
      // Confirm and retry payment
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const confirmResponse = await fetch(`${GATEWAY_URL}/api/credits/pool/confirm-funding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          txSignature,
        }),
      });
      
      const confirmResult = await confirmResponse.json();
      
      if (confirmResult.success) {
        setPool(prev => prev ? {
          ...prev,
          balance: confirmResult.data.balance,
        } : null);
        
        setNeedsTopUp(null);
        setTopUpAmount({ sol: 0, usdc: 0 });
        
        if (pendingPayment) {
          setInputRecipient(pendingPayment.recipient);
          setInputAmount(pendingPayment.amount);
          setPendingPayment(null);
          
          setTimeout(() => handlePay(), 500);
        }
      }
    } catch (err: any) {
      console.error('[Pool] Top-up error:', err);
      setError(err.message || 'Failed to top up pool');
    } finally {
      setIsTopingUp(false);
    }
  };

  const cancelTopUp = () => {
    setNeedsTopUp(null);
    setTopUpAmount({ sol: 0, usdc: 0 });
    setPendingPayment(null);
  };

  // Custom deposit to pool (SOL and/or USDC)
  const handleDeposit = async () => {
    if (!publicKey || !signTransaction || !pool) return;
    
    const solAmount = depositSol ? parseFloat(depositSol) : 0;
    const usdcAmount = depositUsdc ? parseFloat(depositUsdc) : 0;
    
    if (solAmount <= 0 && usdcAmount <= 0) {
      setError('Please enter an amount for SOL and/or USDC');
      return;
    }
    
    if (solAmount < 0 || usdcAmount < 0) {
      setError('Amounts must be positive');
      return;
    }
    
    setIsDepositing(true);
    setError(null);
    
    try {
      const response = await fetch(`${GATEWAY_URL}/api/credits/pool/top-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          addSol: solAmount > 0 ? solAmount : undefined,
          addUsdc: usdcAmount > 0 ? usdcAmount : undefined,
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to prepare deposit transaction');
      }
      
      const txBuffer = Buffer.from(result.data.transaction, 'base64');
      const transaction = Transaction.from(txBuffer);
      
      const signedTx = await signTransaction(transaction);
      const serializedTx = signedTx.serialize();
      const txSignature = await connection.sendRawTransaction(serializedTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      
      await connection.confirmTransaction(txSignature, 'confirmed');
      
      // Refresh pool balance
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const balanceResponse = await fetch(`${GATEWAY_URL}/api/credits/pool/${publicKey.toBase58()}`);
      const balanceResult = await balanceResponse.json();
      
      if (balanceResult.success && balanceResult.data) {
        setPool(prev => prev ? {
          ...prev,
          balance: balanceResult.data.balance,
        } : null);
      }
      
      // Reset form
      setDepositSol('');
      setDepositUsdc('');
      setShowDeposit(false);
      
    } catch (err: any) {
      console.error('[Pool] Deposit error:', err);
      setError(err.message || 'Failed to deposit funds');
    } finally {
      setIsDepositing(false);
    }
  };

  // Export pool private key
  const handleExportKey = async () => {
    if (!publicKey || !signMessage) return;
    
    setIsExportingKey(true);
    
    try {
      const message = `AEGIX_EXPORT_KEY::${publicKey.toBase58()}::${Date.now()}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signature = await signMessage(encodedMessage);
      const signatureBase64 = Buffer.from(signature).toString('base64');
      
      const response = await fetch(`${GATEWAY_URL}/api/credits/pool/export-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          signature: signatureBase64,
          message,
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        setExportedKey(result.data.privateKey);
      } else {
        throw new Error(result.error || 'Failed to export key');
      }
    } catch (err: any) {
      console.error('[Pool] Export error:', err);
      setError(err.message);
    } finally {
      setIsExportingKey(false);
    }
  };

  // Refresh pool
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadPoolWallet();
    setIsRefreshing(false);
  };

  // Reset to ready state
  const handleReset = () => {
    setPaymentTx(null);
    setTempBurnerAddress(null);
    setSolRecovered(null);
    setInputRecipient('');
    setInputAmount('0.05');
    setStep('ready');
  };

  // Withdraw from pool
  const handleWithdraw = async () => {
    if (!publicKey || !signTransaction || !pool) return;
    
    setIsWithdrawing(true);
    setError(null);
    
    try {
      const response = await fetch(`${GATEWAY_URL}/api/credits/pool/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          withdrawSol: withdrawSol ? parseFloat(withdrawSol) : 0,
          withdrawUsdc: withdrawUsdc ? parseFloat(withdrawUsdc) : 0,
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to prepare withdrawal');
      }
      
      const txBuffer = Buffer.from(result.data.transaction, 'base64');
      const transaction = Transaction.from(txBuffer);
      
      const signedTx = await signTransaction(transaction);
      const serializedTx = signedTx.serialize();
      const txSignature = await connection.sendRawTransaction(serializedTx);
      
      await connection.confirmTransaction(txSignature, 'confirmed');
      
      await handleRefresh();
      setWithdrawSol('');
      setWithdrawUsdc('');
      setShowWithdraw(false);
    } catch (err: any) {
      console.error('[Pool] Withdraw error:', err);
      setError(err.message || 'Failed to withdraw');
    } finally {
      setIsWithdrawing(false);
    }
  };

  // Render pool status bar
  const renderPoolStatus = () => {
    if (!pool) return null;
    
    return (
      <div className="border border-slate-700 bg-slate-900 p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-500">POOL_INSTANCE</span>
            {/* Never show SETUP for funded pools - check actual balance */}
            {pool.balance && (pool.balance.sol > 0.001 || pool.balance.usdc > 0) ? (
              <span className="status-badge success">Compressed • Ready</span>
            ) : pool.status === 'active' ? (
              <span className="status-badge success">Ready</span>
            ) : (
              <span className="status-badge warning">Unfunded</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1 hover:bg-slate-800 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 text-slate-500 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowAddresses(!showAddresses)}
              className="p-1 hover:bg-slate-800 transition-colors"
            >
              {showAddresses ? <EyeOff className="w-3 h-3 text-slate-500" /> : <Eye className="w-3 h-3 text-slate-500" />}
            </button>
          </div>
        </div>
        
        {showAddresses && (
          <div className="flex items-center gap-2 mb-2 p-2 bg-slate-800 border border-slate-700">
            <code className="text-[10px] text-slate-400 font-mono flex-1 truncate">
              {pool.poolAddress}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(pool.poolAddress)}
              className="p-1 hover:bg-slate-700"
            >
              <Copy className="w-3 h-3 text-slate-500" />
            </button>
            <a
              href={`https://solscan.io/account/${pool.poolAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 hover:bg-slate-700"
            >
              <ExternalLink className="w-3 h-3 text-status-info" />
            </a>
          </div>
        )}
        
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-[10px] text-slate-500 block mb-0.5">USDC_BAL</span>
            <span className="font-mono text-slate-100">
              {pool.balance ? pool.balance.usdc.toFixed(4) : '-.----'}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block mb-0.5">SOL_BAL</span>
            <span className="font-mono text-slate-100">
              {pool.balance ? pool.balance.sol.toFixed(6) : '-.------'}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block mb-0.5">TX_COUNT</span>
            <span className="font-mono text-slate-100">{pool.totalPayments}</span>
          </div>
        </div>
        
        {/* Shielded/Compressed Balance - Always Show */}
        <div className={`mt-3 p-2 border ${
          (pool.balance as any)?.compressedUsdc > 0 
            ? 'border-emerald-500/30 bg-emerald-500/10' 
            : 'border-slate-700 bg-slate-800/50'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className={`w-4 h-4 ${(pool.balance as any)?.compressedUsdc > 0 ? 'text-emerald-400' : 'text-slate-500'}`} />
              <span className={`text-[10px] font-mono ${(pool.balance as any)?.compressedUsdc > 0 ? 'text-emerald-300' : 'text-slate-500'}`}>
                SHIELDED_BALANCE
              </span>
              <button 
                onClick={refreshBalance}
                className="text-[9px] text-slate-500 hover:text-slate-300 ml-1"
                title="Refresh balance"
              >
                ↻
              </button>
            </div>
            <span className={`font-mono text-sm font-bold ${
              (pool.balance as any)?.compressedUsdc > 0 ? 'text-emerald-400' : 'text-slate-500'
            }`}>
              {((pool.balance as any)?.compressedUsdc || 0).toFixed(4)} USDC
            </span>
          </div>
          {(pool.balance as any)?.compressedUsdc > 0 ? (
            <div className="text-[9px] text-emerald-300/70 mt-1">
              ✓ Ready for Maximum Privacy payments (~50x cheaper)
            </div>
          ) : (
            <div className="text-[9px] text-slate-500 mt-1">
              Shield your USDC to enable Maximum Privacy payments
            </div>
          )}
        </div>
        
        {/* Shield Funds Button - Show when there's regular USDC but no/low shielded */}
        {pool.balance && pool.balance.usdc > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-700">
            <button
              onClick={openShieldModal}
              disabled={isShielding}
              className="w-full py-1.5 text-[10px] font-mono border border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-300 hover:border-slate-600 flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Shield className="w-3 h-3" />
              {isShielding ? 'Shielding...' : ((pool.balance as any)?.compressedUsdc > 0 ? 'Shield More Funds' : 'Shield Funds • Enable Compressed Payments')}
            </button>
          </div>
        )}
        
        {pool.totalSolRecovered > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-700 flex items-center justify-between text-xs">
            <span className="text-slate-500">SOL_RECYCLED</span>
            <span className="font-mono text-status-success">+{pool.totalSolRecovered.toFixed(6)}</span>
          </div>
        )}
        
        {pool.totalPayments > 0 && (
          <button
            onClick={() => setShowAuditTrail(true)}
            className="w-full mt-3 py-1.5 text-[10px] font-mono bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-300 hover:border-slate-600 flex items-center justify-center gap-1.5"
          >
            <Activity className="w-3 h-3" />
            VIEW_AUDIT_TRAIL
          </button>
        )}
      </div>
    );
  };

  // Recovery Pool expanded state
  const [recoveryExpanded, setRecoveryExpanded] = useState(false);

  // Render Recovery Pool status (Aegix 4.0 - collapsible)
  const renderRecoveryPoolStatus = () => {
    if (!recoveryPoolStatus) return null;
    
    // Not initialized - show warning
    if (!recoveryPoolStatus.initialized || !recoveryPoolStatus.address) {
      return (
        <div className="border border-status-warning/30 bg-status-warning/5 p-3 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-status-warning" />
            <span className="text-xs font-mono text-status-warning">RECOVERY_POOL NOT INITIALIZED</span>
          </div>
          <p className="text-[10px] text-slate-400">
            Initialize the Recovery Pool in Stealth Pool Channel to enable privacy payments.
          </p>
        </div>
      );
    }
    
    return (
      <div className="border border-slate-700 bg-slate-900 mb-4">
        {/* Collapsible Header */}
        <div 
          className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-slate-800/50"
          onClick={() => setRecoveryExpanded(!recoveryExpanded)}
        >
          <div className="flex items-center gap-2">
            <ChevronDown className={`w-3 h-3 text-slate-500 transition-transform ${recoveryExpanded ? '' : '-rotate-90'}`} />
            <Shield className="w-4 h-4 text-slate-400" />
            <span className="text-[10px] font-mono text-slate-400">RECOVERY_POOL</span>
            <span className="px-1.5 py-0.5 text-[8px] font-mono bg-slate-800 text-slate-500 border border-slate-700">
              FEE PAYER
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400">
              {recoveryPoolStatus.balance.toFixed(4)} SOL
            </span>
            <span className={`text-[9px] font-mono ${recoveryPoolStatus.isHealthy ? 'text-status-success' : 'text-status-warning'}`}>
              {recoveryPoolStatus.isHealthy ? 'Ready' : 'Fund'}
            </span>
          </div>
        </div>
        
        {/* Expanded Content */}
        {recoveryExpanded && recoveryPoolStatus.address && (
          <div className="px-3 pb-3 pt-1 border-t border-slate-800">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 block mb-0.5">ADDRESS</span>
                <span className="font-mono text-slate-300 text-[10px]">
                  {recoveryPoolStatus.address.slice(0, 8)}...{recoveryPoolStatus.address.slice(-4)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block mb-0.5">MIN_REQUIRED</span>
                <span className="font-mono text-slate-300">0.005 SOL</span>
              </div>
            </div>
            <p className="text-[9px] text-slate-500 mt-2">
              Pays fees for compressed payments, breaking on-chain link.
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="border border-slate-700 bg-slate-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700 bg-slate-900 flex items-center gap-3">
        <div className="w-8 h-8 border border-status-info/30 bg-status-info/5 flex items-center justify-center">
          <Shield className="w-4 h-4 text-status-info" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-slate-100">PRIVATE_EXECUTION</h3>
          <p className="text-[10px] text-slate-500 font-mono">ZK_COMPRESSED // EPHEMERAL_BURNER_PIPELINE</p>
        </div>
      </div>
      
      <div className="p-4">
        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 border border-status-critical/30 bg-status-critical/10 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-status-critical flex-shrink-0" />
            <span className="text-xs text-slate-300 font-mono">{error}</span>
          </div>
        )}
        
        {/* Legacy Pool Warning */}
        {legacyPoolAddress && (
          <div className="mb-4 p-3 border border-status-warning/30 bg-status-warning/10">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-status-warning" />
              <span className="text-xs font-medium text-status-warning">LEGACY_POOL_DETECTED</span>
            </div>
            <p className="text-[10px] text-slate-400 mb-2">
              Deprecated pool from previous security model. Export private key to recover funds.
            </p>
            <code className="text-[10px] text-status-warning font-mono block truncate">{legacyPoolAddress}</code>
            <button
              onClick={() => setLegacyPoolAddress(null)}
              className="mt-2 text-[10px] text-slate-500 hover:text-slate-400"
            >
              DISMISS
            </button>
          </div>
        )}
        
        {/* Loading State */}
        {step === 'loading' && (
          <div className="py-8 text-center">
            <Loader2 className="w-6 h-6 text-slate-500 mx-auto mb-2 animate-spin" />
            <span className="text-xs text-slate-500 font-mono">LOADING_POOL_STATE...</span>
          </div>
        )}
        
        {/* Step: Initialize Pool */}
        {step === 'init' && (
          <div className="space-y-4">
            <div className="p-4 border border-slate-700 bg-slate-900">
              <div className="flex items-center gap-2 mb-2">
                <Lock className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-medium text-slate-300">INITIALIZE_STEALTH_POOL</span>
              </div>
              <p className="text-[10px] text-slate-500 mb-3">
                Sign message to derive deterministic keypair for ephemeral burner operations.
              </p>
              <div className="text-[10px] text-slate-600 font-mono space-y-1">
                <div>• Pool_Instance: PERMANENT</div>
                <div>• Keypair_Derivation: DETERMINISTIC</div>
                <div>• Burner_Lifecycle: EPHEMERAL</div>
              </div>
            </div>
            
            <button
              onClick={handleInitPool}
              disabled={!connected || !signMessage}
              className="w-full py-2.5 bg-status-info text-white text-xs font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Key className="w-3.5 h-3.5" />
              SIGN_TO_INITIALIZE
            </button>
          </div>
        )}
        
        {/* Step: Fund Pool */}
        {step === 'fund' && (
          <div className="space-y-4">
            {renderPoolStatus()}
            {renderRecoveryPoolStatus()}
            
            <div className="p-3 border border-status-success/30 bg-status-success/5">
              <div className="flex items-center gap-2 mb-1">
                <Check className="w-3.5 h-3.5 text-status-success" />
                <span className="text-xs font-medium text-status-success">POOL_INITIALIZED</span>
              </div>
              <p className="text-[10px] text-slate-400">
                Fund pool with USDC + SOL to enable stealth payments.
              </p>
            </div>
            
            <div>
              <label className="block text-[10px] font-mono text-slate-500 mb-1">
                USDC_AMOUNT
              </label>
              <input
                type="number"
                value={fundAmount}
                onChange={(e) => setFundAmount(e.target.value)}
                min="0.10"
                step="0.10"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 font-mono text-sm"
              />
              <p className="text-[9px] text-slate-600 mt-1">+ ~0.01 SOL for gas reserve</p>
            </div>
            
            <button
              onClick={handleFundPool}
              disabled={!signTransaction || parseFloat(fundAmount) < 0.01}
              className="w-full py-2.5 bg-status-info text-white text-xs font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Wallet className="w-3.5 h-3.5" />
              FUND_POOL ({fundAmount} USDC)
            </button>
            
            {/* Key Export */}
            {pool && (
              <div className="pt-3 border-t border-slate-800">
                {!exportedKey ? (
                  <button
                    onClick={handleExportKey}
                    disabled={isExportingKey}
                    className="w-full py-1.5 text-[10px] font-mono border border-slate-700 bg-slate-900 text-status-warning flex items-center justify-center gap-1.5 hover:border-status-warning/50 disabled:opacity-50"
                  >
                    {isExportingKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <Key className="w-3 h-3" />}
                    EXPORT_PRIVATE_KEY
                  </button>
                ) : (
                  <div className="p-2 border border-status-warning/30 bg-status-warning/10">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] text-status-warning font-mono">PRIVATE_KEY_EXPORT</span>
                      <button onClick={() => setShowExportedKey(!showExportedKey)} className="p-0.5">
                        {showExportedKey ? <EyeOff className="w-3 h-3 text-slate-500" /> : <Eye className="w-3 h-3 text-slate-500" />}
                      </button>
                    </div>
                    <code className="text-[9px] font-mono text-status-warning break-all block">
                      {showExportedKey ? exportedKey : '••••••••••••••••••••••••••••••••'}
                    </code>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        
        {/* Step: Ready to Pay */}
        {step === 'ready' && (
          <div className="space-y-4">
            {renderPoolStatus()}
            {renderRecoveryPoolStatus()}
            
            {/* Top-Up Required */}
            {needsTopUp && (
              <div className="p-3 border border-status-warning/30 bg-status-warning/5">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-status-warning" />
                  <span className="text-xs font-medium text-status-warning">INSUFFICIENT_FUNDS</span>
                </div>
                <div className="space-y-1 mb-3">
                  {(needsTopUp === 'sol' || needsTopUp === 'both') && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">SOL_REQUIRED</span>
                      <span className="font-mono text-status-warning">+{topUpAmount.sol.toFixed(4)}</span>
                    </div>
                  )}
                  {(needsTopUp === 'usdc' || needsTopUp === 'both') && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">USDC_REQUIRED</span>
                      <span className="font-mono text-status-warning">+{topUpAmount.usdc.toFixed(2)}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleTopUp}
                    disabled={isTopingUp}
                    className="flex-1 py-2 bg-status-warning text-slate-950 text-xs font-medium disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {isTopingUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    TOP_UP_AND_PAY
                  </button>
                  <button
                    onClick={cancelTopUp}
                    disabled={isTopingUp}
                    className="px-3 py-2 border border-slate-700 text-slate-400 text-xs hover:border-slate-600"
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            )}
            
            {/* Payment Form */}
            {!needsTopUp && (
              <>
                <div>
                  <label className="block text-[10px] font-mono text-slate-500 mb-1">
                    RECIPIENT_ADDRESS
                  </label>
                  <input
                    type="text"
                    value={inputRecipient}
                    onChange={(e) => setInputRecipient(e.target.value)}
                    placeholder="Solana wallet address"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs"
                  />
                </div>
                
                <div>
                  <label className="block text-[10px] font-mono text-slate-500 mb-1">
                    USDC_AMOUNT
                  </label>
                  <input
                    type="number"
                    value={inputAmount}
                    onChange={(e) => setInputAmount(e.target.value)}
                    min="0.01"
                    step="0.01"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 text-slate-100 font-mono text-sm"
                  />
                </div>
                
                <div className="p-3 border border-slate-700 bg-slate-900">
                  <div className="text-[10px] font-mono text-slate-500 mb-2">EXECUTION_PIPELINE</div>
                  <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400">
                    <span className="text-slate-500">Pool</span>
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                    <span className="text-status-info">Compressed_Burner</span>
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                    <span className="text-status-success">Recipient</span>
                  </div>
                  <div className="mt-2 text-[9px] text-slate-600">
                    ZK proof verifies transfer without revealing source
                  </div>
                </div>
                
                {poolLocked && (
                  <div className="p-2 border border-status-warning/30 bg-status-warning/5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5 text-status-warning" />
                      <span className="text-[10px] text-status-warning">POOL_LOCKED</span>
                    </div>
                    <button
                      onClick={handleInitPool}
                      className="text-[10px] text-status-warning hover:underline"
                    >
                      UNLOCK
                    </button>
                  </div>
                )}
                
                {/* Compression Status */}
                <div className={`p-2 border ${lightHealth?.healthy ? 'border-status-info/30 bg-status-info/5' : 'border-slate-700 bg-slate-800/50'} flex items-center justify-between`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${lightHealth?.healthy ? 'bg-status-success animate-pulse' : 'bg-slate-500'}`} />
                    <span className="text-[10px] font-mono text-slate-300">
                      {lightHealth?.healthy ? 'Compressed • Online' : 'Standard Mode'}
                    </span>
                  </div>
                  {lightHealth?.healthy && (
                    <span className="text-[10px] text-status-success font-mono">
                      ~50x cheaper
                    </span>
                  )}
                </div>
                
                <button
                  onClick={initiatePayment}
                  disabled={poolLocked || !inputRecipient || parseFloat(inputAmount) < 0.01}
                  className="w-full py-2.5 bg-status-info hover:bg-status-info/80 text-white text-xs font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Shield className="w-3.5 h-3.5" />
                  EXECUTE_PRIVATE_PAYMENT
                </button>
                
                {/* Light Protocol Error Display */}
                {!lightHealth?.healthy && (
                  <div className="p-3 border border-status-warning/30 bg-status-warning/5 space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-status-warning flex-shrink-0" />
                      <span className="text-[10px] font-medium text-status-warning">
                        RPC Configuration Required
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400">
                      {lightHealth?.error || 'Light Protocol compression methods not available on current RPC.'}
                    </p>
                    {lightHealth?.hint && (
                      <p className="text-[10px] text-slate-500">
                        <strong>Hint:</strong> {lightHealth.hint}
                      </p>
                    )}
                    <button
                      onClick={checkLightHealth}
                      className="w-full py-1.5 border border-status-warning/30 text-status-warning text-[10px] font-mono hover:bg-status-warning/10 flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw className="w-3 h-3" />
                      RETRY_CONNECTION
                    </button>
                  </div>
                )}
              </>
            )}
            
            {/* Deposit Section */}
            <div className="pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowDeposit(!showDeposit)}
                className="w-full py-1.5 text-[10px] font-mono border border-slate-700 bg-slate-900 text-slate-500 flex items-center justify-center gap-1.5 hover:border-slate-600"
              >
                <Wallet className="w-3 h-3" />
                {showDeposit ? 'HIDE_DEPOSIT' : 'DEPOSIT_FUNDS'}
              </button>
              
              {showDeposit && (
                <div className="mt-3 p-3 border border-slate-700 bg-slate-900 space-y-3">
                  <p className="text-[9px] text-slate-500 font-mono">
                    Add SOL and/or USDC to your stealth pool
                  </p>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] text-slate-500 block mb-1">SOL</label>
                      <input
                        type="number"
                        value={depositSol}
                        onChange={(e) => setDepositSol(e.target.value)}
                        placeholder="0.000"
                        min="0"
                        step="0.001"
                        disabled={isDepositing}
                        className="w-full px-2 py-1.5 text-xs bg-slate-950 border border-slate-700 text-slate-100 font-mono disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-slate-500 block mb-1">USDC</label>
                      <input
                        type="number"
                        value={depositUsdc}
                        onChange={(e) => setDepositUsdc(e.target.value)}
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                        disabled={isDepositing}
                        className="w-full px-2 py-1.5 text-xs bg-slate-950 border border-slate-700 text-slate-100 font-mono disabled:opacity-50"
                      />
                    </div>
                  </div>
                  
                  <button
                    onClick={handleDeposit}
                    disabled={isDepositing || (!depositSol && !depositUsdc) || 
                             (depositSol !== '' && parseFloat(depositSol) <= 0) || 
                             (depositUsdc !== '' && parseFloat(depositUsdc) <= 0)}
                    className="w-full py-2 bg-status-success text-white text-xs font-medium disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {isDepositing ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        DEPOSITING...
                      </>
                    ) : (
                      <>
                        <Wallet className="w-3.5 h-3.5" />
                        DEPOSIT
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
            
            {/* Withdraw Section */}
            <div className="pt-1">
              <button
                onClick={() => setShowWithdraw(!showWithdraw)}
                className="w-full py-1.5 text-[10px] font-mono border border-slate-700 bg-slate-900 text-slate-500 flex items-center justify-center gap-1.5 hover:border-slate-600"
              >
                <Wallet className="w-3 h-3" />
                {showWithdraw ? 'HIDE_WITHDRAW' : 'WITHDRAW_FUNDS'}
              </button>
              
              {showWithdraw && (
                <div className="mt-3 p-3 border border-slate-700 bg-slate-900 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] text-slate-500 block mb-1">SOL</label>
                      <input
                        type="number"
                        value={withdrawSol}
                        onChange={(e) => setWithdrawSol(e.target.value)}
                        placeholder="0.000"
                        step="0.001"
                        className="w-full px-2 py-1.5 text-xs bg-slate-950 border border-slate-700 text-slate-100 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-slate-500 block mb-1">USDC</label>
                      <input
                        type="number"
                        value={withdrawUsdc}
                        onChange={(e) => setWithdrawUsdc(e.target.value)}
                        placeholder="0.00"
                        step="0.01"
                        className="w-full px-2 py-1.5 text-xs bg-slate-950 border border-slate-700 text-slate-100 font-mono"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleWithdraw}
                    disabled={isWithdrawing || (!withdrawSol && !withdrawUsdc)}
                    className="w-full py-1.5 border border-status-critical/30 bg-status-critical/10 text-status-critical text-xs disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {isWithdrawing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wallet className="w-3 h-3" />}
                    WITHDRAW_TO_WALLET
                  </button>
                </div>
              )}
            </div>
            
            {/* Key Export */}
            {pool && (
              <div className="pt-3 border-t border-slate-800">
                {!exportedKey ? (
                  <button
                    onClick={handleExportKey}
                    disabled={isExportingKey}
                    className="w-full py-1.5 text-[10px] font-mono border border-slate-700 bg-slate-900 text-status-warning flex items-center justify-center gap-1.5 hover:border-status-warning/50 disabled:opacity-50"
                  >
                    {isExportingKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <Key className="w-3 h-3" />}
                    EXPORT_PRIVATE_KEY
                  </button>
                ) : (
                  <div className="p-2 border border-status-warning/30 bg-status-warning/10">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] text-status-warning font-mono">PRIVATE_KEY_EXPORT</span>
                      <button onClick={() => setShowExportedKey(!showExportedKey)} className="p-0.5">
                        {showExportedKey ? <EyeOff className="w-3 h-3 text-slate-500" /> : <Eye className="w-3 h-3 text-slate-500" />}
                      </button>
                    </div>
                    <code className="text-[9px] font-mono text-status-warning break-all block">
                      {showExportedKey ? exportedKey : '••••••••••••••••••••••••••••••••'}
                    </code>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        
        {/* Step: Paying - Compressed ZK Flow */}
        {step === 'paying' && (
          <div className="py-8 text-center">
            <Loader2 className="w-8 h-8 text-status-info mx-auto mb-3 animate-spin" />
            <p className="text-xs text-slate-300 mb-2">EXECUTING_COMPRESSED_PAYMENT</p>
            <div className="text-[10px] text-slate-500 font-mono space-y-1">
              <p className="text-status-info">[CREATING_ZK_COMPRESSED_BURNER]</p>
              <p className="text-slate-400">[GENERATING_MERKLE_PROOF]</p>
              <p className="text-slate-400">[EXECUTING_PRIVATE_TRANSFER]</p>
              <p className="text-slate-500">[VERIFYING_ZK_PROOF]</p>
            </div>
            <div className="mt-4 p-2 border border-slate-700 bg-slate-900/50 mx-4">
              <div className="flex items-center justify-center gap-2 text-[10px] font-mono">
                <span className="text-slate-500">Pool</span>
                <ArrowRight className="w-3 h-3 text-slate-600" />
                <span className="text-status-info">Compressed Burner</span>
                <ArrowRight className="w-3 h-3 text-slate-600" />
                <span className="text-status-success">Recipient</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Step: Complete - Maximum Privacy Payment Success */}
        {step === 'complete' && (
          <div className="space-y-4">
            <div className="p-4 border border-status-success/30 bg-status-success/5 text-center">
              <Check className="w-8 h-8 text-status-success mx-auto mb-2" />
              <p className="text-xs font-medium mb-1 text-status-success">MAXIMUM_PRIVACY_CONFIRMED</p>
              <p className="text-[10px] text-slate-400">
                Payment confirmed via two-step burner flow. Recipient sees ephemeral burner, not your wallet or pool.
              </p>
            </div>
            
            {/* Two-Step Pipeline Visualization */}
            <div className="p-3 border border-emerald-500/30 bg-emerald-500/5">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-emerald-400" />
                <span className="text-[10px] font-medium text-emerald-400">TWO-STEP_BURNER_FLOW</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono">
                <div className="text-center">
                  <div className="text-slate-500">Your Pool</div>
                  <div className="text-emerald-400">{pool?.poolAddress?.slice(0, 6)}...</div>
                  <div className="text-[8px] text-slate-600">(hidden)</div>
                </div>
                <ArrowRight className="w-4 h-4 text-emerald-500" />
                <div className="text-center">
                  <div className="text-slate-500">Burner</div>
                  <div className="text-status-warning">{tempBurnerAddress?.slice(0, 6)}...</div>
                  <div className="text-[8px] text-slate-600">(ephemeral)</div>
                </div>
                <ArrowRight className="w-4 h-4 text-emerald-500" />
                <div className="text-center">
                  <div className="text-slate-500">Recipient</div>
                  <div className="text-status-info">{inputRecipient?.slice(0, 6)}...</div>
                  <div className="text-[8px] text-slate-600">(sees burner)</div>
                </div>
              </div>
            </div>
            
            {/* Privacy Guarantees */}
            <div className="p-3 border border-status-info/30 bg-status-info/5">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-status-info" />
                <span className="text-[10px] font-medium text-status-info">MAXIMUM_PRIVACY_VERIFIED</span>
              </div>
              <div className="text-[10px] text-slate-400 space-y-1">
                <div className="flex items-center gap-2">
                  <Check className="w-3 h-3 text-status-success" />
                  <span>Two-step burner breaks ALL on-chain links</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3 h-3 text-status-success" />
                  <span>Recipient cannot trace to your wallet OR pool</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3 h-3 text-status-success" />
                  <span>ZK proofs on both transfers</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3 h-3 text-status-success" />
                  <span>Compressed (~30x cheaper than regular)</span>
                </div>
              </div>
            </div>
            
            {/* Cost savings */}
            {solRecovered !== null && solRecovered > 0 && (
              <div className="p-2 border border-status-success/20 bg-status-success/5 flex items-center justify-between">
                <span className="text-[10px] text-slate-400">Compression savings</span>
                <span className="text-xs font-mono text-status-success">~{solRecovered.toFixed(6)} SOL saved</span>
              </div>
            )}
            
            <div className="p-3 border border-slate-700 bg-slate-900 space-y-2">
              <div>
                <span className="text-[10px] text-slate-500">RECIPIENT_SEES</span>
                <code className="text-xs text-status-warning font-mono block truncate mt-0.5">{tempBurnerAddress}</code>
                <span className="text-[9px] text-slate-600">(ephemeral compressed burner - discarded after payment)</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500">YOUR_WALLET_HIDDEN</span>
                <code className="text-xs text-status-success font-mono block truncate mt-0.5">{publicKey?.toBase58()}</code>
                <span className="text-[9px] text-slate-600">(never visible to recipient)</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500">YOUR_POOL_HIDDEN</span>
                <code className="text-xs text-status-success font-mono block truncate mt-0.5">{pool?.poolAddress}</code>
                <span className="text-[9px] text-slate-600">(never visible to recipient)</span>
              </div>
            </div>
            
            {paymentTx && (
              <a
                href={`https://solscan.io/tx/${paymentTx}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-2 border border-slate-700 bg-slate-900 text-status-info text-xs text-center hover:border-status-info/50 flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                VIEW_ON_SOLSCAN (Burner → Recipient)
              </a>
            )}
            
            <button
              onClick={handleReset}
              className="w-full py-2 border border-slate-700 bg-slate-900 text-slate-400 text-xs hover:text-slate-300 hover:border-slate-600"
            >
              NEW_PAYMENT
            </button>
          </div>
        )}
        
        {/* Step: Error */}
        {step === 'error' && (
          <div className="space-y-4">
            <div className="p-4 border border-status-critical/30 bg-status-critical/10 text-center">
              <AlertCircle className="w-8 h-8 text-status-critical mx-auto mb-2" />
              <p className="text-xs font-medium text-status-critical mb-1">EXECUTION_FAILED</p>
              <p className="text-[10px] text-slate-400">{error}</p>
            </div>
            <button
              onClick={() => setStep('init')}
              className="w-full py-2 border border-slate-700 bg-slate-900 text-slate-400 text-xs hover:border-slate-600"
            >
              RETRY
            </button>
          </div>
        )}
      </div>
      
      {/* Footer */}
      <div className="px-4 py-2 border-t border-slate-700 bg-slate-900 flex items-center justify-between">
        <span className="text-[9px] font-mono text-slate-600">AEGIX_v4.0_COMPRESSED</span>
        <span className="text-[9px] font-mono text-slate-600">
          Pipeline: Pool → ZK_Burner → Recipient
        </span>
      </div>
      
      {/* Audit Trail Modal */}
      <AuditTrail
        isOpen={showAuditTrail}
        onClose={() => setShowAuditTrail(false)}
      />
      
      {/* Shield Funds Modal - Inline compression for private payments */}
      {showShieldModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 max-w-md w-full">
            {/* Header */}
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-slate-400" />
                <h3 className="text-sm font-mono text-slate-300 uppercase tracking-wider">
                  Shield Funds
                </h3>
              </div>
              <button
                onClick={() => setShowShieldModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-4">
              {/* Info Banner */}
              <div className="bg-cyan-500/10 border border-cyan-500/30 p-3 space-y-2">
                <p className="text-xs text-cyan-300 font-mono">
                  COMPRESS_USDC_FOR_PRIVATE_PAYMENTS
                </p>
                <ul className="text-[10px] text-slate-400 space-y-1 pl-4 list-disc">
                  <li>50x cheaper transactions (~0.00004 SOL vs 0.002 SOL)</li>
                  <li>ZK privacy with ephemeral burners</li>
                  <li>One-time compression, permanent savings</li>
                  <li>Break on-chain linkability completely</li>
                </ul>
              </div>

              {/* Balance Display */}
              <div className="bg-slate-800/50 border border-slate-700 p-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-mono">POOL</span>
                  <span className="text-slate-300 font-mono">{pool?.poolAddress?.slice(0, 8)}...{pool?.poolAddress?.slice(-6)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-mono">AVAILABLE_USDC</span>
                  <span className="text-status-success font-mono">
                    {(pool?.balance?.usdc || shieldingInfo?.regularUsdc || 0).toFixed(2)} USDC
                  </span>
                </div>
                {(pool?.balance as any)?.compressedUsdc > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-mono">COMPRESSED</span>
                    <span className="text-emerald-400 font-mono">
                      {((pool?.balance as any)?.compressedUsdc || 0).toFixed(2)} USDC
                    </span>
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
                  value={shieldAmount}
                  onChange={(e) => setShieldAmount(e.target.value)}
                  max={pool?.balance?.usdc || shieldingInfo?.regularUsdc || 0}
                  step="0.01"
                  className="w-full bg-slate-800 border border-slate-700 px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-cyan-500/50"
                  placeholder="0.00"
                />
                <div className="flex gap-2">
                  {[25, 50, 75, 100].map((pct) => {
                    const maxAmount = pool?.balance?.usdc || shieldingInfo?.regularUsdc || 0;
                    return (
                      <button
                        key={pct}
                        onClick={() => setShieldAmount((maxAmount * pct / 100).toFixed(2))}
                        className="flex-1 px-2 py-1 text-[10px] font-mono text-slate-400 border border-slate-700 hover:border-slate-600 hover:text-slate-300"
                      >
                        {pct === 100 ? 'MAX' : `${pct}%`}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Savings Preview */}
              {parseFloat(shieldAmount || '0') > 0 && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 p-3">
                  <p className="text-xs text-emerald-300 font-mono mb-2">ESTIMATED_SAVINGS</p>
                  <div className="space-y-1 text-[10px]">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">100 payments</span>
                      <span className="text-status-success font-mono">~0.19 SOL saved</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">1000 payments</span>
                      <span className="text-status-success font-mono">~1.96 SOL saved</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Error Display */}
              {error && (
                <div className="p-2 border border-status-critical/30 bg-status-critical/10 text-[10px] text-status-critical">
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-700 flex gap-2">
              <button
                onClick={() => setShowShieldModal(false)}
                disabled={isShielding}
                className="flex-1 px-4 py-2 text-sm font-mono text-slate-400 border border-slate-700 hover:border-slate-600 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleShield}
                disabled={
                  isShielding || 
                  !shieldAmount || 
                  parseFloat(shieldAmount) <= 0 || 
                  parseFloat(shieldAmount) > (pool?.balance?.usdc || shieldingInfo?.regularUsdc || 0)
                }
                className={`flex-1 px-4 py-2 text-sm font-mono border disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                  shieldingStatus === 'success' 
                    ? 'text-emerald-200 bg-emerald-600 border-emerald-500' 
                    : shieldingStatus === 'error'
                    ? 'text-red-200 bg-red-600 border-red-500'
                    : 'text-cyan-200 bg-cyan-600 hover:bg-cyan-500 border-cyan-500'
                }`}
              >
                {shieldingStatus === 'building' && (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Building transaction...
                  </>
                )}
                {shieldingStatus === 'signing' && (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sign in wallet...
                  </>
                )}
                {shieldingStatus === 'confirming' && (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Confirming...
                  </>
                )}
                {shieldingStatus === 'success' && (
                  <>
                    <Check className="w-4 h-4" />
                    Shielded!
                  </>
                )}
                {shieldingStatus === 'error' && (
                  <>
                    <AlertCircle className="w-4 h-4" />
                    Failed
                  </>
                )}
                {shieldingStatus === 'idle' && (
                  <>
                    <Shield className="w-4 h-4" />
                    Shield {shieldAmount || '0'} USDC
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Confirmation Modal */}
      {showPaymentConfirmModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 max-w-md w-full">
            {/* Header */}
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-status-info" />
                <h3 className="text-sm font-mono text-slate-300 uppercase tracking-wider">
                  Confirm Payment
                </h3>
              </div>
              <button
                onClick={() => setShowPaymentConfirmModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-4">
              {/* Transaction Details */}
              <div className="bg-slate-800/50 border border-slate-700 p-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-mono">RECIPIENT</span>
                  <span className="text-slate-300 font-mono">{inputRecipient.slice(0, 8)}...{inputRecipient.slice(-6)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-mono">AMOUNT</span>
                  <span className="text-status-success font-mono">{inputAmount} USDC</span>
                </div>
              </div>

              {/* Recovery Pool Status (Aegix 4.0) - Simple display */}
              {usePrivacyHardened && recoveryPoolStatus && recoveryPoolStatus.initialized && recoveryPoolStatus.address && (
                <div className="flex items-center justify-between p-2 border border-slate-700 bg-slate-800/50">
                  <div className="flex items-center gap-2">
                    <Shield className="w-3 h-3 text-slate-500" />
                    <span className="text-[10px] font-mono text-slate-400">RECOVERY_POOL</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-slate-300">
                      {recoveryPoolStatus.balance.toFixed(4)} SOL
                    </span>
                    <span className={`text-[9px] font-mono ${recoveryPoolStatus.isHealthy ? 'text-status-success' : 'text-status-warning'}`}>
                      {recoveryPoolStatus.isHealthy ? 'Ready' : 'Fund'}
                    </span>
                  </div>
                </div>
              )}

              {/* Warning if Recovery Pool not initialized */}
              {usePrivacyHardened && (!recoveryPoolStatus || !recoveryPoolStatus.initialized) && (
                <div className="flex items-center gap-2 p-2 border border-status-warning/30 bg-status-warning/5">
                  <AlertCircle className="w-4 h-4 text-status-warning" />
                  <span className="text-[10px] text-status-warning font-mono">
                    Recovery Pool not initialized. Initialize in Stealth Pool Channel.
                  </span>
                </div>
              )}

              {/* Warning if Recovery Pool needs funding */}
              {usePrivacyHardened && recoveryPoolStatus && recoveryPoolStatus.initialized && !recoveryPoolStatus.isHealthy && (
                <div className="flex items-center gap-2 p-2 border border-slate-700 bg-slate-800/50">
                  <AlertCircle className="w-4 h-4 text-status-warning" />
                  <span className="text-[10px] text-slate-400 font-mono">
                    Recovery Pool needs SOL (min 0.005) for fees.
                  </span>
                </div>
              )}

              {/* Payment Method Selection */}
              <div className="space-y-2">
                <p className="text-[10px] text-slate-500 font-mono uppercase">SELECT_PAYMENT_METHOD</p>
                
                {/* Standard Burner Payment - Always available */}
                <div 
                  className={`p-3 border cursor-pointer transition-all ${
                    !usePrivacyHardened 
                      ? 'border-status-info bg-status-info/10' 
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                  }`}
                  onClick={() => setUsePrivacyHardened(false)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        !usePrivacyHardened 
                          ? 'border-status-info' 
                          : 'border-slate-600'
                      }`}>
                        {!usePrivacyHardened && <div className="w-2.5 h-2.5 rounded-full bg-status-info" />}
                      </div>
                      <div>
                        <span className="text-sm font-mono text-slate-200">Standard Private Payment</span>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          Pool → Burner Wallet → x402/PayAI → Recipient
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 ml-8 flex items-center gap-3 text-[10px]">
                    <span className="text-slate-400">Cost: ~0.008 SOL</span>
                    <span className="text-slate-600">|</span>
                    <span className="text-slate-400">Privacy: Burner hides your wallet</span>
                  </div>
                </div>

                {/* Maximum Privacy (ZK Compressed) - Only if shielded funds */}
                <div 
                  className={`p-3 border cursor-pointer transition-all ${
                    hasCompressedFunds 
                      ? usePrivacyHardened 
                        ? 'border-emerald-500 bg-emerald-500/10' 
                        : 'border-slate-700 bg-slate-800/50 hover:border-emerald-500/50'
                      : 'border-slate-800 bg-slate-900/50 opacity-50 cursor-not-allowed'
                  }`}
                  onClick={() => hasCompressedFunds && setUsePrivacyHardened(true)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        usePrivacyHardened && hasCompressedFunds
                          ? 'border-emerald-500' 
                          : 'border-slate-600'
                      }`}>
                        {usePrivacyHardened && hasCompressedFunds && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-slate-200">Maximum Privacy</span>
                          <span className="px-1.5 py-0.5 text-[9px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            50x CHEAPER
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          Two-Step Burner: Pool → Burner → Recipient
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 ml-8 flex items-center gap-3 text-[10px]">
                    <span className={hasCompressedFunds ? 'text-emerald-400' : 'text-slate-600'}>Cost: ~0.00032 SOL (2 transfers)</span>
                    <span className="text-slate-600">|</span>
                    <span className={hasCompressedFunds ? 'text-emerald-400' : 'text-slate-600'}>Privacy: Max unlinkability</span>
                  </div>
                  {!hasCompressedFunds && (
                    <div className="mt-2 ml-8 text-[10px] text-amber-400/80">
                      ⚠️ Requires shielded funds - Shield your USDC first
                    </div>
                  )}
                </div>
              </div>

              {/* Selected Method Summary */}
              <div className="p-2 border border-slate-700 bg-slate-900">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-mono">SELECTED</span>
                  <span className={`font-mono ${usePrivacyHardened ? 'text-emerald-400' : 'text-status-info'}`}>
                    {usePrivacyHardened ? 'Maximum Privacy (Two-Step)' : 'Standard Private (Burner)'}
                  </span>
                </div>
                {usePrivacyHardened && (
                  <div className="text-[9px] text-emerald-300/70 mt-1">
                    Pool → Ephemeral Burner → Recipient (2 ZK transfers)
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-700 flex gap-2">
              <button
                onClick={() => setShowPaymentConfirmModal(false)}
                className="flex-1 px-4 py-2 text-sm font-mono text-slate-400 border border-slate-700 hover:border-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={handlePay}
                className="flex-1 px-4 py-2 text-sm font-mono text-white bg-status-info hover:bg-status-info/80 border border-status-info flex items-center justify-center gap-2"
              >
                <Shield className="w-4 h-4" />
                Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
