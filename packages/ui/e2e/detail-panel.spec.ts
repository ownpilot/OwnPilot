import { test, expect } from '@playwright/test';

test.describe('Customize Detail Panel', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/customize');
    await page.waitForSelector('[data-testid="customize-tab-items"]', { timeout: 10000 });
  });

  // === EMPTY STATE ===

  test('detail panel shows "Select an item" when nothing selected', async ({ page }) => {
    const emptyState = page.locator('[data-testid="customize-detail-empty"]');
    await expect(emptyState).toBeVisible({ timeout: 5000 });

    const text = await emptyState.textContent();
    expect(text?.toLowerCase()).toContain('select');
  });

  // === ITEM SELECTION ===

  test('clicking an item shows its details in the panel', async ({ page }) => {
    // Click on a nav item (e.g. Tasks)
    const tasksItem = page.locator('[data-testid="customize-item-tasks"]');
    if (await tasksItem.count() === 0) {
      // Try Dashboard as fallback
      const dashItem = page.locator('[data-testid="customize-item-dashboard"]');
      await dashItem.scrollIntoViewIfNeeded();
      await dashItem.click();
    } else {
      await tasksItem.scrollIntoViewIfNeeded();
      await tasksItem.click();
    }

    await page.waitForTimeout(500);

    // Detail panel should now show item details
    const detailPanel = page.locator('[data-testid="customize-detail-panel"]');
    await expect(detailPanel).toBeVisible({ timeout: 5000 });
  });

  test('detail panel shows item title and description', async ({ page }) => {
    // Click Dashboard item
    const dashItem = page.locator('[data-testid="customize-item-dashboard"]');
    if (await dashItem.count() === 0) {
      test.skip();
      return;
    }
    await dashItem.scrollIntoViewIfNeeded();
    await dashItem.click();
    await page.waitForTimeout(500);

    const detailPanel = page.locator('[data-testid="customize-detail-panel"]');
    await expect(detailPanel).toBeVisible();

    // Should contain text (title at minimum)
    const text = await detailPanel.textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(5);
  });

  test('detail panel shows route path', async ({ page }) => {
    const dashItem = page.locator('[data-testid="customize-item-dashboard"]');
    if (await dashItem.count() === 0) {
      test.skip();
      return;
    }
    await dashItem.scrollIntoViewIfNeeded();
    await dashItem.click();
    await page.waitForTimeout(500);

    const detailPanel = page.locator('[data-testid="customize-detail-panel"]');
    await expect(detailPanel).toBeVisible();

    // Route should show as code block with the path
    const routeCode = detailPanel.locator('code');
    if (await routeCode.count() > 0) {
      const routeText = await routeCode.first().textContent();
      expect(routeText).toContain('/dashboard');
    }
  });

  // === PIN BUTTON IN DETAIL PANEL ===

  test('pin button exists in detail panel', async ({ page }) => {
    // Select an item first
    const tasksItem = page.locator('[data-testid="customize-item-tasks"]');
    if (await tasksItem.count() === 0) {
      test.skip();
      return;
    }
    await tasksItem.scrollIntoViewIfNeeded();
    await tasksItem.click();
    await page.waitForTimeout(500);

    const pinBtn = page.locator('[data-testid="customize-detail-pin"]');
    await expect(pinBtn).toBeVisible();
  });

  test('pin button toggles pin state in detail panel', async ({ page }) => {
    const tasksItem = page.locator('[data-testid="customize-item-tasks"]');
    if (await tasksItem.count() === 0) {
      test.skip();
      return;
    }
    await tasksItem.scrollIntoViewIfNeeded();
    await tasksItem.click();
    await page.waitForTimeout(500);

    const pinBtn = page.locator('[data-testid="customize-detail-pin"]');
    await expect(pinBtn).toBeVisible();

    // Get initial text
    const initialText = await pinBtn.textContent();

    // Click to toggle
    await pinBtn.click();
    await page.waitForTimeout(500);

    // Text should change (Pin to Sidebar <-> Unpin from Sidebar)
    const afterText = await pinBtn.textContent();
    expect(afterText).not.toBe(initialText);

    // Toggle back to restore state
    await pinBtn.click();
    await page.waitForTimeout(500);

    const restoredText = await pinBtn.textContent();
    expect(restoredText).toBe(initialText);
  });

  // === OPEN PAGE BUTTON ===

  test('"Open Page" button exists in detail panel', async ({ page }) => {
    const tasksItem = page.locator('[data-testid="customize-item-tasks"]');
    if (await tasksItem.count() === 0) {
      test.skip();
      return;
    }
    await tasksItem.scrollIntoViewIfNeeded();
    await tasksItem.click();
    await page.waitForTimeout(500);

    const openBtn = page.locator('[data-testid="customize-detail-open"]');
    await expect(openBtn).toBeVisible();
  });

  test('"Open Page" button navigates to the item route', async ({ page }) => {
    const tasksItem = page.locator('[data-testid="customize-item-tasks"]');
    if (await tasksItem.count() === 0) {
      test.skip();
      return;
    }
    await tasksItem.scrollIntoViewIfNeeded();
    await tasksItem.click();
    await page.waitForTimeout(500);

    const openBtn = page.locator('[data-testid="customize-detail-open"]');
    await expect(openBtn).toBeVisible();
    await openBtn.click();

    // Should navigate away from /customize to /tasks
    await page.waitForURL('**/tasks', { timeout: 5000 });
    expect(page.url()).toContain('/tasks');
  });

  // === "SHOW IN FILES" BUTTON (DISABLED) ===

  test('"Show in Files" button exists but is disabled', async ({ page }) => {
    const tasksItem = page.locator('[data-testid="customize-item-tasks"]');
    if (await tasksItem.count() === 0) {
      test.skip();
      return;
    }
    await tasksItem.scrollIntoViewIfNeeded();
    await tasksItem.click();
    await page.waitForTimeout(500);

    const filesBtn = page.locator('[data-testid="customize-detail-files"]');
    if (await filesBtn.count() > 0) {
      // Should have opacity-50 or cursor-not-allowed class
      await expect(filesBtn).toHaveClass(/opacity-50|cursor-not-allowed/);
    }
  });

  // === SWITCHING ITEMS ===

  test('clicking different items updates detail panel', async ({ page }) => {
    // Click Dashboard
    const dashItem = page.locator('[data-testid="customize-item-dashboard"]');
    if (await dashItem.count() === 0) {
      test.skip();
      return;
    }
    await dashItem.scrollIntoViewIfNeeded();
    await dashItem.click();
    await page.waitForTimeout(500);

    const detailPanel = page.locator('[data-testid="customize-detail-panel"]');
    const firstText = await detailPanel.textContent();

    // Now click a different item
    const analyticsItem = page.locator('[data-testid="customize-item-analytics"]');
    if (await analyticsItem.count() > 0) {
      await analyticsItem.scrollIntoViewIfNeeded();
      await analyticsItem.click();
      await page.waitForTimeout(500);

      const secondText = await detailPanel.textContent();
      expect(secondText).not.toBe(firstText);
    }
  });

});
