/**
 * Light Protocol Migration Helper
 * 
 * Helps migrate existing agents from legacy FHE-encrypted pools
 * to Light Protocol compressed pools.
 * 
 * Migration flow:
 * 1. Owner initiates migration for an agent
 * 2. New Light session is created
 * 3. If legacy pool has funds, owner signs transaction to transfer
 * 4. Agent is updated with new Light settings
 * 5. Legacy pool is marked as deprecated (not deleted, for safety)
 */

import { PublicKey, Connection, Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import {
  createSessionKey,
  type LightSessionKey,
  type SessionSpendingLimits,
} from './session-keys.js';
import { createCompressedPool, compressTokens, getRegularConnection } from './client.js';

/**
 * Migration result for a single agent
 */
export interface MigrationResult {
  success: boolean;
  agentId: string;
  agentName: string;
  previousMode: 'legacy' | 'none';
  newMode: 'light';
  lightSessionKey?: Partial<LightSessionKey>;
  lightPoolAddress?: string;
  fundsTransferred?: boolean;
  fundAmount?: string;
  error?: string;
}

/**
 * Migration options
 */
export interface MigrationOptions {
  transferFunds?: boolean;      // Whether to transfer funds from legacy pool
  sessionDurationHours?: number; // Session duration (default 24h)
  limits?: SessionSpendingLimits; // Custom spending limits
}

/**
 * Check if an agent can be migrated to Light Protocol
 */
export function canMigrate(agent: any): {
  canMigrate: boolean;
  reason?: string;
  currentMode?: string;
  hasLegacyPool?: boolean;
} {
  // Already on Light
  if (agent.stealthSettings?.mode === 'light') {
    return {
      canMigrate: false,
      reason: 'Agent is already using Light Protocol',
      currentMode: 'light',
    };
  }
  
  // Check if has legacy pool
  const hasLegacyPool = !!(
    agent.stealthSettings?.enabled && 
    (agent.stealthSettings?.poolId || agent.stealthSettings?.poolAddress)
  );
  
  return {
    canMigrate: true,
    currentMode: hasLegacyPool ? 'legacy' : 'none',
    hasLegacyPool,
  };
}

/**
 * Prepare migration for an agent
 * Returns what will happen without executing
 */
export function prepareMigration(
  agent: any,
  options: MigrationOptions = {}
): {
  agentId: string;
  agentName: string;
  currentMode: string;
  willTransferFunds: boolean;
  legacyPoolAddress?: string;
  estimatedSteps: string[];
} {
  const check = canMigrate(agent);
  
  const steps: string[] = [];
  
  if (check.hasLegacyPool) {
    steps.push('1. Create new Light Protocol session key');
    steps.push('2. Generate compressed pool address');
    if (options.transferFunds) {
      steps.push('3. Build transaction to transfer funds from legacy pool');
      steps.push('4. Owner signs fund transfer transaction');
      steps.push('5. Compress funds into Light pool');
    }
    steps.push(`${options.transferFunds ? '6' : '3'}. Update agent with Light settings`);
    steps.push(`${options.transferFunds ? '7' : '4'}. Mark legacy pool as deprecated`);
  } else {
    steps.push('1. Create new Light Protocol session key');
    steps.push('2. Generate compressed pool address');
    steps.push('3. Update agent with Light settings');
  }
  
  return {
    agentId: agent.id,
    agentName: agent.name,
    currentMode: check.currentMode || 'none',
    willTransferFunds: options.transferFunds && check.hasLegacyPool || false,
    legacyPoolAddress: agent.stealthSettings?.poolAddress,
    estimatedSteps: steps,
  };
}

/**
 * Execute migration for an agent
 * 
 * This creates the Light session but does NOT automatically transfer funds.
 * Fund transfer requires a separate owner-signed transaction.
 */
export async function migrateAgent(
  agent: any,
  ownerAddress: string,
  ownerSignature: string,
  message: string,
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const agentId = agent.id;
  const agentName = agent.name;
  
  console.log(`[Migration] Starting migration for agent ${agentName} (${agentId})`);
  
  try {
    // Check if migration is possible
    const check = canMigrate(agent);
    if (!check.canMigrate) {
      return {
        success: false,
        agentId,
        agentName,
        previousMode: check.currentMode as 'legacy' | 'none',
        newMode: 'light',
        error: check.reason,
      };
    }
    
    // Verify message format
    const expectedPattern = new RegExp(`^AEGIX_MIGRATE_TO_LIGHT::${agentId}::`);
    if (!expectedPattern.test(message)) {
      return {
        success: false,
        agentId,
        agentName,
        previousMode: check.currentMode as 'legacy' | 'none',
        newMode: 'light',
        error: 'Invalid migration message format. Expected: AEGIX_MIGRATE_TO_LIGHT::agentId::ownerAddress::timestamp',
      };
    }
    
    // Determine spending limits
    const limits: SessionSpendingLimits = options.limits || {
      maxPerTransaction: agent.spendingLimits?.maxPerTransaction || '100000000', // 100 USDC default
      dailyLimit: agent.spendingLimits?.dailyLimit || '1000000000', // 1000 USDC default
    };
    
    // Calculate session duration
    const durationMs = (options.sessionDurationHours || 24) * 60 * 60 * 1000;
    
    // Create new Light session
    console.log(`[Migration] Creating Light session...`);
    const sessionResult = createSessionKey(
      ownerAddress,
      ownerSignature,
      message.replace('MIGRATE_TO_LIGHT', 'SESSION_GRANT'), // Reuse signature for session
      limits,
      durationMs
    );
    
    console.log(`[Migration] ✓ Session created: ${sessionResult.sessionKey.publicKey.slice(0, 12)}...`);
    console.log(`[Migration] ✓ Pool address: ${sessionResult.poolAddress.slice(0, 12)}...`);
    
    // Build result
    const result: MigrationResult = {
      success: true,
      agentId,
      agentName,
      previousMode: check.currentMode as 'legacy' | 'none',
      newMode: 'light',
      lightSessionKey: {
        publicKey: sessionResult.sessionKey.publicKey,
        status: sessionResult.sessionKey.status,
        expiresAt: sessionResult.expiresAt,
        maxPerTransaction: limits.maxPerTransaction,
        dailyLimit: limits.dailyLimit,
      },
      lightPoolAddress: sessionResult.poolAddress,
      fundsTransferred: false, // Funds transfer is a separate step
    };
    
    console.log(`[Migration] ✓ Migration complete for agent ${agentName}`);
    console.log(`[Migration] Previous mode: ${check.currentMode}`);
    console.log(`[Migration] New mode: light`);
    
    if (check.hasLegacyPool) {
      console.log(`[Migration] Note: Legacy pool at ${agent.stealthSettings?.poolAddress?.slice(0, 12)}... is preserved`);
      console.log(`[Migration] To transfer funds, use the fund-pool endpoint separately`);
    }
    
    return result;
    
  } catch (error: any) {
    console.error(`[Migration] Error migrating agent ${agentName}:`, error.message);
    return {
      success: false,
      agentId,
      agentName,
      previousMode: 'none',
      newMode: 'light',
      error: error.message,
    };
  }
}

/**
 * Build transaction to transfer funds from legacy pool to Light pool
 * Returns serialized transaction for owner to sign
 */
export async function buildFundTransferTransaction(
  legacyPoolKeypair: Keypair,
  lightPoolAddress: string,
  amount: bigint
): Promise<Transaction> {
  console.log(`[Migration] Building fund transfer: ${amount} micro-USDC`);
  
  const connection = getRegularConnection();
  const lightPoolPubkey = new PublicKey(lightPoolAddress);
  
  // Build compress transaction to move funds to Light pool
  const compressTx = await compressTokens(legacyPoolKeypair.publicKey, amount);
  
  console.log(`[Migration] ✓ Fund transfer transaction built`);
  
  return compressTx;
}

/**
 * Get migration status for all agents of an owner
 */
export function getMigrationStatus(agents: any[]): {
  total: number;
  onLight: number;
  onLegacy: number;
  noPool: number;
  migratableCount: number;
  agents: Array<{
    id: string;
    name: string;
    mode: string;
    canMigrate: boolean;
    poolAddress?: string;
  }>;
} {
  let onLight = 0;
  let onLegacy = 0;
  let noPool = 0;
  let migratableCount = 0;
  
  const agentStatuses = agents.map(agent => {
    const check = canMigrate(agent);
    
    if (agent.stealthSettings?.mode === 'light') {
      onLight++;
    } else if (check.hasLegacyPool) {
      onLegacy++;
    } else {
      noPool++;
    }
    
    if (check.canMigrate) {
      migratableCount++;
    }
    
    return {
      id: agent.id,
      name: agent.name,
      mode: agent.stealthSettings?.mode || (check.hasLegacyPool ? 'legacy' : 'none'),
      canMigrate: check.canMigrate,
      poolAddress: agent.stealthSettings?.lightPoolAddress || agent.stealthSettings?.poolAddress,
    };
  });
  
  return {
    total: agents.length,
    onLight,
    onLegacy,
    noPool,
    migratableCount,
    agents: agentStatuses,
  };
}

export default {
  canMigrate,
  prepareMigration,
  migrateAgent,
  buildFundTransferTransaction,
  getMigrationStatus,
};
