/**
 * PreStocks asset universe: live API with a bundled snapshot fallback.
 * https://prestocks.com/api/prestocks (public, no key)
 */
import type { EquityAsset } from './equity';

interface PreStocksEntry {
  name: string;
  symbol: string;
  description: string;
  image: string;
  external_url: string;
  contract_address: string;
  markPrice: number;
  markValuation: number;
}

/** Snapshot 2026-09-20 — used when the live API is unreachable (CORS/offline). */
export const PRESTOCKS_SNAPSHOT: PreStocksEntry[] = [
  { name: 'Anduril PreStocks', symbol: 'ANDURIL', description: '', image: 'https://www.prestocks.com/logos/anduril.png', external_url: 'https://www.prestocks.com/anduril', contract_address: 'PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB', markPrice: 153.58402842, markValuation: 135875645158 },
  { name: 'Anthropic PreStocks', symbol: 'ANTHROPIC', description: '', image: 'https://www.prestocks.com/logos/anthropic.png', external_url: 'https://www.prestocks.com/anthropic', contract_address: 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw', markPrice: 1029.92536215, markValuation: 1687370289935 },
  { name: 'Figure AI PreStocks', symbol: 'FIGUREAI', description: '', image: 'https://www.prestocks.com/logos/figureai.png', external_url: 'https://www.prestocks.com/figureai', contract_address: 'PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd', markPrice: 181.23861357, markValuation: 39514908309 },
  { name: 'Kalshi PreStocks', symbol: 'KALSHI', description: '', image: 'https://www.prestocks.com/logos/kalshi.png', external_url: 'https://www.prestocks.com/kalshi', contract_address: 'PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua', markPrice: 894.76122411, markValuation: 32544302699 },
  { name: 'Neuralink PreStocks', symbol: 'NEURALINK', description: '', image: 'https://www.prestocks.com/logos/neuralink.png', external_url: 'https://www.prestocks.com/neuralink', contract_address: 'PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S', markPrice: 335.43342713, markValuation: 63898407307 },
  { name: 'OpenAI PreStocks', symbol: 'OPENAI', description: '', image: 'https://www.prestocks.com/logos/openai.png', external_url: 'https://www.prestocks.com/openai', contract_address: 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF', markPrice: 994.6178052635471, markValuation: 1232262133719 },
  { name: 'Polymarket PreStocks', symbol: 'POLYMARKET', description: '', image: 'https://www.prestocks.com/logos/polymarket.png', external_url: 'https://www.prestocks.com/polymarket', contract_address: 'Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP', markPrice: 143.88899223, markValuation: 14191161713 },
  { name: 'SpaceX PreStocks', symbol: 'SPACEX', description: '', image: 'https://www.prestocks.com/logos/spacex.png', external_url: 'https://www.prestocks.com/spacex', contract_address: 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh', markPrice: 152.66701453837902, markValuation: 2001634190614 },
];

/** Listed-stock references (static; the anchor for large-cap tier demos). */
export const LISTED_SNAPSHOT: EquityAsset[] = [
  { id: 'AAPL', name: 'Apple Inc.', symbol: 'AAPL', kind: 'listed', markPrice: 262.4, markValuation: 3.98e12, source: 'reference quote (demo)' },
  { id: 'NVDA', name: 'NVIDIA Corp.', symbol: 'NVDA', kind: 'listed', markPrice: 186.2, markValuation: 4.52e12, source: 'reference quote (demo)' },
  { id: 'TSLA', name: 'Tesla Inc.', symbol: 'TSLA', kind: 'listed', markPrice: 248.9, markValuation: 7.98e11, source: 'reference quote (demo)' },
];

export interface AssetUniverse {
  assets: EquityAsset[];
  live: boolean;
}

export async function loadAssetUniverse(): Promise<AssetUniverse> {
  const fromEntry = (e: PreStocksEntry): EquityAsset => ({
    id: e.symbol,
    name: e.name,
    symbol: e.symbol,
    kind: 'pre-ipo',
    markPrice: e.markPrice,
    markValuation: e.markValuation,
    logo: e.image,
    source: 'prestocks.com/api/prestocks',
  });
  try {
    const res = await fetch('https://prestocks.com/api/prestocks');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as PreStocksEntry[];
    if (!Array.isArray(data) || data.length === 0) throw new Error('empty');
    return {
      assets: [...data.map(fromEntry), ...LISTED_SNAPSHOT],
      live: true,
    };
  } catch {
    return {
      assets: [...PRESTOCKS_SNAPSHOT.map(fromEntry), ...LISTED_SNAPSHOT],
      live: false,
    };
  }
}
