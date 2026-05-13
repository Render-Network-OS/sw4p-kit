#!/usr/bin/env node
// @sw4p/kit — sw4p-kit-doctor
//
// Read-only diagnostics: kit version, SDK link, network reachability, API key
// validity, and per-platform sw4p registration status. Exits 0 if everything
// passes, 1 otherwise. Prints a one-line summary at the end for CI.

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  detectPlatforms,
  type DetectedPlatform,
} from "./_platforms.js";

const HELP_TEXT = `sw4p-kit-doctor — diagnostics for the sw4p agent surface.

Usage:
  npx @sw4p/kit doctor         # full check
  node ./dist/cli/doctor.js    # pre-publish form
  sw4p-kit-doctor --help       # this message
  sw4p-kit-doctor --version    # version

Checks performed:
  - Kit version (this package).
  - Linked @sw4p/sdk version (or "pinned-local" / "unpublished").
  - Network reachability: GET https://api.sw4p.io/health (DNS + HTTP).
  - API key validity: GET /sdk/v1/portfolio/test with X-API-Key.
  - Per-platform: is sw4p registered in each detected agent's MCP config?

Exit code: 0 on all-pass, 1 otherwise. The final line is a single
machine-readable summary: SW4P-KIT-DOCTOR: <ok|fail> (...)
`;

export interface DoctorEnv {
  apiUrl?: string | undefined;
  apiKey?: string | undefined;
  network?: string | undefined;
}

export interface DoctorIO {
  print(line: string): void;
  warn(line: string): void;
}

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; method?: string }
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export interface DoctorFs {
  exists: (p: string) => boolean;
  readFile: (p: string) => Promise<string>;
}

export interface DoctorOptions {
  io: DoctorIO;
  fs: DoctorFs;
  fetch: FetchLike;
  home: string;
  cwd: string;
  env: DoctorEnv;
  kitVersion: string;
  sdkVersion: string;
}

export type CheckStatus = "pass" | "fail" | "warn";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface DoctorResult {
  checks: CheckResult[];
  exitCode: 0 | 1;
  summary: string;
}

export async function runDoctor(opts: DoctorOptions): Promise<DoctorResult> {
  const { io, fs: fsx, fetch: fetchImpl, home, cwd, env } = opts;
  const checks: CheckResult[] = [];

  io.print("sw4p-kit-doctor — running checks...\n");

  // 1. Kit version
  checks.push({
    name: "kit version",
    status: "pass",
    detail: `@sw4p/kit ${opts.kitVersion}`,
  });

  // 2. SDK version
  checks.push({
    name: "sdk link",
    status: opts.sdkVersion === "unpublished" ? "warn" : "pass",
    detail:
      opts.sdkVersion === "unpublished"
        ? "@sw4p/sdk: not installed (pre-publish — the kit is a thin client; OK for now)"
        : `@sw4p/sdk ${opts.sdkVersion}`,
  });

  // 3. Network reachability
  const apiUrl = (env.apiUrl ?? "https://api.sw4p.io").replace(/\/+$/, "");
  try {
    const r = await fetchImpl(`${apiUrl}/health`, { method: "GET" });
    const body = await safeText(r);
    if (r.ok) {
      checks.push({
        name: "network",
        status: "pass",
        detail: `GET ${apiUrl}/health → ${r.status}${body ? ` (${slice(body)})` : ""}`,
      });
    } else {
      checks.push({
        name: "network",
        status: "fail",
        detail: `GET ${apiUrl}/health → ${r.status} (${slice(body)})`,
      });
    }
  } catch (err) {
    checks.push({
      name: "network",
      status: "fail",
      detail: `GET ${apiUrl}/health failed: ${stringifyErr(err)}`,
    });
  }

  // 4. API key validity
  const apiKey = (env.apiKey ?? "").trim();
  const network = ((env.network ?? "testnet").trim().toLowerCase() === "mainnet"
    ? "mainnet"
    : "testnet") as "mainnet" | "testnet";
  if (!apiKey) {
    checks.push({
      name: "api key",
      status: "fail",
      detail: "SW4P_API_KEY is not set in the environment.",
    });
  } else {
    try {
      const r = await fetchImpl(`${apiUrl}/sdk/v1/portfolio/test`, {
        method: "GET",
        headers: {
          "X-API-Key": apiKey,
          "X-SW4P-Network": network,
        },
      });
      const body = await safeText(r);
      if (r.status === 200) {
        checks.push({
          name: "api key",
          status: "pass",
          detail: `GET /sdk/v1/portfolio/test → 200 (${slice(body)})`,
        });
      } else if (r.status === 401 || r.status === 403) {
        checks.push({
          name: "api key",
          status: "fail",
          detail: `GET /sdk/v1/portfolio/test → ${r.status} — key is rejected. (${slice(body)})`,
        });
      } else {
        checks.push({
          name: "api key",
          status: "warn",
          detail: `GET /sdk/v1/portfolio/test → ${r.status} — non-2xx/non-401 response. (${slice(body)})`,
        });
      }
    } catch (err) {
      checks.push({
        name: "api key",
        status: "fail",
        detail: `Auth check failed: ${stringifyErr(err)}`,
      });
    }
  }

  // 5. Per-platform registration status
  const detected = detectPlatforms(home, cwd, fsx.exists);
  for (const d of detected) {
    const r = await inspectPlatform(d, fsx);
    checks.push(r);
  }

  // 6. Project-local Claude Code registration — reported conditionally.
  // Claude Code also reads <cwd>/.mcp.json (the team-shareable, commit-able
  // project-local registration file). We only surface this check when the
  // file actually exists, so doctor stays quiet for directories that aren't
  // a project context.
  const projectMcpPath = path.join(cwd, ".mcp.json");
  if (fsx.exists(projectMcpPath)) {
    checks.push(await inspectProjectLocal(projectMcpPath, fsx));
  }

  // Print everything
  for (const c of checks) io.print(`  ${badge(c.status)} ${c.name}: ${c.detail}`);

  const failed = checks.filter((c) => c.status === "fail");
  const exitCode: 0 | 1 = failed.length === 0 ? 0 : 1;
  const summary =
    exitCode === 0
      ? `SW4P-KIT-DOCTOR: ok (${checks.filter((c) => c.status === "pass").length} pass, ${checks.filter((c) => c.status === "warn").length} warn)`
      : `SW4P-KIT-DOCTOR: fail (${failed.length} fail; first: ${failed[0]!.name})`;
  io.print("");
  io.print(summary);

  return { checks, exitCode, summary };
}

async function inspectProjectLocal(
  projectMcpPath: string,
  fsx: DoctorFs
): Promise<CheckResult> {
  const name = "agent: Claude Code (project-local .mcp.json)";
  try {
    const raw = await fsx.readFile(projectMcpPath);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const servers = parsed.mcpServers as Record<string, unknown> | undefined;
    if (servers && typeof servers === "object" && "sw4p" in servers) {
      return {
        name,
        status: "pass",
        detail: `sw4p registered in ${projectMcpPath}`,
      };
    }
    return {
      name,
      status: "warn",
      detail: `${projectMcpPath} present but sw4p not registered (run sw4p-kit-init --project)`,
    };
  } catch (err) {
    return {
      name,
      status: "warn",
      detail: `${projectMcpPath} present but unreadable: ${stringifyErr(err)}`,
    };
  }
}

async function inspectPlatform(
  d: DetectedPlatform,
  fsx: DoctorFs
): Promise<CheckResult> {
  const { platform, configPath, exists } = d;
  if (!exists) {
    return {
      name: `agent: ${platform.label}`,
      status: "warn",
      detail: `not installed (no ${configPath})`,
    };
  }
  if (platform.format !== "json" || platform.mcpKey === undefined) {
    return {
      name: `agent: ${platform.label}`,
      status: "warn",
      detail: `detected (${configPath}); registration not auto-verifiable for this platform`,
    };
  }
  try {
    const raw = await fsx.readFile(configPath);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const servers = parsed[platform.mcpKey] as Record<string, unknown> | undefined;
    if (servers && typeof servers === "object" && "sw4p" in servers) {
      return {
        name: `agent: ${platform.label}`,
        status: "pass",
        detail: `sw4p registered in ${configPath}`,
      };
    }
    return {
      name: `agent: ${platform.label}`,
      status: "warn",
      detail: `present but sw4p not registered (run sw4p-kit-init)`,
    };
  } catch (err) {
    return {
      name: `agent: ${platform.label}`,
      status: "warn",
      detail: `could not parse ${configPath}: ${stringifyErr(err)}`,
    };
  }
}

function badge(s: CheckStatus): string {
  if (s === "pass") return "[ ok ]";
  if (s === "warn") return "[warn]";
  return "[FAIL]";
}

function slice(s: string, n = 120): string {
  const trimmed = s.replace(/\s+/g, " ").trim();
  return trimmed.length > n ? `${trimmed.slice(0, n)}…` : trimmed;
}

async function safeText(r: { text: () => Promise<string> }): Promise<string> {
  try {
    return await r.text();
  } catch {
    return "";
  }
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

export function nodeFs(): DoctorFs {
  return {
    exists: (p) => fsSync.existsSync(p),
    readFile: (p) => fs.readFile(p, "utf8"),
  };
}

async function readKitVersion(): Promise<string> {
  // Walk up from this module to find the kit's own package.json.
  // In dist/ this file is dist/cli/doctor.js → package.json is two levels up.
  // In src/ tests we pass kitVersion explicitly, so this only runs from dist.
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const candidates = [
      path.resolve(here, "..", "..", "package.json"),
      path.resolve(here, "..", "package.json"),
    ];
    for (const c of candidates) {
      if (fsSync.existsSync(c)) {
        const raw = await fs.readFile(c, "utf8");
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        if (pkg.name === "@sw4p/kit" && pkg.version) return pkg.version;
      }
    }
  } catch {
    /* fall through */
  }
  return "unknown";
}

async function readSdkVersion(): Promise<string> {
  // The kit is currently a thin client and does not depend on a published
  // @sw4p/sdk package. We probe node_modules just in case the user pinned a
  // local copy.
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const candidates = [
      path.resolve(here, "..", "..", "node_modules", "@sw4p", "sdk", "package.json"),
      path.resolve(here, "..", "..", "..", "node_modules", "@sw4p", "sdk", "package.json"),
    ];
    for (const c of candidates) {
      if (fsSync.existsSync(c)) {
        const raw = await fs.readFile(c, "utf8");
        const pkg = JSON.parse(raw) as { version?: string };
        if (pkg.version) return pkg.version;
      }
    }
  } catch {
    /* fall through */
  }
  return "unpublished";
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    process.stdout.write("0.1.0\n");
    return 0;
  }

  const fetchImpl: FetchLike = async (url, init) => {
    const res = await fetch(url, init);
    return {
      ok: res.ok,
      status: res.status,
      text: () => res.text(),
    };
  };

  const result = await runDoctor({
    io: {
      print: (l) => process.stdout.write(`${l}\n`),
      warn: (l) => process.stderr.write(`${l}\n`),
    },
    fs: nodeFs(),
    fetch: fetchImpl,
    home: os.homedir(),
    cwd: process.cwd(),
    env: {
      apiUrl: process.env.SW4P_API_URL,
      apiKey: process.env.SW4P_API_KEY,
      network: process.env.SW4P_NETWORK,
    },
    kitVersion: await readKitVersion(),
    sdkVersion: await readSdkVersion(),
  });

  return result.exitCode;
}

const isEntry =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /\bcli[\/\\]doctor\.(js|ts)$/.test(process.argv[1]);

if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`fatal: ${stringifyErr(err)}\n`);
      process.exit(1);
    }
  );
}

