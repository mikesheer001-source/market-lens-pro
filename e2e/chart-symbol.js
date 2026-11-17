export async function chooseSymbol(page,symbol){
  const picker=page.locator('[data-action="chart-symbol-picker"]');
  if(await picker.count()){
    await picker.click();
    const dialog=page.locator('#chart-symbol-dialog');
    await dialog.getByRole('searchbox').fill(symbol);
    await dialog.getByRole('button',{name:symbol,exact:true}).click();
  }else await page.locator('[data-option="symbol"]').selectOption(symbol);
}
