#!/usr/bin/env node
// @sw4p/kit — sw4p-kit-init
//
// Interactive setup: prompts for API key + network, detects agent platforms,
// and (with consent per platform) writes the sw4p MCP server entry into each
// platform's config file. Backs up every file before mutating.

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  detectPlatforms,
  buildMcpEntry,
  backupName,
  type Platform,
  type DetectedPlatform,
  type McpServerEntry,
} from "./_platforms.js";
import { realIO, type CliIO } from "./_io.js";

/**
 * Virtual platform descriptor for the project-local <cwd>/.mcp.json case.
 * Not part of PLATFORMS — there's exactly one of these per `runInit` call,
 * constructed from `cwd`. The shape mirrors a JSON-mutable platform so the
 * same write helper (`writeJsonPlatform`) handles it uniformly.
 */
function projectLocalPlatform(projectMcpPath: string): Platform {
  return {
    id: "claude-code-project",
    label: "Claude Code (project-local .mcp.json)",
    configPath: () => projectMcpPath,
    format: "json",
    mcpKey: "mcpServers",
  };
}

const HELP_TEXT = `sw4p-kit-init — interactive setup for the sw4p agent surface.

Usage:
  npx @sw4p/kit init [flags]   # canonical invocation (via dispatch bin)
  sw4p-kit init [flags]        # equivalent direct dispatch
  sw4p-kit-init [flags]        # direct bin (skips dispatch)
  node ./dist/cli/init.js      # pre-publish form
  sw4p-kit-init --help         # print this message
  sw4p-kit-init --version      # print version

Flags:
  --project    Force project-local registration in <cwd>/.mcp.json regardless
               of whether the file exists. Creates it if absent.
  --user-only  Skip the project-local detection step even when <cwd>/.mcp.json
               exists. Useful for scripted CI runs that should never touch the
               working directory. Mutually exclusive with --project.

What it does:
  - Detects supported agent platforms (Claude Code, Cursor, Continue, Goose,
    Codex CLI, Cline, Aider, ElizaOS).
  - Asks per platform whether to register the sw4p MCP server.
  - Prompts for SW4P_API_KEY and SW4P_NETWORK (testnet | mainnet).
  - Writes an "sw4p" entry into each consented config file; backs up the
    original first (config.json.sw4p-kit-init-backup-<timestamp>).
  - Never overwrites an existing "sw4p" entry without confirmation.
  - For platforms whose config shape we don't auto-mutate (YAML/TOML/Eliza),
    prints a paste-ready snippet instead.
  - For Claude Code: writes to ~/.claude.json (the canonical user-level MCP
    config). When <cwd>/.mcp.json exists OR --project is passed, also offers
    to register the project-local entry.

Get an API key: https://console.sw4p.io
`;

/**
 * File-system shape consumed by runInit, so tests can stub it.
 */
export interface InitFs {
  exists: (p: string) => boolean;
  readFile: (p: string) => Promise<string>;
  writeFile: (p: string, data: string) => Promise<void>;
  copyFile: (from: string, to: string) => Promise<void>;
  mkdir: (p: string) => Promise<void>;
}

export function nodeFs(): InitFs {
  return {
    exists: (p) => fsSync.existsSync(p),
    readFile: (p) => fs.readFile(p, "utf8"),
    writeFile: (p, data) => fs.writeFile(p, data, "utf8"),
    copyFile: (from, to) => fs.copyFile(from, to),
    mkdir: (p) => fs.mkdir(p, { recursive: true }).then(() => undefined),
  };
}

export interface InitEnv {
  apiKey?: string | undefined;
  network?: string | undefined;
  walletBase?: string | undefined;
  walletSolana?: string | undefined;
}

export interface RunInitOptions {
  io: CliIO;
  fs: InitFs;
  home: string;
  cwd: string;
  env: InitEnv;
  /**
   * CLI argv after the binary name (defaults to []). Recognized flags:
   *   --project    force project-local <cwd>/.mcp.json write regardless of
   *                whether the file exists.
   *   --user-only  suppress the project-local prompt even when .mcp.json is
   *                present (useful for scripted runs).
   * Passing both is rejected at the top of runInit with a non-zero exit.
   */
  args?: string[];
  now?: () => Date;
}

export interface InitFlags {
  project: boolean;
  userOnly: boolean;
}

export interface InitResult {
  apiKey: string;
  network: "testnet" | "mainnet";
  detected: DetectedPlatform[];
  // Each platform we either wrote to, skipped, or printed manual instructions
  // for. Useful for tests and for the final summary line.
  actions: PlatformAction[];
  /** Non-zero when runInit returned early due to a flag error. */
  exitCode?: number;
  /** Error message when runInit returned early; undefined on success. */
  error?: string;
}

/**
 * Parse the CLI argv slice for the two scope flags. Unknown args are ignored
 * here (the binary's `--help` / `--version` path handles those before
 * delegating to runInit).
 */
export function parseInitFlags(argv: readonly string[]): InitFlags {
  return {
    project: argv.includes("--project"),
    userOnly: argv.includes("--user-only"),
  };
}

export type PlatformAction =
  | { kind: "wrote"; platform: Platform; configPath: string; backup: string }
  | { kind: "wrote-no-backup"; platform: Platform; configPath: string }
  | { kind: "replaced"; platform: Platform; configPath: string; backup: string }
  | { kind: "skipped"; platform: Platform; configPath: string; reason: string }
  | { kind: "manual"; platform: Platform; configPath: string };

/**
 * The pure, testable init flow. The shebang entry below wires real IO + fs
 * and calls this.
 */
export async function runInit(opts: RunInitOptions): Promise<InitResult> {
  const { io, fs: fsx, home, cwd, env } = opts;
  const now = opts.now ?? (() => new Date());
  const flags = parseInitFlags(opts.args ?? []);

  // Mutually-exclusive scope flags: surface immediately, do nothing else.
  if (flags.project && flags.userOnly) {
    const error = "--project and --user-only are mutually exclusive";
    io.warn(`sw4p-kit-init: ${error}`);
    return {
      apiKey: "",
      network: "testnet",
      detected: [],
      actions: [],
      exitCode: 2,
      error,
    };
  }

  io.print("\nsw4p-kit-init — setting up the sw4p agent surface.");
  io.print(
    "Get a key at https://console.sw4p.io (do not paste your key into this prompt if your terminal is being recorded)."
  );

  // API key
  let apiKey = (env.apiKey ?? "").trim();
  if (apiKey) {
    io.print("Found SW4P_API_KEY in the environment.");
  } else {
    apiKey = (await io.askSecret("SW4P_API_KEY:")).trim();
  }
  if (!apiKey) {
    throw new Error("SW4P_API_KEY is required. Re-run after obtaining a key.");
  }

  // Network
  let network: "testnet" | "mainnet";
  const envNetwork = (env.network ?? "").trim().toLowerCase();
  if (envNetwork === "mainnet" || envNetwork === "testnet") {
    network = envNetwork;
    io.print(`Using SW4P_NETWORK=${network} from environment.`);
  } else {
    const raw = (await io.ask("SW4P_NETWORK (testnet | mainnet) [testnet]: ")).toLowerCase();
    network = raw === "mainnet" ? "mainnet" : "testnet";
  }

  // Optional wallets — only ask if not in env.
  let walletBase = (env.walletBase ?? "").trim();
  let walletSolana = (env.walletSolana ?? "").trim();
  if (!walletBase) {
    const w = (await io.ask("SW4P_USER_WALLET_BASE (optional, press enter to skip): ")).trim();
    if (w) walletBase = w;
  }
  if (!walletSolana) {
    const w = (await io.ask("SW4P_USER_WALLET_SOLANA (optional, press enter to skip): ")).trim();
    if (w) walletSolana = w;
  }

  const entry = buildMcpEntry({
    apiKey,
    network,
    ...(walletBase ? { walletBase } : {}),
    ...(walletSolana ? { walletSolana } : {}),
  });

  // Detect platforms
  const detected = detectPlatforms(home, cwd, fsx.exists);
  const present = detected.filter((d) => d.exists);
  const actions: PlatformAction[] = [];

  if (present.length === 0) {
    io.print("\nNo supported agent platforms detected on this machine.");
    io.print("Paste the MCP entry below into your agent's MCP config manually:\n");
    io.print(renderJsonEntry(entry));
    // Fall through to project-local handling: --project should still work
    // even when no other agent platform is installed.
  } else {
    io.print(`\nDetected ${present.length} platform(s):`);
    for (const d of present) io.print(`  - ${d.platform.label}  (${d.configPath})`);

    io.print(
      "\nNote: @sw4p/kit is pre-publish. The args line below assumes the npm package is reachable; for a local install, set `command` to `node` and `args` to the absolute path of dist/mcp/bin.js."
    );

    for (const d of present) {
      const proceed = await io.confirm(`Register sw4p in ${d.platform.label}?`, true);
      if (!proceed) {
        actions.push({
          kind: "skipped",
          platform: d.platform,
          configPath: d.configPath,
          reason: "user declined",
        });
        continue;
      }
      // Platforms whose config we don't safely mutate: print snippet, log
      // manual action.
      if (d.platform.format !== "json" || d.platform.mcpKey === undefined) {
        io.print(`\n${d.platform.label}: ${d.platform.note ?? "manual paste required."}`);
        io.print("MCP entry to paste:\n");
        io.print(renderJsonEntry(entry));
        actions.push({ kind: "manual", platform: d.platform, configPath: d.configPath });
        continue;
      }

      // JSON path — load, validate, mutate, backup, write.
      const result = await writeJsonPlatform({
        d,
        entry,
        io,
        fsx,
        now,
      });
      actions.push(result);
    }
  }

  // Project-local detection: Claude Code (and other team-shareable MCP setups)
  // also read <cwd>/.mcp.json. Behavior:
  //   --project        → always write (creating the file if absent).
  //   --user-only      → never prompt, never write.
  //   neither flag set → prompt only when .mcp.json already exists.
  const projectMcpPath = path.join(cwd, ".mcp.json");
  const projectFileExists = fsx.exists(projectMcpPath);
  let writeProject = false;
  if (flags.project) {
    writeProject = true;
  } else if (!flags.userOnly && projectFileExists) {
    writeProject = await io.confirm(
      `A project-local .mcp.json was detected at ${projectMcpPath}. Also register sw4p there?`,
      true
    );
  }

  if (writeProject) {
    const projPlatform = projectLocalPlatform(projectMcpPath);
    const projD: DetectedPlatform = {
      platform: projPlatform,
      configPath: projectMcpPath,
      exists: projectFileExists,
    };
    const projResult = await writeJsonPlatform({
      d: projD,
      entry,
      io,
      fsx,
      now,
      allowCreate: true,
    });
    actions.push(projResult);
  }

  // Closing summary
  io.print("\nDone.");
  const wrote = actions.filter(
    (a) => a.kind === "wrote" || a.kind === "replaced" || a.kind === "wrote-no-backup"
  ).length;
  const manual = actions.filter((a) => a.kind === "manual").length;
  const skipped = actions.filter((a) => a.kind === "skipped").length;
  io.print(`Summary: ${wrote} written, ${manual} manual-paste, ${skipped} skipped.`);

  return { apiKey, network, detected, actions };
}

interface WriteJsonOpts {
  d: DetectedPlatform;
  entry: McpServerEntry;
  io: CliIO;
  fsx: InitFs;
  now: () => Date;
  /**
   * When true (project-local create case), tolerate a missing file: write a
   * fresh `{ mcpServers: { sw4p: entry } }` instead of refusing. Backup is
   * skipped when there's nothing to back up; the action's `kind` becomes
   * `"wrote-no-backup"`.
   */
  allowCreate?: boolean;
}

async function writeJsonPlatform(opts: WriteJsonOpts): Promise<PlatformAction> {
  const { d, entry, io, fsx, now, allowCreate = false } = opts;
  const { platform, configPath } = d;
  const mcpKey = platform.mcpKey;
  if (mcpKey === undefined) {
    // Defensive — caller already guarded.
    return { kind: "manual", platform, configPath };
  }

  // Read existing JSON; if unreadable, refuse to mutate — UNLESS we're in
  // allowCreate mode and the file simply isn't there yet.
  let parsed: Record<string, unknown> = {};
  let raw = "";
  let fileExisted = true;
  try {
    raw = await fsx.readFile(configPath);
    parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      io.warn(`Refusing to write: ${configPath} is not a JSON object.`);
      return { kind: "skipped", platform, configPath, reason: "config is not a JSON object" };
    }
  } catch (err) {
    if (allowCreate && !fsx.exists(configPath)) {
      fileExisted = false;
      parsed = {};
      raw = "";
    } else {
      io.warn(`Refusing to write: cannot parse ${configPath} (${stringifyErr(err)}).`);
      return { kind: "skipped", platform, configPath, reason: "config not parseable" };
    }
  }

  const existingServers = (parsed[mcpKey] as Record<string, unknown> | undefined) ?? {};
  let replacing = false;
  if (
    typeof existingServers === "object" &&
    existingServers !== null &&
    "sw4p" in existingServers
  ) {
    const confirmReplace = await io.confirm(
      `An "sw4p" entry already exists in ${platform.label}'s ${mcpKey}. Replace it?`,
      false
    );
    if (!confirmReplace) {
      return {
        kind: "skipped",
        platform,
        configPath,
        reason: "user declined to overwrite existing sw4p entry",
      };
    }
    replacing = true;
  }

  // Backup — skip when the file didn't previously exist (nothing to back up).
  let backup: string | undefined;
  if (fileExisted) {
    backup = backupName(configPath, now());
    try {
      await fsx.copyFile(configPath, backup);
    } catch (err) {
      io.warn(`Could not write backup (${stringifyErr(err)}); aborting ${platform.label}.`);
      return { kind: "skipped", platform, configPath, reason: "backup failed" };
    }
  } else {
    // Ensure parent directory exists for create-from-scratch case.
    try {
      await fsx.mkdir(path.dirname(configPath));
    } catch {
      /* mkdir is best-effort; node_fs uses recursive: true so existing dirs are fine */
    }
  }

  const nextServers: Record<string, unknown> = { ...(existingServers as object) };
  nextServers.sw4p = entry as unknown as Record<string, unknown>;
  parsed[mcpKey] = nextServers;

  const indent = inferIndent(raw);
  const next = JSON.stringify(parsed, null, indent) + (raw.endsWith("\n") ? "\n" : "");
  await fsx.writeFile(configPath, next);
  if (backup) {
    io.print(`  ✓ ${platform.label}: wrote ${configPath} (backup: ${backup}).`);
  } else {
    io.print(`  ✓ ${platform.label}: wrote ${configPath} (new file).`);
  }

  if (!fileExisted) {
    return { kind: "wrote-no-backup", platform, configPath };
  }
  return replacing
    ? { kind: "replaced", platform, configPath, backup: backup! }
    : { kind: "wrote", platform, configPath, backup: backup! };
}

function renderJsonEntry(entry: McpServerEntry): string {
  return JSON.stringify({ mcpServers: { sw4p: entry } }, null, 2);
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function inferIndent(raw: string): number {
  const m = raw.match(/^(\s+)"/m);
  if (!m || !m[1]) return 2;
  const ws = m[1];
  if (ws.includes("\t")) return 2;
  return ws.length || 2;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    process.stdout.write("0.1.0\n");
    return 0;
  }

  const io = realIO();
  try {
    const result = await runInit({
      io,
      fs: nodeFs(),
      home: os.homedir(),
      cwd: process.cwd(),
      args: argv,
      env: {
        apiKey: process.env.SW4P_API_KEY,
        network: process.env.SW4P_NETWORK,
        walletBase: process.env.SW4P_USER_WALLET_BASE,
        walletSolana: process.env.SW4P_USER_WALLET_SOLANA,
      },
    });
    if (result.exitCode !== undefined && result.exitCode !== 0) return result.exitCode;
    return 0;
  } catch (err) {
    process.stderr.write(`sw4p-kit-init failed: ${stringifyErr(err)}\n`);
    return 1;
  } finally {
    await io.close();
  }
}

// Only run when this file is the entry point (not when imported by tests).
const isEntry =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /\bcli[\/\\]init\.(js|ts)$/.test(process.argv[1]);

if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`fatal: ${stringifyErr(err)}\n`);
      process.exit(1);
    }
  );
}

// Re-exports for tests.
export { renderJsonEntry };
