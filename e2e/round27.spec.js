import {expect,test} from '@playwright/test';

// FINAL-SPEC Round 27 implementation tests (items 1-15). Demo data only,
// no network except the mocked options-chain test at the end.

test('item 1: persistent #sr-live outside #app mirrors notices and survives tab switches', async ({page}) => {
  await page.goto('./');
  await expect(page.locator('#sr-live')).toHaveCount(1);
  const outside = await page.evaluate(() => {
    const live = document.querySelector('#sr-live');
    return {
      outsideApp: !document.querySelector('#app')?.contains(live),
      role: live?.getAttribute('role'),
      ariaLive: live?.getAttribute('aria-live'),
    };
  });
  expect(outside).toEqual({outsideApp: true, role: 'status', ariaLive: 'polite'});
  await page.locator('[data-action="scan-universe"]').click();
  await expect(page.locator('#scan-status')).toContainText('Demo scan complete');
  await expect(page.locator('#sr-live')).toContainText('Demo scan complete');
  await page.evaluate(() => { window.__sr = document.querySelector('#sr-live'); });
  await page.locator('.sidebar [data-tab="charts"]').click();
  await expect(page.getByRole('heading', {name: 'Chart Lab'})).toBeVisible();
  const sameNode = await page.evaluate(() => document.querySelector('#sr-live') === window.__sr);
  expect(sameNode).toBe(true);
});

test('item 2: options chip keyboard — Enter flips, Delete removes, ArrowRight moves strike', async ({page}) => {
  await page.goto('./');
  await page.locator('.sidebar [data-tab="options"]').click();
  const builder = page.locator('#options-builder');
  await builder.getByLabel('Underlying reference price').fill('100');
  await builder.getByLabel('Strategy preset').selectOption('Bull call debit spread');
  await builder.getByRole('button', {name: 'Apply preset'}).click();
  const chip = builder.locator('[data-strike-leg="0"]');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('aria-label', /Move leg 1 strike, 100C — buy; Enter flips side/);
  await chip.focus();
  await page.keyboard.press('Enter');
  await expect(chip).toHaveAttribute('aria-label', /Move leg 1 strike, 100C — sell; Enter flips side/);
  await page.keyboard.press('ArrowRight');
  await expect(chip).toHaveAttribute('aria-label', /Move leg 1 strike, 100\.5C — sell/);
  await page.keyboard.press('Delete');
  await expect(builder.locator('[data-strike-leg="0"]')).toHaveCount(1);
  await expect(builder.locator('[data-strike-leg]')).toHaveCount(1);
});

test('item 3: screener symbol is a real button and star toggles aria-pressed', async ({page}) => {
  await page.goto('./');
  const row = page.locator('tr[data-symbol="DEMO-SPY"]');
  expect(await row.evaluate(el => el.getAttribute('role'))).toBeNull();
  expect(await row.evaluate(el => el.hasAttribute('tabindex'))).toBe(false);
  const symbolBtn = row.locator('.symbol-btn');
  await expect(symbolBtn).toHaveCount(1);
  await expect(symbolBtn).toHaveText('DEMO-SPY');
  const star = row.locator('.star');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await expect(star).toHaveAttribute('aria-label', 'Watch DEMO-SPY');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await expect(star).toHaveAttribute('aria-label', 'Unwatch DEMO-SPY');
  await star.click();
  await symbolBtn.click();
  await expect(page.getByRole('heading', {name: 'Chart Lab'})).toBeVisible();
});

test('item 4: chart readout Close carries a day-direction sign', async ({page}) => {
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  const readout = await page.locator('#readout').innerText();
  const parsed = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('#readout span')].map(s => s.textContent.trim());
    const num = t => Number(t.replace(/[^0-9.\-]/g, ''));
    const o = spans.find(t => t.startsWith('O ')), c = spans.find(t => t.startsWith('C '));
    return {open: num(o), closeText: c.slice(2), close: num(c)};
  });
  const expectedSign = parsed.close >= parsed.open ? '+' : '-';
  expect(parsed.closeText.startsWith(expectedSign)).toBe(true);
  expect(readout).toContain('C ');
});

test('item 5: demo scan completion reaches #sr-live; Options Greeks fallback stays mode-neutral', async ({page}) => {
  await page.goto('./');
  await page.locator('[data-action="scan-universe"]').click();
  await expect(page.locator('#sr-live')).toContainText('Demo scan complete');
  await page.locator('.sidebar [data-tab="options"]').click();
  const builder = page.locator('#options-builder');
  await builder.getByLabel('Underlying reference price').fill('100');
  await builder.getByRole('button', {name: 'Add manual leg'}).click();
  await builder.getByLabel('Leg 1 entry').fill('2.5');
  await expect(builder.locator('[data-ob="greeks"]')).toHaveText(
    'Live Greeks unavailable — load the chain to refresh.');
  await expect(builder.locator('[data-ob="greeks"]')).not.toContainText('Demo mode');
});

test('item 6: search typing keeps focus and caret; tab switch lands focus on the view h1', async ({page}) => {
  await page.goto('./');
  const search = page.locator('[data-input="search"]');
  await search.click();
  await search.pressSequentially('DEMO-V', {delay: 20});
  await page.waitForTimeout(400);
  await expect(search).toBeFocused();
  expect(await search.evaluate(el => el.selectionStart)).toBe(6);
  await expect(page.locator('tr[data-symbol]')).toHaveCount(1);
  await page.locator('.sidebar [data-tab="charts"]').click();
  await expect(page.locator('#main h1')).toBeFocused();
  await page.locator('.sidebar [data-tab="screener"]').click();
  await expect(page.locator('#main h1')).toBeFocused();
});

test('item 7: Chart Lab View as table shows the latest 50 bars', async ({page}) => {
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  const toggle = page.getByRole('button', {name: 'View as table'});
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const table = page.locator('.chart-bars-table');
  await expect(table).toBeVisible();
  await expect(table.locator('caption')).toContainText('DEMO-SPY');
  await expect(table.locator('caption')).toContainText('50 bars');
  await expect(table.locator('tbody tr')).toHaveCount(50);
  const lastRow = await table.locator('tbody tr').last().innerText();
  const readout = await page.locator('#readout').innerText();
  const close = readout.match(/C ([+\-]?[\d,]+\.\d{2})/)?.[1];
  expect(lastRow).toContain(close.replace(/^[+-]/, ''));
  await expect(page.locator('#price-chart canvas')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
});

test('item 8: sort button names its order; spot marker is an image with a label', async ({page}) => {
  await page.goto('./');
  const sort = page.locator('[data-action="sort-order"]');
  await expect(sort).toHaveAttribute('aria-label', 'Sort order, currently ascending');
  await sort.click();
  await expect(sort).toHaveAttribute('aria-label', 'Sort order, currently descending');
  await page.locator('.sidebar [data-tab="options"]').click();
  const builder = page.locator('#options-builder');
  await builder.getByLabel('Underlying reference price').fill('100');
  await builder.getByRole('button', {name: 'Add manual leg'}).click();
  const spot = builder.locator('.options-strike-spot');
  await expect(spot).toHaveAttribute('role', 'img');
  await expect(spot).toHaveAttribute('aria-label', 'Underlying $100.00');
});

test('item 9: chart and dialog controls are at least 44px tall', async ({page}) => {
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  for (const btn of await page.locator('.chart-ranges .btn').all()) {
    expect(await btn.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  }
  await page.locator('.chart-indicator-gear').first().click();
  const dialogBtn = page.locator('#chart-indicator-dialog .chart-dialog-actions button').first();
  await expect(dialogBtn).toBeVisible();
  expect(await dialogBtn.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Escape');
  await page.locator('.sidebar [data-tab="options"]').click();
  const builder = page.locator('#options-builder');
  await builder.getByRole('button', {name: 'Add manual leg'}).click();
  const legInput = builder.locator('.options-legs input').first();
  expect(await legInput.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
});

test('item 10: destructive actions confirm first — cancel keeps data, confirm proceeds', async ({page}) => {
  await page.goto('./');
  await page.locator('[data-input="scan-name"]').fill('round27 keep me');
  await page.locator('[data-action="save-scan"]').click();
  await expect(page.locator('[data-option="saved-scan-select"] option', {hasText: 'round27 keep me'})).toHaveCount(1);
  const savedId = await page.locator('[data-option="saved-scan-select"] option', {hasText: 'round27 keep me'}).first().getAttribute('value');
  await page.locator('[data-option="saved-scan-select"]').selectOption(savedId);
  page.once('dialog', d => { expect(d.message()).toMatch(/Delete saved scan/); d.dismiss(); });
  await page.locator('[data-action="delete-scan"]').click();
  await expect(page.locator('[data-option="saved-scan-select"] option', {hasText: 'round27 keep me'})).toHaveCount(1);
  page.once('dialog', d => { expect(d.message()).toMatch(/Delete saved scan/); d.accept(); });
  await page.locator('[data-action="delete-scan"]').click();
  await expect(page.locator('[data-option="saved-scan-select"] option', {hasText: 'round27 keep me'})).toHaveCount(0);
  // Clear price lines asks first and does nothing when cancelled.
  await page.locator('.sidebar [data-tab="charts"]').click();
  await page.locator('.chart-tools > summary').click();
  let clearMessage = '';
  page.once('dialog', d => { clearMessage = d.message(); d.dismiss(); });
  await page.locator('[data-action="clear-lines"]').click();
  expect(clearMessage).toMatch(/Clear.*price lines/i);
});

test('item 11: Import CSV visible at 600px, status visible at 400px, no bare metric labels', async ({page}) => {
  await page.setViewportSize({width: 600, height: 900});
  await page.goto('./');
  await expect(page.locator('.top-actions [data-action="import"]')).toBeVisible();
  await page.setViewportSize({width: 400, height: 900});
  await expect(page.locator('.topbar .status')).toBeVisible();
  await expect(page.locator('#screener-metrics label')).toHaveCount(0);
});

test('item 12: pill is fully round and panel radius uses the token', async ({page}) => {
  await page.goto('./');
  const pillRadius = await page.locator('.pill').first().evaluate(el => getComputedStyle(el).borderRadius);
  expect(pillRadius).toBe('999px');
  const panelRadius = await page.locator('.panel').first().evaluate(el => getComputedStyle(el).borderRadius);
  expect(panelRadius).toBe('4px');
});

test('item 14a: quick-add buttons are primary, preset select is capped, search placeholder is short', async ({page}) => {
  await page.goto('./');
  await page.locator('.sidebar [data-tab="options"]').click();
  const builder = page.locator('#options-builder');
  for (const name of ['+ Buy Call', '+ Sell Call', '+ Buy Put', '+ Sell Put']) {
    await expect(builder.getByRole('button', {name, exact: true})).toHaveClass(/primary/);
  }
  const presetWidth = await builder.locator('.options-preset').evaluate(el => el.getBoundingClientRect().width);
  expect(presetWidth).toBeLessThanOrEqual(260);
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await expect(page.locator('.symbol-search')).toHaveAttribute('placeholder', 'Search 4 tickers');
});

test('item 14c: chain marks the ATM strike on both sides and shows the underlying', async ({page}) => {
  const expiry = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
  const time = new Date().toISOString();
  await page.route('**/api/options/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/device')) return route.fulfill({status: 204});
    if (url.pathname.endsWith('/expirations')) return route.fulfill({json: {
      feed: 'indicative', expirations: [expiry], underlying: {value: 500, time, feed: 'IEX'}}});
    if (url.pathname.endsWith('/chain')) return route.fulfill({json: {feed: 'indicative', contracts: [
      {symbol: 'SPY1C', root: 'SPY', type: 'call', expiry, strike: 495, multiplier: 100, quote: {bid: 1, ask: 2, time, iv: .2}},
      {symbol: 'SPY2C', root: 'SPY', type: 'call', expiry, strike: 500, multiplier: 100, quote: {bid: 1, ask: 2, time, iv: .2}},
      {symbol: 'SPY3C', root: 'SPY', type: 'call', expiry, strike: 505, multiplier: 100, quote: {bid: 1, ask: 2, time, iv: .2}},
      {symbol: 'SPY1P', root: 'SPY', type: 'put', expiry, strike: 495, multiplier: 100, quote: {bid: 1, ask: 2, time, iv: .2}},
      {symbol: 'SPY2P', root: 'SPY', type: 'put', expiry, strike: 500, multiplier: 100, quote: {bid: 1, ask: 2, time, iv: .2}},
      {symbol: 'SPY3P', root: 'SPY', type: 'put', expiry, strike: 505, multiplier: 100, quote: {bid: 1, ask: 2, time, iv: .2}},
    ]}});
    return route.fulfill({json: {feed: 'indicative', quotes: {}}});
  });
  await page.goto('./#options-setup=' + 'b'.repeat(64));
  const builder = page.locator('#options-builder');
  await expect(builder.locator('[data-ob="chain"] tr')).toHaveCount(6);
  await expect(builder.locator('[data-ob="chain"] .options-atm')).toHaveCount(2);
  await expect(builder.locator('[data-ob="chain-spot"]')).toHaveText('Underlying $500.00');
});

// Regression tests for the deferred changes; exercise actual behavior, not timer sleeps alone.
test('mobile More closes on tab navigation and can reopen', async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('./');
  const more=page.locator('.mobile-more');
  await more.locator('summary').click();
  await more.locator('[data-tab="options"]').click();
  await expect(more).not.toHaveAttribute('open','');
  await expect(page.locator('#options-builder')).toBeVisible();
  await expect(page.locator('#main .screener-results')).toHaveCount(0);
  await more.locator('summary').click();
  await more.locator('[data-tab="scripts"]').click();
  await expect(page.getByRole('heading',{name:'Script Lab',exact:true})).toBeVisible();
});
test('debounced search retains its DOM node and never redirects focus after navigating',async ({page})=>{
  await page.goto('./');
  const search=page.getByRole('textbox',{name:'Search symbols'});
  await search.evaluate(el=>{window.__round27Search=el;});
  await search.fill('DEMO-V');
  await expect(page.locator('tr[data-symbol]')).toHaveCount(1);
  expect(await search.evaluate(el=>el===window.__round27Search)).toBe(true);
  await expect(search).toBeFocused();
  await search.fill('DEMO');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await expect(page.locator('#main h1')).toBeFocused();
  await page.waitForTimeout(200);
  await expect(page.locator('#main h1')).toBeFocused();
});
