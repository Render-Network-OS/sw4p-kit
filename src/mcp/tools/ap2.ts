import { z } from "zod";
import type { SettlementClient } from "../../core/client.js";
import {
  CartMandateSchema,
  isCartExpired,
  proposeCartMandate,
  verifyMandate,
  type CartMandate,
  type Signer
} from "../../ap2/mandate.js";

const ProposeInputSchema = z.object({
  user: z.string().min(1),
  intentMandateId: z.string().optional(),
  from: z.object({ chain: z.string(), asset: z.string(), address: z.string() }),
  to: z.object({ chain: z.string(), asset: z.string(), address: z.string() }),
  amount: z.string(),
  ttlSeconds: z.number().int()
});

const ExecuteInputSchema = z.object({
  mandate: CartMandateSchema
});

export interface ToolContext {
  client: SettlementClient;
  signer: Signer;
  now?: () => number;
}

export const ap2CartProposeTool = {
  name: "sw4p.ap2.cart_propose" as const,
  description: "Quote a settlement and return an AP2 Cart Mandate (unsigned). The user signs to authorize the exact amounts and route before sw4p.ap2.cart_execute is called.",
  inputSchema: ProposeInputSchema,
  async handler(input: z.infer<typeof ProposeInputSchema>, ctx: ToolContext): Promise<CartMandate> {
    const estimate = await ctx.client.estimate({
      from: input.from,
      to: input.to,
      amount: input.amount,
      ttlSeconds: input.ttlSeconds
    } as never);
    const now = ctx.now ? ctx.now() : Math.floor(Date.now() / 1000);
    return proposeCartMandate({
      user: input.user,
      ...(input.intentMandateId ? { intentMandateId: input.intentMandateId } : {}),
      cart: {
        from: { ...input.from, amount: input.amount },
        to: { ...input.to, amount: estimate.outputAmount },
        route: estimate.route,
        feeBps: estimate.feeBps,
        deadline: now + input.ttlSeconds
      },
      now: () => now
    });
  }
};

export const ap2CartExecuteTool = {
  name: "sw4p.ap2.cart_execute" as const,
  description: "Settle a signed AP2 Cart Mandate. Verifies the signature, checks the deadline, and submits the settlement intent.",
  inputSchema: ExecuteInputSchema,
  async handler(input: z.infer<typeof ExecuteInputSchema>, ctx: ToolContext) {
    const mandate = input.mandate;
    const ok = await verifyMandate(mandate, ctx.signer, mandate.user);
    if (!ok) throw new Error("invalid mandate signature");
    if (isCartExpired(mandate, ctx.now ? ctx.now() : undefined)) {
      throw new Error("cart mandate expired");
    }
    const ttlSeconds = Math.max(60, mandate.cart.deadline - Math.floor(Date.now() / 1000));
    return ctx.client.settle({
      from: mandate.cart.from,
      to: mandate.cart.to,
      amount: mandate.cart.from.amount,
      ttlSeconds
    } as never);
  }
};
