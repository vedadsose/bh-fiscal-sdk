import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
});

export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null || (value as unknown) === "") return [];
  return Array.isArray(value) ? value : [value];
}

export function parseXml(xml: string): any {
  return parser.parse(xml);
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface OdgovorField {
  name: string;
  value: string | number;
  xsiType?: string;
}

function inferXsiType(value: string | number): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? "xsd:int" : "xsd:double";
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return "xsd:dateTime";
  return "xsd:string";
}

export function kasaOk(fields: OdgovorField[] = [], requestId?: string): string {
  const odgovori = fields
    .map((f) => {
      const xsi = f.xsiType ?? inferXsiType(f.value);
      return `    <Odgovor>
      <Naziv>${escapeXml(f.name)}</Naziv>
      <Vrijednost xsi:type="${xsi}">${escapeXml(String(f.value))}</Vrijednost>
    </Odgovor>`;
    })
    .join("\n");

  const body = fields.length
    ? `\n${odgovori}\n  `
    : "";
  const broj =
    requestId != null && requestId !== ""
      ? `\n  <BrojZahtjeva>${escapeXml(requestId)}</BrojZahtjeva>`
      : "";

  return `<?xml version="1.0" encoding="utf-8"?>
<KasaOdgovor xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Odgovori>${body}</Odgovori>
  <VrstaOdgovora>OK</VrstaOdgovora>${broj}
</KasaOdgovor>`;
}

export function kasaError(
  naziv: string,
  vrijednost: string | number,
  requestId?: string
): string {
  const xsi = inferXsiType(vrijednost);
  const broj =
    requestId != null && requestId !== ""
      ? `\n  <BrojZahtjeva>${escapeXml(requestId)}</BrojZahtjeva>`
      : "";

  return `<?xml version="1.0" encoding="utf-8"?>
<KasaOdgovor xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Odgovori>
    <Odgovor>
      <Naziv>${escapeXml(naziv)}</Naziv>
      <Vrijednost xsi:type="${xsi}">${escapeXml(String(vrijednost))}</Vrijednost>
    </Odgovor>
  </Odgovori>
  <VrstaOdgovora>Greska</VrstaOdgovora>${broj}
</KasaOdgovor>`;
}

export interface ParsedArticle {
  id: string;
  name: string;
  unit?: string;
  price: number;
  rate: string;
  quantity: number;
  discount: number;
}

export interface ParsedPayment {
  type: string;
  amount: number;
}

export interface ParsedBuyer {
  id: string;
  pdvNumber?: string;
  name: string;
  address: string;
  zipCode: string;
  city: string;
}

export interface ParsedReceiptRequest {
  requestId?: string;
  billId?: string;
  date?: string;
  buyer?: ParsedBuyer;
  articles: ParsedArticle[];
  payments: ParsedPayment[];
  originalReceiptId?: string;
  note?: string;
}

function num(value: unknown, fallback = 0): number {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function parseBuyer(raw: any): ParsedBuyer | undefined {
  if (raw == null || raw === "") return undefined;
  const buyer: ParsedBuyer = {
    id: str(raw.IDbroj),
    name: str(raw.Naziv),
    address: str(raw.Adresa),
    zipCode: str(raw.PostanskiBroj),
    city: str(raw.Grad),
  };
  if (raw.PDVBroj != null && raw.PDVBroj !== "") {
    buyer.pdvNumber = str(raw.PDVBroj);
  }
  return buyer;
}

function parseArticles(raw: any): ParsedArticle[] {
  return asArray(raw?.RacunStavka).map((s: any) => ({
    id: str(s?.artikal?.Sifra),
    name: str(s?.artikal?.Naziv),
    unit: s?.artikal?.JM != null && s.artikal.JM !== "" ? str(s.artikal.JM) : undefined,
    price: num(s?.artikal?.Cijena),
    rate: str(s?.artikal?.Stopa),
    quantity: num(s?.Kolicina),
    discount: num(s?.Rabat),
  }));
}

function parsePayments(raw: any): ParsedPayment[] {
  return asArray(raw?.VrstaPlacanja).map((p: any) => ({
    type: str(p?.Oznaka),
    amount: num(p?.Iznos),
  }));
}

export function parseReceiptRequest(xml: string): ParsedReceiptRequest {
  const parsed = parseXml(xml);
  const obj = parsed?.RacunZahtjev?.NoviObjekat ?? {};
  const requestId = parsed?.RacunZahtjev?.BrojZahtjeva;
  return {
    requestId: requestId != null && requestId !== "" ? str(requestId) : undefined,
    billId: obj.BrojRacuna != null ? str(obj.BrojRacuna) : undefined,
    date: obj.Datum != null ? str(obj.Datum) : undefined,
    buyer: parseBuyer(obj.Kupac),
    articles: parseArticles(obj.StavkeRacuna),
    payments: parsePayments(obj.VrstePlacanja),
    originalReceiptId: obj.BrojRacuna != null ? str(obj.BrojRacuna) : undefined,
    note: obj.Napomena != null ? str(obj.Napomena) : undefined,
  };
}

export function parseZahtjevParam(xml: string, name: string): string | undefined {
  const parsed = parseXml(xml);
  const params = asArray(parsed?.Zahtjev?.Parametri?.Parametar);
  const hit = params.find((p: any) => p?.Naziv === name);
  if (hit?.Vrijednost == null || hit.Vrijednost === "") return undefined;
  return str(hit.Vrijednost);
}

export function parseRequestId(xml: string): string | undefined {
  const parsed = parseXml(xml);
  const id =
    parsed?.RacunZahtjev?.BrojZahtjeva ?? parsed?.Zahtjev?.BrojZahtjeva;
  if (id == null || id === "") return undefined;
  return str(id);
}

export function parseMoneyMovement(
  xml: string
): { type: string; amount: number; requestId?: string } {
  const parsed = parseXml(xml);
  const obj = parsed?.RacunZahtjev?.NoviObjekat ?? {};
  const requestId = parsed?.RacunZahtjev?.BrojZahtjeva;
  return {
    type: str(obj.Oznaka),
    amount: num(obj.Iznos),
    requestId: requestId != null && requestId !== "" ? str(requestId) : undefined,
  };
}
