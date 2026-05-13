import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { runInit, type InitFs } from "../../cli/init.js";
import { scriptedIO } from "../../cli/_io.js";

interface MemFs extends InitFs {
  files: Map<string, string>;
  reads: string[];
  writes: string[];
  copies: Array<[string, string]>;
}

function memFs(initial: Record<string, string> = {}): MemFs {
  const files = new Map<string, string>(Object.entries(initial));
  const reads: string[] = [];
  const writes: string[] = [];
  const copies: Array<[string, string]> = [];
  return {
    files,
    reads,
    writes,
    copies,
    exists: (p) => files.has(p),
    readFile: async (p) => {
      reads.push(p);
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeFile: async (p, data) => {
      writes.push(p);
      files.set(p, data);
    },
    copyFile: async (from, to) => {
      copies.push([from, to]);
      const v = files.get(from);
      if (v === undefined) throw new Error(`ENOENT: ${from}`);
      files.set(to, v);
    },
    mkdir: async () => undefined,
  };
}

const home = "/home/test";
const cwd = "/tmp/proj";
const FROZEN_TIME = new Date("2026-05-13T07:00:00.000Z");

describe("runInit", () => {
  it("writes sw4p entry to Claude Code config when user consents", async () => {
    const claudePath = path.join(home, ".claude.json");
    const fs = memFs({
      [claudePath]: JSON.stringify(
        {
          theme: "dark",
          mcpServers: { other: { command: "node", args: ["x.js"], env: {} } },
        },
        null,
        2
      ),
    });
    const io = scriptedIO({
      answers: ["", "", ""], // network (default), walletBase, walletSolana
      secrets: ["k_test"],
      confirms: [true], // register sw4p in Claude Code
    });

    const result = await runInit({
      io,
      fs,
      home,
      cwd,
      env: {},
      now: () => FROZEN_TIME,
    });

    expect(result.apiKey).toBe("k_test");
    expect(result.network).toBe("testnet");
    expect(result.actions).toHaveLength(1);
    const a = result.actions[0]!;
    expect(a.kind).toBe("wrote");

    // backup written
    expect(fs.copies).toHaveLength(1);
    expect(fs.copies[0]![0]).toBe(claudePath);
    expect(fs.copies[0]![1]).toBe(
      `${claudePath}.sw4p-kit-init-backup-2026-05-13T07-00-00-000Z`
    );

    // config mutated: pre-existing "other" entry preserved, "sw4p" added.
    const final = JSON.parse(fs.files.get(claudePath)!) as Record<string, unknown>;
    expect((final.mcpServers as Record<string, unknown>).other).toEqual({
      command: "node",
      args: ["x.js"],
      env: {},
    });
    expect((final.mcpServers as Record<string, unknown>).sw4p).toEqual({
      command: "npx",
      args: ["-y", "@sw4p/kit", "sw4p-mcp"],
      env: { SW4P_API_KEY: "k_test", SW4P_NETWORK: "testnet" },
    });
    // unrelated top-level field preserved
    expect(final.theme).toBe("dark");
  });

  it("uses env-provided SW4P_API_KEY without re-prompting", async () => {
    const claudePath = path.join(home, ".claude.json");
    const fs = memFs({
      [claudePath]: "{}",
    });
    const io = scriptedIO({
      answers: ["mainnet", "", ""],
      // secrets: none — should not be asked
      confirms: [true],
    });

    const result = await runInit({
      io,
      fs,
      home,
      cwd,
      env: { apiKey: "env_key", network: "" },
      now: () => FROZEN_TIME,
    });

    expect(result.apiKey).toBe("env_key");
    expect(result.network).toBe("mainnet");
  });

  it("makes no filesystem changes when user declines every platform", async () => {
    const claudePath = path.join(home, ".claude.json");
    const cursorPath = path.join(home, ".cursor", "mcp.json");
    const fs = memFs({
      [claudePath]: "{}",
      [cursorPath]: "{}",
    });
    const io = scriptedIO({
      answers: ["", "", ""],
      secrets: ["k"],
      confirms: [false, false], // decline both
    });

    const result = await runInit({
      io,
      fs,
      home,
      cwd,
      env: {},
      now: () => FROZEN_TIME,
    });

    expect(fs.writes).toEqual([]);
    expect(fs.copies).toEqual([]);
    expect(result.actions.every((a) => a.kind === "skipped")).toBe(true);
  });

  it("refuses to overwrite existing sw4p entry without confirmation", async () => {
    const claudePath = path.join(home, ".claude.json");
    const original = JSON.stringify(
      { mcpServers: { sw4p: { command: "node", args: ["old"], env: {} } } },
      null,
      2
    );
    const fs = memFs({ [claudePath]: original });
    const io = scriptedIO({
      answers: ["", "", ""],
      secrets: ["k"],
      confirms: [
        true, // register in claude-code
        false, // do NOT overwrite existing sw4p
      ],
    });

    const result = await runInit({
      io,
      fs,
      home,
      cwd,
      env: {},
      now: () => FROZEN_TIME,
    });

    // Config unchanged
    expect(fs.writes).toEqual([]);
    expect(fs.copies).toEqual([]);
    expect(fs.files.get(claudePath)).toBe(original);
    expect(result.actions[0]!.kind).toBe("skipped");
  });

  it("replaces existing sw4p entry when user confirms", async () => {
    const claudePath = path.join(home, ".claude.json");
    const fs = memFs({
      [claudePath]: JSON.stringify(
        { mcpServers: { sw4p: { command: "node", args: ["old"], env: {} } } },
        null,
        2
      ),
    });
    const io = scriptedIO({
      answers: ["", "", ""],
      secrets: ["k_new"],
      confirms: [
        true, // register in claude-code
        true, // overwrite
      ],
    });

    const result = await runInit({
      io,
      fs,
      home,
      cwd,
      env: {},
      now: () => FROZEN_TIME,
    });

    expect(result.actions[0]!.kind).toBe("replaced");
    const next = JSON.parse(fs.files.get(claudePath)!) as Record<string, unknown>;
    const sw4p = (next.mcpServers as Record<string, unknown>).sw4p as Record<
      string,
      unknown
    >;
    expect((sw4p.env as Record<string, string>).SW4P_API_KEY).toBe("k_new");
    expect((sw4p.args as string[])[2]).toBe("sw4p-mcp");
    // Backup written
    expect(fs.copies).toHaveLength(1);
  });

  it("falls back to manual snippet for non-JSON platforms (Goose)", async () => {
    const goosePath = path.join(home, ".config", "block", "goose", "config.yaml");
    const fs = memFs({
      [goosePath]: "extensions:\n  - other\n",
    });
    const io = scriptedIO({
      answers: ["", "", ""],
      secrets: ["k"],
      confirms: [true], // user says yes, but platform is manual
    });

    const result = await runInit({
      io,
      fs,
      home,
      cwd,
      env: {},
      now: () => FROZEN_TIME,
    });

    expect(fs.writes).toEqual([]); // no mutation
    expect(fs.copies).toEqual([]); // no backup
    expect(result.actions[0]!.kind).toBe("manual");
    // The snippet must appear in output
    const all = io.output.join("\n");
    expect(all).toContain('"sw4p"');
    expect(all).toContain('"@sw4p/kit"');
  });

  it("skips with a warning when the config file is not parseable JSON", async () => {
    const claudePath = path.join(home, ".claude.json");
    const fs = memFs({ [claudePath]: "{this is not json" });
    const io = scriptedIO({
      answers: ["", "", ""],
      secrets: ["k"],
      confirms: [true],
    });

    const result = await runInit({
      io,
      fs,
      home,
      cwd,
      env: {},
      now: () => FROZEN_TIME,
    });

    expect(result.actions[0]!.kind).toBe("skipped");
    expect(fs.writes).toEqual([]);
    expect(io.warnings.some((w) => w.includes("Refusing to write"))).toBe(true);
  });

  it("threads optional wallets through into the written entry", async () => {
    const claudePath = path.join(home, ".claude.json");
    const fs = memFs({ [claudePath]: "{}" });
    const io = scriptedIO({
      answers: ["", "0xWALLET_BASE", "SOLWALLET"],
      secrets: ["k"],
      confirms: [true],
    });

    await runInit({
      io,
      fs,
      home,
      cwd,
      env: {},
      now: () => FROZEN_TIME,
    });

    const next = JSON.parse(fs.files.get(claudePath)!) as Record<string, unknown>;
    const env = ((next.mcpServers as Record<string, unknown>).sw4p as Record<
      string,
      unknown
    >).env as Record<string, string>;
    expect(env.SW4P_USER_WALLET_BASE).toBe("0xWALLET_BASE");
    expect(env.SW4P_USER_WALLET_SOLANA).toBe("SOLWALLET");
  });

  it("rejects empty API key", async () => {
    const fs = memFs({});
    const io = scriptedIO({ answers: [], secrets: [""], confirms: [] });
    await expect(
      runInit({ io, fs, home, cwd, env: {}, now: () => FROZEN_TIME })
    ).rejects.toThrow(/SW4P_API_KEY is required/);
  });

  it("prints manual snippet when no platforms detected", async () => {
    const fs = memFs({});
    const io = scriptedIO({ answers: ["", "", ""], secrets: ["k"], confirms: [] });
    const result = await runInit({
      io,
      fs,
      home,
      cwd,
      env: {},
      now: () => FROZEN_TIME,
    });
    expect(result.actions).toEqual([]);
    const all = io.output.join("\n");
    expect(all).toContain("No supported agent platforms detected");
    expect(all).toContain('"sw4p"');
  });
});
