import {test,expect} from './market-fixture.js';
import {sampleData} from '../src/engine.js';
const prices=sampleData()['DEMO-SPY'];
test('Round 24: validated best-fit selects only qualifying symbols and auto-follows dates',async({page})=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('./');
  await page.locator('[data-option="preset"]').selectOption('all');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-option="portfolio-mode"]').selectOption('best-fit');
  const toggle=page.locator('#best-fit-validated-only');
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('#best-fit-validation-count')).toContainText('In-sample strategy selection');
  await toggle.check();
  await expect(page.locator('#best-fit-validation-count')).toContainText('Not calculated');
  await page.locator('[data-action="run-best-fit"]').click();
  await expect(page.locator('#portfolio-source')).toContainText('Saved best-fit portfolio',{timeout:160000});
  const qualified=await page.locator('#portfolio-breakdown tbody tr').count();
  await expect(page.locator('#best-fit-validation-count')).toContainText(
    qualified+' of 4 selected symbols qualify');
  await expect(page.locator('.panel-header h2').filter({hasText:'Best-fit portfolio selection'}))
    .toContainText(qualified+' of 4 selected qualified');
  if(qualified){
    await expect(page.locator('#portfolio-breakdown')).toContainText('Rolling mean OOS Sharpe');
    await expect(page.locator('#portfolio-breakdown')).toContainText('Rolling positive windows');
    await expect(page.locator('#portfolio-methodology')).toContainText('selection bias');
    await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  }else{
    await expect(page.locator('#best-fit-validated-empty')).toHaveText(
      'No symbol has a validated strategy on this window');
    await expect(page.locator('#equity-chart')).toHaveCount(0);
  }
  const start=prices[300].time,end=prices[359].time;
  await page.locator('[data-bt-range="startDate"]').fill(start);
  await page.locator('[data-bt-range="endDate"]').fill(end);
  await expect(page.locator('#portfolio-source')).toContainText('Selected range: '+start+' to '+end,
    {timeout:160000});
  await expect(page.locator('#best-fit-validation-count')).toContainText('0 of 4 selected symbols qualify');
  await expect(page.locator('#best-fit-validated-empty')).toHaveText(
    'No symbol has a validated strategy on this window');
  await expect(page.locator('#portfolio-breakdown')).toHaveCount(0);
  await expect(page.locator('#equity-chart')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#best-fit-validated-only')).toBeChecked();
  await expect(page.locator('#best-fit-validated-empty')).toBeVisible();
  await page.locator('[data-action="clear-bt-dates"]').click();
  await expect(page.locator('#portfolio-source')).toContainText('Full available range',{timeout:160000});
  await toggle.uncheck();
  await expect(page.locator('#portfolio-source')).toContainText('Saved best-fit portfolio',{timeout:160000});
  await expect(page.locator('#best-fit-validation-count')).toContainText('In-sample strategy selection');
  await expect(page.locator('#portfolio-breakdown tbody tr').first()).toContainText('Fit Sharpe:');
  expect(errors).toEqual([]);
});
