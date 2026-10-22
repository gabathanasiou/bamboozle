import { defineConfig } from '@playwright/test';
import { availableParallelism } from 'node:os';

// Set PLAYWRIGHT_PORT to choose the port. Every run OWNS its server
// (`reuseExistingServer: false`) so a foreign process fails fast instead of
// being silently tested. Specs navigate via baseURL (`page.goto('/')`), never a
// hardcoded host:port.
const PORT = Number(process.env.PLAYWRIGHT_PORT) || 4173;
const devCmd = `npm run dev -- --port=${PORT} --strictPort`;
const previewCmd = `npm run build && npm run preview -- --port=${PORT} --strictPort`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: true,
  // Retry once locally (twice on CI) so a transient flake doesn't read as a
  // regression. The first retry records a trace. Chronic flakers are tagged
  // @quarantine (excluded below) rather than retried forever — docs/TESTING.md.
  retries: process.env.CI ? 2 : 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    // Motion off removes animation races; a spec about animation opts back in.
    contextOptions: { reducedMotion: 'reduce' },
  },
  workers: process.env.PLAYWRIGHT_WORKERS
    ? Number(process.env.PLAYWRIGHT_WORKERS)
    : Math.min(5, availableParallelism()),
  reporter: [['list']],
  // Production preview by default (faster boots); PLAYWRIGHT_DEV=1 uses dev.
  webServer: process.env.PLAYWRIGHT_DEV
    ? {
        command: devCmd,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
        timeout: 120000,
        env: { PORT: String(PORT) },
      }
    : {
        command: previewCmd,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
        timeout: 180000,
        env: { PORT: String(PORT) },
      },
  // @perf / @quarantine are outside the default suite; run explicitly by grep.
  grepInvert: /@perf|@quarantine/,
});
