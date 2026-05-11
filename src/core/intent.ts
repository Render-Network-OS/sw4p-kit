import { z } from "zod";

const ChainSchema = z.enum(["base", "arbitrum", "polygon", "avalanche", "solana"]);
const AssetSchema = z.enum(["USDC", "USDT"]);

const EndpointSchema = z.object({
  chain: ChainSchema,
  asset: AssetSchema,
  address: z.string().min(1)
});

const IntentSchema = z.object({
  from: EndpointSchema,
  to: EndpointSchema,
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive decimal"),
  ttlSeconds: z.number().int().min(30).max(86_400),
  recipientMemo: z.string().max(200).optional()
});

export type Chain = z.infer<typeof ChainSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Endpoint = z.infer<typeof EndpointSchema>;
export type Intent = z.infer<typeof IntentSchema>;

export function parseIntent(input: unknown): Intent {
  return IntentSchema.parse(input);
}
