#!/usr/bin/env node
import { startEmulator } from "./server";

function printHelp(): void {
  console.log(`Usage: bh-fiscal-sdk emulator [--port 8085]

Run a local HTTP simulator of the TRING fiscal device.
Point FiscalSDK({ host }) at the printed URL.

Options:
  --port <n>   Listen port (default 8085, or PORT env)
  --help       Show this message
`);
}

function parsePort(argv: string[]): number {
  const flag = argv.find((a) => a.startsWith("--port="));
  if (flag) return Number(flag.slice("--port=".length));
  const idx = argv.indexOf("--port");
  if (idx !== -1 && argv[idx + 1]) return Number(argv[idx + 1]);
  if (process.env.PORT) return Number(process.env.PORT);
  return 8085;
}

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (argv[0] !== "emulator") {
  printHelp();
  process.exit(argv.length === 0 ? 0 : 1);
}

const port = parsePort(argv.slice(1));
if (!Number.isFinite(port) || port < 0) {
  console.error("Invalid --port");
  process.exit(1);
}

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
