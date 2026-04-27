# Mock import CSVs

Synthetic CSV files in each supported exchange format, sized to actually exercise the UI (~20 fills → 10 closed positions per file, 5 symbols, mixed wins/losses, spread across 2 weeks). Use them via `/import` on a non-demo account to verify the full ingestion → derivation → dashboard flow without needing real exchange data.

| File | Format | Source tab on `/import` |
|---|---|---|
| `binance-spot-mock.csv` | Binance Spot Trade History | Binance |
| `binance-futures-mock.csv` | Binance USDⓈ-M Futures Trade History | Binance |
| `bybit-perp-mock.csv` | Bybit USDT Perpetual Trade History | Bybit |
| `bybit-spot-mock.csv` | Bybit Spot Trade History | Bybit |
| `hyperliquid-mock.csv` | Hyperliquid Trade History | Hyperliquid |
| `okx-mock.csv` | OKX Trade History (mixed spot + perp) | OKX |

## What you'll see after import

- **`/trades`** — 10 closed positions (5 symbols × 2 trades each: BTC, ETH, SOL, plus two exchange-flavored picks like LINK/HYPE/ARB).
- **`/dashboard`** — KPIs populated, equity curve drawn, asset breakdown across 5 symbols, time-of-day heatmap with cells across multiple days.
- **`/dashboard` Findings sidebar** — depending on the patterns, may light up Plan-adherence (no), Revenge-trading (no — trades are spaced), Sizing-instability (maybe), Symbol-underperformance (yes — LINK/HYPE/ARB/DOGE all losers).
- **AI insight cards** — `<CoachCard>` on each trade detail; `<InsightCard>` on dashboard once the next Sunday digest composes.

## Verifying a file before import

```bash
pnpm tsx scripts/verify-mock-csvs.ts
```

Validates every mock against its adapter and reports `valid / detectedVariant / rowCount / symbols`. Should output six `✓` lines.

## Generating new mocks

If you want a wider dataset (e.g., to populate the heatmap fully or trigger specific detectors), the `fixtures/` folder also has detector-flavored fixtures in Hyperliquid CSV format:

- `loss-chaser.csv` — losing-streak after losses
- `revenge-trader.csv` — quick re-entry after a loss
- `size-bloater.csv` — position size grows after losses
- `pyramid-losers.csv` — adding to losing positions
- `evening-tilt.csv` — late-evening underperformance
- `winner-cutter.csv` — exits winners too early
- `scalp-gambler.csv` — fee drag from short holds
- `steady-discipline.csv` — control set, mostly wins

Those are imported via the **Hyperliquid** tab on `/import`. Each is significantly larger (50–300 fills) and produces meaningful detector findings.

## Demo user is read-only

`/import` is gated by `assertNotDemo`. If you're signed into the demo account, sign out first and sign in with a real Google account to use these fixtures.
