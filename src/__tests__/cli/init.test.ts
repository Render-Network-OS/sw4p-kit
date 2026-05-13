import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { runInit, type InitFs } from "../../cli/init.js";
import { scriptedIO } from "../../cli/_io.js";

interface MemFs extends InitFs {
  files: Map<string, string>;
  reads: string[];
  writes: string[];
  copies: Array<[string, string]>;
  renames: Array<[string, string]>;
  unlinks: string[];
  /**
   * Hook to force `rename` to throw on the next call — used by the
   * temp-cleanup regression test. Cleared after firing.
   */
  failNextRenameWith?: Error;
}

function memFs(initial: Record<string, string> = {}): MemFs {
  const files = new Map<string, string>(Object.entries(initial));
  const reads: string[] = [];
  const writes: string[] = [];
  const copies: Array<[string, string]> = [];
  const renames: Array<[string, string]> = [];
  const unlinks: string[] = [];
  const self: MemFs = {
    files,
    reads,
    writes,
    copies,
    renames,
    unlinks,
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
    rename: async (from, to) => {
      if (self.failNextRenameWith) {
        const err = self.failNextRenameWith;
        self.failNextRenameWith = undefined;
        throw err;
      }
      renames.push([from, to]);
      const v = files.get(from);
      if (v === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      files.set(to, v);
    },
    unlink: async (p) => {
      unlinks.push(p);
      // Mirror nodeFs.unlink's control flow with full fidelity:
      // try-the-real-unlink, catch any error, swallow ONLY ENOENT
      // (propagate anything else). The observable behavior matches
      // nodeFs — silent no-op for a missing file — but the
      // implementation now structurally matches the seam, so a
      // future test can replace this method with one that does NOT
      // swallow and meaningfully exercise the contract.
      try {
        if (!files.has(p)) {
          throw Object.assign(new Error(`ENOENT: no such file: ${p}`), {
            code: "ENOENT",
          });
        }
        files.delete(p);
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
      }
    },
  };
  return self;
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

  it("does not prompt or write project-local when no .mcp.json exists and no --project flag", async () => {
    const claudePath = path.join(home, ".claude.json");
    const projectPath = path.join(cwd, ".mcp.json");
    const fs = memFs({ [claudePath]: '{"theme":"dark"}' });
    // Single confirm: register sw4p in Claude Code = yes.
    // No project-local prompt should fire, so we provide exactly one confirm.
    const io = scriptedIO({
      answers: ["", "", ""],
      secrets: ["k_test"],
      confirms: [true],
    });

    const result = await runInit({
      io,
      fs,
      home,
      cwd,
      env: {},
      args: [],
      now: () => FROZEN_TIME,
    });

    expect(result.exitCode ?? 0).toBe(0);
    // Claude Code config written.
    expect(fs.files.has(claudePath)).toBe(true);
    const final = JSON.parse(fs.files.get(claudePath)!) as Record<string, unknown>;
    expect((final.mcpServers as Record<string, unknown>).sw4p).toBeDefined();
    // Project-local NOT written.
    expect(fs.files.has(projectPath)).toBe(false);
    expect(result.actions.some((a) => a.platform.id === "claude-code-project")).toBe(false);
  });

  it("prompts for project-local when .mcp.json exists; user says yes -> both written", async () => {
    const claudePath = path.join(home, ".claude.json");
    const projectPath = path.join(cwd, ".mcp.json");
    const fs = memFs({
      [claudePath]: "{}",
      [projectPath]: JSON.stringify(
        { mcpServers: { other: { command: "foo", args: [], env: {} } } },
        null,
        2
      ),
    });
    // Two confirms: yes Claude Code, yes project-local.
    const io = scriptedIO({
      answers: ["", "", ""],
      secrets: ["k_test"],
      confirms: [true, true],
    });

    const result = await runInit({
      io,
      fs,
      home,
      cwd,
      env: {},
      args: [],
      now: () => FROZEN_TIME,
    });

    expect(result.exitCode ?? 0).toBe(0);
    const projectConfig = JSON.parse(fs.files.get(projectPath)!) as Record<string, unknown>;
    const servers = projectConfig.mcpServers as Record<string, unknown>;
    expect(servers.sw4p).toBeDefined();
    expect(servers.other).toBeDefined(); // preserved
    // Backup written for project-local too.
    expect(fs.copies.some(([from]) => from === projectPath)).toBe(true);
    expect(result.actions.some((a) => a.platform.id === "claude-code-project" && a.kind === "wrote")).toBe(
      true
    );
  });

  it("--project flag forces project-local write even with no .mcp.json present", async () => {
    const claudePath = path.join(home, ".claude.json");
    const projectPath = path.join(cwd, ".mcp.json");
    const fs = memFs({ [claudePath]: "{}" });
    // Only one confirm: yes Claude Code. No project-local prompt because --project bypasses it.
    const io = scriptedIO({
      answers: ["", "", ""],
      secrets: ["k_test"],
      confirms: [true],
    });

    const result = await runInit({
      io,
      fs,
      home,
      cwd,
      env: {},
      args: ["--project"],
      now: () => FROZEN_TIME,
    });

    expect(result.exitCode ?? 0).toBe(0);
    expect(fs.files.has(projectPath)).toBe(true);
    const projectConfig = JSON.parse(fs.files.get(projectPath)!) as Record<string, unknown>;
    expect((projectConfig.mcpServers as Record<string, unknown>).sw4p).toBeDefined();
    expect(result.actions.some((a) => a.platform.id === "claude-code-project")).toBe(true);
  });

  it("--user-only suppresses the project-local prompt even when .mcp.json exists", async () => {
    const claudePath = path.join(home, ".claude.json");
    const projectPath = path.join(cwd, ".mcp.json");
    const original = '{"mcpServers":{"keep":{"command":"keep","args":[],"env":{}}}}';
    const fs = memFs({
      [claudePath]: "{}",
      [projectPath]: original,
    });
    // Only one confirm: yes Claude Code. No project-local prompt because --user-only suppresses it.
    const io = scriptedIO({
      answers: ["", "", ""],
      secrets: ["k_test"],
      confirms: [true],
    });

    const result = await runInit({
      io,
      fs,
      home,
      cwd,
      env: {},
      args: ["--user-only"],
      now: () => FROZEN_TIME,
    });

    expect(result.exitCode ?? 0).toBe(0);
    // Project-local file untouched.
    expect(fs.files.get(projectPath)).toBe(original);
    expect(fs.copies.some(([from]) => from === projectPath)).toBe(false);
    expect(result.actions.some((a) => a.platform.id === "claude-code-project")).toBe(false);
  });

  it("rejects --project and --user-only together with a non-zero exit", async () => {
    const fs = memFs({});
    const io = scriptedIO({ answers: [], secrets: [], confirms: [] });
    const result = await runInit({
      io,
      fs,
      home,
      cwd,
      env: {},
      args: ["--project", "--user-only"],
      now: () => FROZEN_TIME,
    });
    expect(result.error).toMatch(/mutually exclusive/i);
    expect(result.exitCode).not.toBe(0);
    // No filesystem touched, no prompts answered.
    expect(fs.writes).toEqual([]);
    expect(fs.copies).toEqual([]);
  });

  it("write-back is atomic: writes to temp file, then renames to final path", async () => {
    const claudePath = path.join(home, ".claude.json");
    const fs = memFs({
      [claudePath]: JSON.stringify(
        { mcpServers: { keep: { command: "foo", args: [], env: {} } } },
        null,
        2
      ),
    });
    const io = scriptedIO({
      answers: ["", "", ""],
      secrets: ["k_test"],
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

    // Exactly one writeFile, and it must target a temp path, not the final
    // config path. The temp suffix is documented as
    // `.sw4p-kit-init-tmp-<pid>-<ts>`.
    expect(fs.writes).toHaveLength(1);
    expect(fs.writes[0]!).toMatch(/\.sw4p-kit-init-tmp-/);
    expect(fs.writes[0]!).not.toBe(claudePath);

    // Exactly one rename, from that temp path to the final config path.
    expect(fs.renames).toHaveLength(1);
    expect(fs.renames[0]![0]).toMatch(/\.sw4p-kit-init-tmp-/);
    expect(fs.renames[0]![1]).toBe(claudePath);

    // After the rename, the final file is in place AND no temp leftover.
    expect(fs.files.has(claudePath)).toBe(true);
    expect(
      Array.from(fs.files.keys()).some((k) => k.includes(".sw4p-kit-init-tmp-"))
    ).toBe(false);

    // Content reflects the new sw4p entry — pre-existing "keep" preserved.
    const final = JSON.parse(fs.files.get(claudePath)!) as Record<string, unknown>;
    expect((final.mcpServers as Record<string, unknown>).sw4p).toBeDefined();
    expect((final.mcpServers as Record<string, unknown>).keep).toBeDefined();
  });

  it("unlinks the temp file when rename fails so no cleartext API key is left on disk", async () => {
    // Track C1/C2 Important: the atomic-write temp file contains the
    // user's SW4P_API_KEY in cleartext. If rename(2) fails (permission
    // denied, EXDEV, read-only filesystem, etc.), the temp file MUST be
    // unlinked before the error is propagated — otherwise the key
    // persists at `<configPath>.sw4p-kit-init-tmp-<pid>-<ts>` where it
    // can be world-readable depending on umask.
    const claudePath = path.join(home, ".claude.json");
    const fs = memFs({ [claudePath]: "{}" });
    fs.failNextRenameWith = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    const io = scriptedIO({
      answers: ["", "", ""],
      secrets: ["k_secret_api_key"],
      confirms: [true],
    });

    await expect(
      runInit({ io, fs, home, cwd, env: {}, now: () => FROZEN_TIME }),
    ).rejects.toThrow(/EACCES/);

    // The temp file MUST be unlinked.
    expect(fs.unlinks).toHaveLength(1);
    expect(fs.unlinks[0]!).toMatch(/\.sw4p-kit-init-tmp-/);

    // No cleartext-key file is left in `fs.files`.
    const leakedTemp = Array.from(fs.files.keys()).find((k) =>
      k.includes(".sw4p-kit-init-tmp-"),
    );
    expect(leakedTemp).toBeUndefined();
    // Belt-and-braces: the API key must not appear in any remaining file
    // beyond what the user already had (here, the empty "{}" config).
    for (const [filePath, contents] of fs.files.entries()) {
      if (filePath === claudePath) continue; // unchanged original
      expect(contents).not.toContain("k_secret_api_key");
    }
  });

  it("propagates non-ENOENT unlink errors (does not silently swallow EROFS)", async () => {
    // Hack-fix: the previous implementation wrapped fsx.unlink in a
    // bare `catch {}` so a non-ENOENT cleanup failure (EROFS,
    // EACCES on the temp file, etc.) was silently swallowed,
    // contradicting the InitFs.unlink seam contract which is
    // supposed to propagate non-ENOENT errors. After the fix, both
    // errors are surfaced — combined into one message naming the
    // potentially-leaked cleartext-key file.
    const claudePath = path.join(home, ".claude.json");
    const fs = memFs({ [claudePath]: "{}" });
    fs.failNextRenameWith = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    // Make memFs.unlink throw EROFS specifically — distinct from the
    // rename error so the assertion is unambiguous about which one
    // propagated.
    const origUnlink = fs.unlink;
    fs.unlink = async (p) => {
      if (p.includes(".sw4p-kit-init-tmp-")) {
        throw Object.assign(new Error("EROFS: read-only filesystem"), {
          code: "EROFS",
        });
      }
      return origUnlink(p);
    };
    const io = scriptedIO({
      answers: ["", "", ""],
      secrets: ["k_secret_api_key"],
      confirms: [true],
    });

    // The combined error must mention BOTH the rename failure and the
    // cleanup failure, with the cleartext-key file path called out.
    await expect(
      runInit({ io, fs, home, cwd, env: {}, now: () => FROZEN_TIME }),
    ).rejects.toThrow(/EROFS.*read-only|cleartext SW4P_API_KEY/);
  });

  it("temp file path lives in the same directory as the target (same-fs rename)", async () => {
    // POSIX rename(2) is only atomic within the same filesystem. The temp
    // file therefore must be a sibling of the target — putting it elsewhere
    // (e.g. /tmp) defeats the guarantee. This test pins the requirement.
    const claudePath = path.join(home, ".claude.json");
    const fs = memFs({ [claudePath]: "{}" });
    const io = scriptedIO({
      answers: ["", "", ""],
      secrets: ["k_test"],
      confirms: [true],
    });

    await runInit({ io, fs, home, cwd, env: {}, now: () => FROZEN_TIME });

    expect(fs.renames).toHaveLength(1);
    const [tmp, final] = fs.renames[0]!;
    expect(path.dirname(tmp)).toBe(path.dirname(final));
  });
});
