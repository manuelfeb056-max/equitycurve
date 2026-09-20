/**
 * Live pool monitor: reads DBC pool + config state via the SDK.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import {
  DynamicBondingCurveClient,
  getPriceFromSqrtPrice,
  TokenDecimal,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import BN from 'bn.js';

export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

export interface PoolSnapshot {
  pool: string;
  config: string;
  baseMint: string;
  quoteMint: string;
  quoteReserveRaw: string;
  quoteReserveUi: number;
  migrationThresholdRaw: string;
  migrationThresholdUi: number;
  graduationPct: number;
  graduated: boolean;
  currentPriceQuote: number;
  baseDecimals: number;
  quoteDecimals: number;
}

export async function fetchPoolSnapshot(
  poolAddress: string,
  rpc: string = DEVNET_RPC
): Promise<PoolSnapshot> {
  const connection = new Connection(rpc, 'confirmed');
  const client = new DynamicBondingCurveClient(connection, 'confirmed');
  const poolKey = new PublicKey(poolAddress);

  const pool = await client.state.getPool(poolKey);
  if (!pool) throw new Error('Pool not found on this network.');
  const st = pool.poolState;
  const configKey = st.config as PublicKey;
  const config = await client.state.getPoolConfig(configKey);
  if (!config) throw new Error('Pool config not found.');

  const baseDecimals = Number(config.tokenDecimal ?? 6);
  const cfg = config as unknown as Record<string, PublicKey | BN>;
  const quoteMintPk = cfg.quoteMint as PublicKey;
  const quoteMintInfo = await getMint(connection, quoteMintPk);
  const quoteDecimals = quoteMintInfo.decimals;
  const quoteReserve = st.quoteReserve as BN;
  const threshold = config.migrationQuoteThreshold as BN;
  const graduationPct =
    threshold.isZero()
      ? 0
      : Math.min(100, (quoteReserve.toNumber() / threshold.toNumber()) * 100);

  const currentPriceQuote = getPriceFromSqrtPrice(
    st.sqrtPrice as BN,
    baseDecimals === 6 ? TokenDecimal.SIX : TokenDecimal.NINE,
    quoteDecimals === 6 ? TokenDecimal.SIX : TokenDecimal.NINE
  ).toNumber();

  return {
    pool: poolKey.toBase58(),
    config: configKey.toBase58(),
    baseMint: (st.baseMint as PublicKey).toBase58(),
    quoteMint: quoteMintPk.toBase58(),
    quoteReserveRaw: quoteReserve.toString(),
    quoteReserveUi: quoteReserve.toNumber() / 10 ** quoteDecimals,
    migrationThresholdRaw: threshold.toString(),
    migrationThresholdUi: threshold.toNumber() / 10 ** quoteDecimals,
    graduationPct,
    graduated: quoteReserve.gte(threshold),
    currentPriceQuote,
    baseDecimals,
    quoteDecimals,
  };
}
