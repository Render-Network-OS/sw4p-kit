import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const ConstraintsSchema = z.object({
  maxAmountUsd: z.string().optional(),
  deadline: z.number().int().optional(),
  chains: z.array(z.string()).optional(),
  assets: z.array(z.string()).optional()
}).optional();

export const IntentMandateSchema = z.object({
  type: z.literal("IntentMandate"),
  id: z.string(),
  user: z.string().min(1),
  description: z.string().min(1),
  constraints: ConstraintsSchema,
  issuedAt: z.number().int(),
  signature: z.string().optional()
});

const CartEndpointSchema = z.object({
  chain: z.string(),
  asset: z.string(),
  amount: z.string(),
  address: z.string()
});

export const CartMandateSchema = z.object({
  type: z.literal("CartMandate"),
  id: z.string(),
  intentMandateId: z.string().optional(),
  user: z.string().min(1),
  cart: z.object({
    from: CartEndpointSchema,
    to: CartEndpointSchema,
    route: z.string(),
    feeBps: z.number().int(),
    deadline: z.number().int()
  }),
  issuedAt: z.number().int(),
  signature: z.string().optional()
});

export type IntentMandate = z.infer<typeof IntentMandateSchema>;
export type CartMandate = z.infer<typeof CartMandateSchema>;

export interface Signer {
  sign(canonical: string): Promise<string>;
  verify(canonical: string, signature: string, expectedUser?: string): Promise<boolean>;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortDeep(obj[k]);
        return acc;
      }, {});
  }
  return value;
}

export function canonicalize(mandate: IntentMandate | CartMandate): string {
  const { signature: _sig, ...rest } = mandate as Record<string, unknown>;
  return JSON.stringify(sortDeep(rest));
}

export class HmacSigner implements Signer {
  constructor(private readonly secret: string) {}
  async sign(canonical: string): Promise<string> {
    return createHmac("sha256", this.secret).update(canonical).digest("hex");
  }
  async verify(canonical: string, signature: string): Promise<boolean> {
    const expected = await this.sign(canonical);
    if (expected.length !== signature.length) return false;
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  }
}

export function newMandateId(prefix: "im" | "cm"): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export interface ProposeIntentInput {
  user: string;
  description: string;
  constraints?: IntentMandate["constraints"];
  now?: () => number;
}

export function proposeIntentMandate(input: ProposeIntentInput): IntentMandate {
  const now = input.now ? input.now() : Math.floor(Date.now() / 1000);
  return {
    type: "IntentMandate",
    id: newMandateId("im"),
    user: input.user,
    description: input.description,
    ...(input.constraints ? { constraints: input.constraints } : {}),
    issuedAt: now
  };
}

export interface ProposeCartInput {
  user: string;
  intentMandateId?: string;
  cart: CartMandate["cart"];
  now?: () => number;
}

export function proposeCartMandate(input: ProposeCartInput): CartMandate {
  const now = input.now ? input.now() : Math.floor(Date.now() / 1000);
  return {
    type: "CartMandate",
    id: newMandateId("cm"),
    user: input.user,
    ...(input.intentMandateId ? { intentMandateId: input.intentMandateId } : {}),
    cart: input.cart,
    issuedAt: now
  };
}

export async function signMandate<M extends IntentMandate | CartMandate>(
  mandate: M,
  signer: Signer
): Promise<M> {
  const canonical = canonicalize(mandate);
  const signature = await signer.sign(canonical);
  return { ...mandate, signature };
}

export async function verifyMandate(
  mandate: IntentMandate | CartMandate,
  signer: Signer,
  expectedUser?: string
): Promise<boolean> {
  if (!mandate.signature) return false;
  if (expectedUser && mandate.user !== expectedUser) return false;
  const canonical = canonicalize(mandate);
  return signer.verify(canonical, mandate.signature, expectedUser);
}

export function isCartExpired(m: CartMandate, now: number = Math.floor(Date.now() / 1000)): boolean {
  return m.cart.deadline < now;
}
