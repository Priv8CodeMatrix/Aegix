'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  checkHealth,
  getStatus,
  fetchAuditLog,
  getResources,
  getAgents,
  registerAgent,
  updateAgentConfig,
  deleteAgentById,
  GatewayStatus,
  AuditLogEntry,
  ProtectedResource,
  Agent,
  AgentWithKey,
} from '@/lib/gateway';

interface UseGatewayReturn {
  // Connection state
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Gateway data (NO BALANCE - non-custodial!)
  status: GatewayStatus | null;
  auditLog: AuditLogEntry[];
  resources: ProtectedResource[];
  agents: Agent[];
  fheMode: 'REAL' | 'SIMULATION' | 'UNKNOWN';
  
  // Actions
  refresh: () => Promise<void>;
  createAgent: (name: string, privacyLevel?: 'maximum' | 'shielded' | 'standard') => Promise<AgentWithKey | null>;
  updateAgent: (agentId: string, updates: Partial<Pick<Agent, 'status' | 'privacyLevel' | 'name'>>) => Promise<Agent | null>;
  deleteAgent: (agentId: string) => Promise<boolean>;
}

const REFRESH_INTERVAL = 30000; // 30 seconds

export function useGateway(): UseGatewayReturn {
  const { publicKey, connected } = useWallet();
  
  // State - NO balance state for non-custodial model
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [resources, setResources] = useState<ProtectedResource[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  // Check gateway health
  const checkConnection = useCallback(async () => {
    const health = await checkHealth();
    setIsConnected(health.healthy);
    return health.healthy;
  }, []);

  // Fetch all data (no balance - non-custodial!)
  const fetchAllData = useCallback(async () => {
    if (!publicKey) return;
    
    const owner = publicKey.toBase58();
    
    const [statusData, auditData, resourcesData, agentsData] = await Promise.all([
      getStatus(),
      fetchAuditLog(owner),
      getResources(),
      getAgents(owner),
    ]);

    setStatus(statusData);
    setAuditLog(auditData);
    setResources(resourcesData);
    setAgents(agentsData);
  }, [publicKey]);

  // Refresh function
  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const healthy = await checkConnection();
      
      if (!healthy) {
        setError('Gateway is unreachable. Is the server running on port 3001?');
        return;
      }
      
      if (connected && publicKey) {
        await fetchAllData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to gateway');
    } finally {
      setIsLoading(false);
    }
  }, [checkConnection, connected, publicKey, fetchAllData]);

  // Create agent function - returns agent with API key
  const createAgent = useCallback(async (
    name: string,
    privacyLevel: 'maximum' | 'shielded' | 'standard' = 'shielded'
  ): Promise<AgentWithKey | null> => {
    if (!publicKey) {
      throw new Error('Wallet not connected');
    }
    
    console.log('[Gateway] Creating agent:', { name, owner: publicKey.toBase58().slice(0, 8) });
    
    try {
      const agent = await registerAgent(publicKey.toBase58(), name, privacyLevel);
      
      console.log('[Gateway] Agent created:', agent?.id);
      
      if (agent) {
        // Refresh agents list
        const updatedAgents = await getAgents(publicKey.toBase58());
        setAgents(updatedAgents);
      }
      
      return agent;
    } catch (error: any) {
      console.error('[Gateway] Agent creation failed:', error);
      throw error;
    }
  }, [publicKey]);

  // Update agent function
  const updateAgent = useCallback(async (
    agentId: string,
    updates: Partial<Pick<Agent, 'status' | 'privacyLevel' | 'name'>>
  ): Promise<Agent | null> => {
    if (!publicKey) {
      throw new Error('Wallet not connected');
    }
    
    const updatedAgent = await updateAgentConfig(agentId, updates);
    
    if (updatedAgent) {
      // Update local state
      setAgents(prev => prev.map(a => a.id === agentId ? updatedAgent : a));
    }
    
    return updatedAgent;
  }, [publicKey]);

  // Delete agent function
  const deleteAgent = useCallback(async (agentId: string): Promise<boolean> => {
    if (!publicKey) {
      throw new Error('Wallet not connected');
    }
    
    const success = await deleteAgentById(agentId);
    
    if (success) {
      // Remove from local state
      setAgents(prev => prev.filter(a => a.id !== agentId));
    }
    
    return success;
  }, [publicKey]);

  // Initial load and connection check
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh interval
  useEffect(() => {
    if (!connected) return;
    
    const interval = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [connected, refresh]);

  // Re-fetch when wallet connects/disconnects
  useEffect(() => {
    if (connected && publicKey) {
      refresh();
    } else {
      setAuditLog([]);
      setAgents([]);
    }
  }, [connected, publicKey, refresh]);

  // Derive FHE mode from status
  const fheMode: 'REAL' | 'SIMULATION' | 'UNKNOWN' = status?.fhe?.mode || 'UNKNOWN';

  return {
    isConnected,
    isLoading,
    error,
    status,
    auditLog,
    resources,
    agents,
    fheMode,
    refresh,
    createAgent,
    updateAgent,
    deleteAgent,
  };
}
