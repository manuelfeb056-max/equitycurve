/**
 * Deploys a REAL fair-value-anchored DBC pool on Solana devnet:
 *   faucet -> buildEquityCurve(ANDURIL) -> createConfigAndPool (one tx)
 *
 * Costs $0 (devnet faucet). Prints the pool address + explorer links.
 * Saves deployment info to scripts/.devnet-deploy.json (gitignored).
 *
 * Usage: npx tsx scripts/deploy-devnet.ts
 */
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import {
  DynamicBondingCurveClient,
  deriveDbcPoolAddress,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { buildEquityCurve, TIER_PRESETS, type EquityAsset } from '../src/lib/equity';
import { writeFileSync } from 'fs';
import bs58 from 'bs58';

const DEVNET = 'https://api.devnet.solana.com';

const ANDURIL: EquityAsset = {
  id: 'ANDURIL',
  name: 'Anduril PreStocks',
  symbol: 'ANDURIL',
  kind: 'pre-ipo',
  markPrice: 153.58402842,
  markValuation: 135875645158,
  source: 'prestocks.com/api/prestocks (snapshot 2026-09-20)',
};

/** Deployer: DEPLOYER_KEYPAIR env (base58 or JSON array) or fresh + airdrop. */
function loadDeployer(): Keypair {
  const raw = process.env.DEPLOYER_KEYPAIR?.trim();
  if (raw) {
    try {
      const secret =
        raw.startsWith('[')
          ? Uint8Array.from(JSON.parse(raw) as number[])
          : bs58.decode(raw);
      return Keypair.fromSecretKey(secret);
    } catch (e) {
      console.error('bad DEPLOYER_KEYPAIR:', (e as Error).message);
      process.exit(1);
    }
  }
  return Keypair.generate();
}

async function main() {
  const connection = new Connection(DEVNET, 'confirmed');
  const client = new DynamicBondingCurveClient(connection, 'confirmed');

  // 1. Deployer (devnet = free).
  const deployer = loadDeployer();
  console.log('deployer:', deployer.publicKey.toBase58());
  const bal = await connection.getBalance(deployer.publicKey);
  if (bal < 1_000_000_000) {
    const sig = await connection.requestAirdrop(deployer.publicKey, 2_000_000_000);
    await connection.confirmTransaction(sig, 'confirmed');
    console.log('airdrop confirmed');
  } else {
    console.log('deployer already funded:', bal / 1e9, 'SOL');
  }

  // 2. Build the fair-value-anchored curve.
  const build = buildEquityCurve({
    asset: ANDURIL,
    preset: TIER_PRESETS[0],
    baseDecimals: 6,
    quoteDecimals: 9,
    quoteUsdPrice: 200,
  });
  console.log(
    `curve: start $${build.startPriceUsd.toFixed(2)} -> anchor $${build.midPriceUsd.toFixed(2)} -> migration $${build.migrationPriceUsd.toFixed(2)}`
  );
  console.log(
    `float ${build.floatSupply} tokens, migration split ${build.supplyOnMigrationPct.toFixed(1)}%`
  );

  // 3. One transaction: create config + pool + mint.
  const configKp = Keypair.generate();
  const baseMintKp = Keypair.generate();
  const tx = await client.partner.createConfigAndPool({
    config: configKp.publicKey,
    feeClaimer: deployer.publicKey,
    leftoverReceiver: deployer.publicKey,
    payer: deployer.publicKey,
    quoteMint: NATIVE_MINT,
    ...build.config,
    preCreatePoolParam: {
      baseMint: baseMintKp.publicKey,
      name: 'Anduril x EquityCurve (devnet demo)',
      symbol: 'xANDURIL',
      uri: 'https://raw.githubusercontent.com/manuelfeb056-max/equitycurve/main/token-metadata/xanduril.json',
      poolCreator: deployer.publicKey,
    },
  });
  tx.feePayer = deployer.publicKey;
  const txSig = await sendAndConfirmTransaction(connection, tx, [
    deployer,
    configKp,
    baseMintKp,
  ]);
  console.log('tx:', txSig);

  const pool = deriveDbcPoolAddress(
    NATIVE_MINT,
    baseMintKp.publicKey,
    configKp.publicKey
  );
  console.log('\n=== DEPLOYED ON DEVNET ===');
  console.log('config :', configKp.publicKey.toBase58());
  console.log('mint   :', baseMintKp.publicKey.toBase58());
  console.log('pool   :', pool.toBase58());
  console.log(
    'explorer:',
    `https://solscan.io/account/${pool.toBase58()}?cluster=devnet`
  );

  // 4. Verify on-chain state reads back.
  const poolState = await client.state.getPool(pool);
  const poolConfig = await client.state.getPoolConfig(configKp.publicKey);
  console.log(
    'on-chain check: pool exists =',
    !!poolState,
    '| config exists =',
    !!poolConfig
  );

  writeFileSync(
    new URL('./.devnet-deploy.json', import.meta.url),
    JSON.stringify(
      {
        network: 'devnet',
        tx: txSig,
        config: configKp.publicKey.toBase58(),
        mint: baseMintKp.publicKey.toBase58(),
        pool: pool.toBase58(),
        deployer: deployer.publicKey.toBase58(),
        // NOTE: devnet keypair is a throwaway demo wallet. Not stored here.
        anchorUsd: ANDURIL.markPrice,
        floatSupply: build.floatSupply,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log('saved scripts/.devnet-deploy.json');
}

main().catch((e) => {
  console.error('DEPLOY FAILED:', e);
  process.exit(1);
});
