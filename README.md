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
const result = await sdk.printReceipt({
  date: new Date(),
  items: [
    {
      name: "Coca Cola",
      quantity: 2,
      price: 2.5,
      vatRate: 17,
    },
  ],
  paymentType: "GOTOVINA",
  operator: "Operater 1",
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
