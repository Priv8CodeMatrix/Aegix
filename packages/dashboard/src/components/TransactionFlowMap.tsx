'use client';

import { useEffect, useState, useCallback } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Copy, Check, ExternalLink, Wallet, DollarSign, User } from 'lucide-react';

interface TransactionGraph {
  nodes: Array<{
    id: string;
    type: 'signer' | 'account' | 'asset' | 'program';
    label: string;
    address: string;
    truncated?: string;
    data?: {
      amount?: string;
      token?: string;
    };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: 'transfer' | 'sign' | 'instruction';
    label?: string;
    data?: {
      amount?: string;
      token?: string;
    };
  }>;
  metadata: {
    signature: string;
    timestamp?: number;
    fee?: number;
    status: 'success' | 'pending' | 'failed';
  };
}

interface TransactionFlowMapProps {
  signature: string;
  onClose?: () => void;
  // Add optional custody pipeline data
  stealthPool?: string;
  burner?: string;
  recipient?: string;
  amount?: string; // in micro-USDC
  solRecovered?: number; // SOL amount recovered
}

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';

// Custom Node Components
const SignerNode = ({ node, onCopy, copiedId }: { node: any; onCopy: (text: string) => void; copiedId: string | null }) => {
  const nodeId = `copy-${node.address}`;
  return (
    <div className="flex flex-col items-center gap-2">
      {/* Signer Icon with Green Circle */}
      <div className="w-8 h-8 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center">
        <Wallet className="w-4 h-4 text-emerald-400" />
      </div>
      <span className="text-[10px] font-mono text-emerald-400 font-medium">{node.label}</span>
      
      {/* Address Box */}
      <div className="bg-slate-800 border border-slate-700 rounded-sm px-3 py-2 min-w-[200px] flex items-center gap-2 group">
        <Wallet className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        <code className="text-[10px] font-mono text-slate-300 flex-1 truncate">
          {node.truncated || node.address}
        </code>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy(node.address);
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-slate-700 rounded"
        >
          {copiedId === nodeId ? (
            <Check className="w-3 h-3 text-emerald-400" />
          ) : (
            <Copy className="w-3 h-3 text-slate-500" />
          )}
        </button>
      </div>
    </div>
  );
};

const AssetNode = ({ node }: { node: any }) => {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="bg-slate-100 border-2 border-slate-300 rounded-sm px-4 py-3 min-w-[180px] flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
          <DollarSign className="w-4 h-4 text-white" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-mono font-semibold text-slate-900">
            {node.data?.amount || '0'} {node.data?.token || 'USDC'}
          </span>
          <span className="text-[9px] font-mono text-slate-600">[{node.id.match(/\d+/)?.[0] || '1'}]</span>
        </div>
      </div>
    </div>
  );
};

const AccountNode = ({ node, onCopy, copiedId, isRecipient = false, isEphemeral = false }: { 
  node: any; 
  onCopy: (text: string) => void; 
  copiedId: string | null;
  isRecipient?: boolean;
  isEphemeral?: boolean;
}) => {
  const nodeId = `copy-${node.address}`;
  return (
    <div className="flex flex-col items-center gap-2 relative">
      {!isRecipient && (
        <span className="text-[10px] font-mono text-slate-400 font-medium">{node.label}</span>
      )}
      
      {/* Address Box with Pill Icon */}
      <div className={`border rounded-sm px-3 py-2 min-w-[200px] flex items-center gap-2 group relative ${
        isRecipient 
          ? 'bg-slate-800 border-emerald-500/30' 
          : isEphemeral
          ? 'bg-slate-800 border-orange-500/30'
          : 'bg-slate-800 border-slate-700'
      }`}>
        {isEphemeral && (
          <span className="absolute -top-2 -right-2 text-[8px] font-mono text-orange-400 bg-orange-500/20 px-1.5 py-0.5 rounded border border-orange-500/30 z-10">
            EPHEMERAL
          </span>
        )}
        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
          isRecipient ? 'bg-emerald-500/20' : 'bg-slate-700'
        }`}>
          {isRecipient ? (
            <User className="w-3 h-3 text-emerald-400" />
          ) : (
            <Wallet className="w-3 h-3 text-slate-400" />
          )}
        </div>
        <code className={`text-[10px] font-mono flex-1 truncate ${
          isRecipient ? 'text-emerald-400' : 'text-slate-300'
        }`}>
          {node.truncated || node.address}
        </code>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy(node.address);
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-slate-700 rounded"
        >
          {copiedId === nodeId ? (
            <Check className="w-3 h-3 text-emerald-400" />
          ) : (
            <Copy className="w-3 h-3 text-slate-500" />
          )}
        </button>
      </div>
      
      {isRecipient && (
        <span className="text-[9px] font-mono text-slate-500">{node.label}</span>
      )}
    </div>
  );
};

export function TransactionFlowMap({ 
  signature, 
  onClose,
  stealthPool,
  burner,
  recipient,
  amount,
  solRecovered
}: TransactionFlowMapProps) {
  const [graph, setGraph] = useState<TransactionGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [copiedNodeId, setCopiedNodeId] = useState<string | null>(null);
  const [copiedAddressId, setCopiedAddressId] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Create custody pipeline flow if data is available
  const createCustodyPipelineFlow = useCallback((): TransactionGraph | null => {
    if (!stealthPool || !burner || !recipient) {
      return null;
    }

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // 1. Stealth Pool Node
    nodes.push({
      id: 'stealth-pool',
      type: 'account',
      label: 'Stealth Pool',
      address: stealthPool,
      truncated: `${stealthPool.slice(0, 8)}...${stealthPool.slice(-8)}`,
    });

    // 2. Ephemeral Burner Node
    nodes.push({
      id: 'ephemeral-burner',
      type: 'account',
      label: 'Ephemeral Burner',
      address: burner,
      truncated: `${burner.slice(0, 8)}...${burner.slice(-8)}`,
    });

    // 3. Asset Node (if amount provided)
    if (amount) {
      const amountNum = parseFloat(amount) / 1_000_000; // Convert from micro-USDC
      nodes.push({
        id: 'asset-usdc',
        type: 'asset',
        label: `${amountNum} USDC`,
        address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mint
        data: {
          amount: amountNum.toString(),
          token: 'USDC',
        },
      });
    }

    // 4. Recipient Node
    nodes.push({
      id: 'recipient',
      type: 'account',
      label: 'Recipient',
      address: recipient,
      truncated: `${recipient.slice(0, 8)}...${recipient.slice(-8)}`,
    });

    // Create edges
    edges.push({
      id: 'pool-to-burner',
      source: 'stealth-pool',
      target: 'ephemeral-burner',
      type: 'transfer',
      label: 'Fund',
    });

    if (amount) {
      edges.push({
        id: 'burner-to-asset',
        source: 'ephemeral-burner',
        target: 'asset-usdc',
        type: 'transfer',
        label: 'Send',
      });
      edges.push({
        id: 'asset-to-recipient',
        source: 'asset-usdc',
        target: 'recipient',
        type: 'transfer',
        label: 'Receive',
      });
    } else {
      edges.push({
        id: 'burner-to-recipient',
        source: 'ephemeral-burner',
        target: 'recipient',
        type: 'transfer',
        label: 'Transfer',
      });
    }

    return {
      nodes,
      edges,
      metadata: {
        signature,
        status: 'success',
      },
    };
  }, [stealthPool, burner, recipient, amount, signature]);

  const fetchGraph = useCallback(async () => {
    // First, try to create flow from custody pipeline data
    const custodyFlow = createCustodyPipelineFlow();
    if (custodyFlow) {
      setGraph(custodyFlow);
      setLoading(false);
      return;
    }

    // Otherwise, fall back to RPC parsing
    setLoading(true);
    setError(null);
    setErrorCode(null);
    setRetryAfter(null);
    
    try {
      const response = await fetch(`${GATEWAY_URL}/api/credits/transaction/${signature}/graph`);
      const result = await response.json();
      
      if (result.success) {
        setGraph(result.data);
        setRetryCount(0); // Reset retry count on success
      } else {
        // Check for specific error codes
        if (result.code === 'RATE_LIMITED') {
          setError('Rate limit exceeded. RPC is busy. Please wait a few seconds and try again.');
          setErrorCode('RATE_LIMITED');
          setRetryAfter(result.retryAfter || 5000);
        } else if (result.code === 'NOT_FOUND') {
          setError('Transaction not found. It may not exist or is still being confirmed.');
          setErrorCode('NOT_FOUND');
        } else {
          setError(result.error || 'Failed to load transaction graph');
          setErrorCode(result.code || 'UNKNOWN');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch transaction graph');
      setErrorCode('NETWORK_ERROR');
    } finally {
      setLoading(false);
    }
  }, [signature, createCustodyPipelineFlow]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // Auto-retry for rate limit errors after delay
  useEffect(() => {
    if (errorCode === 'RATE_LIMITED' && retryAfter && retryCount < 2) {
      const timer = setTimeout(() => {
        setRetryCount(prev => prev + 1);
        fetchGraph();
      }, retryAfter);
      
      return () => clearTimeout(timer);
    }
  }, [errorCode, retryAfter, retryCount, fetchGraph]);

  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
    fetchGraph();
  };

  const handleNodeCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedNodeId(`copy-${text}`);
    setTimeout(() => setCopiedNodeId(null), 2000);
  }, []);

  const handleAddressCopy = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAddressId(id);
    setTimeout(() => setCopiedAddressId(null), 2000);
  }, []);

  // Convert graph data to React Flow nodes/edges with professional layout
  useEffect(() => {
    if (!graph) return;

    // Separate nodes by type
    const signers = graph.nodes.filter(n => n.type === 'signer');
    const accounts = graph.nodes.filter(n => n.type === 'account');
    const assets = graph.nodes.filter(n => n.type === 'asset');
    
    // Check if this is a custody pipeline flow (has stealth-pool, ephemeral-burner, recipient)
    const isCustodyPipeline = accounts.some(a => a.id === 'stealth-pool') && 
                               accounts.some(a => a.id === 'ephemeral-burner') &&
                               accounts.some(a => a.id === 'recipient');
    
    const flowNodes: Node[] = [];
    let xOffset = 100;
    const centerY = 300;

    if (isCustodyPipeline) {
      // CUSTODY PIPELINE FLOW: Horizontal layout
      // Stealth Pool → Ephemeral Burner → Asset → Recipient
      
      const stealthPool = accounts.find(a => a.id === 'stealth-pool');
      const burner = accounts.find(a => a.id === 'ephemeral-burner');
      const recipient = accounts.find(a => a.id === 'recipient');
      const asset = assets[0];

      // 1. Stealth Pool (left)
      if (stealthPool) {
        flowNodes.push({
          id: stealthPool.id,
          type: 'default',
          position: { x: xOffset, y: centerY },
          data: {
            label: <AccountNode node={stealthPool} onCopy={handleNodeCopy} copiedId={copiedNodeId} />,
          },
          className: 'react-flow__node-default',
          style: { background: 'transparent', border: 'none', width: 'auto' },
        });
        xOffset += 280;
      }

      // 2. Ephemeral Burner (second)
      if (burner) {
        flowNodes.push({
          id: burner.id,
          type: 'default',
          position: { x: xOffset, y: centerY },
          data: {
            label: <AccountNode 
              node={{ ...burner, label: 'Ephemeral Burner' }} 
              onCopy={handleNodeCopy} 
              copiedId={copiedNodeId}
              isEphemeral 
            />,
          },
          className: 'react-flow__node-default',
          style: { background: 'transparent', border: 'none', width: 'auto' },
        });
        xOffset += 280;
      }

      // 3. Asset (center)
      if (asset) {
        flowNodes.push({
          id: asset.id,
          type: 'default',
          position: { x: xOffset, y: centerY },
          data: {
            label: <AssetNode node={asset} />,
          },
          className: 'react-flow__node-default',
          style: { background: 'transparent', border: 'none', width: 'auto' },
        });
        xOffset += 250;
      }

      // 4. Recipient (right)
      if (recipient) {
        flowNodes.push({
          id: recipient.id,
          type: 'default',
          position: { x: xOffset, y: centerY },
          data: {
            label: <AccountNode node={recipient} onCopy={handleNodeCopy} copiedId={copiedNodeId} isRecipient />,
          },
          className: 'react-flow__node-default',
          style: { background: 'transparent', border: 'none', width: 'auto' },
        });
      }
    } else {
      // STANDARD FLOW: Signers (left) → Sources → Assets (center) → Recipient (right)
      
      // Identify recipient (usually the last account in transfer flow)
      const recipient = accounts[accounts.length - 1];
      const sources = accounts.slice(0, -1);
      
      // 1. Add Signers on the far left, vertically stacked
      signers.forEach((signer, index) => {
        flowNodes.push({
          id: signer.id,
          type: 'default',
          position: { 
            x: xOffset, 
            y: centerY - 100 + (index * 150) 
          },
          data: {
            label: <SignerNode node={signer} onCopy={handleNodeCopy} copiedId={copiedNodeId} />,
          },
          className: 'react-flow__node-default',
          style: {
            background: 'transparent',
            border: 'none',
            width: 'auto',
          },
        });
      });
      
      // Move to next column
      if (signers.length > 0) {
        xOffset += 250;
      }
      
      // 2. Add Source accounts (if any, between signers and assets)
      if (sources.length > 0) {
        sources.forEach((source, index) => {
          flowNodes.push({
            id: source.id,
            type: 'default',
            position: { 
              x: xOffset, 
              y: centerY - 80 + (index * 160) 
            },
            data: {
              label: <AccountNode node={source} onCopy={handleNodeCopy} copiedId={copiedNodeId} />,
            },
            className: 'react-flow__node-default',
            style: {
              background: 'transparent',
              border: 'none',
              width: 'auto',
            },
          });
        });
        xOffset += 280;
      }
      
      // 3. Add Asset nodes in the center
      assets.forEach((asset, index) => {
        flowNodes.push({
          id: asset.id,
          type: 'default',
          position: { 
            x: xOffset, 
            y: centerY + (index * 120) 
          },
          data: {
            label: <AssetNode node={asset} />,
          },
          className: 'react-flow__node-default',
          style: {
            background: 'transparent',
            border: 'none',
            width: 'auto',
          },
        });
      });
      
      if (assets.length > 0) {
        xOffset += 250;
      }
      
      // 4. Add Recipient on the right
      if (recipient) {
        flowNodes.push({
          id: recipient.id,
          type: 'default',
          position: { 
            x: xOffset, 
            y: centerY 
          },
          data: {
            label: <AccountNode node={recipient} onCopy={handleNodeCopy} copiedId={copiedNodeId} isRecipient />,
          },
          className: 'react-flow__node-default',
          style: {
            background: 'transparent',
            border: 'none',
            width: 'auto',
          },
        });
      }
    }

    // Create edges with red dashed arrows
    const flowEdges: Edge[] = graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      animated: true,
      style: {
        stroke: '#ef4444',
        strokeWidth: 2,
        strokeDasharray: '8,4', // Red dashed line
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#ef4444',
        width: 20,
        height: 20,
      },
      label: edge.label || '',
      labelStyle: {
        fill: '#ef4444',
        fontWeight: 600,
        fontSize: '10px',
        background: 'rgba(15, 23, 42, 0.9)',
        padding: '2px 4px',
        borderRadius: '2px',
      },
    }));

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [graph, setNodes, setEdges, handleNodeCopy, copiedNodeId]);

  const handleCopy = useCallback(() => {
    if (graph?.metadata.signature) {
      navigator.clipboard.writeText(graph.metadata.signature);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [graph]);

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-slate-400"></div>
        <p className="text-xs font-mono text-slate-500 mt-2">
          {errorCode === 'RATE_LIMITED' && retryCount > 0 
            ? `RETRYING (${retryCount}/2)...` 
            : 'LOADING_TRANSACTION_GRAPH...'}
        </p>
        {errorCode === 'RATE_LIMITED' && retryAfter && (
          <p className="text-[10px] font-mono text-slate-600 mt-1">
            Waiting {Math.ceil(retryAfter / 1000)}s before retry...
          </p>
        )}
      </div>
    );
  }

  if (error || !graph) {
    return (
      <div className="p-8 text-center space-y-4">
        <div>
          <p className={`text-xs font-mono mb-2 ${
            errorCode === 'RATE_LIMITED' ? 'text-amber-400' : 'text-red-400'
          }`}>
            {error || 'Failed to load graph'}
          </p>
          {errorCode && (
            <p className="text-[10px] font-mono text-slate-600">
              ERROR_CODE: {errorCode}
            </p>
          )}
        </div>
        
        {/* Retry button for recoverable errors */}
        {(errorCode === 'RATE_LIMITED' || errorCode === 'NETWORK_ERROR') && (
          <button
            onClick={handleRetry}
            disabled={retryCount >= 3}
            className="px-4 py-2 text-[10px] font-mono border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {retryCount >= 3 ? 'MAX_RETRIES_REACHED' : `RETRY (${retryCount}/3)`}
          </button>
        )}
        
        {/* Show Solscan link as fallback */}
        <div className="pt-4 border-t border-slate-800">
          <a
            href={`https://solscan.io/tx/${signature}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono text-status-info hover:text-status-info/80 border border-slate-700 hover:border-slate-600 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            VIEW_ON_SOLSCAN
          </a>
        </div>
      </div>
    );
  }

  // Check if we have custody pipeline data (not a hook, so it's fine here)
  const hasCustodyPipeline = !!(stealthPool && burner && recipient);

  return (
    <div className="w-full flex flex-col border border-slate-800 bg-slate-950">
      {/* Flow Map Section */}
      <div className="relative" style={{ height: '500px' }}>
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-10 p-3 border-b border-slate-800 bg-slate-900/95 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-slate-400">TRANSACTION_FLOW</span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-2 py-1 border border-slate-700 hover:border-slate-600 transition-colors"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3 text-slate-500" />
                )}
                <span className="text-[9px] font-mono text-slate-400">
                  {graph.metadata.signature.slice(0, 8)}...{graph.metadata.signature.slice(-8)}
                </span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`https://solscan.io/tx/${graph.metadata.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 hover:bg-slate-800 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
              </a>
              {onClose && (
                <button
                  onClick={onClose}
                  className="px-2 py-1 text-[9px] font-mono text-slate-500 hover:text-slate-300"
                >
                  CLOSE
                </button>
              )}
            </div>
          </div>
        </div>

        {/* React Flow Canvas */}
        <div className="absolute top-[48px] left-0 right-0 bottom-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            fitView
            attributionPosition="bottom-left"
          >
            <Background 
              color="#334155" 
              gap={20} 
              size={1}
              style={{ opacity: 0.3 }}
            />
            <Controls 
              className="bg-slate-900 border-slate-800 rounded-sm"
              showZoom={true}
              showFitView={true}
              showInteractive={false}
              style={{
                button: {
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  color: '#cbd5e1',
                },
              }}
            />
            <MiniMap 
              className="bg-slate-900 border-slate-800 rounded-sm"
              nodeColor={(node) => {
                // Color nodes based on original graph data
                const originalNode = graph?.nodes.find(n => n.id === node.id);
                if (originalNode?.type === 'asset') return '#f1f5f9';
                if (originalNode?.type === 'account' && graph?.nodes.filter(n => n.type === 'account').indexOf(originalNode) === graph.nodes.filter(n => n.type === 'account').length - 1) {
                  return '#10b981'; // Recipient (last account)
                }
                return '#475569';
              }}
              maskColor="rgba(0, 0, 0, 0.6)"
              style={{
                width: 200,
                height: 120,
              }}
            />
          </ReactFlow>
        </div>
      </div>

      {/* Custody Pipeline Section */}
      {hasCustodyPipeline && (
        <div className="border-t border-slate-800 bg-slate-950 p-4">
          <h4 className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-4">
            CUSTODY_PIPELINE
          </h4>
          
          <div className="flex flex-col space-y-3">
            {/* STEALTH_POOL */}
            <div className="bg-slate-800 border border-slate-700 rounded-sm p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono text-slate-400 uppercase">STEALTH_POOL</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAddressCopy(stealthPool!, 'stealth-pool')}
                    className="p-1 hover:bg-slate-700 transition-colors"
                    title="Copy address"
                  >
                    {copiedAddressId === 'stealth-pool' ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3 text-slate-500" />
                    )}
                  </button>
                  <a
                    href={`https://solscan.io/account/${stealthPool}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 hover:bg-slate-700 transition-colors"
                    title="View on Solscan"
                  >
                    <ExternalLink className="w-3 h-3 text-slate-500" />
                  </a>
                </div>
              </div>
              <code className="text-xs font-mono text-slate-300 block mb-1">
                {stealthPool}
              </code>
              <span className="text-[9px] font-mono text-slate-600">Pool_Authority</span>
            </div>

            {/* Arrow - Down */}
            <div className="flex justify-center py-1">
              <span className="text-slate-600 text-sm font-bold">↓</span>
            </div>

            {/* EPHEMERAL_BURNER */}
            <div className="bg-slate-800 border border-orange-500/30 rounded-sm p-3 relative">
              <div className="absolute -top-2 -right-2">
                <span className="text-[8px] font-mono text-orange-400 bg-orange-500/20 px-1.5 py-0.5 rounded border border-orange-500/30">
                  EPHEMERAL
                </span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono text-slate-400 uppercase">EPHEMERAL_BURNER</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAddressCopy(burner!, 'burner')}
                    className="p-1 hover:bg-slate-700 transition-colors"
                    title="Copy address"
                  >
                    {copiedAddressId === 'burner' ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3 text-slate-500" />
                    )}
                  </button>
                  <a
                    href={`https://solscan.io/account/${burner}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 hover:bg-slate-700 transition-colors"
                    title="View on Solscan"
                  >
                    <ExternalLink className="w-3 h-3 text-slate-500" />
                  </a>
                </div>
              </div>
              <code className="text-xs font-mono text-slate-300 block mb-1">
                {burner}
              </code>
              <span className="text-[9px] font-mono text-slate-600">Ephemeral_Instance</span>
            </div>

            {/* Arrow - Down */}
            <div className="flex justify-center py-1">
              <span className="text-slate-600 text-sm font-bold">↓</span>
            </div>

            {/* RECIPIENT */}
            <div className="bg-slate-800 border border-emerald-500/30 rounded-sm p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono text-slate-400 uppercase">RECIPIENT</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAddressCopy(recipient!, 'recipient')}
                    className="p-1 hover:bg-slate-700 transition-colors"
                    title="Copy address"
                  >
                    {copiedAddressId === 'recipient' ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3 text-slate-500" />
                    )}
                  </button>
                  <a
                    href={`https://solscan.io/account/${recipient}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 hover:bg-slate-700 transition-colors"
                    title="View on Solscan"
                  >
                    <ExternalLink className="w-3 h-3 text-slate-500" />
                  </a>
                </div>
              </div>
              <code className="text-xs font-mono text-emerald-400 block mb-1">
                {recipient}
              </code>
              <span className="text-[9px] font-mono text-slate-600">Destination</span>
            </div>

            {/* SOL_RECOVERED (if available) */}
            {solRecovered !== undefined && solRecovered > 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-sm p-3 mt-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-400 uppercase">SOL_RECOVERED</span>
                  <span className="text-xs font-mono text-emerald-400">
                    +{solRecovered.toFixed(6)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

