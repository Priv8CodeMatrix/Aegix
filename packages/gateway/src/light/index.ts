/**
 * Light Protocol Integration Module
 * 
 * Aegix 4.0 - ZK Compression for ultra-cheap ephemeral burners
 * 
 * Exports:
 * - Light client functions for compressed accounts and transfers
 * - Session key management for semi-custodial agent spending
 */

// Client exports
export {
  initLightConnection,
  getLightConnection,
  getRegularConnection,
  createCompressedPool,
  createCompressedBurner,
  getCompressedBalance,
  buildCompressedTransfer,
  executeCompressedTransfer,
  compressTokens,
  decompressTokens,
  checkLightHealth,
  getCostEstimate,
  type CompressedAccountInfo,
  type CompressedTokenBalance,
  type CompressedPoolResult,
  type CompressedBurnerResult,
  type CompressedTransferResult,
} from './client.js';

// Session key exports
export {
  createSessionKey,
  validateSessionKey,
  revokeSessionKey,
  recordSpending,
  getSessionKeypair,
  refreshSessionStatus,
  getSessionInfo,
  type SessionKeyStatus,
  type SessionSpendingLimits,
  type LightSessionKey,
  type CreateSessionResult,
  type ValidateSessionResult,
} from './session-keys.js';

// Migration exports
export {
  canMigrate,
  prepareMigration,
  migrateAgent,
  buildFundTransferTransaction,
  getMigrationStatus,
  type MigrationResult,
  type MigrationOptions,
} from './migrate.js';
