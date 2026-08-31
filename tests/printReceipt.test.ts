import { rest } from "msw";
import { setupServer } from "msw/node";
import FiscalSDK, { FiscalError } from "../src/index";

// Test instance
const fiscal = new FiscalSDK({
  host: "http://localhost:4000",
});

describe("Print receipt", () => {
  describe("when the service is working", () => {
    let lastBody: string;

    // Mocking server
    const server = setupServer(
      rest.post<string>(
        "http://localhost:4000/stampatifiskalniracun",
        async (req, res, ctx) => {
          return res(
            ctx.xml(`<?xml version="1.0" encoding="utf-8"?>
      <KasaOdgovor xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
        <Odgovori>
          <Odgovor>
            <Naziv>BrojFiskalnogRacuna</Naziv>
            <Vrijednost xsi:type="xsd:int">420</Vrijednost>
          </Odgovor>
          <Odgovor>
            <Naziv>DatumFiskalnogRacuna</Naziv>
            <Vrijednost xsi:type="xsd:string">01.01.2023.</Vrijednost>
          </Odgovor>
          <Odgovor>
            <Naziv>VrijemeFiskalnogRacuna</Naziv>
            <Vrijednost xsi:type="xsd:string">08:30:59</Vrijednost>
          </Odgovor>
          <Odgovor>
            <Naziv>IznosFiskalnogRacuna</Naziv>
            <Vrijednost xsi:type="xsd:double">10</Vrijednost>
          </Odgovor>
        </Odgovori>
        <VrstaOdgovora>OK</VrstaOdgovora>
        <BrojZahtjeva>233</BrojZahtjeva>
      </KasaOdgovor>`)
          );
        }
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

    it("should prepare and send the correct XML", async () => {
      await fiscal.printReceipt({
        articles: [
          {
            id: "1",
            name: "Zvake",
            price: 10,
            rate: "E",
            quantity: 1,
            discount: 0,
          },
        ],
        paymentMethods: [{ type: "Gotovina", amount: 10 }],
        billId: "1",
        date: new Date("2023-01-01T08:30:59"),
      });

      expect(lastBody).toMatchSnapshot();
    });

    it("should return the correct response", async () => {
      const response = await fiscal.printReceipt({
        articles: [
          {
            id: "1",
            name: "Zvake",
            price: 10,
            rate: "E",
            quantity: 1,
            discount: 0,
          },
        ],
        paymentMethods: [{ type: "Gotovina", amount: 10 }],
        billId: "1",
        date: new Date(),
      });

      expect(response).toMatchObject({
        amount: 10,
        date: "01.01.2023.",
        id: 420,
        time: "08:30:59",
      });
    });

    it("exposes the raw request and response XML on success", async () => {
      const response = await fiscal.printReceipt({
        articles: [
          {
            id: "1",
            name: "Zvake",
            price: 10,
            rate: "E",
            quantity: 1,
            discount: 0,
          },
        ],
        paymentMethods: [{ type: "Gotovina", amount: 10 }],
        billId: "1",
        date: new Date(),
      });

      expect(response.raw?.request).toContain("<RacunZahtjev");
      expect(response.raw?.request).toContain("<Naziv>Zvake</Naziv>");
      expect(response.raw?.response).toContain("<KasaOdgovor");
      expect(response.raw?.response).toContain("<VrstaOdgovora>OK</VrstaOdgovora>");
    });

    it("includes <Kupac> block with PDVBroj when buyer.pdvNumber is set", async () => {
      await fiscal.printReceipt({
        articles: [
          {
            id: "1",
            name: "Zvake",
            price: 10,
            rate: "E",
            quantity: 1,
            discount: 0,
          },
        ],
        paymentMethods: [{ type: "Gotovina", amount: 10 }],
        billId: "1",
        date: new Date("2023-01-01T08:30:59"),
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
      expect(lastBody).toContain("<Naziv>Tring d.o.o.</Naziv>");
    });

    it("omits <PDVBroj> when buyer has no pdvNumber", async () => {
      await fiscal.printReceipt({
        articles: [
          {
            id: "1",
            name: "Zvake",
            price: 10,
            rate: "E",
            quantity: 1,
            discount: 0,
          },
        ],
        paymentMethods: [{ type: "Gotovina", amount: 10 }],
        billId: "1",
        date: new Date("2023-01-01T08:30:59"),
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
  });

  describe("when the service is not working", () => {
    // Mocking server
    const server = setupServer(
      rest.post<string>(
        "http://localhost:4000/stampatifiskalniracun",
        async (req, res, ctx) => {
          return res(
            ctx.xml(`<?xml version="1.0" encoding="utf-8"?>
      <KasaOdgovor xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
        <Odgovori>
          <Odgovor>
            <Naziv>Štampanje fiskalnog računa</Naziv>
            <Vrijednost xsi:type="xsd:int">ERROR_FISCAL_INVALID_ITEM_TAX</Vrijednost>
          </Odgovor>
        </Odgovori>
        <VrstaOdgovora>Greska</VrstaOdgovora>
        <BrojZahtjeva>233</BrojZahtjeva>
      </KasaOdgovor>`)
          );
        }
      )
    );

    beforeAll(() => server.listen());
    afterAll(() => server.close());
    afterEach(() => server.resetHandlers());

    it("should throw an error", async () => {
      await expect(
        fiscal.printReceipt({
          articles: [
            {
              id: "1",
              name: "Zvake",
              price: 10,
              rate: "E",
              quantity: 1,
              discount: 0,
            },
          ],
          paymentMethods: [{ type: "Gotovina", amount: 10 }],
          billId: "1",
          date: new Date(),
        })
      ).rejects.toThrowError("ERROR_FISCAL_INVALID_ITEM_TAX");
    });
  });

  describe("when the printer rejects with a coded error (real firmware)", () => {
    // Real firmware puts the human-readable reason in <Naziv> and a numeric
    // status code in <Vrijednost> — the inverse of the command-label/error-text
    // shape the SDK originally assumed. Without surfacing <Naziv>, this used to
    // throw the useless "Error: undefined".
    const server = setupServer(
      rest.post<string>(
        "http://localhost:4000/stampatifiskalniracun",
        async (req, res, ctx) => {
          return res(
            ctx.xml(`<?xml version="1.0" encoding="utf-8"?>
      <KasaOdgovor xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
        <Odgovori>
          <Odgovor>
            <Naziv>Količina nije validna ! (0.001 - 999999.999)</Naziv>
            <Vrijednost xsi:type="xsd:int">408</Vrijednost>
          </Odgovor>
        </Odgovori>
        <VrstaOdgovora>Greska</VrstaOdgovora>
        <BrojZahtjeva />
      </KasaOdgovor>`)
          );
        }
      )
    );

    beforeAll(() => server.listen());
    afterAll(() => server.close());
    afterEach(() => server.resetHandlers());

    const params = {
      articles: [
        {
          id: "1",
          name: "Zvake",
          price: 10,
          rate: "E" as const,
          quantity: 1,
          discount: 0,
        },
      ],
      paymentMethods: [{ type: "Gotovina" as const, amount: 10 }],
      billId: "1",
      date: new Date(),
    };

    it("surfaces the device message and status code, not 'Error: undefined'", async () => {
      await expect(fiscal.printReceipt(params)).rejects.toThrow(
        /Količina nije validna.*408/
      );
    });

    it("throws a FiscalError carrying the raw request and response", async () => {
      const error = await fiscal.printReceipt(params).catch((e) => e);

      expect(error).toBeInstanceOf(FiscalError);
      expect(error.request).toContain("<RacunZahtjev");
      expect(error.response).toContain("Količina nije validna");
      expect(error.response).toContain("<VrstaOdgovora>Greska</VrstaOdgovora>");
    });

    it("exposes the structured device message, code, and response type", async () => {
      const error = await fiscal.printReceipt(params).catch((e) => e);

      expect(error.deviceMessage).toBe("Količina nije validna ! (0.001 - 999999.999)");
      expect(error.code).toBe("408");
      expect(error.responseType).toBe("Greska");
    });
  });
});
