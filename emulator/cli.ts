#!/usr/bin/env node
import { startEmulator } from "./server";

function parsePort(argv: string[]): number {
  const flag = argv.find((a) => a.startsWith("--port="));
  if (flag) return Number(flag.slice("--port=".length));
  const idx = argv.indexOf("--port");
  if (idx !== -1 && argv[idx + 1]) return Number(argv[idx + 1]);
  if (process.env.PORT) return Number(process.env.PORT);
  return 8085;
}

const port = parsePort(process.argv.slice(2));

startEmulator({ port })
  .then((emu) => {
    console.log(`TRING fiscal emulator listening on ${emu.url}`);
    console.log(`Point the SDK at it:`);
    console.log(`  new FiscalSDK({ host: "${emu.url}" })`);
    console.log("Receipts are stored in memory and logged below as they print.");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
