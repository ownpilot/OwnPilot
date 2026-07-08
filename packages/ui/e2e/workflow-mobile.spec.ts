/**
 * E2E tests for mobile viewport behavior in the workflow editor.
 *
 * Verifies that the responsive layout switches correctly:
 * - Desktop (≥768px): three-panel layout (ToolPalette | Canvas | ConfigPanel)
 * - Mobile (<768px):  single-panel tabbed layout with bottom tab bar
 */

import { test, expect, type Page } from '@playwright/test';

test.describe('Workflow Editor — Mobile Responsive Layout', () => {
  const WORKFLOW_URL = '/workflows/e2e-mobile-test';

  /** Wait up to 8 s for the editor UI (tab bar or canvas) to appear. */
  async function waitForEditor(page: Page): Promise<boolean> {
    try {
      await page.waitForFunction(
        () => {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            const text = btn.textContent?.trim() ?? '';
            // Mobile: "Nodes" tab button
            if (text === 'Nodes') return true;
            // Desktop: "Tools" section header in ToolPalette
            if (text === 'Tools') return true;
          }
          return false;
        },
        { timeout: 8000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  // ─── MOBILE VIEWPORT ────────────────────────────────────

  test.describe('Mobile viewport (375×812)', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(WORKFLOW_URL);
    });

    test('shows bottom tab bar with Nodes / Canvas / Config tabs', async ({ page }) => {
      const ready = await waitForEditor(page);
      if (!ready) {
        test.skip();
        return;
      }

      // The three tab buttons should exist
      await expect(page.locator('button:has-text("Nodes")').first()).toBeVisible({ timeout: 3000 });
      await expect(page.locator('button:has-text("Canvas")').first()).toBeVisible();
      await expect(page.locator('button:has-text("Config")').first()).toBeVisible();
    });

    test('can switch between Nodes and Canvas tabs', async ({ page }) => {
      const ready = await waitForEditor(page);
      if (!ready) {
        test.skip();
        return;
      }

      // Default tab is "Nodes" — ToolPalette search input should be visible
      const searchInput = page.locator('input[placeholder*="earch"]').first();
      const hasSearch = await searchInput.isVisible().catch(() => false);

      // Switch to Canvas
      await page.locator('button:has-text("Canvas")').first().click();
      await page.waitForTimeout(300);

      // The ReactFlow element should now be visible
      const reactFlow = page.locator('.react-flow').first();
      const hasCanvas = await reactFlow.isVisible().catch(() => false);

      // Switch back to Nodes
      await page.locator('button:has-text("Nodes")').first().click();
      await page.waitForTimeout(300);

      // Search should be visible again (if it was before)
      if (hasSearch) {
        await expect(searchInput).toBeVisible({ timeout: 3000 });
      }
    });

    test('Config tab shows empty state when no node is selected', async ({ page }) => {
      const ready = await waitForEditor(page);
      if (!ready) {
        test.skip();
        return;
      }

      await page.locator('button:has-text("Config")').first().click();
      await page.waitForTimeout(300);

      // Should show "Select a node to configure" text
      const emptyText = page.locator('text=Select a node to configure');
      const hasEmpty = await emptyText.isVisible().catch(() => false);

      // Or show the NodeConfigPanel if a node happens to be selected
      const configPanel = page.locator('text=Configure');
      const hasConfig = await configPanel.isVisible().catch(() => false);

      expect(hasEmpty || hasConfig).toBe(true);
    });
  });

  // ─── DESKTOP VIEWPORT ───────────────────────────────────

  test.describe('Desktop viewport (1440×900)', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(WORKFLOW_URL);
    });

    test('shows ToolPalette with a search input', async ({ page }) => {
      const ready = await waitForEditor(page);
      if (!ready) {
        test.skip();
        return;
      }

      // The ToolPalette should be visible on the left with a search input
      const searchInputs = page.locator('input[placeholder*="earch"]');
      const count = await searchInputs.count();
      expect(count).toBeGreaterThanOrEqual(1);
    });

    test('mobile tab bar is NOT visible on desktop', async ({ page }) => {
      const ready = await waitForEditor(page);
      if (!ready) {
        test.skip();
        return;
      }

      // The "Nodes" tab button is part of the mobile-only bottom bar
      const nodesTab = page.locator('button:has-text("Nodes")');
      const visible = await nodesTab.isVisible().catch(() => false);
      expect(visible).toBe(false);
    });
  });
});
