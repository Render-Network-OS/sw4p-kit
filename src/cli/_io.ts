// Injectable IO for interactive CLIs.
//
// In production we wire `readline/promises` to stdin/stdout. In tests we
// inject a scripted IO that returns canned answers and captures prints.

import * as readline from "node:readline/promises";

export interface CliIO {
  /** Print a line to the user (stdout). */
  print(line: string): void;
  /** Print a line to stderr. */
  warn(line: string): void;
  /** Ask the user a free-form question; returns the trimmed answer. */
  ask(prompt: string): Promise<string>;
  /** Ask a yes/no question; defaults to `defaultYes`. */
  confirm(prompt: string, defaultYes?: boolean): Promise<boolean>;
  /** Ask a free-form question whose input must not be echoed (best-effort). */
  askSecret(prompt: string): Promise<string>;
  /** Close any underlying resources. */
  close(): Promise<void>;
}

/**
 * Real, interactive IO bound to process.stdin / process.stdout.
 * Note: askSecret echoes characters — node's readline has no first-class
 * password mode without raw-mode hacks; we document this in the README and
 * recommend using `SW4P_API_KEY` via env for sensitive runs.
 */
export function realIO(): CliIO {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    print: (line) => {
      process.stdout.write(`${line}\n`);
    },
    warn: (line) => {
      process.stderr.write(`${line}\n`);
    },
    ask: async (prompt) => {
      const answer = await rl.question(prompt);
      return answer.trim();
    },
    confirm: async (prompt, defaultYes = true) => {
      const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
      const raw = (await rl.question(prompt + suffix)).trim().toLowerCase();
      if (raw === "") return defaultYes;
      return raw === "y" || raw === "yes";
    },
    askSecret: async (prompt) => {
      // We deliberately don't disable echo — see the note above. The visible
      // prompt warns the user.
      const answer = await rl.question(`${prompt} (input visible) `);
      return answer.trim();
    },
    close: async () => {
      rl.close();
    },
  };
}

/**
 * Scripted IO for tests. Answers are popped FIFO from `answers`; secrets are
 * popped from `secrets`; confirmations from `confirms`. Prints land in
 * `output` and `warnings`.
 */
export interface ScriptedIO extends CliIO {
  output: string[];
  warnings: string[];
}

export function scriptedIO(opts: {
  answers?: string[];
  secrets?: string[];
  confirms?: boolean[];
}): ScriptedIO {
  const answers = [...(opts.answers ?? [])];
  const secrets = [...(opts.secrets ?? [])];
  const confirms = [...(opts.confirms ?? [])];
  const output: string[] = [];
  const warnings: string[] = [];

  return {
    output,
    warnings,
    print: (line) => output.push(line),
    warn: (line) => warnings.push(line),
    ask: async () => {
      const v = answers.shift();
      if (v === undefined) throw new Error("scriptedIO: no more scripted answers");
      return v;
    },
    confirm: async (_prompt, defaultYes = true) => {
      const v = confirms.shift();
      return v === undefined ? defaultYes : v;
    },
    askSecret: async () => {
      const v = secrets.shift();
      if (v === undefined) throw new Error("scriptedIO: no more scripted secrets");
      return v;
    },
    close: async () => {
      /* no-op */
    },
  };
}
