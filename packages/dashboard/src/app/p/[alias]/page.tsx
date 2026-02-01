'use client';

/**
 * Alias-based Payment Page
 * 
 * Supports friendly URLs like /p/ghost-wolf-42
 * Redirects to the main payment page by looking up the alias
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, Ghost } from 'lucide-react';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';

export default function AliasPaymentPage() {
  const params = useParams();
  const router = useRouter();
  const alias = params?.alias as string;
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    const lookupAlias = async () => {
      if (!alias) return;
      
      try {
        // The gateway accepts both ID and alias
        const response = await fetch(`${GATEWAY_URL}/api/shadow-link/${alias}`);
        const result = await response.json();
        
        if (result.success) {
          // Redirect to the main pay page (alias works there too!)
          router.replace(`/pay/${alias}`);
        } else {
          setError(result.error || 'Link not found');
        }
      } catch (err) {
        setError('Failed to load payment link');
      }
    };
    
    lookupAlias();
  }, [alias, router]);
  
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-zinc-900/80 backdrop-blur rounded-2xl p-8 text-center border border-zinc-800">
          <Ghost className="w-16 h-16 text-zinc-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Link Not Found</h1>
          <p className="text-zinc-400">{error}</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-12 h-12 text-violet-400 animate-spin mx-auto mb-4" />
        <p className="text-zinc-400">Loading payment...</p>
        <p className="text-xs text-violet-400 mt-2 font-mono">{alias}</p>
      </div>
    </div>
  );
}



