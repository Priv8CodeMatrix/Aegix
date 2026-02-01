'use client';

import { FC, ReactNode, useMemo } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';

// Import wallet adapter styles
import '@solana/wallet-adapter-react-ui/styles.css';

// RPC Endpoints - use environment variable or fallback to public endpoints
// The public mainnet RPC has rate limits, so we provide alternatives
const RPC_ENDPOINTS = {
  // Environment variable takes priority
  custom: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
  // Public mainnet endpoints (some are more lenient than others)
  mainnet: 'https://api.mainnet-beta.solana.com',
  // Free public RPCs with better rate limits
  ankr: 'https://rpc.ankr.com/solana',
  // Helius free tier (if you have an API key)
  helius: process.env.NEXT_PUBLIC_HELIUS_RPC_URL,
};

interface Props {
  children: ReactNode;
}

export const WalletProviders: FC<Props> = ({ children }) => {
  // Use custom RPC if provided, otherwise use Ankr (more lenient rate limits)
  const endpoint = useMemo(() => {
    // Priority: env var > Helius > Ankr > public mainnet
    if (RPC_ENDPOINTS.custom) return RPC_ENDPOINTS.custom;
    if (RPC_ENDPOINTS.helius) return RPC_ENDPOINTS.helius;
    // Ankr has better rate limits for free users
    return RPC_ENDPOINTS.ankr;
  }, []);

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  // Connection config with proper commitment for mainnet
  const config = useMemo(() => ({
    commitment: 'confirmed' as const,
    wsEndpoint: undefined, // Disable WebSocket to reduce rate limit issues
    confirmTransactionInitialTimeout: 60000, // 60 seconds
  }), []);

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

