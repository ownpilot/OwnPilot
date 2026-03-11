/**
 * Browser Service
 *
 * Headless browser automation via puppeteer-core.
 * Manages browser instance, page sessions per user, URL allowlist,
 * and PII-aware form filling.
 */

import type { Browser, Page } from 'puppeteer-core';
import { hasPII, detectPII, getLog } from '@ownpilot/core';
import { configServicesRepo } from '../db/repositories/config-services.js';
import { isBlockedUrl } from '../utils/ssrf.js';

const log = getLog('BrowserService');

import {
  BROWSER_MAX_PAGES,
  BROWSER_SESSION_TIMEOUT_MS,
  BROWSER_CLEANUP_INTERVAL_MS,
  BROWSER_NAVIGATION_TIMEOUT_MS,
  BROWSER_ACTION_TIMEOUT_MS,
  BROWSER_MAX_TEXT_LENGTH,
} from '../config/defaults.js';

const BROWSER_SERVICE = 'browser_service';
const MAX_PAGES_PER_USER = BROWSER_MAX_PAGES;
const SESSION_TIMEOUT_MS = BROWSER_SESSION_TIMEOUT_MS;
const CLEANUP_INTERVAL_MS = BROWSER_CLEANUP_INTERVAL_MS;
const DEFAULT_NAVIGATION_TIMEOUT = BROWSER_NAVIGATION_TIMEOUT_MS;
const DEFAULT_ACTION_TIMEOUT = BROWSER_ACTION_TIMEOUT_MS;
const MAX_TEXT_LENGTH = BROWSER_MAX_TEXT_LENGTH;

// ============================================================================
// Types
// ============================================================================

export interface BrowserAction {
  type: 'navigate' | 'click' | 'type' | 'screenshot' | 'extract' | 'wait' | 'scroll' | 'select';
  selector?: string;
  url?: string;
  text?: string;
  value?: string;
  timeout?: number;
}

export interface BrowserResult {
  success: boolean;
  screenshot?: string;
  extractedText?: string;
  extractedData?: Record<string, unknown>;
  url: string;
  title: string;
  error?: string;
}

export interface FormField {
  selector: string;
  value: string;
}

export interface ScreenshotOptions {
  fullPage?: boolean;
  selector?: string;
}

export interface BrowserConfigInfo {
  available: boolean;
  executablePath: string | null;
  allowedDomains: string[];
  maxPagesPerUser: number;
}

interface PageSession {
  page: Page;
  userId: string;
  createdAt: number;
  lastActivity: number;
}

// ============================================================================
// Service
// ============================================================================

export class BrowserService {
  private browser: Browser | null = null;
  private sessions = new Map<string, PageSession>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanupStaleSessions(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  // --------------------------------------------------------------------------
  // Availability
  // --------------------------------------------------------------------------

  async isAvailable(): Promise<boolean> {
    const execPath = this.findExecutablePath();
    return execPath !== null;
  }

  async getConfig(): Promise<BrowserConfigInfo> {
    const execPath = this.findExecutablePath();
    return {
      available: execPath !== null,
      executablePath: execPath,
      allowedDomains: this.getAllowedDomains(),
      maxPagesPerUser: MAX_PAGES_PER_USER,
    };
  }

  // --------------------------------------------------------------------------
  // Navigation
  // --------------------------------------------------------------------------

  async navigate(
    userId: string,
    url: string
  ): Promise<{ url: string; title: string; text: string }> {
    this.validateUrl(url);
    const page = await this.getOrCreatePage(userId);

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: DEFAULT_NAVIGATION_TIMEOUT,
    });

    const title = await page.title();
    const text = await this.getPageText(page);

    return { url: page.url(), title, text };
  }

  // --------------------------------------------------------------------------
  // Click
  // --------------------------------------------------------------------------

  async click(userId: string, selector: string): Promise<{ url: string; title: string }> {
    const page = await this.getExistingPage(userId);
    await page.waitForSelector(selector, { timeout: DEFAULT_ACTION_TIMEOUT });
    await page.click(selector);
    // Wait briefly for any navigation or DOM changes
    await new Promise((r) => setTimeout(r, 500));
    return { url: page.url(), title: await page.title() };
  }

  // --------------------------------------------------------------------------
  // Type
  // --------------------------------------------------------------------------

  async type(
    userId: string,
    selector: string,
    text: string
  ): Promise<{ url: string; title: string }> {
    const page = await this.getExistingPage(userId);
    await page.waitForSelector(selector, { timeout: DEFAULT_ACTION_TIMEOUT });
    // Clear existing value first
    await page.click(selector, { count: 3 });
    await page.type(selector, text);
    return { url: page.url(), title: await page.title() };
  }

  // --------------------------------------------------------------------------
  // Fill Form (PII-aware)
  // --------------------------------------------------------------------------

  async fillForm(
    userId: string,
    fields: FormField[]
  ): Promise<{ url: string; title: string; piiWarnings: string[] }> {
    const page = await this.getExistingPage(userId);
    const piiWarnings: string[] = [];

    for (const field of fields) {
      // Check for PII in field values
      if (hasPII(field.value)) {
        const detection = detectPII(field.value);
        const categories = detection.matches.map((m) => m.category).join(', ');
        piiWarnings.push(
          `Field "${field.selector}" contains potential PII (${categories}). Value was still filled.`
        );
      }

      await page.waitForSelector(field.selector, { timeout: DEFAULT_ACTION_TIMEOUT });
      await page.click(field.selector, { count: 3 });
      await page.type(field.selector, field.value);
    }

    return {
      url: page.url(),
      title: await page.title(),
      piiWarnings,
    };
  }

  // --------------------------------------------------------------------------
  // Screenshot
  // --------------------------------------------------------------------------

  async screenshot(
    userId: string,
    opts?: ScreenshotOptions
  ): Promise<{ screenshot: string; url: string; title: string }> {
    const page = await this.getExistingPage(userId);
    let buffer: Uint8Array;

    if (opts?.selector) {
      const element = await page.waitForSelector(opts.selector, {
        timeout: DEFAULT_ACTION_TIMEOUT,
      });
      if (!element) throw new Error(`Element not found: ${opts.selector}`);
      buffer = await element.screenshot({ type: 'png' });
    } else {
      buffer = await page.screenshot({
        type: 'png',
        fullPage: opts?.fullPage ?? false,
      });
    }

    return {
      screenshot: Buffer.from(buffer).toString('base64'),
      url: page.url(),
      title: await page.title(),
    };
  }

  // --------------------------------------------------------------------------
  // Extract Text
  // --------------------------------------------------------------------------

  async extractText(
    userId: string,
    selector?: string
  ): Promise<{ text: string; url: string; title: string }> {
    const page = await this.getExistingPage(userId);

    let text: string;
    if (selector) {
      await page.waitForSelector(selector, { timeout: DEFAULT_ACTION_TIMEOUT });
      text = await page.$eval(selector, (el) => el.textContent ?? '');
    } else {
      text = await this.getPageText(page);
    }

    return {
      text: text.substring(0, MAX_TEXT_LENGTH),
      url: page.url(),
      title: await page.title(),
    };
  }

  // --------------------------------------------------------------------------
  // Extract Structured Data
  // --------------------------------------------------------------------------

  async extractData(
    userId: string,
    selectors: Record<string, string>
  ): Promise<{ data: Record<string, string>; url: string; title: string }> {
    const page = await this.getExistingPage(userId);
    const data: Record<string, string> = {};

    for (const [key, selector] of Object.entries(selectors)) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        data[key] = await page.$eval(selector, (el) => el.textContent?.trim() ?? '');
      } catch {
        data[key] = '';
      }
    }

    return { data, url: page.url(), title: await page.title() };
  }

  // --------------------------------------------------------------------------
  // Wait
  // --------------------------------------------------------------------------

  async wait(
    userId: string,
    selector?: string,
    timeout?: number
  ): Promise<{ url: string; title: string }> {
    const page = await this.getExistingPage(userId);
    const ms = timeout ?? DEFAULT_ACTION_TIMEOUT;

    if (selector) {
      await page.waitForSelector(selector, { timeout: ms });
    } else {
      await new Promise((r) => setTimeout(r, Math.min(ms, 10_000)));
    }

    return { url: page.url(), title: await page.title() };
  }

  // --------------------------------------------------------------------------
  // Scroll
  // --------------------------------------------------------------------------

  async scroll(
    userId: string,
    direction: 'up' | 'down',
    pixels?: number
  ): Promise<{ url: string; title: string }> {
    const page = await this.getExistingPage(userId);
    const amount = pixels ?? 500;
    const y = direction === 'down' ? amount : -amount;
    await page.mouse.wheel({ deltaY: y });
    return { url: page.url(), title: await page.title() };
  }

  // --------------------------------------------------------------------------
  // Select
  // --------------------------------------------------------------------------

  async select(
    userId: string,
    selector: string,
    value: string
  ): Promise<{ url: string; title: string }> {
    const page = await this.getExistingPage(userId);
    await page.waitForSelector(selector, { timeout: DEFAULT_ACTION_TIMEOUT });
    await page.select(selector, value);
    return { url: page.url(), title: await page.title() };
  }

  // --------------------------------------------------------------------------
  // Session Management
  // --------------------------------------------------------------------------

  async closePage(userId: string): Promise<boolean> {
    const session = this.sessions.get(userId);
    if (!session) return false;

    try {
      await session.page.close();
    } catch {
      // Page may already be closed
    }
    this.sessions.delete(userId);
    return true;
  }

  getPageInfo(userId: string): { url: string; active: boolean } | null {
    const session = this.sessions.get(userId);
    if (!session) return null;
    return { url: session.page.url(), active: true };
  }

  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const [_userId, session] of this.sessions) {
      try {
        await session.page.close();
      } catch {
        // Ignore
      }
    }
    this.sessions.clear();

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore
      }
      this.browser = null;
    }
  }

  // --------------------------------------------------------------------------
  // Internal: Page Management
  // --------------------------------------------------------------------------

  private async getOrCreatePage(userId: string): Promise<Page> {
    const existing = this.sessions.get(userId);
    if (existing) {
      existing.lastActivity = Date.now();
      return existing.page;
    }

    // Check page limit
    const userPageCount = [...this.sessions.values()].filter((s) => s.userId === userId).length;
    if (userPageCount >= MAX_PAGES_PER_USER) {
      throw new Error(`Maximum ${MAX_PAGES_PER_USER} browser pages per user`);
    }

    const browser = await this.ensureBrowser();
    const page = await browser.newPage();

    // Set reasonable viewport
    await page.setViewport({ width: 1280, height: 800 });

    // Block unnecessary resource types for performance
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (type === 'media' || type === 'font') {
        req.abort();
      } else {
        req.continue();
      }
    });

    const session: PageSession = {
      page,
      userId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.sessions.set(userId, session);

    return page;
  }

  private async getExistingPage(userId: string): Promise<Page> {
    const session = this.sessions.get(userId);
    if (!session) {
      throw new Error('No active browser session. Use browse_web to navigate to a page first.');
    }
    session.lastActivity = Date.now();
    return session.page;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;

    const execPath = this.findExecutablePath();
    if (!execPath) {
      throw new Error(
        'Browser not available. Install Chrome/Chromium or set PUPPETEER_EXECUTABLE_PATH.'
      );
    }

    const puppeteer = await import('puppeteer-core');
    this.browser = await puppeteer.default.launch({
      executablePath: execPath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
      ],
    });

    this.browser.on('disconnected', () => {
      log.info('Browser disconnected');
      this.browser = null;
      this.sessions.clear();
    });

    log.info('Browser launched', { executablePath: execPath });
    return this.browser;
  }

  // --------------------------------------------------------------------------
  // Internal: Page Text Extraction
  // --------------------------------------------------------------------------

  private async getPageText(page: Page): Promise<string> {
    const text: string = await page.$eval(
      'body',
      (el) => (el as unknown as { innerText: string }).innerText ?? ''
    );
    return text.substring(0, MAX_TEXT_LENGTH);
  }

  // --------------------------------------------------------------------------
  // Internal: URL Validation
  // --------------------------------------------------------------------------

  private validateUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Only HTTP/HTTPS URLs are allowed. Got: ${parsed.protocol}`);
    }

    if (isBlockedUrl(url)) {
      throw new Error('URL targets a blocked or private network address.');
    }

    const allowedDomains = this.getAllowedDomains();
    if (allowedDomains.length > 0) {
      const hostname = parsed.hostname.toLowerCase();
      const allowed = allowedDomains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
      );
      if (!allowed) {
        throw new Error(
          `Domain "${hostname}" is not in the allowed domains list. ` +
            `Allowed: ${allowedDomains.join(', ')}`
        );
      }
    }
  }

  private getAllowedDomains(): string[] {
    try {
      const raw = configServicesRepo.getFieldValue(BROWSER_SERVICE, 'allowed_domains') as
        | string
        | undefined;
      if (!raw) return [];
      return raw
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  // --------------------------------------------------------------------------
  // Internal: Chrome Discovery
  // --------------------------------------------------------------------------

  private findExecutablePath(): string | null {
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (envPath) return envPath;

    const platform = process.platform;
    const candidates: string[] = [];

    if (platform === 'win32') {
      candidates.push(
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      );
    } else if (platform === 'darwin') {
      candidates.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium'
      );
    } else {
      candidates.push(
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome'
      );
    }

    const fs = require('fs') as typeof import('fs');
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        // Skip
      }
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Internal: Cleanup
  // --------------------------------------------------------------------------

  private async cleanupStaleSessions(): Promise<void> {
    const now = Date.now();
    for (const [userId, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
        log.debug('Closing stale browser session', { userId });
        try {
          await session.page.close();
        } catch {
          // Ignore
        }
        this.sessions.delete(userId);
      }
    }

    if (this.sessions.size === 0 && this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore
      }
      this.browser = null;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: BrowserService | null = null;

export function getBrowserService(): BrowserService {
  if (!instance) instance = new BrowserService();
  return instance;
}
