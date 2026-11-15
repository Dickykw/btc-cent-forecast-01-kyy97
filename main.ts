// btc-cent-forecast-01: forecast BTC/USDC 240 minutes ahead.
// Model: mean-reversion toward the 6-hour simple moving average.
//   forecast = last * (1 - 0.5 * (last / SMA6h - 1))
// Rationale (backtested on the 6 practice files): 4h BTC returns are
// close to unpredictable, so every momentum/trend extrapolation tested
// (median 4h return, 1h/4h momentum, scaled 1h returns) scored WORSE
// than persistence, while pulling the last price halfway back toward
// its 6h average beat persistence on BOTH validations:
//   - dense sliding backtest, 2016 checkpoints (step 10 min):
//     MAE 37,363.65 vs persistence 38,623.47 cents (-3.26%),
//     winning in all six practice files;
//   - the 6 official practice checkpoints (p00-p04, answers known):
//     MAE 46,255.21 vs persistence 47,054.66 cents (-1.70%).
// A slower EMA anchor (12h half-life) looked better on the dense
// backtest alone (-5.6%) but LOST on the official cases (+3.15%):
// it fights a sustained trend too hard. The 6h SMA follows the
// trend faster, so it corrects short-term overshoot / pool
// microstructure noise without betting against a real move. K = 0.5
// is a smooth optimum (K 0.4 and 0.6 also win on both validations;
// K 0.7 fails), and the 6h window beats 5h/7h/8h on the official
// cases. No trend term is used: none helped.
// Node 22, stdlib only, no network, fully deterministic.
import fs from "node:fs";
import path from "node:path";

const inputDir = process.env.MAKEFUN_INPUT_DIR || "/input";
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";

// Model parameters (chosen on the dual-validation plateau).
const WINDOW_MIN = 360; // 6 hours of 1-minute closes
const K = 0.5; // fraction of the deviation from the mean to revert

function forecast(prices: number[]): number {
  const n = prices.length;
  const last = prices[n - 1];
  if (n < 2 || !(last > 0)) return last;
  const start = Math.max(0, n - WINDOW_MIN);
  let sum = 0;
  for (let i = start; i < n; i++) sum += prices[i];
  const mean = sum / (n - start);
  if (!(mean > 0)) return last;
  const f = last * (1 - K * (last / mean - 1));
  if (!Number.isFinite(f) || f <= 0) return last;
  return f;
}

function main(): void {
  fs.mkdirSync(outputDir, { recursive: true });
  const files = fs
    .readdirSync(inputDir)
    .filter((f) => f.endsWith(".in"))
    .sort();
  for (const file of files) {
    const raw = fs.readFileSync(path.join(inputDir, file), "utf8");
    const c = JSON.parse(raw);
    const prices: number[] = c.markets[0].prices;
    const price = forecast(prices);
    const out = { forecasts: [{ case: c.case, price }] };
    const id = path.basename(file, ".in");
    fs.writeFileSync(path.join(outputDir, id + ".out"), JSON.stringify(out));
  }
}

main();
