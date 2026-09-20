import { useEffect, useMemo, useState } from 'react';
import {
  buildEquityCurve,
  simulateCurve,
  TIER_PRESETS,
  fmtUsd,
  fmtNum,
  type EquityAsset,
  type TierPreset,
} from './lib/equity';
import { loadAssetUniverse } from './lib/prestocks';
import { deployFromBrowser, type BrowserDeployResult } from './lib/deploy';
import { fetchPoolSnapshot, DEVNET_RPC, MAINNET_RPC, type PoolSnapshot } from './lib/monitor';
import { CurveChart, FeeChart } from './components/Charts';
import './index.css';

const STEPS = ['Pick asset', 'Configure', 'Simulate', 'Deploy', 'Monitor'];

const QUOTES = {
  'sol-devnet': { label: 'wSOL · devnet', decimals: 9, usd: 200, note: 'Free via faucet. For live demos.' },
  'usdc-mainnet': { label: 'USDC · mainnet', decimals: 6, usd: 1, note: 'Production. Keepers migrate at ≥750 USDC.' },
} as const;

interface Params {
  startDiscountBps: number;
  migrationPremiumBps: number;
  startFeeBps: number;
  endFeeBps: number;
  feePeriods: number;
  feeDurationHrs: number;
  graduationUsd: number;
  quote: keyof typeof QUOTES;
}

function paramsFromPreset(p: TierPreset): Params {
  return {
    startDiscountBps: p.startDiscountBps,
    migrationPremiumBps: p.migrationPremiumBps,
    startFeeBps: p.startFeeBps,
    endFeeBps: p.endFeeBps,
    feePeriods: p.feePeriods,
    feeDurationHrs: Math.round(p.feeDurationSec / 3600),
    graduationUsd: p.graduationQuoteUsd,
    quote: 'sol-devnet',
  };
}

export default function App() {
  const [step, setStep] = useState(0);
  const [assets, setAssets] = useState<EquityAsset[]>([]);
  const [live, setLive] = useState(false);
  const [asset, setAsset] = useState<EquityAsset | null>(null);
  const [presetId, setPresetId] = useState('pre-ipo');
  const [params, setParams] = useState<Params | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState('');
  const [deployed, setDeployed] = useState<BrowserDeployResult | null>(null);
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [poolAddr, setPoolAddr] = useState('');
  const [network, setNetwork] = useState<'devnet' | 'mainnet'>('devnet');
  const [snapshot, setSnapshot] = useState<PoolSnapshot | null>(null);
  const [loadingSnap, setLoadingSnap] = useState(false);
  const [snapError, setSnapError] = useState('');

  useEffect(() => {
    loadAssetUniverse().then((u) => {
      setAssets(u.assets);
      setLive(u.live);
      const first = u.assets[0];
      setAsset(first);
      const pre = TIER_PRESETS[0];
      setPresetId(pre.id);
      setParams(paramsFromPreset(pre));
      setTokenName(`${first.name} (devnet demo)`);
      setTokenSymbol(`x${first.symbol.slice(0, 8)}`);
    });
  }, []);

  const preset = useMemo(
    () => TIER_PRESETS.find((p) => p.id === presetId) ?? TIER_PRESETS[0],
    [presetId]
  );

  const merged: TierPreset | null = useMemo(() => {
    if (!params) return null;
    return {
      ...preset,
      startDiscountBps: params.startDiscountBps,
      migrationPremiumBps: params.migrationPremiumBps,
      startFeeBps: params.startFeeBps,
      endFeeBps: params.endFeeBps,
      feePeriods: params.feePeriods,
      feeDurationSec: params.feeDurationHrs * 3600,
      graduationQuoteUsd: params.graduationUsd,
    };
  }, [preset, params]);

  const build = useMemo(() => {
    if (!asset || !merged || !params) return null;
    try {
      const q = QUOTES[params.quote];
      return buildEquityCurve({
        asset,
        preset: merged,
        baseDecimals: 6,
        quoteDecimals: q.decimals,
        quoteUsdPrice: q.usd,
      });
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [asset, merged, params]);

  const sim = useMemo(() => (build ? simulateCurve(build, 120) : null), [build]);
  const quoteUsd = params ? QUOTES[params.quote].usd : 200;

  const pickPreset = (id: string) => {
    const p = TIER_PRESETS.find((x) => x.id === id)!;
    setPresetId(id);
    setParams((prev) => ({ ...paramsFromPreset(p), quote: prev?.quote ?? 'sol-devnet' }));
  };

  const doDeploy = async () => {
    if (!build) return;
    setDeploying(true);
    setDeployStatus('');
    try {
      const r = await deployFromBrowser(
        build,
        tokenName || `${asset?.name} (devnet demo)`,
        tokenSymbol || 'xSTOCK',
        'https://raw.githubusercontent.com/manuelfeb056-max/equitycurve/main/token-metadata/xanduril.json',
        setDeployStatus
      );
      setDeployed(r);
      setPoolAddr(r.pool);
    } catch (e) {
      setDeployStatus(`Error: ${(e as Error).message}`);
    } finally {
      setDeploying(false);
    }
  };

  const loadSnapshot = async () => {
    if (!poolAddr) return;
    setLoadingSnap(true);
    setSnapError('');
    setSnapshot(null);
    try {
      const s = await fetchPoolSnapshot(
        poolAddr.trim(),
        network === 'devnet' ? DEVNET_RPC : MAINNET_RPC
      );
      setSnapshot(s);
    } catch (e) {
      setSnapError((e as Error).message);
    } finally {
      setLoadingSnap(false);
    }
  };

  const setP = (k: keyof Params, v: number | string) =>
    setParams((p) => (p ? { ...p, [k]: v } : p));

  return (
    <div className="wrap">
      <div className="hdr">
        <div className="brand">
          <div className="logo">≡</div>
          <div>
            <h1>EquityCurve</h1>
            <p>Fair-value-anchored DBC launches for tokenized stocks · STOCKLANA</p>
          </div>
        </div>
        <span className={`badge ${live ? 'live' : 'snap'}`}>
          {live ? '● PreStocks live' : '◐ snapshot 2026-09-20'}
        </span>
      </div>

      <div className="steps">
        {STEPS.map((t, i) => (
          <button
            key={t}
            className={`step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
            onClick={() => setStep(i)}
          >
            <div className="n">STEP {i + 1}</div>
            <div className="t">{t}</div>
          </button>
        ))}
      </div>

      {step === 0 && (
        <>
          <h2 className="sec">Pick the asset to launch</h2>
          <p className="lead">
            Pre-IPO names come from the PreStocks API with live <b>mark prices</b> — the
            fair-value anchor your curve will be built around. Memecoin launches start
            at $0 and pray. Equity launches start at the mark.
          </p>
          <div className="grid assets">
            {assets.map((a) => (
              <div
                key={a.id}
                className={`card asset ${asset?.id === a.id ? 'sel' : ''}`}
                onClick={() => {
                  setAsset(a);
                  setTokenName(`${a.name} (devnet demo)`);
                  setTokenSymbol(`x${a.symbol.slice(0, 8)}`);
                }}
              >
                <div className="top">
                  {a.logo ? <img src={a.logo} alt="" /> : <div className="ini">{a.symbol[0]}</div>}
                  <div>
                    <h3>{a.name}</h3>
                    <span className="sym">{a.symbol}</span>
                  </div>
                  <span className={`kind ${a.kind === 'pre-ipo' ? 'pre' : 'listed'}`} style={{ marginLeft: 'auto' }}>
                    {a.kind === 'pre-ipo' ? 'PRE-IPO' : 'LISTED'}
                  </span>
                </div>
                <div className="price">${fmtNum(a.markPrice)}</div>
                <div className="sub">mark valuation {fmtUsd(a.markValuation)}</div>
              </div>
            ))}
          </div>
          <div className="nav">
            <span />
            <button className="btn" onClick={() => setStep(1)} disabled={!asset}>Configure →</button>
          </div>
        </>
      )}

      {step === 1 && params && (
        <>
          <h2 className="sec">Configure the launch</h2>
          <p className="lead">
            Two liquidity tiers, tuned for equity-like assets. The solver derives the
            float size and migration split from your band + graduation target — a tight
            band only stays feasible near a ~48% migration split, which means{' '}
            <b>half the float seeds the permanent DAMM v2 market</b>.
          </p>
          <div className="two">
            <div>
              <div className="grid" style={{ marginBottom: 16 }}>
                {TIER_PRESETS.map((p) => (
                  <div
                    key={p.id}
                    className={`card asset ${presetId === p.id ? 'sel' : ''}`}
                    onClick={() => pickPreset(p.id)}
                  >
                    <h3 style={{ margin: '0 0 6px' }}>{p.label}</h3>
                    <div className="sub" style={{ fontSize: 13, color: 'var(--mut)', lineHeight: 1.5 }}>{p.blurb}</div>
                  </div>
                ))}
              </div>
              <div className="field">
                <label>Quote token <b>{QUOTES[params.quote].label}</b></label>
                <select value={params.quote} onChange={(e) => setP('quote', e.target.value)}>
                  {(Object.keys(QUOTES) as (keyof typeof QUOTES)[]).map((k) => (
                    <option key={k} value={k}>{QUOTES[k].label} — {QUOTES[k].note}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="card">
              <div className="field">
                <label>Early-buyer discount <b>{(params.startDiscountBps / 100).toFixed(1)}%</b></label>
                <input type="range" min={0} max={1000} step={25} value={params.startDiscountBps}
                  onChange={(e) => setP('startDiscountBps', Number(e.target.value))} />
              </div>
              <div className="field">
                <label>Migration premium <b>{(params.migrationPremiumBps / 100).toFixed(1)}%</b></label>
                <input type="range" min={100} max={3000} step={50} value={params.migrationPremiumBps}
                  onChange={(e) => setP('migrationPremiumBps', Number(e.target.value))} />
              </div>
              <div className="field">
                <label>Opening fee <b>{params.startFeeBps} bps</b></label>
                <input type="range" min={25} max={1000} step={5} value={params.startFeeBps}
                  onChange={(e) => setP('startFeeBps', Number(e.target.value))} />
              </div>
              <div className="field">
                <label>Mature fee <b>{params.endFeeBps} bps</b></label>
                <input type="range" min={10} max={200} step={5} value={params.endFeeBps}
                  onChange={(e) => setP('endFeeBps', Number(e.target.value))} />
              </div>
              <div className="field">
                <label>Fee decay horizon <b>{params.feeDurationHrs}h / {params.feePeriods} periods</b></label>
                <input type="range" min={6} max={168} step={6} value={params.feeDurationHrs}
                  onChange={(e) => setP('feeDurationHrs', Number(e.target.value))} />
              </div>
              <div className="field">
                <label>Graduation target <b>{fmtUsd(params.graduationUsd, 0)}</b></label>
                <input type="range" min={5000} max={500000} step={5000} value={params.graduationUsd}
                  onChange={(e) => setP('graduationUsd', Number(e.target.value))} />
              </div>
            </div>
          </div>
          <div className="nav">
            <button className="btn ghost" onClick={() => setStep(0)}>← Assets</button>
            <button className="btn" onClick={() => setStep(2)} disabled={!build}>Simulate →</button>
          </div>
        </>
      )}

      {step === 2 && build && sim && asset && (
        <>
          <h2 className="sec">Simulate before you deploy</h2>
          <p className="lead">
            Every number below comes from the <b>real Meteora DBC SDK math</b> running in
            your browser — the same curve builder and quote functions the on-chain
            program uses. The dashed line is the fair-value anchor: price discovery
            happens <i>around</i> it, not from zero.
          </p>
          <div className="stats">
            <div className="stat"><div className="l">Anchor (mark)</div><div className="v gold">${fmtNum(asset.markPrice)}</div></div>
            <div className="stat"><div className="l">Curve start</div><div className="v">${fmtNum(build.actualStartQuote * quoteUsd)}</div></div>
            <div className="stat"><div className="l">Migration price</div><div className="v">${fmtNum(build.actualEndQuote * quoteUsd)}</div></div>
            <div className="stat"><div className="l">Float (solved)</div><div className="v">{build.floatSupply.toLocaleString()} <span style={{ fontSize: 12 }}>tokens</span></div></div>
            <div className="stat"><div className="l">→ DAMM v2 (solved)</div><div className="v green">{build.supplyOnMigrationPct.toFixed(1)}%</div></div>
            <div className="stat"><div className="l">Graduation</div><div className="v">{fmtUsd((build.migrationQuoteThreshold.toNumber() / 10 ** build.quoteDecimals) * quoteUsd, 0)}</div></div>
            <div className="stat"><div className="l">Avg execution</div><div className="v">${fmtNum(sim.avgPriceQuote * quoteUsd)}</div></div>
            <div className="stat"><div className="l">Fee decay</div><div className="v">{sim.feeSchedule[0].feeBps}→{sim.feeSchedule[sim.feeSchedule.length - 1].feeBps} <span style={{ fontSize: 12 }}>bps</span></div></div>
          </div>
          <div className="two">
            <div className="card"><h3 style={{ margin: '0 0 10px' }}>Bonding curve</h3><CurveChart sim={sim} quoteUsd={quoteUsd} anchorUsd={asset.markPrice} /></div>
            <div className="card"><h3 style={{ margin: '0 0 10px' }}>Fee schedule (linear decay)</h3><FeeChart sim={sim} /></div>
          </div>
          <div className="thesis">
            <b>Why this beats a memecoin curve for stocks:</b> the float is sized so
            graduation fires when <b>{fmtUsd((build.migrationQuoteThreshold.toNumber() / 10 ** build.quoteDecimals) * quoteUsd, 0)}</b> of
            real liquidity has validated the mark — not when speculators 100x'd a zero.
            Opening fees ({sim.feeSchedule[0].feeBps}bps) protect the thin early book from
            snipers; they decay to brokerage-like {sim.feeSchedule[sim.feeSchedule.length - 1].feeBps}bps
            as the pool matures into its permanent DAMM v2 market.
          </div>
          <div className="nav">
            <button className="btn ghost" onClick={() => setStep(1)}>← Configure</button>
            <button className="btn" onClick={() => setStep(3)}>Deploy →</button>
          </div>
        </>
      )}

      {step === 3 && build && (
        <>
          <h2 className="sec">Deploy the pool</h2>
          <p className="lead">
            One transaction — <b>createConfigAndPool</b> — creates the DBC config, the
            pool, and the token mint together. On devnet it costs $0 (faucet SOL).
          </p>
          <div className="two">
            <div className="card">
              <h3 style={{ margin: '0 0 10px' }}>On-chain parameters</h3>
              <table className="params"><tbody>
                <tr><td>Curve</td><td>two-segment, fair-value-anchored</td></tr>
                <tr><td>Start / anchor / migration</td><td>${fmtNum(build.actualStartQuote * quoteUsd)} / ${fmtNum(build.actualMidQuote * quoteUsd)} / ${fmtNum(build.actualEndQuote * quoteUsd)}</td></tr>
                <tr><td>Float supply</td><td>{build.floatSupply.toLocaleString()} tokens</td></tr>
                <tr><td>Base fee</td><td>{params && `${params.startFeeBps}→${params.endFeeBps} bps linear, ${params.feePeriods} periods`}</td></tr>
                <tr><td>Dynamic fee</td><td>enabled (volatility-capped)</td></tr>
                <tr><td>Graduation threshold</td><td>{(build.migrationQuoteThreshold.toNumber() / 10 ** build.quoteDecimals).toFixed(2)} {params?.quote === 'usdc-mainnet' ? 'USDC' : 'SOL'}</td></tr>
                <tr><td>Migration</td><td>DAMM v2, {build.supplyOnMigrationPct.toFixed(1)}% of float, {preset.migratedPoolFeeBps}bps pool fee</td></tr>
                <tr><td>LP lock</td><td>100% partner permanent lock</td></tr>
              </tbody></table>
            </div>
            <div className="card">
              <h3 style={{ margin: '0 0 10px' }}>Token</h3>
              <div className="field">
                <label>Name</label>
                <input type="text" value={tokenName} onChange={(e) => setTokenName(e.target.value)} />
              </div>
              <div className="field">
                <label>Symbol</label>
                <input type="text" value={tokenSymbol} onChange={(e) => setTokenSymbol(e.target.value)} />
              </div>
              <button className="btn" onClick={doDeploy} disabled={deploying} style={{ width: '100%' }}>
                {deploying ? 'Deploying…' : '⚡ Deploy to devnet with Phantom'}
              </button>
              {deployStatus && <div className="code">{deployStatus}</div>}
              {deployed && (
                <>
                  <div className="code">tx: {deployed.signature}</div>
                  <div className="code">pool: {deployed.pool}</div>
                  <a href={`https://solscan.io/account/${deployed.pool}?cluster=devnet`} target="_blank" rel="noreferrer">
                    View pool on Solscan (devnet) →
                  </a>
                </>
              )}
              <div className="note warn" style={{ marginTop: 14 }}>
                <b>Mainnet checklist:</b> switch quote to USDC (6 decimals); graduation
                threshold ≥ 750 USDC so Meteora's keepers auto-migrate; keepers only
                migrate Jupiter-verified / stock-token pairs meeting the notional bar —
                coordinate the listing; get the token metadata + icon production-ready.
              </div>
            </div>
          </div>
          <div className="nav">
            <button className="btn ghost" onClick={() => setStep(2)}>← Simulate</button>
            <button className="btn" onClick={() => setStep(4)}>Monitor →</button>
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <h2 className="sec">Monitor the pool</h2>
          <p className="lead">
            Live on-chain state: quote raised vs. the graduation threshold, current
            curve price, and migration eligibility — read straight from the DBC program.
          </p>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="two">
              <div className="field" style={{ margin: 0 }}>
                <label>Pool address</label>
                <input type="text" placeholder="DBC pool address…" value={poolAddr}
                  onChange={(e) => setPoolAddr(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Network</label>
                <select value={network} onChange={(e) => setNetwork(e.target.value as 'devnet' | 'mainnet')}>
                  <option value="devnet">devnet</option>
                  <option value="mainnet">mainnet-beta</option>
                </select>
              </div>
            </div>
            <button className="btn" onClick={loadSnapshot} disabled={loadingSnap || !poolAddr} style={{ marginTop: 14 }}>
              {loadingSnap ? 'Loading…' : 'Load pool state'}
            </button>
            {snapError && <div className="code" style={{ color: 'var(--bad)' }}>{snapError}</div>}
          </div>
          {snapshot && (
            <>
              <div className="stats">
                <div className="stat"><div className="l">Graduation progress</div><div className="v green">{snapshot.graduationPct.toFixed(1)}%</div></div>
                <div className="stat"><div className="l">Quote raised</div><div className="v">{snapshot.quoteReserveUi.toFixed(2)} / {snapshot.migrationThresholdUi.toFixed(2)}</div></div>
                <div className="stat"><div className="l">Current price</div><div className="v">{snapshot.currentPriceQuote.toFixed(4)} quote/token</div></div>
                <div className="stat"><div className="l">Status</div><div className="v gold">{snapshot.graduated ? 'READY TO MIGRATE' : 'IN CURVE'}</div></div>
              </div>
              <div className="card">
                <div className="progress"><div style={{ width: `${snapshot.graduationPct}%` }} /></div>
                <table className="params" style={{ marginTop: 12 }}><tbody>
                  <tr><td>Pool</td><td>{snapshot.pool}</td></tr>
                  <tr><td>Config</td><td>{snapshot.config}</td></tr>
                  <tr><td>Base mint</td><td>{snapshot.baseMint}</td></tr>
                  <tr><td>Quote mint</td><td>{snapshot.quoteMint}</td></tr>
                </tbody></table>
              </div>
            </>
          )}
          <div className="nav">
            <button className="btn ghost" onClick={() => setStep(3)}>← Deploy</button>
            <span />
          </div>
        </>
      )}

      <footer>
        <span>EquityCurve · STOCKLANA hackathon · Best Use of Meteora DBC</span>
        <span>Curve math: @meteora-ag/dynamic-bonding-curve-sdk (MIT) · Prices: PreStocks API</span>
      </footer>
    </div>
  );
}
