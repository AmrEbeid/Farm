#!/usr/bin/env node
import fs from "node:fs";
import { extractMarketingSource } from "../lib/marketing/source-extractor.ts";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name} path`);
  return process.argv[index + 1];
}

const html = fs.readFileSync(argument("--html"), "utf8");
const state = fs.readFileSync(argument("--state"), "utf8");
process.stdout.write(`${JSON.stringify(extractMarketingSource(html, state), null, 2)}\n`);
