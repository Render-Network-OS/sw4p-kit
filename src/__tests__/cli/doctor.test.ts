import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { runDoctor, type DoctorFs, type FetchLike } from "../../cli/doctor.js";

interface MemFs extends DoctorFs {
  files: Map<string, string>;
}

function memFs(initial: Record<string, string> = {}): MemFs {
  const files = new Map(Object.entries(initial));
  return {
    files,
    exists: (p) => files.has(p),
    readFile: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
  };
}

function recordingIO(): {
  print: (l: string) => void;
  warn: (l: string) => void;
  output: string[];
  warnings: string[];
} {
  const output: string[] = [];
  const warnings: string[] = [];
  return {
    output,
    warnings,
    print: (l) => output.push(l),
    warn: (l) => warnings.push(l),
  };
}

interface FakeCall {
  url: string;
  headers?: Record<string, string>;
}

function fakeFetch(handler: (call: FakeCall) => {
  ok: boolean;
  status: number;
  body: string;
}): { fetch: FetchLike; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: FakeCall = { url, ...(init?.headers ? { headers: init.headers } : {}) };
    calls.push(call);
    const r = handler(call);
    return {
      ok: r.ok,
      status: r.status,
      text: async () => r.body,
    };
  };
  return { fetch: fetchImpl, calls };
}

const home = "/home/test";
const cwd = "/tmp/proj";

describe("runDoctor", () => {
  it("returns 0 and an 'ok' summary when all checks pass", async () => {
    const io = recordingIO();
    const fs = memFs({});
    const { fetch } = fakeFetch((call) => {
      if (call.url.endsWith("/health")) return { ok: true, status: 200, body: '{"ok":true}' };
      if (call.url.endsWith("/sdk/v1/portfolio/test"))
        return { ok: true, status: 200, body: '{"chains":[]}' };
      return { ok: false, status: 404, body: "not found" };
    });

    const result = await runDoctor({
      io,
      fs,
      fetch,
      home,
      cwd,
      env: { apiKey: "k", network: "testnet" },
      kitVersion: "0.1.0",
      sdkVersion: "unpublished",
    });

    expect(result.exitCode).toBe(0);
    expect(result.summary.startsWith("SW4P-KIT-DOCTOR: ok")).toBe(true);
    expect(result.checks.find((c) => c.name === "network")?.status).toBe("pass");
    expect(result.checks.find((c) => c.name === "api key")?.status).toBe("pass");
    expect(io.output.some((l) => l.includes("SW4P-KIT-DOCTOR: ok"))).toBe(true);
  });

  it("returns 1 when /health is unreachable", async () => {
    const io = recordingIO();
    const fs = memFs({});
    const { fetch } = fakeFetch(() => {
      throw new Error("ENOTFOUND api.sw4p.io");
    });

    const result = await runDoctor({
      io,
      fs,
      fetch,
      home,
      cwd,
      env: { apiKey: "k", network: "testnet" },
      kitVersion: "0.1.0",
      sdkVersion: "unpublished",
    });

    expect(result.exitCode).toBe(1);
    expect(result.summary.startsWith("SW4P-KIT-DOCTOR: fail")).toBe(true);
    const net = result.checks.find((c) => c.name === "network")!;
    expect(net.status).toBe("fail");
    expect(net.detail).toContain("ENOTFOUND");
  });

  it("flags a 401 as an invalid API key", async () => {
    const io = recordingIO();
    const fs = memFs({});
    const { fetch } = fakeFetch((call) => {
      if (call.url.endsWith("/health")) return { ok: true, status: 200, body: "ok" };
      if (call.url.endsWith("/sdk/v1/portfolio/test"))
        return { ok: false, status: 401, body: '{"error":"invalid api key"}' };
      return { ok: false, status: 500, body: "" };
    });

    const result = await runDoctor({
      io,
      fs,
      fetch,
      home,
      cwd,
      env: { apiKey: "bad_key", network: "testnet" },
      kitVersion: "0.1.0",
      sdkVersion: "unpublished",
    });

    expect(result.exitCode).toBe(1);
    const key = result.checks.find((c) => c.name === "api key")!;
    expect(key.status).toBe("fail");
    expect(key.detail).toContain("401");
    expect(key.detail).toContain("invalid api key");
  });

  it("flags a missing API key as fail without making the auth call", async () => {
    const io = recordingIO();
    const fs = memFs({});
    const { fetch, calls } = fakeFetch(() => ({
      ok: true,
      status: 200,
      body: "ok",
    }));

    const result = await runDoctor({
      io,
      fs,
      fetch,
      home,
      cwd,
      env: { network: "testnet" },
      kitVersion: "0.1.0",
      sdkVersion: "unpublished",
    });

    expect(result.exitCode).toBe(1);
    expect(result.checks.find((c) => c.name === "api key")?.status).toBe("fail");
    // Only /health was called — no auth-check call should have happened.
    expect(calls.some((c) => c.url.includes("portfolio/test"))).toBe(false);
  });

  it("reports each detected platform's registration status", async () => {
    const io = recordingIO();
    const claudePath = path.join(home, ".claude.json");
    const cursorPath = path.join(home, ".cursor", "mcp.json");
    const fs = memFs({
      [claudePath]: JSON.stringify({
        mcpServers: { sw4p: { command: "npx", args: ["-y", "@sw4p/kit", "sw4p-mcp"] } },
      }),
      [cursorPath]: JSON.stringify({
        mcpServers: { other: { command: "node", args: [] } },
      }),
    });
    const { fetch } = fakeFetch(() => ({ ok: true, status: 200, body: "ok" }));

    const result = await runDoctor({
      io,
      fs,
      fetch,
      home,
      cwd,
      env: { apiKey: "k", network: "testnet" },
      kitVersion: "0.1.0",
      sdkVersion: "unpublished",
    });

    const claude = result.checks.find((c) => c.name === "agent: Claude Code")!;
    const cursor = result.checks.find((c) => c.name === "agent: Cursor")!;
    expect(claude.status).toBe("pass");
    expect(claude.detail).toContain("sw4p registered");
    expect(cursor.status).toBe("warn");
    expect(cursor.detail).toContain("sw4p not registered");
  });

  it("sends X-API-Key and X-SW4P-Network on the auth check", async () => {
    const io = recordingIO();
    const fs = memFs({});
    const { fetch, calls } = fakeFetch(() => ({ ok: true, status: 200, body: "ok" }));

    await runDoctor({
      io,
      fs,
      fetch,
      home,
      cwd,
      env: { apiKey: "k_visible", network: "mainnet" },
      kitVersion: "0.1.0",
      sdkVersion: "1.2.3",
    });

    const auth = calls.find((c) => c.url.endsWith("/sdk/v1/portfolio/test"))!;
    expect(auth.headers!["X-API-Key"]).toBe("k_visible");
    expect(auth.headers!["X-SW4P-Network"]).toBe("mainnet");
  });

  it("reports SDK version when supplied", async () => {
    const io = recordingIO();
    const fs = memFs({});
    const { fetch } = fakeFetch(() => ({ ok: true, status: 200, body: "ok" }));

    const result = await runDoctor({
      io,
      fs,
      fetch,
      home,
      cwd,
      env: { apiKey: "k", network: "testnet" },
      kitVersion: "0.1.0",
      sdkVersion: "1.4.2",
    });

    const sdk = result.checks.find((c) => c.name === "sdk link")!;
    expect(sdk.status).toBe("pass");
    expect(sdk.detail).toContain("1.4.2");
  });

  it("emits a single-line summary at the end suitable for CI", async () => {
    const io = recordingIO();
    const fs = memFs({});
    const { fetch } = fakeFetch(() => ({ ok: true, status: 200, body: "ok" }));

    await runDoctor({
      io,
      fs,
      fetch,
      home,
      cwd,
      env: { apiKey: "k", network: "testnet" },
      kitVersion: "0.1.0",
      sdkVersion: "unpublished",
    });

    const last = io.output[io.output.length - 1] ?? "";
    expect(last.startsWith("SW4P-KIT-DOCTOR:")).toBe(true);
  });

  it("reports project-local registration as pass when <cwd>/.mcp.json has sw4p", async () => {
    const io = recordingIO();
    const claudePath = path.join(home, ".claude.json");
    const projectPath = path.join(cwd, ".mcp.json");
    const fs = memFs({
      [claudePath]: JSON.stringify({
        mcpServers: { sw4p: { command: "npx", args: ["-y", "@sw4p/kit", "sw4p-mcp"] } },
      }),
      [projectPath]: JSON.stringify({
        mcpServers: { sw4p: { command: "npx", args: ["-y", "@sw4p/kit", "sw4p-mcp"] } },
      }),
    });
    const { fetch } = fakeFetch(() => ({ ok: true, status: 200, body: "ok" }));

    const result = await runDoctor({
      io,
      fs,
      fetch,
      home,
      cwd,
      env: { apiKey: "k", network: "testnet" },
      kitVersion: "0.1.0",
      sdkVersion: "unpublished",
    });

    const projectCheck = result.checks.find(
      (c) => c.name === "agent: Claude Code (project-local .mcp.json)"
    );
    expect(projectCheck).toBeDefined();
    expect(projectCheck!.status).toBe("pass");
    expect(projectCheck!.detail).toContain(projectPath);
  });

  it("respects --timeout flag for network checks (does not hang on slow fetch)", async () => {
    const io = recordingIO();
    const fs = memFs({});
    const calls: FakeCall[] = [];
    // Fetch that hangs forever unless aborted; AbortSignal.timeout(ms) fires a
    // DOMException("...","TimeoutError") which we honor by rejecting.
    const slowFetch: FetchLike = (url, init) => {
      calls.push({ url, ...(init?.headers ? { headers: init.headers } : {}) });
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          if (signal.aborted) {
            reject(new DOMException("Timeout", "TimeoutError"));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(new DOMException("Timeout", "TimeoutError"));
          });
        }
        // Never resolves on its own.
      });
    };

    const start = Date.now();
    const result = await runDoctor({
      io,
      fs,
      fetch: slowFetch,
      home,
      cwd,
      env: { apiKey: "k", network: "testnet" },
      kitVersion: "0.1.0",
      sdkVersion: "unpublished",
      args: ["--timeout=20"], // 20ms — well under default 5000ms
    });
    const elapsed = Date.now() - start;

    expect(result.exitCode).toBe(1);
    const net = result.checks.find((c) => c.name === "network")!;
    expect(net.status).toBe("fail");
    expect(net.detail.toLowerCase()).toMatch(/timeout|abort/);
    // Sanity: doctor should not have hung anywhere near the default 5s.
    expect(elapsed).toBeLessThan(2000);
  });

  it("passes AbortSignal to fetch for both network and auth checks", async () => {
    const io = recordingIO();
    const fs = memFs({});
    const signalsSeen: Array<AbortSignal | undefined> = [];
    const recordingFetch: FetchLike = async (_url, init) => {
      signalsSeen.push(init?.signal);
      return { ok: true, status: 200, text: async () => "ok" };
    };

    await runDoctor({
      io,
      fs,
      fetch: recordingFetch,
      home,
      cwd,
      env: { apiKey: "k", network: "testnet" },
      kitVersion: "0.1.0",
      sdkVersion: "unpublished",
    });

    // Two fetch calls: /health and /sdk/v1/portfolio/test. Both must carry a signal.
    expect(signalsSeen).toHaveLength(2);
    expect(signalsSeen[0]).toBeInstanceOf(AbortSignal);
    expect(signalsSeen[1]).toBeInstanceOf(AbortSignal);
  });

  it("omits the project-local check entirely when <cwd>/.mcp.json is absent", async () => {
    const io = recordingIO();
    const claudePath = path.join(home, ".claude.json");
    const fs = memFs({
      [claudePath]: JSON.stringify({
        mcpServers: { sw4p: { command: "npx", args: [] } },
      }),
    });
    const { fetch } = fakeFetch(() => ({ ok: true, status: 200, body: "ok" }));

    const result = await runDoctor({
      io,
      fs,
      fetch,
      home,
      cwd,
      env: { apiKey: "k", network: "testnet" },
      kitVersion: "0.1.0",
      sdkVersion: "unpublished",
    });

    expect(
      result.checks.some((c) => c.name.includes("project-local .mcp.json"))
    ).toBe(false);
  });
});
