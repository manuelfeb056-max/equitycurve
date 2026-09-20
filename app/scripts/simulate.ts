/**
 * End-to-end sanity: build + simulate the fair-value-anchored curve for a
 * pre-IPO asset using the real Meteora DBC SDK math.
 *
 * Usage: npx tsx scripts/simulate.ts
 */
import {
  buildEquityCurve,
  simulateCurve,
  TIER_PRESETS,
  type EquityAsset,
} from '../src/lib/equity';

const ANDURIL: EquityAsset = {
  id: 'ANDURIL',
  name: 'Anduril PreStocks',
  symbol: 'ANDURIL',
  kind: 'pre-ipo',
  markPrice: 153.58402842,
  markValuation: 135875645158,
  source: 'prestocks.com/api/prestocks (snapshot 2026-09-20)',
};

const preset = TIER_PRESETS[0];
const QUOTE_USD = 200;
const build = buildEquityCurve({
  asset: ANDURIL,
  preset,
  baseDecimals: 6,
  quoteDecimals: 9,
  quoteUsdPrice: QUOTE_USD,
});

console.log('=== EquityCurve sanity: ANDURIL (pre-IPO preset) ===');
console.log(`mark (anchor)            : $${ANDURIL.markPrice.toFixed(4)}`);
console.log(
  `curve start (actual)       : $${(build.actualStartQuote * QUOTE_USD).toFixed(4)} (target $${build.startPriceUsd.toFixed(4)})`
);
console.log(
  `curve mid (actual)         : $${(build.actualMidQuote * QUOTE_USD).toFixed(4)} (anchor $${build.midPriceUsd.toFixed(4)})`
);
console.log(
  `curve end (actual)         : $${(build.actualEndQuote * QUOTE_USD).toFixed(4)} (target $${build.migrationPriceUsd.toFixed(4)})`
);
console.log(`float supply (solved)      : ${build.floatSupply.toLocaleString()} tokens`);
console.log(
  `migration split (solved)   : ${build.supplyOnMigrationPct.toFixed(1)}% -> DAMM v2`
);
const thresholdSol = build.migrationQuoteThreshold.toNumber() / 1e9;
console.log(
  `graduation threshold       : ${thresholdSol.toFixed(1)} SOL ≈ $${(thresholdSol * QUOTE_USD).toLocaleString()} (target $${preset.graduationQuoteUsd.toLocaleString()})`
);

const sim = simulateCurve(build, 120);
const first = sim.points[0];
const last = sim.points[sim.points.length - 1];
const mid = sim.points[Math.floor(sim.points.length / 2)];
console.log(`\n--- curve walk (${sim.points.length} steps) ---`);
console.log(
  `first fill  : $${(first.priceQuote * QUOTE_USD).toFixed(4)} | mid fill: $${(mid.priceQuote * QUOTE_USD).toFixed(4)} | last fill: $${(last.priceQuote * QUOTE_USD).toFixed(4)}`
);
console.log(
  `avg execution: $${(sim.avgPriceQuote * QUOTE_USD).toFixed(4)} | tokens sold: ${sim.totalBaseOut.toFixed(1)}`
);
console.log(
  `fee decay   : ${sim.feeSchedule[0].feeBps}bps -> ${sim.feeSchedule[sim.feeSchedule.length - 1].feeBps}bps over ${sim.feeSchedule.length - 1} periods`
);

const ok =
  Math.abs(build.actualMidQuote * QUOTE_USD - ANDURIL.markPrice) / ANDURIL.markPrice < 0.01 &&
  Math.abs(thresholdSol * QUOTE_USD - preset.graduationQuoteUsd) / preset.graduationQuoteUsd < 0.05 &&
  sim.feeSchedule[0].feeBps === preset.startFeeBps &&
  sim.feeSchedule[sim.feeSchedule.length - 1].feeBps === preset.endFeeBps;
console.log(`\n${ok ? 'SANITY PASS' : 'SANITY FAIL'}`);
if (!ok) process.exit(1);
