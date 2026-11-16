// Editable Pine v5 subset examples. Price lower low / RSI higher low is REGULAR, not hidden, bullish divergence.
export const PINE_EXAMPLES=Object.freeze([
  {
    "id": "ema-cross",
    "label": "EMA crossover strategy",
    "code": "//@version=5\nstrategy(\"EMA crossover\", overlay=true)\nfastLength = input.int(20, \"Fast EMA\", minval=2, maxval=200, step=5)\nslowLength = input.int(50, \"Slow EMA\", minval=3, maxval=300, step=10)\nfast = ta.ema(close, fastLength)\nslow = ta.ema(close, slowLength)\nenterLong = ta.crossover(fast, slow)\nexitLong = ta.crossunder(fast, slow)\nstrategy.entry(\"Long\", strategy.long, when=enterLong)\nstrategy.close(\"Long\", when=exitLong)\nplot(fast, \"Fast EMA\", color=color.aqua)\nplot(slow, \"Slow EMA\", color=color.orange)"
  },
  {
    "id": "rsi-revert",
    "label": "RSI mean reversion strategy",
    "code": "//@version=5\nstrategy(\"RSI mean reversion\", overlay=false)\nlength = input.int(14, \"RSI length\", minval=2, maxval=100)\nentryLevel = input.float(30, \"Entry RSI\", minval=5, maxval=50, step=5)\nexitLevel = input.float(65, \"Exit RSI\", minval=50, maxval=95, step=5)\nmomentum = ta.rsi(close, length)\nstrategy.entry(\"Long\", strategy.long, when=ta.crossunder(momentum, entryLevel))\nstrategy.close(\"Long\", when=ta.crossover(momentum, exitLevel))\nplot(momentum, \"RSI\", color=color.aqua)"
  },
  {
    "id": "rsi-divergence",
    "label": "Regular bullish RSI divergence (confirmed pivot)",
    "code": "//@version=5\n// Requested: price lower low + RSI higher low = REGULAR bullish divergence.\n// Pivot confirmed rightBars candles later. No future bar data is accessed.\nstrategy(\"RSI lower-price / higher-RSI divergence\", overlay=true)\nlength = input.int(14, \"RSI period\", minval=2, maxval=100)\nrightBars = input.int(5, \"Pivot bars left/right\", minval=2, maxval=15)\nexitRsi = input.float(65, \"Exit RSI\", minval=50, maxval=95, step=5)\nmomentum = ta.rsi(close, length)\npivotConfirmed = low[rightBars] == ta.lowest(low, rightBars * 2 + 1)\nvar float previousPriceLow = na\nvar float previousRsiLow = na\ndivergence = false\nif pivotConfirmed and not na(previousPriceLow) and not na(momentum[rightBars])\n    divergence := low[rightBars] < previousPriceLow and momentum[rightBars] > previousRsiLow\nif pivotConfirmed and not na(momentum[rightBars])\n    previousPriceLow := low[rightBars]\n    previousRsiLow := momentum[rightBars]\nstrategy.entry(\"Long\", strategy.long, when=divergence)\nstrategy.close(\"Long\", when=ta.crossover(momentum, exitRsi))\nplotshape(divergence, \"Confirmed bullish divergence\", color=color.lime, location=location.belowbar)"
  },
  {
    "id": "bollinger-revert",
    "label": "Bollinger mean reversion strategy",
    "code": "//@version=5\nstrategy(\"Bollinger mean reversion\", overlay=true)\nlength = input.int(20, \"Band length\", minval=5, maxval=100, step=5)\ndeviations = input.float(2.0, \"Std deviations\", minval=0.5, maxval=4, step=0.5)\n[basis, upper, lower] = ta.bb(close, length, deviations)\nbuySignal = ta.crossunder(close, lower)\nsellSignal = ta.crossover(close, basis)\nstrategy.entry(\"Long\", strategy.long, when=buySignal)\nstrategy.close(\"Long\", when=sellSignal)\nplot(basis, \"Basis\", color=color.aqua)\nplot(upper, \"Upper band\", color=color.orange)\nplot(lower, \"Lower band\", color=color.orange)"
  },
  {
    "id": "rsi-indicator",
    "label": "RSI oscillator indicator",
    "code": "//@version=5\nindicator(\"RSI oscillator\", overlay=false)\nlength = input.int(14, \"RSI period\", minval=2, maxval=100)\nvalue = ta.rsi(close, length)\nplot(value, \"RSI\", color=color.aqua)\nplotshape(ta.crossunder(value, 30), \"RSI under 30\", color=color.orange, location=location.belowbar)"
  },
  {
    "id": "macd-indicator",
    "label": "MACD indicator",
    "code": "//@version=5\nindicator(\"MACD\", overlay=false)\nfastLength = input.int(12, \"Fast length\", minval=2, maxval=100)\nslowLength = input.int(26, \"Slow length\", minval=3, maxval=200)\nsignalLength = input.int(9, \"Signal length\", minval=2, maxval=100)\n[macdLine, signalLine, histogram] = ta.macd(close, fastLength, slowLength, signalLength)\nplot(macdLine, \"MACD\", color=color.aqua)\nplot(signalLine, \"Signal\", color=color.orange)\nplot(histogram, \"Histogram\", color=color.gray)"
  },
  {
    id: 'hidden-rsi-divergence',
    label: 'Hidden bullish RSI divergence · trend pullback',
    code: "//@version=5\n// TRUE HIDDEN bullish divergence: price HIGHER low, RSI LOWER low.\n// Left and right pivot bars confirm each low using historical data only.\n// The long order is filled at the next bar open after confirmation.\nstrategy(\"Trend pullback with hidden RSI divergence - Long Only\", overlay=true)\nrsiPeriod = input.int(14, \"RSI period\", minval=2, maxval=100)\npivotBars = input.int(5, \"Pivot left/right bars\", minval=2, maxval=15)\ntrendLength = input.int(200, \"Daily trend EMA\", minval=20, maxval=300)\nexitRsi = input.float(65, \"Exit RSI\", minval=50, maxval=95, step=5)\nmomentum = ta.rsi(close, rsiPeriod)\ntrend = ta.ema(close, trendLength)\npivotConfirmed = low[pivotBars] == ta.lowest(low, pivotBars * 2 + 1)\nvar float previousPriceLow = na\nvar float previousRsiLow = na\nhiddenBullish = false\nif pivotConfirmed and not na(previousPriceLow) and not na(momentum[pivotBars]) and not na(trend)\n    hiddenBullish := low[pivotBars] > previousPriceLow and momentum[pivotBars] < previousRsiLow and close > trend\nif pivotConfirmed and not na(momentum[pivotBars])\n    previousPriceLow := low[pivotBars]\n    previousRsiLow := momentum[pivotBars]\nstrategy.entry(\"Long\", strategy.long, when=hiddenBullish)\nstrategy.close(\"Long\", when=ta.crossover(momentum, exitRsi))\nplot(trend, \"Trend EMA\", color=color.orange)\nplotshape(hiddenBullish, \"Confirmed hidden bullish divergence\", color=color.lime, location=location.belowbar)"
  },
]);
