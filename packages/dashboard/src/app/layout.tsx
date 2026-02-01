import type { Metadata } from 'next';
import { WalletProviders } from '@/components/WalletProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Aegix | Privacy-First Agent Payment Gateway',
  description: 'Control your AI agents with confidential credits on Solana',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-aegix-void noise">
        <WalletProviders>
          {/* Background effects */}
          <div className="fixed inset-0 bg-grid-pattern bg-grid opacity-30 pointer-events-none" />
          <div className="fixed inset-0 bg-glow-cyan pointer-events-none" />
          <div className="fixed bottom-0 right-0 w-1/2 h-1/2 bg-glow-magenta pointer-events-none" />
          
          {/* Main content */}
          <div className="relative z-10">
            {children}
          </div>
        </WalletProviders>
      </body>
    </html>
  );
}

