import axios, { AxiosInstance, AxiosResponse, AxiosError } from "axios";
import * as Mustache from "mustache";
import { format } from "date-fns";
import {
  FiscalError,
  FiscalSummary,
  GetDailyReportParams,
  KasaErrorDetails,
  MoneyMovementParams,
  PrintPeriodicalReportParams,
  PrintReceiptParams,
  RawExchange,
  ReceiptResult,
  ReclaimReceiptParams,
  ReclamationResult,
  SDKConfig,
  WriteToDisplayParams,
} from "./types";
import xmlTemplates from "./templates";
import { XMLParser } from "fast-xml-parser";

const CLASSIC_DATE_FORMAT = `yyyy-MM-dd'T'hh:mm:ss`;

// Pull the structured device error details out of a failed <KasaOdgovor>.
// Firmware revisions disagree on the shape of an error <Odgovor>: some put a
// command label in <Naziv> and the error text in <Vrijednost>, while others put
// the human-readable reason in <Naziv> and a numeric status code in
// <Vrijednost> (e.g. "Količina nije validna ! (0.001 - 999999.999)" / 408). A
// purely-numeric <Vrijednost> is treated as the status code; anything else is
// error text that belongs in the message. This covers either convention,
// instead of looking up a fixed key one of them never returns — which is what
// produced the old "Error: undefined".
export function parseKasaError(parsed: any): KasaErrorDetails {
  const odgovori = ([] as { Naziv?: unknown; Vrijednost?: unknown }[])
    .concat(parsed?.KasaOdgovor?.Odgovori?.Odgovor ?? [])
    .filter((o) => o != null);

  let code: string | undefined;
  const parts = odgovori
    .map((o) => {
      const naziv = o?.Naziv != null ? String(o.Naziv).trim() : "";
      const vrijednost = o?.Vrijednost != null ? String(o.Vrijednost).trim() : "";
      if (vrijednost && /^\d+$/.test(vrijednost)) {
        if (code === undefined) code = vrijednost;
        return naziv;
      }
      if (naziv && vrijednost) return `${naziv}: ${vrijednost}`;
      return naziv || vrijednost;
    })
    .filter((s) => s.length > 0);

  const typeRaw = parsed?.KasaOdgovor?.VrstaOdgovora;
  const responseType =
    typeRaw != null && String(typeRaw).trim() !== "" ? String(typeRaw).trim() : undefined;

  return {
    deviceMessage: parts.length ? parts.join("; ") : undefined,
    code,
    responseType,
  };
}

// Build a human-readable message from a failed <KasaOdgovor>, re-joining the
// status code so the message reads the same as the device reported it.
function formatKasaError(parsed: any): string {
  const { deviceMessage, code, responseType } = parseKasaError(parsed);
  if (deviceMessage) return code ? `${deviceMessage}: ${code}` : deviceMessage;
  return responseType
    ? `fiscal device returned "${responseType}" without details`
    : "unknown fiscal device error";
}

class FiscalSDK {
  axios: AxiosInstance;

  constructor(config: SDKConfig) {
    this.axios = axios.create({
      baseURL: config.host,
      timeout: config.timeout ?? 1000,
      headers: { "Content-Type": "text/xml" },
    });
  }

  private async request(command: string, data: string) {
    try {
      return await this.axios.post(command, data);
    } catch (error) {
      const response = (error as AxiosError)?.response?.data;
      throw new FiscalError("Failed to communicate with printer", {
        request: data,
        response: response != null ? String(response) : undefined,
      });
    }
  }

  // Pull the raw request/response XML off an axios response. The request body
  // is preserved on config.data after the round-trip.
  private rawExchange(response: AxiosResponse): RawExchange {
    const asString = (value: unknown): string =>
      typeof value === "string" ? value : value == null ? "" : String(value);
    return {
      request: asString(response.config?.data),
      response: asString(response.data),
    };
  }

  // Build a FiscalError for a failed <KasaOdgovor>, carrying both the raw
  // exchange and the structured device details so callers don't re-parse it.
  private kasaError(
    parsed: any,
    response: AxiosResponse,
    prefix?: string
  ): FiscalError {
    const base = formatKasaError(parsed);
    return new FiscalError(prefix ? `${prefix}: ${base}` : base, {
      ...this.rawExchange(response),
      ...parseKasaError(parsed),
    });
  }

  private parseTemplate(fileName: string, params: object = {}) {
    if (!xmlTemplates[fileName]) {
      throw new Error("No such template");
    }

    return Mustache.render(xmlTemplates[fileName], params);
  }

  async printReceipt(params: PrintReceiptParams): Promise<ReceiptResult> {
    const response = await this.request(
      "stampatifiskalniracun",
      this.parseTemplate("stampatifiskalniracun", {
        ...params,
        date: format(params.date, CLASSIC_DATE_FORMAT),
      })
    );

    const parser = new XMLParser();
    const parsed = parser.parse(response.data);

    const responses: Record<string, string> = (
      [].concat(parsed.KasaOdgovor.Odgovori.Odgovor) as {
        Naziv: string;
        Vrijednost: string;
      }[]
    ).reduce(
      (acc, item) => ({
        ...acc,
        [item.Naziv]: item.Vrijednost,
      }),
      {}
    );

    if (parsed.KasaOdgovor.VrstaOdgovora === "OK") {
      return {
        id: +responses.BrojFiskalnogRacuna,
        date: responses.DatumFiskalnogRacuna,
        time: responses.VrijemeFiskalnogRacuna,
        amount: +responses.IznosFiskalnogRacuna,
        raw: this.rawExchange(response),
      };
    } else {
      throw this.kasaError(parsed, response);
    }
  }

  async reclaimReceipt(
    params: ReclaimReceiptParams
  ): Promise<ReclamationResult> {
    // Tring sign convention: cash leg is sent as Iznos=0 (the refund value is
    // implied by the items); non-cash legs are sent as negative amounts. The
    // public API takes positive amounts so callers don't have to remember this.
    const refunds = params.refunds.map((r) => ({
      type: r.type,
      signedAmount: r.type === "Gotovina" ? 0 : -r.amount,
    }));

    const response = await this.request(
      "stampatireklamiraniracun",
      this.parseTemplate("stampatireklamiraniracun", {
        ...params,
        refunds,
        note: params.note ?? "",
      })
    );

    const parser = new XMLParser();
    const parsed = parser.parse(response.data);

    const responses: Record<string, string> = (
      [].concat(parsed.KasaOdgovor.Odgovori.Odgovor) as {
        Naziv: string;
        Vrijednost: string;
      }[]
    ).reduce(
      (acc, item) => ({ ...acc, [item.Naziv]: item.Vrijednost }),
      {}
    );

    if (parsed.KasaOdgovor.VrstaOdgovora !== "OK") {
      throw this.kasaError(parsed, response);
    }

    // Docs put the new reclamation's id in BrojReklamiranogRacuna while
    // BrojFiskalnogRacuna echoes the input. Firmware v1.0.125+7661270 omits
    // BrojReklamiranogRacuna and puts the new id in BrojFiskalnogRacuna
    // directly. Prefer the explicit field, fall back to the echo slot.
    const rawId =
      responses.BrojReklamiranogRacuna ?? responses.BrojFiskalnogRacuna;
    return {
      id: +rawId,
      date: responses.DatumFiskalnogRacuna,
      time: responses.VrijemeFiskalnogRacuna,
      amount: +responses.IznosFiskalnogRacuna,
      raw: this.rawExchange(response),
    };
  }

  async printPeriodicalReport(params: PrintPeriodicalReportParams) {
    await this.request(
      "stampatiperiodicniizvjestaj",
      this.parseTemplate("stampatiperiodicniizvjestaj", {
        ...params,
        startDate: format(params.startDate, CLASSIC_DATE_FORMAT),
        endDate: format(params.endDate, CLASSIC_DATE_FORMAT),
      })
    );
  }

  async printDailyReport() {
    await this.request(
      "stampatidnevniizvjestaj",
      this.parseTemplate("stampatidnevniizvjestaj")
    );
  }

  async printOverview() {
    await this.request(
      "stampatipresjekstanja",
      this.parseTemplate("stampatipresjekstanja")
    );
  }

  async depositMoney(params: MoneyMovementParams): Promise<void> {
    const response = await this.request(
      "unosnovca",
      this.parseTemplate("cashmovement", params)
    );
    this.assertKasaOk(response, "UnosNovca");
  }

  async withdrawMoney(params: MoneyMovementParams): Promise<void> {
    const response = await this.request(
      "povratnovca",
      this.parseTemplate("cashmovement", params)
    );
    this.assertKasaOk(response, "PovratNovca");
  }

  private assertKasaOk(response: AxiosResponse, commandName: string): void {
    const parser = new XMLParser();
    const parsed = parser.parse(response.data);
    if (parsed?.KasaOdgovor?.VrstaOdgovora === "OK") return;

    throw this.kasaError(parsed, response, `${commandName} failed`);
  }

  async writeToDisplay(params: WriteToDisplayParams = {}): Promise<void> {
    await this.request(
      "upisinadisplej2",
      this.parseTemplate("upisinadisplej2", {
        line1: params.line1 ?? "",
        line2: params.line2 ?? "",
      })
    );
  }

  async getBasicInfo(): Promise<FiscalSummary> {
    const response = await this.request(
      "oi",
      this.parseTemplate("osnovneinformacije")
    );
    return this.parseFiscalSummary(response, "OsnovneInformacije");
  }

  async getDailyReport(params: GetDailyReportParams): Promise<FiscalSummary> {
    const response = await this.request(
      "oi",
      this.parseTemplate("oididnevniizvjestaj", params)
    );
    const summary = this.parseFiscalSummary(
      response,
      "ElektronskiDnevniIzvjestaj"
    );

    // The printer silently falls back to the current basic-info snapshot when
    // BrojDI is out of range (verified on firmware v1.0.125+7661270). Detect
    // it by checking the returned Z number against the requested one.
    if (summary.zNumber !== params.brojDI) {
      throw new FiscalError(
        `Daily report ${params.brojDI} not available (printer returned Z=${summary.zNumber ?? "<empty>"})`,
        this.rawExchange(response)
      );
    }

    return summary;
  }

  private parseFiscalSummary(
    response: AxiosResponse,
    command: "OsnovneInformacije" | "ElektronskiDnevniIzvjestaj"
  ): FiscalSummary {
    const parser = new XMLParser();
    const parsed = parser.parse(response.data);

    const r: Record<string, string> = (
      [].concat(parsed.KasaOdgovor.Odgovori.Odgovor) as {
        Naziv: string;
        Vrijednost: string;
      }[]
    ).reduce(
      (acc, item) => ({ ...acc, [item.Naziv]: item.Vrijednost }),
      {}
    );

    if (parsed.KasaOdgovor.VrstaOdgovora !== "OK") {
      throw this.kasaError(parsed, response, `${command} failed`);
    }

    const num = (...keys: string[]): number | undefined => {
      for (const k of keys) {
        const v = r[k];
        if (v !== undefined && v !== "") return +v;
      }
      return undefined;
    };
    const str = (...keys: string[]): string | undefined => {
      for (const k of keys) {
        const v = r[k];
        if (v !== undefined && v !== "") return v;
      }
      return undefined;
    };
    const date = (...keys: string[]): Date | undefined => {
      for (const k of keys) {
        const v = r[k];
        if (v !== undefined && v !== "") return new Date(v);
      }
      return undefined;
    };

    return {
      currentDateTime: date("current_datetime", "Datum"),
      ibfm: str("ibfm"),
      fwVersion: str("fw_version"),
      lastInspectionDate: date("last_inspection_date"),
      lastTransferDate: date("last_transfer_date"),

      firstBF: num("first_BF", "firstBF"),
      lastBF: num("last_BF", "lastBF"),
      firstRF: num("first_RF", "firstRF"),
      lastRF: num("last_RF", "lastRF"),

      zNumber: num("z_number", "zNumber"),
      services: num("services", "Services"),
      resets: num("resets", "Resets"),
      taxChanges: num("tax_changes", "Taxes"),
      totalServices: num("TotalServices"),
      totalTaxes: num("TotalTaxes"),
      totalResets: num("TotalResets"),

      cash: num("cash"),
      check: num("check"),
      card: num("card"),
      transferOrder: num("transfer_order"),

      saleTA: num("sale_TA", "TA"),
      saleTE: num("sale_TE", "TE"),
      saleTJ: num("sale_TJ", "TJ"),
      saleTK: num("sale_TK", "TK"),
      saleTM: num("sale_TM", "TM"),
      saleZA: num("sale_ZA", "ZA"),
      saleZE: num("sale_ZE", "ZE"),
      saleZJ: num("sale_ZJ", "ZJ"),
      saleZK: num("sale_ZK", "ZK"),
      saleZM: num("sale_ZM", "ZM"),

      canceledSaleSEA: num("canceled_sale_SEA", "SEA"),
      canceledSaleEA: num("canceled_sale_EA", "EA"),
      canceledSaleSEP: num("canceled_sale_SEP", "SEP"),

      reclaimedSaleAT: num("reclaimed_sale_AT", "AT"),
      reclaimedSaleET: num("reclaimed_sale_ET", "ET"),
      reclaimedSaleJT: num("reclaimed_sale_JT", "JT"),
      reclaimedSaleKT: num("reclaimed_sale_KT", "KT"),
      reclaimedSaleMT: num("reclaimed_sale_MT", "MT"),
      reclaimedSaleAZ: num("reclaimed_sale_AZ", "AZ"),
      reclaimedSaleEZ: num("reclaimed_sale_EZ", "EZ"),
      reclaimedSaleJZ: num("reclaimed_sale_JZ", "JZ"),
      reclaimedSaleKZ: num("reclaimed_sale_KZ", "KZ"),
      reclaimedSaleMZ: num("reclaimed_sale_MZ", "MZ"),

      canceledReclaimedSaleSRA: num("canceled_reclaimed_sale_SRA", "SRA"),
      canceledReclaimedSaleRA: num("canceled_reclaimed_sale_RA", "RA"),
      canceledReclaimedSaleSRP: num("canceled_reclaimed_sale_SRP", "SRP"),

      taxA: num("tax_a"),
      taxE: num("tax_e"),
      taxJ: num("tax_j"),
      taxK: num("tax_k"),
      taxM: num("tax_m"),

      raw: this.rawExchange(response),
    };
  }
}

export default FiscalSDK;
export { FiscalError } from "./types";
export type { RawExchange, KasaErrorDetails, FiscalErrorInfo } from "./types";
