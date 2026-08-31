import { createHash } from "crypto";
import { StoredReceipt, StoredReclamation, PeriodSnapshot, StoredLine } from "./device";

/** 58mm Tring tape is 32 characters per line. */
const WIDTH = 32;
const EQ = "=".repeat(WIDTH);
const DASH = "-".repeat(WIDTH);

export interface PrinterIdentity {
  company?: string;
  location?: string;
  address?: string;
  zipCity?: string;
  jib?: string;
  pib?: string;
  ibfm: string;
}

const DEFAULT_IDENTITY = {
  company: "EMULATOR d.o.o.",
  location: "Demo prodajno mjesto",
  address: "Testna 1",
  zipCity: "71000 Sarajevo",
  jib: "0000000000000",
  pib: "000000000000",
};

const RATE_LABEL: Record<string, string> = {
  E: "E 17%",
  K: "K  0%",
  A: "A  0%",
};

function pad(left: string, right: string, width = WIDTH): string {
  const l = clip(left, width - right.length - 1);
  const gap = Math.max(1, width - l.length - right.length);
  return l + " ".repeat(gap) + right;
}

function money(n: number): string {
  return n.toFixed(2);
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
    EQ,
    center(i.company),
    center(i.location),
    center(i.address),
    center(i.zipCity),
    center(`JIB: ${i.jib}`),
    center(`PIB: ${i.pib}`),
    center(`IBFM: ${i.ibfm}`),
    EQ,
  ];
}

function articleLines(articles: StoredLine[]): string[] {
  const lines: string[] = [];
  for (const a of articles) {
    const unit = a.unit ? ` ${a.unit}` : "";
    lines.push(clip(a.name, WIDTH));
    lines.push(pad(`${a.quantity.toFixed(3)}${unit} x ${money(a.price)}  ${a.rate}`, money(a.gross)));
    if (a.discount) {
      const off = a.price * a.quantity - a.gross;
      lines.push(pad(`  rabat ${a.discount}%`, `-${money(off)}`));
    }
  }
  return lines;
}

function taxLines(articles: StoredLine[]): string[] {
  const byRate: Record<string, { net: number; vat: number; gross: number }> = {};
  for (const a of articles) {
    const slot = (byRate[a.rate] ??= { net: 0, vat: 0, gross: 0 });
    slot.net += a.net;
    slot.vat += a.vat;
    slot.gross += a.gross;
  }
  const lines = [pad("Stopa  Osnovica", "PDV")];
  for (const rate of ["E", "K", "A"]) {
    const slot = byRate[rate];
    if (!slot) continue;
    lines.push(
      pad(`${RATE_LABEL[rate] ?? rate}  ${money(slot.net)}`, money(slot.vat))
    );
  }
  return lines;
}

function buyerLines(buyer: StoredReceipt["buyer"]): string[] {
  if (!buyer) return [];
  const lines = [DASH, center("Kupac"), clip(buyer.name, WIDTH)];
  if (buyer.id) lines.push(clip(`JIB: ${buyer.id}`, WIDTH));
  if (buyer.pdvNumber) lines.push(clip(`PDV: ${buyer.pdvNumber}`, WIDTH));
  if (buyer.address) lines.push(clip(buyer.address, WIDTH));
  const city = [buyer.zipCode, buyer.city].filter(Boolean).join(" ");
  if (city) lines.push(clip(city, WIDTH));
  return lines;
}

function md5(payload: string): string {
  return createHash("md5").update(payload).digest("hex");
}

function footer(payload: string): string[] {
  const sig = md5(payload);
  return [
    DASH,
    `MD5: ${sig.slice(0, WIDTH - 5)}`,
    center("[ fiskalni logo ]"),
    EQ,
    center("HVALA NA POSJETI"),
    center("** TESTNI REŽIM **"),
    EQ,
  ];
}

function wrapSlip(inner: string[]): string {
  return ["", ...inner, ""].join("\n");
}

export function formatReceipt(
  receipt: StoredReceipt,
  id: PrinterIdentity
): string {
  const body = [
    ...header(id),
    center("FISKALNI RAČUN"),
    EQ,
    ...articleLines(receipt.articles),
    DASH,
    pad("UKUPNO", `${money(receipt.amount)} KM`),
    ...receipt.payments.map((p) => pad(p.type, money(p.amount))),
    DASH,
    ...taxLines(receipt.articles),
    ...buyerLines(receipt.buyer),
    DASH,
    `BF: ${receipt.id}`,
    receipt.billId ? `Interni broj: ${receipt.billId}` : "",
    `${formatDate(receipt.date)}  ${formatTime(receipt.date)}`,
  ].filter((l) => l !== "");

  return wrapSlip([...body, ...footer(body.join("\n"))]);
}

export function formatReclamation(
  rec: StoredReclamation,
  id: PrinterIdentity
): string {
  const body = [
    ...header(id),
    center("REKLAMIRANI RAČUN"),
    center(`RF: ${rec.originalReceiptId}`),
    EQ,
    ...articleLines(rec.articles),
    DASH,
    pad("UKUPNO", `${money(rec.amount)} KM`),
    ...rec.refunds.map((p) => pad(p.type, money(p.amount))),
    DASH,
    ...taxLines(rec.articles),
    ...buyerLines(rec.buyer),
    rec.note ? clip(rec.note, WIDTH) : "",
    DASH,
    `RBF: ${rec.id}`,
    `${formatDate(rec.date)}  ${formatTime(rec.date)}`,
  ].filter((l) => l !== "");

  return wrapSlip([...body, ...footer(body.join("\n"))]);
}

export function formatPeriod(
  title: string,
  period: PeriodSnapshot,
  id: PrinterIdentity
): string {
  const body = [
    ...header(id),
    center(title),
    EQ,
    pad("Z broj", String(period.zNumber)),
    pad("BF", `${period.firstBF} - ${period.lastBF}`),
    pad("RF", `${period.firstRF} - ${period.lastRF}`),
    DASH,
    pad("Gotovina", money(period.cash)),
    pad("Kartica", money(period.card)),
    pad("Cek", money(period.check)),
    pad("Virman", money(period.transferOrder)),
    DASH,
    pad("Promet E (osn./PDV)", `${money(period.saleTE)}/${money(period.saleZE)}`),
    pad("Promet K (osn./PDV)", `${money(period.saleTK)}/${money(period.saleZK)}`),
    pad("Promet A (osn./PDV)", `${money(period.saleTA)}/${money(period.saleZA)}`),
    DASH,
    `${formatDate(period.closedAt)}  ${formatTime(period.closedAt)}`,
  ];

  return wrapSlip([...body, ...footer(body.join("\n"))]);
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
