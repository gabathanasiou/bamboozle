import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Cloudflare rooms integration probe (docs/TESTING.md: a room join and the
 * reconnect/grace cases are medium-size tests, not visual ones).
 *
 * The Worker is started by playwright.config.ts on :8787 with 8s grace/kick
 * windows so the suite does not wait a real minute.
 */
test.describe.configure({ mode: 'serial' });
// A full reveal can take ~40s of narration/failsafe pacing.
test.setTimeout(180_000);

const SETTINGS = JSON.stringify({ usePremiumVoices: false });
const ANSWER_BUTTON = /😂|😮|❤️|🍅/;

async function withSettings(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript((settings) => {
    localStorage.setItem('bamboozle_settings', settings);

    // Silent, instant narration. Chromium is launched with
    // --disable-speech-api, so provide a harmless fake that fires onend
    // immediately; nothing reaches the host's speakers and the reveal does
    // not wait for the safety timer.
    const w = window as unknown as Record<string, any>;
    if (typeof w.SpeechSynthesisUtterance === 'undefined') {
      w.SpeechSynthesisUtterance = class {
        text = '';
        voice = null;
        pitch = 1;
        rate = 1;
        onstart: ((event: Event) => void) | null = null;
        onend: ((event: Event) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      };
    }

    const speak = (utterance: any) => {
      setTimeout(() => {
        utterance.onstart?.(new Event('start'));
        utterance.onend?.(new Event('end'));
      }, 0);
    };

    if (w.speechSynthesis) {
      w.speechSynthesis.speak = speak;
    } else {
      Object.defineProperty(w, 'speechSynthesis', {
        configurable: true,
        value: {
          speaking: false,
          pending: false,
          paused: false,
          speak,
          cancel: () => {},
          getVoices: () => [],
          resume: () => {},
          pause: () => {},
        },
      });
    }
  }, SETTINGS);
  return context;
}

async function createHostRoom(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /Host Game/i }).click();

  const name = page.getByPlaceholder(/YOUR NAME/i);
  await expect(name).toBeVisible();
  await name.fill('Hosty');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await expect(page.getByRole('button', { name: /START GAME/i })).toBeVisible();

  let code = '';
  await expect
    .poll(
      async () => {
        const text = await page.locator('body').innerText();
        code = text.match(/ROOM:\s*([A-Z]{4})/)?.[1] ?? '';
        return code;
      },
      { timeout: 15000 },
    )
    .toMatch(/^[A-Z]{4}$/);
  return code;
}

async function joinRoom(page: Page, code: string, name: string, audience = false): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /Join Game/i }).click();
  await page.getByPlaceholder('ABCD').fill(code);
  await page.getByRole('button', { name: /^ENTER$/i }).click();

  const nickname = page.getByPlaceholder('NICKNAME');
  const lobby = page.getByRole('button', { name: /READY UP/i });
  await expect
    .poll(
      async () => (await nickname.count()) + (await lobby.count()),
      { timeout: 15000 },
    )
    .toBeGreaterThan(0);

  // A reconnect can skip the name step (the room already knows this player).
  if (await nickname.isVisible()) {
    await nickname.fill(name);
    await page
      .getByRole('button', { name: audience ? /^Join Audience$/i : /^Join Game$/i })
      .click();
  }
}

async function readyAndStart(host: Page, player: Page): Promise<void> {
  await expect(player.getByRole('button', { name: /READY UP/i })).toBeVisible({ timeout: 15000 });
  await player.getByRole('button', { name: /READY UP/i }).click();
  await host.getByRole('button', { name: /READY UP/i }).click();

  const start = host.getByRole('button', { name: /START GAME/i });
  await expect(start).toBeEnabled();
  await start.click();
}

async function selectCategory(host: Page, player: Page): Promise<void> {
  await expect(host.getByText(/CATEGORY SELECTION/i)).toBeVisible({ timeout: 15000 });
  const hostPicker = host.getByText(/PICK A CATEGORY/i);
  const playerPicker = player.getByText(/PICK A CATEGORY/i);
  await expect
    .poll(
      async () => (await hostPicker.count()) + (await playerPicker.count()),
      { timeout: 15000 },
    )
    .toBeGreaterThan(0);

  const picker = (await hostPicker.count()) > 0 ? host : player;
  await picker.getByRole('button').filter({ hasNotText: ANSWER_BUTTON }).first().click();
}

async function playOneRound(host: Page, player: Page): Promise<void> {
  await selectCategory(host, player);

  for (const page of [host, player]) {
    const lie = page.getByPlaceholder(/LIE HERE/i);
    await expect(lie).toBeVisible({ timeout: 20000 });
    await lie.fill(page === host ? 'A suspicious sausage' : 'A polite crocodile');
    await page.getByRole('button', { name: /^SUBMIT$/i }).click();
  }

  // Both clients must reach VOTING and see answer cards.
  for (const page of [host, player]) {
    await expect(page.getByPlaceholder(/LIE HERE/i)).toHaveCount(0);
    const answer = page.getByRole('button').filter({ hasNotText: ANSWER_BUTTON }).first();
    await expect(answer).toBeVisible({ timeout: 15000 });
    await answer.click();
  }

  // The reveal shows a scoring cue before the leaderboard. With silent
  // narration it can pass very quickly, so accept standings as the end state.
  await expect
    .poll(
      async () => {
        const text = (await host.locator('body').innerText()).toUpperCase();
        return /FOOLED|SMART|LIE BONUS|WRITTEN BY|STANDINGS/.test(text);
      },
      { timeout: 20000 },
    )
    .toBe(true);

  await expect(host.getByText(/STANDINGS/i)).toBeVisible({ timeout: 90000 });
  await expect(player.getByText(/STANDINGS/i)).toBeVisible({ timeout: 90000 });
}

test('host, player and audience complete one round without desync', async ({ browser }) => {
  const hostContext = await withSettings(browser);
  const playerContext = await withSettings(browser);
  const audienceContext = await withSettings(browser);

  const host = await hostContext.newPage();
  const player = await playerContext.newPage();
  const audience = await audienceContext.newPage();

  const code = await createHostRoom(host);
  await joinRoom(player, code, 'PlayerOne');
  await joinRoom(audience, code, 'Watcher', true);

  await expect(audience.getByText(code).first()).toBeVisible({ timeout: 15000 });
  await readyAndStart(host, player);
  await playOneRound(host, player);

  // Audience receives the same authoritative broadcast and is not kicked.
  await expect(audience.getByText(/Room Closed/i)).toHaveCount(0);

  await hostContext.close();
  await playerContext.close();
  await audienceContext.close();
});

test('host reconnects inside grace; a disconnected player is kicked after grace', async ({ browser }) => {
  const hostContext = await withSettings(browser);
  const playerContext = await withSettings(browser);
  const host = await hostContext.newPage();
  const player = await playerContext.newPage();

  const code = await createHostRoom(host);
  await joinRoom(player, code, 'PlayerOne');
  await expect(player.getByRole('button', { name: /READY UP/i })).toBeVisible({ timeout: 15000 });

  await host.close();
  await expect(player.getByText(/Host Disconnected/i)).toBeVisible({ timeout: 10000 });

  const reconnectedHost = await hostContext.newPage();
  await reconnectedHost.goto('/');
  await reconnectedHost.getByRole('button', { name: /Host Game/i }).click();
  await expect(reconnectedHost.getByText(code, { exact: true }).first()).toBeVisible({ timeout: 15000 });
  await reconnectedHost.getByText(code, { exact: true }).first().click();
  await expect(reconnectedHost.getByRole('button', { name: /START GAME/i })).toBeVisible({ timeout: 15000 });
  await expect(player.getByText(/Host Disconnected/i)).toHaveCount(0, { timeout: 15000 });

  // Rejoin inside grace cancels the kick: wait out the 8s window and confirm
  // the player is still in the host's lobby.
  await player.close();
  const reconnectedPlayer = await playerContext.newPage();
  await joinRoom(reconnectedPlayer, code, 'PlayerOne');
  await expect(reconnectedPlayer.getByRole('button', { name: /READY UP/i })).toBeVisible({
    timeout: 15000,
  });

  const kickWindowStart = Date.now();
  await expect
    .poll(
      async () => {
        const text = (await reconnectedHost.locator('body').innerText()).toUpperCase();
        return Date.now() - kickWindowStart > 9000 && text.includes('PLAYERONE');
      },
      { timeout: 15000 },
    )
    .toBe(true);

  // A second close is not cancelled, so the kick fires.
  await reconnectedPlayer.close();
  await expect
    .poll(
      async () => {
        const text = (await reconnectedHost.locator('body').innerText()).toUpperCase();
        return text.includes('PLAYERONE');
      },
      { timeout: 20000 },
    )
    .toBe(false);

  await hostContext.close();
  await playerContext.close();
});

test('host grace expiry closes the room for players', async ({ browser }) => {
  const hostContext = await withSettings(browser);
  const playerContext = await withSettings(browser);
  const host = await hostContext.newPage();
  const player = await playerContext.newPage();

  const code = await createHostRoom(host);
  await joinRoom(player, code, 'PlayerOne');
  await expect(player.getByRole('button', { name: /READY UP/i })).toBeVisible({ timeout: 15000 });

  await host.close();
  await expect(player.getByText(/Host Disconnected/i)).toBeVisible({ timeout: 10000 });
  await expect(player.getByText(/Room Closed/i)).toBeVisible({ timeout: 20000 });

  await hostContext.close();
  await playerContext.close();
});
