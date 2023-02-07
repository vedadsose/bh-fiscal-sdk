import { rest } from "msw";
import { setupServer } from "msw/node";
import FiscalSDK from "../src/index";

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

      expect(response).toStrictEqual({
        amount: 10,
        date: "01.01.2023.",
        id: 420,
        time: "08:30:59",
      });
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
      ).rejects.toThrowError("Error: ERROR_FISCAL_INVALID_ITEM_TAX");
    });
  });
});
