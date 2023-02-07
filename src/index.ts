import axios, { AxiosInstance } from "axios";
import * as Mustache from "mustache";
import { format } from "date-fns";
import {
  PrintPeriodicalReportParams,
  PrintReceiptParams,
  ReceiptResult,
  SDKConfig,
} from "./types";
import xmlTemplates from "./templates";
import { XMLParser } from "fast-xml-parser";

const CLASSIC_DATE_FORMAT = `yyyy-MM-dd'T'hh:mm:ss`;

class FiscalSDK {
  axios: AxiosInstance;

  constructor(config: SDKConfig) {
    this.axios = axios.create({
      baseURL: config.host,
      timeout: 1000,
      headers: { "Content-Type": "text/xml" },
    });
  }

  private async request(command: string, data: string) {
    try {
      return await this.axios.post(command, data);
    } catch (error) {
      throw new Error("Failed to communicate with printer");
    }
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

    console.log(parsed);
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
      };
    } else {
      throw new Error(`Error: ${responses["Štampanje fiskalnog računa"]}`);
    }
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
}

export default FiscalSDK;
