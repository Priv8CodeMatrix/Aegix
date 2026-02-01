'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal, ChevronUp, ChevronDown, Trash2, Download } from 'lucide-react';

interface ConsoleLog {
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

interface StatusConsoleProps {
  logs: ConsoleLog[];
}

export function StatusConsole({ logs }: StatusConsoleProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (scrollRef.current && !isCollapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isCollapsed]);

  const formatTimestamp = (ts: string) => {
    return new Date(ts).toISOString().split('T')[1].slice(0, 12);
  };

  const getLevelStyle = (level: ConsoleLog['level']) => {
    switch (level) {
      case 'info':
        return 'text-status-info';
      case 'success':
        return 'text-status-success';
      case 'warning':
        return 'text-status-warning';
      case 'error':
        return 'text-status-critical';
    }
  };

  const getLevelPrefix = (level: ConsoleLog['level']) => {
    switch (level) {
      case 'info':
        return 'INFO';
      case 'success':
        return 'OK';
      case 'warning':
        return 'WARN';
      case 'error':
        return 'ERR';
    }
  };

  const handleExport = () => {
    const content = logs.map(log => 
      `[${log.timestamp}] [${getLevelPrefix(log.level)}] ${log.message}`
    ).join('\n');
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aegix_console_${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`border-t border-slate-800 bg-slate-950 transition-all ${
      isCollapsed ? 'h-8' : 'h-console'
    }`}>
      {/* Console Header */}
      <div className="h-8 px-3 flex items-center justify-between bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-[10px] font-mono text-slate-500">STATUS_CONSOLE</span>
          <span className="px-1.5 py-0.5 text-[9px] font-mono text-slate-600 bg-slate-800 border border-slate-700">
            {logs.length} entries
          </span>
        </div>
        
        <div className="flex items-center gap-1">
          <button
            onClick={handleExport}
            className="p-1 hover:bg-slate-800 transition-colors"
            title="Export logs"
          >
            <Download className="w-3 h-3 text-slate-500" />
          </button>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 hover:bg-slate-800 transition-colors"
          >
            {isCollapsed ? (
              <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            )}
          </button>
        </div>
      </div>

      {/* Console Output */}
      {!isCollapsed && (
        <div 
          ref={scrollRef}
          className="h-[calc(var(--console-height)-32px)] overflow-y-auto font-mono text-[11px] p-2 space-y-0.5"
        >
          {logs.length === 0 ? (
            <div className="text-slate-600 text-center py-4">
              // Console initialized. Awaiting operations...
            </div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="flex gap-3 py-0.5 hover:bg-slate-900/50">
                {/* Timestamp */}
                <span className="text-slate-600 flex-shrink-0">
                  [{formatTimestamp(log.timestamp)}]
                </span>
                
                {/* Level */}
                <span className={`flex-shrink-0 w-12 ${getLevelStyle(log.level)}`}>
                  [{getLevelPrefix(log.level)}]
                </span>
                
                {/* Message */}
                <span className="text-slate-300 break-all">
                  {log.message}
                </span>
              </div>
            ))
          )}
          
          {/* Blinking cursor */}
          <div className="flex items-center gap-1 text-slate-500">
            <span>{'>'}</span>
            <span className="w-2 h-4 bg-slate-500 animate-pulse" />
          </div>
        </div>
      )}
    </div>
  );
}

