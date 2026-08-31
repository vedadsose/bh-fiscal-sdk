import * as http from "http";
import { AddressInfo } from "net";
import { FiscalDevice, PeriodSnapshot } from "./device";
import {
  formatDate,
  formatDisplay,
  formatIsoDateTime,
  formatMoneyMove,
  formatPeriod,
  formatReceipt,
  formatReclamation,
  formatTime,
} from "./format";
import {
  kasaError,
  kasaOk,
  OdgovorField,
  parseReceiptRequest,
  parseMoneyMovement,
  parseRequestId,
  parseZahtjevParam,
} from "./xml";

export type LogFn = (message: string) => void;

export interface EmulatorOptions {
  /** Listen port. `0` binds an ephemeral port (useful in tests). Default 8085. */
  port?: number;
  host?: string;
  log?: LogFn;
}

export interface FiscalEmulator {
  device: FiscalDevice;
  server: http.Server;
  url: string;
  port: number;
  close: () => Promise<void>;
}

const XML_TYPE = "text/xml; charset=utf-8";

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: string, type = XML_TYPE) {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function periodFields(period: PeriodSnapshot, now: Date, snake: boolean): OdgovorField[] {
  const n = (snakeName: string, mixedName: string, value: number): OdgovorField => ({
    name: snake ? snakeName : mixedName,
    value,
    xsiType: Number.isInteger(value) ? "xsd:int" : "xsd:double",
  });

  const fields: OdgovorField[] = [
    {
      name: snake ? "current_datetime" : "Datum",
      value: formatIsoDateTime(now),
      xsiType: "xsd:dateTime",
    },
    n("z_number", "zNumber", period.zNumber),
    n("first_BF", "firstBF", period.firstBF),
    n("last_BF", "lastBF", period.lastBF),
    n("first_RF", "firstRF", period.firstRF),
    n("last_RF", "lastRF", period.lastRF),
    n("sale_TA", "TA", period.saleTA),
    n("sale_TE", "TE", period.saleTE),
    n("sale_TK", "TK", period.saleTK),
    n("sale_ZA", "ZA", period.saleZA),
    n("sale_ZE", "ZE", period.saleZE),
    n("sale_ZK", "ZK", period.saleZK),
    n("reclaimed_sale_AT", "AT", period.reclaimedSaleAT),
    n("reclaimed_sale_ET", "ET", period.reclaimedSaleET),
    n("reclaimed_sale_KT", "KT", period.reclaimedSaleKT),
    n("reclaimed_sale_AZ", "AZ", period.reclaimedSaleAZ),
    n("reclaimed_sale_EZ", "EZ", period.reclaimedSaleEZ),
    n("reclaimed_sale_KZ", "KZ", period.reclaimedSaleKZ),
    n("services", "Services", 0),
    n("resets", "Resets", 0),
    n("tax_changes", "Taxes", 0),
  ];

  if (snake) {
    fields.push(
      { name: "ibfm", value: "EMU00001", xsiType: "xsd:string" },
      { name: "fw_version", value: "emulator-0.1.0", xsiType: "xsd:string" },
      { name: "cash", value: period.cash, xsiType: "xsd:double" },
      { name: "check", value: period.check, xsiType: "xsd:double" },
      { name: "card", value: period.card, xsiType: "xsd:double" },
      { name: "transfer_order", value: period.transferOrder, xsiType: "xsd:double" },
      { name: "tax_a", value: 0, xsiType: "xsd:short" },
      { name: "tax_e", value: 1700, xsiType: "xsd:short" },
      { name: "tax_k", value: 0, xsiType: "xsd:short" },
      { name: "sale_TJ", value: 0, xsiType: "xsd:double" },
      { name: "sale_TM", value: 0, xsiType: "xsd:double" },
      { name: "sale_ZJ", value: 0, xsiType: "xsd:double" },
      { name: "sale_ZM", value: 0, xsiType: "xsd:double" }
    );
  } else {
    fields.push(
      { name: "fw_version", value: "emulator-0.1.0", xsiType: "xsd:string" },
      { name: "TotalServices", value: 0, xsiType: "xsd:int" },
      { name: "TotalTaxes", value: 0, xsiType: "xsd:int" },
      { name: "TotalResets", value: 0, xsiType: "xsd:int" }
    );
  }

  return fields;
}

function commandName(url: string | undefined): string {
  const path = (url ?? "/").split("?")[0];
  return path.replace(/^\//, "").replace(/\/$/, "").toLowerCase();
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  device: FiscalDevice,
  log: LogFn
): Promise<void> {
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

  const cmd = commandName(req.url);

  if (req.method === "GET" && (cmd === "" || cmd === "health")) {
    send(
      res,
      200,
      JSON.stringify(
        {
          name: "bh-fiscal-emulator",
          receipts: device.receipts.length,
          reclamations: device.reclamations.length,
          zNumber: device.currentPeriod.zNumber,
          nextReceiptHint:
            device.receipts.length === 0
              ? 1
              : device.receipts[device.receipts.length - 1].id + 1,
        },
        null,
        2
      ),
      "application/json; charset=utf-8"
    );
    return;
  }

  if (req.method !== "POST") {
    send(res, 405, kasaError("Emulator", "ERROR_METHOD_NOT_ALLOWED"));
    return;
  }

  const body = await readBody(req);
  const requestId = parseRequestId(body);

  switch (cmd) {
    case "stampatifiskalniracun": {
      const parsed = parseReceiptRequest(body);
      const result = device.printReceipt(parsed);
      if (!result.ok) {
        send(res, 200, kasaError(result.naziv, result.vrijednost, requestId));
        return;
      }
      log(formatReceipt(result.receipt, { ibfm: device.ibfm }));
      send(
        res,
        200,
        kasaOk(
          [
            { name: "BrojFiskalnogRacuna", value: result.id, xsiType: "xsd:int" },
            {
              name: "DatumFiskalnogRacuna",
              value: formatDate(result.date),
              xsiType: "xsd:string",
            },
            {
              name: "VrijemeFiskalnogRacuna",
              value: formatTime(result.date),
              xsiType: "xsd:string",
            },
            {
              name: "IznosFiskalnogRacuna",
              value: result.amount,
              xsiType: "xsd:double",
            },
          ],
          requestId
        )
      );
      return;
    }

    case "stampatireklamiraniracun": {
      const parsed = parseReceiptRequest(body);
      const result = device.reclaimReceipt(parsed);
      if (!result.ok) {
        send(res, 200, kasaError(result.naziv, result.vrijednost, requestId));
        return;
      }
      log(formatReclamation(result.reclamation, { ibfm: device.ibfm }));
      send(
        res,
        200,
        kasaOk(
          [
            {
              name: "BrojFiskalnogRacuna",
              value: result.reclamation.originalReceiptId,
              xsiType: "xsd:int",
            },
            {
              name: "DatumFiskalnogRacuna",
              value: formatDate(result.date),
              xsiType: "xsd:string",
            },
            {
              name: "VrijemeFiskalnogRacuna",
              value: formatTime(result.date),
              xsiType: "xsd:string",
            },
            {
              name: "IznosFiskalnogRacuna",
              value: result.amount,
              xsiType: "xsd:double",
            },
            {
              name: "BrojReklamiranogRacuna",
              value: result.id,
              xsiType: "xsd:int",
            },
          ],
          requestId
        )
      );
      return;
    }

    case "stampatidnevniizvjestaj": {
      const closed = device.closeDailyReport();
      log(formatPeriod("DNEVNI IZVJEŠTAJ", closed, { ibfm: device.ibfm }));
      send(res, 200, kasaOk([], requestId));
      return;
    }

    case "stampatipresjekstanja": {
      log(formatPeriod("PRESJEK STANJA", device.currentPeriod, { ibfm: device.ibfm }));
      send(res, 200, kasaOk([], requestId));
      return;
    }

    case "stampatiperiodicniizvjestaj": {
      const from = parseZahtjevParam(body, "odDatuma") ?? "?";
      const to = parseZahtjevParam(body, "doDatuma") ?? "?";
      log(`[PERIODIC REPORT] ${from} → ${to}`);
      send(res, 200, kasaOk([], requestId));
      return;
    }

    case "oi": {
      const brojDI = parseZahtjevParam(body, "BrojDI");
      if (brojDI != null) {
        const requested = Number(brojDI);
        const historical = device.getClosedPeriod(requested);
        if (historical) {
          send(
            res,
            200,
            kasaOk(periodFields(historical, historical.closedAt, false), requestId)
          );
          return;
        }
        // Real firmware falls back to the current snapshot when BrojDI is
        // out of range; the SDK detects that by comparing zNumber.
      }
      send(
        res,
        200,
        kasaOk(periodFields(device.currentPeriod, new Date(), true), requestId)
      );
      return;
    }

    case "unosnovca": {
      const move = parseMoneyMovement(body);
      const result = device.deposit(move.type, move.amount);
      if (!result.ok) {
        send(res, 200, kasaError(result.naziv, result.vrijednost, requestId));
        return;
      }
      log(formatMoneyMove("IN", move.type, move.amount));
      send(res, 200, kasaOk([], requestId));
      return;
    }

    case "povratnovca": {
      const move = parseMoneyMovement(body);
      const result = device.withdraw(move.type, move.amount);
      if (!result.ok) {
        send(res, 200, kasaError(result.naziv, result.vrijednost, requestId));
        return;
      }
      log(formatMoneyMove("OUT", move.type, move.amount));
      send(res, 200, kasaOk([], requestId));
      return;
    }

    case "upisinadisplej2": {
      const line1 = parseZahtjevParam(body, "linija1") ?? "";
      const line2 = parseZahtjevParam(body, "linija2") ?? "";
      log(formatDisplay(line1, line2));
      send(res, 200, kasaOk([], requestId));
      return;
    }

    default: {
      send(
        res,
        200,
        kasaError("Emulator", `unknown command "${cmd}"`, requestId)
      );
    }
  }
}

export function startEmulator(options: EmulatorOptions = {}): Promise<FiscalEmulator> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8085;
  const log = options.log ?? ((msg) => console.log(msg));
  const device = new FiscalDevice();

  const server = http.createServer((req, res) => {
    handle(req, res, device, log).catch((err) => {
      log(`[emulator] handler error: ${err instanceof Error ? err.message : err}`);
      if (!res.headersSent) {
        send(res, 500, kasaError("Emulator", "ERROR_INTERNAL"));
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address() as AddressInfo;
      const url = `http://${host}:${addr.port}`;
      resolve({
        device,
        server,
        url,
        port: addr.port,
        close: () =>
          new Promise<void>((resClose, rejClose) => {
            server.close((err) => (err ? rejClose(err) : resClose()));
          }),
      });
    });
  });
}
