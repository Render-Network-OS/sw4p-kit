#!/usr/bin/env node
// @sw4p/kit — sw4p-kit dispatch bin
//
// Routes `npx @sw4p/kit <subcommand> [args...]` to the right CLI. The unscoped
// portion of the package name is `kit`, so npm/npx selects the bin whose name
// is `sw4p-kit` (this one) when the user runs `npx @sw4p/kit ...`. Without
// this dispatch entry, npx would fall back to the first bin (`sw4p-mcp`, the
// MCP stdio server) and treat the subcommand as opaque argv — silently
// breaking the documented `npx @sw4p/kit init` / `npx @sw4p/kit doctor`
// invocations.
//
// Subcommands:
//   init     → src/cli/init.ts  (interactive setup)
//   doctor   → src/cli/doctor.ts (diagnostics)
//   mcp      → src/mcp/bin.ts   (stdio MCP server)
//
// Direct bins (`sw4p-kit-init`, `sw4p-kit-doctor`, `sw4p-mcp`) remain wired in
// package.json for back-compat; this dispatch only adds the canonical entry.

const HELP_TEXT = `sw4p-kit <command> [args]

Commands:
  init     Interactive setup — register sw4p MCP in your agent configs
  doctor   Diagnostic checks — version, network, API key, registration
  mcp      Run the sw4p MCP server (stdio transport)

Run \`sw4p-kit <command> --help\` for command-specific help.

Equivalent direct invocations:
  sw4p-kit-init     ↔ sw4p-kit init
  sw4p-kit-doctor   ↔ sw4p-kit doctor
  sw4p-mcp          ↔ sw4p-kit mcp
`;

export interface DispatchIO {
  print(line: string): void;
  warn(line: string): void;
}

export interface DispatchRunners {
  init(args: string[]): Promise<number>;
  doctor(args: string[]): Promise<number>;
  mcp(args: string[]): Promise<number>;
}

export interface DispatchOptions {
  /** argv slice AFTER the binary name (i.e. `process.argv.slice(2)`). */
  argv: readonly string[];
  io: DispatchIO;
  runners: DispatchRunners;
}

/**
 * Pure dispatcher: inspects the first arg, routes the remainder to the matched
 * runner. Exposed for unit testing. The CLI entry below wires real runners
 * that dynamically import and execute each subcommand's main().
 */
export async function runDispatch(opts: DispatchOptions): Promise<number> {
  const { argv, io, runners } = opts;
  const sub = argv[0];
  const rest = argv.slice(1);

  if (sub === undefined || sub === "--help" || sub === "-h") {
    io.print(HELP_TEXT);
    return 0;
  }

  switch (sub) {
    case "init":
      return runners.init(rest);
    case "doctor":
      return runners.doctor(rest);
    case "mcp":
      return runners.mcp(rest);
    default:
      io.warn(`sw4p-kit: unknown command: ${sub}`);
      io.warn(`Run 'sw4p-kit --help' for usage.`);
      return 2;
  }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

/**
 * Set process.argv to look like the routed subcommand's own argv before
 * importing it, then `await import()` the subcommand module. Each subcommand
 * has an `isEntry` guard that runs its `main()` when its file is the entry.
 * By rewriting argv[1] to a path that matches the guard's regex (e.g. ending
 * in `cli/init.js`), we get the same execution behavior as if the user ran
 * the direct bin.
 */
async function runSubcommandViaImport(
  subPath: string,
  rest: string[]
): Promise<number> {
  // Rewrite argv so the imported module's isEntry guard triggers AND the
  // module's `main(process.argv.slice(2))` sees the user's flags.
  const originalArgv = process.argv;
  process.argv = [originalArgv[0]!, subPath, ...rest];
  try {
    // Dynamic import runs the module's top-level code, which kicks off main()
    // via the isEntry guard. The guard reads process.argv[1] (which we just
    // set) and matches its regex; main() reads process.argv.slice(2) for args.
    // We can't easily capture the exit code here — the subcommand calls
    // process.exit() itself — so we return 0 if the import completes without
    // the module calling process.exit, and trust the subcommand's own exit.
    await import(subPath);
    return 0;
  } finally {
    process.argv = originalArgv;
  }
}

async function main(argv: string[]): Promise<number> {
  // The real runners use dynamic import so that each subcommand's existing
  // main() handles its own argv parsing, IO, and exit code. Paths here are
  // resolved relative to this file's runtime location (dist/cli/dispatch.js).
  const here = new URL(".", import.meta.url);
  const initPath = new URL("./init.js", here).href;
  const doctorPath = new URL("./doctor.js", here).href;
  const mcpPath = new URL("../mcp/bin.js", here).href;

  return runDispatch({
    argv,
    io: {
      print: (l) => process.stdout.write(`${l}\n`),
      warn: (l) => process.stderr.write(`${l}\n`),
    },
    runners: {
      init: (rest) => runSubcommandViaImport(initPath, rest),
      doctor: (rest) => runSubcommandViaImport(doctorPath, rest),
      mcp: (rest) => runSubcommandViaImport(mcpPath, rest),
    },
  });
}

const isEntry =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /\bcli[\/\\]dispatch\.(js|ts)$/.test(process.argv[1]);

if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  );
}
