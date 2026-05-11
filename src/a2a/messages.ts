import { z } from "zod";

const EndpointSchema = z.object({
  chain: z.string(),
  asset: z.string(),
  address: z.string()
});

export const PayRequestSchema = z.object({
  type: z.literal("PayRequest"),
  from: EndpointSchema,
  to: EndpointSchema,
  amount: z.string(),
  ttlSeconds: z.number().int(),
  memo: z.string().optional()
});

export const PaySettledSchema = z.object({
  type: z.literal("PaySettled"),
  intentId: z.string(),
  state: z.string()
});

export const PayFailedSchema = z.object({
  type: z.literal("PayFailed"),
  code: z.string(),
  message: z.string()
});

export type PayRequest = z.infer<typeof PayRequestSchema>;
export type PaySettled = z.infer<typeof PaySettledSchema>;
export type PayFailed = z.infer<typeof PayFailedSchema>;
export type A2AResponse = PaySettled | PayFailed;
