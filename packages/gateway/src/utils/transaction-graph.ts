import { Connection, ParsedTransactionWithMeta, ParsedInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

export interface GraphNode {
  id: string;
  type: 'signer' | 'account' | 'asset' | 'program';
  label: string;
  address: string;
  truncated?: string;
  data?: {
    amount?: string;
    token?: string;
    programId?: string;
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'transfer' | 'sign' | 'instruction';
  label?: string;
  data?: {
    amount?: string;
    token?: string;
    instruction?: string;
  };
}

export interface TransactionGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    signature: string;
    timestamp?: number;
    fee?: number;
    status: 'success' | 'pending' | 'failed';
  };
}

/**
 * Retry a function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a rate limit error (429)
      const isRateLimit = error?.message?.includes('429') || 
                         error?.code === 429 ||
                         error?.response?.status === 429;
      
      // Check if it's a network error that might succeed on retry
      const isRetryable = isRateLimit || 
                         error?.message?.includes('timeout') ||
                         error?.message?.includes('ECONNRESET') ||
                         error?.message?.includes('ETIMEDOUT');
      
      // Don't retry on the last attempt or if error is not retryable
      if (attempt === maxRetries || !isRetryable) {
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const delay = initialDelay * Math.pow(2, attempt);
      console.log(`[TransactionGraph] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms (${error.message?.slice(0, 50)})`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Parse a Solana transaction into a graph structure
 */
export async function parseTransactionGraph(
  connection: Connection,
  signature: string
): Promise<TransactionGraph | null> {
  try {
    // Use retry logic for RPC call
    const tx = await retryWithBackoff(async () => {
      return await connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
    }, 3, 1000); // 3 retries, 1s initial delay

    if (!tx) {
      console.warn(`[TransactionGraph] Transaction ${signature.slice(0, 8)}... not found`);
      return null;
    }

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();

    // Get transaction metadata
    const metadata: TransactionGraph['metadata'] = {
      signature,
      timestamp: tx.blockTime ? tx.blockTime * 1000 : undefined,
      fee: tx.meta?.fee,
      status: tx.meta?.err ? 'failed' : 'success',
    };

    // SAFELY Extract signers - handle both parsed and unparsed formats
    let signers: string[] = [];
    
    // Check if transaction structure exists
    if (tx.transaction && tx.transaction.message) {
      const accountKeys = tx.transaction.message.accountKeys || [];
      const header = tx.transaction.message.header;
      
      // SAFELY get numRequiredSignatures - check if header exists
      const numRequiredSignatures = header?.numRequiredSignatures || 0;
      
      // Extract signers safely
      signers = accountKeys
        .filter((key, index) => {
          // Check if key exists and has signer property
          if (!key) return false;
          const isSigner = key.signer || index < numRequiredSignatures;
          return isSigner;
        })
        .map((key) => {
          // Safely get pubkey - handle both object and string
          if (typeof key === 'string') return key;
          if (key.pubkey) {
            return typeof key.pubkey === 'string' ? key.pubkey : key.pubkey.toString();
          }
          return '';
        })
        .filter((addr) => addr.length > 0);
    } else {
      // Fallback: try to get signers from meta if available
      console.warn('[TransactionGraph] Transaction message structure not found, using fallback');
      if (tx.meta?.err) {
        // Transaction failed - return minimal graph
        return {
          nodes: [],
          edges: [],
          metadata: {
            ...metadata,
            status: 'failed',
          },
        };
      }
    }

    // Add signer nodes
    signers.forEach((signer, index) => {
      const nodeId = `signer-${signer}`;
      if (!nodeIds.has(nodeId) && signer) {
        nodes.push({
          id: nodeId,
          type: 'signer',
          label: index === 0 ? 'Fee Payer' : `Signer ${index + 1}`,
          address: signer,
          truncated: `${signer.slice(0, 8)}...${signer.slice(-8)}`,
        });
        nodeIds.add(nodeId);
      }
    });

    // SAFELY Parse instructions to find transfers
    const instructions = tx.transaction?.message?.instructions || [];
    let transferCount = 0;

    instructions.forEach((ix, index) => {
      // Safely check if instruction is parsed
      if (!ix || typeof ix !== 'object') return;
      
      const parsedIx = ix as ParsedInstruction;
      
      // Handle Token Program transfers - check programId safely
      const programId = parsedIx.programId;
      if (!programId) return;
      
      const programIdStr = typeof programId === 'string' 
        ? programId 
        : programId.toString();
      
      if (programIdStr === TOKEN_PROGRAM_ID.toString() && parsedIx.parsed) {
        const parsed = parsedIx.parsed as any;
        
        if (parsed.type === 'transfer' || parsed.type === 'transferChecked') {
          transferCount++;
          
          const source = parsed.type === 'transfer' 
            ? parsed.source 
            : parsed.account;
          const destination = parsed.type === 'transfer'
            ? parsed.destination
            : parsed.destination;
          const amount = parsed.type === 'transferChecked'
            ? parsed.tokenAmount?.uiAmount
            : parsed.uiAmount;
          const mint = parsed.type === 'transferChecked' 
            ? parsed.mint 
            : undefined;

          // Validate we have source and destination
          if (!source || !destination) {
            console.warn('[TransactionGraph] Transfer missing source or destination');
            return;
          }

          // Add source account node
          const sourceNodeId = `account-${source}`;
          if (!nodeIds.has(sourceNodeId)) {
            nodes.push({
              id: sourceNodeId,
              type: 'account',
              label: 'Source',
              address: source,
              truncated: `${source.slice(0, 8)}...${source.slice(-8)}`,
            });
            nodeIds.add(sourceNodeId);
          }

          // Add destination account node
          const destNodeId = `account-${destination}`;
          if (!nodeIds.has(destNodeId)) {
            nodes.push({
              id: destNodeId,
              type: 'account',
              label: 'Destination',
              address: destination,
              truncated: `${destination.slice(0, 8)}...${destination.slice(-8)}`,
            });
            nodeIds.add(destNodeId);
          }

          // Add asset node (USDC amount)
          const assetNodeId = `asset-${transferCount}`;
          if (!nodeIds.has(assetNodeId)) {
            nodes.push({
              id: assetNodeId,
              type: 'asset',
              label: `${amount || '0'} ${mint ? 'USDC' : 'Token'}`,
              address: mint || 'unknown',
              data: {
                amount: amount?.toString(),
                token: mint || 'USDC',
              },
            });
            nodeIds.add(assetNodeId);
          }

          // Add edges: source → asset → destination
          edges.push({
            id: `edge-${index}-1`,
            source: sourceNodeId,
            target: assetNodeId,
            type: 'transfer',
            label: 'Send',
            data: {
              amount: amount?.toString(),
              token: mint || 'USDC',
            },
          });

          edges.push({
            id: `edge-${index}-2`,
            source: assetNodeId,
            target: destNodeId,
            type: 'transfer',
            label: 'Receive',
            data: {
              amount: amount?.toString(),
              token: mint || 'USDC',
            },
          });
        }
      }
    });

    // If we have no nodes but transaction exists, create minimal graph
    if (nodes.length === 0 && tx) {
      return {
        nodes: [{
          id: 'tx-node',
          type: 'account',
          label: 'Transaction',
          address: signature,
          truncated: `${signature.slice(0, 8)}...${signature.slice(-8)}`,
        }],
        edges: [],
        metadata,
      };
    }

    return {
      nodes,
      edges,
      metadata,
    };
  } catch (error: any) {
    console.error('[TransactionGraph] Parse error:', error);
    
    // Check for specific error types
    if (error?.message?.includes('429') || error?.code === 429) {
      throw new Error('RPC_RATE_LIMITED: Too many requests. Please try again in a few seconds.');
    }
    
    if (error?.message?.includes('not found')) {
      throw new Error('TRANSACTION_NOT_FOUND: Transaction may not exist or is not yet confirmed.');
    }
    
    // Re-throw with more context
    throw new Error(`TRANSACTION_PARSE_ERROR: ${error.message || 'Unknown error'}`);
  }
}

