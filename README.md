# Market Lens Pro

Independent upgrade of the user's Market Lens screener, built as a mobile-friendly GitHub Pages application.

- Interactive TradingView Lightweight Charts with candlesticks, lines, OHLC, overlays, and indicator panes.
- Multi-symbol imported OHLCV datasets, screener, watchlists, and presets.
- Next-bar backtesting with transaction costs, stops, equity curves, trade logs, and parameter sweeps.
- Demo prices are simulated and labeled; imported prices are user-provided. A separately deployed live data backend is not included in the Pages deployment.

See the app's Data and Methods panels for limitations. Nothing here submits real orders.

## Development

```sh
npm install
npm run dev
npm test
npm run build
```

## Deployment

Settings > Pages > Build and deployment > Source: **GitHub Actions**. The included workflow deploys on pushes to main. Expected URL once GitHub Pages is enabled: https://mikesheer001-source.github.io/market-lens-pro/

The original source is https://github.com/mikesheer001-source/market-lens. This is a separate application, not a byte-for-byte copy. No private API key or hosted service was copied.
