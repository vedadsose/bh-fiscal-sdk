export interface SDKConfig {
  host: string;
}

interface ReceiptBuyer {
  id: string;
  name: string;
  address: string;
  zipCode: string;
  city: string;
}

/*
  E - opšta stopa (17%)
  K - stopa za artikle oslobođenje plaćanja PDV (0%)
  A - za korisnike koji nisu u sistemu PDV (0%)
*/
type ArticleRate = "E" | "K" | "A";
interface Article {
  id: string;
  name: string;
  unit?: string; // max 2 chars
  price: number;
  rate: ArticleRate;
  quantity: number;
  discount: number;
}

type PaymentMethodType = "Gotovina" | "Virman" | "Cek" | "Kartica";
interface PaymentMethod {
  type: PaymentMethodType;
  amount: number;
}

export interface PrintReceiptParams {
  date: Date;
  billId: string;
  buyer?: ReceiptBuyer;
  articles: Article[];
  paymentMethods: PaymentMethod[];
}

export interface PrintPeriodicalReportParams {
  startDate: Date;
  endDate: Date;
}
