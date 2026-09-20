# EquityCurve — Fair-Value-Anchored DBC Launches for Tokenized Stocks

> **STOCKLANA hackathon · targeting Best Use of Meteora DBC ($5,000)**

**Live demo:** https://manuelfeb056-max.github.io/equitycurve/

Memecoin launch curves start at $0 and discover price from nothing. That works
for memes — it fails for stocks. A tokenized stock already has a value: the
mark. EquityCurve is a launch toolkit that builds Meteora Dynamic Bonding Curve
pools **anchored to fair value**, so price discovery happens *around* the mark
instead of from zero.

## The idea

A two-segment DBC curve pinned to the reference price:

1. **Segment 1** opens at a controlled discount to the mark (e.g. −3%) — early
   buyers get paid for taking launch risk, but the discount is bounded.
2. The curve crosses **exactly through the mark** at the segment midpoint.
3. **Segment 2** rises to a capped migration premium (e.g. +8.8%) at graduation.

On top of the curve:

- **Protective → brokerage fee decay.** High opening fees (200 bps for pre-IPO)
  defend the thin early book against snipers; they decay linearly to
  brokerage-like levels (30 bps) as the pool matures. Dynamic fees stay on for
  volatility protection.
- **Graduation as proof-of-liquidity.** The threshold is set in real notional
  (e.g. $50K) so migration to DAMM v2 only fires when genuine liquidity has
  validated the mark — not when speculators 100x'd a zero.
- **A feasibility solver.** Tight bands around a mark are not always solvable:
  `percentageSupplyOnMigration` must land in (0, 100) *and* the curve must hold
  two valid segments *and* the threshold must match the target. EquityCurve
  derives the float size and migration split mathematically instead of guessing.
  For the ANDURIL demo it solved **623 tokens / 48.4% → DAMM v2** — half the
  float permanently seeds the post-graduation market.

## Real integration, not slides

- Built on `@meteora-ag/dynamic-bonding-curve-sdk` (v1.5.12) — curve math,
  fee scheduler, and pool creation all run through the real SDK.
- The simulator (`app/src/lib/equity.ts`) uses the SDK's actual
  `buildCurveWithMidPrice` + `calculateQuoteToBaseFromAmountIn` + fee schedule
  functions, so the "Simulate" step previews the exact on-chain behavior.
- Deployment is a single `createConfigAndPool` transaction: config + pool +
  mint in one shot. The "Deploy" step builds that exact transaction in the
  browser and asks Phantom to sign it.
- The "Monitor" step reads live pool state (reserves, sqrt price, threshold)
  via `client.state.getPool` / `getPoolConfig`.

## Devnet deployment

`scripts/deploy-devnet.ts` deploys a real pool on Solana devnet (faucet SOL,
$0) via GitHub Actions (workflow `devnet-deploy`): config + pool + mint in one
`createConfigAndPool` transaction. The pool address and transaction are shown
in the app after deployment.

SDK simulation sanity (local, `npx tsx scripts/simulate.ts`, 120 steps) for
the ANDURIL demo config:

- Curve: start $148.98 → anchor $153.58 → migration $167.16
- Float: 623 tokens · migration split: 48.4% · threshold: 249.9 SOL ≈ $49,981
- 120-step fills $149.08 → $156.31 → $167.16, avg execution $156.68: PASS

## What changes on mainnet

Same program (`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`), same SDK calls.
For production: quote in USDC, graduation threshold ≥ 750 USDC so Meteora's
keepers auto-migrate the pool to DAMM v2, and coordinate a Jupiter-verified
listing for the stock token.

## PreStocks integration

Asset marks come from the public PreStocks API
(`https://prestocks.com/api/prestocks`, no key), with a bundled snapshot
fallback if the API is unreachable. Demo assets: ANDURIL, ANTHROPIC, FIGUREAI,
KALSHI, NEURALINK, OPENAI, POLYMARKET, SPACEX + listed references
(AAPL/NVDA/TSLA). Only PreStocks tokens are integrated.

## Run it

```bash
cd app
npm install
npm run dev        # frontend
npx tsx scripts/simulate.ts   # SDK simulation sanity check
```

Deploy to GitHub Pages: push to `main` — the `deploy-pages` workflow builds
`app/` and publishes it.

## Disclaimer

Demo/educational project. Nothing here is a real security, investment advice,
or an offer to sell securities. Tokenized-stock demos run on devnet with
worthless test tokens.

## Attribution

- Meteora DBC SDK: https://github.com/MeteoraAg/dynamic-bonding-curve-sdk (MIT)
- Price marks: PreStocks API (https://prestocks.com)
- Original work by Nueve / MP9 for the STOCKLANA hackathon.
