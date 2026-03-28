import { test as setup } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(__dirname, '../playwright/.auth/user.json');
const TEST_PASSWORD = 'OwnPilot2026!';

setup('authenticate', async ({ page }) => {
  // Navigate to login page
  await page.goto('/login');

  // Wait for login form to render
  await page.waitForSelector('input[type="password"], input[placeholder*="assword"]', {
    timeout: 10000,
  });

  // Fill password
  const passwordInput = page.locator('input[type="password"], input[placeholder*="assword"]').first();
  await passwordInput.fill(TEST_PASSWORD);

  // Click sign in button
  const signInButton = page.locator('button:has-text("Sign In"), button:has-text("Login"), button[type="submit"]').first();
  await signInButton.click();

  // Wait for redirect away from login (auth success)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10000 });

  // Wait for sidebar to render (confirms app is loaded)
  await page.waitForTimeout(2000);

  // Save authenticated state (cookies + localStorage)
  await page.context().storageState({ path: authFile });
});
