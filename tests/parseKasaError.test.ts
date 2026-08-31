import { XMLParser } from "fast-xml-parser";
import { parseKasaError } from "../src/index";

const parse = (xml: string) => parseKasaError(new XMLParser().parse(xml));

// Real firmware: the human-readable reason sits in <Naziv> and a numeric
// status code in <Vrijednost>.
const CODED_ERROR = `<?xml version="1.0" encoding="utf-8"?>
<KasaOdgovor>
  <Odgovori>
    <Odgovor>
      <Naziv>Količina nije validna ! (0.001 - 999999.999)</Naziv>
      <Vrijednost xsi:type="xsd:int">408</Vrijednost>
    </Odgovor>
  </Odgovori>
  <VrstaOdgovora>Greska</VrstaOdgovora>
</KasaOdgovor>`;

// The other firmware convention: a command label in <Naziv> and the real error
// text in <Vrijednost> (non-numeric).
const TEXT_ERROR = `<?xml version="1.0" encoding="utf-8"?>
<KasaOdgovor>
  <Odgovori>
    <Odgovor>
      <Naziv>Štampanje fiskalnog računa</Naziv>
      <Vrijednost xsi:type="xsd:string">ERROR_FISCAL_INVALID_ITEM_TAX</Vrijednost>
    </Odgovor>
  </Odgovori>
  <VrstaOdgovora>Greska</VrstaOdgovora>
</KasaOdgovor>`;

const EMPTY_GRESKA = `<?xml version="1.0" encoding="utf-8"?>
<KasaOdgovor>
  <Odgovori />
  <VrstaOdgovora>Greska</VrstaOdgovora>
</KasaOdgovor>`;

describe("parseKasaError", () => {
  it("treats a numeric <Vrijednost> as the code and keeps <Naziv> as the reason", () => {
    expect(parse(CODED_ERROR)).toEqual({
      deviceMessage: "Količina nije validna ! (0.001 - 999999.999)",
      code: "408",
      responseType: "Greska",
    });
  });

  it("keeps a non-numeric <Vrijednost> in the message and reports no code", () => {
    expect(parse(TEXT_ERROR)).toEqual({
      deviceMessage: "Štampanje fiskalnog računa: ERROR_FISCAL_INVALID_ITEM_TAX",
      code: undefined,
      responseType: "Greska",
    });
  });

  it("returns only the response type when there are no Odgovor entries", () => {
    expect(parse(EMPTY_GRESKA)).toEqual({
      deviceMessage: undefined,
      code: undefined,
      responseType: "Greska",
    });
  });

  it("returns empty details for a response with no KasaOdgovor", () => {
    expect(parseKasaError({})).toEqual({
      deviceMessage: undefined,
      code: undefined,
      responseType: undefined,
    });
  });
});
