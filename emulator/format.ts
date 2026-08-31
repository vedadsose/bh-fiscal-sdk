import { StoredReceipt, StoredReclamation, PeriodSnapshot } from "./device";

const WIDTH = 48;
const LINE = "-".repeat(WIDTH);

function pad(left: string, right: string, width = WIDTH): string {
  const gap = Math.max(1, width - left.length - right.length);
  return left + " ".repeat(gap) + right;
}

function money(n: number): string {
  return n.toFixed(2);
}

export function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}.`;
}

export function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function formatIsoDateTime(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${formatTime(d)}`;
}

function header(title: string): string[] {
  return [LINE, ` ${title}`, LINE];
}

function articleLines(
  articles: StoredReceipt["articles"]
): string[] {
  return articles.map((a) => {
    const qty = a.quantity.toFixed(3);
    const left = ` ${qty} x ${a.name}`.slice(0, WIDTH - 12);
    return pad(left, `${money(a.gross)}  ${a.rate}`);
  });
}

export function formatReceipt(receipt: StoredReceipt): string {
  const lines = [
    ...header(`FISCAL RECEIPT #${receipt.id}`),
    ` ${formatDate(receipt.date)}  ${formatTime(receipt.date)}`,
  ];
  if (receipt.billId) lines.push(` bill ${receipt.billId}`);
  if (receipt.buyer) {
    lines.push(` ${receipt.buyer.name}  ${receipt.buyer.id}`);
  }
  lines.push(LINE);
  lines.push(...articleLines(receipt.articles));
  lines.push(LINE);
  lines.push(pad(" TOTAL", money(receipt.amount)));
  for (const p of receipt.payments) {
    lines.push(pad(` ${p.type}`, money(p.amount)));
  }
  lines.push(LINE);
  return lines.join("\n");
}

export function formatReclamation(rec: StoredReclamation): string {
  const lines = [
    ...header(`RECLAMATION #${rec.id}  (original #${rec.originalReceiptId})`),
    ` ${formatDate(rec.date)}  ${formatTime(rec.date)}`,
  ];
  if (rec.note) lines.push(` ${rec.note}`);
  lines.push(LINE);
  lines.push(...articleLines(rec.articles));
  lines.push(LINE);
  lines.push(pad(" TOTAL", money(rec.amount)));
  for (const p of rec.refunds) {
    lines.push(pad(` ${p.type}`, money(p.amount)));
  }
  lines.push(LINE);
  return lines.join("\n");
}

export function formatPeriod(title: string, period: PeriodSnapshot): string {
  const lines = [
    ...header(title),
    ` Z=${period.zNumber}  BF ${period.firstBF}-${period.lastBF}  RF ${period.firstRF}-${period.lastRF}`,
    pad(" cash", money(period.cash)),
    pad(" card", money(period.card)),
    pad(" check", money(period.check)),
    pad(" virman", money(period.transferOrder)),
    pad(" sale TE/ZE (net/vat E)", `${money(period.saleTE)} / ${money(period.saleZE)}`),
    LINE,
  ];
  return lines.join("\n");
}

export function formatDisplay(line1: string, line2: string): string {
  return `[DISPLAY]\n  ${line1}\n  ${line2}`;
}

export function formatMoneyMove(
  direction: "IN" | "OUT",
  type: string,
  amount: number
): string {
  const sign = direction === "IN" ? "+" : "-";
  return `[TILL ${direction}] ${sign}${money(amount)} ${type}`;
}
