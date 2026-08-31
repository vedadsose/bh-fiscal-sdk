import { createHash } from "crypto";
import { StoredReceipt, StoredReclamation, PeriodSnapshot, StoredLine } from "./device";

/** 58mm Tring tape is 32 characters per line. */
const WIDTH = 32;
const DASH = "-".repeat(WIDTH);

export interface PrinterIdentity {
  company?: string;
  address?: string;
  jib?: string;
  pib?: string;
  ibfm: string;
  kasir?: string;
  kasa?: string;
}

const DEFAULT_IDENTITY = {
  company: "EMULATOR d.o.o.",
  address: "Testna 1, 71000 Sarajevo",
  jib: "0000000000000",
  pib: "000000000000",
  kasir: "Emulator",
  kasa: "01",
};

const RATE_PCT: Record<string, number> = {
  E: 17,
  K: 0,
  A: 0,
};

function pad(left: string, right: string, width = WIDTH): string {
  const l = clip(left, width - right.length - 1);
  const gap = Math.max(1, width - l.length - right.length);
  return l + " ".repeat(gap) + right;
}

function money(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

function qty(n: number): string {
  return n.toFixed(3).replace(".", ",");
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n);
}

function center(text: string, width = WIDTH): string {
  const t = clip(text, width);
  const left = Math.max(0, Math.floor((width - t.length) / 2));
  return " ".repeat(left) + t;
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

function formatTimeShort(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatIsoDateTime(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${formatTime(d)}`;
}

function identity(id: PrinterIdentity) {
  return { ...DEFAULT_IDENTITY, ...id };
}

function header(id: PrinterIdentity): string[] {
  const i = identity(id);
  return [
    clip(i.company, WIDTH),
    clip(i.address, WIDTH),
    `JIB: ${i.jib}`,
    `PIB: ${i.pib}`,
    `IBFM: ${i.ibfm}`,
    DASH,
  ];
}

function articleLines(articles: StoredLine[]): string[] {
  const lines: string[] = [];
  for (const a of articles) {
    const name = a.unit ? `${a.name}/${a.unit}` : a.name;
    lines.push(clip(name, WIDTH));
    const left = `${qty(a.quantity)}x  ${money(a.price)}`;
    const right = `${money(a.gross)}${a.rate}`;
    lines.push(pad(left, right));
    if (a.discount) {
      const off = a.price * a.quantity - a.gross;
      lines.push(pad(`  rabat ${money(a.discount)}%`, `-${money(off)}`));
    }
  }
  return lines;
}

function taxLines(articles: StoredLine[]): string[] {
  const byRate: Record<string, { net: number; vat: number }> = {};
  let vatTotal = 0;
  for (const a of articles) {
    const slot = (byRate[a.rate] ??= { net: 0, vat: 0 });
    slot.net += a.net;
    slot.vat += a.vat;
    vatTotal += a.vat;
  }
  const lines: string[] = [];
  for (const rate of ["A", "E", "K"]) {
    const slot = byRate[rate];
    if (!slot) continue;
    const pct = (RATE_PCT[rate] ?? 0).toFixed(2).replace(".", ",");
    lines.push(`VA ${pct}%`);
    lines.push(pad(`OSN. ${rate}`, money(slot.net)));
    lines.push(pad(`PDV ${rate}`, money(slot.vat)));
  }
  lines.push(pad("PDV", money(vatTotal)));
  return lines;
}

function buyerLines(buyer: StoredReceipt["buyer"]): string[] {
  if (!buyer) return [];
  const lines = [clip(buyer.name, WIDTH)];
  if (buyer.id) lines.push(clip(`JIB: ${buyer.id}`, WIDTH));
  if (buyer.pdvNumber) lines.push(clip(`PDV: ${buyer.pdvNumber}`, WIDTH));
  if (buyer.address) lines.push(clip(buyer.address, WIDTH));
  const city = [buyer.zipCode, buyer.city].filter(Boolean).join(" ");
  if (city) lines.push(clip(city, WIDTH));
  return lines;
}

function paidLines(
  total: number,
  payments: { type: string; amount: number }[]
): string[] {
  const paid = payments.reduce((s, p) => s + Math.abs(p.amount), 0);
  const shownPaid = paid > 0 ? paid : total;
  const change = Math.max(0, shownPaid - total);
  return [
    pad("TOTAL", money(total)),
    "UPLAĆENO",
    ...payments.map((p) =>
      pad(p.type, money(p.amount === 0 ? total : Math.abs(p.amount)))
    ),
    pad("Ukupno", money(shownPaid || total)),
    pad("POVRAT", money(change)),
  ];
}

function md5(payload: string): string {
  return createHash("md5").update(payload).digest("hex");
}

/** Mini QR-ish block with finder patterns, derived from the receipt hash. */
function qrLines(seed: string): string[] {
  const n = 15;
  const bits = createHash("md5").update(seed).digest();
  const grid: boolean[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => false)
  );

  const inFinder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);

  const stampFinder = (ox: number, oy: number) => {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const edge = dx === 0 || dy === 0 || dx === 6 || dy === 6;
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        grid[oy + dy][ox + dx] = edge || core;
      }
    }
  };
  stampFinder(0, 0);
  stampFinder(n - 7, 0);
  stampFinder(0, n - 7);

  let i = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (inFinder(x, y)) continue;
      const bit = bits[Math.floor(i / 8) % bits.length];
      grid[y][x] = ((bit >> i % 8) & 1) === 1;
      i++;
    }
  }

  const lines: string[] = [];
  for (let y = 0; y < n; y += 2) {
    let row = "";
    for (let x = 0; x < n; x++) {
      const top = grid[y][x];
      const bot = y + 1 < n ? grid[y + 1][x] : false;
      row += top && bot ? "█" : top ? "▀" : bot ? "▄" : " ";
    }
    lines.push(center(row));
  }
  return lines;
}

function fbiHLogo(): string[] {
  return [
    center("┌───────┐"),
    center("│  F M  │"),
    center("│ FBIH  │"),
    center("└───────┘"),
  ];
}

function footer(payload: string, id: PrinterIdentity): string[] {
  const i = identity(id);
  const sig = md5(payload);
  return [
    DASH,
    ...qrLines(sig),
    sig,
    ...fbiHLogo(),
    `Kasir: ${i.kasir}`,
    `KASA ${i.kasa}`,
  ];
}

function wrapSlip(inner: string[]): string {
  return ["", ...inner, ""].join("\n");
}

function titleBlock(
  title: string,
  date: Date,
  extras: string[]
): string[] {
  return [title, ...extras, `${formatDate(date)} ${formatTimeShort(date)}`, DASH];
}

export function formatReceipt(
  receipt: StoredReceipt,
  id: PrinterIdentity
): string {
  const body = [
    ...header(id),
    ...titleBlock("FISKALNI RAČUN", receipt.date, [`BF: ${receipt.id}`]),
    ...articleLines(receipt.articles),
    DASH,
    ...taxLines(receipt.articles),
    DASH,
    ...paidLines(receipt.amount, receipt.payments),
    ...buyerLines(receipt.buyer),
  ];

  return wrapSlip([...body, ...footer(body.join("\n"), id)]);
}

export function formatReclamation(
  rec: StoredReclamation,
  id: PrinterIdentity
): string {
  const body = [
    ...header(id),
    ...titleBlock("REKLAMIRANI RAČUN", rec.date, [
      `BF: ${rec.id}`,
      `RF: ${rec.originalReceiptId}`,
    ]),
    ...articleLines(rec.articles),
    DASH,
    ...taxLines(rec.articles),
    DASH,
    ...paidLines(rec.amount, rec.refunds),
    ...buyerLines(rec.buyer),
    rec.note ? clip(rec.note, WIDTH) : "",
  ].filter((l) => l !== "");

  return wrapSlip([...body, ...footer(body.join("\n"), id)]);
}

export function formatPeriod(
  title: string,
  period: PeriodSnapshot,
  id: PrinterIdentity
): string {
  const body = [
    ...header(id),
    ...titleBlock(title, period.closedAt, [`Z: ${period.zNumber}`]),
    pad("BF", `${period.firstBF} - ${period.lastBF}`),
    pad("RF", `${period.firstRF} - ${period.lastRF}`),
    DASH,
    pad("Gotovina", money(period.cash)),
    pad("Kartica", money(period.card)),
    pad("Cek", money(period.check)),
    pad("Virman", money(period.transferOrder)),
    DASH,
    pad("OSN. E", money(period.saleTE)),
    pad("PDV E", money(period.saleZE)),
    pad("OSN. K", money(period.saleTK)),
    pad("PDV K", money(period.saleZK)),
    pad("OSN. A", money(period.saleTA)),
    pad("PDV A", money(period.saleZA)),
  ];

  return wrapSlip([...body, ...footer(body.join("\n"), id)]);
}

export function formatDisplay(line1: string, line2: string): string {
  return `[DISPLAY]\n  ${clip(line1, 20)}\n  ${clip(line2, 20)}`;
}

export function formatMoneyMove(
  direction: "IN" | "OUT",
  type: string,
  amount: number
): string {
  const sign = direction === "IN" ? "+" : "-";
  return `[TILL ${direction}] ${sign}${money(amount)} ${type}`;
}
