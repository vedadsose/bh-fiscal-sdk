import { ParsedArticle, ParsedPayment, ParsedReceiptRequest } from "./xml";

const VALID_RATES = new Set(["E", "K", "A"]);
const VALID_PAYMENTS = new Set(["Gotovina", "Virman", "Cek", "Kartica"]);
const TAX_RATE_E = 0.17;

export interface StoredLine {
  id: string;
  name: string;
  unit?: string;
  price: number;
  rate: string;
  quantity: number;
  discount: number;
  gross: number;
  net: number;
  vat: number;
}

export interface StoredReceipt {
  id: number;
  billId?: string;
  date: Date;
  amount: number;
  articles: StoredLine[];
  payments: ParsedPayment[];
  buyer?: ParsedReceiptRequest["buyer"];
  reclaimed: boolean;
}

export interface StoredReclamation {
  id: number;
  originalReceiptId: number;
  date: Date;
  amount: number;
  articles: StoredLine[];
  refunds: ParsedPayment[];
  buyer?: ParsedReceiptRequest["buyer"];
  note?: string;
}

export interface PeriodSnapshot {
  zNumber: number;
  closedAt: Date;
  firstBF: number;
  lastBF: number;
  firstRF: number;
  lastRF: number;
  cash: number;
  check: number;
  card: number;
  transferOrder: number;
  saleTA: number;
  saleTE: number;
  saleTK: number;
  saleZA: number;
  saleZE: number;
  saleZK: number;
  reclaimedSaleAT: number;
  reclaimedSaleET: number;
  reclaimedSaleKT: number;
  reclaimedSaleAZ: number;
  reclaimedSaleEZ: number;
  reclaimedSaleKZ: number;
}

export interface PrintOk {
  ok: true;
  id: number;
  date: Date;
  amount: number;
  receipt: StoredReceipt;
}

export interface ReclaimOk {
  ok: true;
  id: number;
  date: Date;
  amount: number;
  reclamation: StoredReclamation;
}

export interface DeviceErr {
  ok: false;
  naziv: string;
  vrijednost: string | number;
}

export type DeviceResult<T> = T | DeviceErr;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function lineTotals(article: ParsedArticle): StoredLine {
  const gross = round2(
    article.price * article.quantity * (1 - article.discount / 100)
  );
  if (article.rate === "E") {
    const net = round2(gross / (1 + TAX_RATE_E));
    return {
      ...article,
      gross,
      net,
      vat: round2(gross - net),
    };
  }
  return { ...article, gross, net: gross, vat: 0 };
}

function paymentKey(
  type: string
): "cash" | "check" | "card" | "transferOrder" | undefined {
  switch (type) {
    case "Gotovina":
      return "cash";
    case "Cek":
      return "check";
    case "Kartica":
      return "card";
    case "Virman":
      return "transferOrder";
    default:
      return undefined;
  }
}

function emptyPeriod(zNumber: number): PeriodSnapshot {
  return {
    zNumber,
    closedAt: new Date(),
    firstBF: 0,
    lastBF: 0,
    firstRF: 0,
    lastRF: 0,
    cash: 0,
    check: 0,
    card: 0,
    transferOrder: 0,
    saleTA: 0,
    saleTE: 0,
    saleTK: 0,
    saleZA: 0,
    saleZE: 0,
    saleZK: 0,
    reclaimedSaleAT: 0,
    reclaimedSaleET: 0,
    reclaimedSaleKT: 0,
    reclaimedSaleAZ: 0,
    reclaimedSaleEZ: 0,
    reclaimedSaleKZ: 0,
  };
}

export class FiscalDevice {
  /** Next fiscal receipt number (1-based, never resets). */
  private nextReceiptId = 1;
  /** Next reclamation document number (1-based, never resets). */
  private nextReclamationId = 1;
  private zNumber = 1;

  readonly receipts: StoredReceipt[] = [];
  readonly reclamations: StoredReclamation[] = [];
  readonly closedPeriods: PeriodSnapshot[] = [];

  private period = emptyPeriod(1);

  ibfm = "EMU00001";
  fwVersion = "emulator-0.1.0";

  get currentPeriod(): PeriodSnapshot {
    return { ...this.period };
  }

  getReceipt(id: number): StoredReceipt | undefined {
    return this.receipts.find((r) => r.id === id);
  }

  printReceipt(req: ParsedReceiptRequest): DeviceResult<PrintOk> {
    const invalid = this.validateSale(req);
    if (invalid) return invalid;

    const lines = req.articles.map(lineTotals);
    const amount = round2(lines.reduce((s, l) => s + l.gross, 0));
    const now = new Date();
    const id = this.nextReceiptId++;

    const receipt: StoredReceipt = {
      id,
      billId: req.billId,
      date: now,
      amount,
      articles: lines,
      payments: req.payments,
      buyer: req.buyer,
      reclaimed: false,
    };
    this.receipts.push(receipt);

    if (this.period.firstBF === 0) this.period.firstBF = id;
    this.period.lastBF = id;
    this.applySale(lines);
    this.applyPayments(req.payments, 1);

    return { ok: true, id, date: now, amount, receipt };
  }

  reclaimReceipt(req: ParsedReceiptRequest): DeviceResult<ReclaimOk> {
    const originalId = Number(req.originalReceiptId);
    if (!Number.isFinite(originalId) || originalId <= 0) {
      return {
        ok: false,
        naziv: "Štampanje reklamiranog računa",
        vrijednost: "ERROR_FISCAL_RECEIPT_NOT_FOUND",
      };
    }

    const original = this.getReceipt(originalId);
    if (!original) {
      return {
        ok: false,
        naziv: "Štampanje reklamiranog računa",
        vrijednost: "ERROR_FISCAL_RECEIPT_NOT_FOUND",
      };
    }
    if (original.reclaimed) {
      return {
        ok: false,
        naziv: "Štampanje reklamiranog računa",
        vrijednost: "ERROR_FISCAL_RECEIPT_ALREADY_RECLAIMED",
      };
    }

    const invalid = this.validateArticles(req.articles, "Štampanje reklamiranog računa");
    if (invalid) return invalid;

    const lines = req.articles.map(lineTotals);
    const amount = round2(lines.reduce((s, l) => s + l.gross, 0));
    const now = new Date();
    const id = this.nextReclamationId++;

    original.reclaimed = true;

    const reclamation: StoredReclamation = {
      id,
      originalReceiptId: originalId,
      date: now,
      amount,
      articles: lines,
      refunds: req.payments,
      buyer: req.buyer,
      note: req.note,
    };
    this.reclamations.push(reclamation);

    if (this.period.firstRF === 0) this.period.firstRF = id;
    this.period.lastRF = id;
    this.applyReclaim(lines);
    this.applyRefunds(req.payments);

    return { ok: true, id, date: now, amount, reclamation };
  }

  deposit(type: string, amount: number): DeviceResult<{ ok: true }> {
    const payErr = this.validatePaymentType(type, "UnosNovca");
    if (payErr) return payErr;
    if (!(amount > 0)) {
      return { ok: false, naziv: "UnosNovca", vrijednost: "ERROR_INVALID_AMOUNT" };
    }
    this.applyPayments([{ type, amount }], 1);
    return { ok: true };
  }

  withdraw(type: string, amount: number): DeviceResult<{ ok: true }> {
    const payErr = this.validatePaymentType(type, "PovratNovca");
    if (payErr) return payErr;
    if (!(amount > 0)) {
      return { ok: false, naziv: "PovratNovca", vrijednost: "ERROR_INVALID_AMOUNT" };
    }
    const key = paymentKey(type)!;
    if (this.period[key] + 1e-9 < amount) {
      return {
        ok: false,
        naziv: "PovratNovca",
        vrijednost: "ERROR_FISCAL_INSUFFICIENT_MONEY",
      };
    }
    this.applyPayments([{ type, amount: -amount }], 1);
    return { ok: true };
  }

  /** Close the current Z period (daily report). Receipt IDs keep incrementing. */
  closeDailyReport(): PeriodSnapshot {
    const closed: PeriodSnapshot = {
      ...this.period,
      closedAt: new Date(),
    };
    this.closedPeriods.push(closed);
    this.zNumber += 1;
    this.period = emptyPeriod(this.zNumber);
    return closed;
  }

  getClosedPeriod(zNumber: number): PeriodSnapshot | undefined {
    return this.closedPeriods.find((p) => p.zNumber === zNumber);
  }

  private validateSale(req: ParsedReceiptRequest): DeviceErr | null {
    const artErr = this.validateArticles(req.articles, "Štampanje fiskalnog računa");
    if (artErr) return artErr;
    for (const p of req.payments) {
      const payErr = this.validatePaymentType(p.type, "Štampanje fiskalnog računa");
      if (payErr) return payErr;
    }
    return null;
  }

  private validateArticles(articles: ParsedArticle[], naziv: string): DeviceErr | null {
    if (!articles.length) {
      return { ok: false, naziv, vrijednost: "ERROR_FISCAL_NO_ITEMS" };
    }
    for (const a of articles) {
      if (!VALID_RATES.has(a.rate)) {
        return { ok: false, naziv, vrijednost: "ERROR_FISCAL_INVALID_ITEM_TAX" };
      }
      if (!(a.quantity >= 0.001 && a.quantity <= 999999.999)) {
        return {
          ok: false,
          naziv: "Količina nije validna ! (0.001 - 999999.999)",
          vrijednost: 408,
        };
      }
    }
    return null;
  }

  private validatePaymentType(type: string, naziv: string): DeviceErr | null {
    if (!VALID_PAYMENTS.has(type)) {
      return { ok: false, naziv, vrijednost: "ERROR_INVALID_PAYMENT_TYPE" };
    }
    return null;
  }

  private applySale(lines: StoredLine[]): void {
    for (const line of lines) {
      if (line.rate === "E") {
        this.period.saleTE = round2(this.period.saleTE + line.net);
        this.period.saleZE = round2(this.period.saleZE + line.vat);
      } else if (line.rate === "K") {
        this.period.saleTK = round2(this.period.saleTK + line.net);
        this.period.saleZK = round2(this.period.saleZK + line.vat);
      } else {
        this.period.saleTA = round2(this.period.saleTA + line.net);
        this.period.saleZA = round2(this.period.saleZA + line.vat);
      }
    }
  }

  private applyReclaim(lines: StoredLine[]): void {
    for (const line of lines) {
      if (line.rate === "E") {
        this.period.reclaimedSaleET = round2(this.period.reclaimedSaleET + line.net);
        this.period.reclaimedSaleEZ = round2(this.period.reclaimedSaleEZ + line.vat);
      } else if (line.rate === "K") {
        this.period.reclaimedSaleKT = round2(this.period.reclaimedSaleKT + line.net);
        this.period.reclaimedSaleKZ = round2(this.period.reclaimedSaleKZ + line.vat);
      } else {
        this.period.reclaimedSaleAT = round2(this.period.reclaimedSaleAT + line.net);
        this.period.reclaimedSaleAZ = round2(this.period.reclaimedSaleAZ + line.vat);
      }
    }
  }

  private applyPayments(payments: ParsedPayment[], sign: 1 | -1): void {
    for (const p of payments) {
      const key = paymentKey(p.type);
      if (!key) continue;
      this.period[key] = round2(this.period[key] + sign * p.amount);
    }
  }

  /**
   * Tring sends cash reclamations as Iznos=0 (value implied by items) and
   * non-cash as a negative amount. Apply the natural (positive) refund.
   */
  private applyRefunds(refunds: ParsedPayment[]): void {
    for (const r of refunds) {
      const key = paymentKey(r.type);
      if (!key) continue;
      const natural = r.type === "Gotovina" ? 0 : Math.abs(r.amount);
      // Cash refund is implied by the items; till cash is not reduced here
      // unless a non-zero amount was sent. Non-cash reduces that bucket.
      if (natural > 0) {
        this.period[key] = round2(this.period[key] - natural);
      }
    }
  }
}
