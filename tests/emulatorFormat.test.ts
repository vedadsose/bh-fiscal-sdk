import { formatReceipt, formatReclamation } from "../emulator/format";
import { StoredReceipt, StoredReclamation } from "../emulator/device";

const identity = { ibfm: "EMU00001" };

const receipt: StoredReceipt = {
  id: 1,
  billId: "100",
  date: new Date(2026, 7, 31, 11, 32, 1),
  amount: 10,
  articles: [
    {
      id: "1",
      name: "Zvake",
      price: 10,
      rate: "E",
      quantity: 1,
      discount: 0,
      gross: 10,
      net: 8.55,
      vat: 1.45,
    },
  ],
  payments: [{ type: "Gotovina", amount: 10 }],
  buyer: {
    id: "1234567890123",
    name: "Tring d.o.o.",
    address: "Lejlekuša bb",
    zipCode: "75320",
    city: "Gračanica",
  },
  reclaimed: false,
};

describe("thermal receipt slip", () => {
  it("prints a Tring-style fiskalni račun", () => {
    const slip = formatReceipt(receipt, identity);
    expect(slip).toMatchSnapshot();
    expect(slip).toContain("FISKALNI RAČUN");
    expect(slip).toContain("IBFM: EMU00001");
    expect(slip).toContain("Zvake");
    expect(slip).toContain("TOTAL");
    expect(slip).toContain("UPLAĆENO");
    expect(slip).toContain("Gotovina");
    expect(slip).toContain("POVRAT");
    expect(slip).toContain("VA 17,00%");
    expect(slip).toContain("OSN. E");
    expect(slip).toContain("PDV E");
    expect(slip).toContain("Tring d.o.o.");
    expect(slip).toContain("BF: 1");
    expect(slip).toContain("KASA 01");
    expect(slip).toContain("Kasir:");
    expect(slip).toContain("FBIH");
    expect(slip).toMatch(/[0-9a-f]{32}/);
    expect(slip).toContain("10,00E");
    expect(slip).toContain("1,000x");
  });

  it("matches the real slip item/tax/pay block (espresso-style)", () => {
    const coffee: StoredReceipt = {
      id: 26599,
      date: new Date(2026, 7, 31, 10, 41, 0),
      amount: 6,
      articles: [
        {
          id: "1",
          name: "Espresso kafa",
          unit: "KOM",
          price: 3,
          rate: "A",
          quantity: 2,
          discount: 0,
          gross: 6,
          net: 6,
          vat: 0,
        },
      ],
      payments: [{ type: "Gotovina", amount: 6 }],
      reclaimed: false,
    };
    const slip = formatReceipt(coffee, identity);
    expect(slip).toContain("Espresso kafa/KOM");
    expect(slip).toContain("2,000x  3,00");
    expect(slip).toContain("6,00A");
    expect(slip).toContain("VA 0,00%");
    expect(slip).toContain("OSN. A");
    expect(slip).toContain("BF: 26599");
    expect(slip).toContain("31.08.2026. 10:41");
  });

  it("prints a reklamirani račun with the original RF number", () => {
    const rec: StoredReclamation = {
      id: 1,
      originalReceiptId: 19,
      date: new Date(2026, 7, 31, 11, 40, 0),
      amount: 10,
      articles: receipt.articles,
      refunds: [{ type: "Gotovina", amount: 0 }],
      note: "Hvala",
    };
    const slip = formatReclamation(rec, identity);
    expect(slip).toContain("REKLAMIRANI RAČUN");
    expect(slip).toContain("RF: 19");
    expect(slip).toContain("BF: 1");
  });
});
