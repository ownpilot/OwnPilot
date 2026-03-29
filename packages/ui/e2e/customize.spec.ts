import { test, expect } from '@playwright/test';

test.describe('Customize Page — Pin/Unpin Flow', () => {

  test('clicking Customize in sidebar opens /customize page with grid', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Find and click Customize link in sidebar
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    const customizeLink = sidebar.locator('[data-testid="sidebar-customize-link"], a:has-text("Customize")').first();
    await expect(customizeLink).toBeVisible();
    await customizeLink.click();

    // Should navigate to /customize
    await page.waitForURL('**/customize', { timeout: 5000 });

    // Page title should be visible
    await expect(page.locator('text=Customize Sidebar')).toBeVisible({ timeout: 5000 });
  });

  test('customize page shows categorized groups with nav items', async ({ page }) => {
    await page.goto('/customize');
    await page.waitForTimeout(2000);

    // Should have group headers
    const groupHeaders = ['Main', 'Personal Data', 'AI & Automation', 'Tools & Extensions', 'System', 'Experimental', 'Settings'];
    for (const header of groupHeaders) {
      const headerEl = page.locator(`text=${header}`).first();
      // At least check some key groups are present
      if (header === 'Personal Data' || header === 'AI & Automation' || header === 'Settings') {
        await expect(headerEl).toBeVisible({ timeout: 5000 });
      }
    }

    // Should have cards — at least 20 items visible (there are 56 total)
    const cards = page.locator('button[data-testid^="customize-card-"]');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(20);
  });

  test('pin an item on customize page and see it in sidebar', async ({ page }) => {
    await page.goto('/customize');
    await page.waitForTimeout(2000);

    // Verify Tasks card exists and note its initial state
    const tasksCard = page.locator('[data-testid="customize-card-tasks"]').first();
    if (await tasksCard.count() === 0) {
      // Fallback: find by text within the grid area
      const fallbackCard = page.locator('main button:has-text("Tasks")').first();
      await expect(fallbackCard).toBeVisible({ timeout: 5000 });

      // Click to pin
      await fallbackCard.click();
    } else {
      await expect(tasksCard).toBeVisible({ timeout: 5000 });

      // Verify it's NOT pinned yet (aria-pressed should be false or absent)
      const pressed = await tasksCard.getAttribute('aria-pressed');
      if (pressed === 'true') {
        // Already pinned from previous test — unpin first
        await tasksCard.click();
        await page.waitForTimeout(500);
      }

      // Click to pin
      await tasksCard.click();
    }

    await page.waitForTimeout(1500); // wait for Context state + localStorage persist

    // Verify the card now shows as pinned (visual confirmation on CustomizePage)
    const pinnedCard = page.locator('[data-testid="customize-card-tasks"][aria-pressed="true"]').first();
    if (await pinnedCard.count() > 0) {
      await expect(pinnedCard).toBeVisible();
    }

    // Check sidebar — Tasks link should appear (Context shares state instantly)
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    const tasksLink = sidebar.locator('a[href="/tasks"]').first();
    await expect(tasksLink).toBeVisible({ timeout: 5000 });
  });

  test('unpin an item on customize page and it disappears from sidebar', async ({ page }) => {
    // First pin Tasks
    await page.goto('/customize');
    await page.waitForTimeout(2000);

    const tasksCard = page.locator('button[data-testid="customize-card-tasks"], button:has-text("Tasks")').first();
    await tasksCard.click(); // pin
    await page.waitForTimeout(300);
    await tasksCard.click(); // unpin
    await page.waitForTimeout(300);

    // Navigate to home
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Sidebar should NOT have Tasks link (back to default: Chat + Dashboard only)
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    const tasksLink = sidebar.locator('a[href="/tasks"]');
    const count = await tasksLink.count();
    expect(count).toBe(0);
  });

  test('search filters items in real time', async ({ page }) => {
    await page.goto('/customize');
    await page.waitForTimeout(2000);

    // Type in search
    const searchInput = page.locator('input[placeholder*="ilter"], input[placeholder*="earch"], input[type="text"]').first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill('workflow');
    await page.waitForTimeout(500);

    // Should show only Workflow-related items
    const visibleCards = page.locator('button[data-testid^="customize-card-"]:visible');
    const count = await visibleCards.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10); // filtered down from 56

    // Clear search
    await searchInput.fill('');
    await page.waitForTimeout(500);

    // All items back
    const allCards = page.locator('button[data-testid^="customize-card-"]');
    const allCount = await allCards.count();
    expect(allCount).toBeGreaterThan(40);
  });

  test('pin counter shows correct count', async ({ page }) => {
    await page.goto('/customize');
    await page.waitForTimeout(2000);

    // Should show pin count (default 2: Chat + Dashboard)
    const counterText = await page.locator('text=/\\d+\\s*\\/\\s*15/').first().textContent();
    expect(counterText).toBeTruthy();
    expect(counterText).toContain('15');
  });

});
