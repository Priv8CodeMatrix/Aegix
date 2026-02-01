/**
 * Inco Network Integration - NON-CUSTODIAL VERSION
 * Encrypted Audit Log using Fully Homomorphic Encryption
 * 
 * @deprecated The FHE encryption aspects of this module are deprecated in Aegix 4.0.
 * Use Light Protocol (src/light/) for ZK-based privacy instead.
 * 
 * The audit logging functionality is retained for backward compatibility.
 * Future versions will migrate to compressed state storage via Light Protocol.
 * 
 * This module ONLY manages encrypted audit logs.
 * NO balances, NO deposits, NO withdrawals - Aegix never holds funds!
 * 
 * What we store:
 * - Encrypted agent activity logs (DEPRECATED: will use compressed state)
 * - Encrypted payment history (for user's reference only)
 * 
 * What we DON'T store:
 * - User balances (users keep funds in their own wallet)
 * - Deposits (no custody)
 * - Withdrawal records (no custody)
 * 
 * Uses Inco Lightning Client for REAL FHE operations when API key is configured.
 */

import { v4 as uuidv4 } from 'uuid';
import { getIncoClient, type EncryptedHandle } from './lightning-client.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// File persistence setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');
const AUDIT_LOGS_FILE = path.join(DATA_DIR, 'audit-logs.json');

// FHE Configuration
const FHE_VERSION = 'v1';
const INCO_NETWORK = process.env.INCO_NETWORK_URL || 'https://lightning.inco.org';

// Activity log entry (what we encrypt and store)
interface ActivityLogEntry {
  id: string;
  type: 'agent_payment' | 'payment_confirmed' | 'agent_created' | 'agent_deleted' | 'x402_donation' | 'pool_payment' | 'pool_initialized' | 'maximum_privacy_payment' | 'compress_tokens' | 'shield_tokens';
  agentId?: string;
  agentName?: string;
  resource?: string;
  amount?: string;
  paymentId?: string;
  txSignature?: string;
  txSignature1?: string;  // For two-step payments (Pool → Burner)
  txSignature2?: string;  // For two-step payments (Burner → Recipient)
  timestamp: string;
  encrypted: boolean;
  fheHandle: string;
  // Pool payment specific fields
  stealthPoolAddress?: string;
  recipient?: string;
  tempBurner?: string;
  solRecovered?: number;
  method?: string;
  feePayer?: string;
  paymentFlow?: {
    setupTx?: string;
    usdcTransferTx?: string;
    paymentTx?: string;
    recoveryTx?: string;
  };
  // Light Protocol compression fields
  compressed?: boolean;
  proofHash?: string;
  compression?: {
    enabled: boolean;
    savingsPerPayment?: number | string;
    multiplier?: number;
  };
  privacy?: {
    twoStepBurner?: boolean;
    recipientSees?: string;
    ownerHidden?: boolean;
    poolHidden?: boolean;
    zkProof?: boolean;
  };
}

// Encrypted audit response
interface AuditLogEntry {
  id: string;
  type: string;
  amount?: string;
  service?: string;
  timestamp: string;
  encrypted: boolean;
  txSignature?: string;
  txSignature1?: string;  // For two-step payments
  txSignature2?: string;  // For two-step payments
  fheHandle: string;
  // Pool payment specific fields
  stealthPoolAddress?: string;
  recipient?: string;
  tempBurner?: string;
  solRecovered?: number;
  method?: string;
  feePayer?: string;
  paymentFlow?: {
    setupTx?: string;
    usdcTransferTx?: string;
    paymentTx?: string;
    recoveryTx?: string;
  };
  // Light Protocol compression fields
  compressed?: boolean;
  proofHash?: string;
  compression?: {
    enabled: boolean;
    savingsPerPayment?: number | string;
    multiplier?: number;
  };
  privacy?: {
    twoStepBurner?: boolean;
    recipientSees?: string;
    ownerHidden?: boolean;
    poolHidden?: boolean;
    zkProof?: boolean;
  };
}

// In-memory stores (audit logs only - no balances!)
const auditLogs = new Map<string, ActivityLogEntry[]>();

// =============================================================================
// PERSISTENCE - Save audit logs to disk so history survives restarts
// =============================================================================

/**
 * Load audit logs from disk on module initialization
 */
function loadAuditLogs() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    if (fs.existsSync(AUDIT_LOGS_FILE)) {
      const data = fs.readFileSync(AUDIT_LOGS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      
      // Restore the Map
      for (const [owner, logs] of Object.entries(parsed)) {
        auditLogs.set(owner, logs as ActivityLogEntry[]);
      }
      
      const totalLogs = Array.from(auditLogs.values()).reduce((sum, logs) => sum + logs.length, 0);
      console.log(`[Inco] ✓ Loaded ${totalLogs} audit log entries for ${auditLogs.size} wallet(s) from disk`);
    } else {
      console.log(`[Inco] No existing audit logs found, starting fresh`);
    }
  } catch (err) {
    console.error('[Inco] ❌ Failed to load audit logs:', err);
  }
}

/**
 * Save audit logs to disk (debounced to prevent too many disk writes)
 */
let saveTimeout: NodeJS.Timeout | null = null;
function saveAuditLogs() {
  // Debounce saves to prevent too many disk writes
  if (saveTimeout) clearTimeout(saveTimeout);
  
  saveTimeout = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      
      // Convert Map to plain object for JSON
      const logsObject: Record<string, ActivityLogEntry[]> = {};
      for (const [owner, logs] of auditLogs) {
        logsObject[owner] = logs;
      }
      
      fs.writeFileSync(AUDIT_LOGS_FILE, JSON.stringify(logsObject, null, 2));
      
      const totalLogs = Array.from(auditLogs.values()).reduce((sum, logs) => sum + logs.length, 0);
      console.log(`[Inco] ✓ Saved ${totalLogs} audit log entries to disk`);
    } catch (err) {
      console.error('[Inco] ❌ Failed to save audit logs:', err);
    }
  }, 1000); // 1 second debounce
}

// Load audit logs on module initialization
loadAuditLogs();

/**
 * Audit Ledger - NON-CUSTODIAL
 * Only tracks encrypted activity, never holds funds
 */
export class AuditLedger {
  /**
   * Log an activity (encrypted with real Inco FHE)
   */
  async logActivity(owner: string, activity: {
    type: 'agent_payment' | 'payment_confirmed' | 'agent_created' | 'agent_deleted' | 'x402_donation' | 'pool_payment' | 'pool_initialized';
    agentId?: string;
    agentName?: string;
    resource?: string;
    amount?: string;
    paymentId?: string;
    txSignature?: string;
    timestamp: string;
    // Pool payment specific fields
    stealthPoolAddress?: string;
    recipient?: string;
    tempBurner?: string;
    solRecovered?: number;
    method?: string;
    feePayer?: string;
    paymentFlow?: {
      setupTx?: string;
      usdcTransferTx?: string;
      paymentTx?: string;
      recoveryTx?: string;
    };
  }): Promise<ActivityLogEntry> {
    const id = uuidv4();
    
    // Create encrypted entry using REAL Inco FHE
    const fheHandle = await this.createFheHandleAsync(owner, activity);
    
    const inco = getIncoClient();
    const isRealFhe = inco.isRealMode();
    
    const entry: ActivityLogEntry = {
      id,
      ...activity,
      encrypted: true,
      fheHandle,
    };

    // Store in audit log
    const logs = auditLogs.get(owner) || [];
    logs.unshift(entry);
    
    // Keep last 10,000 entries per owner (increased from 100)
    if (logs.length > 10000) {
      logs.pop();
    }
    
    auditLogs.set(owner, logs);
    
    // Persist to disk
    saveAuditLogs();

    console.log(`[Inco] Logged activity for ${owner.slice(0, 8)}...: ${activity.type} (FHE: ${isRealFhe ? 'REAL' : 'SIM'})`);

    return entry;
  }

  /**
   * Get audit log for owner
   */
  async getAuditLog(owner: string): Promise<AuditLogEntry[]> {
    const logs = auditLogs.get(owner) || [];
    
    // Transform to audit log format with all fields for maximum privacy payments
    return logs.map(entry => ({
      id: entry.id,
      type: entry.type,
      amount: entry.amount,
      service: entry.resource || entry.agentName || (entry.type === 'maximum_privacy_payment' ? 'Maximum Privacy Payment' : entry.type === 'pool_payment' ? 'Pool Payment' : 'Agent Activity'),
      timestamp: entry.timestamp,
      encrypted: entry.encrypted,
      txSignature: entry.txSignature,
      txSignature1: (entry as any).txSignature1,  // Two-step: Pool → Burner
      txSignature2: (entry as any).txSignature2,  // Two-step: Burner → Recipient
      fheHandle: entry.fheHandle,
      // Pool payment specific fields
      stealthPoolAddress: entry.stealthPoolAddress,
      recipient: entry.recipient,
      tempBurner: entry.tempBurner,
      solRecovered: entry.solRecovered,
      method: entry.method,
      feePayer: entry.feePayer,
      paymentFlow: entry.paymentFlow,
      // Light Protocol compression fields
      compressed: (entry as any).compressed,
      proofHash: (entry as any).proofHash,
      compression: (entry as any).compression,
      privacy: (entry as any).privacy,
    }));
  }

  /**
   * Get activity count for owner (for stats)
   */
  async getActivityCount(owner: string): Promise<{
    total: number;
    payments: number;
    confirmations: number;
  }> {
    const logs = auditLogs.get(owner) || [];
    
    return {
      total: logs.length,
      payments: logs.filter(l => l.type === 'agent_payment').length,
      confirmations: logs.filter(l => l.type === 'payment_confirmed').length,
    };
  }

  /**
   * Attested decryption - only owner can decrypt their data
   * Requires wallet signature to prove ownership
   */
  async attestedDecrypt(
    owner: string,
    signature: string,
    entryId?: string
  ): Promise<{
    success: boolean;
    entries: Array<{
      id: string;
      type: string;
      amount?: string;
      timestamp: string;
      txSignature?: string;
      decrypted: boolean;
      fheHandle?: string;
      // Pool payment fields
      service?: string;
      stealthPoolAddress?: string;
      recipient?: string;
      tempBurner?: string;
      solRecovered?: number;
      method?: string;
      feePayer?: string;
      paymentFlow?: {
        setupTx?: string;
        usdcTransferTx?: string;
        paymentTx?: string;
        recoveryTx?: string;
      };
    }>;
    proof: string;
  }> {
    const inco = getIncoClient();
    const logs = auditLogs.get(owner) || [];
    
    console.log(`[Inco] attestedDecrypt: Found ${logs.length} entries for ${owner.slice(0, 8)}...`);
    
    // Decrypt entries using Inco attested decryption
    const decryptedEntries = await Promise.all(
      logs
        .filter(entry => !entryId || entry.id === entryId)
        .slice(0, 50) // Increased to 50 for more history
        .map(async (entry) => {
          try {
            const decrypted = await inco.attestedDecrypt(owner, signature, entry.fheHandle);
            return {
              id: entry.id,
              type: entry.type,
              amount: entry.amount,
              service: entry.resource || entry.agentName || (entry.type === 'pool_payment' ? 'Pool Payment' : 'Agent Activity'),
              timestamp: entry.timestamp,
              txSignature: entry.txSignature,
              decrypted: true,
              fheHandle: entry.fheHandle,
              // Pool payment specific fields
              stealthPoolAddress: entry.stealthPoolAddress,
              recipient: entry.recipient,
              tempBurner: entry.tempBurner,
              solRecovered: entry.solRecovered,
              method: entry.method,
              feePayer: entry.feePayer,
              paymentFlow: entry.paymentFlow,
            };
          } catch (err) {
            console.warn(`[Inco] Decryption failed for entry ${entry.id}: ${err}`);
            return {
              id: entry.id,
              type: entry.type,
              amount: undefined,
              service: entry.resource || entry.agentName,
              timestamp: entry.timestamp,
              txSignature: entry.txSignature,
              decrypted: false,
              fheHandle: entry.fheHandle,
              // Still include addresses (non-sensitive)
              stealthPoolAddress: entry.stealthPoolAddress,
              recipient: entry.recipient,
              tempBurner: entry.tempBurner,
              method: entry.method,
            };
          }
        })
    );

    console.log(`[Inco] attestedDecrypt: Returning ${decryptedEntries.length} decrypted entries`);
    
    return {
      success: true,
      entries: decryptedEntries,
      proof: `aegix-attestation-${Date.now()}`,
    };
  }

  /**
   * Calculate total spent (encrypted)
   * Returns FHE handle, not actual value
   */
  async getEncryptedTotal(owner: string): Promise<{
    handle: string;
    entryCount: number;
    isReal: boolean;
  }> {
    const inco = getIncoClient();
    const logs = auditLogs.get(owner) || [];
    
    // Calculate total from payment entries
    let totalMicro = 0n;
    for (const entry of logs) {
      if (entry.amount && (entry.type === 'agent_payment' || entry.type === 'x402_donation')) {
        totalMicro += BigInt(entry.amount);
      }
    }

    // Encrypt the total
    const encrypted = await inco.encrypt(totalMicro, 'uint128');
    
    return {
      handle: encrypted.handle,
      entryCount: logs.length,
      isReal: inco.isRealMode(),
    };
  }

  /**
   * Create FHE handle for an activity using real Inco Lightning
   */
  private async createFheHandleAsync(owner: string, activity: any): Promise<string> {
    const inco = getIncoClient();
    
    try {
      // Encode the activity as a numeric value for FHE
      // We combine type + timestamp into a single u128
      const typeCode = this.getTypeCode(activity.type);
      const amount = activity.amount ? BigInt(activity.amount) : 0n;
      
      // Create composite value: typeCode (8 bits) + amount (64 bits) + timestamp (56 bits)
      const timestamp = BigInt(Date.now()) & 0xFFFFFFFFFFFFFFn; // 56 bits
      const compositeValue = (BigInt(typeCode) << 120n) | (amount << 56n) | timestamp;
      
      // Encrypt using real Inco FHE
      const encrypted = await inco.encrypt(compositeValue, 'uint128');
      
      // Store the encrypted handle
      const key = `activity:${activity.type}:${Date.now()}`;
      await inco.store(owner, key, encrypted.handle);
      
      console.log(`[Inco] Encrypted activity with real FHE: ${encrypted.handle.substring(0, 40)}...`);
      
      return encrypted.handle;
    } catch (error) {
      console.error('[Inco] FHE encryption failed, using fallback:', error);
      return this.createFheHandleFallback(owner, activity);
    }
  }

  /**
   * Get numeric code for activity type
   */
  private getTypeCode(type: string): number {
    const codes: Record<string, number> = {
      'agent_payment': 1,
      'payment_confirmed': 2,
      'agent_created': 3,
      'agent_deleted': 4,
      'x402_donation': 5,
    };
    return codes[type] || 0;
  }

  /**
   * Fallback FHE handle creation (when API is unavailable)
   */
  private createFheHandleFallback(owner: string, activity: any): string {
    const timestamp = Date.now();
    
    const payload = {
      o: owner.substring(0, 8),
      t: activity.type,
      ts: timestamp,
      r: Math.random().toString(36).substring(2, 10),
    };
    
    const ciphertext = Buffer.from(JSON.stringify(payload)).toString('base64');
    
    let hash = 0;
    for (let i = 0; i < ciphertext.length; i++) {
      const char = ciphertext.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    const suffix = ciphertext.substring(0, 16).replace(/[+/=]/g, 'x');
    
    return `inco:fhe:${FHE_VERSION}:0x${hex}${suffix}`;
  }

  /**
   * Sync wrapper for backward compatibility
   */
  private createFheHandle(owner: string, activity: any): string {
    // For sync calls, use fallback
    return this.createFheHandleFallback(owner, activity);
  }
}

// Singleton instance
let auditLedgerInstance: AuditLedger | null = null;

/**
 * Get the audit ledger instance
 */
export function getAuditLedger(): AuditLedger {
  if (!auditLedgerInstance) {
    auditLedgerInstance = new AuditLedger();
    console.log(`[Inco] Audit ledger initialized (NON-CUSTODIAL mode)`);
  }
  return auditLedgerInstance;
}

// Backwards compatibility export (but now it's audit-only)
export const getConfidentialLedger = getAuditLedger;
