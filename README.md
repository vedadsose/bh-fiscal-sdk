# BH Fiscal SDK

Biblioteka za komunikaciju sa TRING fiskalnim printerom.

## Instalacija

```bash
npm install bh-fiscal-sdk
```

## Inicijalizacija

```typescript
import FiscalSDK from "bh-fiscal-sdk";

const sdk = new FiscalSDK({
  host: "http://localhost:8085", // URL fiskalnog printera
});
```

## Dostupne metode

### printReceipt - Štampanje fiskalnog računa

Metoda za štampanje fiskalnog računa. Vraća Promise koji sadrži informacije o odštampanom računu.

```typescript
const response = await sdk.printReceipt({
  date: new Date(),
  billId: "1233",
  paymentMethods: [
    {
      /*
        Podržani tipovi:
          - Virman
          - Gotovina
          - Kartica
          - Cek
      */
      type: "Virman",
      amount: 0.50,
    },
  ],
  articles: [
    {
      id: "1",
      name: "Cunga lunga",
      price: 0.50,
      quantity: 2,
      discount: 0,
      /*
        E - opšta stopa (17%)
        K - stopa za artikle oslobođenje plaćanja PDV (0%)
        A - za korisnike koji nisu u sistemu PDV (0%)
      */
      rate: "E"
    }
  ],
});

// Rezultat:
// {
//   id: 123,              // Broj fiskalnog računa
//   date: "2024-01-20",   // Datum računa
//   time: "14:30:00",     // Vrijeme računa
//   amount: 5.00          // Ukupan iznos računa
// }
```

### printPeriodicalReport - Štampanje periodičnog izvještaja

Metoda za štampanje izvještaja za određeni vremenski period.

```typescript
await sdk.printPeriodicalReport({
  startDate: new Date("2024-01-01"),
  endDate: new Date("2024-01-31"),
});
```

### printDailyReport - Štampanje dnevnog izvještaja

Metoda za štampanje dnevnog izvještaja. Ne zahtijeva parametre.

```typescript
await sdk.printDailyReport();
```

### printOverview - Štampanje presjeka stanja

Metoda za štampanje trenutnog presjeka stanja. Ne zahtijeva parametre.

```typescript
await sdk.printOverview();
```

## Emulator fiskalnog printera

HTTP simulator TRING kase za lokalni razvoj — ne zamjenjuje fizički uređaj. Nije poseban npm paket; CLI je isti `bh-fiscal-sdk` paket:

```bash
npx bh-fiscal-sdk emulator
# port: --port 9090   ili   PORT=9090
```

Default je `http://127.0.0.1:8085` (isti host kao u primjeru iznad). SDK se samo uperuje na emulator:

```typescript
const sdk = new FiscalSDK({ host: "http://127.0.0.1:8085" });
await sdk.printReceipt({ /* ... */ });
```

Programski (testovi, skripte):

```typescript
import { startEmulator } from "bh-fiscal-sdk/emulator";

const emu = await startEmulator({ port: 0 });
const sdk = new FiscalSDK({ host: emu.url });
```

Što emulator radi:

- Govori isti XML-over-HTTP protokol kao kasa (`POST /stampatifiskalniracun`, `/oi`, …)
- Drži račune i reklamacije **u memoriji** (gube se na restartu)
- Vraća fiskalni broj **ASC, od 1** (`1, 2, 3, …`); reklamacije imaju svoj brojač
- Svaki `printReceipt` ispisuje **termalni fiskalni račun** u konzolu (58mm / 32 znaka: zaglavlje, stavke, porez, IBFM, TESTNI REŽIM)
- `getBasicInfo` / `getDailyReport` refleksuju odštampano; dnevni izvještaj zatvara Z period

## Obrada grešaka

Sve metode vraćaju Promise i mogu baciti grešku u slučaju problema sa komunikacijom ili drugim greškama. Preporučuje se korištenje try-catch bloka:

```typescript
try {
  await sdk.printReceipt({
    // ... parametri računa
  });
} catch (error) {
  console.error("Greška prilikom štampanja računa:", error.message);
}
```
