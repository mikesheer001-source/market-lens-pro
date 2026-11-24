import {test,expect} from './market-fixture.js';

test('Script Lab compiles a custom indicator, renders a chart pane, and saves scripts locally',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="scripts"]').click();
  await expect(page.getByRole('heading',{name:'Script Lab'})).toBeVisible();
  await expect(page.locator('#pine-editor')).toContainText('strategy("EMA crossover"');
  await page.locator('[data-action="pine-example"][data-example="rsi-indicator"]').click();
  await expect(page.locator('#pine-editor')).toContainText('indicator("RSI oscillator"');
  await page.locator('[data-action="pine-check"]').click();
  await expect(page.getByRole('status')).toContainText('Pine syntax OK');
  await expect(page.locator('[data-pine-input="length"]')).toHaveValue('14');
  await page.locator('[data-pine-input="length"]').fill('9');
  await page.locator('[data-pine-input="length"]').blur();
  await page.locator('[data-action="pine-run"]').click();
  await expect(page.getByRole('heading',{name:'Chart Lab'})).toBeVisible();
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await page.locator('.sidebar [data-tab="scripts"]').click();
  await expect(page.getByText('RSI oscillator indicator',{exact:true}).first()).toBeVisible();
  await page.locator('#pine-name').fill('My RSI 9');
  await page.locator('[data-action="pine-save"]').click();
  await expect(page.locator('#pine-library option')).toHaveCount(2);
  await page.reload();
  await page.locator('.sidebar [data-tab="scripts"]').click();
  await expect(page.locator('#pine-library option')).toHaveCount(2);
  await expect(page.locator('#pine-name')).toHaveValue('My RSI 9');
  expect(errors).toEqual([]);
});

test('custom Pine strategy backtest and input sweep use the existing finance engine',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="scripts"]').click();
  await page.locator('[data-action="pine-example"][data-example="ema-cross"]').click();
  await page.locator('[data-action="pine-run"]').click();
  await expect(page.getByRole('heading',{name:'Backtest'})).toBeVisible();
  await expect(page.locator('[data-bt="strategy"]')).toHaveValue('pine-custom');
  await expect(page.getByText('Completed trades')).toBeVisible();
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  await page.locator('.sidebar [data-tab="optimize"]').click();
  await page.locator('[data-action="run-sweep"]').click();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(9);
  expect(errors).toEqual([]);
});

test('bad Pine scripts show a precise line number instead of a blank view',async ({page})=>{
  await page.goto('./');
  await page.locator('.sidebar [data-tab="scripts"]').click();
  await page.locator('#pine-editor').fill('//@version=5\nindicator("My bad RSI")\nr = ta.rsi(close)');
  await page.locator('[data-action="pine-check"]').click();
  await expect(page.locator('.pine-error')).toContainText('line 3: ta.rsi needs a series and a length');
  await expect(page.locator('#pine-editor')).toBeVisible();
});

test('saved scripts can be renamed and deleted without server access',async ({page})=>{
  await page.goto('./');
  await page.locator('.sidebar [data-tab="scripts"]').click();
  await page.locator('#pine-name').fill('Local RSI strategy');
  await page.locator('[data-action="pine-save"]').click();
  await expect(page.locator('#pine-library option')).toHaveCount(2);
  await page.locator('#pine-name').fill('Renamed locally');
  await page.locator('[data-action="pine-rename"]').click();
  await expect(page.locator('#pine-library option').last()).toContainText('Renamed locally');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[data-action="pine-delete"]').click();
  await expect(page.locator('#pine-library option')).toHaveCount(1);
});
