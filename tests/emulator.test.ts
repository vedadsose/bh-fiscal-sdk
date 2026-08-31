import FiscalSDK from "../src/index";
import { FiscalDevice } from "../emulator/device";
import { startEmulator } from "../emulator/server";
import { parseReceiptRequest } from "../emulator/xml";

const article = {
  id: "1",
  name: "Zvake",
  price: 10,
  rate: "E" as const,
  quantity: 1,
  discount: 0,
};

describe("FiscalDevice (in-memory)", () => {
  it("assigns receipt ids in ascending order starting at 1", () => {
    const device = new FiscalDevice();
    const a = device.printReceipt({
      articles: [{ id: "1", name: "A", price: 1, rate: "E", quantity: 1, discount: 0 }],
      payments: [{ type: "Gotovina", amount: 1 }],
      billId: "1",
    });
    const b = device.printReceipt({
      articles: [{ id: "2", name: "B", price: 2, rate: "E", quantity: 1, discount: 0 }],
      payments: [{ type: "Gotovina", amount: 2 }],
      billId: "2",
    });
    const c = device.printReceipt({
      articles: [{ id: "3", name: "C", price: 3, rate: "K", quantity: 1, discount: 0 }],
      payments: [{ type: "Kartica", amount: 3 }],
      billId: "3",
    });

    expect(a.ok && a.id).toBe(1);
    expect(b.ok && b.id).toBe(2);
    expect(c.ok && c.id).toBe(3);
    expect(device.receipts.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(device.currentPeriod.firstBF).toBe(1);
    expect(device.currentPeriod.lastBF).toBe(3);
  });

  it("assigns reclamation ids independently, still ascending", () => {
    const device = new FiscalDevice();
    device.printReceipt({
      articles: [{ id: "1", name: "A", price: 1, rate: "E", quantity: 1, discount: 0 }],
      payments: [{ type: "Gotovina", amount: 1 }],
    });
    device.printReceipt({
      articles: [{ id: "2", name: "B", price: 2, rate: "E", quantity: 1, discount: 0 }],
      payments: [{ type: "Gotovina", amount: 2 }],
    });

    const r1 = device.reclaimReceipt({
      originalReceiptId: "1",
      articles: [{ id: "1", name: "A", price: 1, rate: "E", quantity: 1, discount: 0 }],
      payments: [{ type: "Gotovina", amount: 0 }],
    });
    const r2 = device.reclaimReceipt({
      originalReceiptId: "2",
      articles: [{ id: "2", name: "B", price: 2, rate: "E", quantity: 1, discount: 0 }],
      payments: [{ type: "Gotovina", amount: 0 }],
    });

    expect(r1.ok && r1.id).toBe(1);
    expect(r2.ok && r2.id).toBe(2);
  });

  it("rejects an unknown original receipt on reclaim", () => {
    const device = new FiscalDevice();
    const result = device.reclaimReceipt({
      originalReceiptId: "99",
      articles: [{ id: "1", name: "A", price: 1, rate: "E", quantity: 1, discount: 0 }],
      payments: [{ type: "Gotovina", amount: 0 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.vrijednost).toBe("ERROR_FISCAL_RECEIPT_NOT_FOUND");
    }
  });

  it("closes a Z period on daily report and keeps receipt ids going", () => {
    const device = new FiscalDevice();
    device.printReceipt({
      articles: [{ id: "1", name: "A", price: 1, rate: "E", quantity: 1, discount: 0 }],
      payments: [{ type: "Gotovina", amount: 1 }],
    });
    const closed = device.closeDailyReport();
    expect(closed.zNumber).toBe(1);
    expect(closed.lastBF).toBe(1);
    expect(device.currentPeriod.zNumber).toBe(2);
    expect(device.currentPeriod.lastBF).toBe(0);

    const next = device.printReceipt({
      articles: [{ id: "1", name: "A", price: 1, rate: "E", quantity: 1, discount: 0 }],
      payments: [{ type: "Gotovina", amount: 1 }],
    });
    expect(next.ok && next.id).toBe(2);
    expect(device.currentPeriod.firstBF).toBe(2);
  });
});

describe("fiscal emulator HTTP server", () => {
  const logs: string[] = [];
  let url: string;
  let close: () => Promise<void>;
  let sdk: FiscalSDK;

  beforeAll(async () => {
    const emu = await startEmulator({
      port: 0,
      log: (line) => logs.push(line),
    });
    url = emu.url;
    close = emu.close;
    sdk = new FiscalSDK({ host: url, timeout: 5000 });
  });

  afterAll(async () => {
    await close();
  });

  it("prints receipts over HTTP with incrementing ids and logs them", async () => {
    const first = await sdk.printReceipt({
      date: new Date(),
      billId: "100",
      articles: [article],
      paymentMethods: [{ type: "Gotovina", amount: 10 }],
    });
    const second = await sdk.printReceipt({
      date: new Date(),
      billId: "101",
      articles: [{ ...article, name: "Sok", price: 2.5, quantity: 2 }],
      paymentMethods: [{ type: "Kartica", amount: 5 }],
    });

    expect(first.id).toBe(1);
    expect(first.amount).toBe(10);
    expect(second.id).toBe(2);
    expect(second.amount).toBe(5);
    expect(logs.some((l) => l.includes("FISCAL RECEIPT #1"))).toBe(true);
    expect(logs.some((l) => l.includes("FISCAL RECEIPT #2"))).toBe(true);
    expect(logs.some((l) => l.includes("Zvake"))).toBe(true);
    expect(logs.some((l) => l.includes("Sok"))).toBe(true);
  });

  it("exposes printed totals via getBasicInfo", async () => {
    const info = await sdk.getBasicInfo();
    expect(info.ibfm).toBe("EMU00001");
    expect(info.firstBF).toBe(1);
    expect(info.lastBF).toBe(2);
    expect(info.cash).toBe(10);
    expect(info.card).toBe(5);
    expect(info.zNumber).toBe(1);
    expect(info.taxE).toBe(1700);
  });

  it("returns a new reclamation id from BrojReklamiranogRacuna", async () => {
    const result = await sdk.reclaimReceipt({
      originalReceiptId: 1,
      articles: [article],
      refunds: [{ type: "Gotovina", amount: 10 }],
    });
    expect(result.id).toBe(1);
    expect(logs.some((l) => l.includes("RECLAMATION #1"))).toBe(true);
  });

  it("closes Z on printDailyReport and serves it back via getDailyReport", async () => {
    await sdk.printDailyReport();
    const historical = await sdk.getDailyReport({ brojDI: 1 });
    expect(historical.zNumber).toBe(1);
    expect(historical.lastBF).toBe(2);
    expect(historical.saleTE).toBeGreaterThan(0);

    const current = await sdk.getBasicInfo();
    expect(current.zNumber).toBe(2);
    expect(current.lastBF).toBe(0);
  });

  it("logs display writes and till movements", async () => {
    await sdk.writeToDisplay({ line1: "HELLO", line2: "WORLD" });
    await sdk.depositMoney({ type: "Virman", amount: 100 });
    await sdk.printOverview();
    await sdk.printPeriodicalReport({
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-01-31"),
    });

    expect(logs.some((l) => l.includes("[DISPLAY]") && l.includes("HELLO"))).toBe(
      true
    );
    expect(logs.some((l) => l.includes("[TILL IN]") && l.includes("Virman"))).toBe(
      true
    );
    expect(logs.some((l) => l.includes("X-REPORT"))).toBe(true);
    expect(logs.some((l) => l.includes("[PERIODIC REPORT]"))).toBe(true);
  });

  it("surfaces device errors as FiscalError (invalid tax rate)", async () => {
    await expect(
      sdk.printReceipt({
        date: new Date(),
        billId: "x",
        articles: [{ ...article, rate: "E" }, { ...article, id: "9", rate: "Z" as any }],
        paymentMethods: [{ type: "Gotovina", amount: 10 }],
      })
    ).rejects.toThrow("ERROR_FISCAL_INVALID_ITEM_TAX");
  });
});

describe("emulator XML request parsing", () => {
  it("reads articles and payments out of a RacunZahtjev", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<RacunZahtjev>
  <BrojZahtjeva>7</BrojZahtjeva>
  <NoviObjekat>
    <BrojRacuna>42</BrojRacuna>
    <StavkeRacuna>
      <RacunStavka>
        <artikal><Sifra>1</Sifra><Naziv>Zvake</Naziv><Cijena>10</Cijena><Stopa>E</Stopa></artikal>
        <Kolicina>2</Kolicina>
        <Rabat>0</Rabat>
      </RacunStavka>
    </StavkeRacuna>
    <VrstePlacanja>
      <VrstaPlacanja><Oznaka>Gotovina</Oznaka><Iznos>20</Iznos></VrstaPlacanja>
    </VrstePlacanja>
  </NoviObjekat>
</RacunZahtjev>`;
    const parsed = parseReceiptRequest(xml);
    expect(parsed.billId).toBe("42");
    expect(parsed.articles).toEqual([
      {
        id: "1",
        name: "Zvake",
        unit: undefined,
        price: 10,
        rate: "E",
        quantity: 2,
        discount: 0,
      },
    ]);
    expect(parsed.payments).toEqual([{ type: "Gotovina", amount: 20 }]);
  });
});
