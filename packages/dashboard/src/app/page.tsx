'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { ClientWalletButton } from '@/components/ClientWalletButton';
import {
  Shield,
  Lock,
  Unlock,
  Activity,
  Cpu,
  RefreshCw,
  Plus,
  Terminal,
  Database,
  Zap,
  AlertTriangle,
  CheckCircle,
  Check,
  Clock,
  ExternalLink,
  Ghost,
  Loader2,
  X,
  Link2,
  Copy,
  ChevronDown,
  ChevronRight,
  Wallet,
  Search,
} from 'lucide-react';
import { SessionLedger } from '@/components/SessionLedger';
import { ProtocolHealth } from '@/components/ProtocolHealth';
import { StatusConsole } from '@/components/StatusConsole';
import StealthPayment from '@/components/StealthPayment';
import ShadowLinks from '@/components/ShadowLinks';
import { AgentDetailPanel } from '@/components/AgentDetailPanel';
import { PoolBundleModal } from '@/components/PoolBundleModal';
import { StealthPoolChannel } from '@/components/StealthPoolChannel';
import { AgentTransactionLedger } from '@/components/AgentTransactionLedger';
import { useGateway } from '@/hooks/useGateway';
import type { Agent } from '@/lib/gateway';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';

export default function Dashboard() {
  const { connected, publicKey } = useWallet();
  const [activePanel, setActivePanel] = useState<'execute' | 'ledger' | 'agents' | 'ghost'>('execute');
  const [agentMenuExpanded, setAgentMenuExpanded] = useState(false);
  const [agentSubPanel, setAgentSubPanel] = useState<'management' | 'transactions' | 'pools'>('management');
  const [poolAddress, setPoolAddress] = useState<string | undefined>(undefined);
  const [poolId, setPoolId] = useState<string | undefined>(undefined);
  const [consoleLogs, setConsoleLogs] = useState<Array<{
    timestamp: string;
    level: 'info' | 'success' | 'warning' | 'error';
    message: string;
  }>>([]);

  const {
    isConnected: gatewayConnected,
    isLoading,
    auditLog,
    agents,
    fheMode,
    refresh,
    createAgent,
  } = useGateway();

  // Stats
  const activeAgents = agents.filter(a => a.status === 'active').length;
  const encryptedCount = auditLog.filter(e => e.fheHandle).length;
  const totalPayments = auditLog.filter(e => e.type === 'pool_payment').length;

  // Add console log
  const addLog = (level: 'info' | 'success' | 'warning' | 'error', message: string) => {
    setConsoleLogs(prev => [...prev.slice(-50), {
      timestamp: new Date().toISOString(),
      level,
      message,
    }]);
  };

  // Initial log
  useEffect(() => {
    if (connected && publicKey) {
      addLog('info', `WALLET_CONNECTED: ${publicKey.toBase58().slice(0, 8)}...`);
      addLog('info', `GATEWAY_STATUS: ${gatewayConnected ? 'ONLINE' : 'OFFLINE'}`);
      addLog('info', `FHE_MODE: ${fheMode}`);
    }
  }, [connected, publicKey, gatewayConnected, fheMode]);

  // Not connected - show minimal auth view
  if (!connected) {
    return (
      <div className="h-screen flex flex-col bg-slate-950">
        <Header gatewayConnected={gatewayConnected} />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 border border-slate-700 flex items-center justify-center">
              <Lock className="w-6 h-6 text-slate-500" />
            </div>
            <h1 className="text-lg font-semibold text-slate-100 mb-1">
              AEGIX_TERMINAL
            </h1>
            <p className="text-xs text-slate-500 mb-1 font-mono">
              x402 Protocol Gateway // Light Protocol ZK Compression
            </p>
            <p className="text-[10px] text-slate-600 mb-6 font-mono">
              LIGHT_PROTOCOL_STATUS: {fheMode === 'REAL' ? 'ACTIVE' : 'SIMULATION'}
            </p>
            <ClientWalletButton />
          </div>
        </main>
        <footer className="h-6 border-t border-slate-800 bg-slate-900 flex items-center px-4">
          <span className="text-[10px] text-slate-600 font-mono">
            AEGIX_v3.1 // INSTITUTIONAL_BUILD
          </span>
        </footer>
      </div>
    );
  }

  // Connected - show workstation dashboard
  return (
    <div className="h-screen flex flex-col bg-slate-950 overflow-hidden">
      {/* Fixed Header - 48px */}
      <Header gatewayConnected={gatewayConnected} />
      
      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Fixed Sidebar - 240px */}
        <aside className="w-sidebar border-r border-slate-800 bg-slate-900 flex flex-col">
          {/* Wallet Status */}
          <div className="p-3 border-b border-slate-800">
            <div className="text-[10px] text-slate-500 font-mono mb-1">CONNECTED_WALLET</div>
            <div className="text-xs text-slate-300 font-mono truncate">
              {publicKey?.toBase58()}
            </div>
          </div>
          
          {/* Navigation */}
          <nav className="flex-1 p-2">
            <div className="text-[10px] text-slate-600 font-mono px-2 py-1 mb-1">OPERATIONS</div>
            
            <button
              onClick={() => setActivePanel('execute')}
              className={`w-full text-left px-3 py-2 text-xs font-medium flex items-center gap-2 transition-colors ${
                activePanel === 'execute'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-status-info'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-300 border-l-2 border-transparent'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Execute_Payment
            </button>
            
            <button
              onClick={() => setActivePanel('ledger')}
              className={`w-full text-left px-3 py-2 text-xs font-medium flex items-center gap-2 transition-colors ${
                activePanel === 'ledger'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-status-info'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-300 border-l-2 border-transparent'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              Transaction_Ledger
            </button>
            
            {/* Agent Registry with Expandable Dropdown */}
            <div>
              <button
                onClick={() => {
                  if (activePanel !== 'agents') {
                    setActivePanel('agents');
                    setAgentMenuExpanded(true);
                  } else {
                    setAgentMenuExpanded(!agentMenuExpanded);
                  }
                }}
                className={`w-full text-left px-3 py-2 text-xs font-medium flex items-center gap-2 transition-colors ${
                  activePanel === 'agents'
                    ? 'bg-slate-800 text-slate-100 border-l-2 border-status-info'
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-300 border-l-2 border-transparent'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                <span className="flex-1">Agent_Registry</span>
                {activePanel === 'agents' && (
                  agentMenuExpanded ? (
                    <ChevronDown className="w-3 h-3 text-slate-500" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-slate-500" />
                  )
                )}
              </button>
              
              {/* Sub-panel dropdown (only visible when Agent_Registry is active) */}
              {activePanel === 'agents' && agentMenuExpanded && (
                <div className="ml-4 mt-1 space-y-1 border-l border-slate-700 pl-2">
                  <button
                    onClick={() => setAgentSubPanel('management')}
                    className={`w-full text-left px-2 py-1.5 text-[10px] font-mono flex items-center gap-2 transition-colors ${
                      agentSubPanel === 'management'
                        ? 'text-status-info bg-status-info/10'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <Cpu className="w-3 h-3" />
                    Agent_Management
                  </button>
                  <button
                    onClick={() => setAgentSubPanel('transactions')}
                    className={`w-full text-left px-2 py-1.5 text-[10px] font-mono flex items-center gap-2 transition-colors ${
                      agentSubPanel === 'transactions'
                        ? 'text-status-info bg-status-info/10'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <Database className="w-3 h-3" />
                    Agent_Transactions
                  </button>
                  <button
                    onClick={() => setAgentSubPanel('pools')}
                    className={`w-full text-left px-2 py-1.5 text-[10px] font-mono flex items-center gap-2 transition-colors ${
                      agentSubPanel === 'pools'
                        ? 'text-status-info bg-status-info/10'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <Wallet className="w-3 h-3" />
                    Stealth_Pool_Channel
                  </button>
                </div>
              )}
            </div>
            
            <button
              onClick={() => setActivePanel('ghost')}
              className={`w-full text-left px-3 py-2 text-xs font-medium flex items-center gap-2 transition-colors ${
                activePanel === 'ghost'
                  ? 'bg-slate-800 text-slate-100 border-l-2 border-status-info'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-300 border-l-2 border-transparent'
              }`}
            >
              <Ghost className="w-3.5 h-3.5" />
              Ghost_Invoice
            </button>
            
            <div className="text-[10px] text-slate-600 font-mono px-2 py-1 mt-4 mb-1">METRICS</div>
            
            {/* Compact Stats */}
            <div className="px-2 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Active_Agents</span>
                <span className="text-slate-300 font-mono">{activeAgents}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">FHE_Entries</span>
                <span className="text-slate-300 font-mono">{encryptedCount}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Total_Payments</span>
                <span className="text-slate-300 font-mono">{totalPayments}</span>
              </div>
            </div>
          </nav>
          
          {/* Protocol Health Widget */}
          <ProtocolHealth fheMode={fheMode} gatewayConnected={gatewayConnected} />
        </aside>
        
        {/* Primary Data Grid */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Panel Header */}
          <div className="h-10 border-b border-slate-800 bg-slate-900 flex items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-300">
                {activePanel === 'execute' && 'STEALTH_EXECUTION_TERMINAL'}
                {activePanel === 'ledger' && 'CHRONOLOGICAL_TRANSACTION_LEDGER'}
                {activePanel === 'agents' && agentSubPanel === 'management' && 'AGENT_REGISTRY_MANAGEMENT'}
                {activePanel === 'agents' && agentSubPanel === 'transactions' && 'AGENT_TRANSACTION_LEDGER'}
                {activePanel === 'agents' && agentSubPanel === 'pools' && 'STEALTH_POOL_CHANNEL'}
                {activePanel === 'ghost' && 'GHOST_INVOICE_GENERATOR'}
              </span>
              <span className="px-1.5 py-0.5 text-[10px] font-mono text-slate-500 bg-slate-800 border border-slate-700">
                {activePanel === 'execute' && 'x402_PROTOCOL'}
                {activePanel === 'ledger' && 'PDR_v1.0'}
                {activePanel === 'agents' && agentSubPanel === 'management' && 'FHE_ENABLED'}
                {activePanel === 'agents' && agentSubPanel === 'transactions' && 'FILTERED'}
                {activePanel === 'agents' && agentSubPanel === 'pools' && 'FHE_KEYS'}
                {activePanel === 'ghost' && 'SHADOW_LINK'}
              </span>
            </div>
            <button
              onClick={refresh}
              disabled={isLoading}
              className="p-1.5 hover:bg-slate-800 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          
          {/* Panel Content */}
          <div className="flex-1 overflow-auto p-4">
            {activePanel === 'execute' && (
              <div className="max-w-2xl mx-auto">
                <StealthPayment
                  recipient=""
                  recipientName="Service Provider"
                  amount="0.05"
                  onSuccess={(tx) => {
                    addLog('success', `PAYMENT_CONFIRMED: ${tx.slice(0, 16)}...`);
                    refresh();
                  }}
                  onError={(err) => {
                    addLog('error', `PAYMENT_FAILED: ${err}`);
                  }}
                  onPoolReady={(address, id) => {
                    setPoolAddress(address);
                    if (id) setPoolId(id);
                    addLog('info', `POOL_INITIALIZED: ${address.slice(0, 12)}...`);
                  }}
                />
              </div>
            )}
            
            {activePanel === 'ledger' && (
              <SessionLedger 
                auditLog={auditLog} 
                onViewTransaction={(tx) => {
                  addLog('info', `VIEWING_TX: ${tx.slice(0, 16)}...`);
                }}
              />
            )}
            
            {activePanel === 'agents' && agentSubPanel === 'management' && (
              <AgentRegistry 
                agents={agents}
                onCreateAgent={async (name) => {
                  addLog('info', `CREATING_AGENT: ${name}`);
                  try {
                    const agent = await createAgent(name, 'shielded');
                    if (agent) {
                      addLog('success', `AGENT_CREATED: ${agent.id}`);
                      addLog('info', `API_KEY: ${agent.apiKey.slice(0, 20)}...`);
                      return agent; // Return agent with API key
                    } else {
                      throw new Error('No agent returned from server');
                    }
                  } catch (err: any) {
                    addLog('error', `AGENT_ERROR: ${err.message || 'Unknown error'}`);
                    throw err; // Re-throw so AgentRegistry can catch and display it
                  }
                }}
                onRefresh={refresh}
                mainPoolAddress={poolAddress}
                mainPoolId={poolId}
                owner={publicKey?.toBase58()}
                onLog={addLog}
              />
            )}
            
            {activePanel === 'agents' && agentSubPanel === 'transactions' && (
              <AgentTransactionLedger
                auditLog={auditLog}
                agents={agents}
                onViewTransaction={(tx) => {
                  addLog('info', `VIEWING_TX: ${tx.slice(0, 16)}...`);
                }}
                onLog={addLog}
              />
            )}
            
            {activePanel === 'agents' && agentSubPanel === 'pools' && (
              <StealthPoolChannel
                onLog={addLog}
                onRefresh={refresh}
                globalRefresh={refresh}
              />
            )}
            
            {activePanel === 'ghost' && (
              <ShadowLinks 
                poolAddress={poolAddress}
                onRefreshPool={refresh}
              />
            )}
          </div>
          
          {/* Status Console - Fixed Bottom */}
          <StatusConsole logs={consoleLogs} />
        </main>
      </div>
    </div>
  );
}

// ============ Sub-components ============

function Header({ gatewayConnected }: { gatewayConnected: boolean }) {
  return (
    <header className="h-header border-b border-slate-800 bg-slate-900 flex items-center justify-between px-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 border border-slate-700 flex items-center justify-center">
            <Shield className="w-4 h-4 text-slate-400" />
          </div>
          <span className="text-sm font-semibold text-slate-100 tracking-tight">AEGIX</span>
        </div>
        
        <div className="h-4 w-px bg-slate-700" />
        
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="text-slate-500">x402_PROTOCOL</span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-500">LIGHT_ZK</span>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        {/* Gateway Status */}
        <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-800 border border-slate-700">
          <span className={`w-1.5 h-1.5 rounded-full ${
            gatewayConnected ? 'bg-status-success' : 'bg-status-critical'
          }`} />
          <span className="text-[10px] font-mono text-slate-400">
            GW_{gatewayConnected ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>
        
        <ClientWalletButton />
      </div>
    </header>
  );
}

interface AgentRegistryProps {
  agents: Agent[];
  onCreateAgent: (name: string) => Promise<Agent | null>;
  onRefresh: () => void;
  mainPoolAddress?: string;
  mainPoolId?: string;
  owner?: string;
  onLog?: (level: 'info' | 'success' | 'error' | 'warning', message: string) => void;
}

function AgentRegistry({ agents, onCreateAgent, onRefresh, mainPoolAddress, mainPoolId, owner, onLog }: AgentRegistryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [newAgentName, setNewAgentName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [showBundleModal, setShowBundleModal] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [newlyCreatedAgent, setNewlyCreatedAgent] = useState<Agent | null>(null);
  const [copiedNewKey, setCopiedNewKey] = useState(false);
  
  // Filter agents based on search query
  const filteredAgents = agents.filter(agent => 
    agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.id.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const handleRegister = async () => {
    if (!newAgentName.trim() || isRegistering) return;
    
    setIsRegistering(true);
    setRegistrationError(null);
    
    try {
      const agent = await onCreateAgent(newAgentName.trim());
      setNewAgentName('');
      setShowQuickCreate(false);
      setShowRegisterModal(false);
      // Show the new API key modal if agent was returned with key
      if (agent && (agent as any).apiKey) {
        setNewlyCreatedAgent(agent as Agent);
      }
    } catch (error: any) {
      console.error('[AgentRegistry] Registration failed:', error);
      setRegistrationError(error.message || 'Failed to register agent');
    } finally {
      setIsRegistering(false);
    }
  };

  const copyNewApiKey = () => {
    if (newlyCreatedAgent && (newlyCreatedAgent as any).apiKey) {
      navigator.clipboard.writeText((newlyCreatedAgent as any).apiKey);
      setCopiedNewKey(true);
      onLog?.('info', 'API_KEY_COPIED');
      setTimeout(() => setCopiedNewKey(false), 2000);
    }
  };
  
  return (
    <div className="space-y-4">
      {/* Sticky Header with Search Bar and REGISTER_AGENT Button */}
      <div className="sticky top-0 z-10 bg-slate-950 pb-4 -mt-4 pt-4 -mx-4 px-4 border-b border-slate-800">
        {/* Error Display */}
        {registrationError && (
          <div className="p-3 mb-3 border border-status-critical/30 bg-status-critical/10 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-status-critical" />
            <span className="text-xs text-status-critical font-mono flex-1">{registrationError}</span>
            <button 
              onClick={() => setRegistrationError(null)} 
              className="text-status-critical hover:text-status-critical/80"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        
        {/* Search Bar + Register Button */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search agents..."
              className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100 placeholder:text-slate-500"
            />
          </div>
          <button
            onClick={() => setShowRegisterModal(true)}
            className="px-4 py-2 bg-status-info text-white text-xs font-medium flex items-center gap-1.5 hover:bg-status-info/80 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            REGISTER_AGENT
          </button>
        </div>
      </div>
      
      {/* Registration Modal */}
      {showRegisterModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-mono text-slate-200">REGISTER_NEW_AGENT</h3>
              <button
                onClick={() => {
                  setShowRegisterModal(false);
                  setNewAgentName('');
                  setRegistrationError(null);
                }}
                className="text-slate-500 hover:text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <p className="text-[10px] text-slate-500">
              Create a new AI agent with its own API key and spending limits
            </p>
            
            <div>
              <label className="text-[10px] text-slate-400 font-mono mb-1 block">AGENT_NAME</label>
              <input
                type="text"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                placeholder="my_agent_name"
                autoFocus
                disabled={isRegistering}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 text-xs font-mono text-slate-100 disabled:opacity-50"
              />
            </div>
            
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  setShowRegisterModal(false);
                  setNewAgentName('');
                }}
                disabled={isRegistering}
                className="flex-1 px-4 py-2 border border-slate-600 text-slate-400 text-xs font-mono hover:border-slate-500 disabled:opacity-50"
              >
                CANCEL
              </button>
              <button
                onClick={handleRegister}
                disabled={!newAgentName.trim() || isRegistering}
                className="flex-1 px-4 py-2 bg-status-info text-white text-xs font-mono disabled:opacity-50 inline-flex items-center justify-center gap-1.5 hover:bg-status-info/80"
              >
                {isRegistering ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    CREATING...
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    CREATE
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Agent Table */}
      {filteredAgents.length === 0 ? (
        <div className="p-8 border border-slate-800 text-center">
          <Cpu className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-xs text-slate-500 font-mono">{agents.length === 0 ? 'NO_AGENTS_REGISTERED' : 'NO_MATCHING_AGENTS'}</p>
          <p className="text-[10px] text-slate-600 mt-1 mb-4">Create an agent to enable x402 API payments</p>
          
          {!showQuickCreate ? (
            <button
              onClick={() => setShowQuickCreate(true)}
              className="px-4 py-2 bg-status-info text-white text-xs font-mono inline-flex items-center gap-1.5 hover:bg-status-info/80 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              CREATE_FIRST_AGENT
            </button>
          ) : (
            <div className="max-w-sm mx-auto space-y-3">
              <input
                type="text"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                placeholder="my_agent_name"
                autoFocus
                disabled={isRegistering}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100 text-center disabled:opacity-50"
              />
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => {
                    setShowQuickCreate(false);
                    setNewAgentName('');
                  }}
                  disabled={isRegistering}
                  className="px-4 py-2 border border-slate-700 text-slate-400 text-xs font-mono hover:border-slate-500 disabled:opacity-50"
                >
                  CANCEL
                </button>
                <button
                  onClick={handleRegister}
                  disabled={!newAgentName.trim() || isRegistering}
                  className="px-4 py-2 bg-status-info text-white text-xs font-mono disabled:opacity-50 inline-flex items-center gap-1.5 hover:bg-status-info/80"
                >
                  {isRegistering ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      CREATING...
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      CREATE_AGENT
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Agent_ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Privacy</th>
              <th>Stealth</th>
              <th>24h_Spend</th>
            </tr>
          </thead>
          <tbody>
            {filteredAgents.map((agent) => (
              <tr 
                key={agent.id} 
                onClick={() => setSelectedAgent(agent)}
                className="cursor-pointer hover:bg-slate-800/50 transition-colors"
              >
                <td className="font-mono text-slate-400">{agent.id.slice(0, 12)}...</td>
                <td className="text-slate-300">{agent.name}</td>
                <td>
                  <span className={`status-badge ${agent.status === 'active' ? 'success' : 'warning'}`}>
                    {agent.status === 'active' ? (
                      <CheckCircle className="w-3 h-3" />
                    ) : (
                      <AlertTriangle className="w-3 h-3" />
                    )}
                    {agent.status}
                  </span>
                </td>
                <td>
                  <span className="text-xs text-slate-500">
                    {agent.privacyLevel || 'standard'}
                  </span>
                </td>
                <td>
                  {agent.stealthSettings?.enabled ? (
                    <span className="status-badge success">
                      <Shield className="w-3 h-3" />
                      ENABLED
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-600 font-mono">—</span>
                  )}
                </td>
                <td className="font-mono text-slate-300">
                  ${parseFloat(agent.spent24h || '0').toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      
      {/* Hint & Bundle Button */}
      {agents.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-slate-600 font-mono">
            Click an agent to manage settings, API keys, and stealth payments
          </p>
          {mainPoolAddress && mainPoolId && (
            <button
              onClick={() => setShowBundleModal(true)}
              className="px-3 py-1.5 border border-slate-700 text-xs font-mono text-slate-400 hover:border-status-info hover:text-status-info flex items-center gap-1.5 rounded-sm transition-colors"
            >
              <Link2 className="w-3 h-3" />
              BUNDLE_TO_POOL
            </button>
          )}
        </div>
      )}
      
      {/* Agent Detail Panel */}
      {selectedAgent && (
        <AgentDetailPanel
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onUpdate={() => {
            onRefresh();
            setSelectedAgent(null);
          }}
          onDelete={() => {
            onRefresh();
            setSelectedAgent(null);
          }}
          mainPoolAddress={mainPoolAddress}
          mainPoolId={mainPoolId}
          onLog={onLog}
        />
      )}
      
      {/* Pool Bundle Modal */}
      {showBundleModal && mainPoolAddress && mainPoolId && owner && (
        <PoolBundleModal
          agents={agents}
          poolId={mainPoolId}
          poolAddress={mainPoolAddress}
          owner={owner}
          onClose={() => setShowBundleModal(false)}
          onSuccess={onRefresh}
          onLog={onLog}
        />
      )}
      
      {/* New Agent API Key Modal */}
      {newlyCreatedAgent && (newlyCreatedAgent as any).apiKey && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-sm">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-200 font-mono flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-status-success" />
                AGENT_CREATED
              </h2>
              <button 
                onClick={() => setNewlyCreatedAgent(null)} 
                className="p-1.5 hover:bg-slate-800 rounded-sm"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="p-3 border border-status-success/30 bg-status-success/10 rounded-sm">
                <p className="text-[10px] text-status-success mb-2 font-mono">
                  Agent "{newlyCreatedAgent.name}" created successfully!
                </p>
                <p className="text-[9px] text-status-warning font-mono">
                  ⚠️ SAVE YOUR API KEY NOW! It will NOT be shown again.
                </p>
              </div>
              
              <div className="border border-slate-800 bg-slate-950 p-3 rounded-sm">
                <p className="text-[9px] text-slate-500 mb-2 font-mono">YOUR_API_KEY:</p>
                <div className="flex items-center gap-2">
                  <code className="text-[11px] font-mono text-status-info flex-1 break-all select-all bg-slate-900 p-2 rounded-sm">
                    {(newlyCreatedAgent as any).apiKey}
                  </code>
                  <button 
                    onClick={copyNewApiKey}
                    className="p-2 bg-slate-800 hover:bg-slate-700 rounded-sm flex-shrink-0"
                    title="Copy API Key"
                  >
                    {copiedNewKey ? (
                      <Check className="w-4 h-4 text-status-success" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                </div>
              </div>
              
              <div className="border border-slate-800 bg-slate-950 p-3 rounded-sm">
                <p className="text-[9px] text-slate-500 mb-1 font-mono">USAGE:</p>
                <code className="text-[10px] font-mono text-slate-400 block">
                  curl -H "X-Agent-Key: YOUR_KEY" ...
                </code>
              </div>
              
              <button
                onClick={() => {
                  copyNewApiKey();
                  setTimeout(() => setNewlyCreatedAgent(null), 500);
                }}
                className="w-full py-2.5 bg-status-info text-white text-xs font-mono flex items-center justify-center gap-2"
              >
                <Copy className="w-3.5 h-3.5" />
                COPY_AND_CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
