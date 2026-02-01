'use client';

/**
 * Shadow Link Payment Page
 * 
 * Clean, minimal payment UI for payers.
 * Shows only what the payer needs - stealth address and amount.
 * No owner information is ever displayed.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  LAMPORTS_PER_SOL 
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { 
  Shield, 
  AlertCircle, 
  Check, 
  Loader2, 
  Copy, 
  ExternalLink,
  Clock,
  Lock,
  Zap
} from 'lucide-react';
import { WalletProvider } from '@/components/WalletProvider';
import { ClientWalletButton } from '@/components/ClientWalletButton';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

interface LinkData {
  stealthAddress: string;
  amount: string;
  expiresIn: number;
  status: string;
  alias: string;
}

type PageStatus = 'loading' | 'ready' | 'paying' | 'paid' | 'expired' | 'used' | 'error';

function PaymentPageContent() {
  const params = useParams();
  const id = params?.id as string;
  
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  
  const [link, setLink] = useState<LinkData | null>(null);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  
  // Fetch link data
  const fetchLink = useCallback(async () => {
    if (!id) return;
    
    try {
      const res = await fetch(`${GATEWAY_URL}/api/shadow-link/${id}`);
      const data = await res.json();
      
      if (!data.success) {
        if (data.status === 'used') {
          setStatus('used');
        } else if (data.status === 'expired' || data.error?.includes('expired')) {
          setStatus('expired');
        } else {
          setError(data.error || 'Link not found');
          setStatus('error');
        }
        return;
      }
      
      setLink(data.data);
      setTimeLeft(data.data.expiresIn);
      setStatus('ready');
    } catch (err: any) {
      setError(err.message || 'Failed to load payment link');
      setStatus('error');
    }
  }, [id]);
  
  useEffect(() => {
    fetchLink();
  }, [fetchLink]);
  
  // Countdown timer
  useEffect(() => {
    if (status !== 'ready' || timeLeft <= 0) return;
    
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          setStatus('expired');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [status, timeLeft]);
  
  // Handle payment
  const handlePay = async () => {
    if (!publicKey || !signTransaction || !link) return;
    
    setStatus('paying');
    setError(null);
    
    try {
      const stealthPubkey = new PublicKey(link.stealthAddress);
      const amountMicroUsdc = BigInt(Math.floor(parseFloat(link.amount) * 1_000_000));
      
      // Get user's USDC account
      const userUsdcAccount = await getAssociatedTokenAddress(
        USDC_MINT, publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      );
      
      // Get stealth USDC account
      const stealthUsdcAccount = await getAssociatedTokenAddress(
        USDC_MINT, stealthPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      );
      
      const transaction = new Transaction();
      
      // Check if stealth USDC account exists
      let stealthAccountExists = false;
      try {
        await getAccount(connection, stealthUsdcAccount, 'confirmed', TOKEN_PROGRAM_ID);
        stealthAccountExists = true;
      } catch {
        // Need to create
      }
      
      // Send small SOL for account creation + gas
      const solRequired = stealthAccountExists ? 0.002 : 0.01; // SOL for rent + gas
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: stealthPubkey,
          lamports: Math.floor(solRequired * LAMPORTS_PER_SOL),
        })
      );
      
      // Create stealth USDC account if needed
      if (!stealthAccountExists) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            publicKey, stealthUsdcAccount, stealthPubkey, USDC_MINT,
            TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }
      
      // Transfer USDC
      transaction.add(
        createTransferInstruction(
          userUsdcAccount, stealthUsdcAccount, publicKey, amountMicroUsdc,
          [], TOKEN_PROGRAM_ID
        )
      );
      
      // Get blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.lastValidBlockHeight = lastValidBlockHeight;
      transaction.feePayer = publicKey;
      
      // Sign
      const signedTx = await signTransaction(transaction);
      
      // Send
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      
      // Wait for confirmation
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      }, 'confirmed');
      
      // Notify gateway
      await fetch(`${GATEWAY_URL}/api/shadow-link/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txSignature: signature,
          payerAddress: publicKey.toBase58(),
        }),
      });
      
      setTxSignature(signature);
      setStatus('paid');
      
    } catch (err: any) {
      console.error('Payment error:', err);
      setError(err.message || 'Payment failed');
      setStatus('ready');
    }
  };
  
  // Copy address
  const handleCopy = () => {
    if (link?.stealthAddress) {
      navigator.clipboard.writeText(link.stealthAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  // Format time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Loading state
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-violet-400 animate-spin mx-auto mb-4" />
          <p className="text-zinc-400">Loading payment...</p>
        </div>
      </div>
    );
  }
  
  // Used state
  if (status === 'used') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-zinc-900/80 backdrop-blur rounded-2xl p-8 text-center border border-violet-500/30 shadow-2xl shadow-violet-500/10">
          <div className="w-20 h-20 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Lock className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Link Used</h1>
          <p className="text-violet-400 font-medium mb-4">Privacy Protected ✓</p>
          <p className="text-sm text-zinc-400">
            This payment link has been used and destroyed to protect privacy.
            The recipient's identity remains shielded.
          </p>
        </div>
      </div>
    );
  }
  
  // Expired state
  if (status === 'expired') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-zinc-900/80 backdrop-blur rounded-2xl p-8 text-center border border-red-500/30 shadow-2xl">
          <div className="w-20 h-20 bg-red-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Clock className="w-10 h-10 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Link Expired</h1>
          <p className="text-sm text-zinc-400">
            This payment link has expired. Please request a new one from the recipient.
          </p>
        </div>
      </div>
    );
  }
  
  // Error state
  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-zinc-900/80 backdrop-blur rounded-2xl p-8 text-center border border-red-500/30 shadow-2xl">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Error</h1>
          <p className="text-sm text-zinc-400">{error || 'Something went wrong'}</p>
        </div>
      </div>
    );
  }
  
  // Paid state
  if (status === 'paid') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-zinc-900/80 backdrop-blur rounded-2xl p-8 text-center border border-emerald-500/30 shadow-2xl shadow-emerald-500/10">
          <div className="w-20 h-20 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Check className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Payment Sent! 🎉</h1>
          <p className="text-emerald-400 font-medium mb-4">{link?.amount} USDC</p>
          <p className="text-sm text-zinc-400 mb-6">
            Your payment has been sent to a shielded address.
            The recipient's identity remains private.
          </p>
          
          {txSignature && (
            <a
              href={`https://solscan.io/tx/${txSignature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-800 rounded-lg text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              View on Solscan
            </a>
          )}
          
          <div className="mt-6 pt-6 border-t border-zinc-800">
            <div className="flex items-center justify-center gap-2 text-xs text-violet-400">
              <Shield className="w-3 h-3" />
              <span>Powered by Aegix Privacy Gateway</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // Ready state - main payment UI
  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-zinc-900/80 backdrop-blur-xl rounded-2xl overflow-hidden border border-violet-500/20 shadow-2xl shadow-violet-500/10">
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600/20 to-fuchsia-600/20 px-6 py-6 border-b border-zinc-800">
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-500/30">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">Shielded Payment</h1>
            <p className="text-zinc-400 text-sm mt-1">via Aegix Privacy Gateway</p>
            {link?.alias && (
              <p className="text-violet-400 text-xs mt-2 font-mono">{link.alias}</p>
            )}
          </div>
        </div>
        
        <div className="p-6 space-y-6">
          {/* Amount */}
          <div className="bg-zinc-800/50 rounded-xl p-6 text-center border border-zinc-700">
            <p className="text-zinc-400 text-sm mb-2">Amount Requested</p>
            <p className="text-4xl font-bold text-white">
              {link?.amount} <span className="text-lg text-zinc-400">USDC</span>
            </p>
          </div>
          
          {/* Timer */}
          <div className="flex items-center justify-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-amber-400" />
            <span className={`font-mono ${timeLeft < 300 ? 'text-amber-400' : 'text-zinc-400'}`}>
              Expires in {formatTime(timeLeft)}
            </span>
          </div>
          
          {/* Pay Button or Connect Wallet */}
          {connected ? (
            <button
              onClick={handlePay}
              disabled={status === 'paying'}
              className="w-full py-4 px-6 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-bold rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-violet-500/30"
            >
              {status === 'paying' ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  Pay {link?.amount} USDC
                </>
              )}
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-center text-sm text-zinc-400">Connect your wallet to pay</p>
              <div className="flex justify-center">
                <ClientWalletButton />
              </div>
            </div>
          )}
          
          {/* Manual address option */}
          <div className="border-t border-zinc-800 pt-4">
            <p className="text-xs text-zinc-500 mb-2 text-center">Or send manually to:</p>
            <div className="bg-zinc-800/50 rounded-lg p-3 flex items-center gap-2 border border-zinc-700">
              <code className="text-xs font-mono text-violet-400 flex-1 truncate">
                {link?.stealthAddress}
              </code>
              <button
                onClick={handleCopy}
                className="p-2 rounded-lg hover:bg-zinc-700 transition-colors flex-shrink-0"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4 text-zinc-400" />
                )}
              </button>
            </div>
          </div>
          
          {/* Error display */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-sm text-red-300">{error}</span>
            </div>
          )}
          
          {/* Privacy badge */}
          <div className="flex items-center justify-center gap-2 text-xs text-emerald-400 pt-2">
            <Lock className="w-3 h-3" />
            <span>Recipient identity is shielded</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Wrap with WalletProvider
export default function PaymentPage() {
  return (
    <WalletProvider>
      <PaymentPageContent />
    </WalletProvider>
  );
}



