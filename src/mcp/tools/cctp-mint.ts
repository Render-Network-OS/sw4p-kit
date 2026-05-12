import { z } from "zod";
import { spawn } from "node:child_process";

const InputSchema = z.object({
  burnTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  sourceDomain: z.number().int().default(6),
});

interface CctpMintExecutorOptions {
  binaryPath: string;
  solanaRpcUrl: string;
  relayerPrivateKey: string;
}

export interface CctpMintToolContext {
  cctpMint?: CctpMintExecutorOptions;
}

export function buildCctpMintExecutor(opts: CctpMintExecutorOptions): CctpMintExecutorOptions {
  return opts;
}

export const cctpMintSolanaDevnetTool = {
  name: "sw4p.cctp.mint_solana_devnet" as const,
  description:
    "Submit the receive (mint) step on Solana devnet for a CCTP V2 burn. Fetches the message + attestation from Circle Iris, then invokes the sw4p settlement engine's CCTP mint binary to call receive_message on Solana's MessageTransmitter V2 (CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC). Mints native USDC to the recipient ATA. Returns the Solana tx signature + Helius Orb explorer URL. The burn-attest-mint round-trip is complete.",
  inputSchema: InputSchema,
  async handler(input: z.infer<typeof InputSchema>, ctx: CctpMintToolContext) {
    if (!ctx.cctpMint) {
      throw new Error(
        "Solana mint binary not configured. Set SW4P_CCTP_MINT_BIN, SOLANA_DEVNET_RPC_URL, and SOLANA_RELAYER_PRIVATE_KEY in the kit env."
      );
    }
    const irisUrl = `https://iris-api-sandbox.circle.com/v2/messages/${input.sourceDomain}?transactionHash=${input.burnTxHash}`;
    const r = await fetch(irisUrl);
    if (!r.ok) throw new Error(`Iris returned ${r.status}: ${await r.text()}`);
    const body = (await r.json()) as {
      messages?: Array<{
        message: string;
        attestation: string;
        status: string;
        decodedMessage?: { decodedMessageBody?: { mintRecipient?: string } };
      }>;
    };
    const msg = body.messages?.[0];
    if (!msg) throw new Error("Iris returned no messages for this burn tx");
    if (msg.status !== "complete") {
      throw new Error(`Iris attestation not complete yet: status=${msg.status}. Poll sw4p.cctp.attestation_status until 'complete', then retry.`);
    }
    const recipient = msg.decodedMessage?.decodedMessageBody?.mintRecipient;

    return new Promise<{
      signature: string;
      explorerUrl: string;
      recipient: string;
      sourceTxHash: string;
      stdout: string;
    }>((resolve, reject) => {
      const args = [msg.message, msg.attestation];
      if (recipient) args.push(recipient);
      const child = spawn(ctx.cctpMint!.binaryPath, args, {
        env: {
          ...process.env,
          SOLANA_RPC_URL: ctx.cctpMint!.solanaRpcUrl,
          SOLANA_RELAYER_PRIVATE_KEY: ctx.cctpMint!.relayerPrivateKey,
          RUST_LOG: "info",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => (stdout += c.toString()));
      child.stderr.on("data", (c) => (stderr += c.toString()));
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`cctp mint binary exited with ${code}: ${stderr || stdout}`));
          return;
        }
        const sigMatch = (stdout + stderr).match(/Transaction Signature: (\S+)/);
        const signature = sigMatch?.[1] ?? "";
        if (!signature) {
          reject(new Error(`could not parse signature from binary output: ${stdout}\n---stderr---\n${stderr}`));
          return;
        }
        resolve({
          signature,
          explorerUrl: `https://orbmarkets.io/tx/${signature}?cluster=devnet`,
          recipient: recipient ?? "",
          sourceTxHash: input.burnTxHash,
          stdout: stdout.trim(),
        });
      });
    });
  },
};
