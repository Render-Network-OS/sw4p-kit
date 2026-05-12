/**
 * Base Sepolia adapter — when env provides a private key, this signs and
 * submits real USDC transfers on Base Sepolia locally via ethers. The key
 * never leaves the host; same pattern as the Solana devnet adapter.
 *
 * USDC contract on Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
 * (Circle's official testnet USDC mint).
 */

import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits } from "ethers";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_SOLANA_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const USDC_DECIMALS = 6;

// CCTP V2 TokenMessenger — same address on every testnet via CREATE2.
const TOKEN_MESSENGER_V2_TESTNET = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
// CCTP V2 MessageTransmitter — same CREATE2 address on every testnet.
const MESSAGE_TRANSMITTER_V2_TESTNET = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
// CCTP V2 destination domain IDs.
const DOMAIN_SOLANA = 5;
// Fast Transfer finality threshold (≤1000 = Fast).
const FAST_FINALITY = 1000;
// Zero bytes32 — no destinationCaller restriction (anyone can mint on destination).
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const TOKEN_MESSENGER_V2_ABI = [
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
];

const MESSAGE_TRANSMITTER_V2_ABI = [
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
];

function solanaPubkeyToBytes32(pubkey: string): string {
  const decoded = bs58.decode(pubkey);
  if (decoded.length !== 32) throw new Error(`solana pubkey must decode to 32 bytes, got ${decoded.length}`);
  return "0x" + Buffer.from(decoded).toString("hex");
}

/**
 * CCTP V2 Solana receive requires mintRecipient to be the destination SPL
 * Token Account (ATA), not the owner wallet. Given an owner wallet pubkey,
 * compute the canonical ATA for USDC on Solana devnet.
 */
function solanaOwnerToUsdcAta(owner: string): string {
  const ownerPk = new PublicKey(owner);
  const ata = getAssociatedTokenAddressSync(USDC_SOLANA_DEVNET, ownerPk);
  return ata.toBase58();
}

export interface BaseSepoliaAdapterOptions {
  privateKey: string;
  rpcUrl?: string;
}

export class BaseSepoliaAdapter {
  private readonly provider: JsonRpcProvider;
  private readonly wallet: Wallet;
  readonly walletAddress: string;

  constructor(opts: BaseSepoliaAdapterOptions) {
    const rpc = opts.rpcUrl ?? "https://sepolia.base.org";
    this.provider = new JsonRpcProvider(rpc);
    const pk = opts.privateKey.trim().startsWith("0x")
      ? opts.privateKey.trim()
      : `0x${opts.privateKey.trim()}`;
    this.wallet = new Wallet(pk, this.provider);
    this.walletAddress = this.wallet.address;
  }

  async usdcBalance(owner?: string): Promise<string> {
    const usdc = new Contract(USDC_BASE_SEPOLIA, ERC20_ABI, this.provider) as Contract & {
      balanceOf(addr: string): Promise<bigint>;
    };
    const target = owner ?? this.walletAddress;
    const raw = await usdc.balanceOf(target);
    return formatUnits(raw, USDC_DECIMALS);
  }

  async ethBalance(owner?: string): Promise<string> {
    const target = owner ?? this.walletAddress;
    const raw = await this.provider.getBalance(target);
    return formatUnits(raw, 18);
  }

  /**
   * Real CCTP V2 Fast Transfer burn — Base Sepolia → Solana devnet.
   * Approves USDC if needed, then calls depositForBurn on TokenMessengerV2.
   * Returns the Base Sepolia tx hash + the Iris attestation polling URL.
   * The mint side on Solana is handled by Circle's Iris attestation flow.
   */
  async cctpBurnToSolana(opts: {
    amount: string;
    solanaRecipient: string;
    maxFee?: string;
  }): Promise<{
    burnTxHash: string;
    blockNumber: number;
    amount: string;
    solanaRecipient: string;
    mintRecipientAta: string;
    destinationDomain: number;
    irisPollUrl: string;
    basescanUrl: string;
    finalityThreshold: number;
    settledAt: string;
  }> {
    const amount = parseUnits(opts.amount, USDC_DECIMALS);
    const maxFee = opts.maxFee ? parseUnits(opts.maxFee, USDC_DECIMALS) : (amount / 1000n); // default 0.1% max fee
    // CCTP V2 Solana receive requires the destination SPL token account (ATA),
    // not the wallet/owner pubkey. If the caller supplied an owner, derive the
    // ATA. If they already supplied an ATA, pass it through.
    const recipientAta = opts.solanaRecipient.length === 44 || opts.solanaRecipient.length === 43
      ? solanaOwnerToUsdcAta(opts.solanaRecipient)
      : opts.solanaRecipient;
    const mintRecipient = solanaPubkeyToBytes32(recipientAta);

    const usdc = new Contract(USDC_BASE_SEPOLIA, ERC20_ABI, this.wallet) as Contract & {
      allowance(o: string, s: string): Promise<bigint>;
      approve(s: string, amt: bigint): Promise<{ wait(): Promise<unknown> }>;
    };
    const tm = new Contract(TOKEN_MESSENGER_V2_TESTNET, TOKEN_MESSENGER_V2_ABI, this.wallet) as Contract & {
      depositForBurn(
        amount: bigint,
        destDomain: number,
        mintRecipient: string,
        burnToken: string,
        destCaller: string,
        maxFee: bigint,
        minFinalityThreshold: number
      ): Promise<{ hash: string; wait(): Promise<{ blockNumber: number }> }>;
    };

    const currentAllowance = await usdc.allowance(this.walletAddress, TOKEN_MESSENGER_V2_TESTNET);
    if (currentAllowance < amount) {
      const approveTx = await usdc.approve(TOKEN_MESSENGER_V2_TESTNET, amount);
      await approveTx.wait();
    }

    const burnTx = await tm.depositForBurn(
      amount,
      DOMAIN_SOLANA,
      mintRecipient,
      USDC_BASE_SEPOLIA,
      ZERO_BYTES32,
      maxFee,
      FAST_FINALITY
    );
    const receipt = await burnTx.wait();

    return {
      burnTxHash: burnTx.hash,
      blockNumber: receipt?.blockNumber ?? 0,
      amount: opts.amount,
      solanaRecipient: opts.solanaRecipient,
      mintRecipientAta: recipientAta,
      destinationDomain: DOMAIN_SOLANA,
      irisPollUrl: `https://iris-api-sandbox.circle.com/v2/messages/6?transactionHash=${burnTx.hash}`,
      basescanUrl: `https://sepolia.basescan.org/tx/${burnTx.hash}`,
      finalityThreshold: FAST_FINALITY,
      settledAt: new Date().toISOString(),
    };
  }

  /**
   * Submit the CCTP V2 receive (mint) on Base Sepolia for a message that was
   * burned on Solana devnet. Calls MessageTransmitter V2's receiveMessage
   * with the Iris-attested message + attestation bytes.
   */
  async cctpReceiveFromSolana(opts: {
    message: string;
    attestation: string;
  }): Promise<{
    receiveTxHash: string;
    blockNumber: number;
    basescanUrl: string;
    settledAt: string;
  }> {
    const mt = new Contract(MESSAGE_TRANSMITTER_V2_TESTNET, MESSAGE_TRANSMITTER_V2_ABI, this.wallet) as Contract & {
      receiveMessage(
        message: string,
        attestation: string
      ): Promise<{ hash: string; wait(): Promise<{ blockNumber: number }> }>;
    };
    const tx = await mt.receiveMessage(opts.message, opts.attestation);
    const receipt = await tx.wait();
    return {
      receiveTxHash: tx.hash,
      blockNumber: receipt?.blockNumber ?? 0,
      basescanUrl: `https://sepolia.basescan.org/tx/${tx.hash}`,
      settledAt: new Date().toISOString(),
    };
  }

  async transferUsdc(opts: {
    recipient: string;
    amount: string;
  }): Promise<{
    txHash: string;
    blockNumber: number;
    from: string;
    to: string;
    amount: string;
    explorerUrl: string;
    chain: "base-sepolia";
    settledAt: string;
  }> {
    const amount = parseUnits(opts.amount, USDC_DECIMALS);
    const usdc = new Contract(USDC_BASE_SEPOLIA, ERC20_ABI, this.wallet) as Contract & {
      transfer(to: string, amt: bigint): Promise<{ hash: string; wait(): Promise<{ blockNumber: number }> }>;
    };
    const tx = await usdc.transfer(opts.recipient, amount);
    const receipt = await tx.wait();
    return {
      txHash: tx.hash,
      blockNumber: receipt?.blockNumber ?? 0,
      from: this.walletAddress,
      to: opts.recipient,
      amount: opts.amount,
      explorerUrl: `https://sepolia.basescan.org/tx/${tx.hash}`,
      chain: "base-sepolia",
      settledAt: new Date().toISOString(),
    };
  }
}
