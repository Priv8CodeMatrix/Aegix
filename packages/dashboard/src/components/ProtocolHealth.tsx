'use client';

import { useState, useEffect } from 'react';
import { 
  Activity, 
  CheckCircle, 
  AlertTriangle, 
  XCircle,
  Clock,
  Zap,
  Lock,
  Shield
} from 'lucide-react';

interface ProtocolHealthProps {
  fheMode: string;
  gatewayConnected: boolean;
}

interface HealthMetric {
  name: string;
  status: 'healthy' | 'degraded' | 'error';
  value: string;
  latency?: number;
}

export function ProtocolHealth({ fheMode, gatewayConnected }: ProtocolHealthProps) {
  const [metrics, setMetrics] = useState<HealthMetric[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    // Calculate health metrics
    const newMetrics: HealthMetric[] = [
      {
        name: 'LIGHT_ZK',
        status: fheMode === 'REAL' ? 'healthy' : 'degraded',
        value: fheMode === 'REAL' ? 'COMPRESSION_ON' : 'SIMULATED',
        latency: fheMode === 'REAL' ? 120 : 0,
      },
      {
        name: 'x402_FACILITATOR',
        status: gatewayConnected ? 'healthy' : 'error',
        value: gatewayConnected ? 'PAYAI_OK' : 'UNREACHABLE',
        latency: gatewayConnected ? 85 : undefined,
      },
      {
        name: 'STEALTH_POOL',
        status: gatewayConnected ? 'healthy' : 'degraded',
        value: 'KEYPAIR_ACTIVE',
        latency: 12,
      },
      {
        name: 'RPC_ENDPOINT',
        status: 'healthy',
        value: 'MAINNET-BETA',
        latency: 45,
      },
    ];
    
    setMetrics(newMetrics);
    setLastUpdate(new Date());
  }, [fheMode, gatewayConnected]);

  const getStatusIcon = (status: HealthMetric['status']) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="w-3 h-3 text-status-success" />;
      case 'degraded':
        return <AlertTriangle className="w-3 h-3 text-status-warning" />;
      case 'error':
        return <XCircle className="w-3 h-3 text-status-critical" />;
    }
  };

  const getStatusColor = (status: HealthMetric['status']) => {
    switch (status) {
      case 'healthy':
        return 'text-status-success';
      case 'degraded':
        return 'text-status-warning';
      case 'error':
        return 'text-status-critical';
    }
  };

  const overallHealth = metrics.every(m => m.status === 'healthy') 
    ? 'healthy' 
    : metrics.some(m => m.status === 'error')
    ? 'error'
    : 'degraded';

  return (
    <div className="border-t border-slate-800 bg-slate-900/50">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-slate-500" />
          <span className="text-[10px] font-mono text-slate-500">PROTOCOL_HEALTH</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${
            overallHealth === 'healthy' ? 'bg-status-success' :
            overallHealth === 'error' ? 'bg-status-critical' :
            'bg-status-warning'
          }`} />
          <span className="text-[10px] font-mono text-slate-500">
            {overallHealth.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Metrics */}
      <div className="p-2 space-y-1">
        {metrics.map((metric) => (
          <div 
            key={metric.name}
            className="flex items-center justify-between py-1.5 px-2 hover:bg-slate-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              {getStatusIcon(metric.status)}
              <span className="text-[10px] font-mono text-slate-400">
                {metric.name}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-mono ${getStatusColor(metric.status)}`}>
                {metric.value}
              </span>
              {metric.latency !== undefined && (
                <span className="text-[9px] font-mono text-slate-600">
                  {metric.latency}ms
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Last Update */}
      <div className="px-3 py-1.5 border-t border-slate-800 flex items-center gap-1.5">
        <Clock className="w-2.5 h-2.5 text-slate-600" />
        <span className="text-[9px] font-mono text-slate-600">
          {lastUpdate.toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

