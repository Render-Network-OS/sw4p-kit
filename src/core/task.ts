import { randomBytes } from "node:crypto";

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface TaskProgress {
  current: number;
  total: number;
  message?: string;
}

export interface Task {
  taskId: string;
  tool: string;
  status: TaskStatus;
  result?: unknown;
  error?: { code: string; message: string };
  progress?: TaskProgress;
  createdAt: number;
  updatedAt: number;
}

export interface RunContext {
  progress(p: TaskProgress): void;
}

type Subscriber = (t: Task) => void;

export class TaskStore {
  private tasks = new Map<string, Task>();
  private subscribers = new Map<string, Set<Subscriber>>();

  create(tool: string): Task {
    const now = Date.now();
    const task: Task = {
      taskId: `task_${randomBytes(8).toString("hex")}`,
      tool,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.tasks.set(task.taskId, task);
    return task;
  }

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  list(filter?: { status?: TaskStatus }): Task[] {
    const all = Array.from(this.tasks.values());
    if (!filter?.status) return all;
    return all.filter((t) => t.status === filter.status);
  }

  subscribe(taskId: string, cb: Subscriber): () => void {
    let set = this.subscribers.get(taskId);
    if (!set) {
      set = new Set();
      this.subscribers.set(taskId, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  async run<T>(taskId: string, fn: (ctx: RunContext) => Promise<T>): Promise<T> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`unknown task: ${taskId}`);
    this.update(taskId, { status: "running" });
    const ctx: RunContext = {
      progress: (p) => this.update(taskId, { progress: p })
    };
    try {
      const result = await fn(ctx);
      this.update(taskId, { status: "completed", result });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string })?.code ?? "UNKNOWN";
      this.update(taskId, { status: "failed", error: { code, message } });
      throw err;
    }
  }

  private update(taskId: string, patch: Partial<Task>): void {
    const t = this.tasks.get(taskId);
    if (!t) return;
    const next: Task = { ...t, ...patch, updatedAt: Date.now() };
    this.tasks.set(taskId, next);
    this.subscribers.get(taskId)?.forEach((cb) => cb(next));
  }
}
