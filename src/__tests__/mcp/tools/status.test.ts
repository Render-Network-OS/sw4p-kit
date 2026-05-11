import { describe, it, expect } from "vitest";
import { statusTool } from "../../../mcp/tools/status.js";
import { SettlementClient } from "../../../core/client.js";
import { mockSdkClient } from "../../_helpers/mock-sdk.js";

describe("sw4p.status tool", () => {
  it("handler returns settlement state", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const out = await statusTool.handler({ intentId: "intent_123" }, { client });
    expect(out.state).toBe("settled");
  });

  it("rejects empty intentId", () => {
    const r = statusTool.inputSchema.safeParse({ intentId: "" });
    expect(r.success).toBe(false);
  });
});
