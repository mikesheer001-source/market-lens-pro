// Curated, bundled liquid-US market universe for Alpaca daily-bar scans.
// Kept in source control so the Worker and browser always use the same symbols.
export const VOLATILITY_UNIVERSE = Object.freeze([
  'VXX','UVXY','SVXY','VIXY','VIXM','VXZ','SVIX','UVIX','ZIVB','ZVOL','DEMO-VXX'
]);

export const DEMO_UNIVERSE = Object.freeze([
  'DEMO-SPY','DEMO-NVDA','DEMO-VXX','DEMO-COIN'
]);

const LIQUID_US_SYMBOLS = [
  'AAPL','MSFT','NVDA','AMZN','GOOGL','GOOG','META','AVGO','BRK.B','LLY',
  'JPM','V','MA','XOM','COST','WMT','NFLX','ORCL','PG','JNJ',
  'HD','ABBV','BAC','CVX','KO','MRK','CRM','CSCO','AMD','PEP',
  'ACN','MCD','LIN','ABT','TMO','WFC','IBM','GE','CAT','GS',
  'MS','RTX','UBER','NOW','INTU','QCOM','TXN','AMAT','MU','PM',
  'UNH','ISRG','SPGI','BKNG','DIS','VZ','T','NEE','C','ORLY',
  'ADP','COP','DHR','AMGN','SCHW','PLTR','PANW','CRWD','ADBE','UPS',
  'LOW','HON','DE','MDT','GILD','CME','ICE','BLK','MDLZ','MO',
  'SO','DUK','CB','PGR','MMC','APH','ETN','KLAC','LRCX','SNPS',
  'CDNS','SHW','TGT','CVS','FDX','USB','PNC','EOG','SLB','OXY',
  'F','UAL','DAL','LUV','TSLA'
];

const MARKET_ETFS = [
  'SPY','QQQ','IWM','DIA','XLF','XLK','XLE','XLI','XLV','XLP',
  'XLY','XLU','XBI','SMH','TLT','GLD','HYG','LQD'
];

export const LIVE_UNIVERSE = Object.freeze(
  [...new Set([...LIQUID_US_SYMBOLS,...MARKET_ETFS,...VOLATILITY_UNIVERSE.filter(s=>s!=='DEMO-VXX')])]
);

export const ALPACA_BATCH_SIZE = 15;
export const ALPACA_SCAN_LOOKBACK_DAYS = 550;
export const ALPACA_SCAN_CACHE_SECONDS = 900;
