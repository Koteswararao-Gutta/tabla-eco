// Shared e2e helpers (foundation). Pages in one browser context share localStorage,
// so they sync exactly like separate Chrome windows on one computer.
import type { BrowserContext, Page } from '@playwright/test';

export async function openScreen(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/#' + path);
  return page;
}

/** Read a whole collection straight from the local store (test-only). */
export async function readCollection<T = Record<string, unknown>>(page: Page, col: string): Promise<T[]> {
  return page.evaluate((c) => Object.values(JSON.parse(localStorage.getItem('tabla:' + c) || '{}')), col) as Promise<T[]>;
}

