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
  it("prints a 58mm-style fiskalni račun", () => {
    const slip = formatReceipt(receipt, identity);
    expect(slip).toMatchSnapshot();
    expect(slip).toContain("FISKALNI RAČUN");
    expect(slip).toContain("IBFM: EMU00001");
    expect(slip).toContain("Zvake");
    expect(slip).toContain("UKUPNO");
    expect(slip).toContain("Gotovina");
    expect(slip).toContain("E 17%");
    expect(slip).toContain("Kupac");
    expect(slip).toContain("Tring d.o.o.");
    expect(slip).toContain("BF: 1");
    expect(slip).toContain("TESTNI REŽIM");
    expect(slip).toContain("fiskalni logo");
    expect(slip).toContain("MD5:");
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
    expect(slip).toContain("RBF: 1");
  });
});
