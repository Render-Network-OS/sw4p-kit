export interface BudgetConfig {
  totalCapUsd: string;
  perTxCapUsd: string;
}

export interface Spend {
  amount: string;
  asset: "USDC" | "USDT";
}

function n(s: string): number {
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0) throw new Error(`invalid amount: ${s}`);
  return v;
}

function f(v: number): string {
  return v.toFixed(2);
}

export class BudgetGuard {
  private readonly total: number;
  private readonly perTx: number;
  private spent = 0;
  private reserved = 0;

  constructor(cfg: BudgetConfig) {
    this.total = n(cfg.totalCapUsd);
    this.perTx = n(cfg.perTxCapUsd);
  }

  tryReserve(s: Spend): boolean {
    const amt = n(s.amount);
    if (amt > this.perTx) return false;
    if (this.spent + this.reserved + amt > this.total) return false;
    this.reserved += amt;
    return true;
  }

  commit(s: Spend): void {
    const amt = n(s.amount);
    this.reserved = Math.max(0, this.reserved - amt);
    this.spent += amt;
  }

  rollback(s: Spend): void {
    const amt = n(s.amount);
    this.reserved = Math.max(0, this.reserved - amt);
  }

  remaining(): string {
    return f(this.total - this.spent - this.reserved);
  }
}
