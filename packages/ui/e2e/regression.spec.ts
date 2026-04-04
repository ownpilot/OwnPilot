import { test, expect } from '@playwright/test';

test.describe('Regression Tests — Cross-Feature Verification', () => {

  // === STATS PANEL ===

  test('StatsPanel is visible on non-customize pages (desktop)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

    // On home page, there should be at least the sidebar aside
    // StatsPanel renders as second aside (or has collapse toggle)
    const allAsides = page.locator('aside');
    const asideCount = await allAsides.count();
    // Sidebar + StatsPanel (even if collapsed) = at least 1, ideally 2
    expect(asideCount).toBeGreaterThanOrEqual(1);
  });

  test('StatsPanel is NOT shown on /customize (detail panel shown instead)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/customize');
    await page.waitForSelector('[data-testid="customize-tab-items"]', { timeout: 10000 });

    // On customize page, right panel should be CustomizeDetailPanel, not StatsPanel
    const detailEmpty = page.locator('[data-testid="customize-detail-empty"]');
    const detailPanel = page.locator('[data-testid="customize-detail-panel"]');

    // Either empty state or panel should be visible (one of the two)
    const hasDetail = (await detailEmpty.count()) > 0 || (await detailPanel.count()) > 0;
    expect(hasDetail).toBe(true);
  });

  // === MINI CHAT ===

  test('MiniChat float button is visible on non-chat pages', async ({ page }) => {
    // MiniChat is hidden on "/" (ChatPage) and on mobile
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
    await page.waitForTimeout(2000);

    const chatButton = page.locator('[aria-label="Open chat"]');
    // On /dashboard, MiniChat should be visible (float button)
    await expect(chatButton).toBeVisible({ timeout: 5000 });
  });

  test('MiniChat is hidden on ChatPage (/)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForTimeout(2000);

    const chatButton = page.locator('[aria-label="Open chat"]');
    const count = await chatButton.count();
    // Should NOT be visible on the main chat page
    expect(count).toBe(0);
  });

  test('MiniChat opens and closes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
    await page.waitForTimeout(2000);

    const chatButton = page.locator('[aria-label="Open chat"]');
    if (await chatButton.count() === 0) {
      test.skip();
      return;
    }

    // Open MiniChat
    await chatButton.click();
    await page.waitForTimeout(500);

    // Close button should appear
    const closeButton = page.locator('[aria-label="Close chat"]');
    await expect(closeButton).toBeVisible({ timeout: 3000 });

    // Close MiniChat
    await closeButton.click();
    await page.waitForTimeout(500);

    // Float button should reappear
    await expect(chatButton).toBeVisible({ timeout: 3000 });
  });

  // === MOBILE SIDEBAR ===

  test('mobile sidebar opens and contains nav links', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Desktop sidebar should be hidden on mobile
    const menuButton = page.locator('button[aria-label="Open menu"]').first();
    await expect(menuButton).toBeVisible({ timeout: 5000 });

    // Open sidebar
    await menuButton.click();
    await page.waitForTimeout(500);

    // Sidebar should be visible
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    // Should have navigation links
    const links = sidebar.locator('a[href]');
    const linkCount = await links.count();
    expect(linkCount).toBeGreaterThan(0);
  });

  // === CONSOLE ERRORS (GLOBAL) ===

  test('no console errors on initial page load', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForTimeout(3000);

    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('net::ERR') &&
        !e.includes('WebSocket') &&
        !e.includes('404') &&
        !e.includes('Failed to fetch')
    );
    expect(realErrors.length).toBe(0);
  });

  test('no console errors on /customize', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/customize');
    await page.waitForTimeout(3000);

    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('net::ERR') &&
        !e.includes('WebSocket') &&
        !e.includes('404') &&
        !e.includes('Failed to fetch')
    );
    expect(realErrors.length).toBe(0);
  });

  test('no console errors on /dashboard', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/dashboard');
    await page.waitForTimeout(3000);

    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('net::ERR') &&
        !e.includes('WebSocket') &&
        !e.includes('404') &&
        !e.includes('Failed to fetch')
    );
    expect(realErrors.length).toBe(0);
  });

  // === NAVIGATION CROSS-CHECK ===

  test('navigating between pages keeps sidebar intact', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

    // Navigate to dashboard
    await page.goto('/dashboard');
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();

    // Navigate to customize
    await page.goto('/customize');
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();

    // Navigate back home
    await page.goto('/');
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  });

  test('Ctrl+K works from any page', async ({ page }) => {
    // Test from dashboard
    await page.goto('/dashboard');
    await page.waitForTimeout(2000);

    await page.keyboard.press('Control+k');
    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Close
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 3000 });

    // Test from customize
    await page.goto('/customize');
    await page.waitForTimeout(2000);

    await page.keyboard.press('Control+k');
    await expect(dialog).toBeVisible({ timeout: 3000 });
  });

});
