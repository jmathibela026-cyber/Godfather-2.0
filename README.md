# Godfather — AI Chart Scanner (v4, Live Chart via Twelve Data)

Installable web app (PWA) that pulls a **live chart** for your chosen
symbol from Twelve Data, runs it through a local ICT "Liquidity Sweep"
rule engine, and produces a BUY / SELL / WAIT signal with Entry, Stop
Loss and Take Profit — then lets you fire a batch of trades into your
MT4/5 account via MetaApi Cloud.

## What changed from v3

v3 pulled live candles from MetaApi Cloud. v4 splits the two jobs
between two providers, which is closer to the original v1 plan:

- **Twelve Data** → live/historical candle data for the chart and the
  scan engine.
- **MetaApi Cloud** → trade execution only (placing orders on your
  connected MT4/5 account, and reading open positions).

Everything else is unchanged: `scanner.js` still does the actual
analysis locally (no AI/LLM in the loop), two bottom tabs (Home /
Settings), Forex Majors symbol row, trade-count selector.

## Three selectable strategies

The Strategy chip row on Home offers three independent momentum
engines, all in `scanner.js`, all pure local math (no AI call). Each
enters on momentum *resuming* out of an extreme rather than trying to
call the exact top/bottom:

- **RSI Momentum** — enters when RSI(14) crosses back out of oversold
  (<30) or overbought (>70).
- **Moving Averages** — a 13/50/100 EMA stack; enters on a pullback to
  the 13 EMA while the three EMAs are aligned in trend order, stop
  beyond the 50 EMA.
- **Stochastic Oscillator** — enters on a %K/%D crossover coming out
  of the oversold (<20) or overbought (>80) zone.

All three fetch the same live candles (needs ~100+ bars — the 150
fetched per scan covers this), read the higher timeframe's trend as a
soft confidence adjustment (not a hard filter, since these are
reversal-style signals), and return the same shape (`verdict`/`entry`/
`sl`/`tp`/`confidence`/`strategy`/`reasoning`, or `{verdict:'wait',
reason}`) so `app.js` just calls whichever one matches the selected
chip.

## Settings now has two sections

1. **Live Chart Data — Twelve Data**: paste a Twelve Data API key
   (free tier at [twelvedata.com](https://twelvedata.com)).
2. **Trade Execution — MetaApi Cloud**: token, account ID, lot size
   (unchanged from v3).

## Important: this is a personal-use architecture, not multi-tenant

Both keys are entered in Settings and used directly from the browser
(`api.js`) — they live in this browser's `localStorage` and are sent
straight to Twelve Data / MetaApi Cloud. That's fine for **your own
device, your own keys, your own account**. Don't publish this as a
public site with your keys already filled in, and don't hand this
codebase to other users without adding a server-side proxy back in.

## Project structure

```
godfather/
├── index.html            Home (live chart + scan) and Settings pages
├── manifest.json          PWA manifest (installability)
├── service-worker.js       Offline app-shell caching (cache bumped to v4)
├── tokens.css              Design tokens (color, type, radius)
├── app.css                 Component + layout styles
├── chart.js                Canvas candlestick renderer, with SL/Entry/TP overlay
├── scanner.js               GodfatherEngine — the ICT Liquidity Sweep rule engine
├── api.js                    Twelve Data candles + MetaApi Cloud trade execution + settings storage
├── app.js                     App controller: live polling, scan animation, result + settings wiring
└── icons/                     App icons
```

## Auto-Scan (background alerts)

A toggle above the Symbol chips — **Auto-Scan: OFF/ON** — runs the
currently selected Strategy against the currently selected
Symbol/Timeframe on a loop, without you tapping Scan Chart:

- Checks every 5 minutes (deliberately slower than the plain chart
  refresh, to stay well clear of Twelve Data's rate limit).
- Only surfaces a signal once — if the same setup is still active next
  cycle, it won't re-alert; if the setup disappears (back to `wait`)
  and a *different* one shows up later, that's treated as new.
- Won't overwrite a signal you haven't acted on yet — if a result is
  already on screen, it keeps scanning silently until you tap Confirm
  & Execute or Scan Another Chart.
- When a new signal is found, it both updates the on-screen result
  (so opening the app shows it immediately) and fires a local
  notification via the service worker (`Notification` + `showNotification`),
  so you get alerted even if you're not looking at the app. Tapping
  the notification focuses/opens the app.
- The first time you turn it on, the browser will prompt for
  notification permission. If you decline (or the browser doesn't
  support it), Auto-Scan still runs and updates the in-app status line
  — you just won't get pushed alerts while the app isn't in view.

**Caveats:** this only runs while the page/PWA process is alive — if
you fully close the tab/app (not just background it), the timer stops
with it, since there's no server behind this to keep scanning when
nothing is open. How well background tabs keep timers running varies
by browser/OS (this is a known general limitation of browser tabs, not
something specific to this app). The execute button in the alert is
never wired to fire on its own — you always tap Confirm & Execute
yourself once you see it, whether that's from the notification or by
opening the app.

## Setup

1. Get a **Twelve Data** API key (free tier: 800 calls/day, 8/min —
   fine for personal use with the 45s chart refresh / Auto-Scan cadence).
2. Get a **MetaApi Cloud** account, connect your MT4/5 account, and
   grab its **Account ID** and an **auth token**.
3. Open the app → **Settings** → paste both in → **Save Settings**.
4. Go to **Home** — the live chart should start loading. Tap
   **Scan Chart** once candles are showing.

### Things to verify before going live

1. **Index symbols.** Twelve Data doesn't use broker CFD names like
   US30/GER30/USTECH — `api.js` maps them to Twelve Data's own tickers
   (`DJI`, `GDAXI`, `NDX`). Whether those resolve depends on your
   Twelve Data plan (indices are sometimes gated to paid tiers) — if a
   chart won't load for one of these, check Twelve Data's symbol
   search for the exact ticker your plan has access to and adjust
   `TD_SYMBOL_MAP` in `api.js`.
2. **MetaApi region.** The trade/positions hosts in `api.js` are
   hardcoded to MetaApi's `new-york` region (`REGION` constant). If
   your account is provisioned elsewhere, update it or trade requests
   will fail to route.
3. **Rate limits.** The free Twelve Data tier caps at 8 requests/min.
   Each scan now fetches 150-candle windows (needed for the 100 EMA) —
   still 1 call per fetch regardless of size, so the same guidance
   applies: fine solo, but multiple tabs will hit the limit.

## Still to build

- Live Positions / Account screen (MetaApi open positions, close/modify)
- Auto-detecting the MetaApi region instead of hardcoding it
- A symbol picker backed by Twelve Data's `/symbol_search` endpoint
  instead of a hardcoded ticker map, so any instrument your plan
  supports "just works"

## Local preview

Any static file server works, e.g.:
```
npx serve .
```
Then open the printed localhost URL on your phone (same network) or in
desktop Chrome and use "Install app" from the browser menu to test the
PWA install flow.
