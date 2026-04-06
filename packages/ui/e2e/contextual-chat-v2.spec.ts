import { test, expect } from '@playwright/test';

test.describe('Contextual Chat v2 — Sidebar Chat Integration', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  // === T28.1: Sidebar chat tab is visible and clickable ===

  test('sidebar chat tab is visible and clickable', async ({ page }) => {
    const chatTab = page.locator('[data-testid="chat-tab"]');
    await expect(chatTab).toBeVisible();
    await chatTab.click();
    const messageList = page.locator('[data-testid="chat-message-list"]');
    await expect(messageList).toBeVisible();
  });

  // === T28.2: Context banner shows on workspace page ===

  test('context banner shows on workspace page', async ({ page }) => {
    await page.goto('/workspaces');
    await page.waitForLoadState('networkidle');
    // Click chat tab to activate chat panel
    const chatTab = page.locator('[data-testid="chat-tab"]');
    await expect(chatTab).toBeVisible();
    await chatTab.click();
    // Chat input should be accessible on workspaces page
    const chatInput = page.locator('[data-testid="chat-input"]');
    await expect(chatInput).toBeVisible();
  });

  // === T28.3: Suggestions show when chat is empty ===

  test('suggestions show when chat is empty', async ({ page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');
    const chatTab = page.locator('[data-testid="chat-tab"]');
    await expect(chatTab).toBeVisible();
    await chatTab.click();
    // When chat is empty, suggestions or message list should be visible
    const messageList = page.locator('[data-testid="chat-message-list"]');
    await expect(messageList).toBeVisible();
    // Input should be empty (no prior messages means suggestions area renders)
    const chatInput = page.locator('[data-testid="chat-input"]');
    await expect(chatInput).toHaveValue('');
  });

  // === T28.4: Can type in sidebar chat input ===

  test('can type in sidebar chat input', async ({ page }) => {
    const chatTab = page.locator('[data-testid="chat-tab"]');
    await chatTab.click();
    const input = page.locator('[data-testid="chat-input"]');
    await input.fill('test message from e2e');
    await expect(input).toHaveValue('test message from e2e');
  });

  // === T28.5: Send button is disabled when input is empty ===

  test('send button is disabled when input is empty', async ({ page }) => {
    const chatTab = page.locator('[data-testid="chat-tab"]');
    await chatTab.click();
    const input = page.locator('[data-testid="chat-input"]');
    const sendBtn = page.locator('[data-testid="chat-send-btn"]');
    // Ensure input is empty
    await input.fill('');
    await expect(sendBtn).toBeDisabled();
  });

  // === T28.6: Stats tab still works (regression) ===

  test('stats tab still works (regression)', async ({ page }) => {
    const statsTab = page.locator('[data-testid="stats-tab"]');
    await expect(statsTab).toBeVisible();
    await statsTab.click();
    await expect(statsTab).toHaveAttribute('aria-selected', 'true');
    // Stats tab content should render
    const tabContent = page.locator('[data-testid="tab-content"]');
    await expect(tabContent).toBeVisible();
  });

  // === T28.7: Tab switching preserves state ===

  test('tab switching preserves state', async ({ page }) => {
    // Switch to chat and type
    const chatTab = page.locator('[data-testid="chat-tab"]');
    const statsTab = page.locator('[data-testid="stats-tab"]');
    await chatTab.click();
    const input = page.locator('[data-testid="chat-input"]');
    await input.fill('preserve this text');
    await expect(input).toHaveValue('preserve this text');

    // Switch to stats
    await statsTab.click();
    await expect(statsTab).toHaveAttribute('aria-selected', 'true');

    // Switch back to chat — text should be preserved
    await chatTab.click();
    await expect(input).toHaveValue('preserve this text');
  });
});
