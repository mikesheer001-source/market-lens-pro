import {test,expect} from './market-fixture.js';
import {sampleData,backtest} from '../src/engine.js';
import {executePine} from '../src/pine.js';
import {windowBacktestBars} from '../src/date-window.js';

const code=[
  '//@version=5',
  'strategy("Two-sided EMA", overlay=true)',
  'length = input.int(9, "EMA length", minval=2)',
  'average = ta.ema(close, length)',
  'strategy.entry("Long", strategy.long, when=ta.crossover(close, average))',
  'strategy.entry("Short", strategy.short, when=ta.crossunder(close, average))',
  'plot(average, "Signal EMA")'
].join('\n');

test('run Pine from the Backtest editor and show both sides, equity and metrics',async ({page})=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.getByRole('button',{name:'Use Pine code',exact:true}).click();
  await page.getByLabel('Pine script library').selectOption('example:ema-cross');
  await expect(page.getByLabel('Pine strategy code · v5')).toHaveValue(/EMA crossover/);
  await page.getByLabel('Pine strategy code · v5').fill(code);
  await page.getByRole('button',{name:'Check Pine syntax'}).click();
  await expect(page.getByRole('spinbutton',{name:/EMA length/})).toHaveValue('9');
  await page.getByRole('spinbutton',{name:/EMA length/}).fill('10');
  const dates={startDate:'2022-01-03',endDate:'2022-12-30'};
  await page.getByLabel('Backtest start date').fill(dates.startDate);
  await page.getByLabel('Backtest end date').fill(dates.endDate);
  await page.getByRole('button',{name:'Run Pine strategy',exact:true}).click();
  const bars=windowBacktestBars(sampleData()['DEMO-SPY'],dates).bars;
  const expected=backtest(bars,{side:'script',customSignals:executePine(code,bars,{length:10}).signals,timeframe:'D'});
  expect(expected.trades.some(trade=>trade.side==='long')).toBe(true);
  expect(expected.trades.some(trade=>trade.side==='short')).toBe(true);
  await expect(page.locator('#backtest-price-chart canvas').first()).toBeVisible();
  await expect(page.locator('#backtest-price-chart')).toHaveAttribute('data-trade-markers',String(expected.trades.length*2));
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  await expect(page.locator('.metric').filter({hasText:'Completed trades'}).locator('strong')).toHaveText(String(expected.trades.length));
  await expect(page.locator('#backtest-result-range')).toContainText(dates.startDate+' to '+dates.endDate);
  await page.reload();
  await expect(page.getByLabel('Pine strategy code · v5')).toHaveValue(code);
  await expect(page.locator('#backtest-price-chart')).toHaveAttribute('data-trade-markers',String(expected.trades.length*2));
  expect(errors).toEqual([]);
});

test('an indicator without order logic surfaces an inline error in Backtest',async ({page})=>{
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.getByRole('button',{name:'Use Pine code',exact:true}).click();
  await page.getByLabel('Pine strategy code · v5').fill('//@version=5\nindicator("Only plots")\nplot(close)');
  await page.getByRole('button',{name:'Run Pine strategy',exact:true}).click();
  await expect(page.locator('#backtest-range-error')).toContainText('strategy() script');
  await expect(page.getByLabel('Pine strategy code · v5')).toBeVisible();
});
