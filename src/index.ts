import axios, { AxiosInstance } from "axios";
import * as Mustache from "mustache";
import { format } from "date-fns";
import {
  PrintPeriodicalReportParams,
  PrintReceiptParams,
  SDKConfig,
} from "./types";
import xmlTemplates from "./templates";

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

  async printReceipt(params: PrintReceiptParams) {
    await this.request(
      "stampatifiskalniracun",
      this.parseTemplate("stampatifiskalniracun", {
        ...params,
        date: format(params.date, CLASSIC_DATE_FORMAT),
      })
    );
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
