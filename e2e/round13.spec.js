import {test,expect} from '@playwright/test';

for(const tab of ['briefing','volatility']){
  test('saved '+tab+' preference opens Screener after tab removal',async ({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.addInitScript(removed=>localStorage.setItem('market-lens-pro-settings',JSON.stringify({tab:removed})),tab);
    await page.goto('./');
    await expect(page.getByRole('heading',{name:'Screener',exact:true})).toBeVisible();
    await page.locator('.mobile-more summary').click();
    await expect(page.locator('[data-tab="briefing"], [data-tab="volatility"]')).toHaveCount(0);
    await page.locator('.mobile-more summary').click();
    await page.locator('[data-option="preset"]').selectOption('volatility');
    await expect(page.locator('.screener-results tr[data-symbol]')).toHaveCount(1);
    await expect(page.locator('.screener-results tr[data-symbol]')).toHaveAttribute('data-symbol','DEMO-VXX');
  });
}
