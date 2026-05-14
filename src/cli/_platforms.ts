// Pure detection logic for agent platforms.
//
// Each platform has:
//   - id: short slug used in prompts and CLI flags
//   - label: human-readable name
//   - configPath(homeDir, cwd): the canonical config file path
//   - format: "json" | "yaml" | "manual" — how the file is encoded
//   - mcpKey: the dotted-path inside the parsed file under which MCP server
//     entries live (or undefined if the platform doesn't expose a stable shape
//     and we should fall back to printed instructions)
//
// All functions here are pure: filesystem access lives in init.ts. Detection
// happens by asking the caller to pass an `exists(path) => boolean` predicate,
// which the tests stub easily.

import * as path from "node:path";

export type PlatformFormat = "json" | "yaml" | "manual";

export interface Platform {
  id: string;
  label: string;
  configPath: (home: string, cwd: string) => string;
  format: PlatformFormat;
  // Dotted path inside the parsed config where mcpServers live, e.g.
  // "mcpServers" or "extensions". Undefined means we don't know the canonical
  // shape and should print manual instructions instead of mutating the file.
  mcpKey: string | undefined;
  // Optional note shown to the user when we degrade to manual config.
  note?: string;
}

// All currently-known agent platforms with documented MCP config locations.
//
// For platforms whose config-file shape we couldn't 100% confirm from public
// docs at the time of writing, mcpKey is undefined: we will still detect
// presence by path predicate, but we'll print manual instructions instead of
// touching the file.
export const PLATFORMS: readonly Platform[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    // Claude Code reads MCP server registrations from ~/.claude.json (the
    // top-level user config). Its settings live at ~/.claude/settings.json —
    // do NOT confuse the two. Project-local registration via <cwd>/.mcp.json
    // is handled separately in the init flow (not as a platform entry).
    configPath: (home) => path.join(home, ".claude.json"),
    format: "json",
    mcpKey: "mcpServers",
  },
  {
    id: "cursor",
    label: "Cursor",
    configPath: (home) => path.join(home, ".cursor", "mcp.json"),
    format: "json",
    mcpKey: "mcpServers",
  },
  {
    id: "continue",
    label: "Continue",
    // Continue's modern config is .continue/config.yaml; the older config.json
    // path is still recognized. We probe yaml first in init.ts; here we point
    // to the most common location.
    configPath: (home) => path.join(home, ".continue", "config.yaml"),
    format: "manual",
    mcpKey: undefined,
    note: "Continue's MCP block lives under `mcpServers:` in config.yaml; the exact key path varies by version, so we will print the JSON snippet and let you paste it.",
  },
  {
    id: "goose",
    label: "Goose",
    configPath: (home) => path.join(home, ".config", "block", "goose", "config.yaml"),
    format: "manual",
    mcpKey: undefined,
    note: "Goose stores MCP extensions in a YAML config; we don't mutate YAML automatically. Paste the printed snippet under `extensions:`.",
  },
  {
    id: "codex",
    label: "Codex CLI",
    // OpenAI's Codex CLI uses ~/.codex/config.toml; format is TOML which we
    // also don't mutate. Detection still useful so we can print instructions.
    configPath: (home) => path.join(home, ".codex", "config.toml"),
    format: "manual",
    mcpKey: undefined,
    note: "Codex CLI uses TOML; we print a TOML snippet instead of mutating the file.",
  },
  {
    id: "cline",
    label: "Cline (VSCode)",
    // Cline stores its MCP config in the VSCode globalStorage; the exact path
    // is platform-specific (macOS / Linux / Windows). We probe the macOS path
    // by default and fall back to manual instructions if not found.
    configPath: (home) =>
      path.join(
        home,
        "Library",
        "Application Support",
        "Code",
        "User",
        "globalStorage",
        "saoudrizwan.claude-dev",
        "settings",
        "cline_mcp_settings.json"
      ),
    format: "json",
    mcpKey: "mcpServers",
    note: "Cline's MCP settings live in VSCode globalStorage; on Linux/Windows the path differs — if not detected, paste the JSON snippet from the Cline MCP settings UI.",
  },
  {
    id: "aider",
    label: "Aider",
    // Aider uses project-local .aider.conf.yml; we never auto-write since
    // Aider doesn't natively speak MCP (as of writing).
    configPath: (_home, cwd) => path.join(cwd, ".aider.conf.yml"),
    format: "manual",
    mcpKey: undefined,
    note: "Aider does not natively consume MCP servers; integration is via a wrapper or per-prompt context. We print the connection details and stop.",
  },
  {
    id: "elizaos",
    label: "ElizaOS",
    // Eliza's MCP integration is via per-character plugin lists. The path
    // varies by repo layout (agents/*/characters/*.character.json), so we
    // can't reliably auto-detect a single config file. We probe a common
    // monorepo path and fall back to manual instructions.
    configPath: (_home, cwd) => path.join(cwd, "characters"),
    format: "manual",
    mcpKey: undefined,
    note: "ElizaOS surfaces MCP via per-character plugin lists; the path varies by repo layout. We print the plugin block; add it to your character JSON.",
  },
] as const;

export interface DetectedPlatform {
  platform: Platform;
  configPath: string;
  exists: boolean;
}

/**
 * Detect which platforms have a config file present.
 *
 * @param home  Path to the user's home directory.
 * @param cwd   Current working directory (for project-local platforms).
 * @param exists  Predicate that returns true if a file exists.
 */
export function detectPlatforms(
  home: string,
  cwd: string,
  exists: (p: string) => boolean
): DetectedPlatform[] {
  return PLATFORMS.map((platform) => {
    const configPath = platform.configPath(home, cwd);
    return {
      platform,
      configPath,
      exists: exists(configPath),
    };
  });
}

/**
 * The canonical MCP server entry the kit writes (or prints) for every
 * platform. Once the kit publishes on npm the args line is final.
 */
export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function buildMcpEntry(opts: {
  apiKey: string;
  network: "testnet" | "mainnet";
  walletBase?: string;
  walletSolana?: string;
}): McpServerEntry {
  const env: Record<string, string> = {
    SW4P_API_KEY: opts.apiKey,
    SW4P_NETWORK: opts.network,
  };
  if (opts.walletBase) env.SW4P_USER_WALLET_BASE = opts.walletBase;
  if (opts.walletSolana) env.SW4P_USER_WALLET_SOLANA = opts.walletSolana;
  return {
    command: "npx",
    args: ["-y", "@sw4p/kit", "sw4p-mcp"],
    env,
  };
}

/**
 * Compute the backup-file name we'd write before mutating `configPath`.
 * Uses a timestamp so re-running init never clobbers a previous backup.
 */
export function backupName(configPath: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `${configPath}.sw4p-kit-init-backup-${stamp}`;
}
