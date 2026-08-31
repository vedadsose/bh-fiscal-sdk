import { rest } from "msw";
import { setupServer } from "msw/node";
import FiscalSDK from "../src/index";

const fiscal = new FiscalSDK({ host: "http://localhost:4000" });

// Response shape per docs v3.0.1: BrojFiskalnogRacuna echoes the original
// receipt and BrojReklamiranogRacuna carries the new reclamation's id.
const docsOkResponse = `<?xml version="1.0" encoding="utf-8"?>
<KasaOdgovor xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Odgovori>
    <Odgovor>
      <Naziv>BrojFiskalnogRacuna</Naziv>
      <Vrijednost xsi:type="xsd:int">19</Vrijednost>
    </Odgovor>
    <Odgovor>
      <Naziv>DatumFiskalnogRacuna</Naziv>
      <Vrijednost xsi:type="xsd:string">2. 10. 2023.</Vrijednost>
    </Odgovor>
    <Odgovor>
      <Naziv>VrijemeFiskalnogRacuna</Naziv>
      <Vrijednost xsi:type="xsd:string">08:37:33</Vrijednost>
    </Odgovor>
    <Odgovor>
      <Naziv>IznosFiskalnogRacuna</Naziv>
      <Vrijednost xsi:type="xsd:double">10.33</Vrijednost>
    </Odgovor>
    <Odgovor>
      <Naziv>BrojReklamiranogRacuna</Naziv>
      <Vrijednost xsi:type="xsd:int">2</Vrijednost>
    </Odgovor>
  </Odgovori>
  <VrstaOdgovora>OK</VrstaOdgovora>
</KasaOdgovor>`;

// Response shape observed on firmware v1.0.125+7661270: only four fields,
// BrojFiskalnogRacuna carries the new reclamation's id directly.
const realFirmwareOkResponse = `<?xml version="1.0" encoding="utf-8"?>
<KasaOdgovor xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Odgovori>
    <Odgovor>
      <Naziv>BrojFiskalnogRacuna</Naziv>
      <Vrijednost xsi:type="xsd:int">3</Vrijednost>
    </Odgovor>
    <Odgovor>
      <Naziv>DatumFiskalnogRacuna</Naziv>
      <Vrijednost xsi:type="xsd:string">17. 5. 2026.</Vrijednost>
    </Odgovor>
    <Odgovor>
      <Naziv>VrijemeFiskalnogRacuna</Naziv>
      <Vrijednost xsi:type="xsd:string">15:27</Vrijednost>
    </Odgovor>
    <Odgovor>
      <Naziv>IznosFiskalnogRacuna</Naziv>
      <Vrijednost xsi:type="xsd:double">1</Vrijednost>
    </Odgovor>
  </Odgovori>
  <VrstaOdgovora>OK</VrstaOdgovora>
</KasaOdgovor>`;

const errorResponse = `<?xml version="1.0" encoding="utf-8"?>
<KasaOdgovor xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Odgovori>
    <Odgovor>
      <Naziv>Štampanje reklamiranog računa</Naziv>
      <Vrijednost xsi:type="xsd:string">ERROR_FISCAL_INSUFFICIENT_MONEY</Vrijednost>
    </Odgovor>
  </Odgovori>
  <VrstaOdgovora>Greska</VrstaOdgovora>
</KasaOdgovor>`;

const baseParams = {
  originalReceiptId: 19,
  articles: [
    {
      id: "2",
      name: "Moj artikal",
      unit: "kg",
      price: 10.33,
      rate: "E" as const,
      quantity: 1,
      discount: 0,
    },
  ],
  refunds: [{ type: "Virman" as const, amount: 10.33 }],
  note: "Hvala na posjeti !!!",
};

describe("reclaimReceipt", () => {
  let lastBody: string;
  const server = setupServer(
    rest.post<string>(
      "http://localhost:4000/stampatireklamiraniracun",
      async (_req, res, ctx) =>
        res(ctx.set("Content-Type", "text/xml"), ctx.body(docsOkResponse))
    )
  );

  beforeAll(() => server.listen());
  afterAll(() => server.close());
  beforeEach(() => {
    server.events.on("request:start", async (req) => {
      lastBody = await req.text();
    });
  });
  afterEach(() => {
    server.resetHandlers();
    lastBody = "";
    server.events.removeAllListeners("request:start");
  });

  it("returns the new reclamation document's id from BrojReklamiranogRacuna (docs shape)", async () => {
    const result = await fiscal.reclaimReceipt(baseParams);
    expect(result).toMatchObject({
      id: 2,
      date: "2. 10. 2023.",
      time: "08:37:33",
      amount: 10.33,
    });
  });

  it("falls back to BrojFiskalnogRacuna when BrojReklamiranogRacuna is absent (firmware v1.0.125)", async () => {
    server.use(
      rest.post<string>(
        "http://localhost:4000/stampatireklamiraniracun",
        async (_req, res, ctx) =>
          res(ctx.set("Content-Type", "text/xml"), ctx.body(realFirmwareOkResponse))
      )
    );
    const result = await fiscal.reclaimReceipt(baseParams);
    expect(result).toMatchObject({
      id: 3,
      date: "17. 5. 2026.",
      time: "15:27",
      amount: 1,
    });
  });

  it("sends VrstaZahtjeva=2 and BrojRacuna pointing at the original receipt", async () => {
    await fiscal.reclaimReceipt(baseParams);
    expect(lastBody).toContain("<VrstaZahtjeva>2</VrstaZahtjeva>");
    expect(lastBody).toContain("<BrojRacuna>19</BrojRacuna>");
  });

  it("inverts non-cash refund amounts to negative", async () => {
    await fiscal.reclaimReceipt(baseParams);
    expect(lastBody).toContain("<Oznaka>Virman</Oznaka>");
    expect(lastBody).toContain("<Iznos>-10.33</Iznos>");
  });

  it("renders Gotovina refunds as Iznos=0 regardless of natural amount", async () => {
    await fiscal.reclaimReceipt({
      ...baseParams,
      refunds: [{ type: "Gotovina", amount: 10.33 }],
    });
    expect(lastBody).toContain("<Oznaka>Gotovina</Oznaka>");
    expect(lastBody).toContain("<Iznos>0</Iznos>");
    expect(lastBody).not.toContain("<Iznos>-10.33</Iznos>");
    expect(lastBody).not.toContain("<Iznos>10.33</Iznos>");
  });

  it("includes the Napomena when provided", async () => {
    await fiscal.reclaimReceipt(baseParams);
    expect(lastBody).toContain("<Napomena>Hvala na posjeti !!!</Napomena>");
  });

  it("renders <PDVBroj> inside <Kupac> when buyer.pdvNumber is set", async () => {
    await fiscal.reclaimReceipt({
      ...baseParams,
      buyer: {
        id: "1234567890123",
        pdvNumber: "123456789012",
        name: "Tring d.o.o.",
        address: "Lejlekuša bb",
        zipCode: "75320",
        city: "Gračanica",
      },
    });
    expect(lastBody).toContain("<IDbroj>1234567890123</IDbroj>");
    expect(lastBody).toContain("<PDVBroj>123456789012</PDVBroj>");
  });

  it("omits <PDVBroj> when buyer has no pdvNumber", async () => {
    await fiscal.reclaimReceipt({
      ...baseParams,
      buyer: {
        id: "1234567890123",
        name: "Tring d.o.o.",
        address: "Lejlekuša bb",
        zipCode: "75320",
        city: "Gračanica",
      },
    });
    expect(lastBody).toContain("<IDbroj>1234567890123</IDbroj>");
    expect(lastBody).not.toContain("<PDVBroj>");
  });

  it("throws on Greska response surfacing the printer error", async () => {
    server.use(
      rest.post<string>(
        "http://localhost:4000/stampatireklamiraniracun",
        async (_req, res, ctx) =>
          res(ctx.set("Content-Type", "text/xml"), ctx.body(errorResponse))
      )
    );
    await expect(fiscal.reclaimReceipt(baseParams)).rejects.toThrow(
      "ERROR_FISCAL_INSUFFICIENT_MONEY"
    );
  });
});
