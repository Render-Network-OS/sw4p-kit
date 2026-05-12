/**
 * Solana devnet adapter — when env provides a private key, this signs and
 * submits real USDC SPL transfers on Solana devnet locally. The key never
 * leaves the host; the kit's MCP server reads it from process.env and uses it
 * to drive @solana/web3.js. Returns real on-chain signatures verifiable on
 * Solscan devnet.
 *
 * Intended use: hackathon demos and operator-side automation. For production
 * the canonical path is the sw4p settlement engine, which this adapter
 * mimics in shape so the kit's MCP tools behave identically.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import bs58 from "bs58";

const USDC_DEVNET_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const USDC_DECIMALS = 6;

function loadKeypair(privateKey: string): Keypair {
  const cleaned = privateKey.trim();
  if (cleaned.startsWith("[")) {
    const arr = JSON.parse(cleaned) as number[];
    return Keypair.fromSecretKey(new Uint8Array(arr));
  }
  const decoded = bs58.decode(cleaned);
  return Keypair.fromSecretKey(decoded);
}

export interface SolanaDevnetAdapterOptions {
  privateKey: string;
  rpcUrl?: string;
}

export class SolanaDevnetAdapter {
  private readonly conn: Connection;
  private readonly payer: Keypair;
  readonly walletAddress: string;

  constructor(opts: SolanaDevnetAdapterOptions) {
    this.conn = new Connection(opts.rpcUrl ?? "https://api.devnet.solana.com", "confirmed");
    this.payer = loadKeypair(opts.privateKey);
    this.walletAddress = this.payer.publicKey.toBase58();
  }

  async usdcBalance(owner?: string): Promise<string> {
    const ownerKey = owner ? new PublicKey(owner) : this.payer.publicKey;
    const ata = getAssociatedTokenAddressSync(USDC_DEVNET_MINT, ownerKey);
    try {
      const bal = await this.conn.getTokenAccountBalance(ata);
      return bal.value.uiAmountString ?? "0";
    } catch {
      return "0";
    }
  }

  async transferUsdc(opts: {
    recipient: string;
    amount: string;
  }): Promise<{
    signature: string;
    fromAta: string;
    toAta: string;
    explorerUrl: string;
    cluster: "devnet";
    settledAt: string;
  }> {
    const amountNum = Number.parseFloat(opts.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new Error(`invalid amount: ${opts.amount}`);
    }
    const recipient = new PublicKey(opts.recipient);
    const lamports = BigInt(Math.round(amountNum * 10 ** USDC_DECIMALS));

    const fromAta = getAssociatedTokenAddressSync(USDC_DEVNET_MINT, this.payer.publicKey);
    const toAtaInfo = await getOrCreateAssociatedTokenAccount(
      this.conn,
      this.payer,
      USDC_DEVNET_MINT,
      recipient
    );
    const toAta = toAtaInfo.address;

    const tx = new Transaction().add(
      createTransferCheckedInstruction(
        fromAta,
        USDC_DEVNET_MINT,
        toAta,
        this.payer.publicKey,
        lamports,
        USDC_DECIMALS
      )
    );
    tx.feePayer = this.payer.publicKey;
    const sig = await sendAndConfirmTransaction(this.conn, tx, [this.payer], {
      commitment: "confirmed",
    });
    return {
      signature: sig,
      fromAta: fromAta.toBase58(),
      toAta: toAta.toBase58(),
      explorerUrl: `https://orbmarkets.io/tx/${sig}?cluster=devnet`,
      cluster: "devnet",
      settledAt: new Date().toISOString(),
    };
  }

  async transferSol(opts: { recipient: string; amount: string }): Promise<{ signature: string; explorerUrl: string }> {
    const lamports = Math.round(Number.parseFloat(opts.amount) * 1e9);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.payer.publicKey,
        toPubkey: new PublicKey(opts.recipient),
        lamports,
      })
    );
    const sig = await sendAndConfirmTransaction(this.conn, tx, [this.payer]);
    return { signature: sig, explorerUrl: `https://orbmarkets.io/tx/${sig}?cluster=devnet` };
  }
}
