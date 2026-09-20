/**
 * EquityCurve — core library.
 *
 * Thesis: memecoin DBC launches start at ~$0 and discover price from pure
 * speculation. Tokenized stocks have a KNOWN fair value (PreStocks mark price
 * for pre-IPO, reference market price for listed names). EquityCurve builds a
 * *fair-value-anchored* bonding curve:
 *
 *   segment 1:  mark × (1 − discount)  →  mark        (early-buyer discount)
 *   segment 2:  mark                   →  mark × (1 + premium)  (bounded upside)
 *
 * Price discovery happens *around* fair value instead of from zero, fees decay
 * from protective → brokerage-like as the pool matures, and graduation fires
 * when real liquidity has validated the mark — migrating to DAMM v2.
 */
import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithMidPrice,
  calculateQuoteToBaseFromAmountIn,
  CollectFeeMode,
  DammV2BaseFeeMode,
  DammV2DynamicFeeMode,
  feeNumeratorToBps,
  getFeeNumeratorOnLinearFeeScheduler,
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

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

export interface EquityAsset {
  id: string;
  name: string;
  symbol: string;
  kind: 'pre-ipo' | 'listed';
  /** Fair value per share/token in USD (the anchor). */
  markPrice: number;
  /** Implied valuation in USD (reference). */
  markValuation: number;
  logo?: string;
  source: string;
}

export interface TierPreset {
  id: 'pre-ipo' | 'large-cap';
  label: string;
  blurb: string;
  /** Start price = mark × (1 − startDiscountBps/1e4) */
  startDiscountBps: number;
  /** Migration price = mark × (1 + migrationPremiumBps/1e4) */
  migrationPremiumBps: number;
  /** FeeSchedulerLinear: start → end (bps) */
  startFeeBps: number;
  endFeeBps: number;
  feePeriods: number;
  /** seconds over which fees decay */
  feeDurationSec: number;
  /** Graduation threshold in USD terms (quote raised to graduate). */
  graduationQuoteUsd: number;
  /** Permanent DAMM v2 market fee after migration. */
  migratedPoolFeeBps: number;
  /** % of curve supply the partner keeps as permanent locked liquidity. */
  partnerLockedLpPct: number;
  // NOTE: the migration split (% of supply migrating to DAMM v2) is SOLVED,
  // not chosen: for a tight equity band only a narrow split keeps the
  // two-segment curve feasible (≈48% — half the float seeds the permanent
  // market). See solveCurveParams().
}

export const TIER_PRESETS: TierPreset[] = [
  {
    id: 'pre-ipo',
    label: 'Pre-IPO · Illiquid',
    blurb:
      'Thin books, wide uncertainty. Wider anchor band, protective opening fees that decay as the market finds the mark.',
    startDiscountBps: 300,
    migrationPremiumBps: 800,
    startFeeBps: 200,
    endFeeBps: 30,
    feePeriods: 48,
    feeDurationSec: 48 * 3600,
    graduationQuoteUsd: 50000,
    migratedPoolFeeBps: 30,
    partnerLockedLpPct: 100,
  },
  {
    id: 'large-cap',
    label: 'Large-cap · Liquid',
    blurb:
      'Deep reference market, tight fair value. Narrow band, low fees throughout — the curve is a formality around the mark.',
    startDiscountBps: 100,
    migrationPremiumBps: 300,
    startFeeBps: 60,
    endFeeBps: 25,
    feePeriods: 24,
    feeDurationSec: 24 * 3600,
    graduationQuoteUsd: 25000,
    migratedPoolFeeBps: 25,
    partnerLockedLpPct: 100,
  },
];

/* ------------------------------------------------------------------ */
/* Curve builder                                                       */
/* ------------------------------------------------------------------ */

export interface EquityCurveInput {
  asset: EquityAsset;
  preset: TierPreset;
  /** Decimals of the base (stock) token. */
  baseDecimals?: number;
  /** Decimals of the quote token (9 = wSOL, 6 = USDC). */
  quoteDecimals?: number;
  /** USD price of one whole quote token (for sizing + display). */
  quoteUsdPrice?: number;
}

export interface EquityCurveBuild {
  config: ConfigParameters;
  /* Targets (USD / quote) */
  startPriceUsd: number;
  midPriceUsd: number;
  migrationPriceUsd: number;
  graduationQuoteUsd: number;
  /* Actuals read back from the built curve (quote per token) */
  actualStartQuote: number;
  actualMidQuote: number;
  actualEndQuote: number;
  /** Float supply priced by the curve (human units). Solved, not chosen. */
  floatSupply: number;
  /** Solved migration split: % of supply migrating to DAMM v2. */
  supplyOnMigrationPct: number;
  initialMarketCapQuote: number;
  migrationMarketCapQuote: number;
  /** Graduation threshold in raw quote-token units (read back from config). */
  migrationQuoteThreshold: BN;
  baseDecimals: number;
  quoteDecimals: number;
  quoteUsdPrice: number;
}

/**
 * Solver: the two-segment curve is only feasible when the average execution
 * price sits inside the band. Given anchor prices + graduation target G,
 * solve for the (supply, migration-split) pair that lands the derived
 * threshold exactly on G.
 */
export function solveCurveParams(spec: {
  startQ: number;
  midQ: number;
  migQ: number;
  graduationQuote: number;
}): { supply: number; pct: number } {
  const { startQ, midQ, migQ, graduationQuote } = spec;
  const lo = Math.sqrt(startQ * midQ) * 1.001;
  const hi = Math.sqrt(midQ * migQ) * 0.999;
  const rMid = Math.sqrt((lo / migQ) * (hi / migQ));
  const pct = (100 * rMid) / (1 + rMid);
  const supply = Math.max(
    10,
    Math.round((graduationQuote * 100) / pct / migQ)
  );
  return { supply, pct };
}

export function buildEquityCurve(input: EquityCurveInput): EquityCurveBuild {
  const {
    asset,
    preset,
    baseDecimals = 6,
    quoteDecimals = 9,
    quoteUsdPrice = 200,
  } = input;

  // Anchor prices in quote-token terms (the SDK denominates in quote).
  const midPriceQuote = asset.markPrice / quoteUsdPrice;
  const startPriceQuote = midPriceQuote * (1 - preset.startDiscountBps / 10_000);
  const migrationPriceQuote =
    midPriceQuote * (1 + preset.migrationPremiumBps / 10_000);
  const graduationQuote = preset.graduationQuoteUsd / quoteUsdPrice;

  const { pct: supplyOnMigrationPct } = solveCurveParams({
    startQ: startPriceQuote,
    midQ: midPriceQuote,
    migQ: migrationPriceQuote,
    graduationQuote,
  });
  const baseSupply = Math.max(
    10,
    Math.round((graduationQuote * 100) / supplyOnMigrationPct / migrationPriceQuote)
  );

  // The SDK pads its internal supply accounting with a 25% swap buffer and
  // does lamport-level rounding; near the feasibility edge this can miss by
  // dust. Bump the float a token at a time (leftover headroom = 5 tokens,
  // small enough to keep the curve feasible) until the real build succeeds.
  const LEFTOVER_TOKENS = 5;
  let lastError: unknown = null;
  for (let bump = 0; bump <= 64; bump++) {
    const floatSupply = baseSupply + bump;
    try {
      return tryBuildEquityCurve({
        floatSupply,
        supplyOnMigrationPct,
        startPriceQuote,
        midPriceQuote,
        migrationPriceQuote,
        preset,
        baseDecimals,
        quoteDecimals,
        quoteUsdPrice,
        leftoverTokens: LEFTOVER_TOKENS,
        assetMarkPrice: asset.markPrice,
        graduationQuoteUsd: preset.graduationQuoteUsd,
      });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`could not build feasible curve: ${String(lastError)}`);
}

function tryBuildEquityCurve(args: {
  floatSupply: number;
  supplyOnMigrationPct: number;
  startPriceQuote: number;
  midPriceQuote: number;
  migrationPriceQuote: number;
  preset: TierPreset;
  baseDecimals: number;
  quoteDecimals: number;
  quoteUsdPrice: number;
  leftoverTokens: number;
  assetMarkPrice: number;
  graduationQuoteUsd: number;
}): EquityCurveBuild {
  const {
    floatSupply,
    supplyOnMigrationPct,
    startPriceQuote,
    midPriceQuote,
    migrationPriceQuote,
    preset,
    baseDecimals,
    quoteDecimals,
    quoteUsdPrice,
    leftoverTokens,
    assetMarkPrice,
    graduationQuoteUsd,
  } = args;

  const initialMarketCapQuote = startPriceQuote * floatSupply;
  const migrationMarketCapQuote = migrationPriceQuote * floatSupply;

  const config = buildCurveWithMidPrice({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal:
        baseDecimals === 6 ? TokenDecimal.SIX : TokenDecimal.NINE,
      tokenQuoteDecimal:
        quoteDecimals === 6 ? TokenDecimal.SIX : TokenDecimal.NINE,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: floatSupply,
      leftover: leftoverTokens,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: preset.startFeeBps,
          endingFeeBps: preset.endFeeBps,
          numberOfPeriod: preset.feePeriods,
          totalDuration: preset.feeDurationSec,
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
        poolFeeBps: preset.migratedPoolFeeBps,
        baseFeeMode: DammV2BaseFeeMode.FeeTimeSchedulerLinear,
      },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: preset.partnerLockedLpPct,
      creatorLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    initialMarketCap: initialMarketCapQuote,
    migrationMarketCap: migrationMarketCapQuote,
    midPrice: midPriceQuote,
    percentageSupplyOnMigration: supplyOnMigrationPct,
  });

  const migrationQuoteThreshold = config.migrationQuoteThreshold as BN;

  // Actuals read back from the built curve — honest numbers for the UI.
  const tokenBaseDecimal =
    baseDecimals === 6 ? TokenDecimal.SIX : TokenDecimal.NINE;
  const tokenQuoteDecimal =
    quoteDecimals === 6 ? TokenDecimal.SIX : TokenDecimal.NINE;
  const curvePts = config.curve as Array<{ sqrtPrice: BN; liquidity: BN }>;
  const actualStartQuote = getPriceFromSqrtPrice(
    config.sqrtStartPrice as BN,
    tokenBaseDecimal,
    tokenQuoteDecimal
  ).toNumber();
  const actualMidQuote = getPriceFromSqrtPrice(
    curvePts[0].sqrtPrice,
    tokenBaseDecimal,
    tokenQuoteDecimal
  ).toNumber();
  const actualEndQuote = getPriceFromSqrtPrice(
    curvePts[curvePts.length - 1].sqrtPrice,
    tokenBaseDecimal,
    tokenQuoteDecimal
  ).toNumber();

  return {
    config,
    startPriceUsd: startPriceQuote * quoteUsdPrice,
    midPriceUsd: assetMarkPrice,
    migrationPriceUsd: migrationPriceQuote * quoteUsdPrice,
    graduationQuoteUsd,
    actualStartQuote,
    actualMidQuote,
    actualEndQuote,
    floatSupply,
    supplyOnMigrationPct,
    initialMarketCapQuote,
    migrationMarketCapQuote,
    migrationQuoteThreshold,
    baseDecimals,
    quoteDecimals,
    quoteUsdPrice,
  };
}

/* ------------------------------------------------------------------ */
/* Simulator — walks the real on-chain curve math off-chain            */
/* ------------------------------------------------------------------ */

export interface CurvePoint {
  /** Cumulative quote-token raw units paid into the curve. */
  quoteInRaw: number;
  /** Cumulative base tokens bought (human units). */
  baseOut: number;
  /** Marginal price at this step, in quote tokens per base token. */
  priceQuote: number;
  /** % of the graduation threshold reached. */
  graduationPct: number;
  /** % of curve supply sold. */
  supplySoldPct: number;
}

export interface SimulationResult {
  points: CurvePoint[];
  totalBaseOut: number;
  /** Average price in quote tokens per base token. */
  avgPriceQuote: number;
  /** Fee (bps) at each scheduler period — real SDK fee math. */
  feeSchedule: { period: number; feeBps: number }[];
  quoteDecimals: number;
}

export function simulateCurve(
  build: EquityCurveBuild,
  steps = 120
): SimulationResult {
  const { config, baseDecimals, quoteDecimals } = build;
  const curve = config.curve as Array<{ sqrtPrice: BN; liquidity: BN }>;
  const tokenBaseDecimal =
    baseDecimals === 6 ? TokenDecimal.SIX : TokenDecimal.NINE;
  const tokenQuoteDecimal =
    quoteDecimals === 6 ? TokenDecimal.SIX : TokenDecimal.NINE;

  let currentSqrtPrice = config.sqrtStartPrice as BN;
  const stopSqrtPrice = curve[curve.length - 1].sqrtPrice;
  const chunk = build.migrationQuoteThreshold.div(new BN(steps));

  const points: CurvePoint[] = [];
  let cumQuote = new BN(0);
  let cumBase = new BN(0);

  for (let i = 0; i < steps; i++) {
    const { outputAmount, nextSqrtPrice, amountLeft } =
      calculateQuoteToBaseFromAmountIn(
        { curve },
        currentSqrtPrice,
        chunk,
        stopSqrtPrice
      );
    if (outputAmount.isZero()) break;
    cumQuote = cumQuote.add(chunk.sub(amountLeft));
    cumBase = cumBase.add(outputAmount);

    const priceQuote = getPriceFromSqrtPrice(
      nextSqrtPrice,
      tokenBaseDecimal,
      tokenQuoteDecimal
    ).toNumber();

    points.push({
      quoteInRaw: cumQuote.toNumber(),
      baseOut: cumBase.toNumber() / 10 ** baseDecimals,
      priceQuote,
      graduationPct:
        (cumQuote.toNumber() / build.migrationQuoteThreshold.toNumber()) * 100,
      supplySoldPct: 0, // filled below
    });
    currentSqrtPrice = nextSqrtPrice;
    if (amountLeft.gt(new BN(0))) break; // curve exhausted
  }

  const totalBaseOut = points.length > 0 ? points[points.length - 1].baseOut : 0;
  for (const p of points) {
    p.supplySoldPct = totalBaseOut > 0 ? (p.baseOut / totalBaseOut) * 100 : 0;
  }
  const avgPriceQuote =
    totalBaseOut > 0
      ? points[points.length - 1].quoteInRaw /
        10 ** quoteDecimals /
        totalBaseOut
      : 0;

  // Fee schedule from the REAL scheduler math embedded in the config.
  const baseFee = config.poolFees.baseFee as {
    cliffFeeNumerator: BN;
    thirdFactor: BN;
    firstFactor: number;
  };
  const feeSchedule: { period: number; feeBps: number }[] = [];
  for (let p = 0; p <= baseFee.firstFactor; p++) {
    const num = getFeeNumeratorOnLinearFeeScheduler(
      baseFee.cliffFeeNumerator,
      baseFee.thirdFactor,
      p
    );
    feeSchedule.push({ period: p, feeBps: feeNumeratorToBps(num) });
  }

  return { points, totalBaseOut, avgPriceQuote, feeSchedule, quoteDecimals };
}

/** USD formatting helpers for the UI. */
export const fmtUsd = (n: number, digits = 2) =>
  n >= 1_000_000_000
    ? `$${(n / 1_000_000_000).toFixed(digits)}B`
    : n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(digits)}M`
      : n >= 1_000
        ? `$${(n / 1_000).toFixed(digits)}K`
        : `$${n.toFixed(digits)}`;

export const fmtNum = (n: number, digits = 2) =>
  n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
