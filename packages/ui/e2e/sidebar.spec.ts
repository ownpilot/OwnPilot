import { test, expect } from '@playwright/test';

test.describe('Sidebar — Structure & Navigation', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });
  });

  // === WIDTH & STRUCTURE ===

  test('sidebar has w-60 class (240px width)', async ({ page }) => {
    const sidebar = page.locator('[data-testid="sidebar"]');
    await expect(sidebar).toBeVisible();
    // w-60 = 240px in Tailwind
    await expect(sidebar).toHaveClass(/w-60/);
  });

  test('sidebar renders pinned items section', async ({ page }) => {
    const pinnedSection = page.locator('[data-testid="sidebar-pinned-items"]');
    await expect(pinnedSection).toBeVisible();
    // Default pinned: Chat (/) and Dashboard (/dashboard)
    const chatLink = pinnedSection.locator('a[href="/"]');
    await expect(chatLink.first()).toBeVisible();
    const dashboardLink = pinnedSection.locator('a[href="/dashboard"]');
    await expect(dashboardLink.first()).toBeVisible();
  });

  // === SEARCH BUTTON ===

  test('search button is visible in sidebar', async ({ page }) => {
    const searchBtn = page.locator('[data-testid="sidebar-search-btn"]');
    await expect(searchBtn).toBeVisible();
  });

  test('clicking search button opens global search overlay', async ({ page }) => {
    const searchBtn = page.locator('[data-testid="sidebar-search-btn"]');
    await searchBtn.click();
    // GlobalSearchOverlay uses role="dialog" aria-modal="true"
    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible({ timeout: 3000 });
  });

  // === SCHEDULED LINK ===

  test('Scheduled link is visible and navigates to /calendar', async ({ page }) => {
    const scheduledLink = page.locator('[data-testid="sidebar-scheduled-link"]');
    await expect(scheduledLink).toBeVisible();
    await scheduledLink.click();
    await page.waitForURL('**/calendar', { timeout: 5000 });
    expect(page.url()).toContain('/calendar');
  });

  // === PROJECTS SECTION ===

  test('Projects section header is visible', async ({ page }) => {
    const projectsSection = page.locator('[data-testid="sidebar-projects"]');
    await expect(projectsSection).toBeVisible();
  });

  test('Projects section shows items or empty state', async ({ page }) => {
    const projectsSection = page.locator('[data-testid="sidebar-projects"]');
    await expect(projectsSection).toBeVisible();
    // Either has project links or shows "No projects" text
    const parent = projectsSection.locator('..');
    const textContent = await parent.textContent();
    expect(textContent).toBeTruthy();
  });

  // === WORKFLOWS SECTION ===

  test('Workflows section header is visible', async ({ page }) => {
    const workflowsSection = page.locator('[data-testid="sidebar-workflows"]');
    await expect(workflowsSection).toBeVisible();
  });

  test('Workflows section shows items or empty state', async ({ page }) => {
    const workflowsSection = page.locator('[data-testid="sidebar-workflows"]');
    await expect(workflowsSection).toBeVisible();
    const parent = workflowsSection.locator('..');
    const textContent = await parent.textContent();
    expect(textContent).toBeTruthy();
  });

  // === CUSTOMIZE LINK ===

  test('Customize link is always visible', async ({ page }) => {
    const customizeLink = page.locator('[data-testid="sidebar-customize-link"]');
    await expect(customizeLink).toBeVisible();
  });

  test('Customize link navigates to /customize', async ({ page }) => {
    const customizeLink = page.locator('[data-testid="sidebar-customize-link"]');
    await customizeLink.click();
    await page.waitForURL('**/customize', { timeout: 5000 });
    expect(page.url()).toContain('/customize');
  });

  // === RECENTS SECTION ===

  test('Recents section is present', async ({ page }) => {
    const recentsSection = page.locator('[data-testid="sidebar-recents"]');
    await expect(recentsSection).toBeVisible();
  });

  // === FOOTER ===

  test('sidebar footer with connection status is visible', async ({ page }) => {
    const footer = page.locator('[data-testid="sidebar-footer"]');
    await expect(footer).toBeVisible();
  });

  // === NAVIGATION ===

  test('clicking Dashboard link navigates correctly', async ({ page }) => {
    const dashboardLink = page.locator('[data-testid="sidebar-pinned-items"] a[href="/dashboard"]').first();
    await expect(dashboardLink).toBeVisible();
    await dashboardLink.click();
    await page.waitForURL('**/dashboard', { timeout: 5000 });
    expect(page.url()).toContain('/dashboard');
  });

  // === PINNED ITEMS COUNT ===

  test('sidebar has reasonable number of nav links (pinned, not 63)', async ({ page }) => {
    const sidebar = page.locator('[data-testid="sidebar"]');
    const navLinks = sidebar.locator('a[href]');
    const linkCount = await navLinks.count();
    expect(linkCount).toBeGreaterThan(0);
    expect(linkCount).toBeLessThan(25); // pinned items + sections, never 63
  });

  // === OLD COLLAPSIBLE GROUPS REMOVED ===

  test('old collapsible groups no longer exist', async ({ page }) => {
    const groupLabels = ['Personal Data', 'AI & Automation', 'Tools & Extensions', 'System', 'Experimental'];
    for (const label of groupLabels) {
      const count = await page.locator(`[data-testid="sidebar"] button:has-text("${label}")`).count();
      expect(count, `CollapsibleGroup "${label}" should not exist in sidebar`).toBe(0);
    }
  });

  // === MOBILE SIDEBAR ===

  test('mobile sidebar slide-in works at 375px width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Hamburger menu button should be visible
    const menuButton = page.locator('button[aria-label="Open menu"]').first();
    await expect(menuButton).toBeVisible({ timeout: 5000 });

    // Click to open sidebar
    await menuButton.click();
    await page.waitForTimeout(500);

    // Sidebar should slide in
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    // Should have nav links
    const navLinks = sidebar.locator('a[href]');
    const linkCount = await navLinks.count();
    expect(linkCount).toBeGreaterThan(0);
  });

  // === CONSOLE ERRORS ===

  test('no console errors on sidebar load', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Filter known harmless dev errors
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('net::ERR') && !e.includes('WebSocket') && !e.includes('404')
    );
    expect(realErrors.length).toBe(0);
  });

});
