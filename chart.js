/* ==========================================================================
   GODFATHER — Candlestick chart renderer (canvas, no external deps)
   Renders OHLC candles and can overlay Entry / SL / TP lines from a signal.
   ========================================================================== */

class CandleChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.candles = [];
    this.overlay = null; // { entry, sl, tp, direction }
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = (rect.width || 640) * dpr;
    this.canvas.height = 420 * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width || 640;
    this.height = 420;
    this.render();
  }

  setCandles(candles) {
    this.candles = candles;
    this.render();
  }

  setOverlay(overlay) {
    this.overlay = overlay;
    this.render();
  }

  render() {
    const { ctx, width, height, candles } = this;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    if (!candles.length) return;

    const priceAxisW = 72;
    const plotW = width - priceAxisW;
    const padding = 16;

    const highs = candles.map(c => c.h);
    const lows = candles.map(c => c.l);
    let max = Math.max(...highs);
    let min = Math.min(...lows);
    if (this.overlay) {
      max = Math.max(max, this.overlay.sl, this.overlay.tp, this.overlay.entry);
      min = Math.min(min, this.overlay.sl, this.overlay.tp, this.overlay.entry);
    }
    const range = (max - min) || 1;
    const pad = range * 0.08;
    max += pad; min -= pad;

    const y = (price) => padding + (1 - (price - min) / (max - min)) * (height - padding * 2);
    const candleW = plotW / candles.length;

    candles.forEach((c, i) => {
      const cx = i * candleW + candleW / 2;
      const up = c.c >= c.o;
      ctx.strokeStyle = up ? '#0fbf5f' : '#e0334d';
      ctx.fillStyle = up ? '#0fbf5f' : '#e0334d';

      // wick
      ctx.beginPath();
      ctx.moveTo(cx, y(c.h));
      ctx.lineTo(cx, y(c.l));
      ctx.lineWidth = 1;
      ctx.stroke();

      // body
      const bodyTop = y(Math.max(c.o, c.c));
      const bodyBot = y(Math.min(c.o, c.c));
      const bw = Math.max(candleW * 0.55, 2);
      ctx.fillRect(cx - bw / 2, bodyTop, bw, Math.max(bodyBot - bodyTop, 1.5));
    });

    // price axis labels
    ctx.fillStyle = '#333';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    const steps = 6;
    for (let s = 0; s <= steps; s++) {
      const price = max - (s / steps) * (max - min);
      const yy = y(price);
      ctx.fillText(price.toFixed(2), plotW + 6, yy + 4);
      ctx.strokeStyle = 'rgba(0,0,0,0.05)';
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(plotW, yy);
      ctx.stroke();
    }

    // overlay: entry / SL / TP lines
    if (this.overlay) {
      const { entry, sl, tp, direction } = this.overlay;
      const lines = [
        { price: sl, color: '#e0334d', label: `SL ${sl.toFixed(2)}` },
        { price: entry, color: '#111111', label: `ENTRY ${entry.toFixed(2)}` },
        { price: tp, color: '#0fbf5f', label: `TP ${tp.toFixed(2)}` },
      ];
      lines.forEach(({ price, color, label }) => {
        const yy = y(price);
        ctx.setLineDash(price === entry ? [] : [5, 4]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(plotW, yy);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = color;
        const labelW = ctx.measureText(label).width + 12;
        ctx.fillRect(plotW - labelW - 4, yy - 9, labelW, 18);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(label, plotW - labelW + 2, yy + 4);
      });
    }
  }
}

window.CandleChart = CandleChart;
