import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  PLATFORMS,
  detectPlatforms,
  buildMcpEntry,
  backupName,
} from "../../cli/_platforms.js";

describe("_platforms", () => {
  const home = "/home/test";
  const cwd = "/tmp/proj";

  it("exposes every documented agent platform", () => {
    const ids = PLATFORMS.map((p) => p.id).sort();
    expect(ids).toEqual([
      "aider",
      "claude-code",
      "cline",
      "codex",
      "continue",
      "cursor",
      "elizaos",
      "goose",
      "hermes",
      "openclaw",
    ]);
  });

  it("computes canonical config paths under the given home dir", () => {
    const byId = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]));
    expect(byId["claude-code"]!.configPath(home, cwd)).toBe(
      path.join(home, ".claude.json")
    );
    expect(byId["cursor"]!.configPath(home, cwd)).toBe(
      path.join(home, ".cursor", "mcp.json")
    );
    expect(byId["continue"]!.configPath(home, cwd)).toBe(
      path.join(home, ".continue", "config.yaml")
    );
    expect(byId["goose"]!.configPath(home, cwd)).toBe(
      path.join(home, ".config", "block", "goose", "config.yaml")
    );
    expect(byId["codex"]!.configPath(home, cwd)).toBe(
      path.join(home, ".codex", "config.toml")
    );
    expect(byId["aider"]!.configPath(home, cwd)).toBe(
      path.join(cwd, ".aider.conf.yml")
    );
    expect(byId["elizaos"]!.configPath(home, cwd)).toBe(
      path.join(cwd, "characters")
    );
    expect(byId["hermes"]!.configPath(home, cwd)).toBe(
      path.join(home, ".hermes", "config.json")
    );
    expect(byId["openclaw"]!.configPath(home, cwd)).toBe(
      path.join(cwd, ".openclaw", "mcp.json")
    );
  });

  it("marks platforms we can't auto-mutate as manual / undefined mcpKey", () => {
    const byId = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]));
    for (const id of ["continue", "goose", "codex", "aider", "elizaos", "hermes", "openclaw"]) {
      expect(byId[id]!.format).toBe("manual");
      expect(byId[id]!.mcpKey).toBeUndefined();
    }
  });

  it("marks json-mutable platforms with the right mcpKey", () => {
    const byId = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]));
    expect(byId["claude-code"]!.format).toBe("json");
    expect(byId["claude-code"]!.mcpKey).toBe("mcpServers");
    expect(byId["cursor"]!.format).toBe("json");
    expect(byId["cursor"]!.mcpKey).toBe("mcpServers");
    expect(byId["cline"]!.format).toBe("json");
    expect(byId["cline"]!.mcpKey).toBe("mcpServers");
  });

  it("detectPlatforms reports presence via the exists predicate", () => {
    const presentPaths = new Set([
      path.join(home, ".claude.json"),
      path.join(home, ".cursor", "mcp.json"),
    ]);
    const detected = detectPlatforms(home, cwd, (p) => presentPaths.has(p));
    const present = detected.filter((d) => d.exists).map((d) => d.platform.id).sort();
    expect(present).toEqual(["claude-code", "cursor"]);
  });

  it("buildMcpEntry produces the canonical npx-based shape", () => {
    const entry = buildMcpEntry({ apiKey: "k_test", network: "testnet" });
    expect(entry).toEqual({
      command: "npx",
      args: ["-y", "@sw4p/kit", "sw4p-mcp"],
      env: {
        SW4P_API_KEY: "k_test",
        SW4P_NETWORK: "testnet",
      },
    });
  });

  it("buildMcpEntry includes optional wallets only when provided", () => {
    const entry = buildMcpEntry({
      apiKey: "k",
      network: "mainnet",
      walletBase: "0xabc",
      walletSolana: "5xN...",
    });
    expect(entry.env.SW4P_USER_WALLET_BASE).toBe("0xabc");
    expect(entry.env.SW4P_USER_WALLET_SOLANA).toBe("5xN...");
    expect(entry.env.SW4P_NETWORK).toBe("mainnet");
  });

  it("backupName embeds a sortable ISO-ish timestamp", () => {
    const t = new Date("2026-01-15T12:34:56.789Z");
    const name = backupName("/p/cfg.json", t);
    expect(name).toBe("/p/cfg.json.sw4p-kit-init-backup-2026-01-15T12-34-56-789Z");
  });
});
