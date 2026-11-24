import {test,expect} from './market-fixture.js';
import {aggregate,backtest,sampleData,screenSymbol} from '../src/engine.js';
import {windowBacktestBars} from '../src/date-window.js';
import {assessHoldout} from '../src/validation.js';

test('mobile review follows the visible match order, explains rules and restores the Screener',async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('./');
  await page.locator('[data-option="preset"]').selectOption('oversold');
  await page.locator('[data-rule="0"][data-key="value"]').fill('100');
  await page.locator('[data-option="sort"]').selectOption('price');
  await page.locator('[data-action="sort-order"]').click();
  await page.getByRole('textbox',{name:'Search symbols'}).fill('V');
  const table=page.locator('.screener-results');
  const symbols=await table.locator('tbody tr').evaluateAll(rows=>rows.map(row=>row.dataset.symbol));
  expect(symbols.length).toBeGreaterThan(1);
  const first=table.locator('tbody tr').first();
  await first.locator('.table-table-label').click();
  const dialog=page.getByRole('dialog',{name:symbols[0],exact:true});
  await expect(dialog.getByText('Daily RSI',{exact:true})).toBeVisible();
  await table.locator('..').evaluate(element=>{element.scrollLeft=200;});
  const position=await table.locator('..').evaluate(element=>({x:element.scrollLeft,y:window.scrollY}));
  await dialog.getByRole('button',{name:'Open chart',exact:true}).click();
  await expect(page.getByRole('button',{name:'Previous',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Rules',exact:true}).click();
  const rules=page.getByRole('dialog',{name:symbols[0]+' scan rules',exact:true});
  const actual=screenSymbol(sampleData()['DEMO-'+symbols[0]],[{tf:'D',metric:'rsi',op:'<',value:100}]).checks[0].value;
  await expect(rules).toContainText(actual.toLocaleString('en-US',{maximumFractionDigits:2})+' < 100');
  await rules.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Next match',exact:true}).click();
  await expect(page.locator('.chart-ticker')).toHaveAttribute('data-symbol',symbols[1]);
  await page.getByRole('button',{name:'Previous',exact:true}).click();
  await expect(page.locator('.chart-ticker')).toHaveAttribute('data-symbol',symbols[0]);
  await page.locator('[data-action="return-screener"]').click();
  await expect(page.getByRole('textbox',{name:'Search symbols'})).toHaveValue('V');
  await expect(page.locator('[data-option="sort"]')).toHaveValue('price');
  expect(await table.locator('..').evaluate(element=>({x:element.scrollLeft,y:window.scrollY}))).toEqual(position);
});

test('paired variant metrics use identical dates and baseline costs after reloading the pin',async ({page})=>{
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  const section=page.locator('#variant-comparison');
  const run=section.getByRole('button',{name:'Compare current settings',exact:true});
  await expect(run).toBeDisabled();
  await section.getByRole('button',{name:'Pin baseline',exact:true}).click();
  await page.reload();
  await expect(section.getByRole('button',{name:'Replace baseline',exact:true})).toBeVisible();
  const range={startDate:'2021-01-04',endDate:'2023-12-29'};
  await page.getByLabel('Backtest start date').fill(range.startDate);
  await page.getByLabel('Backtest end date').fill(range.endDate);
  await page.locator('[data-bt="fast"]').fill('10');
  await page.locator('[data-bt="feeBps"]').fill('25');
  await run.click();
  await expect(section).toContainText('Fast EMA 20 → 10');
  await expect(section).toContainText('1.00 bps commission');
  await expect(section).toContainText(range.startDate+' to '+range.endDate);
  const bars=windowBacktestBars(aggregate(sampleData()['DEMO-SPY'],'D'),range).bars;
  const baseline={strategy:'ema-cross',fast:20,slow:100,feeBps:1,slipBps:2,timeframe:'D'};
  const variant={...baseline,fast:10};
  const expected=(cfg)=>{
    const metrics=backtest(bars,cfg).metrics;
    const sharpe=assessHoldout(bars,cfg,backtest).testMetrics.sharpe;
    return [metrics.returnPct,metrics.maxDD,metrics.trades,sharpe];
  };
  const values=await section.locator('tbody tr').evaluateAll(rows=>rows.map(row=>
    [...row.querySelectorAll('td')].slice(0,2).map(cell=>Number(cell.textContent.replace(/[,%]/g,'')))));
  const expectedResults=[expected(baseline),expected(variant)];
  for(const [row,digits] of [2,2,0,3].entries()){
    expect(values[row][0]).toBeCloseTo(expectedResults[0][row],digits);
    expect(values[row][1]).toBeCloseTo(expectedResults[1][row],digits);
  }
  await page.getByLabel('Backtest start date').fill('2022-01-03');
  await expect(section.locator('table')).toHaveCount(0);
});
