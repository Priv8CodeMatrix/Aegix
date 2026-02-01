'use client';

import { Github, ExternalLink } from 'lucide-react';

export function MinimalFooter() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950">
      <div className="max-w-[1920px] mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="text-[10px] font-mono text-slate-600">
              © 2026 AEGIX_PROTOCOL
            </span>
            <span className="text-slate-800">|</span>
            <a
              href="https://github.com/aegix"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 hover:text-slate-400 transition-colors"
            >
              <Github className="w-3.5 h-3.5" />
              GITHUB
            </a>
            <a
              href="https://docs.aegix.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 hover:text-slate-400 transition-colors"
            >
              DOCS
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-mono text-slate-600">
              NON_CUSTODIAL • FHE_ENCRYPTED
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default MinimalFooter;

