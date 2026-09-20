/**
 * Browser deploy: builds the real createConfigAndPool transaction and asks
 * Phantom (window.solana) to sign + send it on devnet.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import {
  DynamicBondingCurveClient,
  deriveDbcPoolAddress,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import type { EquityCurveBuild } from './equity';
import { DEVNET_RPC } from './monitor';

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: PublicKey;
  connect(): Promise<{ publicKey: PublicKey }>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
}

function getPhantom(): PhantomProvider {
  const w = window as unknown as { solana?: PhantomProvider };
  if (!w.solana?.isPhantom) {
    throw new Error('Phantom wallet not found. Install it to deploy from the browser.');
  }
  return w.solana;
}

export interface BrowserDeployResult {
  signature: string;
  config: string;
  mint: string;
  pool: string;
}

export async function deployFromBrowser(
  build: EquityCurveBuild,
  tokenName: string,
  tokenSymbol: string,
  metadataUri: string,
  onStatus: (msg: string) => void
): Promise<BrowserDeployResult> {
  const phantom = getPhantom();
  onStatus('Connecting Phantom…');
  const { publicKey } = await phantom.connect();

  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const client = new DynamicBondingCurveClient(connection, 'confirmed');

  const configKp = Keypair.generate();
  const baseMintKp = Keypair.generate();

  onStatus('Building createConfigAndPool transaction…');
  const tx = await client.partner.createConfigAndPool({
    config: configKp.publicKey,
    feeClaimer: publicKey,
    leftoverReceiver: publicKey,
    payer: publicKey,
    quoteMint: NATIVE_MINT,
    ...build.config,
    preCreatePoolParam: {
      baseMint: baseMintKp.publicKey,
      name: tokenName,
      symbol: tokenSymbol,
      uri: metadataUri,
      poolCreator: publicKey,
    },
  });
  tx.feePayer = publicKey;
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  // createConfigAndPool needs the config + mint keypairs as signers; the
  // browser can't sign for them, so we partial-sign here (they're ours).
  tx.partialSign(configKp, baseMintKp);

  onStatus('Approve the transaction in Phantom…');
  const { signature } = await phantom.signAndSendTransaction(tx);
  onStatus('Confirming…');
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed'
  );

  const pool = deriveDbcPoolAddress(
    NATIVE_MINT,
    baseMintKp.publicKey,
    configKp.publicKey
  );
  onStatus('Deployed.');
  return {
    signature,
    config: configKp.publicKey.toBase58(),
    mint: baseMintKp.publicKey.toBase58(),
    pool: pool.toBase58(),
  };
}
