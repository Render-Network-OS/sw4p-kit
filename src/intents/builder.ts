import { randomBytes } from "node:crypto";

export interface BuildIntentInput {
  user: string;
  from: { chain: string; asset: string; amount: string };
  to: { chain: string; asset: string; recipient: string };
  ttlSeconds: number;
  nonce?: string;
  now?: () => number;
}

export interface Erc7683Intent {
  user: string;
  nonce: string;
  deadline: number;
  orderData: {
    from: { chain: string; asset: string; amount: string };
    to: { chain: string; asset: string; recipient: string };
  };
}

export function buildErc7683Intent(input: BuildIntentInput): Erc7683Intent {
  const now = input.now ? input.now() : Math.floor(Date.now() / 1000);
  const nonce = input.nonce ?? `0x${randomBytes(16).toString("hex")}`;
  return {
    user: input.user,
    nonce,
    deadline: now + input.ttlSeconds,
    orderData: { from: input.from, to: input.to }
  };
}
