'use client';

import dynamic from 'next/dynamic';

// Dynamically import the wallet button with SSR disabled to prevent hydration errors
const WalletMultiButton = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { 
    ssr: false, 
    loading: () => (
      <button className="px-4 py-2 rounded-lg bg-aegix-surface border border-aegix-border text-aegix-muted text-sm">
        Loading...
      </button>
    )
  }
);

export function ClientWalletButton() {
  return <WalletMultiButton />;
}

