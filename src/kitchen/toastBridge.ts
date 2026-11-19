// Toast menu: the kitchen tablet's Android app reads Tabla's Toast ordering page once an hour (Toast blocks
// cloud servers, so the tablet does it over the restaurant's internet) and hands the result to this page,
// which sends it to the server. In a plain browser nothing calls it, so nothing happens.
import { useEffect, useState } from 'react';
import { store, type ToastMenuReport } from '@shared/data';

declare global {
  interface Window {
    /** Called by the Android app with the JSON text of a ToastMenuReport. Returns false if it wasn't one. */
    tablaToastMenu?: (json: string) => boolean;
  }
}

/** Parses what the app sent; null if it isn't a report. */
export function parseReport(json: string): ToastMenuReport | null {
  try {
    const v: unknown = JSON.parse(json);
    if (v && typeof v === 'object') {
      if (Array.isArray((v as { menus?: unknown }).menus)) return { menus: (v as { menus: unknown[] }).menus };
      if (typeof (v as { error?: unknown }).error === 'string') return { error: (v as { error: string }).error };
    }
  } catch {
    // not JSON
  }
  return null;
}

/** Listens for the app's reports. Returns the last read's error (for the red notice), or null when it worked. */
export function useToastBridge(): string | null {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    window.tablaToastMenu = (json) => {
      const report = parseReport(json);
      if (!report) return false;
      setError('error' in report && report.error ? report.error : null);
      store.reportToastMenu(report).catch((e) => console.warn('Toast menu not sent', e));
      return true;
    };
    return () => {
      delete window.tablaToastMenu;
    };
  }, []);
  return error;
}
