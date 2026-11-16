import {defineConfig} from '@playwright/test';
const deployedBase=process.env.PLAYWRIGHT_BASE_URL;
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 45000,
  retries: 0,
  reporter: 'list',
  use: {baseURL:deployedBase||'http://127.0.0.1:5173/market-lens-pro/',headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
  ...(!deployedBase?{webServer:{
    command:'npm run dev -- --port 5173',
    url:'http://127.0.0.1:5173/market-lens-pro/',
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  }}:{})
});
