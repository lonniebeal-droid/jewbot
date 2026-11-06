/**
 * Position-size math from curriculum v1.1.
 * Pure numbers. Does not look up a price, place an order, or call a broker.
 *
 * risk budget = account × 1%
 * shares raw = floor(risk budget / (entry − stop))
 * if cost would exceed 25% of the account, size from that cap instead
 */

export interface SizeInput {
  account: number;
  entry: number;
  stop: number;
  /** Defaults to 0.01 (the 1% rule). */
  riskPct?: number;
  /** Defaults to 0.25 (the learning cap). */
  capPct?: number;
}

export interface SizeResult {
  ok: true;
  account: number;
  entry: number;
  stop: number;
  riskPct: number;
  capPct: number;
  riskBudget: number;
  lossPerShare: number;
  sharesRaw: number;
  shares: number;
  cost: number;
  lossIfStopped: number;
  capped: boolean;
}

export interface SizeSkip {
  ok: false;
  reason: string;
}

function cents(amount: number): number {
  return Math.round(amount * 100);
}

function dollars(amountCents: number): number {
  return amountCents / 100;
}

function finitePositive(value: number, label: string): string | undefined {
  if (!Number.isFinite(value) || value <= 0) return `${label} must be a number above 0.`;
  return undefined;
}

/** Recompute a paper size. A bad stop returns a skip, not a guess. */
export function sizePosition(input: SizeInput): SizeResult | SizeSkip {
  const riskPct = input.riskPct ?? 0.01;
  const capPct = input.capPct ?? 0.25;
  const bad =
    finitePositive(input.account, 'account') ||
    finitePositive(input.entry, 'entry') ||
    finitePositive(input.stop, 'stop');
  if (bad) return { ok: false, reason: bad };
  if (!Number.isFinite(riskPct) || riskPct <= 0 || riskPct > 0.05) {
    return { ok: false, reason: 'riskPct must be above 0 and at most 0.05.' };
  }
  if (!Number.isFinite(capPct) || capPct <= 0 || capPct > 1) {
    return { ok: false, reason: 'capPct must be above 0 and at most 1.' };
  }

  const accountCents = cents(input.account);
  const entryCents = cents(input.entry);
  const stopCents = cents(input.stop);
  const lossCents = entryCents - stopCents;
  if (lossCents <= 0) {
    return { ok: false, reason: 'Stop has to be below the entry. A stop above the entry is not a long-side plan.' };
  }

  const riskBudgetCents = Math.round(accountCents * riskPct);
  const capCents = Math.round(accountCents * capPct);
  if (riskBudgetCents <= 0 || capCents < entryCents) {
    return { ok: false, reason: 'Account is too small for one share under these rules. Paper trade and keep the bills paid.' };
  }

  const sharesRaw = Math.floor(riskBudgetCents / lossCents);
  const costRawCents = sharesRaw * entryCents;
  const capped = costRawCents > capCents;
  const shares = capped ? Math.floor(capCents / entryCents) : sharesRaw;
  const costCents = shares * entryCents;
  const lossIfStoppedCents = shares * lossCents;

  return {
    ok: true,
    account: dollars(accountCents),
    entry: dollars(entryCents),
    stop: dollars(stopCents),
    riskPct,
    capPct,
    riskBudget: dollars(riskBudgetCents),
    lossPerShare: dollars(lossCents),
    sharesRaw,
    shares,
    cost: dollars(costCents),
    lossIfStopped: dollars(lossIfStoppedCents),
    capped,
  };
}
