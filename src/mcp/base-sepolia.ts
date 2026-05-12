/**
 * Base Sepolia adapter — when env provides a private key, this signs and
 * submits real USDC transfers on Base Sepolia locally via ethers. The key
 * never leaves the host; same pattern as the Solana devnet adapter.
 *
 * USDC contract on Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
 * (Circle's official testnet USDC mint).
 */

import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits } from "ethers";

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_DECIMALS = 6;

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

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
