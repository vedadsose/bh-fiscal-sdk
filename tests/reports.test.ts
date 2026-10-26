import { rest } from "msw";
import { setupServer } from "msw/node";
import FiscalSDK from "../src/index";

const fiscal = new FiscalSDK({ host: "http://localhost:4000" });

const okResponse = `<?xml version="1.0" encoding="utf-8"?>
<KasaOdgovor xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Odgovori />
  <VrstaOdgovora>OK</VrstaOdgovora>
</KasaOdgovor>`;

const invalidPeriodResponse = `<?xml version="1.0" encoding="utf-8"?>
<KasaOdgovor xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Odgovori>
    <Odgovor>
      <Naziv>ERROR_FISCAL_INVALID_PERIOD</Naziv>
      <Vrijednost xsi:type="xsd:string">118</Vrijednost>
    </Odgovor>
  </Odgovori>
  <VrstaOdgovora>Greska</VrstaOdgovora>
</KasaOdgovor>`;

describe("printPeriodicalReport / printOverview", () => {
  let lastBody: string;
  let lastUrl: string;
  let reply = okResponse;

  const server = setupServer(
    rest.post<string>("http://localhost:4000/:command", async (_req, res, ctx) =>
      res(ctx.set("Content-Type", "text/xml"), ctx.body(reply))
    )
  );

  beforeAll(() => server.listen());
  afterAll(() => server.close());
  beforeEach(() => {
    server.events.on("request:start", async (req) => {
      lastBody = await req.text();
      lastUrl = req.url.toString();
    });
  });
  afterEach(() => {
    reply = okResponse;
    lastBody = "";
    lastUrl = "";
    server.events.removeAllListeners("request:start");
  });

  it("sends the period on a 24-hour clock", async () => {
    await fiscal.printPeriodicalReport({
      startDate: new Date(2026, 9, 1, 0, 0, 0),
      endDate: new Date(2026, 9, 26, 23, 59, 59),
    });
    expect(lastUrl).toBe("http://localhost:4000/stampatiperiodicniizvjestaj");
    expect(lastBody).toContain("<VrstaZahtjeva>5</VrstaZahtjeva>");
    expect(lastBody).toContain("<Vrijednost>2026-10-01T00:00:00</Vrijednost>");
    expect(lastBody).toContain("<Vrijednost>2026-10-26T23:59:59</Vrijednost>");
  });

  it("throws when the till refuses the period", async () => {
    reply = invalidPeriodResponse;
    await expect(
      fiscal.printPeriodicalReport({
        startDate: new Date(2026, 9, 1),
        endDate: new Date(2026, 9, 2),
      })
    ).rejects.toMatchObject({ code: "118", deviceMessage: "ERROR_FISCAL_INVALID_PERIOD" });
  });

  it("printOverview posts to /stampatipresjekstanja", async () => {
    await fiscal.printOverview();
    expect(lastUrl).toBe("http://localhost:4000/stampatipresjekstanja");
    expect(lastBody).toContain("<VrstaZahtjeva>3</VrstaZahtjeva>");
  });

  it("printOverview throws when the till answers Greska", async () => {
    reply = invalidPeriodResponse;
    await expect(fiscal.printOverview()).rejects.toThrow(/PresjekStanja failed/);
  });
});
