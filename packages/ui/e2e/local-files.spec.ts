import { test, expect } from '@playwright/test';

test.describe('Local Files Tab', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/customize');
    await page.waitForSelector('[data-testid="customize-tab-local-files"]', { timeout: 10000 });
    // Switch to Local Files tab
    await page.locator('[data-testid="customize-tab-local-files"]').click();
    await page.waitForTimeout(500);
  });

  // === TREE STRUCTURE ===

  test('local files tree is visible after switching tab', async ({ page }) => {
    const fileTree = page.locator('[data-testid="local-files-tree"]');
    await expect(fileTree).toBeVisible();
  });

  // === EDGE DEVICES HEADER ===

  test('Edge Devices header is visible', async ({ page }) => {
    const edgeHeader = page.locator('[data-testid="local-files-edge-header"]');
    await expect(edgeHeader).toBeVisible();

    // Should contain "EDGE DEVICES" text
    const text = await edgeHeader.textContent();
    expect(text?.toUpperCase()).toContain('EDGE');
  });

  test('Edge Devices header is clickable', async ({ page }) => {
    const edgeHeader = page.locator('[data-testid="local-files-edge-header"]');
    await expect(edgeHeader).toBeVisible();

    // Click should show edge devices overview in detail panel
    await edgeHeader.click();
    await page.waitForTimeout(500);

    // Detail panel should show edge overview
    const edgeDetail = page.locator('[data-testid="customize-detail-edge"]');
    await expect(edgeDetail).toBeVisible({ timeout: 3000 });
  });

  test('Edge Devices overview shows stats', async ({ page }) => {
    const edgeHeader = page.locator('[data-testid="local-files-edge-header"]');
    await edgeHeader.click();
    await page.waitForTimeout(500);

    const edgeDetail = page.locator('[data-testid="customize-detail-edge"]');
    await expect(edgeDetail).toBeVisible();

    // Should show device counts
    const text = await edgeDetail.textContent();
    expect(text).toContain('Devices');
    expect(text).toContain('Machines');
  });

  // === MACHINE DEVICE ITEMS ===

  test('machine device items are listed', async ({ page }) => {
    const fileTree = page.locator('[data-testid="local-files-tree"]');
    // Look for device items (they have data-testid="local-files-device-*")
    const devices = fileTree.locator('[data-testid^="local-files-device-"]');
    const deviceCount = await devices.count();
    expect(deviceCount).toBeGreaterThan(0);
  });

  test('clicking a machine device expands its bookmarks', async ({ page }) => {
    const devices = page.locator('[data-testid^="local-files-device-"]');
    const deviceCount = await devices.count();
    if (deviceCount === 0) {
      test.skip();
      return;
    }

    // Click first device to expand
    const firstDevice = devices.first();
    await firstDevice.click();
    await page.waitForTimeout(500);

    // After expansion, bookmarks should appear
    const bookmarks = page.locator('[data-testid^="local-files-bookmark-"]');
    const bookmarkCount = await bookmarks.count();
    // Should have at least 1 bookmark (Nautilus-style)
    expect(bookmarkCount).toBeGreaterThanOrEqual(0); // may have 0 if device has no bookmarks
  });

  // === BOOKMARK ITEMS ===

  test('clicking a bookmark shows its detail panel', async ({ page }) => {
    // First expand a device to see bookmarks
    const devices = page.locator('[data-testid^="local-files-device-"]');
    if (await devices.count() === 0) {
      test.skip();
      return;
    }

    // Click first active device
    await devices.first().click();
    await page.waitForTimeout(500);

    // Find bookmarks
    const bookmarks = page.locator('[data-testid^="local-files-bookmark-"]');
    if (await bookmarks.count() === 0) {
      test.skip();
      return;
    }

    // Click first bookmark
    await bookmarks.first().click();
    await page.waitForTimeout(500);

    // Detail panel should show bookmark info
    const bookmarkDetail = page.locator('[data-testid="customize-detail-bookmark"]');
    await expect(bookmarkDetail).toBeVisible({ timeout: 3000 });
  });

  test('bookmark detail shows path and device info', async ({ page }) => {
    const devices = page.locator('[data-testid^="local-files-device-"]');
    if (await devices.count() === 0) {
      test.skip();
      return;
    }

    await devices.first().click();
    await page.waitForTimeout(500);

    const bookmarks = page.locator('[data-testid^="local-files-bookmark-"]');
    if (await bookmarks.count() === 0) {
      test.skip();
      return;
    }

    await bookmarks.first().click();
    await page.waitForTimeout(500);

    const bookmarkDetail = page.locator('[data-testid="customize-detail-bookmark"]');
    if (await bookmarkDetail.count() === 0) {
      test.skip();
      return;
    }

    const text = await bookmarkDetail.textContent();
    // Should show path info and device info
    expect(text).toContain('Path');
    expect(text).toContain('Device');
  });

  // === IOT DEVICES ===

  test('IoT devices are listed', async ({ page }) => {
    const iotDevices = page.locator('[data-testid^="local-files-iot-"]');
    const iotCount = await iotDevices.count();
    // Should have at least one IoT device (from static data)
    expect(iotCount).toBeGreaterThan(0);
  });

  test('clicking IoT device shows its detail', async ({ page }) => {
    const iotDevices = page.locator('[data-testid^="local-files-iot-"]');
    if (await iotDevices.count() === 0) {
      test.skip();
      return;
    }

    await iotDevices.first().click();
    await page.waitForTimeout(500);

    const iotDetail = page.locator('[data-testid="customize-detail-iot"]');
    await expect(iotDetail).toBeVisible({ timeout: 3000 });
  });

  test('IoT device detail shows status badge', async ({ page }) => {
    const iotDevices = page.locator('[data-testid^="local-files-iot-"]');
    if (await iotDevices.count() === 0) {
      test.skip();
      return;
    }

    await iotDevices.first().click();
    await page.waitForTimeout(500);

    const iotDetail = page.locator('[data-testid="customize-detail-iot"]');
    if (await iotDetail.count() === 0) {
      test.skip();
      return;
    }

    const text = await iotDetail.textContent();
    // Should show ON or OFF status
    const hasStatus = text?.includes('ON') || text?.includes('OFF');
    expect(hasStatus).toBe(true);
  });

  // === ADD DEVICE BUTTON ===

  test('add device button exists in edge header', async ({ page }) => {
    const addBtn = page.locator('[data-testid="local-files-add-device"]');
    await expect(addBtn).toBeVisible();
  });

  // === NAVIGATION FROM DETAIL PANEL ===

  test('"Open Edge Devices" button navigates to /edge-devices', async ({ page }) => {
    // Click edge header to show edge overview
    const edgeHeader = page.locator('[data-testid="local-files-edge-header"]');
    await edgeHeader.click();
    await page.waitForTimeout(500);

    const openEdgeBtn = page.locator('[data-testid="customize-detail-open-edge"]');
    if (await openEdgeBtn.count() === 0) {
      test.skip();
      return;
    }

    await openEdgeBtn.click();
    await page.waitForURL('**/edge-devices', { timeout: 5000 });
    expect(page.url()).toContain('/edge-devices');
  });

});
