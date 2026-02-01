'use client';

/**
 * Shadow Links Component - Ghost Invoice / Temporary Payment Requests
 * 
 * Create payment invoices with ephemeral stealth addresses.
 * Payer pays → Funds sweep to your pool → Stealth address self-destructs.
 * Your wallet address is NEVER exposed to the payer!
 * 
 * Institutional Design System
 */

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Ghost,
  Plus,
  Copy,
  Check,
  Loader2,
  ExternalLink,
  Trash2,
  RefreshCw,
  Clock,
  Download,
  Zap,
  AlertCircle,
  X,
  QrCode,
  Link2,
  ArrowRight,
  Shield
} from 'lucide-react';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';

interface ShadowLink {
  id: string;
  alias: string;
  stealthAddress: string;
  amount: string;
  status: 'waiting' | 'paid' | 'swept' | 'expired' | 'cancelled';
  createdAt: number;
  expiresAt: number;
  paidAt?: number;
  sweptAt?: number;
  paymentTx?: string;
  sweepTx?: string;
  paidFrom?: string;
}

interface ShadowLinksProps {
  poolAddress?: string;
  onRefreshPool?: () => void;
}

export default function ShadowLinks({ poolAddress, onRefreshPool }: ShadowLinksProps) {
  const { publicKey, signMessage } = useWallet();
  
  // State
  const [links, setLinks] = useState<ShadowLink[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState<ShadowLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Create form
  const [createAmount, setCreateAmount] = useState('1.00');
  const [createTTL, setCreateTTL] = useState('60');
  const [createMemo, setCreateMemo] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newLink, setNewLink] = useState<ShadowLink | null>(null);
  
  // Sweep state
  const [isSweeping, setIsSweeping] = useState<string | null>(null);
  
  // Copy states
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  // Fetch links
  const fetchLinks = useCallback(async () => {
    if (!publicKey) return;
    
    setIsLoading(true);
    try {
      const response = await fetch(`${GATEWAY_URL}/api/shadow-link/owner/${publicKey.toBase58()}`);
      const result = await response.json();
      
      if (result.success) {
        setLinks(result.data.links);
      }
    } catch (err) {
      console.error('Failed to fetch links:', err);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey]);
  
  useEffect(() => {
    fetchLinks();
    // Poll for updates every 30 seconds
    const interval = setInterval(fetchLinks, 30000);
    return () => clearInterval(interval);
  }, [fetchLinks]);
  
  // Create new shadow link
  const handleCreate = async () => {
    if (!publicKey || !signMessage || !poolAddress) {
      setError('Connect wallet and initialize pool first');
      return;
    }
    
    setIsCreating(true);
    setError(null);
    
    try {
      // Sign message for key encryption
      const message = `Create Aegix Shadow Link\nOwner: ${publicKey.toBase58()}\nTimestamp: ${Date.now()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(messageBytes);
      const signature = Buffer.from(signatureBytes).toString('base64');
      
      const response = await fetch(`${GATEWAY_URL}/api/shadow-link/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          poolAddress,
          amount: createAmount,
          ttlMinutes: parseInt(createTTL),
          memo: createMemo || undefined,
          signature,
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to create link');
      }
      
      // Show the new link
      setNewLink({
        id: result.data.linkId,
        alias: result.data.alias,
        stealthAddress: result.data.stealthAddress,
        amount: result.data.amount,
        status: 'waiting',
        createdAt: Date.now(),
        expiresAt: result.data.expiresAt,
      });
      
      // Refresh list
      fetchLinks();
      
    } catch (err: any) {
      setError(err.message || 'Failed to create link');
    } finally {
      setIsCreating(false);
    }
  };
  
  // Sweep funds to pool
  const handleSweep = async (link: ShadowLink) => {
    if (!publicKey || !signMessage) return;
    
    setIsSweeping(link.id);
    setError(null);
    
    try {
      const message = `Sweep Shadow Link\nLink: ${link.id}\nTimestamp: ${Date.now()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(messageBytes);
      const signature = Buffer.from(signatureBytes).toString('base64');
      
      const response = await fetch(`${GATEWAY_URL}/api/shadow-link/${link.id}/sweep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          signature,
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Sweep failed');
      }
      
      // Refresh
      fetchLinks();
      onRefreshPool?.();
      
    } catch (err: any) {
      setError(err.message || 'Sweep failed');
    } finally {
      setIsSweeping(null);
    }
  };
  
  // Cancel link
  const handleCancel = async (linkId: string) => {
    if (!publicKey) return;
    
    try {
      const response = await fetch(`${GATEWAY_URL}/api/shadow-link/${linkId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: publicKey.toBase58() }),
      });
      
      const result = await response.json();
      if (result.success) {
        fetchLinks();
      }
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  };
  
  // Copy to clipboard
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };
  
  // Download QR code
  const downloadQR = (link: ShadowLink) => {
    const svg = document.getElementById(`qr-${link.id}`);
    if (!svg) return;
    
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      const a = document.createElement('a');
      a.download = `aegix-${link.alias}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    
    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
  };
  
  // Format time
  const formatTimeLeft = (expiresAt: number) => {
    const diff = expiresAt - Date.now();
    if (diff <= 0) return 'Expired';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  };
  
  // Get status styling
  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'waiting': return 'text-status-warning bg-status-warning/10 border-status-warning/30';
      case 'paid': return 'text-status-info bg-status-info/10 border-status-info/30';
      case 'swept': return 'text-status-success bg-status-success/10 border-status-success/30';
      case 'expired': return 'text-slate-400 bg-slate-400/10 border-slate-400/30';
      case 'cancelled': return 'text-status-critical bg-status-critical/10 border-status-critical/30';
      default: return 'text-slate-400 bg-slate-400/10 border-slate-400/30';
    }
  };
  
  // Get status icon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'waiting': return <Clock className="w-3 h-3" />;
      case 'paid': return <Zap className="w-3 h-3" />;
      case 'swept': return <Check className="w-3 h-3" />;
      case 'expired': return <Clock className="w-3 h-3" />;
      case 'cancelled': return <X className="w-3 h-3" />;
      default: return null;
    }
  };
  
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  
  const activeLinks = links.filter(l => l.status === 'waiting' || l.status === 'paid');
  const historyLinks = links.filter(l => l.status !== 'waiting' && l.status !== 'paid');
  
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ghost className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-medium text-slate-200">Shadow_Links</h3>
          <span className="px-1.5 py-0.5 text-[10px] font-mono text-slate-500 bg-slate-800 border border-slate-700">
            GHOST_INVOICE
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchLinks}
            disabled={isLoading}
            className="p-1.5 hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={!poolAddress}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-status-info text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            NEW_INVOICE
          </button>
        </div>
      </div>
      
      {/* Pool Required Warning */}
      {!poolAddress && (
        <div className="p-3 bg-status-warning/10 border border-status-warning/30 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-status-warning" />
          <p className="text-xs text-status-warning font-mono">POOL_REQUIRED: Initialize pool wallet first</p>
        </div>
      )}
      
      {/* Error display */}
      {error && (
        <div className="p-3 bg-status-critical/10 border border-status-critical/30 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-status-critical" />
          <span className="text-xs text-status-critical font-mono flex-1">{error}</span>
          <button onClick={() => setError(null)}>
            <X className="w-4 h-4 text-status-critical" />
          </button>
        </div>
      )}
      
      {/* Active Links Table */}
      {activeLinks.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[10px] font-mono text-slate-600 uppercase tracking-wide">ACTIVE_INVOICES</h4>
          <table className="data-table w-full">
            <thead>
              <tr>
                <th className="text-left">Invoice_ID</th>
                <th className="text-left">Amount</th>
                <th className="text-left">Status</th>
                <th className="text-left">TTL</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeLinks.map(link => (
                <tr key={link.id}>
                  <td className="font-mono text-slate-400 text-xs">{link.alias}</td>
                  <td className="font-mono text-slate-200 text-xs">{link.amount} USDC</td>
                  <td>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono border ${getStatusStyle(link.status)}`}>
                      {getStatusIcon(link.status)}
                      {link.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="text-xs text-slate-500 font-mono">
                    {link.status === 'waiting' ? formatTimeLeft(link.expiresAt) : '-'}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {link.status === 'waiting' && (
                        <>
                          <button
                            onClick={() => setShowQRModal(link)}
                            className="p-1.5 hover:bg-slate-800 transition-colors"
                            title="Show QR"
                          >
                            <QrCode className="w-3.5 h-3.5 text-slate-500" />
                          </button>
                          <button
                            onClick={() => handleCopy(`${baseUrl}/pay/${link.id}`, `link-${link.id}`)}
                            className="p-1.5 hover:bg-slate-800 transition-colors"
                            title="Copy link"
                          >
                            {copiedId === `link-${link.id}` ? (
                              <Check className="w-3.5 h-3.5 text-status-success" />
                            ) : (
                              <Link2 className="w-3.5 h-3.5 text-slate-500" />
                            )}
                          </button>
                          <button
                            onClick={() => handleCancel(link.id)}
                            className="p-1.5 hover:bg-status-critical/10 transition-colors"
                            title="Cancel"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-status-critical" />
                          </button>
                        </>
                      )}
                      
                      {link.status === 'paid' && (
                        <button
                          onClick={() => handleSweep(link)}
                          disabled={isSweeping === link.id}
                          className="flex items-center gap-1 px-2 py-1 bg-status-success/20 text-status-success text-xs font-mono disabled:opacity-50"
                        >
                          {isSweeping === link.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <ArrowRight className="w-3 h-3" />
                          )}
                          SWEEP
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {/* Empty state */}
      {poolAddress && links.length === 0 && !isLoading && (
        <div className="p-8 border border-slate-800 text-center">
          <Ghost className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-xs text-slate-500 font-mono mb-1">NO_INVOICES_CREATED</p>
          <p className="text-[10px] text-slate-600 mb-4">Create a ghost invoice to receive private payments</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-status-info text-white text-xs font-medium"
          >
            CREATE_FIRST_INVOICE
          </button>
        </div>
      )}
      
      {/* History */}
      {historyLinks.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[10px] font-mono text-slate-600 uppercase tracking-wide">HISTORY</h4>
          <div className="space-y-1">
            {historyLinks.slice(0, 5).map(link => (
              <div 
                key={link.id}
                className="p-2 bg-slate-900 border border-slate-800 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-slate-500">{link.alias}</span>
                  <span className="text-xs text-slate-400 font-mono">{link.amount} USDC</span>
                  <span className={`px-1 py-0.5 text-[9px] font-mono border ${getStatusStyle(link.status)}`}>
                    {link.status.toUpperCase()}
                  </span>
                </div>
                {(link.sweepTx || link.paymentTx) && (
                  <a
                    href={`https://solscan.io/tx/${link.sweepTx || link.paymentTx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-status-info hover:text-status-info/80"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Create Modal */}
      {showCreateModal && (
        <div 
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => !newLink && setShowCreateModal(false)}
        >
          <div 
            className="bg-slate-900 border border-slate-700 p-6 max-w-md w-full"
            onClick={e => e.stopPropagation()}
          >
            {!newLink ? (
              <>
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-slate-800 border border-slate-700">
                    <Ghost className="w-5 h-5 text-slate-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-slate-200">CREATE_SHADOW_LINK</h3>
                    <p className="text-[10px] text-slate-500 font-mono">Generate ghost invoice for private payment</p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-500 mb-1.5">
                      AMOUNT_USDC
                    </label>
                    <input
                      type="number"
                      value={createAmount}
                      onChange={(e) => setCreateAmount(e.target.value)}
                      min="0.01"
                      step="0.01"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 text-sm font-mono text-slate-200 focus:border-status-info focus:outline-none"
                      placeholder="1.00"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-[10px] font-mono text-slate-500 mb-1.5">
                      EXPIRES_IN
                    </label>
                    <select
                      value={createTTL}
                      onChange={(e) => setCreateTTL(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 text-sm font-mono text-slate-200 focus:border-status-info focus:outline-none"
                    >
                      <option value="15">15 minutes</option>
                      <option value="30">30 minutes</option>
                      <option value="60">1 hour</option>
                      <option value="180">3 hours</option>
                      <option value="720">12 hours</option>
                      <option value="1440">24 hours</option>
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-[10px] font-mono text-slate-500 mb-1.5">
                      MEMO_OPTIONAL
                    </label>
                    <input
                      type="text"
                      value={createMemo}
                      onChange={(e) => setCreateMemo(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 text-sm font-mono text-slate-200 focus:border-status-info focus:outline-none"
                      placeholder="Payment for..."
                    />
                  </div>
                </div>
                
                <div className="mt-6 flex gap-2">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 py-2.5 px-4 border border-slate-700 text-slate-400 text-xs font-medium hover:bg-slate-800 transition-colors"
                  >
                    CANCEL
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={isCreating || parseFloat(createAmount) < 0.01}
                    className="flex-1 py-2.5 px-4 bg-status-info text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isCreating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        CREATING...
                      </>
                    ) : (
                      <>
                        <Ghost className="w-3.5 h-3.5" />
                        CREATE_INVOICE
                      </>
                    )}
                  </button>
                </div>
              </>
            ) : (
              // Show created link
              <>
                <div className="text-center mb-6">
                  <div className="w-12 h-12 bg-status-success/20 flex items-center justify-center mx-auto mb-4">
                    <Check className="w-6 h-6 text-status-success" />
                  </div>
                  <h3 className="text-sm font-medium text-slate-200">INVOICE_CREATED</h3>
                  <p className="text-xs text-slate-500 font-mono mt-1">{newLink.alias}</p>
                </div>
                
                {/* QR Code */}
                <div className="bg-white p-4 mb-4 mx-auto w-fit">
                  <QRCodeSVG
                    id={`qr-new-${newLink.id}`}
                    value={`${baseUrl}/pay/${newLink.id}`}
                    size={180}
                    level="M"
                    includeMargin={false}
                  />
                </div>
                
                {/* Link */}
                <div className="bg-slate-800 p-3 mb-4">
                  <p className="text-[10px] text-slate-500 font-mono mb-1">PAYMENT_LINK</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-status-info font-mono flex-1 truncate">
                      {baseUrl}/pay/{newLink.id}
                    </code>
                    <button
                      onClick={() => handleCopy(`${baseUrl}/pay/${newLink.id}`, `new-link`)}
                      className="p-1.5 hover:bg-slate-700"
                    >
                      {copiedId === 'new-link' ? (
                        <Check className="w-3.5 h-3.5 text-status-success" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </button>
                  </div>
                </div>
                
                {/* Info */}
                <div className="p-3 bg-status-info/10 border border-status-info/30 mb-4">
                  <div className="flex items-center gap-2 text-xs text-status-info font-mono">
                    <Shield className="w-4 h-4" />
                    <span>WALLET_ADDRESS_HIDDEN_FROM_PAYER</span>
                  </div>
                </div>
                
                <button
                  onClick={() => {
                    setNewLink(null);
                    setShowCreateModal(false);
                    setCreateAmount('1.00');
                    setCreateMemo('');
                  }}
                  className="w-full py-2.5 px-4 bg-status-info text-white text-xs font-medium"
                >
                  DONE
                </button>
              </>
            )}
          </div>
        </div>
      )}
      
      {/* QR Modal */}
      {showQRModal && (
        <div 
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setShowQRModal(null)}
        >
          <div 
            className="bg-slate-900 border border-slate-700 p-6 max-w-sm w-full"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-center mb-4">
              <h3 className="text-sm font-medium text-slate-200 font-mono">{showQRModal.alias}</h3>
              <p className="text-xl font-bold text-slate-100 mt-1 font-mono">{showQRModal.amount} USDC</p>
            </div>
            
            {/* QR Code */}
            <div className="bg-white p-4 mb-4 mx-auto w-fit">
              <QRCodeSVG
                id={`qr-${showQRModal.id}`}
                value={`${baseUrl}/pay/${showQRModal.id}`}
                size={200}
                level="M"
                includeMargin={false}
              />
            </div>
            
            <p className="text-[10px] text-slate-500 text-center mb-4 font-mono">
              SCAN_TO_PAY • TTL: {formatTimeLeft(showQRModal.expiresAt)}
            </p>
            
            <div className="flex gap-2">
              <button
                onClick={() => handleCopy(`${baseUrl}/pay/${showQRModal.id}`, `modal-${showQRModal.id}`)}
                className="flex-1 py-2 px-3 bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
              >
                {copiedId === `modal-${showQRModal.id}` ? (
                  <Check className="w-3.5 h-3.5 text-status-success" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                COPY_LINK
              </button>
              <button
                onClick={() => downloadQR(showQRModal)}
                className="flex-1 py-2 px-3 bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
              >
                <Download className="w-3.5 h-3.5" />
                SAVE_QR
              </button>
            </div>
            
            <button
              onClick={() => setShowQRModal(null)}
              className="w-full mt-3 py-2 text-xs text-slate-500 hover:text-slate-400"
            >
              CLOSE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
