import { Buffer } from 'buffer';
import fs from 'fs/promises';
import path from 'path';
import bs58 from 'bs58';
import BN from 'bn.js';
import { AnchorProvider, Program, Wallet, Idl } from '@coral-xyz/anchor';
import { AnchorProvider as StarAtlasAnchorProvider, Program as StarAtlasProgram } from '@staratlas/anchor';
import { ProfileFactionAccount, PROFILE_FACTION_IDL } from '@staratlas/profile-faction';
import { Fleet as SageFleet, SAGE_IDL, Starbase, StarbasePlayer } from '@staratlas/sage';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';
import { ProviderId, RpcLimiter } from 'rpc_limiter';
import { parsePersistedStateText, parseRecentActivityText, serializePersistedState } from './persistence-policy';

export const DEFAULT_SRSLY_PROGRAM_ID = 'SRSLY1fq9TJqCk1gNSE7VZL2bztvTn9wm4VR8u8jMKT';
export const SAGE_PROGRAM_ID = 'SAGE2HAwep459SNq61LHvjxPk4pLPEJLoMETef7f7EE';
export const PROFILE_FACTION_PROGRAM_ID = 'pFACSRuobDmvfMKq1bAzwj27t6d2GJhSCHb1VcfnRmq';
export const ANTEGEN_PROGRAM_ID = 'AgThdyi1P5RkVeZD2rQahTvs8HePJoGFFxKtvok5s2J1';
export const ATLAS_MINT = 'ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx';
export const RENTAL_FEE_WALLET = 'FEESnQG5d8UmUUbogJUaiQjMZpRQ9fCEDf3nBRf1ut9M';
export const DEFAULT_OWNER_WALLET = '';
export const DEFAULT_OWNER_PROFILE = '';
export const DEFAULT_RENTER_WALLET = '';
export const GENERAL_CHECK_INTERVAL_SECONDS = 3600;
export const DEFAULT_AGGRESSIVE_START_BEFORE_END_SECONDS = 1;
export const DEFAULT_AGGRESSIVE_STOP_AFTER_END_SECONDS = 1.5;
export const DEFAULT_AGGRESSIVE_SEND_INTERVAL_MS = 100;
export const NORMAL_RPC_AGGRESSIVE_SEND_INTERVAL_MS = 1000;
export const MAX_AGGRESSIVE_ATTEMPTS_PER_RULE = 160;
export const MAX_AGGRESSIVE_IN_FLIGHT_PER_RULE = 24;
export const DEFAULT_TRANSACTION_PRIORITY_FEE_MICROLAMPORTS = 1000;
export const DEFAULT_HELIUS_PRIORITY_FEE_MAX_MICROLAMPORTS = 250000;
export const DEFAULT_USE_HELIUS_SENDER = false;
export const DEFAULT_HELIUS_SENDER_SWQOS_ONLY = false;
export const DEFAULT_HELIUS_SENDER_TIP_SOL = 0.0002;
export const DEFAULT_RPC_REQUESTS_PER_SECOND = 10;
export const DEFAULT_RPC_TX_SEND_RATE_LIMIT_PER_SECOND = 1;
export const HELIUS_SENDER_MIN_TIP_SOL = 0.0002;
export const HELIUS_SENDER_SWQOS_ONLY_MIN_TIP_SOL = 0.000005;
export const HELIUS_SENDER_ENDPOINT = 'https://sender.helius-rpc.com/fast';
export const HELIUS_SENDER_SWQOS_ONLY_ENDPOINT = 'https://sender.helius-rpc.com/fast?swqos_only=true';
export const HELIUS_SENDER_TIP_ACCOUNTS = [
  '4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE',
  'D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ',
  '9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta',
  '5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn',
  '2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD',
  '2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ',
  'wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF',
  '3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT',
  '4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey',
  '4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or',
] as const;
export const RECENT_ACTIVITY_LIMIT = 20;
export const AGGRESSIVE_BLOCKHASH_REFRESH_INTERVAL_MS = 300;
export const AGGRESSIVE_BLOCKHASH_MAX_AGE_MS = 900;
export const AGGRESSIVE_BLOCKHASH_PREWARM_MS = 2000;
export const AGGRESSIVE_PREPARE_BEFORE_START_MS = 30000;
export const AGGRESSIVE_SCHEDULER_TICK_MS = 250;
export const AGGRESSIVE_TIMER_DRIFT_WARN_MS = 1000;
export const AGGRESSIVE_STATUS_CHECK_INTERVAL_MS = 1200;
export const AGGRESSIVE_PRIORITY_FEE_LADDER_STEPS = 4;
export const CONFIRMED_AVAILABILITY_OUTCOME_CHECK_INTERVAL_MS = 1000;
export const CONFIRMED_AVAILABILITY_OUTCOME_CHECK_ATTEMPTS = 8;
export const CONFIRMED_AVAILABILITY_WATCHDOG_INTERVAL_MS = 30000;
export const CONFIRMED_AVAILABILITY_WATCHDOG_NEAR_END_MS = 2 * 60 * 1000;
export const CONFIRMED_AVAILABILITY_WATCHDOG_UNKNOWN_END_INTERVAL_MS = 5 * 60 * 1000;
export const CONFIRMED_AVAILABILITY_DECODE_FAILURE_CACHE_MS = 10 * 60 * 1000;
export const RPC_LIMITER_SLOW_WAIT_LOG_MS = 100;
export const RPC_LIMITER_WAIT_LOG_THROTTLE_MS = 60000;
export const RPC_METHOD_COUNTER_LOG_INTERVAL_MS = 300000;
export const APP_VERSION = '0.2.32';

const MS_PER_SECOND = 1000;
const SECONDS_PER_DAY = 24 * 60 * 60;
const LAMPORTS_PER_ATLAS_DECIMALS = 8;
const srslyIdlCache = new Map<string, Promise<Idl | null>>();

export type FleetRentalRuleInput = {
  fleetName?: string | null;
  label?: string | null;
  fleetAccount?: string | null;
  rentalContract?: string | null;
  durationDays?: string | number | null;
  durationHours?: string | number | null;
  maxRentPricePerDay?: string | number | null;
  comment?: string | null;
  enabled?: boolean | string | number | null;
};

export type FleetRentalRuleConfig = {
  fleetName: string;
  fleetAccount: string;
  rentalContract: string;
  durationDays: number;
  maxRentPricePerDay: number;
  comment: string;
  enabled: boolean;
};

export type FleetRentalBotInputConfig = {
  INSTANCE_NAME?: string;
  AEPHIA_API_KEY?: string;
  RPC_URL?: string;
  RPC_URL_FALLBACK?: string;
  HOT_WALLET_SECRET?: string;
  SRSLY_PROGRAM_ID?: string;
  OWNER_WALLET?: string;
  OWNER_PROFILE?: string;
  AGGRESSIVE_START_BEFORE_END_SECONDS?: string | number;
  AGGRESSIVE_STOP_AFTER_END_SECONDS?: string | number;
  AGGRESSIVE_SEND_INTERVAL_MS?: string | number;
  RPC_REQUESTS_PER_SECOND?: string | number;
  RPC_TX_SEND_RATE_LIMIT_PER_SECOND?: string | number;
  USE_RPC_LIMITER?: string | boolean | number;
  useRpcLimiter?: string | boolean | number;
  USE_NORMAL_TXS?: string | boolean | number;
  USE_SWQOS?: string | boolean | number;
  TRANSACTION_PRIORITY_FEE_MICROLAMPORTS?: string | number;
  HELIUS_PRIORITY_FEE_MAX_MICROLAMPORTS?: string | number;
  USE_HELIUS_SENDER?: string | boolean | number;
  HELIUS_SENDER_SWQOS_ONLY?: string | boolean | number;
  HELIUS_SENDER_TIP_SOL?: string | number;
  ANALYSIS_DIR?: string;
  DRY_RUN?: string | boolean | number;
  rentalRules?: FleetRentalRuleInput[] | null;
};

export type FleetRentalBotConfig = {
  instanceName: string;
  rpcUrl: string;
  rpcUrlFallback?: string;
  hotWalletSecret: string;
  srslyProgramId: string;
  ownerWallet: string;
  ownerProfile: string;
  aggressiveStartBeforeEndSeconds: number;
  aggressiveStopAfterEndSeconds: number;
  aggressiveSendIntervalMs: number;
  rpcRequestsPerSecond: number;
  rpcTxSendRateLimitPerSecond: number;
  useRpcLimiter: boolean;
  useNormalTxs: boolean;
  transactionPriorityFeeMicroLamports: number;
  heliusPriorityFeeMaxMicroLamports: number;
  useHeliusSender: boolean;
  heliusSenderSwqosOnly: boolean;
  heliusSenderTipSol: number;
  analysisDir: string;
  dryRun: boolean;
  rentalRules: FleetRentalRuleConfig[];
  onRentSuccess?: (details: {
    fleetName: string;
    fleetAccount: string;
    rentalContract: string;
    tx: string;
    pricePerDay: number | null;
    rentEndsAt: string | null;
  }) => void | Promise<void>;
};

export type FleetRentalBotLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export type FleetRentalActivity = {
  timestamp: string;
  event: string;
  fleetAccount?: string;
  rentalContract?: string;
  label?: string;
  message?: string;
  tx?: string;
  pricePerDay?: number | null;
  endsAt?: string | null;
};

export type FleetRentalRuleHealth = {
  fleetName: string;
  enabled: boolean;
  fleetAccount: string;
  rentalContract: string;
  durationDays: number;
  maxRentPricePerDay: number;
  comment: string;
  status: 'disabled' | 'unknown' | 'waiting' | 'due' | 'pending' | 'renting' | 'rented' | 'unavailable' | 'blocked' | 'error';
  currentPricePerDay: number | null;
  rentEndsAt: string | null;
  secondsUntilEnd: number | null;
  lastActionAt: string | null;
  lastTx: string | null;
  note?: string;
};

export type FleetRentalBotStatus = {
  running: boolean;
  wallet: string;
  ownerWallet: string;
  ownerProfile: string;
  srslyProgramId: string;
  dryRun: boolean;
  solBalance: number | null;
  atlasBalance: number | null;
  startedAt: string | null;
  lastCycleStartedAt: string | null;
  lastCycleCompletedAt: string | null;
  lastCycleDurationMs: number | null;
  activeRuleCount: number;
  ruleHealth: FleetRentalRuleHealth[];
  recentActivity: FleetRentalActivity[];
};

export type ResolvedRentalRuleDetails = {
  fleetName: string;
  fleetAccount: string;
  rentalContract: string;
  currentPricePerDay: number | null;
  durationMinDays: number | null;
  durationMaxDays: number | null;
  relistingStatus: 'relisting' | 'closing';
  requiredCrew: number | null;
  crewCount: number | null;
  rentedCrew: number | null;
  hasNoCrew: boolean;
  rentEndsAt: string | null;
};

type RuleRuntimeState = {
  status: FleetRentalRuleHealth['status'];
  currentPricePerDay: number | null;
  rentEndsAt: string | null;
  secondsUntilEnd: number | null;
  lastActionAt: string | null;
  lastTx: string | null;
  note?: string;
};

type PersistedState = Record<string, RuleRuntimeState>;

type AggressiveRuntimeState = {
  token: number;
  attempts: number;
  inFlight: number;
  maxAttempts: number;
  stopAtMs: number;
  rentEndsAtMs: number;
  lastStatusCheckAtMs: number;
  statusCheckInFlight: boolean;
  lastSubmittedSignature: string | null;
  sharedExclusiveHeld: boolean;
};

type CachedBlockhash = {
  blockhash: string;
  lastValidBlockHeight: number;
  fetchedAtMs: number;
};

type RpcCounterField = 'network' | 'fallback';
type RpcMethodCounter = Record<RpcCounterField, number>;
type RpcMethodCounterSnapshot = {
  version: string;
  profile: string;
  pid: number;
  timestamp: string;
  intervalSeconds: number;
  uptimeSeconds: number;
  interval: Record<string, RpcMethodCounter>;
  total: Record<string, RpcMethodCounter>;
};

type RpcWaitLimiter = {
  wait: (label: string, bucketName?: 'rpc:shared' | 'tx:shared', method?: string) => Promise<void>;
  recordProviderOutcome?: (provider: ProviderId, outcome: 'ok' | 'rate_limited' | 'error') => Promise<void>;
};

export type RpcConnectionTestSeams = {
  createConnection?: (url: string, config: { commitment: 'confirmed'; disableRetryOnRateLimit: boolean }) => Connection;
  limiter?: RpcWaitLimiter;
};

type PreparedRentTransaction = {
  instructions: TransactionInstruction[];
  preparedAtMs: number;
};

type ScheduledAggressiveWindow = {
  fleetName: string;
  fleetAccount: string;
  rentalContract: string;
  rentEndsAtMs: number;
  prepareAtMs: number;
  startAtMs: number;
  stopAtMs: number;
};

type RentalContractSnapshot = {
  pricePerDay: number | null;
  endsAt: Date | null;
  hasCurrentRentalState: boolean;
  rentedByYou: boolean;
  toClose: boolean;
  rawAccountType: string | null;
  raw: unknown;
};

const defaultLogger: FleetRentalBotLogger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

export const EDITABLE_CONFIG_KEYS = [
  'INSTANCE_NAME',
  'AEPHIA_API_KEY',
  'RPC_URL',
  'RPC_URL_FALLBACK',
  'HOT_WALLET_SECRET',
  'SRSLY_PROGRAM_ID',
  'OWNER_WALLET',
  'OWNER_PROFILE',
  'AGGRESSIVE_START_BEFORE_END_SECONDS',
  'AGGRESSIVE_STOP_AFTER_END_SECONDS',
  'AGGRESSIVE_SEND_INTERVAL_MS',
  'RPC_REQUESTS_PER_SECOND',
  'RPC_TX_SEND_RATE_LIMIT_PER_SECOND',
  'USE_RPC_LIMITER',
  'USE_NORMAL_TXS',
  'USE_SWQOS',
  'TRANSACTION_PRIORITY_FEE_MICROLAMPORTS',
  'HELIUS_PRIORITY_FEE_MAX_MICROLAMPORTS',
  'USE_HELIUS_SENDER',
  'HELIUS_SENDER_SWQOS_ONLY',
  'HELIUS_SENDER_TIP_SOL',
  'ANALYSIS_DIR',
  'DRY_RUN',
] as const;

export type EditableConfig = Record<(typeof EDITABLE_CONFIG_KEYS)[number], string>;

export function getEditableConfigFromEnv(env: Partial<Record<string, string | undefined>> = {}): EditableConfig {
  return {
    INSTANCE_NAME: env.INSTANCE_NAME ?? '',
    AEPHIA_API_KEY: env.AEPHIA_API_KEY ?? '',
    RPC_URL: env.RPC_URL ?? 'https://api.mainnet-beta.solana.com',
    RPC_URL_FALLBACK: env.RPC_URL_FALLBACK ?? '',
    HOT_WALLET_SECRET: env.HOT_WALLET_SECRET ?? '',
    SRSLY_PROGRAM_ID: env.SRSLY_PROGRAM_ID ?? DEFAULT_SRSLY_PROGRAM_ID,
    OWNER_WALLET: env.OWNER_WALLET ?? DEFAULT_OWNER_WALLET,
    OWNER_PROFILE: env.OWNER_PROFILE ?? DEFAULT_OWNER_PROFILE,
    AGGRESSIVE_START_BEFORE_END_SECONDS: env.AGGRESSIVE_START_BEFORE_END_SECONDS ?? String(DEFAULT_AGGRESSIVE_START_BEFORE_END_SECONDS),
    AGGRESSIVE_STOP_AFTER_END_SECONDS: env.AGGRESSIVE_STOP_AFTER_END_SECONDS ?? String(DEFAULT_AGGRESSIVE_STOP_AFTER_END_SECONDS),
    AGGRESSIVE_SEND_INTERVAL_MS: env.AGGRESSIVE_SEND_INTERVAL_MS ?? String(DEFAULT_AGGRESSIVE_SEND_INTERVAL_MS),
    RPC_REQUESTS_PER_SECOND: env.RPC_REQUESTS_PER_SECOND ?? String(DEFAULT_RPC_REQUESTS_PER_SECOND),
    RPC_TX_SEND_RATE_LIMIT_PER_SECOND: env.RPC_TX_SEND_RATE_LIMIT_PER_SECOND ?? String(DEFAULT_RPC_TX_SEND_RATE_LIMIT_PER_SECOND),
    USE_RPC_LIMITER: env.USE_RPC_LIMITER ?? 'false',
    USE_NORMAL_TXS: env.USE_NORMAL_TXS ?? 'true',
    USE_SWQOS: env.USE_SWQOS ?? 'false',
    TRANSACTION_PRIORITY_FEE_MICROLAMPORTS:
      env.TRANSACTION_PRIORITY_FEE_MICROLAMPORTS ?? String(DEFAULT_TRANSACTION_PRIORITY_FEE_MICROLAMPORTS),
    HELIUS_PRIORITY_FEE_MAX_MICROLAMPORTS:
      env.HELIUS_PRIORITY_FEE_MAX_MICROLAMPORTS ?? String(DEFAULT_HELIUS_PRIORITY_FEE_MAX_MICROLAMPORTS),
    USE_HELIUS_SENDER: env.USE_HELIUS_SENDER ?? String(DEFAULT_USE_HELIUS_SENDER),
    HELIUS_SENDER_SWQOS_ONLY: env.HELIUS_SENDER_SWQOS_ONLY ?? String(DEFAULT_HELIUS_SENDER_SWQOS_ONLY),
    HELIUS_SENDER_TIP_SOL: env.HELIUS_SENDER_TIP_SOL ?? String(DEFAULT_HELIUS_SENDER_TIP_SOL),
    ANALYSIS_DIR: env.ANALYSIS_DIR ?? 'analysis',
    DRY_RUN: env.DRY_RUN ?? 'true',
  };
}

export function buildBotConfig(input: FleetRentalBotInputConfig): FleetRentalBotConfig {
  const editable = getEditableConfigFromEnv({
    INSTANCE_NAME: input.INSTANCE_NAME as string | undefined,
    AEPHIA_API_KEY: input.AEPHIA_API_KEY as string | undefined,
    RPC_URL: input.RPC_URL as string | undefined,
    RPC_URL_FALLBACK: input.RPC_URL_FALLBACK as string | undefined,
    HOT_WALLET_SECRET: input.HOT_WALLET_SECRET as string | undefined,
    SRSLY_PROGRAM_ID: input.SRSLY_PROGRAM_ID as string | undefined,
    OWNER_WALLET: input.OWNER_WALLET as string | undefined,
    OWNER_PROFILE: input.OWNER_PROFILE as string | undefined,
    AGGRESSIVE_START_BEFORE_END_SECONDS: input.AGGRESSIVE_START_BEFORE_END_SECONDS as string | undefined,
    AGGRESSIVE_STOP_AFTER_END_SECONDS: input.AGGRESSIVE_STOP_AFTER_END_SECONDS as string | undefined,
    AGGRESSIVE_SEND_INTERVAL_MS: input.AGGRESSIVE_SEND_INTERVAL_MS as string | undefined,
    RPC_REQUESTS_PER_SECOND: input.RPC_REQUESTS_PER_SECOND as string | undefined,
    RPC_TX_SEND_RATE_LIMIT_PER_SECOND: input.RPC_TX_SEND_RATE_LIMIT_PER_SECOND as string | undefined,
    USE_RPC_LIMITER: String(input.useRpcLimiter ?? input.USE_RPC_LIMITER ?? ''),
    USE_NORMAL_TXS: input.USE_NORMAL_TXS as string | undefined,
    USE_SWQOS: input.USE_SWQOS as string | undefined,
    TRANSACTION_PRIORITY_FEE_MICROLAMPORTS: input.TRANSACTION_PRIORITY_FEE_MICROLAMPORTS as string | undefined,
    HELIUS_PRIORITY_FEE_MAX_MICROLAMPORTS: input.HELIUS_PRIORITY_FEE_MAX_MICROLAMPORTS as string | undefined,
    USE_HELIUS_SENDER: input.USE_HELIUS_SENDER as string | undefined,
    HELIUS_SENDER_SWQOS_ONLY: input.HELIUS_SENDER_SWQOS_ONLY as string | undefined,
    HELIUS_SENDER_TIP_SOL: input.HELIUS_SENDER_TIP_SOL as string | undefined,
    ANALYSIS_DIR: input.ANALYSIS_DIR as string | undefined,
    DRY_RUN: input.DRY_RUN as string | undefined,
  });

  if (!editable.HOT_WALLET_SECRET) {
    throw new Error('HOT_WALLET_SECRET is missing');
  }

  validatePublicKey(editable.SRSLY_PROGRAM_ID, 'SRSLY_PROGRAM_ID');
  validatePublicKey(editable.OWNER_WALLET, 'OWNER_WALLET');
  validatePublicKey(editable.OWNER_PROFILE, 'OWNER_PROFILE');
  const useHeliusSender = parseBoolean(editable.USE_HELIUS_SENDER);
  const rpcRequestsPerSecond = parsePositiveNumber(editable.RPC_REQUESTS_PER_SECOND, 'RPC_REQUESTS_PER_SECOND');
  const rpcTxSendRateLimitPerSecond = parsePositiveNumber(
    editable.RPC_TX_SEND_RATE_LIMIT_PER_SECOND,
    'RPC_TX_SEND_RATE_LIMIT_PER_SECOND',
  );
  const useRpcLimiter = parseBoolean(editable.USE_RPC_LIMITER);
  const useNormalTxs = !useHeliusSender;
  const heliusSenderSwqosOnly = parseBoolean(editable.HELIUS_SENDER_SWQOS_ONLY);
  const heliusSenderTipSol = parsePositiveNumber(editable.HELIUS_SENDER_TIP_SOL, 'HELIUS_SENDER_TIP_SOL');
  const minimumTipSol = heliusSenderSwqosOnly ? HELIUS_SENDER_SWQOS_ONLY_MIN_TIP_SOL : HELIUS_SENDER_MIN_TIP_SOL;
  if (useHeliusSender && heliusSenderTipSol < minimumTipSol) {
    throw new Error(`HELIUS_SENDER_TIP_SOL must be >= ${minimumTipSol} SOL`);
  }

  return {
    instanceName: editable.INSTANCE_NAME,
    rpcUrl: editable.RPC_URL,
    rpcUrlFallback: editable.RPC_URL_FALLBACK || undefined,
    hotWalletSecret: editable.HOT_WALLET_SECRET,
    srslyProgramId: editable.SRSLY_PROGRAM_ID,
    ownerWallet: editable.OWNER_WALLET,
    ownerProfile: editable.OWNER_PROFILE,
    aggressiveStartBeforeEndSeconds: parseNonNegativeNumber(editable.AGGRESSIVE_START_BEFORE_END_SECONDS, 'AGGRESSIVE_START_BEFORE_END_SECONDS'),
    aggressiveStopAfterEndSeconds: parseNonNegativeNumber(editable.AGGRESSIVE_STOP_AFTER_END_SECONDS, 'AGGRESSIVE_STOP_AFTER_END_SECONDS'),
    aggressiveSendIntervalMs: parsePositiveInteger(editable.AGGRESSIVE_SEND_INTERVAL_MS, 'AGGRESSIVE_SEND_INTERVAL_MS'),
    rpcRequestsPerSecond,
    rpcTxSendRateLimitPerSecond,
    useRpcLimiter,
    useNormalTxs,
    transactionPriorityFeeMicroLamports: parsePositiveInteger(
      editable.TRANSACTION_PRIORITY_FEE_MICROLAMPORTS,
      'TRANSACTION_PRIORITY_FEE_MICROLAMPORTS',
    ),
    heliusPriorityFeeMaxMicroLamports: parsePositiveInteger(
      editable.HELIUS_PRIORITY_FEE_MAX_MICROLAMPORTS,
      'HELIUS_PRIORITY_FEE_MAX_MICROLAMPORTS',
    ),
    useHeliusSender,
    heliusSenderSwqosOnly,
    heliusSenderTipSol,
    analysisDir: editable.ANALYSIS_DIR,
    dryRun: parseBoolean(editable.DRY_RUN),
    rentalRules: parseRentalRules(input.rentalRules),
  };
}

export function parseRentalRules(input?: FleetRentalRuleInput[] | null): FleetRentalRuleConfig[] {
  if (!input || input.length === 0) {
    return [];
  }

  return input
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => {
      if (!parseOptionalBoolean(rule.enabled, true)) return false;
      const hasFleetOrContract = Boolean(String(rule.fleetAccount ?? '').trim() || String(rule.rentalContract ?? '').trim());
      const hasMaxPrice = String(rule.maxRentPricePerDay ?? '').trim().length > 0;
      return hasFleetOrContract || hasMaxPrice;
    })
    .map(({ rule, index }) => parseRentalRule(rule, index));
}

export function parseRentalRule(input: FleetRentalRuleInput, index?: number): FleetRentalRuleConfig {
  const label = typeof index === 'number' ? `rentalRules[${index}]` : 'rentalRule';
  const fleetAccount = parsePublicKeyString(input.fleetAccount, `${label}.fleetAccount`);
  const rentalContract = parsePublicKeyString(input.rentalContract, `${label}.rentalContract`);
  const durationDays = parsePositiveInteger(input.durationDays ?? input.durationHours ?? 24, `${label}.durationDays`);
  if (durationDays > 24) {
    throw new Error(`${label}.durationDays must be <= 24`);
  }
  const maxRentPricePerDay = parsePositiveNumber(input.maxRentPricePerDay, `${label}.maxRentPricePerDay`);

  return {
    fleetName: String(input.fleetName ?? input.label ?? '').trim() || fleetAccount.slice(0, 8),
    fleetAccount,
    rentalContract,
    durationDays,
    maxRentPricePerDay,
    comment: String(input.comment ?? '').trim().slice(0, 40),
    enabled: parseOptionalBoolean(input.enabled, true),
  };
}

class SharedRpcRequestLimiter {
  private readonly sharedLimiter = new RpcLimiter();
  private readonly lastSharedWaitLogAtMs = new Map<string, number>();

  constructor(
    private readonly logger: FleetRentalBotLogger,
    private readonly useSharedLimiter: () => boolean,
    private readonly metricsApp: string,
    private readonly metricsProfile: string = 'default',
  ) {}

  async wait(label: string, bucketName: 'rpc:shared' | 'tx:shared' = 'rpc:shared', method: string = label): Promise<void> {
    if (!this.useSharedLimiter()) return;

    const sharedStartedAt = Date.now();
    await this.sharedLimiter.wait(bucketName, {
      label,
      metrics: {
        app: this.metricsApp,
        profile: this.metricsProfile,
        method,
      },
    });
    const sharedWaitMs = Date.now() - sharedStartedAt;
    const logKey = `${bucketName}:${label}`;
    const lastLoggedAt = this.lastSharedWaitLogAtMs.get(logKey) ?? 0;
    const now = Date.now();
    if (sharedWaitMs > RPC_LIMITER_SLOW_WAIT_LOG_MS && now - lastLoggedAt >= RPC_LIMITER_WAIT_LOG_THROTTLE_MS) {
      const prefix = bucketName === 'tx:shared' ? 'TX limiter' : 'RPC limiter';
      this.logger.info(`${prefix} waiting for ${label}.`);
      this.lastSharedWaitLogAtMs.set(logKey, now);
    }
  }

  async recordProviderOutcome(provider: ProviderId, outcome: 'ok' | 'rate_limited' | 'error'): Promise<void> {
    if (!this.useSharedLimiter()) return;
    await this.sharedLimiter.recordProviderOutcome(provider, outcome);
  }
}

function isRateLimitedRpcError(error: unknown): boolean {
  if (typeof error === 'object' && error) {
    const record = error as { status?: unknown; statusCode?: unknown; code?: unknown };
    if (record.status === 429 || record.statusCode === 429 || record.code === 429) return true;
  }
  return /(?:^|\D)429(?:\D|$)|rate[ -]?limit/i.test(formatError(error));
}

async function invokeRpcForProvider<T>(
  provider: ProviderId,
  invoke: () => Promise<T>,
  limiter: RpcWaitLimiter,
): Promise<T> {
  try {
    const result = await invoke();
    await limiter.recordProviderOutcome?.(provider, 'ok');
    return result;
  } catch (error) {
    await limiter.recordProviderOutcome?.(provider, isRateLimitedRpcError(error) ? 'rate_limited' : 'error');
    throw error;
  }
}

async function callRpcWithSharedLimiter<T>(
  label: string,
  invoke: () => Promise<T>,
  limiter: RpcWaitLimiter,
  bucketName: 'rpc:shared' | 'tx:shared' = 'rpc:shared',
  method: string = label,
): Promise<T> {
  await limiter.wait(label, bucketName, method);
  return invoke();
}

export function createFailoverConnection(
  primaryUrl: string,
  fallbackUrl: string | undefined,
  logger: FleetRentalBotLogger,
  useSharedLimiter: () => boolean,
  metricsProfile: string,
  recordRpcMethodCounters?: (snapshot: RpcMethodCounterSnapshot) => void,
  seams: RpcConnectionTestSeams = {},
): Connection {
  const connectionConfig = { commitment: 'confirmed' as const, disableRetryOnRateLimit: true };
  const createConnection = seams.createConnection ?? ((url, config) => new Connection(url, config));
  const primary = createConnection(primaryUrl, connectionConfig);
  const limiter = seams.limiter ?? new SharedRpcRequestLimiter(logger, useSharedLimiter, 'Fleet Rental Bot', metricsProfile);
  const rpcMethodCounters = new Map<string, RpcMethodCounter>();
  const rpcIntervalMethodCounters = new Map<string, RpcMethodCounter>();
  const rpcCounterStartedAtMs = Date.now();
  let lastRpcMethodCounterResetAtMs = rpcCounterStartedAtMs;

  const countRpcMethod = (method: string, field: RpcCounterField): void => {
    for (const counters of [rpcMethodCounters, rpcIntervalMethodCounters]) {
      const counter = counters.get(method) ?? { network: 0, fallback: 0 };
      counter[field] += 1;
      counters.set(method, counter);
    }
  };

  const snapshotRpcMethodCounters = (counters: Map<string, RpcMethodCounter>): Record<string, RpcMethodCounter> => {
    return Object.fromEntries(
      [...counters.entries()]
        .filter(([, counter]) => counter.network || counter.fallback)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, counter]) => [
          name,
          {
            network: counter.network,
            fallback: counter.fallback,
          },
        ]),
    );
  };

  const clearRpcMethodCounters = (counters: Map<string, RpcMethodCounter>): void => {
    for (const counter of counters.values()) {
      counter.network = 0;
      counter.fallback = 0;
    }
  };

  const maybeLogRpcMethodCounters = (): void => {
    const now = Date.now();
    if (now - lastRpcMethodCounterResetAtMs < RPC_METHOD_COUNTER_LOG_INTERVAL_MS) return;
    const interval = snapshotRpcMethodCounters(rpcIntervalMethodCounters);
    const total = snapshotRpcMethodCounters(rpcMethodCounters);
    const intervalParts = Object.entries(interval).map(([name, counter]) => `${name}=network:${counter.network},fallback:${counter.fallback}`);
    const totalParts = Object.entries(total).map(([name, counter]) => `${name}=network:${counter.network},fallback:${counter.fallback}`);
    if (intervalParts.length === 0 && totalParts.length === 0) {
      lastRpcMethodCounterResetAtMs = now;
      return;
    }
    const intervalSeconds = Math.max(1, Math.round((now - lastRpcMethodCounterResetAtMs) / 1000));
    const uptimeSeconds = Math.max(1, Math.round((now - rpcCounterStartedAtMs) / 1000));
    const snapshot: RpcMethodCounterSnapshot = {
      version: APP_VERSION,
      profile: metricsProfile,
      pid: process.pid,
      timestamp: new Date(now).toISOString(),
      intervalSeconds,
      uptimeSeconds,
      interval,
      total,
    };
    logger.info(
      `RPC method counters v${APP_VERSION} profile=${metricsProfile} pid=${process.pid} ` +
        `interval=${intervalSeconds}s uptime=${uptimeSeconds}s | interval ${intervalParts.join(' | ')} | total ${totalParts.join(' | ')}`,
    );
    recordRpcMethodCounters?.(snapshot);
    clearRpcMethodCounters(rpcIntervalMethodCounters);
    lastRpcMethodCounterResetAtMs = now;
  };

  const callCountedRpc = async <T>(
    label: string,
    invoke: () => Promise<T>,
    bucketName: 'rpc:shared' | 'tx:shared',
    method: string,
    field: RpcCounterField,
  ): Promise<T> => {
    maybeLogRpcMethodCounters();
    countRpcMethod(method, field);
    try {
      return await callRpcWithSharedLimiter(label, invoke, limiter, bucketName, method);
    } finally {
      maybeLogRpcMethodCounters();
    }
  };

  if (!fallbackUrl || fallbackUrl === primaryUrl) {
    return new Proxy(primary, {
      get(target, prop, receiver) {
        const primaryValue = Reflect.get(target, prop, receiver);
        if (typeof primaryValue !== 'function') return primaryValue;
        return async (...args: unknown[]) => {
          const method = String(prop);
          const label = `Connection.${String(prop)}()`;
          const bucketName = prop === 'sendRawTransaction' ? 'tx:shared' : 'rpc:shared';
          return callCountedRpc(
            label,
            () => invokeRpcForProvider('main', () => primaryValue.apply(target, args), limiter),
            bucketName,
            method,
            'network',
          );
        };
      },
    }) as Connection;
  }

  const fallback = createConnection(fallbackUrl, connectionConfig);
  return new Proxy(primary, {
    get(target, prop, receiver) {
      const primaryValue = Reflect.get(target, prop, receiver);
      if (typeof primaryValue !== 'function') return primaryValue;
      const fallbackValue = Reflect.get(fallback, prop, fallback);
      if (typeof fallbackValue !== 'function') return primaryValue.bind(target);
      return async (...args: unknown[]) => {
        const method = String(prop);
        const label = `Connection.${String(prop)}()`;
        const isTransactionSubmission = method === 'sendRawTransaction' || method === 'sendTransaction' || method === 'sendEncodedTransaction';
        const bucketName = isTransactionSubmission ? 'tx:shared' : 'rpc:shared';
        try {
          return await callCountedRpc(
            label,
            () => invokeRpcForProvider('main', () => primaryValue.apply(target, args), limiter),
            bucketName,
            method,
            'network',
          );
        } catch (error) {
          if (isTransactionSubmission) throw error;
          logger.warn(`Primary RPC failed for Connection.${String(prop)}(), trying fallback RPC.`, error);
          return await callCountedRpc(
            `fallback Connection.${String(prop)}()`,
            () => invokeRpcForProvider('fallback', () => fallbackValue.apply(fallback, args), limiter),
            bucketName,
            method,
            'fallback',
          );
        }
      };
    },
  }) as Connection;
}

function decodeSecret(secret: string): Uint8Array {
  const trimmed = secret.trim();
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('HOT_WALLET_SECRET JSON value must be an array');
    return Uint8Array.from(parsed);
  }

  const hexLike = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (/^[0-9a-fA-F]+$/.test(hexLike)) {
    if (hexLike.length % 2 !== 0) throw new Error('HOT_WALLET_SECRET hex value must have an even length');
    return Uint8Array.from(Buffer.from(hexLike, 'hex'));
  }

  return bs58.decode(trimmed);
}

export function getHotWalletAddressFromSecret(secret: string): string {
  const secretKeyBytes = decodeSecret(secret);
  const wallet = secretKeyBytes.length === 32 ? Keypair.fromSeed(secretKeyBytes) : Keypair.fromSecretKey(secretKeyBytes);
  return wallet.publicKey.toBase58();
}

function parsePositiveInteger(value: string | number | null | undefined, fieldName: string): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string | number | null | undefined, fieldName: string): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return parsed;
}

function parseNonNegativeNumber(value: string | number | null | undefined, fieldName: string): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }
  return parsed;
}

function parsePositiveNumber(value: string | number | null | undefined, fieldName: string): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
  return parsed;
}

function parseBoolean(value: string | number | boolean | null | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function parseOptionalBoolean(value: string | number | boolean | null | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  return parseBoolean(value);
}

function validatePublicKey(value: string, fieldName: string): void {
  try {
    new PublicKey(value);
  } catch {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
}

function parsePublicKeyString(value: string | null | undefined, fieldName: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw new Error(`${fieldName} must be set`);
  validatePublicKey(trimmed, fieldName);
  return trimmed;
}

function numberFromUnknown(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (BN.isBN(value)) return value.toNumber();
  if (typeof value === 'object' && value && 'toNumber' in value && typeof (value as { toNumber: () => number }).toNumber === 'function') {
    const parsed = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractFirstNumber(source: unknown, names: string[]): number | null {
  if (!source || typeof source !== 'object') return null;
  const record = source as Record<string, unknown>;
  for (const name of names) {
    const value = record[name];
    const parsed = numberFromUnknown(value);
    if (parsed != null) return parsed;
  }
  return null;
}

export function normalizePricePerDay(raw: number | null): number | null {
  if (raw == null) return null;
  if (raw > 1_000_000) return raw / 10 ** LAMPORTS_PER_ATLAS_DECIMALS;
  return raw;
}

export function calculateRentalPaymentBaseUnits(ratePerDay: number, durationDays: number): number {
  return Math.floor(ratePerDay * durationDays * 10 ** LAMPORTS_PER_ATLAS_DECIMALS);
}

export function calculateFallbackRentEndsAt(nowMs: number, durationDays: number): string {
  return new Date(nowMs + durationDays * 24 * 60 * 60 * 1000).toISOString();
}

export function calculateAggressiveWindow(
  rentEndsAtMs: number,
  startBeforeEndSeconds: number,
  stopAfterEndSeconds: number,
): { prepareAtMs: number; startAtMs: number; stopAtMs: number } {
  const startAtMs = rentEndsAtMs - startBeforeEndSeconds * MS_PER_SECOND;
  return {
    prepareAtMs: startAtMs - AGGRESSIVE_PREPARE_BEFORE_START_MS,
    startAtMs,
    stopAtMs: rentEndsAtMs + stopAfterEndSeconds * MS_PER_SECOND,
  };
}

function publicKeyFromUnknown(value: unknown): PublicKey | null {
  if (value instanceof PublicKey) return value;
  if (typeof value === 'string') {
    try {
      return new PublicKey(value);
    } catch {
      return null;
    }
  }
  return null;
}

function isDefaultPublicKey(value: PublicKey | null): boolean {
  return !value || value.equals(PublicKey.default);
}

function extractDate(source: unknown, names: string[]): Date | null {
  const raw = extractFirstNumber(source, names);
  if (raw == null || raw <= 0) return null;
  const ms = raw > 10_000_000_000 ? raw : raw * 1000;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRuleKey(rule: FleetRentalRuleConfig): string {
  return `${rule.fleetAccount}:${rule.rentalContract}`;
}

function byteArrayToString(bytes: readonly number[] | Uint8Array | undefined | null): string {
  if (!bytes) return '';
  return Buffer.from(bytes).toString('utf8').replace(/\0+$/g, '').trim();
}

class FakeStarAtlasWallet {
  constructor(private readonly payer: Keypair) {}

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }

  signTransaction<T extends Transaction | VersionedTransaction>(_tx: T): Promise<T> {
    throw new Error('not implemented');
  }

  signAllTransactions<T extends Transaction | VersionedTransaction>(_txs: T[]): Promise<T[]> {
    throw new Error('not implemented');
  }
}

function createSageProgram(connection: Connection): any {
  const provider = new StarAtlasAnchorProvider(
    connection as any,
    new FakeStarAtlasWallet(Keypair.generate()) as any,
    StarAtlasAnchorProvider.defaultOptions(),
  );
  return new StarAtlasProgram(SAGE_IDL as any, new PublicKey(SAGE_PROGRAM_ID), provider) as any;
}

function createProfileFactionProgram(connection: Connection): any {
  const provider = new StarAtlasAnchorProvider(
    connection as any,
    new FakeStarAtlasWallet(Keypair.generate()) as any,
    StarAtlasAnchorProvider.defaultOptions(),
  );
  return new StarAtlasProgram(PROFILE_FACTION_IDL as any, new PublicKey(PROFILE_FACTION_PROGRAM_ID), provider) as any;
}

function deriveRentalContractForFleet(fleetAccount: PublicKey, srslyProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('rental_contract'), fleetAccount.toBuffer()],
    srslyProgramId,
  )[0];
}

function getFleetCrewInfo(fleet: any): { requiredCrew: number | null; crewCount: number | null; rentedCrew: number | null; hasNoCrew: boolean } {
  const miscStats = fleet?.data?.stats?.miscStats ?? fleet?.stats?.miscStats ?? {};
  const requiredCrew = numberFromUnknown((miscStats as Record<string, unknown>).requiredCrew);
  const crewCount = numberFromUnknown((miscStats as Record<string, unknown>).crewCount);
  const rentedCrew = numberFromUnknown((miscStats as Record<string, unknown>).rentedCrew);
  return {
    requiredCrew,
    crewCount,
    rentedCrew,
    hasNoCrew: (rentedCrew ?? 0) <= 0,
  };
}

async function decodeSageFleet(connection: Connection, fleetAccount: PublicKey): Promise<any> {
  const accountInfo = await connection.getAccountInfo(fleetAccount, 'confirmed');
  if (!accountInfo) throw new Error(`Fleet account not found: ${fleetAccount.toBase58()}`);
  const sage = createSageProgram(connection);
  const decoded = SageFleet.decodeData({ accountId: fleetAccount, accountInfo } as any, sage);
  if (decoded.type !== 'ok') {
    throw decoded.error ?? new Error(`Could not decode fleet ${fleetAccount.toBase58()}`);
  }
  return decoded.data;
}

async function decodeStarbase(connection: Connection, starbase: PublicKey): Promise<any> {
  const accountInfo = await connection.getAccountInfo(starbase, 'confirmed');
  if (!accountInfo) throw new Error(`Starbase account not found: ${starbase.toBase58()}`);
  const sage = createSageProgram(connection);
  const decoded = Starbase.decodeData({ accountId: starbase, accountInfo } as any, sage);
  if (decoded.type !== 'ok') {
    throw decoded.error ?? new Error(`Could not decode starbase ${starbase.toBase58()}`);
  }
  return decoded.data;
}

function getFleetStarbase(fleet: any): PublicKey {
  const state = fleet.state ?? {};
  const starbase = state.StarbaseLoadingBay?.starbase;
  if (starbase instanceof PublicKey) return starbase;
  throw new Error(`Fleet ${fleet.key?.toBase58?.() ?? ''} is not in a starbase loading bay; cannot accept rental safely.`);
}

/** Derives the SRSLY rental contract PDA for a given fleet.
 *  Seed: ['rental_contract', fleet]
 */
function deriveRentalContract(fleet: PublicKey, srslyProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('rental_contract'), fleet.toBuffer()],
    srslyProgramId,
  )[0];
}

function deriveRentalState(contract: PublicKey, borrower: PublicKey, srslyProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('rental_state'), contract.toBuffer(), borrower.toBuffer()],
    srslyProgramId,
  )[0];
}

function deriveRentalAuthority(srslyProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('rental_authority')], srslyProgramId)[0];
}

function deriveRentalThread(rentalAuthority: PublicKey, rentalState: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('thread'), rentalAuthority.toBuffer(), rentalState.toBuffer()],
    new PublicKey(ANTEGEN_PROGRAM_ID),
  )[0];
}

async function fetchCachedSrslyIdl(programId: PublicKey, provider: AnchorProvider): Promise<Idl | null> {
  const key = programId.toBase58();
  let cached = srslyIdlCache.get(key);
  if (!cached) {
    cached = Program.fetchIdl(programId, provider);
    srslyIdlCache.set(key, cached);
  }
  try {
    return await cached;
  } catch (err) {
    srslyIdlCache.delete(key);
    throw err;
  }
}

export async function resolveRentalRuleDetails(input: {
  rpcUrl: string;
  srslyProgramId?: string;
  fleetAccount?: string | null;
  rentalContract?: string | null;
}): Promise<ResolvedRentalRuleDetails> {
  const connection = new Connection(input.rpcUrl, { commitment: 'confirmed', disableRetryOnRateLimit: true });
  const srslyProgramId = new PublicKey(input.srslyProgramId || DEFAULT_SRSLY_PROGRAM_ID);
  const provider = new AnchorProvider(connection, new Wallet(Keypair.generate()), { commitment: 'confirmed' });
  const idl = await fetchCachedSrslyIdl(srslyProgramId, provider);
  if (!idl) throw new Error(`Could not fetch Anchor IDL for SRSLY program ${srslyProgramId.toBase58()}`);
  const program = new Program({ ...idl, address: srslyProgramId.toBase58() } as Idl, provider);

  let fleet = input.fleetAccount ? new PublicKey(input.fleetAccount) : null;
  let contract = input.rentalContract ? new PublicKey(input.rentalContract) : null;

  if (!contract && fleet) {
    contract = deriveRentalContractForFleet(fleet, srslyProgramId);
  }

  if (!contract) {
    throw new Error('Enter either a fleet account or a rental contract.');
  }

  const contractState = await (program.account as any).contractState.fetch(contract);
  const contractFleet = publicKeyFromUnknown((contractState as Record<string, unknown>).fleet);
  if (!fleet && contractFleet) {
    fleet = contractFleet;
  }
  if (!fleet) {
    throw new Error(`Could not resolve fleet account from contract ${contract.toBase58()}`);
  }

  const decodedFleet = await decodeSageFleet(connection, fleet);
  const fleetName = byteArrayToString(decodedFleet.data.fleetLabel) || fleet.toBase58();
  const crewInfo = getFleetCrewInfo(decodedFleet);
  let rentEndsAt: string | null = null;
  const currentRentalState = publicKeyFromUnknown((contractState as Record<string, unknown>).currentRentalState);
  if (currentRentalState && !isDefaultPublicKey(currentRentalState)) {
    try {
      const rental = await (program.account as any).rentalState.fetch(currentRentalState);
      if (!Boolean((rental as Record<string, unknown>).cancelled)) {
        rentEndsAt = extractDate(rental, ['endTime'])?.toISOString() ?? null;
      }
    } catch {
      // Non-fatal for rule resolution.
    }
  }

  return {
    fleetName,
    fleetAccount: fleet.toBase58(),
    rentalContract: contract.toBase58(),
    currentPricePerDay: normalizePricePerDay(extractFirstNumber(contractState, ['rate'])),
    durationMinDays: extractFirstNumber(contractState, ['durationMin']),
    durationMaxDays: extractFirstNumber(contractState, ['durationMax']),
    relistingStatus: Boolean((contractState as Record<string, unknown>).toClose) ? 'closing' : 'relisting',
    requiredCrew: crewInfo.requiredCrew,
    crewCount: crewInfo.crewCount,
    rentedCrew: crewInfo.rentedCrew,
    hasNoCrew: crewInfo.hasNoCrew,
    rentEndsAt,
  };
}

function findInstruction(idl: Idl, candidates: string[]): string | null {
  const instructions = ((idl as any).instructions ?? []) as Array<{ name?: string }>;
  const normalizedCandidates = candidates.map((candidate) => candidate.toLowerCase());
  const hit = instructions.find((instruction) => normalizedCandidates.includes(String(instruction.name ?? '').toLowerCase()));
  return hit?.name ?? null;
}

function getInstructionArgNames(idl: Idl, instructionName: string): string[] {
  const instruction = (((idl as any).instructions ?? []) as Array<{ name?: string; args?: Array<{ name?: string }> }>).find(
    (item) => item.name === instructionName,
  );
  return (instruction?.args ?? []).map((arg) => String(arg.name ?? ''));
}

function getAccountNames(idl: Idl): string[] {
  return (((idl as any).accounts ?? []) as Array<{ name?: string }>).map((account) => String(account.name ?? '')).filter(Boolean);
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class FleetRentalBot {
  private readonly connection: Connection;
  private readonly wallet: Keypair;
  private readonly provider: AnchorProvider;
  private readonly srslyProgramId: PublicKey;
  private readonly analysisPath: string;
  private readonly logFilePath: string;
  private readonly stateFilePath: string;
  private readonly rpcCounterFilePath: string;
  private readonly runtimeByRule = new Map<string, RuleRuntimeState>();
  private running = false;
  private loopTimer: NodeJS.Timeout | null = null;
  private cycleInProgress = false;
  private startedAt: string | null = null;
  private lastCycleStartedAt: string | null = null;
  private lastCycleCompletedAt: string | null = null;
  private lastCycleDurationMs: number | null = null;
  private solBalanceCache: number | null = null;
  private atlasBalanceCache: number | null = null;
  private srslyProgram: Program | null = null;
  private readonly successfulRentKeys = new Set<string>();
  private readonly aggressiveIntervalTimers = new Map<string, NodeJS.Timeout>();
  private readonly aggressiveRuntimeByRule = new Map<string, AggressiveRuntimeState>();
  private readonly aggressiveStartInFlightByRule = new Set<string>();
  private readonly scheduledAggressiveWindows = new Map<string, ScheduledAggressiveWindow>();
  private aggressiveSchedulerTimer: NodeJS.Timeout | null = null;
  private readonly preparedRentByRule = new Map<string, PreparedRentTransaction>();
  private readonly preparingRentByRule = new Map<string, Promise<PreparedRentTransaction>>();
  private readonly missedAggressiveWindowKeys = new Set<string>();
  private readonly rentalContractSubscriptionIds = new Map<string, number>();
  private readonly observedRentEndMsByRule = new Map<string, number>();
  private readonly confirmedAvailabilityWatchdogLastPollAtMsByContract = new Map<string, number>();
  private readonly confirmedAvailabilityTriggeredEpochByRule = new Map<string, number>();
  private readonly confirmedAvailabilityInFlightByRule = new Set<string>();
  private readonly confirmedAvailabilityDecodeFailureCache = new Map<string, { expiresAt: number; message: string }>();
  private confirmedAvailabilityWatchdogTimer: NodeJS.Timeout | null = null;
  private confirmedAvailabilityWatchdogInFlight = false;
  private blockhashCache: CachedBlockhash | null = null;
  private blockhashRefreshTimer: NodeJS.Timeout | null = null;
  private blockhashRefreshInFlight: Promise<CachedBlockhash> | null = null;
  private aggressiveRunSequence = 0;
  private readonly sharedAggressiveLimiter = new RpcLimiter();
  private sharedAggressiveExclusiveHolders = 0;

  constructor(
    private readonly config: FleetRentalBotConfig,
    private readonly logger: FleetRentalBotLogger = defaultLogger,
  ) {
    const secretKeyBytes = decodeSecret(config.hotWalletSecret);
    this.wallet = secretKeyBytes.length === 32 ? Keypair.fromSeed(secretKeyBytes) : Keypair.fromSecretKey(secretKeyBytes);

    // Prefix analysisDir with instance name when analysisDir is a bare name (relative path with no path separator).
    // e.g. instanceName="PROFILE_NAME" + analysisDir="analysis" -> "PROFILE_NAME-analysis"
    // This keeps each instance's state/log files isolated without requiring absolute paths.
    const rawAnalysisDir = config.analysisDir ?? 'analysis';
    const analysisDir =
      config.instanceName && rawAnalysisDir && !path.isAbsolute(rawAnalysisDir) && !rawAnalysisDir.startsWith('~') && !rawAnalysisDir.includes(path.sep) && !rawAnalysisDir.includes('/')
        ? `${config.instanceName}-${rawAnalysisDir}`
        : rawAnalysisDir;
    this.analysisPath = path.resolve(process.cwd(), analysisDir);
    this.logFilePath = path.join(this.analysisPath, 'rental-log.jsonl');
    this.stateFilePath = path.join(this.analysisPath, 'bot-state.json');
    this.rpcCounterFilePath = path.join(this.analysisPath, 'rpc-method-counters.jsonl');

    this.connection = createFailoverConnection(
      config.rpcUrl,
      config.rpcUrlFallback,
      this.logger,
      () => this.config.useRpcLimiter,
      this.config.instanceName || 'default',
      (snapshot) => {
        void this.appendRpcCounterSnapshot(snapshot);
      },
    );
    this.provider = new AnchorProvider(this.connection, new Wallet(this.wallet), { commitment: 'confirmed' });
    this.srslyProgramId = new PublicKey(config.srslyProgramId);
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    await this.ensureAnalysisFiles();
    await this.loadState();
    this.startedAt = new Date().toISOString();
    this.running = true;
    await this.appendLog({ event: 'START' });
    this.logger.info(`Hot wallet: ${this.wallet.publicKey.toBase58()}`);
    this.logger.info(`SRSLY program: ${this.srslyProgramId.toBase58()}`);
    this.logger.info(`Managing ${this.config.rentalRules.length} rental rule(s). Dry run: ${this.config.dryRun ? 'yes' : 'no'}.`);
    await this.startConfirmedAvailabilitySubscriptions();
    this.startConfirmedAvailabilityWatchdog();

    // Immediate check: rent any available enabled fleets right now, before entering the loop
    for (const rule of this.config.rentalRules) {
      if (rule.enabled) {
        await this.processRule(rule);
      }
    }

    await this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopConfirmedAvailabilityWatchdog();
    await this.stopConfirmedAvailabilitySubscriptions();
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    for (const timer of this.aggressiveIntervalTimers.values()) clearInterval(timer);
    if (this.aggressiveSchedulerTimer) {
      clearInterval(this.aggressiveSchedulerTimer);
      this.aggressiveSchedulerTimer = null;
    }
    const heldSharedExclusive = [...this.aggressiveRuntimeByRule.values()].some((runtime) => runtime.sharedExclusiveHeld);
    this.aggressiveIntervalTimers.clear();
    this.aggressiveStartInFlightByRule.clear();
    this.aggressiveRuntimeByRule.clear();
    this.scheduledAggressiveWindows.clear();
    this.preparedRentByRule.clear();
    this.preparingRentByRule.clear();
    this.observedRentEndMsByRule.clear();
    this.confirmedAvailabilityWatchdogLastPollAtMsByContract.clear();
    this.confirmedAvailabilityTriggeredEpochByRule.clear();
    this.confirmedAvailabilityInFlightByRule.clear();
    this.stopBlockhashRefresh();
    this.successfulRentKeys.clear();
    this.sharedAggressiveExclusiveHolders = 0;
    if (heldSharedExclusive && this.config.useRpcLimiter && !this.config.dryRun) {
      await this.sharedAggressiveLimiter.releaseExclusive();
    }
  }

  async getStatusSnapshot(): Promise<FleetRentalBotStatus> {
    const [solBalance, atlasBalance] = await Promise.all([this.getSolBalance(), this.getAtlasBalance()]);
    const ruleHealth = this.config.rentalRules.map((rule) => this.buildRuleHealth(rule));
    const recentActivity = await this.readRecentActivity();
    return {
      running: this.running,
      wallet: this.wallet.publicKey.toBase58(),
      ownerWallet: this.config.ownerWallet,
      ownerProfile: this.config.ownerProfile,
      srslyProgramId: this.config.srslyProgramId,
      dryRun: this.config.dryRun,
      solBalance,
      atlasBalance,
      startedAt: this.startedAt,
      lastCycleStartedAt: this.lastCycleStartedAt,
      lastCycleCompletedAt: this.lastCycleCompletedAt,
      lastCycleDurationMs: this.lastCycleDurationMs,
      activeRuleCount: this.config.rentalRules.filter((rule) => rule.enabled).length,
      ruleHealth,
      recentActivity,
    };
  }

  async runRuleNow(fleetAccount: string): Promise<FleetRentalRuleHealth | null> {
    const rule = this.config.rentalRules.find((candidate) => candidate.fleetAccount === fleetAccount);
    if (!rule) return null;
    await this.processRule(rule, { force: true });
    return this.buildRuleHealth(rule);
  }

  private async loop(): Promise<void> {
    if (!this.running || this.cycleInProgress) return;
    this.cycleInProgress = true;
    const started = Date.now();
    this.lastCycleStartedAt = new Date(started).toISOString();

    try {
      for (const rule of this.config.rentalRules) {
        await this.processRule(rule);
      }
    } catch (err) {
      this.logger.error('Fleet rental cycle failed:', err);
      await this.appendLog({ event: 'CYCLE_ERROR', message: formatError(err) });
    } finally {
      this.lastCycleCompletedAt = new Date().toISOString();
      this.lastCycleDurationMs = Date.now() - started;
      this.cycleInProgress = false;
      if (this.running) {
        this.loopTimer = setTimeout(() => void this.loop(), GENERAL_CHECK_INTERVAL_SECONDS * MS_PER_SECOND);
      }
    }
  }

  private async startConfirmedAvailabilitySubscriptions(): Promise<void> {
    for (const rule of this.config.rentalRules) {
      if (!rule.enabled || this.rentalContractSubscriptionIds.has(rule.rentalContract)) continue;

      const rentalContract = rule.rentalContract;
      try {
        const subscriptionId = await this.connection.onAccountChange(
          new PublicKey(rentalContract),
          () => {
            void this.handleConfirmedAvailabilityAccountChange(rentalContract).catch((err: unknown) => {
              this.logger.warn(`Confirmed availability check failed for rental contract ${rentalContract}:`, err);
            });
          },
          'confirmed',
        );
        this.rentalContractSubscriptionIds.set(rentalContract, subscriptionId);
        const message = `Confirmed availability watcher subscribed for ${rule.fleetName}`;
        this.logger.info(message);
        await this.appendLog({
          event: 'CONFIRMED_AVAILABILITY_SUBSCRIBED',
          label: rule.fleetName,
          fleetAccount: rule.fleetAccount,
          rentalContract,
          subscriptionId,
          message,
        });
      } catch (err) {
        const message = `Could not subscribe confirmed availability watcher for ${rule.fleetName}: ${formatError(err)}`;
        this.logger.warn(message);
        await this.appendLog({
          event: 'CONFIRMED_AVAILABILITY_SUBSCRIBE_FAILED',
          label: rule.fleetName,
          fleetAccount: rule.fleetAccount,
          rentalContract,
          message,
        });
      }
    }
  }

  private async stopConfirmedAvailabilitySubscriptions(): Promise<void> {
    const entries = [...this.rentalContractSubscriptionIds.entries()];
    this.rentalContractSubscriptionIds.clear();
    for (const [rentalContract, subscriptionId] of entries) {
      try {
        await this.connection.removeAccountChangeListener(subscriptionId);
      } catch (err) {
        this.logger.warn(`Could not remove confirmed availability watcher for ${rentalContract}:`, err);
      }
    }
  }

  private startConfirmedAvailabilityWatchdog(): void {
    if (this.confirmedAvailabilityWatchdogTimer) return;
    this.confirmedAvailabilityWatchdogTimer = setInterval(() => {
      void this.runConfirmedAvailabilityWatchdog().catch((err: unknown) => {
        this.logger.warn('Confirmed availability watchdog failed:', err);
      });
    }, CONFIRMED_AVAILABILITY_WATCHDOG_INTERVAL_MS);
  }

  private stopConfirmedAvailabilityWatchdog(): void {
    if (this.confirmedAvailabilityWatchdogTimer) {
      clearInterval(this.confirmedAvailabilityWatchdogTimer);
      this.confirmedAvailabilityWatchdogTimer = null;
    }
    this.confirmedAvailabilityWatchdogInFlight = false;
  }

  private async runConfirmedAvailabilityWatchdog(): Promise<void> {
    if (!this.running || this.confirmedAvailabilityWatchdogInFlight) return;
    this.confirmedAvailabilityWatchdogInFlight = true;
    try {
      await this.startConfirmedAvailabilitySubscriptions();
      const rentalContracts = new Set(
        this.config.rentalRules
          .filter((rule) => rule.enabled)
          .map((rule) => rule.rentalContract),
      );
      for (const rentalContract of rentalContracts) {
        if (!this.shouldPollConfirmedAvailabilityContract(rentalContract)) continue;
        try {
          this.confirmedAvailabilityWatchdogLastPollAtMsByContract.set(rentalContract, Date.now());
          await this.handleConfirmedAvailabilityAccountChange(rentalContract);
        } catch (err) {
          this.logger.warn(`Confirmed availability watchdog check failed for ${rentalContract}:`, err);
        }
      }
    } finally {
      this.confirmedAvailabilityWatchdogInFlight = false;
    }
  }

  private shouldPollConfirmedAvailabilityContract(rentalContract: string): boolean {
    const nowMs = Date.now();
    const matchingRules = this.config.rentalRules.filter((rule) => rule.enabled && rule.rentalContract === rentalContract);
    if (matchingRules.length === 0) return false;

    let hasUnknownEnd = false;
    for (const rule of matchingRules) {
      const observedEndMs = this.observedRentEndMsByRule.get(getRuleKey(rule));
      if (observedEndMs == null) {
        hasUnknownEnd = true;
        continue;
      }
      if (observedEndMs <= nowMs + CONFIRMED_AVAILABILITY_WATCHDOG_NEAR_END_MS) {
        return true;
      }
    }

    if (!hasUnknownEnd) return false;

    const lastPollAtMs = this.confirmedAvailabilityWatchdogLastPollAtMsByContract.get(rentalContract) ?? 0;
    return nowMs - lastPollAtMs >= CONFIRMED_AVAILABILITY_WATCHDOG_UNKNOWN_END_INTERVAL_MS;
  }

  private async handleConfirmedAvailabilityAccountChange(rentalContract: string): Promise<void> {
    if (!this.running) return;
    const matchingRules = this.config.rentalRules.filter((rule) => rule.enabled && rule.rentalContract === rentalContract);
    if (matchingRules.length === 0) return;

    let snapshot: RentalContractSnapshot;
    try {
      snapshot = await this.fetchRentalContractSnapshot(rentalContract);
    } catch (err) {
      await this.appendLog({
        event: 'CONFIRMED_AVAILABILITY_FETCH_FAILED',
        rentalContract,
        message: formatError(err),
      });
      throw err;
    }

    for (const rule of matchingRules) {
      this.rememberObservedRentEnd(rule, snapshot);
      const endsAtMs = snapshot.endsAt?.getTime() ?? null;
      if (snapshot.hasCurrentRentalState && endsAtMs != null && endsAtMs <= Date.now()) {
        this.runtimeByRule.set(getRuleKey(rule), {
          ...(this.runtimeByRule.get(getRuleKey(rule)) ?? this.createInitialRuntimeState()),
          status: 'pending',
          currentPricePerDay: snapshot.pricePerDay,
          rentEndsAt: snapshot.endsAt?.toISOString() ?? null,
          secondsUntilEnd: Math.floor((endsAtMs - Date.now()) / MS_PER_SECOND),
          lastActionAt: new Date().toISOString(),
          note: 'Contract ended, waiting for SRSLY relist confirmation',
        });
        await this.saveState();
      }
      if (!this.isSnapshotDue(snapshot)) continue;
      await this.maybeTriggerConfirmedAvailabilityRent(rule, snapshot);
    }
  }

  private rememberObservedRentEnd(rule: FleetRentalRuleConfig, snapshot: RentalContractSnapshot): void {
    const endsAtMs = snapshot.endsAt?.getTime();
    if (endsAtMs != null && Number.isFinite(endsAtMs)) {
      this.observedRentEndMsByRule.set(getRuleKey(rule), endsAtMs);
    }
  }

  private isSnapshotDue(snapshot: RentalContractSnapshot): boolean {
    if (snapshot.hasCurrentRentalState) return false;
    const endsAtMs = snapshot.endsAt?.getTime() ?? null;
    return endsAtMs == null || endsAtMs <= Date.now();
  }

  private async maybeTriggerConfirmedAvailabilityRent(rule: FleetRentalRuleConfig, snapshot: RentalContractSnapshot): Promise<void> {
    const key = getRuleKey(rule);
    if (!this.running || !rule.enabled || this.successfulRentKeys.has(key)) return;
    if (this.confirmedAvailabilityInFlightByRule.has(key)) return;

    const previousRentEndMs = this.observedRentEndMsByRule.get(key) ?? 0;
    const triggeredEpochMs = this.confirmedAvailabilityTriggeredEpochByRule.get(key);
    if (triggeredEpochMs === previousRentEndMs && previousRentEndMs > 0) {
      await this.appendLog({
        event: 'CONFIRMED_AVAILABLE_SKIP_REARM',
        label: rule.fleetName,
        fleetAccount: rule.fleetAccount,
        rentalContract: rule.rentalContract,
        previousRentEndsAt: new Date(previousRentEndMs).toISOString(),
        message: `Confirmed availability suppressed for ${rule.fleetName}: already triggered for this rental-end epoch (cleared after failed or unknown outcomes)`,
      });
      return;
    }

    if (snapshot.pricePerDay == null) {
      await this.appendLog({
        event: 'CONFIRMED_AVAILABLE_SKIP_UNKNOWN_PRICE',
        label: rule.fleetName,
        fleetAccount: rule.fleetAccount,
        rentalContract: rule.rentalContract,
        message: `Confirmed availability skipped for ${rule.fleetName}: could not infer price`,
      });
      return;
    }
    if (snapshot.pricePerDay > rule.maxRentPricePerDay) {
      await this.appendLog({
        event: 'CONFIRMED_AVAILABLE_SKIP_PRICE',
        label: rule.fleetName,
        fleetAccount: rule.fleetAccount,
        rentalContract: rule.rentalContract,
        pricePerDay: snapshot.pricePerDay,
        message: `Confirmed availability skipped for ${rule.fleetName}: price ${snapshot.pricePerDay} > max ${rule.maxRentPricePerDay}`,
      });
      return;
    }
    if (snapshot.toClose) {
      await this.appendLog({
        event: 'CONFIRMED_AVAILABLE_SKIP_CLOSING',
        label: rule.fleetName,
        fleetAccount: rule.fleetAccount,
        rentalContract: rule.rentalContract,
        message: `Confirmed availability skipped for ${rule.fleetName}: rental contract is closing`,
      });
      return;
    }

    this.confirmedAvailabilityTriggeredEpochByRule.set(key, previousRentEndMs);
    this.confirmedAvailabilityInFlightByRule.add(key);
    const now = new Date().toISOString();
    const triggerMessage = `Confirmed availability detected for ${rule.fleetName}; submitting rent transaction`;
    this.logger.info(triggerMessage);
    this.runtimeByRule.set(key, {
      ...(this.runtimeByRule.get(key) ?? this.createInitialRuntimeState()),
      status: 'renting',
      currentPricePerDay: snapshot.pricePerDay,
      rentEndsAt: snapshot.endsAt?.toISOString() ?? null,
      secondsUntilEnd: snapshot.endsAt ? Math.floor((snapshot.endsAt.getTime() - Date.now()) / MS_PER_SECOND) : null,
      lastActionAt: now,
      note: triggerMessage,
    });
    await this.saveState();
    await this.appendLog({
      event: 'CONFIRMED_AVAILABLE_TRIGGER',
      label: rule.fleetName,
      fleetAccount: rule.fleetAccount,
      rentalContract: rule.rentalContract,
      pricePerDay: snapshot.pricePerDay,
      previousRentEndsAt: previousRentEndMs > 0 ? new Date(previousRentEndMs).toISOString() : null,
      message: triggerMessage,
    });

    if (this.config.dryRun) {
      this.confirmedAvailabilityInFlightByRule.delete(key);
      await this.appendLog({
        event: 'DRY_RUN_CONFIRMED_AVAILABLE_RENT',
        label: rule.fleetName,
        fleetAccount: rule.fleetAccount,
        rentalContract: rule.rentalContract,
        pricePerDay: snapshot.pricePerDay,
        message: `Dry run: would rent ${rule.fleetName} after confirmed availability`,
      });
      return;
    }

    try {
      const prepared = await this.prepareRentForAggressive(rule);
      const priorityFee = this.config.heliusPriorityFeeMaxMicroLamports;
      const submission = await this.signAndSubmitInstructions(prepared.instructions, AGGRESSIVE_PRIORITY_FEE_LADDER_STEPS, {
        preferCachedBlockhash: true,
        fixedPriorityFeeMicroLamports: priorityFee,
      });
      this.runtimeByRule.set(key, {
        ...(this.runtimeByRule.get(key) ?? this.createInitialRuntimeState()),
        lastTx: submission.signature,
        note: `Confirmed availability transaction submitted: ${submission.signature}`,
      });
      await this.saveState();
      await this.appendLog({
        event: 'CONFIRMED_AVAILABLE_TX_SUBMITTED',
        label: rule.fleetName,
        fleetAccount: rule.fleetAccount,
        rentalContract: rule.rentalContract,
        tx: submission.signature,
        priorityFeeMicroLamports: priorityFee,
        message: `Confirmed availability transaction submitted: ${submission.signature} (${priorityFee} microLamports/CU)`,
      });
      void this.checkConfirmedAvailabilityOutcome(rule, previousRentEndMs, submission.signature).catch((err: unknown) => {
        this.logger.warn(`Confirmed availability outcome check failed for ${rule.fleetName}:`, err);
      });
    } catch (err) {
      this.confirmedAvailabilityInFlightByRule.delete(key);
      this.confirmedAvailabilityTriggeredEpochByRule.delete(key);
      this.runtimeByRule.set(key, {
        ...(this.runtimeByRule.get(key) ?? this.createInitialRuntimeState()),
        status: 'error',
        lastActionAt: new Date().toISOString(),
        note: formatError(err),
      });
      await this.saveState();
      await this.appendLog({
        event: 'CONFIRMED_AVAILABLE_TX_FAILED',
        label: rule.fleetName,
        fleetAccount: rule.fleetAccount,
        rentalContract: rule.rentalContract,
        message: formatError(err),
      });
    }
  }

  private async processRule(rule: FleetRentalRuleConfig, options?: { force?: boolean }) {
    const key = getRuleKey(rule);
    const update = (patch: Partial<RuleRuntimeState>) => {
      const existing = this.runtimeByRule.get(key) ?? this.createInitialRuntimeState();
      this.runtimeByRule.set(key, { ...existing, ...patch });
    };

    if (!rule.enabled) {
      update({ status: 'disabled', note: 'Rule disabled' });
      return;
    }
    if (this.successfulRentKeys.has(key) && !options?.force) {
      update({ status: 'rented', note: 'Rental already succeeded in this session' });
      return;
    }

    update({ status: 'waiting', note: undefined });

    let snapshot: RentalContractSnapshot | null = null;
    try {
      snapshot = await this.fetchRentalContractSnapshot(rule.rentalContract);
      this.rememberObservedRentEnd(rule, snapshot);
      const secondsUntilEnd = snapshot.endsAt ? Math.floor((snapshot.endsAt.getTime() - Date.now()) / MS_PER_SECOND) : null;
      update({
        currentPricePerDay: snapshot.pricePerDay,
        rentEndsAt: snapshot.endsAt?.toISOString() ?? null,
        secondsUntilEnd,
      });

      if (snapshot.pricePerDay == null) {
        update({ status: 'unknown', note: `Could not infer rent price from ${snapshot.rawAccountType ?? 'contract account'}` });
        return;
      }

      if (snapshot.pricePerDay > rule.maxRentPricePerDay) {
        update({ status: 'blocked', note: `Current price ${snapshot.pricePerDay} > max ${rule.maxRentPricePerDay}` });
        return;
      }

      if (snapshot.toClose) {
        if (snapshot.endsAt) {
          update({ status: 'unavailable', note: 'Rental contract is closing after the current rental; aggressive phase disabled' });
          return;
        }
        update({ status: 'blocked', note: 'Rental contract is closing and will not relist' });
        return;
      }

      if (snapshot.endsAt && snapshot.endsAt.getTime() + this.config.aggressiveStopAfterEndSeconds * MS_PER_SECOND > Date.now()) {
        this.scheduleAggressivePhase(rule, snapshot.endsAt);
        this.scheduleAggressivePreparation(rule, snapshot.endsAt);
      }

      const nowMs = Date.now();
      const aggressiveStopMs = snapshot.endsAt
        ? snapshot.endsAt.getTime() + this.config.aggressiveStopAfterEndSeconds * MS_PER_SECOND
        : null;
      const inAggressiveWindow = aggressiveStopMs != null && nowMs <= aggressiveStopMs && secondsUntilEnd != null && secondsUntilEnd <= this.config.aggressiveStartBeforeEndSeconds;

      if (inAggressiveWindow && snapshot.endsAt) {
        this.ensureAggressiveScheduler();
        update({ status: 'due', note: `Aggressive sending active (${secondsUntilEnd}s until end)` });
        return;
      }

      if (snapshot.hasCurrentRentalState) {
        if (secondsUntilEnd != null && secondsUntilEnd <= 0) {
          update({ status: 'pending', note: 'Contract ended, waiting for SRSLY relist confirmation' });
          return;
        }
        update({ status: 'unavailable', note: snapshot.rentedByYou ? 'Fleet is currently rented by YOU' : 'Fleet is currently rented by someone' });
        return;
      }

      const due = !snapshot.endsAt || secondsUntilEnd == null || secondsUntilEnd <= 0;
      if (!due) {
        update({ status: 'waiting', note: 'Waiting for confirmed availability' });
        return;
      }

      update({ status: 'due', note: 'Rental due for renewal' });
      await this.rentRule(rule, snapshot);
    } catch (err) {
      update({ status: 'error', note: formatError(err) });
      this.logger.error(`Rule failed for ${rule.fleetName}:`, err);
      await this.appendLog({
        event: 'RULE_ERROR',
        label: rule.fleetName,
        fleetAccount: rule.fleetAccount,
        rentalContract: rule.rentalContract,
        message: formatError(err),
      });
    } finally {
      await this.saveState();
    }
  }

  private scheduleAggressivePhase(rule: FleetRentalRuleConfig, rentEndsAt: Date) {
    if (!rule.enabled) return;
    const key = getRuleKey(rule);
    if (this.scheduledAggressiveWindows.has(key) || this.aggressiveIntervalTimers.has(key)) return;

    const { prepareAtMs, startAtMs, stopAtMs } = calculateAggressiveWindow(
      rentEndsAt.getTime(),
      this.config.aggressiveStartBeforeEndSeconds,
      this.config.aggressiveStopAfterEndSeconds,
    );
    const delayMs = Math.max(0, startAtMs - Date.now());
    this.scheduledAggressiveWindows.set(key, {
      fleetName: rule.fleetName,
      fleetAccount: rule.fleetAccount,
      rentalContract: rule.rentalContract,
      rentEndsAtMs: rentEndsAt.getTime(),
      prepareAtMs,
      startAtMs,
      stopAtMs,
    });
    this.ensureAggressiveScheduler();
    const message = `Aggressive phase scheduled for ${rule.fleetName}: starts at ${new Date(startAtMs).toISOString()} (${Math.ceil(delayMs / MS_PER_SECOND)}s), ends at ${new Date(stopAtMs).toISOString()}`;
    this.logger.info(message);
    void this.appendLog({
      event: 'AGGRESSIVE_SCHEDULED',
      label: rule.fleetName,
      fleetAccount: rule.fleetAccount,
      rentalContract: rule.rentalContract,
      startAt: new Date(startAtMs).toISOString(),
      rentEndsAt: rentEndsAt.toISOString(),
      stopAt: new Date(stopAtMs).toISOString(),
      delayMs,
      aggressiveStartBeforeEndSeconds: this.config.aggressiveStartBeforeEndSeconds,
      aggressiveStopAfterEndSeconds: this.config.aggressiveStopAfterEndSeconds,
      message,
    });
  }

  private scheduleAggressivePreparation(rule: FleetRentalRuleConfig, rentEndsAt: Date) {
    if (!rule.enabled || this.config.dryRun) return;
    const key = getRuleKey(rule);
    if (this.preparedRentByRule.has(key) || this.preparingRentByRule.has(key)) return;

    const { prepareAtMs, startAtMs } = calculateAggressiveWindow(
      rentEndsAt.getTime(),
      this.config.aggressiveStartBeforeEndSeconds,
      this.config.aggressiveStopAfterEndSeconds,
    );
    const delayMs = Math.max(0, prepareAtMs - Date.now());
    const scheduledMessage = `Aggressive preparation scheduled for ${rule.fleetName}: starts at ${new Date(prepareAtMs).toISOString()} (${Math.ceil(delayMs / MS_PER_SECOND)}s before timer)`;
    this.logger.info(scheduledMessage);
    void this.appendLog({
      event: 'AGGRESSIVE_PREPARE_SCHEDULED',
      label: rule.fleetName,
      fleetAccount: rule.fleetAccount,
      rentalContract: rule.rentalContract,
      prepareAt: new Date(prepareAtMs).toISOString(),
      startAt: new Date(startAtMs).toISOString(),
      rentEndsAt: rentEndsAt.toISOString(),
      delayMs,
      prepareBeforeStartMs: AGGRESSIVE_PREPARE_BEFORE_START_MS,
      message: scheduledMessage,
    });
    this.ensureAggressiveScheduler();

    const blockhashPrewarmAtMs = startAtMs - AGGRESSIVE_BLOCKHASH_PREWARM_MS;
    const blockhashDelayMs = Math.max(0, blockhashPrewarmAtMs - Date.now());
    setTimeout(() => {
      if (this.running && !this.successfulRentKeys.has(key)) {
        this.startBlockhashRefresh();
      }
    }, blockhashDelayMs);
  }

  private ensureAggressiveScheduler(): void {
    if (this.aggressiveSchedulerTimer || !this.running) return;
    this.aggressiveSchedulerTimer = setInterval(() => {
      void this.runAggressiveSchedulerTick().catch((err: unknown) => {
        this.logger.error('Aggressive scheduler tick failed:', err);
        void this.appendLog({ event: 'AGGRESSIVE_SCHEDULER_ERROR', message: formatError(err) });
      });
    }, AGGRESSIVE_SCHEDULER_TICK_MS);
  }

  private stopAggressiveSchedulerIfIdle(): void {
    if (!this.aggressiveSchedulerTimer) return;
    if (this.scheduledAggressiveWindows.size > 0) return;
    clearInterval(this.aggressiveSchedulerTimer);
    this.aggressiveSchedulerTimer = null;
  }

  private async runAggressiveSchedulerTick(): Promise<void> {
    if (!this.running) return;
    const nowMs = Date.now();
    const windows = [...this.scheduledAggressiveWindows.entries()].sort(([, a], [, b]) => a.startAtMs - b.startAtMs);

    for (const [key, window] of windows) {
      const rule = this.config.rentalRules.find((candidate) => getRuleKey(candidate) === key);
      if (!rule || !rule.enabled || this.successfulRentKeys.has(key)) {
        this.scheduledAggressiveWindows.delete(key);
        continue;
      }

      if (
        !this.config.dryRun &&
        nowMs >= window.prepareAtMs &&
        !this.preparedRentByRule.has(key) &&
        !this.preparingRentByRule.has(key) &&
        !this.aggressiveIntervalTimers.has(key)
      ) {
        this.startAggressivePreparationFromScheduler(rule, window, nowMs);
      }

      if (
        nowMs >= window.startAtMs &&
        !this.aggressiveRuntimeByRule.has(key) &&
        !this.aggressiveIntervalTimers.has(key) &&
        !this.aggressiveStartInFlightByRule.has(key)
      ) {
        await this.startAggressiveSendingFromScheduler(rule, window, nowMs);
      }
    }

    this.stopAggressiveSchedulerIfIdle();
  }

  private startAggressivePreparationFromScheduler(rule: FleetRentalRuleConfig, window: ScheduledAggressiveWindow, nowMs: number): void {
    const driftMs = nowMs - window.prepareAtMs;
    const startedMessage = `Aggressive preparation started for ${rule.fleetName}`;
    this.logger.info(startedMessage);
    void this.appendLog({
      event: 'AGGRESSIVE_PREPARE_START',
      label: rule.fleetName,
      fleetAccount: rule.fleetAccount,
      rentalContract: rule.rentalContract,
      prepareAt: new Date(window.prepareAtMs).toISOString(),
      actualAt: new Date(nowMs).toISOString(),
      driftMs,
      startAt: new Date(window.startAtMs).toISOString(),
      rentEndsAt: new Date(window.rentEndsAtMs).toISOString(),
      message: startedMessage,
    });
    if (driftMs > AGGRESSIVE_TIMER_DRIFT_WARN_MS) {
      void this.appendAggressiveTimerDrift(rule, 'prepare', window.prepareAtMs, nowMs);
    }
    void this.prepareRentForAggressive(rule).catch((err: unknown) => {
      const message = `Could not prepare aggressive rent transaction for ${rule.fleetName}: ${formatError(err)}`;
      this.logger.warn(message);
      void this.appendLog({
        event: 'AGGRESSIVE_PREPARE_FAILED',
        label: rule.fleetName,
        fleetAccount: rule.fleetAccount,
        rentalContract: rule.rentalContract,
        prepareAt: new Date(window.prepareAtMs).toISOString(),
        actualAt: new Date(Date.now()).toISOString(),
        startAt: new Date(window.startAtMs).toISOString(),
        rentEndsAt: new Date(window.rentEndsAtMs).toISOString(),
        message,
      });
    });
  }

  private async startAggressiveSendingFromScheduler(rule: FleetRentalRuleConfig, window: ScheduledAggressiveWindow, nowMs: number): Promise<void> {
    const key = getRuleKey(rule);
    const driftMs = nowMs - window.startAtMs;
    if (driftMs > AGGRESSIVE_TIMER_DRIFT_WARN_MS) {
      await this.appendAggressiveTimerDrift(rule, 'start', window.startAtMs, nowMs);
    }
    this.aggressiveStartInFlightByRule.add(key);
    try {
      await this.beginAggressiveSendingWithExclusive(rule, new Date(window.rentEndsAtMs));
    } finally {
      this.aggressiveStartInFlightByRule.delete(key);
      this.stopAggressiveSchedulerIfIdle();
    }
  }

  private async appendAggressiveTimerDrift(
    rule: FleetRentalRuleConfig,
    phase: 'prepare' | 'start',
    scheduledAtMs: number,
    actualAtMs: number,
  ): Promise<void> {
    const driftMs = actualAtMs - scheduledAtMs;
    const message = `Aggressive ${phase} timer drift for ${rule.fleetName}: ${driftMs}ms late`;
    this.logger.warn(message);
    await this.appendLog({
      event: 'AGGRESSIVE_TIMER_DRIFT',
      label: rule.fleetName,
      fleetAccount: rule.fleetAccount,
      rentalContract: rule.rentalContract,
      phase,
      scheduledAt: new Date(scheduledAtMs).toISOString(),
      actualAt: new Date(actualAtMs).toISOString(),
      driftMs,
      message,
    });
  }

  private async prepareRentForAggressive(rule: FleetRentalRuleConfig): Promise<PreparedRentTransaction> {
    const key = getRuleKey(rule);
    const existing = this.preparedRentByRule.get(key);
    if (existing) return existing;
    const inFlight = this.preparingRentByRule.get(key);
    if (inFlight) return inFlight;

    const promise = this.buildRentTransaction(rule)
      .then((transaction) => {
        const prepared: PreparedRentTransaction = {
          instructions: [...transaction.instructions],
          preparedAtMs: Date.now(),
        };
        this.preparedRentByRule.set(key, prepared);
        const message = `Prepared aggressive rent transaction for ${rule.fleetName}`;
        this.logger.info(message);
        void this.appendLog({
          event: 'AGGRESSIVE_PREPARED',
          label: rule.fleetName,
          fleetAccount: rule.fleetAccount,
          rentalContract: rule.rentalContract,
          message,
        });
        return prepared;
      })
      .finally(() => {
        this.preparingRentByRule.delete(key);
      });
    this.preparingRentByRule.set(key, promise);
    return promise;
  }

  private startBlockhashRefresh() {
    if (this.blockhashRefreshTimer) return;
    void this.refreshBlockhash().catch((err: unknown) => {
      this.logger.warn('Initial aggressive blockhash refresh failed:', err);
    });
    this.blockhashRefreshTimer = setInterval(() => {
      void this.refreshBlockhash().catch((err: unknown) => {
        this.logger.warn('Aggressive blockhash refresh failed:', err);
      });
    }, AGGRESSIVE_BLOCKHASH_REFRESH_INTERVAL_MS);
  }

  private stopBlockhashRefresh() {
    if (this.blockhashRefreshTimer) {
      clearInterval(this.blockhashRefreshTimer);
      this.blockhashRefreshTimer = null;
    }
    this.blockhashCache = null;
    this.blockhashRefreshInFlight = null;
  }

  private async refreshBlockhash(): Promise<CachedBlockhash> {
    if (this.blockhashRefreshInFlight) return this.blockhashRefreshInFlight;
    this.blockhashRefreshInFlight = this.connection
      .getLatestBlockhash('confirmed')
      .then((latest) => {
        const cached: CachedBlockhash = {
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
          fetchedAtMs: Date.now(),
        };
        this.blockhashCache = cached;
        return cached;
      })
      .finally(() => {
        this.blockhashRefreshInFlight = null;
      });
    return this.blockhashRefreshInFlight;
  }

  private async getBlockhashForSubmit(preferCache: boolean): Promise<CachedBlockhash> {
    const cached = this.blockhashCache;
    if (preferCache && cached && Date.now() - cached.fetchedAtMs <= AGGRESSIVE_BLOCKHASH_MAX_AGE_MS) {
      return cached;
    }
    return this.refreshBlockhash();
  }

  private async acquireAggressiveExclusive(rule: FleetRentalRuleConfig, stopAtMs: number): Promise<boolean> {
    if (!this.config.useRpcLimiter || this.config.dryRun) return true;

    const durationMs = Math.max(1, stopAtMs - Date.now());
    const label = `fleet:aggressive:${this.config.instanceName || rule.fleetName}`;
    const result = await this.sharedAggressiveLimiter.acquireExclusive(label, durationMs, {
      priorityHint: rule.maxRentPricePerDay,
    });
    if (!result.ok) {
      const holderLabel = result.reason === 'preempted' ? result.holder?.label : '';
      const holder = holderLabel ? ` holder=${holderLabel}` : '';
      const message = `Aggressive sending skipped for ${rule.fleetName}: shared RPC limiter exclusive ${result.reason}.${holder}`;
      this.logger.warn(message);
      this.runtimeByRule.set(getRuleKey(rule), {
        ...(this.runtimeByRule.get(getRuleKey(rule)) ?? this.createInitialRuntimeState()),
        status: 'blocked',
        note: message,
        lastActionAt: new Date().toISOString(),
      });
      await this.appendLog({
        event: 'AGGRESSIVE_PREEMPTED',
        label: rule.fleetName,
        fleetAccount: rule.fleetAccount,
        rentalContract: rule.rentalContract,
        message,
      });
      return false;
    }

    this.sharedAggressiveExclusiveHolders += 1;
    return true;
  }

  private async releaseAggressiveExclusive(rule: FleetRentalRuleConfig): Promise<void> {
    if (!this.config.useRpcLimiter || this.config.dryRun) return;
    this.sharedAggressiveExclusiveHolders = Math.max(0, this.sharedAggressiveExclusiveHolders - 1);
    if (this.sharedAggressiveExclusiveHolders > 0) return;
    try {
      await this.sharedAggressiveLimiter.releaseExclusive();
    } catch (err) {
      this.logger.warn(`Could not release shared aggressive RPC limiter exclusive for ${rule.fleetName}:`, err);
    }
  }

  private async beginAggressiveSendingWithExclusive(rule: FleetRentalRuleConfig, rentEndsAt: Date) {
    const key = getRuleKey(rule);
    if (!this.running || !rule.enabled || this.aggressiveIntervalTimers.has(key)) return;

    const { startAtMs, stopAtMs } = calculateAggressiveWindow(
      rentEndsAt.getTime(),
      this.config.aggressiveStartBeforeEndSeconds,
      this.config.aggressiveStopAfterEndSeconds,
    );
    const nowMs = Date.now();
    if (nowMs < startAtMs) {
      this.scheduleAggressivePhase(rule, rentEndsAt);
      return;
    }
    if (nowMs > stopAtMs) {
      const missedKey = `${key}:${rentEndsAt.getTime()}`;
      if (!this.missedAggressiveWindowKeys.has(missedKey)) {
        this.missedAggressiveWindowKeys.add(missedKey);
        const message = `Aggressive window missed for ${rule.fleetName}: now ${new Date(nowMs).toISOString()} is after stop ${new Date(stopAtMs).toISOString()}`;
        this.logger.warn(message);
        void this.appendLog({
          event: 'AGGRESSIVE_MISSED_WINDOW',
          label: rule.fleetName,
          fleetAccount: rule.fleetAccount,
          rentalContract: rule.rentalContract,
          startAt: new Date(startAtMs).toISOString(),
          rentEndsAt: rentEndsAt.toISOString(),
          stopAt: new Date(stopAtMs).toISOString(),
          missedAt: new Date(nowMs).toISOString(),
          lateByMs: nowMs - stopAtMs,
          message,
        });
      }
      this.scheduledAggressiveWindows.delete(key);
      this.stopAggressiveSchedulerIfIdle();
      return;
    }

    const sharedExclusiveHeld = await this.acquireAggressiveExclusive(rule, stopAtMs);
    if (!sharedExclusiveHeld) {
      this.scheduledAggressiveWindows.delete(key);
      this.stopAggressiveSchedulerIfIdle();
      return;
    }

    const sendIntervalMs = this.config.useHeliusSender
      ? this.config.aggressiveSendIntervalMs
      : NORMAL_RPC_AGGRESSIVE_SEND_INTERVAL_MS;
    const runtime: AggressiveRuntimeState = {
      token: ++this.aggressiveRunSequence,
      attempts: 0,
      inFlight: 0,
      maxAttempts: MAX_AGGRESSIVE_ATTEMPTS_PER_RULE,
      stopAtMs,
      rentEndsAtMs: rentEndsAt.getTime(),
      lastStatusCheckAtMs: 0,
      statusCheckInFlight: false,
      lastSubmittedSignature: null,
      sharedExclusiveHeld,
    };
    this.aggressiveRuntimeByRule.set(key, runtime);
    this.startBlockhashRefresh();
    if (!this.config.dryRun) {
      void this.prepareRentForAggressive(rule).catch((err: unknown) => {
        this.logger.warn(`Could not prepare aggressive rent transaction for ${rule.fleetName}:`, err);
      });
    }
    const routeLabel = this.config.useHeliusSender ? 'Helius Sender' : 'normal RPC';
    const message = `Aggressive sending started for ${rule.fleetName}; ${routeLabel} every ${sendIntervalMs}ms until ${new Date(stopAtMs).toISOString()} (max ${runtime.maxAttempts}, concurrency ${MAX_AGGRESSIVE_IN_FLIGHT_PER_RULE})`;
    this.logger.info(message);
    void this.appendLog({ event: 'AGGRESSIVE_START', label: rule.fleetName, fleetAccount: rule.fleetAccount, rentalContract: rule.rentalContract, message });

    const sendAttempt = () => {
      const current = this.aggressiveRuntimeByRule.get(key);
      if (!current || current.token !== runtime.token) return;
      this.maybeCheckAggressiveOutcome(rule, current);
      if (!this.running || Date.now() > current.stopAtMs) {
        this.stopAggressiveSending(rule, 'window ended');
        return;
      }
      if (this.successfulRentKeys.has(key)) {
        this.stopAggressiveSending(rule, 'success already recorded');
        return;
      }
      if (current.attempts >= current.maxAttempts) {
        this.stopAggressiveSending(rule, `max attempts reached (${current.maxAttempts})`);
        return;
      }
      if (current.inFlight >= MAX_AGGRESSIVE_IN_FLIGHT_PER_RULE) return;

      current.attempts += 1;
      current.inFlight += 1;
      const attempt = current.attempts;
      void this.submitAggressiveAttempt(rule, attempt, current.token)
        .catch((err: unknown) => {
          this.logger.error(`Aggressive attempt failed for ${rule.fleetName}:`, err);
        })
        .finally(() => {
          const latest = this.aggressiveRuntimeByRule.get(key);
          if (latest && latest.token === current.token) {
            latest.inFlight = Math.max(0, latest.inFlight - 1);
          }
        });
    };

    sendAttempt();
    const timer = setInterval(sendAttempt, sendIntervalMs);
    this.aggressiveIntervalTimers.set(key, timer);
  }

  private stopAggressiveSending(rule: FleetRentalRuleConfig, reason: string) {
    const key = getRuleKey(rule);
    const timer = this.aggressiveIntervalTimers.get(key);
    if (timer) clearInterval(timer);
    this.aggressiveIntervalTimers.delete(key);
    const runtime = this.aggressiveRuntimeByRule.get(key);
    const attempts = runtime?.attempts ?? 0;
    const shouldReleaseExclusive = Boolean(runtime?.sharedExclusiveHeld);
    this.aggressiveRuntimeByRule.delete(key);
    this.scheduledAggressiveWindows.delete(key);
    this.preparedRentByRule.delete(key);
    this.stopAggressiveSchedulerIfIdle();
    if (this.aggressiveIntervalTimers.size === 0) {
      this.stopBlockhashRefresh();
    }
    if (shouldReleaseExclusive) {
      void this.releaseAggressiveExclusive(rule);
    }
    const message = `Aggressive sending stopped for ${rule.fleetName}: ${reason}; attempts=${attempts}`;
    this.logger.info(message);
    void this.appendLog({ event: 'AGGRESSIVE_STOP', label: rule.fleetName, fleetAccount: rule.fleetAccount, rentalContract: rule.rentalContract, message });
  }

  private async submitAggressiveAttempt(rule: FleetRentalRuleConfig, attempt: number, runToken: number) {
    const key = getRuleKey(rule);
    if (this.successfulRentKeys.has(key)) return;
    if (this.config.dryRun) {
      const message = `Dry run: aggressive attempt ${attempt} for ${rule.fleetName}`;
      this.logger.info(message);
      await this.appendLog({ event: 'DRY_RUN_AGGRESSIVE_SEND', label: rule.fleetName, fleetAccount: rule.fleetAccount, rentalContract: rule.rentalContract, message });
      return;
    }

    const prepared = await this.prepareRentForAggressive(rule);
    const runtime = this.aggressiveRuntimeByRule.get(key);
    if (!runtime || runtime.token !== runToken || this.successfulRentKeys.has(key) || Date.now() > runtime.stopAtMs) return;
    const priorityFee = this.getAggressivePriorityFee(attempt);
    const submission = await this.signAndSubmitInstructions(prepared.instructions, attempt, {
      preferCachedBlockhash: true,
      fixedPriorityFeeMicroLamports: priorityFee,
    });
    const latest = this.aggressiveRuntimeByRule.get(key);
    if (latest && latest.token === runToken) {
      latest.lastSubmittedSignature = submission.signature;
    }
    await this.appendLog({
      event: 'AGGRESSIVE_TX_SUBMITTED',
      label: rule.fleetName,
      fleetAccount: rule.fleetAccount,
      rentalContract: rule.rentalContract,
      tx: submission.signature,
      priorityFeeMicroLamports: priorityFee,
      message: `Aggressive attempt ${attempt} submitted: ${submission.signature} (${priorityFee} microLamports/CU)`,
    });
  }

  private maybeCheckAggressiveOutcome(rule: FleetRentalRuleConfig, runtime: AggressiveRuntimeState) {
    const nowMs = Date.now();
    if (runtime.statusCheckInFlight || nowMs - runtime.lastStatusCheckAtMs < AGGRESSIVE_STATUS_CHECK_INTERVAL_MS) return;
    runtime.lastStatusCheckAtMs = nowMs;
    runtime.statusCheckInFlight = true;
    void this.checkAggressiveOutcome(rule, runtime.token).finally(() => {
      const latest = this.aggressiveRuntimeByRule.get(getRuleKey(rule));
      if (latest && latest.token === runtime.token) {
        latest.statusCheckInFlight = false;
      }
    });
  }

  private async checkAggressiveOutcome(rule: FleetRentalRuleConfig, runToken: number) {
    const key = getRuleKey(rule);
    const runtime = this.aggressiveRuntimeByRule.get(key);
    if (!runtime || runtime.token !== runToken || this.successfulRentKeys.has(key)) return;

    let snapshot: RentalContractSnapshot;
    try {
      snapshot = await this.fetchRentalContractSnapshot(rule.rentalContract);
      this.rememberObservedRentEnd(rule, snapshot);
    } catch (err) {
      this.logger.warn(`Aggressive status check failed for ${rule.fleetName}:`, err);
      return;
    }

    const endsAtMs = snapshot.endsAt?.getTime() ?? null;
    const hasNewRentalEnd = endsAtMs != null && endsAtMs > runtime.rentEndsAtMs + MS_PER_SECOND && endsAtMs > Date.now();
    if (snapshot.rentedByYou && hasNewRentalEnd) {
      await this.recordRentSuccessful(rule, runtime.lastSubmittedSignature ?? 'aggressive-burst');
      this.stopAggressiveSending(rule, 'rent detected by status check');
      return;
    }
    if (hasNewRentalEnd) {
      const message = `Aggressive sending stopped for ${rule.fleetName}: fleet was rented by someone else`;
      this.runtimeByRule.set(key, {
        ...(this.runtimeByRule.get(key) ?? this.createInitialRuntimeState()),
        status: 'unavailable',
        currentPricePerDay: snapshot.pricePerDay,
        rentEndsAt: snapshot.endsAt?.toISOString() ?? null,
        secondsUntilEnd: Math.max(0, Math.floor((endsAtMs - Date.now()) / MS_PER_SECOND)),
        lastActionAt: new Date().toISOString(),
        lastTx: runtime.lastSubmittedSignature,
        note: message,
      });
      await this.saveState();
      this.stopAggressiveSending(rule, 'rented by someone else');
    }
  }

  private async checkConfirmedAvailabilityOutcome(rule: FleetRentalRuleConfig, previousRentEndMs: number, signature: string): Promise<void> {
    const key = getRuleKey(rule);
    try {
      for (let attempt = 1; attempt <= CONFIRMED_AVAILABILITY_OUTCOME_CHECK_ATTEMPTS; attempt += 1) {
        await delay(CONFIRMED_AVAILABILITY_OUTCOME_CHECK_INTERVAL_MS);
        if (!this.running || this.successfulRentKeys.has(key)) return;

        let snapshot: RentalContractSnapshot;
        try {
          snapshot = await this.fetchRentalContractSnapshot(rule.rentalContract);
          this.rememberObservedRentEnd(rule, snapshot);
        } catch (err) {
          this.logger.warn(`Confirmed availability status check failed for ${rule.fleetName}:`, err);
          continue;
        }

        const endsAtMs = snapshot.endsAt?.getTime() ?? null;
        const hasNewRentalEnd = endsAtMs != null && endsAtMs > previousRentEndMs + MS_PER_SECOND && endsAtMs > Date.now();
        if (snapshot.rentedByYou && hasNewRentalEnd) {
          await this.recordRentSuccessful(rule, signature, snapshot.pricePerDay);
          return;
        }
        if (hasNewRentalEnd) {
          const message = `Confirmed availability rent stopped for ${rule.fleetName}: fleet was rented by someone else`;
          this.runtimeByRule.set(key, {
            ...(this.runtimeByRule.get(key) ?? this.createInitialRuntimeState()),
            status: 'unavailable',
            currentPricePerDay: snapshot.pricePerDay,
            rentEndsAt: snapshot.endsAt?.toISOString() ?? null,
            secondsUntilEnd: Math.max(0, Math.floor((endsAtMs - Date.now()) / MS_PER_SECOND)),
            lastActionAt: new Date().toISOString(),
            lastTx: signature,
            note: message,
          });
          await this.saveState();
          await this.appendLog({
            event: 'CONFIRMED_AVAILABLE_RENTED_BY_OTHER',
            label: rule.fleetName,
            fleetAccount: rule.fleetAccount,
            rentalContract: rule.rentalContract,
            tx: signature,
            message,
          });
          return;
        }
      }

      await this.appendLog({
        event: 'CONFIRMED_AVAILABLE_OUTCOME_UNKNOWN',
        label: rule.fleetName,
        fleetAccount: rule.fleetAccount,
        rentalContract: rule.rentalContract,
        tx: signature,
        message: `Confirmed availability outcome still unknown for ${rule.fleetName}`,
      });
      // Re-arm the trigger dedupe so the next real availability transition is not
      // suppressed by the same (failed) rental-end epoch.
      this.confirmedAvailabilityTriggeredEpochByRule.delete(key);
      try {
        const snapshot = await this.fetchRentalContractSnapshot(rule.rentalContract);
        const endsAtMs = snapshot.endsAt?.getTime() ?? null;
        if (snapshot.hasCurrentRentalState && endsAtMs != null && endsAtMs <= Date.now()) {
          this.runtimeByRule.set(key, {
            ...(this.runtimeByRule.get(key) ?? this.createInitialRuntimeState()),
            status: 'pending',
            currentPricePerDay: snapshot.pricePerDay,
            rentEndsAt: snapshot.endsAt?.toISOString() ?? null,
            secondsUntilEnd: Math.floor((endsAtMs - Date.now()) / MS_PER_SECOND),
            lastActionAt: new Date().toISOString(),
            lastTx: signature,
            note: 'Submitted transaction did not confirm; contract is still pending relist',
          });
          await this.saveState();
        }
      } catch (err) {
        this.logger.warn(`Could not refresh pending state after unknown outcome for ${rule.fleetName}:`, err);
      }
    } finally {
      this.confirmedAvailabilityInFlightByRule.delete(key);
    }
  }

  private async recordRentSuccessful(rule: FleetRentalRuleConfig, signature: string, pricePerDay?: number | null) {
    const key = getRuleKey(rule);
    if (this.successfulRentKeys.has(key)) return;
    this.successfulRentKeys.add(key);
    const now = new Date().toISOString();
    let refreshedSnapshot: RentalContractSnapshot | null = null;
    try {
      refreshedSnapshot = await this.fetchRentalContractSnapshot(rule.rentalContract);
      this.rememberObservedRentEnd(rule, refreshedSnapshot);
    } catch (err) {
      this.logger.warn(`Could not refresh rental end after success for ${rule.fleetName}:`, err);
    }
    const rentEndsAt = refreshedSnapshot?.endsAt?.toISOString() ?? calculateFallbackRentEndsAt(Date.now(), rule.durationDays);
    const secondsUntilEnd = Math.max(0, Math.floor((Date.parse(rentEndsAt) - Date.now()) / MS_PER_SECOND));
    const currentPricePerDay = pricePerDay ?? refreshedSnapshot?.pricePerDay ?? null;
    const message = `Rent successful for ${rule.fleetName}`;
    this.logger.info(message);
    this.runtimeByRule.set(key, {
      ...(this.runtimeByRule.get(key) ?? this.createInitialRuntimeState()),
      status: 'rented',
      currentPricePerDay,
      rentEndsAt,
      secondsUntilEnd,
      lastActionAt: now,
      lastTx: signature,
      note: message,
    });
    await this.appendLog({
      event: 'Rent_Successful',
      label: rule.fleetName,
      fleetAccount: rule.fleetAccount,
      rentalContract: rule.rentalContract,
      pricePerDay: currentPricePerDay,
      endsAt: rentEndsAt,
      tx: signature,
      message,
    });
    try {
      await this.config.onRentSuccess?.({
        fleetName: rule.fleetName,
        fleetAccount: rule.fleetAccount,
        rentalContract: rule.rentalContract,
        tx: signature,
        pricePerDay: currentPricePerDay,
        rentEndsAt,
      });
    } catch (err) {
      this.logger.warn(`Could not persist rental end after success for ${rule.fleetName}:`, err);
    }
    await this.saveState();
  }

  private async rentRule(rule: FleetRentalRuleConfig, snapshot: RentalContractSnapshot) {
    const key = getRuleKey(rule);
    const now = new Date().toISOString();
    if (this.successfulRentKeys.has(key)) return;

    if (this.config.dryRun) {
      const message = `Dry run: would rent ${rule.fleetName} for ${rule.durationDays} days at ${snapshot.pricePerDay} ATLAS/day`;
      this.logger.info(message);
      this.runtimeByRule.set(key, {
        ...(this.runtimeByRule.get(key) ?? this.createInitialRuntimeState()),
        status: 'renting',
        lastActionAt: now,
        note: message,
      });
      await this.appendLog({
        event: 'DRY_RUN_RENT',
        label: rule.fleetName,
        fleetAccount: rule.fleetAccount,
        rentalContract: rule.rentalContract,
        pricePerDay: snapshot.pricePerDay,
        endsAt: snapshot.endsAt?.toISOString() ?? null,
        message,
      });
      return;
    }

    this.runtimeByRule.set(key, {
      ...(this.runtimeByRule.get(key) ?? this.createInitialRuntimeState()),
      status: 'renting',
      lastActionAt: now,
      note: 'Submitting rent transaction',
    });

    const tx = await this.buildRentTransaction(rule);
    const sig = await this.signAndSend(tx);
    await this.appendLog({
      event: 'TX_SUBMITTED',
      label: rule.fleetName,
      fleetAccount: rule.fleetAccount,
      rentalContract: rule.rentalContract,
      tx: sig,
      message: `Transaction submitted: ${sig}`,
    });
    await this.recordRentSuccessful(rule, sig, snapshot.pricePerDay);
  }

  private async buildRentTransaction(rule: FleetRentalRuleConfig): Promise<Transaction> {
    const program = await this.getSrslyProgram();
    const fleet = new PublicKey(rule.fleetAccount);
    const srslyProgramId = new PublicKey(this.config.srslyProgramId);
    const contract = deriveRentalContract(fleet, srslyProgramId);
    const borrower = this.wallet.publicKey;
    const borrowerProfile = new PublicKey(this.config.ownerProfile);
    const mint = new PublicKey(ATLAS_MINT);

    const contractState = await (program.account as any).contractState.fetch(contract);
    const rate = extractFirstNumber(contractState, ['rate']);
    if (rate == null || rate <= 0) {
      throw new Error(`Could not read positive rate from rental contract ${contract.toBase58()}`);
    }
    if (rate > rule.maxRentPricePerDay) {
      throw new Error(`Contract rate ${rate} exceeds configured max ${rule.maxRentPricePerDay}`);
    }

    const durationMin = extractFirstNumber(contractState, ['durationMin']);
    const durationMax = extractFirstNumber(contractState, ['durationMax']);
    if (durationMin != null && rule.durationDays < durationMin) {
      throw new Error(`Duration ${rule.durationDays} is below contract minimum ${durationMin}`);
    }
    if (durationMax != null && rule.durationDays > durationMax) {
      throw new Error(`Duration ${rule.durationDays} is above contract maximum ${durationMax}`);
    }

    const sage = createSageProgram(this.connection);
    const profileFactionProgram = createProfileFactionProgram(this.connection);
    let starbase: PublicKey;
    let starbaseSeqId = 0;
    try {
      const decodedFleet = await decodeSageFleet(this.connection, fleet);
      starbase = getFleetStarbase(decodedFleet);
      const decodedStarbase = await decodeStarbase(this.connection, starbase);
      starbaseSeqId = Number(decodedStarbase.data.seqId ?? 0);
    } catch (err) {
      this.logger.warn(`Fleet ${fleet.toBase58()} is not in a starbase loading bay — cannot derive starbase for reset_rental; will use accept_rental path`);
      starbase = PublicKey.default; // placeholder; accept_rental will fail at SRSLY program level if this is a problem
    }
    const gameId = publicKeyFromUnknown((contractState as Record<string, unknown>).gameId) ?? new PublicKey(SAGE_PROGRAM_ID);
    const borrowerProfileFaction = ProfileFactionAccount.findAddress(profileFactionProgram, borrowerProfile)[0];
    const starbasePlayer = StarbasePlayer.findAddress(sage, starbase, borrowerProfile, starbaseSeqId)[0];
    const rentalState = deriveRentalState(contract, borrower, srslyProgramId);
    const rentalAuthority = deriveRentalAuthority(srslyProgramId);
    const rentalThread = deriveRentalThread(rentalAuthority, rentalState);

    const amount = new BN(calculateRentalPaymentBaseUnits(rate, rule.durationDays));
    const duration = new BN(rule.durationDays);

    const accounts = {
      mint,
      borrower,
      borrowerProfile,
      borrowerProfileFaction,
      borrowerTokenAccount: getAssociatedTokenAddressSync(mint, borrower),
      fleet,
      gameId: publicKeyFromUnknown((contractState as Record<string, unknown>).gameId) ?? new PublicKey(SAGE_PROGRAM_ID),
      starbase,
      starbasePlayer,
      contract,
      rentalState,
      rentalAuthority,
      rentalTokenAccount: getAssociatedTokenAddressSync(mint, rentalState, true),
      rentalThread,
      feeTokenAccount: getAssociatedTokenAddressSync(mint, new PublicKey(RENTAL_FEE_WALLET)),
      sageProgram: new PublicKey(SAGE_PROGRAM_ID),
      antegenProgram: new PublicKey(ANTEGEN_PROGRAM_ID),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: PublicKey.default,
    };

    const instruction = (await (program.methods as any).acceptRental(amount, duration).accountsStrict(accounts).instruction()) as TransactionInstruction;
    return new Transaction().add(instruction);
  }

  private async fetchRentalContractSnapshot(rentalContract: string): Promise<RentalContractSnapshot> {
    const cachedDecodeFailure = this.confirmedAvailabilityDecodeFailureCache.get(rentalContract);
    if (cachedDecodeFailure) {
      if (cachedDecodeFailure.expiresAt > Date.now()) {
        throw new Error(cachedDecodeFailure.message);
      }
      this.confirmedAvailabilityDecodeFailureCache.delete(rentalContract);
    }

    const program = await this.getSrslyProgram();
    const pubkey = new PublicKey(rentalContract);

    const contractAccessor = (program.account as any).contractState ?? (program.account as any).ContractState;
    if (contractAccessor?.fetch) {
      try {
        const contract = await contractAccessor.fetch(pubkey);
        const pricePerDay = normalizePricePerDay(
          extractFirstNumber(contract, [
            'rate',
            'pricePerDay',
            'rentPricePerDay',
            'dailyRentPrice',
            'dailyPrice',
            'priceDaily',
            'price',
            'amountPerDay',
          ]),
        );

        let endsAt: Date | null = null;
        let hasCurrentRentalState = false;
        let rentedByYou = false;
        const currentRentalState = publicKeyFromUnknown((contract as Record<string, unknown>).currentRentalState);
        if (currentRentalState && !isDefaultPublicKey(currentRentalState)) {
          const rentalAccessor = (program.account as any).rentalState ?? (program.account as any).RentalState;
          try {
            const rental = await rentalAccessor.fetch(currentRentalState);
            const cancelled = Boolean((rental as Record<string, unknown>).cancelled);
            const borrower = publicKeyFromUnknown((rental as Record<string, unknown>).borrower);
            rentedByYou = Boolean(borrower && borrower.equals(this.wallet.publicKey));
            if (!cancelled) {
              hasCurrentRentalState = true;
              endsAt = extractDate(rental, ['endTime', 'rentEndsAt', 'rentalEndsAt', 'endsAt', 'expirationTime', 'expiresAt']);
            }
          } catch (err) {
            this.logger.warn(`Could not decode current rental state ${currentRentalState.toBase58()}`, err);
          }
        }

        this.confirmedAvailabilityDecodeFailureCache.delete(rentalContract);
        return {
          pricePerDay,
          endsAt,
          hasCurrentRentalState,
          rentedByYou,
          toClose: Boolean((contract as Record<string, unknown>).toClose),
          rawAccountType: 'ContractState',
          raw: contract,
        };
      } catch {
        // Fall through to generic account probing below.
      }
    }

    const accountNames = getAccountNames(program.idl as Idl);
    const candidates = accountNames.filter((name) => /rent|contract|listing|order|offer/i.test(name));
    const ordered = candidates.length ? candidates : accountNames;

    for (const accountName of ordered) {
      const accessor = (program.account as any)[accountName];
      if (!accessor?.fetch) continue;
      try {
        const raw = await accessor.fetch(pubkey);
        const pricePerDay = normalizePricePerDay(
          extractFirstNumber(raw, ['rate', 'pricePerDay', 'rentPricePerDay', 'dailyRentPrice', 'dailyPrice', 'priceDaily', 'price', 'amountPerDay']),
        );
        const endsAt = extractDate(raw, ['endTime', 'rentEndsAt', 'rentalEndsAt', 'endsAt', 'expirationTime', 'expiresAt', 'endTimestamp']);
        this.confirmedAvailabilityDecodeFailureCache.delete(rentalContract);
        return {
          pricePerDay,
          endsAt,
          hasCurrentRentalState: Boolean(endsAt),
          rentedByYou: false,
          toClose: Boolean((raw as Record<string, unknown>).toClose),
          rawAccountType: accountName,
          raw,
        };
      } catch {
        // Try the next possible account type.
      }
    }

    const message = `Could not decode rental contract ${rentalContract} with SRSLY IDL account types: ${accountNames.join(', ') || 'none'}`;
    this.confirmedAvailabilityDecodeFailureCache.set(rentalContract, {
      expiresAt: Date.now() + CONFIRMED_AVAILABILITY_DECODE_FAILURE_CACHE_MS,
      message,
    });
    throw new Error(message);
  }

  private async getSrslyProgram(): Promise<Program> {
    if (this.srslyProgram) return this.srslyProgram;
    const idl = await fetchCachedSrslyIdl(this.srslyProgramId, this.provider);
    if (!idl) {
      throw new Error(`Could not fetch Anchor IDL for SRSLY program ${this.srslyProgramId.toBase58()}`);
    }
    const idlWithAddress = { ...idl, address: this.srslyProgramId.toBase58() } as Idl;
    this.srslyProgram = new Program(idlWithAddress, this.provider);
    return this.srslyProgram;
  }

  private async signAndSend(transaction: Transaction): Promise<string> {
    const { signature, blockhash, lastValidBlockHeight } = await this.signAndSubmit(transaction, 0);
    const result = await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    this.solBalanceCache = null;
    this.atlasBalanceCache = null;
    if (result.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)} (${signature})`);
    }
    return signature;
  }

  private async signAndSubmit(transaction: Transaction, attempt: number): Promise<{ signature: string; blockhash: string; lastValidBlockHeight: number }> {
    return this.signAndSubmitInstructions(transaction.instructions, attempt, { preferCachedBlockhash: false });
  }

  private async signAndSubmitInstructions(
    instructions: TransactionInstruction[],
    attempt: number,
    options: { preferCachedBlockhash: boolean; fixedPriorityFeeMicroLamports?: number },
  ): Promise<{ signature: string; blockhash: string; lastValidBlockHeight: number }> {
    const { blockhash, lastValidBlockHeight } = await this.getBlockhashForSubmit(options.preferCachedBlockhash);
    const baseInstructions: TransactionInstruction[] = [];
    if (this.config.useHeliusSender) {
      baseInstructions.push(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: this.getHeliusSenderTipAccount(attempt),
          lamports: this.solToLamports(this.config.heliusSenderTipSol),
        }),
      );
    }
    baseInstructions.push(...instructions);

    const sendTransaction = new Transaction();
    const priorityFee = options.fixedPriorityFeeMicroLamports ?? (this.config.useHeliusSender ? this.getStaticPriorityFee(attempt) : null);
    if (priorityFee != null) {
      sendTransaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }));
    }
    sendTransaction.add(...baseInstructions);
    sendTransaction.recentBlockhash = blockhash;
    sendTransaction.feePayer = this.wallet.publicKey;
    sendTransaction.sign(this.wallet);
    const signature = this.config.useHeliusSender
      ? await this.submitWithHeliusSender(sendTransaction)
      : await this.connection.sendRawTransaction(sendTransaction.serialize(), {
          skipPreflight: true,
          maxRetries: 0,
        });
    this.logger.info(
      `Transaction submitted${this.config.useHeliusSender ? ' via Helius Sender' : ''}: ${signature}${
        priorityFee != null ? ` (priority ${priorityFee} microLamports/CU)` : ''
      }`,
    );
    return { signature, blockhash, lastValidBlockHeight };
  }

  private getAggressivePriorityFee(attempt: number): number {
    const step = (Math.max(0, attempt - 1) % AGGRESSIVE_PRIORITY_FEE_LADDER_STEPS) + 1;
    const fee = Math.floor((this.config.heliusPriorityFeeMaxMicroLamports * step) / AGGRESSIVE_PRIORITY_FEE_LADDER_STEPS);
    return Math.max(1, fee);
  }

  private getStaticPriorityFee(attempt: number): number {
    return Math.max(1, this.config.transactionPriorityFeeMicroLamports + attempt);
  }

  private getHeliusSenderTipAccount(attempt: number): PublicKey {
    const index = Math.abs(attempt) % HELIUS_SENDER_TIP_ACCOUNTS.length;
    return new PublicKey(HELIUS_SENDER_TIP_ACCOUNTS[index]);
  }

  private solToLamports(sol: number): number {
    return Math.max(1, Math.round(sol * LAMPORTS_PER_SOL));
  }

  private async submitWithHeliusSender(transaction: Transaction): Promise<string> {
    const endpoint = this.config.heliusSenderSwqosOnly ? HELIUS_SENDER_SWQOS_ONLY_ENDPOINT : HELIUS_SENDER_ENDPOINT;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now().toString(),
        method: 'sendTransaction',
        params: [
          Buffer.from(transaction.serialize()).toString('base64'),
          {
            encoding: 'base64',
            skipPreflight: true,
            maxRetries: 0,
          },
        ],
      }),
    });
    const text = await response.text();
    let payload: { result?: string; error?: { message?: string; code?: number } };
    try {
      payload = JSON.parse(text) as { result?: string; error?: { message?: string; code?: number } };
    } catch {
      throw new Error(`Helius Sender returned HTTP ${response.status}: ${text}`);
    }
    if (!response.ok || payload.error || !payload.result) {
      const errorText = payload.error?.message ?? text;
      throw new Error(`Helius Sender failed${payload.error?.code ? ` (${payload.error.code})` : ''}: ${errorText}`);
    }
    return payload.result;
  }

  private buildRuleHealth(rule: FleetRentalRuleConfig): FleetRentalRuleHealth {
    const state = this.runtimeByRule.get(getRuleKey(rule)) ?? this.createInitialRuntimeState();
    return {
      fleetName: rule.fleetName,
      enabled: rule.enabled,
      fleetAccount: rule.fleetAccount,
      rentalContract: rule.rentalContract,
      durationDays: rule.durationDays,
      maxRentPricePerDay: rule.maxRentPricePerDay,
      comment: rule.comment,
      status: state.status,
      currentPricePerDay: state.currentPricePerDay,
      rentEndsAt: state.rentEndsAt,
      secondsUntilEnd: state.secondsUntilEnd,
      lastActionAt: state.lastActionAt,
      lastTx: state.lastTx,
      note: state.note,
    };
  }

  private createInitialRuntimeState(): RuleRuntimeState {
    return {
      status: 'unknown',
      currentPricePerDay: null,
      rentEndsAt: null,
      secondsUntilEnd: null,
      lastActionAt: null,
      lastTx: null,
    };
  }

  private async ensureAnalysisFiles() {
    await fs.mkdir(this.analysisPath, { recursive: true });
    try {
      await fs.access(this.logFilePath);
    } catch {
      await fs.writeFile(this.logFilePath, '', 'utf8');
    }
    try {
      await fs.access(this.stateFilePath);
    } catch {
      await fs.writeFile(this.stateFilePath, JSON.stringify({}, null, 2), 'utf8');
    }
    try {
      await fs.access(this.rpcCounterFilePath);
    } catch {
      await fs.writeFile(this.rpcCounterFilePath, '', 'utf8');
    }
  }

  private async appendRpcCounterSnapshot(snapshot: RpcMethodCounterSnapshot) {
    try {
      await fs.mkdir(this.analysisPath, { recursive: true });
      await fs.appendFile(this.rpcCounterFilePath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    } catch (err) {
      this.logger.warn('Failed to write RPC method counter snapshot:', err);
    }
  }

  private async loadState() {
    const raw = await fs.readFile(this.stateFilePath, 'utf8').catch(() => '');
    const parsed = parsePersistedStateText<RuleRuntimeState>(raw);
    this.runtimeByRule.clear();
    for (const [key, value] of Object.entries(parsed)) {
      this.runtimeByRule.set(key, { ...this.createInitialRuntimeState(), ...value });
    }
  }

  private async saveState() {
    await fs.writeFile(this.stateFilePath, serializePersistedState(this.runtimeByRule.entries()), 'utf8');
  }

  private async appendLog(event: Record<string, unknown>) {
    const payload = { timestamp: new Date().toISOString(), ...event };
    await fs.appendFile(this.logFilePath, JSON.stringify(payload) + '\n', 'utf8');
  }

  private async readRecentActivity(): Promise<FleetRentalActivity[]> {
    try {
      const raw = await fs.readFile(this.logFilePath, 'utf8');
      return parseRecentActivityText<FleetRentalActivity>(raw, RECENT_ACTIVITY_LIMIT);
    } catch {
      return [];
    }
  }

  private async getSolBalance(): Promise<number | null> {
    if (this.solBalanceCache != null) return this.solBalanceCache;
    try {
      const lamports = await this.connection.getBalance(this.wallet.publicKey, 'confirmed');
      this.solBalanceCache = lamports / 1e9;
      return this.solBalanceCache;
    } catch (err) {
      this.logger.warn('Failed to fetch SOL balance', err);
      return null;
    }
  }

  private async getAtlasBalance(): Promise<number | null> {
    if (this.atlasBalanceCache != null) return this.atlasBalanceCache;
    try {
      const tokenAccount = getAssociatedTokenAddressSync(new PublicKey(ATLAS_MINT), this.wallet.publicKey);
      const balance = await this.connection.getTokenAccountBalance(tokenAccount, 'confirmed');
      this.atlasBalanceCache = Number(balance.value.amount) / 10 ** LAMPORTS_PER_ATLAS_DECIMALS;
      return this.atlasBalanceCache;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/could not find account|invalid account owner|failed to get token account balance/i.test(message)) {
        this.atlasBalanceCache = 0;
        return this.atlasBalanceCache;
      }
      this.logger.warn('Failed to fetch ATLAS balance', err);
      return null;
    }
  }
}
