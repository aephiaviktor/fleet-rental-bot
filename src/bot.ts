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
export const AGGRESSIVE_STATUS_CHECK_INTERVAL_MS = 1200;
export const AGGRESSIVE_PRIORITY_FEE_LADDER_STEPS = 4;
export const DAILY_RESTART_DEFER_WINDOW_MS = 5 * 60 * 1000;
export const DAILY_RESTART_CHECK_SETTLE_MS = 250;

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
  onRestartRequested?: (reason: string) => void | Promise<void>;
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
  status: 'disabled' | 'unknown' | 'waiting' | 'due' | 'renting' | 'rented' | 'unavailable' | 'blocked' | 'error';
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
};

type CachedBlockhash = {
  blockhash: string;
  lastValidBlockHeight: number;
  fetchedAtMs: number;
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

function createFailoverConnection(primaryUrl: string, fallbackUrl: string | undefined, logger: FleetRentalBotLogger): Connection {
  const primary = new Connection(primaryUrl, { commitment: 'confirmed' });
  if (!fallbackUrl || fallbackUrl === primaryUrl) {
    return primary;
  }

  const fallback = new Connection(fallbackUrl, { commitment: 'confirmed' });
  return new Proxy(primary, {
    get(target, prop, receiver) {
      const primaryValue = Reflect.get(target, prop, receiver);
      if (typeof primaryValue !== 'function') return primaryValue;
      const fallbackValue = Reflect.get(fallback, prop, fallback);
      if (typeof fallbackValue !== 'function') return primaryValue.bind(target);
      return async (...args: unknown[]) => {
        try {
          return await primaryValue.apply(target, args);
        } catch (error) {
          logger.warn(`Primary RPC failed for Connection.${String(prop)}(), trying fallback RPC.`, error);
          return await fallbackValue.apply(fallback, args);
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

function normalizePricePerDay(raw: number | null): number | null {
  if (raw == null) return null;
  if (raw > 1_000_000) return raw / 10 ** LAMPORTS_PER_ATLAS_DECIMALS;
  return raw;
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

async function fetchFleetName(connection: Connection, fleetAccount: PublicKey): Promise<string> {
  const accountInfo = await connection.getAccountInfo(fleetAccount, 'confirmed');
  if (!accountInfo) throw new Error(`Fleet account not found: ${fleetAccount.toBase58()}`);
  const sage = createSageProgram(connection);
  const decoded = SageFleet.decodeData({ accountId: fleetAccount, accountInfo } as any, sage);
  if (decoded.type !== 'ok') {
    throw decoded.error ?? new Error(`Could not decode fleet ${fleetAccount.toBase58()}`);
  }
  return byteArrayToString(decoded.data.data.fleetLabel) || fleetAccount.toBase58();
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
  const connection = new Connection(input.rpcUrl, { commitment: 'confirmed' });
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

  const fleetName = await fetchFleetName(connection, fleet);
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
  private readonly aggressiveStartTimers = new Map<string, NodeJS.Timeout>();
  private readonly aggressiveIntervalTimers = new Map<string, NodeJS.Timeout>();
  private readonly aggressiveRuntimeByRule = new Map<string, AggressiveRuntimeState>();
  private readonly aggressivePrepareTimers = new Map<string, NodeJS.Timeout>();
  private readonly scheduledAggressiveWindows = new Map<string, ScheduledAggressiveWindow>();
  private readonly preparedRentByRule = new Map<string, PreparedRentTransaction>();
  private readonly preparingRentByRule = new Map<string, Promise<PreparedRentTransaction>>();
  private readonly missedAggressiveWindowKeys = new Set<string>();
  private dailyRestartTimer: NodeJS.Timeout | null = null;
  private dailyRestartPending = false;
  private blockhashCache: CachedBlockhash | null = null;
  private blockhashRefreshTimer: NodeJS.Timeout | null = null;
  private blockhashRefreshInFlight: Promise<CachedBlockhash> | null = null;
  private aggressiveRunSequence = 0;

  constructor(
    private readonly config: FleetRentalBotConfig,
    private readonly logger: FleetRentalBotLogger = defaultLogger,
  ) {
    const secretKeyBytes = decodeSecret(config.hotWalletSecret);
    this.wallet = secretKeyBytes.length === 32 ? Keypair.fromSeed(secretKeyBytes) : Keypair.fromSecretKey(secretKeyBytes);
    this.connection = createFailoverConnection(config.rpcUrl, config.rpcUrlFallback, this.logger);
    this.provider = new AnchorProvider(this.connection, new Wallet(this.wallet), { commitment: 'confirmed' });
    this.srslyProgramId = new PublicKey(config.srslyProgramId);

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
    this.scheduleNextDailyRestartCheck();
    this.logger.info(`Hot wallet: ${this.wallet.publicKey.toBase58()}`);
    this.logger.info(`SRSLY program: ${this.srslyProgramId.toBase58()}`);
    this.logger.info(`Managing ${this.config.rentalRules.length} rental rule(s). Dry run: ${this.config.dryRun ? 'yes' : 'no'}.`);

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
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    for (const timer of this.aggressiveStartTimers.values()) clearTimeout(timer);
    for (const timer of this.aggressiveIntervalTimers.values()) clearInterval(timer);
    for (const timer of this.aggressivePrepareTimers.values()) clearTimeout(timer);
    if (this.dailyRestartTimer) {
      clearTimeout(this.dailyRestartTimer);
      this.dailyRestartTimer = null;
    }
    this.aggressiveStartTimers.clear();
    this.aggressiveIntervalTimers.clear();
    this.aggressivePrepareTimers.clear();
    this.aggressiveRuntimeByRule.clear();
    this.scheduledAggressiveWindows.clear();
    this.preparedRentByRule.clear();
    this.preparingRentByRule.clear();
    this.dailyRestartPending = false;
    this.stopBlockhashRefresh();
    this.successfulRentKeys.clear();
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

  private scheduleNextDailyRestartCheck() {
    if (this.dailyRestartTimer) {
      clearTimeout(this.dailyRestartTimer);
      this.dailyRestartTimer = null;
    }

    const nowMs = Date.now();
    const now = new Date(nowMs);
    const nextMidnightUtcMs = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    );
    const delayMs = Math.max(0, nextMidnightUtcMs - nowMs);
    const message = `Daily restart check scheduled for ${new Date(nextMidnightUtcMs).toISOString()}`;
    this.logger.info(message);
    void this.appendLog({
      event: 'RESTART_SCHEDULED',
      scheduledFor: new Date(nextMidnightUtcMs).toISOString(),
      delayMs,
      message,
    });
    this.dailyRestartTimer = setTimeout(() => {
      this.dailyRestartTimer = null;
      void this.checkDailyRestart('daily_midnight_utc').catch((err: unknown) => {
        this.logger.error('Daily restart check failed:', err);
        void this.appendLog({ event: 'RESTART_CHECK_ERROR', message: formatError(err) });
        if (this.running) this.scheduleNextDailyRestartCheck();
      });
    }, delayMs);
  }

  private scheduleDeferredRestartCheck(reason: string, runAtMs: number) {
    if (!this.running || !this.dailyRestartPending) return;
    if (this.dailyRestartTimer) {
      clearTimeout(this.dailyRestartTimer);
      this.dailyRestartTimer = null;
    }
    const delayMs = Math.max(DAILY_RESTART_CHECK_SETTLE_MS, runAtMs - Date.now());
    this.dailyRestartTimer = setTimeout(() => {
      this.dailyRestartTimer = null;
      void this.checkDailyRestart(reason).catch((err: unknown) => {
        this.logger.error('Deferred restart check failed:', err);
        void this.appendLog({ event: 'RESTART_CHECK_ERROR', message: formatError(err) });
        if (this.running) this.scheduleNextDailyRestartCheck();
      });
    }, delayMs);
  }

  private async checkDailyRestart(reason: string) {
    if (!this.running) return;
    this.dailyRestartPending = true;

    const nowMs = Date.now();
    const blockingWindow = this.findRestartBlockingWindow(nowMs);
    if (blockingWindow) {
      const recheckAtMs = blockingWindow.stopAtMs + DAILY_RESTART_CHECK_SETTLE_MS;
      const message = `Daily restart deferred: ${blockingWindow.fleetName} has preparation/aggressive window activity until ${new Date(blockingWindow.stopAtMs).toISOString()}`;
      this.logger.info(message);
      await this.appendLog({
        event: 'RESTART_DEFERRED',
        reason,
        label: blockingWindow.fleetName,
        fleetAccount: blockingWindow.fleetAccount,
        rentalContract: blockingWindow.rentalContract,
        prepareAt: new Date(blockingWindow.prepareAtMs).toISOString(),
        startAt: new Date(blockingWindow.startAtMs).toISOString(),
        rentEndsAt: new Date(blockingWindow.rentEndsAtMs).toISOString(),
        stopAt: new Date(blockingWindow.stopAtMs).toISOString(),
        recheckAt: new Date(recheckAtMs).toISOString(),
        message,
      });
      this.scheduleDeferredRestartCheck('deferred_window_complete', recheckAtMs);
      return;
    }

    const message = 'Daily restart executing: no preparation/aggressive window is active or due within 5 minutes';
    this.logger.info(message);
    await this.appendLog({
      event: 'RESTART_EXECUTED',
      reason,
      message,
    });
    this.dailyRestartPending = false;

    if (this.config.onRestartRequested) {
      await this.config.onRestartRequested('daily_midnight_utc');
    } else {
      this.scheduleNextDailyRestartCheck();
    }
  }

  private findRestartBlockingWindow(nowMs: number): ScheduledAggressiveWindow | null {
    if (this.aggressiveRuntimeByRule.size > 0 || this.preparingRentByRule.size > 0) {
      const active = [...this.scheduledAggressiveWindows.values()]
        .filter((window) => window.stopAtMs >= nowMs)
        .sort((a, b) => a.stopAtMs - b.stopAtMs)[0];
      if (active) return active;
    }

    const nearWindowCutoffMs = nowMs + DAILY_RESTART_DEFER_WINDOW_MS;
    let nearest: ScheduledAggressiveWindow | null = null;
    for (const window of this.scheduledAggressiveWindows.values()) {
      if (window.stopAtMs < nowMs) continue;
      const preparationNearOrActive = window.prepareAtMs <= nearWindowCutoffMs;
      const aggressiveNearOrActive = window.startAtMs <= nearWindowCutoffMs;
      if (!preparationNearOrActive && !aggressiveNearOrActive) continue;
      if (!nearest || window.stopAtMs < nearest.stopAtMs) nearest = window;
    }
    return nearest;
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

    if (snapshot.endsAt) {
      this.scheduleAggressivePhase(rule, snapshot.endsAt);
      this.scheduleAggressivePreparation(rule, snapshot.endsAt);
    }

      const nowMs = Date.now();
      const aggressiveStopMs = snapshot.endsAt
        ? snapshot.endsAt.getTime() + this.config.aggressiveStopAfterEndSeconds * MS_PER_SECOND
        : null;
      const inAggressiveWindow = aggressiveStopMs != null && nowMs <= aggressiveStopMs && secondsUntilEnd != null && secondsUntilEnd <= this.config.aggressiveStartBeforeEndSeconds;

      if (inAggressiveWindow && snapshot.endsAt) {
        this.beginAggressiveSending(rule, snapshot.endsAt);
        update({ status: 'due', note: `Aggressive sending active (${secondsUntilEnd}s until end)` });
        return;
      }

      const due = !snapshot.endsAt || secondsUntilEnd == null || secondsUntilEnd <= 0;
      if (!due) {
        update({ status: 'unavailable', note: snapshot.rentedByYou ? 'Fleet is currently rented by YOU' : 'Fleet is currently rented by someone' });
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
    if (this.aggressiveStartTimers.has(key) || this.aggressiveIntervalTimers.has(key)) return;

    const startAtMs = rentEndsAt.getTime() - this.config.aggressiveStartBeforeEndSeconds * MS_PER_SECOND;
    const delayMs = Math.max(0, startAtMs - Date.now());
    const stopAtMs = rentEndsAt.getTime() + this.config.aggressiveStopAfterEndSeconds * MS_PER_SECOND;
    this.scheduledAggressiveWindows.set(key, {
      fleetName: rule.fleetName,
      fleetAccount: rule.fleetAccount,
      rentalContract: rule.rentalContract,
      rentEndsAtMs: rentEndsAt.getTime(),
      prepareAtMs: startAtMs - AGGRESSIVE_PREPARE_BEFORE_START_MS,
      startAtMs,
      stopAtMs,
    });
    const timer = setTimeout(() => {
      this.aggressiveStartTimers.delete(key);
      this.beginAggressiveSending(rule, rentEndsAt);
    }, delayMs);
    this.aggressiveStartTimers.set(key, timer);
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
    if (this.preparedRentByRule.has(key) || this.preparingRentByRule.has(key) || this.aggressivePrepareTimers.has(key)) return;

    const startAtMs = rentEndsAt.getTime() - this.config.aggressiveStartBeforeEndSeconds * MS_PER_SECOND;
    const prepareAtMs = startAtMs - AGGRESSIVE_PREPARE_BEFORE_START_MS;
    const delayMs = Math.max(0, prepareAtMs - Date.now());
    const scheduledMessage = `Aggressive preparation scheduled for ${rule.fleetName}: starts at ${new Date(prepareAtMs).toISOString()} (${Math.ceil(delayMs / MS_PER_SECOND)}s before timer)`;
    const timer = setTimeout(() => {
      this.aggressivePrepareTimers.delete(key);
      const startedMessage = `Aggressive preparation started for ${rule.fleetName}`;
      this.logger.info(startedMessage);
      void this.appendLog({
        event: 'AGGRESSIVE_PREPARE_START',
        label: rule.fleetName,
        fleetAccount: rule.fleetAccount,
        rentalContract: rule.rentalContract,
        prepareAt: new Date(prepareAtMs).toISOString(),
        startAt: new Date(startAtMs).toISOString(),
        rentEndsAt: rentEndsAt.toISOString(),
        message: startedMessage,
      });
      void this.prepareRentForAggressive(rule).catch((err: unknown) => {
        const message = `Could not prepare aggressive rent transaction for ${rule.fleetName}: ${formatError(err)}`;
        this.logger.warn(message);
        void this.appendLog({
          event: 'AGGRESSIVE_PREPARE_FAILED',
          label: rule.fleetName,
          fleetAccount: rule.fleetAccount,
          rentalContract: rule.rentalContract,
          prepareAt: new Date(prepareAtMs).toISOString(),
          startAt: new Date(startAtMs).toISOString(),
          rentEndsAt: rentEndsAt.toISOString(),
          message,
        });
      });
    }, delayMs);
    this.aggressivePrepareTimers.set(key, timer);
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

    const blockhashPrewarmAtMs = startAtMs - AGGRESSIVE_BLOCKHASH_PREWARM_MS;
    const blockhashDelayMs = Math.max(0, blockhashPrewarmAtMs - Date.now());
    setTimeout(() => {
      if (this.running && !this.successfulRentKeys.has(key)) {
        this.startBlockhashRefresh();
      }
    }, blockhashDelayMs);
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

  private beginAggressiveSending(rule: FleetRentalRuleConfig, rentEndsAt: Date) {
    const key = getRuleKey(rule);
    if (!this.running || !rule.enabled || this.aggressiveIntervalTimers.has(key)) return;

    const startAtMs = rentEndsAt.getTime() - this.config.aggressiveStartBeforeEndSeconds * MS_PER_SECOND;
    const stopAtMs = rentEndsAt.getTime() + this.config.aggressiveStopAfterEndSeconds * MS_PER_SECOND;
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
    const attempts = this.aggressiveRuntimeByRule.get(key)?.attempts ?? 0;
    this.aggressiveRuntimeByRule.delete(key);
    this.scheduledAggressiveWindows.delete(key);
    this.preparedRentByRule.delete(key);
    if (this.aggressiveIntervalTimers.size === 0) {
      this.stopBlockhashRefresh();
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

  private async recordRentSuccessful(rule: FleetRentalRuleConfig, signature: string, pricePerDay?: number | null) {
    const key = getRuleKey(rule);
    if (this.successfulRentKeys.has(key)) return;
    this.successfulRentKeys.add(key);
    const now = new Date().toISOString();
    let refreshedSnapshot: RentalContractSnapshot | null = null;
    try {
      refreshedSnapshot = await this.fetchRentalContractSnapshot(rule.rentalContract);
    } catch (err) {
      this.logger.warn(`Could not refresh rental end after success for ${rule.fleetName}:`, err);
    }
    const rentEndsAt = refreshedSnapshot?.endsAt?.toISOString() ?? new Date(Date.now() + rule.durationDays * 24 * 60 * 60 * 1000).toISOString();
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

    const amount = new BN(Math.floor(rate * rule.durationDays * 10 ** LAMPORTS_PER_ATLAS_DECIMALS));
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
              endsAt = extractDate(rental, ['endTime', 'rentEndsAt', 'rentalEndsAt', 'endsAt', 'expirationTime', 'expiresAt']);
            }
          } catch (err) {
            this.logger.warn(`Could not decode current rental state ${currentRentalState.toBase58()}`, err);
          }
        }

        return { pricePerDay, endsAt, rentedByYou, toClose: Boolean((contract as Record<string, unknown>).toClose), rawAccountType: 'ContractState', raw: contract };
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
        return { pricePerDay, endsAt, rentedByYou: false, toClose: Boolean((raw as Record<string, unknown>).toClose), rawAccountType: accountName, raw };
      } catch {
        // Try the next possible account type.
      }
    }

    throw new Error(`Could not decode rental contract ${rentalContract} with SRSLY IDL account types: ${accountNames.join(', ') || 'none'}`);
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
  }

  private async loadState() {
    try {
      const raw = await fs.readFile(this.stateFilePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedState;
      for (const [key, value] of Object.entries(parsed)) {
        this.runtimeByRule.set(key, { ...this.createInitialRuntimeState(), ...value });
      }
    } catch {
      this.runtimeByRule.clear();
    }
  }

  private async saveState() {
    const payload: PersistedState = {};
    for (const [key, value] of this.runtimeByRule.entries()) {
      payload[key] = value;
    }
    await fs.writeFile(this.stateFilePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private async appendLog(event: Record<string, unknown>) {
    const payload = { timestamp: new Date().toISOString(), ...event };
    await fs.appendFile(this.logFilePath, JSON.stringify(payload) + '\n', 'utf8');
  }

  private async readRecentActivity(): Promise<FleetRentalActivity[]> {
    try {
      const raw = await fs.readFile(this.logFilePath, 'utf8');
      return raw
        .split('\n')
        .filter(Boolean)
        .slice(-RECENT_ACTIVITY_LIMIT)
        .map((line) => JSON.parse(line) as FleetRentalActivity)
        .reverse();
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
