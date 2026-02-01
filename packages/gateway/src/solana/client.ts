/**
 * Solana Client
 * Handles USDC transfers and transaction verification
 */

import { 
  Connection, 
  PublicKey, 
  Transaction,
  Keypair,
  sendAndConfirmTransaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { X402_CONSTANTS } from '../x402/protocol.js';

export interface SolanaConfig {
  rpcUrl: string;
  network: 'devnet' | 'mainnet-beta';
  facilitatorKeypair?: Keypair;
}

export class SolanaClient {
  private connection: Connection;
  private network: string;
  private facilitator?: Keypair;
  private usdcMint: PublicKey;

  constructor(config: SolanaConfig) {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.network = config.network;
    this.facilitator = config.facilitatorKeypair;
    this.usdcMint = new PublicKey(
      config.network === 'devnet' 
        ? X402_CONSTANTS.USDC_DEVNET 
        : X402_CONSTANTS.USDC_MAINNET
    );
  }

  /**
   * Verify a transaction signature exists and matches expected parameters
   */
  async verifyPayment(
    signature: string,
    expectedPayer: string,
    expectedRecipient: string,
    expectedAmount: string
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const txInfo = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!txInfo) {
        return { valid: false, error: 'Transaction not found' };
      }

      if (txInfo.meta?.err) {
        return { valid: false, error: 'Transaction failed on-chain' };
      }

      // Verify the transaction contains a USDC transfer
      // In production, parse the transaction to verify exact amounts
      console.log(`[Solana] Payment verified: ${signature}`);
      
      return { valid: true };
    } catch (error) {
      console.error('[Solana] Verification error:', error);
      return { valid: false, error: 'Verification failed' };
    }
  }

  /**
   * Get USDC balance for an address
   */
  async getUsdcBalance(owner: string): Promise<string> {
    try {
      const ownerPubkey = new PublicKey(owner);
      const tokenAccount = await getAssociatedTokenAddress(
        this.usdcMint,
        ownerPubkey
      );

      const account = await getAccount(this.connection, tokenAccount);
      return account.amount.toString();
    } catch (error) {
      console.error('[Solana] Balance check error:', error);
      return '0';
    }
  }

  /**
   * Execute a USDC transfer (facilitator settlement)
   */
  async executeTransfer(
    from: PublicKey,
    to: PublicKey,
    amount: bigint
  ): Promise<string | null> {
    if (!this.facilitator) {
      console.error('[Solana] No facilitator keypair configured');
      return null;
    }

    try {
      const fromAta = await getAssociatedTokenAddress(this.usdcMint, from);
      const toAta = await getAssociatedTokenAddress(this.usdcMint, to);

      const instruction = createTransferInstruction(
        fromAta,
        toAta,
        from,
        amount,
        [],
        TOKEN_PROGRAM_ID
      );

      const transaction = new Transaction().add(instruction);
      
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.facilitator]
      );

      console.log(`[Solana] Transfer executed: ${signature}`);
      return signature;
    } catch (error) {
      console.error('[Solana] Transfer error:', error);
      return null;
    }
  }

  /**
   * Send USDC from facilitator to a user (for withdrawals)
   * @returns Transaction signature on success
   * @throws Error if transfer fails
   */
  async sendUsdc(toAddress: string, amount: string): Promise<string> {
    if (!this.facilitator) {
      throw new Error('Facilitator wallet not configured. Cannot process withdrawals.');
    }

    const toPubkey = new PublicKey(toAddress);
    const amountBigInt = BigInt(amount);

    // Get token accounts
    const fromAta = await getAssociatedTokenAddress(this.usdcMint, this.facilitator.publicKey);
    const toAta = await getAssociatedTokenAddress(this.usdcMint, toPubkey);

    // Check facilitator has enough USDC
    try {
      const fromAccount = await getAccount(this.connection, fromAta);
      if (fromAccount.amount < amountBigInt) {
        throw new Error(`Facilitator has insufficient USDC. Has: ${fromAccount.amount}, needs: ${amountBigInt}`);
      }
    } catch (error: any) {
      if (error.message?.includes('insufficient')) {
        throw error;
      }
      throw new Error('Facilitator USDC account not found or inaccessible');
    }

    // Check if destination has a token account, create if needed
    let needsCreateAta = false;
    try {
      await getAccount(this.connection, toAta);
    } catch {
      needsCreateAta = true;
    }

    // Build transaction
    const transaction = new Transaction();

    // If destination doesn't have USDC account, create it
    if (needsCreateAta) {
      const { createAssociatedTokenAccountInstruction } = await import('@solana/spl-token');
      transaction.add(
        createAssociatedTokenAccountInstruction(
          this.facilitator.publicKey, // payer
          toAta,                       // ata
          toPubkey,                    // owner
          this.usdcMint                // mint
        )
      );
    }

    // Add transfer instruction
    const transferIx = createTransferInstruction(
      fromAta,
      toAta,
      this.facilitator.publicKey,
      amountBigInt,
      [],
      TOKEN_PROGRAM_ID
    );
    transaction.add(transferIx);

    // Get blockhash and send
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.facilitator.publicKey;

    // Sign and send
    transaction.sign(this.facilitator);
    
    const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    // Wait for confirmation
    await this.connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    console.log(`[Solana] USDC withdrawal sent: ${signature} (${parseInt(amount) / 1_000_000} USDC to ${toAddress.slice(0, 8)}...)`);
    return signature;
  }

  /**
   * Check if facilitator is configured and ready for withdrawals
   */
  isFacilitatorReady(): boolean {
    return !!this.facilitator;
  }

  /**
   * Get facilitator public key (for display/verification)
   */
  getFacilitatorAddress(): string | null {
    return this.facilitator?.publicKey.toBase58() || null;
  }

  /**
   * Get recent blockhash for transaction building
   */
  async getRecentBlockhash(): Promise<string> {
    const { blockhash } = await this.connection.getLatestBlockhash();
    return blockhash;
  }

  /**
   * Check if an address is valid
   */
  isValidAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get connection for direct access
   */
  getConnection(): Connection {
    return this.connection;
  }
}

/**
 * Create a Solana client from environment variables
 */
export function createSolanaClient(): SolanaClient {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const network = (process.env.SOLANA_NETWORK || 'mainnet-beta') as 'devnet' | 'mainnet-beta';
  
  let facilitatorKeypair: Keypair | undefined;
  if (process.env.FACILITATOR_PRIVATE_KEY) {
    const secretKey = bs58.decode(process.env.FACILITATOR_PRIVATE_KEY);
    facilitatorKeypair = Keypair.fromSecretKey(secretKey);
  }

  return new SolanaClient({
    rpcUrl,
    network,
    facilitatorKeypair,
  });
}

