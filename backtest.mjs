// Backtest harness for btc-cent-forecast-01 (practice data only).
// Slides a checkpoint t through each practice file (72h of 1-min closes),
// forecasts the close at t+240 with each candidate model using prices
// up to t only, and scores mean absolute error in cents.
// Usage: node backtest.mjs <input-dir> [step-minutes]
// No network, Node stdlib only. Deterministic.
"use strict";
import fs from "node:fs";
import path from "node:path";

const inputDir = process.argv[2] || ".";
const STEP = parseInt(process.argv[3] || "30", 10);
const HORIZON = 240; // minutes ahead

function median(xs) {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(xs) {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

// Candidate models. Each takes (p, t) where p is the price array and t the
// checkpoint index, and returns a forecast price for t + HORIZON.
const MODELS = {
  persist(p, t) {
    return p[t];
  },
  medRet24h(p, t) {
    return p[t] * (1 + medianRet(p, t, 1440));
  },
  medRet48h(p, t) {
    return p[t] * (1 + medianRet(p, t, 2880));
  },
  medRet72h(p, t) {
    return p[t] * (1 + medianRet(p, t, 4320));
  },
  medRet48hHalf(p, t) {
    return p[t] * (1 + 0.5 * medianRet(p, t, 2880));
  },
  medRet24hHalf(p, t) {
    return p[t] * (1 + 0.5 * medianRet(p, t, 1440));
  },
  mom1h25(p, t) {
    return p[t] * (1 + 0.25 * (p[t] / p[t - 60] - 1));
  },
  mom1h50(p, t) {
    return p[t] * (1 + 0.5 * (p[t] / p[t - 60] - 1));
  },
  mom4h25(p, t) {
    return p[t] * (1 + 0.25 * (p[t] / p[t - 240] - 1));
  },
  mom4h50(p, t) {
    return p[t] * (1 + 0.5 * (p[t] / p[t - 240] - 1));
  },
  meanRev6h25(p, t) {
    const ma = mean(p.slice(t - 360 + 1, t + 1));
    return p[t] * (1 - 0.25 * (p[t] / ma - 1));
  },
  meanRev12h25(p, t) {
    const ma = mean(p.slice(t - 720 + 1, t + 1));
    return p[t] * (1 - 0.25 * (p[t] / ma - 1));
  },
  meanRev12h50(p, t) {
    const ma = mean(p.slice(t - 720 + 1, t + 1));
    return p[t] * (1 - 0.5 * (p[t] / ma - 1));
  },
  med1hScaled24h(p, t) {
    // median 1h return over last 24h, scaled to 4h
    const rs = [];
    for (let i = Math.max(60, t - 1440 + 60); i <= t; i++) rs.push(p[i] / p[i - 60] - 1);
    return p[t] * (1 + 4 * median(rs));
  },
  // --- mean-reversion grid: revert toward the mean of the last W minutes ---
  rev1h20(p, t) { return revToMean(p, t, 60, 0.2); },
  rev2h20(p, t) { return revToMean(p, t, 120, 0.2); },
  rev3h20(p, t) { return revToMean(p, t, 180, 0.2); },
  rev4h20(p, t) { return revToMean(p, t, 240, 0.2); },
  rev6h15(p, t) { return revToMean(p, t, 360, 0.15); },
  rev6h20(p, t) { return revToMean(p, t, 360, 0.2); },
  rev6h30(p, t) { return revToMean(p, t, 360, 0.3); },
  rev6h40(p, t) { return revToMean(p, t, 360, 0.4); },
  rev8h25(p, t) { return revToMean(p, t, 480, 0.25); },
  rev12h15(p, t) { return revToMean(p, t, 720, 0.15); },
  rev12h20(p, t) { return revToMean(p, t, 720, 0.2); },
  revMed6h25(p, t) {
    // revert toward the MEDIAN of the last 6h (robust to jumps)
    const med = median(p.slice(t - 360 + 1, t + 1));
    return p[t] * (1 - 0.25 * (p[t] / med - 1));
  },
  revMed3h25(p, t) {
    const med = median(p.slice(t - 180 + 1, t + 1));
    return p[t] * (1 - 0.25 * (p[t] / med - 1));
  },
  revEma6h25(p, t) {
    // revert toward an EMA with ~6h half-life (alpha = 1 - 0.5^(1/360))
    return revToEma(p, t, 360, 0.25);
  },
  revEma3h25(p, t) { return revToEma(p, t, 180, 0.25); },
  revEma4h25(p, t) { return revToEma(p, t, 240, 0.25); },
  revEma8h25(p, t) { return revToEma(p, t, 480, 0.25); },
  revEma12h25(p, t) { return revToEma(p, t, 720, 0.25); },
  revEma6h20(p, t) { return revToEma(p, t, 360, 0.2); },
  revEma6h30(p, t) { return revToEma(p, t, 360, 0.3); },
  revEma6h40(p, t) { return revToEma(p, t, 360, 0.4); },
  revEma4h30(p, t) { return revToEma(p, t, 240, 0.3); },
  revEma8h30(p, t) { return revToEma(p, t, 480, 0.3); },
  revBlend(p, t) {
    // average of EMA-6h reversion and SMA-6h reversion
    return (revToEma(p, t, 360, 0.25) + revToMean(p, t, 360, 0.25)) / 2;
  },
  rev10m30(p, t) { return revToMean(p, t, 10, 0.3); },
  rev30m30(p, t) { return revToMean(p, t, 30, 0.3); },
  rev60m30(p, t) { return revToMean(p, t, 60, 0.3); },
  sma6h_k50(p, t) { return revToMean(p, t, 360, 0.5); },
  sma6h_k40(p, t) { return revToMean(p, t, 360, 0.4); },
  ensMedMom(p, t) {
    // average of median-4h-return (48h) and 4h momentum (0.25 shrink)
    const a = p[t] * (1 + medianRet(p, t, 2880));
    const b = p[t] * (1 + 0.25 * (p[t] / p[t - 240] - 1));
    return (a + b) / 2;
  },
  ensMedMomRev(p, t) {
    const a = p[t] * (1 + medianRet(p, t, 2880));
    const b = p[t] * (1 + 0.25 * (p[t] / p[t - 240] - 1));
    const ma = mean(p.slice(t - 720 + 1, t + 1));
    const c = p[t] * (1 - 0.25 * (p[t] / ma - 1));
    return (a + b + c) / 3;
  },
};

// Median of the 4h simple returns r_i = p[i]/p[i-240]-1 over the last W
// minutes ending at t (needs i >= 240).
function medianRet(p, t, W) {
  const lo = Math.max(240, t - W + 1);
  const rs = [];
  for (let i = lo; i <= t; i++) rs.push(p[i] / p[i - 240] - 1);
  return median(rs);
}

// Mean-reversion forecast: pull the last price k of the way back toward
// the mean of the last W minutes.
function revToMean(p, t, W, k) {
  const ma = mean(p.slice(Math.max(0, t - W + 1), t + 1));
  return p[t] * (1 - k * (p[t] / ma - 1));
}

// Mean-reversion toward an EMA with the given half-life in minutes,
// computed over the last 24h of prices (seeded at the window start).
function revToEma(p, t, halfLifeMin, k) {
  const alpha = 1 - Math.pow(0.5, 1 / halfLifeMin);
  const start = Math.max(0, t - 1440);
  let ema = p[start];
  for (let i = start + 1; i <= t; i++) ema = alpha * p[i] + (1 - alpha) * ema;
  return p[t] * (1 - k * (p[t] / ema - 1));
}

function main() {
  const ids = ["p00", "p01", "p02", "p03", "p04", "p05"];
  const names = Object.keys(MODELS);
  const totals = {}; // model -> {err, n, wins}
  for (const n of names) totals[n] = { err: 0, n: 0, wins: 0 };
  const perFile = {}; // file -> model -> {err, n}

  for (const id of ids) {
    const d = JSON.parse(fs.readFileSync(path.join(inputDir, id + ".in"), "utf8"));
    const p = d.markets[0].prices;
    const n = p.length;
    perFile[id] = {};
    for (const name of names) perFile[id][name] = { err: 0, n: 0 };
    for (let t = 720; t + HORIZON < n; t += STEP) {
      const y = p[t + HORIZON];
      for (const name of names) {
        const f = MODELS[name](p, t);
        const e = 100 * Math.abs(f - y);
        totals[name].err += e;
        totals[name].n += 1;
        perFile[id][name].err += e;
        perFile[id][name].n += 1;
        if (name !== "persist" && e < 100 * Math.abs(p[t] - y)) totals[name].wins += 1;
      }
    }
  }

  const rows = names.map((name) => {
    const t = totals[name];
    return {
      model: name,
      mae: t.err / t.n,
      n: t.n,
      winRate: name === "persist" ? null : t.wins / t.n,
      perFile: ids.map((id) => (perFile[id][name].err / perFile[id][name].n).toFixed(0)).join("/"),
    };
  });
  rows.sort((a, b) => a.mae - b.mae);
  const base = totals.persist.err / totals.persist.n;
  console.log(`backtest: step=${STEP}min, checkpoints per file ~${totals.persist.n / 6}`);
  console.log(`persistence MAE = ${base.toFixed(2)} cents`);
  console.log("model            MAE(cents)  vsPersist  winRate   per-file MAE p00/p01/p02/p03/p04/p05");
  for (const r of rows) {
    const vs = ((r.mae / base - 1) * 100).toFixed(2);
    const wr = r.winRate === null ? "  -  " : (r.winRate * 100).toFixed(1) + "%";
    console.log(
      `${r.model.padEnd(17)} ${r.mae.toFixed(2).padStart(11)}  ${vs.padStart(7)}%  ${wr.padStart(6)}  ${r.perFile}`
    );
  }
}

main();
