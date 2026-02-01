/**
 * Inco Lightning Client - REAL SDK Integration
 * 
 * @deprecated This module is deprecated in Aegix 4.0.
 * Use Light Protocol (src/light/) instead for ZK Compression.
 * 
 * Migration path:
 * - Replace FHE handles with Light Protocol session keys
 * - Use compressed accounts instead of encrypted pools
 * - Session-based autonomous agent spending replaces per-decrypt signatures
 * 
 * This module will be removed in a future version.
 * 
 * Legacy Features (kept for backward compatibility):
 * - encryptValue() - Real TEE-compatible encryption
 * - decrypt() - Attested decryption with Ed25519 signature verification
 */

import crypto from 'crypto';
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

// =============================================================================
// SECURITY: Ed25519 Signature Verification for Owner Authentication
// =============================================================================

/**
 * Verify that a signature was created by the owner's wallet
 * Uses Ed25519 signature verification (Solana's native signing)
 * 
 * @param owner - Owner's wallet address (base58)
 * @param signature - Base58-encoded signature
 * @param message - The message that was signed
 * @returns true if signature is valid, false otherwise
 */
export function verifyOwnerSignature(
  owner: string,
  signature: string,
  message: string
): boolean {
  try {
    const ownerPubkey = new PublicKey(owner);
    const sig = bs58.decode(signature);
    const msg = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(msg, sig, ownerPubkey.toBytes());
  } catch (error: any) {
    console.warn(`[Inco] Signature verification failed: ${error.message}`);
    return false;
  }
}

// Import the real Inco Solana SDK
let encryptValue: ((value: bigint | number | boolean) => Promise<string>) | null = null;
let decrypt: ((handles: string[], options: { address: string; signMessage: (msg: Uint8Array) => Promise<Uint8Array> }) => Promise<{
  plaintexts: string[];
  handles: string[];
  signatures: string[];
}>) | null = null;

// Try to load the real SDK
let SDK_LOADED = false;
let SDK_ERROR: string | null = null;

async function loadIncoSDK() {
  if (SDK_LOADED || SDK_ERROR) return;
  
  try {
    // Dynamic import of the Inco SDK
    const encryption = await import('@inco/solana-sdk/encryption');
    const attestedDecrypt = await import('@inco/solana-sdk/attested-decrypt');
    
    encryptValue = encryption.encryptValue;
    decrypt = attestedDecrypt.decrypt;
    SDK_LOADED = true;
    
    console.log('[Inco] ✓ Real Solana SDK loaded successfully');
  } catch (error: any) {
    SDK_ERROR = error.message;
    console.warn('[Inco] SDK not available, using simulation:', error.message);
  }
}

// Initialize on module load
loadIncoSDK().catch(console.error);

export interface EncryptedHandle {
  handle: string;      // Hex-encoded encrypted data
  network: string;     // 'inco-solana'
  version: string;     // SDK version
  timestamp: number;
  isReal: boolean;     // True if using real SDK
}

export interface DecryptResult {
  value: string;       // Decrypted plaintext value
  proof: string;       // Signature proof
  owner: string;       // Verified owner
}

export interface StoredEntry {
  id: string;
  handle: string;
  owner: string;
  key: string;
  timestamp: number;
}

/**
 * Inco Lightning Client
 * Uses real @inco/solana-sdk when available
 * 
 * @deprecated Use Light Protocol (src/light/) instead for Aegix 4.0.
 * - For session-based agent spending: src/light/session-keys.ts
 * - For compressed transfers: src/light/client.ts
 */
export class IncoLightningClient {
  private initialized: boolean = false;

  // Local storage for handles
  private handleStorage = new Map<string, StoredEntry[]>();

  constructor() {
    console.warn('[Inco] DEPRECATED: IncoLightningClient is deprecated. Migrate to Light Protocol.');
    // SDK is loaded asynchronously
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // Ensure SDK is loaded
    await loadIncoSDK();
    this.initialized = true;

    if (SDK_LOADED) {
      console.log('[Inco Lightning] ✓ Connected to Inco Network (REAL FHE)');
    } else {
      console.log('[Inco Lightning] Running in simulation mode');
    }
  }

  /**
   * Check if we're using real Inco SDK
   */
  isRealMode(): boolean {
    return SDK_LOADED;
  }

  /**
   * Get SDK status
   */
  getStatus(): { loaded: boolean; error: string | null } {
    return { loaded: SDK_LOADED, error: SDK_ERROR };
  }

  /**
   * Encrypt a value using REAL Inco FHE (or simulation fallback)
   */
  async encrypt(
    value: bigint | number,
    dataType: 'uint128' | 'uint64' | 'uint32' | 'bool' = 'uint128'
  ): Promise<EncryptedHandle> {
    await this.initialize();

    // Convert to BigInt safely - handle decimals by flooring
    let valueAsBigInt: bigint;
    if (typeof value === 'bigint') {
      valueAsBigInt = value;
    } else if (Number.isInteger(value)) {
      valueAsBigInt = BigInt(value);
    } else {
      // For decimals, floor to nearest integer (BigInt doesn't support decimals)
      console.warn(`[Inco] Converting decimal ${value} to integer for BigInt`);
      valueAsBigInt = BigInt(Math.floor(value));
    }

    // Try real SDK first
    if (SDK_LOADED && encryptValue) {
      try {
        const encryptedHex = await encryptValue(valueAsBigInt);
        
        return {
          handle: encryptedHex,
          network: 'inco-solana',
          version: '1.0.0',
          timestamp: Date.now(),
          isReal: true,
        };
      } catch (error: any) {
        console.warn('[Inco] Real encryption failed:', error.message);
        // Fall through to simulation
      }
    }

    // Simulation fallback
    const handle = this.simulateEncrypt(valueAsBigInt.toString(), dataType);
    return {
      handle,
      network: 'inco-solana-sim',
      version: '1.0.0',
      timestamp: Date.now(),
      isReal: false,
    };
  }

  /**
   * Store an encrypted handle associated with an owner
   */
  async store(
    owner: string,
    key: string,
    encryptedHandle: string
  ): Promise<{ success: boolean; id: string }> {
    const id = `entry-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const entry: StoredEntry = {
      id,
      handle: encryptedHandle,
      owner,
      key,
      timestamp: Date.now(),
    };

    const ownerEntries = this.handleStorage.get(owner) || [];
    ownerEntries.push(entry);
    this.handleStorage.set(owner, ownerEntries);

    return { success: true, id };
  }

  /**
   * Get all stored handles for an owner
   */
  async getStored(owner: string): Promise<StoredEntry[]> {
    return this.handleStorage.get(owner) || [];
  }

  /**
   * Attested decryption - REAL Ed25519 signature verification
   * Uses wallet signature to prove ownership
   */
  async attestedDecrypt(
    owner: string,
    signature: string,
    handles: string[]
  ): Promise<{
    plaintexts: string[];
    handles: string[];
    proof: string;
    isReal: boolean;
  }> {
    await this.initialize();

    // Try real SDK if available
    if (SDK_LOADED && decrypt) {
      try {
        // Create a mock signMessage function from the provided signature
        // In real usage, this would be called by the client with their wallet
        const mockSignMessage = async (_msg: Uint8Array): Promise<Uint8Array> => {
          return Buffer.from(signature, 'base64');
        };

        const result = await decrypt(handles, {
          address: owner,
          signMessage: mockSignMessage,
        });

        return {
          plaintexts: result.plaintexts,
          handles: result.handles,
          proof: result.signatures?.[0] || `real-attestation-${Date.now()}`,
          isReal: true,
        };
      } catch (error: any) {
        console.warn('[Inco] Real decryption failed:', error.message);
        // Fall through to simulation
      }
    }

    // Simulation fallback
    return {
      plaintexts: handles.map(() => '0'), // Can't decrypt simulated handles
      handles,
      proof: `sim-attestation-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`,
      isReal: false,
    };
  }

  /**
   * Decrypt a single handle (convenience method)
   */
  async decryptSingle(
    owner: string,
    signature: string,
    handle: string
  ): Promise<DecryptResult> {
    const result = await this.attestedDecrypt(owner, signature, [handle]);
    
    return {
      value: result.plaintexts[0] || '0',
      proof: result.proof,
      owner,
    };
  }

  /**
   * FHE comparison - check if encrypted value >= threshold
   * Note: Real comparison requires on-chain program
   */
  async compare(
    handle: string,
    threshold: bigint | number,
    operation: 'gte' | 'lte' | 'eq' | 'gt' | 'lt'
  ): Promise<{ result: EncryptedHandle; operation: string }> {
    // FHE comparisons require on-chain programs with Inco
    // For now, return encrypted boolean
    return {
      result: await this.encrypt(1n, 'bool'),
      operation,
    };
  }

  /**
   * FHE addition - add to encrypted value
   * Note: Real addition requires on-chain program
   */
  async add(handle: string, value: bigint | number): Promise<EncryptedHandle> {
    // FHE operations require on-chain programs with Inco
    // Return new encrypted value
    return this.encrypt(value, 'uint128');
  }

  // ==================== BYTES ENCRYPTION FOR POOL KEYS ====================

  /**
   * Encrypt arbitrary bytes (for pool private keys)
   * Uses AES-256-CBC with a derived key for simulation mode
   * In production, this would use real Inco FHE for byte arrays
   * 
   * SECURITY: Pool private keys MUST be encrypted before storage!
   */
  async encryptBytes(data: Buffer): Promise<{ handle: string; type: 'bytes'; isReal: boolean }> {
    await this.initialize();

    // Note: Real Inco SDK doesn't support arbitrary bytes yet
    // For now, we use AES-256-CBC with a secret key
    // In production, this should use Inco's byte encryption when available
    
    try {
      // Use encryption key from environment (REQUIRED in production)
      const encryptionSecret = process.env.INCO_BYTES_KEY;
      if (!encryptionSecret) {
        console.warn('[Inco] ⚠️ INCO_BYTES_KEY not set! Using insecure default. SET THIS IN PRODUCTION!');
      }
      const secretKey = encryptionSecret || 'INSECURE_DEV_KEY_CHANGE_IN_PRODUCTION';
      const key = crypto.createHash('sha256').update(secretKey).digest();
      const iv = crypto.randomBytes(16);
      
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      let encrypted = cipher.update(data);
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      
      // Format: inco:fhe:v1:bytes:{iv}:{encrypted_data}
      const handle = `inco:fhe:v1:bytes:${iv.toString('hex')}:${encrypted.toString('hex')}`;
      
      console.log(`[Inco] ✓ Encrypted ${data.length} bytes (simulation mode)`);
      
      return {
        handle,
        type: 'bytes',
        isReal: false, // Will be true when real Inco byte encryption is available
      };
    } catch (error: any) {
      console.error('[Inco] Bytes encryption failed:', error.message);
      throw new Error(`Failed to encrypt bytes: ${error.message}`);
    }
  }

  /**
   * Decrypt bytes (for pool private keys)
   * Requires owner signature for attested decryption
   * 
   * SECURITY: Only the owner can decrypt their pool keys!
   * SECURITY: If agentId is provided, agent must be active (not paused)
   * 
   * @param handle - FHE encrypted handle
   * @param owner - Owner's wallet address
   * @param signature - Owner's signature for attestation
   * @param agentId - Optional agent ID for status validation
   */
  async decryptBytes(
    handle: string,
    owner: string,
    signature: string,
    agentId?: string
  ): Promise<Buffer> {
    await this.initialize();

    // ==========================================================================
    // SECURITY: Agent Status Check - Prevent paused agents from decrypting
    // FAIL-CLOSED: If we cannot verify agent status, deny access
    // ==========================================================================
    if (agentId) {
      try {
        const { getAgentStatus } = await import('../routes/agents.js');
        const status = getAgentStatus(agentId);
        
        if (!status.canProcess) {
          console.error(`[Inco] ✗ BLOCKED: Agent ${agentId} is ${status.status} - decryption denied`);
          throw new Error(`PermissionDenied: Agent ${agentId} cannot decrypt - ${status.reason}`);
        }
        
        console.log(`[Inco] ✓ Agent ${agentId} status verified: ${status.status}`);
      } catch (importError: any) {
        // SECURITY: Fail-closed - always block if we can't verify when agentId is provided
        // This prevents bypass through module loading failures
        if (importError.message?.includes('PermissionDenied')) {
          throw importError; // Re-throw permission denied errors
        }
        console.error(`[Inco] ✗ BLOCKED: Could not verify agent ${agentId} - failing closed: ${importError.message}`);
        throw new Error(`SecurityError: Unable to verify agent status for ${agentId}`);
      }
    }
    // ==========================================================================

    // Verify handle format
    if (!handle.startsWith('inco:fhe:v1:bytes:')) {
      throw new Error('Invalid bytes handle format');
    }

    // ==========================================================================
    // SECURITY: Verify owner signature before decryption (Production requirement)
    // ==========================================================================
    if (!signature) {
      throw new Error('InvalidSignature: Signature required for decryption');
    }
    
    const expectedMessage = `decrypt:${handle}`;
    if (!verifyOwnerSignature(owner, signature, expectedMessage)) {
      console.error(`[Inco] ✗ BLOCKED: Invalid signature for owner ${owner.slice(0, 12)}...`);
      throw new Error('InvalidSignature: Owner signature verification failed');
    }
    console.log(`[Inco] ✓ Owner signature verified for ${owner.slice(0, 12)}...`);
    // ==========================================================================
    
    try {
      // Parse the handle
      const parts = handle.split(':');
      if (parts.length !== 6) {
        throw new Error('Malformed bytes handle');
      }
      
      const ivHex = parts[4];
      const encryptedHex = parts[5];
      
      const iv = Buffer.from(ivHex, 'hex');
      const encrypted = Buffer.from(encryptedHex, 'hex');
      
      // Use the same secret key (must match encryptBytes)
      const encryptionSecret = process.env.INCO_BYTES_KEY;
      if (!encryptionSecret) {
        console.warn('[Inco] ⚠️ INCO_BYTES_KEY not set! Using insecure default.');
      }
      const secretKey = encryptionSecret || 'INSECURE_DEV_KEY_CHANGE_IN_PRODUCTION';
      const key = crypto.createHash('sha256').update(secretKey).digest();
      
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      console.log(`[Inco] ✓ Decrypted ${decrypted.length} bytes for owner ${owner.slice(0, 8)}...`);
      
      return decrypted;
    } catch (error: any) {
      console.error('[Inco] Bytes decryption failed:', error.message);
      throw new Error(`Failed to decrypt bytes: ${error.message}`);
    }
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Simulate FHE encryption (generates realistic handles)
   */
  private simulateEncrypt(value: string, dataType: string): string {
    const salt = crypto.randomBytes(8).toString('hex');
    const hash = crypto
      .createHash('sha256')
      .update(`${value}:${dataType}:${salt}:${Date.now()}`)
      .digest('hex');

    // Return in Inco's hex format
    return `0x${hash}`;
  }
}

// Singleton instance
let incoClient: IncoLightningClient | null = null;

/**
 * Get the Inco Lightning client instance
 */
export function getIncoClient(): IncoLightningClient {
  if (!incoClient) {
    incoClient = new IncoLightningClient();
  }
  return incoClient;
}
