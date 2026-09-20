/**
 * Solver: given anchor prices + graduation target, find (supply, pct) that
 * yields a feasible two-segment curve. Verifies with the real SDK build.
 *
 * Usage: npx tsx scripts/feasibility.ts
 */
import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithMidPrice,
  CollectFeeMode,
  DammV2BaseFeeMode,
  DammV2DynamicFeeMode,
  getPriceFromSqrtPrice,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  type ConfigParameters,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import BN from 'bn.js';

export interface AnchorSpec {
  startQ: number; // quote per token
  midQ: number;
  migQ: number;
  graduationQuote: number; // quote tokens to raise (G)
}

export function solveCurveParams(spec: AnchorSpec): {
  supply: number;
  pct: number;
} {
  const { startQ, midQ, migQ, graduationQuote } = spec;
  // Feasibility: avg execution price r = P2*pct/(100-pct) must satisfy
  //   sqrt(P0*P1) < r < sqrt(P1*P2)
  const lo = Math.sqrt(startQ * midQ) * 1.001;
  const hi = Math.sqrt(midQ * migQ) * 0.999;
  const rLo = lo / migQ;
  const rHi = hi / migQ;
  const rMid = Math.sqrt(rLo * rHi);
  const pct = (100 * rMid) / (1 + rMid);
  // threshold = P2 * S * pct/100 = G  =>  S = G*100/(P2*pct)
  const supply = Math.max(10, Math.round(((graduationQuote * 100) / pct / migQ)));
  return { supply, pct };
}

export function tryBuildAnchor(spec: AnchorSpec) {
  const { supply, pct } = solveCurveParams(spec);
  const { startQ, midQ, migQ } = spec;
  const config: ConfigParameters = buildCurveWithMidPrice({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: TokenDecimal.NINE,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: supply,
      leftover: 1,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 200, endingFeeBps: 30,
          numberOfPeriod: 48, totalDuration: 48 * 3600,
        },
      },
      dynamicFeeEnabled: true,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: true,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: {
        collectFeeMode: MigratedCollectFeeMode.QuoteToken,
        dynamicFee: DammV2DynamicFeeMode.Enabled,
        poolFeeBps: 30,
        baseFeeMode: DammV2BaseFeeMode.FeeTimeSchedulerLinear,
      },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: 100,
      creatorLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0, numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0, totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    initialMarketCap: startQ * supply,
    migrationMarketCap: migQ * supply,
    midPrice: midQ,
    percentageSupplyOnMigration: pct,
  });
  return { config, supply, pct };
}

// ---- demo ----
const mark = 0.7679; // ANDURIL mark in SOL @ $200
const spec: AnchorSpec = {
  startQ: mark * 0.97,
  midQ: mark,
  migQ: mark * 1.08,
  graduationQuote: 250, // 250 SOL = $50K
};
const { config, supply, pct } = tryBuildAnchor(spec);
const curve = config.curve as Array<{ sqrtPrice: BN; liquidity: BN }>;
console.log(`solved: supply=${supply} pct=${pct.toFixed(2)} curvePts=${curve.length}`);
const thresholdSol = (config.migrationQuoteThreshold as BN).toNumber() / 1e9;
console.log(`threshold=${thresholdSol.toFixed(2)} SOL (target 250)`);
const p = (s: BN) =>
  getPriceFromSqrtPrice(s, TokenDecimal.SIX, TokenDecimal.NINE).toNumber();
console.log(
  `start=${p(config.sqrtStartPrice as BN).toFixed(4)} mid=${p(curve[0].sqrtPrice).toFixed(4)} end=${p(curve[1].sqrtPrice).toFixed(4)} SOL`
);
console.log(
  `targets: start=${spec.startQ.toFixed(4)} mid=${spec.midQ.toFixed(4)} end=${spec.migQ.toFixed(4)} SOL`
);
console.log('FEASIBILITY SOLVER PASS');
