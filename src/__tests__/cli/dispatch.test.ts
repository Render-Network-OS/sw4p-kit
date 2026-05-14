import { describe, it, expect } from "vitest";
import { runDispatch, type DispatchIO } from "../../cli/dispatch.js";

function recordingIO(): DispatchIO & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    print: (l: string) => out.push(l),
    warn: (l: string) => err.push(l),
  };
}

describe("sw4p-kit dispatch", () => {
  it("prints help when no subcommand given", async () => {
    const io = recordingIO();
    const code = await runDispatch({
      argv: [],
      io,
      runners: {
        init: async () => 0,
        doctor: async () => 0,
        mcp: async () => 0,
      },
    });
    expect(code).toBe(0);
    const all = io.out.join("\n");
    expect(all).toMatch(/sw4p-kit/);
    expect(all).toMatch(/init/);
    expect(all).toMatch(/doctor/);
    expect(all).toMatch(/mcp/);
  });

  it("prints help for --help", async () => {
    const io = recordingIO();
    const code = await runDispatch({
      argv: ["--help"],
      io,
      runners: {
        init: async () => 99,
        doctor: async () => 99,
        mcp: async () => 99,
      },
    });
    expect(code).toBe(0);
    expect(io.out.join("\n")).toMatch(/sw4p-kit/);
  });

  it("prints help for -h", async () => {
    const io = recordingIO();
    const code = await runDispatch({
      argv: ["-h"],
      io,
      runners: {
        init: async () => 99,
        doctor: async () => 99,
        mcp: async () => 99,
      },
    });
    expect(code).toBe(0);
    expect(io.out.join("\n")).toMatch(/sw4p-kit/);
  });

  it("exits non-zero on unknown subcommand", async () => {
    const io = recordingIO();
    const code = await runDispatch({
      argv: ["bogus"],
      io,
      runners: {
        init: async () => 0,
        doctor: async () => 0,
        mcp: async () => 0,
      },
    });
    expect(code).toBe(2);
    expect(io.err.join("\n")).toMatch(/unknown command/i);
  });

  it("dispatches 'init' to init runner with remaining argv", async () => {
    const io = recordingIO();
    let seenArgv: string[] | undefined;
    const code = await runDispatch({
      argv: ["init", "--project"],
      io,
      runners: {
        init: async (rest) => {
          seenArgv = rest;
          return 7;
        },
        doctor: async () => 0,
        mcp: async () => 0,
      },
    });
    expect(code).toBe(7);
    expect(seenArgv).toEqual(["--project"]);
  });

  it("dispatches 'doctor' to doctor runner with remaining argv", async () => {
    const io = recordingIO();
    let seenArgv: string[] | undefined;
    const code = await runDispatch({
      argv: ["doctor", "--timeout=1000"],
      io,
      runners: {
        init: async () => 0,
        doctor: async (rest) => {
          seenArgv = rest;
          return 3;
        },
        mcp: async () => 0,
      },
    });
    expect(code).toBe(3);
    expect(seenArgv).toEqual(["--timeout=1000"]);
  });

  it("dispatches 'mcp' to mcp runner with remaining argv", async () => {
    const io = recordingIO();
    let seenArgv: string[] | undefined;
    const code = await runDispatch({
      argv: ["mcp", "extra-arg"],
      io,
      runners: {
        init: async () => 0,
        doctor: async () => 0,
        mcp: async (rest) => {
          seenArgv = rest;
          return 0;
        },
      },
    });
    expect(code).toBe(0);
    expect(seenArgv).toEqual(["extra-arg"]);
  });
});
