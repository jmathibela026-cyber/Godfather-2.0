/* ==========================================================================
   GODFATHER — API Layer
   Personal-use client: your own Twelve Data API key and MetaApi Cloud
   token/account ID (entered on the Settings page) are stored only in
   this browser's localStorage. Live candle data comes from Twelve Data;
   trade execution goes through MetaApi Cloud (MT4/5). There is no
   backend server in this version — if you ever turn this into a
   multi-user product, move both keys server-side instead (see README).

   NOTE ON REGIONS: MetaApi accounts are provisioned in a specific region
   (e.g. "new-york", "london"), and the trade/positions hosts below are
   hardcoded to new-york. If your account isn't in that region those two
   calls will fail — see the README for how to find and swap in your
   account's real region.
   ========================================================================== */

const GodfatherAPI = (() => {

  const STORAGE_KEY = 'godfather_settings_v1';
  const REGION = 'new-york'; // MetaApi trade/positions only — see README

  // ---- Settings (Twelve Data key, MetaApi token/account, lot size) ----
  function getSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveSettings(partial) {
    const current = getSettings();
    const next = { ...current, ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  function requireMetaCreds() {
    const { metaToken, metaAccountId } = getSettings();
    if (!metaToken || !metaAccountId) {
      throw new Error('No MetaApi Cloud credentials set. Add them in Settings.');
    }
    return { metaToken, metaAccountId };
  }

  // UI timeframe (M5/M15/H1/H4) -> Twelve Data's interval strings
  const TF_MAP = { M5: '5min', M15: '15min', H1: '1h', H4: '4h' };

  // UI symbol -> Twelve Data symbol. Forex majors use TD's "BASE/QUOTE"
  // format; indices use TD's index tickers, which don't line up 1:1 with
  // broker CFD names (US30/GER30/USTECH) — see README if one of these
  // doesn't resolve for your plan.
  const TD_SYMBOL_MAP = {
    XAUUSD: 'XAU/USD',
    US30: 'DJI',
    GER30: 'GDAXI',
    USTECH: 'NDX',
    EURUSD: 'EUR/USD',
    GBPUSD: 'GBP/USD',
    USDJPY: 'USD/JPY',
    USDCHF: 'USD/CHF',
    AUDUSD: 'AUD/USD',
    USDCAD: 'USD/CAD',
    NZDUSD: 'NZD/USD',
  };

  // ---- Live candles, from Twelve Data ----
  async function getCandles(symbol, timeframe, count = 60) {
    const { twelveDataKey } = getSettings();
    if (!twelveDataKey) throw new Error('No Twelve Data API key set. Add one in Settings.');

    const tdSymbol = TD_SYMBOL_MAP[symbol] || symbol;
    const interval = TF_MAP[timeframe] || timeframe;

    const url = `https://api.twelvedata.com/time_series` +
      `?symbol=${encodeURIComponent(tdSymbol)}&interval=${interval}` +
      `&outputsize=${count}&order=ASC&apikey=${twelveDataKey}`;

    const res = await fetch(url);
    if (res.status === 429) {
      throw new Error('Twelve Data rate limit hit (free tier: 8 requests/min). Wait about 30–60s and try again.');
    }
    if (!res.ok) throw new Error(`Candle fetch failed: ${res.status}`);
    const data = await res.json();

    if (data.status === 'error' || !data.values) {
      throw new Error(data.message || 'Twelve Data returned no candle data for this symbol/interval.');
    }

    return data.values.map(v => ({
      t: new Date(v.datetime).getTime(),
      o: parseFloat(v.open),
      h: parseFloat(v.high),
      l: parseFloat(v.low),
      c: parseFloat(v.close),
    }));
  }

  async function getQuote(symbol) {
    const candles = await getCandles(symbol, 'M5', 1);
    const last = candles[candles.length - 1];
    return { price: last?.c, time: last?.t };
  }

  // ---- Trade execution via MetaApi Cloud (MT4/MT5) ----
  async function placeTrade({ symbol, direction, entry, sl, tp, lots }) {
    const { metaToken, metaAccountId } = requireMetaCreds();
    const actionType = direction === 'buy' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL';

    const res = await fetch(
      `https://mt-client-api-v1.${REGION}.agiliumtrade.ai/users/current/accounts/${metaAccountId}/trade`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'auth-token': metaToken,
        },
        body: JSON.stringify({
          actionType,
          symbol,
          volume: lots,
          stopLoss: sl,
          takeProfit: tp,
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Trade placement failed: ${res.status} ${errBody}`);
    }
    return res.json();
  }

  async function getOpenPositions() {
    const { metaToken, metaAccountId } = requireMetaCreds();
    const res = await fetch(
      `https://mt-client-api-v1.${REGION}.agiliumtrade.ai/users/current/accounts/${metaAccountId}/positions`,
      { headers: { 'auth-token': metaToken } }
    );
    if (!res.ok) throw new Error(`Positions fetch failed: ${res.status}`);
    return res.json();
  }

  return { getSettings, saveSettings, getCandles, getQuote, placeTrade, getOpenPositions };
})();

window.GodfatherAPI = GodfatherAPI;
