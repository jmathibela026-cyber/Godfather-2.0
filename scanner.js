/* ==========================================================================
   GODFATHER — Signal Engines
   Three independent momentum-indicator engines, selectable via the
   Strategy chips. Each implements a standard technical indicator and a
   momentum-continuation entry rule (enter as momentum resumes out of an
   extreme, rather than trying to pick the exact top/bottom):

     - RSI Momentum: enters when RSI(14) crosses back out of oversold
       (<30) or overbought (>70).
     - Moving Averages (13/50/100 EMA): enters on a pullback to the 13
       EMA while the three EMAs are stacked in trend order.
     - Stochastic Oscillator: enters on a %K/%D crossover out of the
       oversold (<20) or overbought (>80) zone.

   All three share the same helpers below and return the same shape:
   { verdict: 'buy'|'sell', entry, sl, tp, confidence, strategy, reasoning }
   or { verdict: 'wait', reason }.

   Candle format: { t: timestamp, o, h, l, c }
   ========================================================================== */

// ---- Shared math helpers ----

function calcEMA(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      out[i] = prev;
      continue;
    }
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function calcRSI(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function smoothSeries(arr, period) {
  const out = new Array(arr.length).fill(null);
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) continue;
    const window = arr.slice(i - period + 1, i + 1);
    if (window.some(v => v == null)) continue;
    out[i] = window.reduce((a, b) => a + b, 0) / period;
  }
  return out;
}

function calcStochastic(candles, kPeriod = 14, dPeriod = 3, smoothK = 3) {
  const rawK = new Array(candles.length).fill(null);
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const window = candles.slice(i - kPeriod + 1, i + 1);
    const highestHigh = Math.max(...window.map(c => c.h));
    const lowestLow = Math.min(...window.map(c => c.l));
    const close = candles[i].c;
    rawK[i] = highestHigh === lowestLow ? 50 : ((close - lowestLow) / (highestHigh - lowestLow)) * 100;
  }
  const k = smoothSeries(rawK, smoothK);
  const d = smoothSeries(k, dPeriod);
  return { k, d };
}

function findSwings(candles, lookback = 2) {
  const swingHighs = [];
  const swingLows = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const c = candles[i];
    if (c.h === Math.max(...window.map(w => w.h))) swingHighs.push({ i, price: c.h });
    if (c.l === Math.min(...window.map(w => w.l))) swingLows.push({ i, price: c.l });
  }
  return { swingHighs, swingLows };
}

// SL at the nearest protective swing point, TP at the next opposing swing
// (falling back to a 2R target when no swing is available in that direction).
function buildTradeLevels(candles, direction, entry) {
  const { swingHighs, swingLows } = findSwings(candles);
  const buffer = entry * 0.0006;
  let sl, tp;

  if (direction === 'buy') {
    const belowLows = swingLows.map(s => s.price).filter(p => p < entry);
    const nearestLow = belowLows.length ? Math.max(...belowLows) : entry * 0.995;
    sl = nearestLow - buffer;
    const aboveHighs = swingHighs.map(s => s.price).filter(p => p > entry);
    tp = aboveHighs.length ? Math.min(...aboveHighs) : entry + (entry - sl) * 2;
  } else {
    const aboveHighs = swingHighs.map(s => s.price).filter(p => p > entry);
    const nearestHigh = aboveHighs.length ? Math.min(...aboveHighs) : entry * 1.005;
    sl = nearestHigh + buffer;
    const belowLows = swingLows.map(s => s.price).filter(p => p < entry);
    tp = belowLows.length ? Math.max(...belowLows) : entry - (sl - entry) * 2;
  }

  // Guarantee at least a ~1:1.2 reward:risk, extending TP if a nearby swing undercuts it
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (reward < risk * 1.2) {
    tp = direction === 'buy' ? entry + risk * 2 : entry - risk * 2;
  }
  return { sl, tp };
}

// Soft higher-timeframe trend read (price vs its 50 EMA) — used as a
// confidence adjustment, not a hard filter, since RSI/Stochastic are
// reversal-style signals that often trade counter to the HTF trend.
function htfTrendBias(htfCandles) {
  const closes = htfCandles.map(c => c.c);
  const emaArr = calcEMA(closes, Math.min(50, Math.max(5, closes.length - 1)));
  const lastEma = emaArr[emaArr.length - 1];
  const lastPrice = closes[closes.length - 1];
  if (lastEma == null) return null;
  return lastPrice > lastEma ? 'buy' : 'sell';
}

function clampConfidence(v) {
  return Math.max(40, Math.min(95, Math.round(v)));
}

function waitResult(reason) {
  return { verdict: 'wait', reason };
}

/* ==========================================================================
   RSI MOMENTUM
   ========================================================================== */
const RSIEngine = (() => {
  const PERIOD = 14;

  function analyze(htfCandles, ltfCandles) {
    const closes = ltfCandles.map(c => c.c);
    const rsiArr = calcRSI(closes, PERIOD);
    const n = rsiArr.length;
    if (n < 2 || rsiArr[n - 1] == null || rsiArr[n - 2] == null) {
      return waitResult('Not enough candles to compute RSI(14) yet.');
    }

    const prev = rsiArr[n - 2];
    const curr = rsiArr[n - 1];
    const entry = closes[n - 1];

    let direction = null;
    if (prev < 30 && curr >= 30) direction = 'buy';
    else if (prev > 70 && curr <= 70) direction = 'sell';

    if (!direction) {
      return waitResult(`RSI(14) is at ${curr.toFixed(1)} — waiting for it to cross back out of oversold (<30) or overbought (>70).`);
    }

    const { sl, tp } = buildTradeLevels(ltfCandles, direction, entry);
    const bias = htfTrendBias(htfCandles);
    let confidence = 55 + Math.min(Math.abs(50 - prev) / 2, 20);
    confidence += bias === direction ? 8 : -4;
    confidence = clampConfidence(confidence);

    const action = direction === 'buy' ? 'BUY' : 'SELL';
    const zone = direction === 'buy' ? 'oversold' : 'overbought';
    const trendNote = bias === direction
      ? 'This lines up with the higher-timeframe trend.'
      : 'Note this runs counter to the higher-timeframe trend, so treat it as a bounce, not a trend call.';
    const reasoning = `RSI(14) just crossed back out of ${zone} territory (${prev.toFixed(1)} → ${curr.toFixed(1)}), ` +
      `signaling a momentum ${direction === 'buy' ? 'recovery' : 'fade'} rather than an attempt to pick the exact ` +
      `${direction === 'buy' ? 'bottom' : 'top'}. ${trendNote} Looking for a ${action} near ${entry.toFixed(2)}, ` +
      `stop beyond the recent swing at ${sl.toFixed(2)}, targeting ${tp.toFixed(2)}.`;

    return { verdict: direction, entry, sl, tp, confidence, strategy: 'RSI Momentum', reasoning };
  }

  return { analyze };
})();
window.RSIEngine = RSIEngine;

/* ==========================================================================
   MOVING AVERAGES (13 / 50 / 100 EMA)
   ========================================================================== */
const MovingAveragesEngine = (() => {
  function analyze(htfCandles, ltfCandles) {
    const closes = ltfCandles.map(c => c.c);
    if (closes.length < 100) {
      return waitResult('Not enough candles to compute the 13/50/100 EMA stack yet.');
    }

    const ema13 = calcEMA(closes, 13);
    const ema50 = calcEMA(closes, 50);
    const ema100 = calcEMA(closes, 100);
    const n = closes.length;
    const e13 = ema13[n - 1], e50 = ema50[n - 1], e100 = ema100[n - 1];
    if (e13 == null || e50 == null || e100 == null) {
      return waitResult('Not enough candles to compute the 13/50/100 EMA stack yet.');
    }

    const last = ltfCandles[n - 1];
    const bullishStack = e13 > e50 && e50 > e100;
    const bearishStack = e13 < e50 && e50 < e100;

    let direction = null;
    // Entry: price pulls back to touch the 13 EMA, then closes back on the trend side of it.
    if (bullishStack && last.l <= e13 && last.c > e13) direction = 'buy';
    if (bearishStack && last.h >= e13 && last.c < e13) direction = 'sell';

    if (!direction) {
      const state = bullishStack ? 'stacked bullish (13 > 50 > 100)' : bearishStack ? 'stacked bearish (13 < 50 < 100)' : 'not aligned in trend order';
      return waitResult(`EMAs are ${state} — waiting for a pullback to the 13 EMA with a continuation candle.`);
    }

    const entry = last.c;
    const buffer = entry * 0.0006;
    // Trend invalidation sits beyond the 50 EMA rather than a raw swing point.
    const sl = direction === 'buy' ? e50 - buffer : e50 + buffer;
    const { tp } = buildTradeLevels(ltfCandles, direction, entry);

    const separation = Math.abs(e13 - e100) / entry;
    let confidence = 55 + Math.min(separation * 400, 20);
    confidence = clampConfidence(confidence);

    const dir = direction === 'buy' ? 'bullish' : 'bearish';
    const action = direction === 'buy' ? 'BUY' : 'SELL';
    const reasoning = `The 13/50/100 EMAs are stacked ${dir} and price just pulled back into the 13 EMA ` +
      `(${e13.toFixed(2)}) and closed back on the trend side — a continuation signal rather than a reversal. ` +
      `Looking for a ${action} near ${entry.toFixed(2)}, stop beyond the 50 EMA at ${sl.toFixed(2)}, targeting ${tp.toFixed(2)}.`;

    return { verdict: direction, entry, sl, tp, confidence, strategy: 'Moving Averages', reasoning };
  }

  return { analyze };
})();
window.MovingAveragesEngine = MovingAveragesEngine;

/* ==========================================================================
   STOCHASTIC OSCILLATOR
   ========================================================================== */
const StochasticEngine = (() => {
  function analyze(htfCandles, ltfCandles) {
    const { k, d } = calcStochastic(ltfCandles, 14, 3, 3);
    const n = k.length;
    if (n < 2 || k[n - 1] == null || d[n - 1] == null || k[n - 2] == null || d[n - 2] == null) {
      return waitResult('Not enough candles to compute the Stochastic Oscillator yet.');
    }

    const prevK = k[n - 2], prevD = d[n - 2], curK = k[n - 1], curD = d[n - 1];
    const entry = ltfCandles[n - 1].c;

    const wasOversold = prevK < 20 && prevD < 20;
    const wasOverbought = prevK > 80 && prevD > 80;
    const crossedUp = prevK <= prevD && curK > curD;
    const crossedDown = prevK >= prevD && curK < curD;

    let direction = null;
    if (wasOversold && crossedUp) direction = 'buy';
    else if (wasOverbought && crossedDown) direction = 'sell';

    if (!direction) {
      return waitResult(`Stochastic %K/%D at ${curK.toFixed(1)}/${curD.toFixed(1)} — waiting for a crossover out of oversold (<20) or overbought (>80).`);
    }

    const { sl, tp } = buildTradeLevels(ltfCandles, direction, entry);
    const bias = htfTrendBias(htfCandles);
    let confidence = 55 + (wasOversold || wasOverbought ? 15 : 0);
    confidence += bias === direction ? 8 : -4;
    confidence = clampConfidence(confidence);

    const action = direction === 'buy' ? 'BUY' : 'SELL';
    const zone = direction === 'buy' ? 'oversold' : 'overbought';
    const trendNote = bias === direction
      ? 'This lines up with the higher-timeframe trend.'
      : 'Note this runs counter to the higher-timeframe trend, so treat it as a bounce, not a trend call.';
    const reasoning = `%K crossed ${direction === 'buy' ? 'above' : 'below'} %D (${curK.toFixed(1)}/${curD.toFixed(1)}) ` +
      `coming out of the ${zone} zone, signaling a momentum shift rather than continuation of the extreme. ` +
      `${trendNote} Looking for a ${action} near ${entry.toFixed(2)}, stop beyond the recent swing at ${sl.toFixed(2)}, ` +
      `targeting ${tp.toFixed(2)}.`;

    return { verdict: direction, entry, sl, tp, confidence, strategy: 'Stochastic Oscillator', reasoning };
  }

  return { analyze };
})();
window.StochasticEngine = StochasticEngine;
