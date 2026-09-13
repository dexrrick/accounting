/** A cap-table calculation engine. It is deliberately separate from journals. */
export interface ShareholderPosition {
  holder: string;
  shares: number;
}

export interface CompanyCapTable {
  company: string;
  shareClass: string;
  positions: ShareholderPosition[];
}

export interface ShareTransfer {
  company: string;
  shareClass?: string;
  from: string;
  to: string;
  shares: number;
  description?: string;
}

export interface HoldingChange {
  company: string;
  shareClass: string;
  holder: string;
  beforeShares: number;
  afterShares: number;
  beforePercent: number;
  afterPercent: number;
  changeShares: number;
  changePercent: number;
}

export interface ShareTransferResult {
  tables: CompanyCapTable[];
  changes: HoldingChange[];
  errors: string[];
}

const normalized = (value: string) => value.trim().toLocaleLowerCase();
const rounded = (value: number) => Math.round((value + Number.EPSILON) * 1e6) / 1e6;

/**
 * Applies legal-share transfers only. Total issued shares are invariant; an
 * allotment, cancellation, conversion or split must be modelled as another
 * event type rather than being silently treated as a transfer.
 */
export function calculateShareTransfers(
  inputTables: CompanyCapTable[],
  transfers: ShareTransfer[]
): ShareTransferResult {
  const errors: string[] = [];
  const tables = inputTables.map(table => ({
    ...table,
    positions: table.positions.map(position => ({ ...position }))
  }));
  const before = new Map<string, number>();

  for (const table of tables) {
    const seen = new Set<string>();
    for (const position of table.positions) {
      const key = normalized(position.holder);
      if (!position.holder.trim() || seen.has(key) || !Number.isFinite(position.shares) || position.shares < 0) {
        errors.push(`Invalid holding in ${table.company} (${table.shareClass}) for '${position.holder || 'unnamed holder'}'.`);
      }
      seen.add(key);
      before.set(`${normalized(table.company)}|${normalized(table.shareClass)}|${key}`, position.shares);
    }
  }
  if (errors.length) return { tables: inputTables, changes: [], errors };

  for (const transfer of transfers) {
    if (!Number.isFinite(transfer.shares) || transfer.shares <= 0 || normalized(transfer.from) === normalized(transfer.to)) {
      errors.push(`Invalid transfer for ${transfer.company}: shares must be positive and parties must differ.`);
      continue;
    }
    const table = tables.find(candidate =>
      normalized(candidate.company) === normalized(transfer.company) &&
      (!transfer.shareClass || normalized(candidate.shareClass) === normalized(transfer.shareClass))
    );
    if (!table) {
      errors.push(`No cap table found for ${transfer.company}${transfer.shareClass ? ` (${transfer.shareClass})` : ''}.`);
      continue;
    }
    const from = table.positions.find(position => normalized(position.holder) === normalized(transfer.from));
    if (!from || from.shares < transfer.shares) {
      errors.push(`${transfer.from} does not hold enough ${table.company} ${table.shareClass} shares for a transfer of ${transfer.shares}.`);
      continue;
    }
    let to = table.positions.find(position => normalized(position.holder) === normalized(transfer.to));
    if (!to) {
      to = { holder: transfer.to.trim(), shares: 0 };
      table.positions.push(to);
      before.set(`${normalized(table.company)}|${normalized(table.shareClass)}|${normalized(to.holder)}`, 0);
    }
    from.shares -= transfer.shares;
    to.shares += transfer.shares;
  }
  if (errors.length) return { tables: inputTables, changes: [], errors };

  const changes: HoldingChange[] = [];
  for (const table of tables) {
    const total = table.positions.reduce((sum, position) => sum + position.shares, 0);
    for (const position of table.positions) {
      const key = `${normalized(table.company)}|${normalized(table.shareClass)}|${normalized(position.holder)}`;
      const beforeShares = before.get(key) || 0;
      if (beforeShares === position.shares) continue;
      changes.push({
        company: table.company, shareClass: table.shareClass, holder: position.holder,
        beforeShares, afterShares: position.shares,
        beforePercent: rounded(total ? beforeShares / total * 100 : 0),
        afterPercent: rounded(total ? position.shares / total * 100 : 0),
        changeShares: position.shares - beforeShares,
        changePercent: rounded(total ? (position.shares - beforeShares) / total * 100 : 0)
      });
    }
  }
  return { tables, changes, errors: [] };
}
