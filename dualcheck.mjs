// Dual validation: dense sliding backtest (step 30) AND the 6 official
// practice checkpoints (t = last index; answer = next file's last price,
// p05 excluded — its answer is the 06:00Z close, not in any file).
// A model must be good on BOTH to be trusted: the backtest is dense but
// overlapping, the 6 official cases are few but independent and are the
// house's own measured practice score.
import fs from "node:fs";
import path from "node:path";

const inputDir = process.argv[2];
const HORIZON = 240;

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(xs) {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}
function revToEma(p, t, halfLifeMin, k) {
  const alpha = 1 - Math.pow(0.5, 1 / halfLifeMin);
  const start = Math.max(0, t - 1440);
  let ema = p[start];
  for (let i = start + 1; i <= t; i++) ema = alpha * p[i] + (1 - alpha) * ema;
  return p[t] * (1 - k * (p[t] / ema - 1));
}
function revToMean(p, t, W, k) {
  const ma = mean(p.slice(Math.max(0, t - W + 1), t + 1));
  return p[t] * (1 - k * (p[t] / ma - 1));
}

const CANDS = {
  persist: (p, t) => p[t],
  ema12h_k10: (p, t) => revToEma(p, t, 720, 0.1),
  ema12h_k15: (p, t) => revToEma(p, t, 720, 0.15),
  ema12h_k20: (p, t) => revToEma(p, t, 720, 0.2),
  ema12h_k25: (p, t) => revToEma(p, t, 720, 0.25),
  ema12h_k30: (p, t) => revToEma(p, t, 720, 0.3),
  ema8h_k25: (p, t) => revToEma(p, t, 480, 0.25),
  ema6h_k25: (p, t) => revToEma(p, t, 360, 0.25),
  ema4h_k25: (p, t) => revToEma(p, t, 240, 0.25),
  ema3h_k25: (p, t) => revToEma(p, t, 180, 0.25),
  ema6h_k40: (p, t) => revToEma(p, t, 360, 0.4),
  sma6h_k25: (p, t) => revToMean(p, t, 360, 0.25),
  sma3h_k25: (p, t) => revToMean(p, t, 180, 0.25),
  sma4h_k25: (p, t) => revToMean(p, t, 240, 0.25),
  sma8h_k25: (p, t) => revToMean(p, t, 480, 0.25),
  sma6h_k15: (p, t) => revToMean(p, t, 360, 0.15),
  sma6h_k20: (p, t) => revToMean(p, t, 360, 0.2),
  sma6h_k30: (p, t) => revToMean(p, t, 360, 0.3),
  sma6h_k40: (p, t) => revToMean(p, t, 360, 0.4),
  sma6h_k50: (p, t) => revToMean(p, t, 360, 0.5),
  sma6h_k60: (p, t) => revToMean(p, t, 360, 0.6),
  sma6h_k70: (p, t) => revToMean(p, t, 360, 0.7),
  sma5h_k40: (p, t) => revToMean(p, t, 300, 0.4),
  sma7h_k40: (p, t) => revToMean(p, t, 420, 0.4),
  sma5h_k50: (p, t) => revToMean(p, t, 300, 0.5),
  sma7h_k50: (p, t) => revToMean(p, t, 420, 0.5),
  sma8h_k40: (p, t) => revToMean(p, t, 480, 0.4),
  sma4h_k30: (p, t) => revToMean(p, t, 240, 0.3),
  sma3h_k30: (p, t) => revToMean(p, t, 180, 0.3),
  sma2h_k30: (p, t) => revToMean(p, t, 120, 0.3),
  blendSmaEma: (p, t) => (revToMean(p, t, 360, 0.25) + revToEma(p, t, 720, 0.25)) / 2,
  blendSmaEma6: (p, t) => (revToMean(p, t, 360, 0.25) + revToEma(p, t, 360, 0.25)) / 2,
};

const ids = ["p00", "p01", "p02", "p03", "p04", "p05"];
const files = ids.map((id) =>
  JSON.parse(fs.readFileSync(path.join(inputDir, id + ".in"), "utf8"))
);
const names = Object.keys(CANDS);

// Dense backtest, step 30
const bt = {};
for (const n of names) bt[n] = { err: 0, cnt: 0 };
for (const d of files) {
  const p = d.markets[0].prices;
  for (let t = 720; t + HORIZON < p.length; t += 30) {
    const y = p[t + HORIZON];
    for (const n of names) {
      bt[n].err += 100 * Math.abs(CANDS[n](p, t) - y);
      bt[n].cnt += 1;
    }
  }
}
// Official 6-case checkpoints (p00-p04 only; p05 answer unknown)
const oc = {};
for (const n of names) oc[n] = { err: 0, cnt: 0 };
for (let i = 0; i < 5; i++) {
  const p = files[i].markets[0].prices;
  const ans = files[i + 1].markets[0].prices[4319];
  for (const n of names) {
    oc[n].err += 100 * Math.abs(CANDS[n](p, 4319) - ans);
    oc[n].cnt += 1;
  }
}

const baseBt = bt.persist.err / bt.persist.cnt;
const baseOc = oc.persist.err / oc.persist.cnt;
console.log("model          backtestMAE  vsPersist   official6MAE(p00-p04)  vsPersist");
for (const n of names) {
  const b = bt[n].err / bt[n].cnt;
  const o = oc[n].err / oc[n].cnt;
  console.log(
    `${n.padEnd(14)} ${b.toFixed(2).padStart(11)}  ${(((b / baseBt - 1) * 100).toFixed(2) + "%").padStart(7)}  ${o.toFixed(2).padStart(11)}  ${(((o / baseOc - 1) * 100).toFixed(2) + "%").padStart(7)}`
  );
}
console.log(`persistence backtest=${baseBt.toFixed(2)} official=${baseOc.toFixed(2)}`);
