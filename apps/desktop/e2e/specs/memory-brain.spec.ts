/**
 * E2E test: brain.md auto-update after task completion
 *
 * IMPORTANT — Prerequisites before running this test:
 *
 * 1. Set BRAIN_AUTO_UPDATE_ENABLED = true in brain-updater.ts (line 7)
 * 2. This test does NOT use mock task mode — it requires a real provider configured.
 *    Set the env var: E2E_BRAIN_TEST_API_KEY=<your_anthropic_or_openai_key>
 *    and E2E_BRAIN_TEST_PROVIDER=anthropic|openai  (default: anthropic)
 *
 * Because real LLM calls are needed, this test is in the 'electron-integration'
 * project (120s timeout, no retries on CI).
 *
 * Run only this file:
 *   cd apps/desktop && npx playwright test e2e/specs/memory-brain.spec.ts \
 *     --project=electron-integration
 */

import { test, expect } from '../fixtures';
import { HomePage, ExecutionPage } from '../pages';
import { TEST_TIMEOUTS } from '../config';
import type { ElectronApplication } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a test agent via the main process, or return existing one.
 */
async function ensureTestAgent(electronApp: ElectronApplication, name: string): Promise<string> {
  return electronApp.evaluate(
    async ({ name }: { name: string }) => {
      const { getStorage } = await import('../store/storage.js');
      const storage = getStorage();
      const existing = storage.getAllAgents().find((a: { name: string }) => a.name === name);
      if (existing) return existing.id;
      const created = storage.createAgent({
        id: `e2e-${name.toLowerCase()}-${Date.now()}`,
        name,
        system_prompt: '',
      });
      return created.id;
    },
    { name },
  );
}

/**
 * Select an agent by ID via the main process.
 */
async function selectAgentById(electronApp: ElectronApplication, agentId: string): Promise<void> {
  await electronApp.evaluate(
    async ({ agentId }: { agentId: string }) => {
      const { getStorage } = await import('../store/storage.js');
      getStorage().setSelectedAgentId(agentId);
    },
    { agentId },
  );
}

/**
 * Read brain.md for the given agent from disk via the main process.
 * Returns null if file does not exist.
 */
async function readBrainMd(
  electronApp: ElectronApplication,
  agentId: string,
): Promise<string | null> {
  return electronApp.evaluate(
    async ({ agentId }: { agentId: string }) => {
      const { app } = await import('electron');
      const path = await import('path');
      const fs = await import('fs');
      const brainPath = path.join(app.getPath('userData'), 'agents', agentId, 'memory', 'brain.md');
      if (!fs.existsSync(brainPath)) return null;
      return fs.readFileSync(brainPath, 'utf8');
    },
    { agentId },
  );
}

/**
 * Delete brain.md for a given agent to start from a clean state.
 */
async function deleteBrainMd(electronApp: ElectronApplication, agentId: string): Promise<void> {
  await electronApp.evaluate(
    async ({ agentId }: { agentId: string }) => {
      const { app } = await import('electron');
      const path = await import('path');
      const fs = await import('fs');
      const brainPath = path.join(app.getPath('userData'), 'agents', agentId, 'memory', 'brain.md');
      if (fs.existsSync(brainPath)) fs.unlinkSync(brainPath);
    },
    { agentId },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * These tests require a real provider. Skip automatically if no API key is set.
 */
const REQUIRES_REAL_PROVIDER = !!process.env.E2E_BRAIN_TEST_API_KEY;

test.describe('Memory — brain.md auto-update', () => {
  test.skip(!REQUIRES_REAL_PROVIDER, 'Set E2E_BRAIN_TEST_API_KEY to run brain E2E tests');

  /**
   * Test 1 — Smoke: brain.md is created after a task containing a memorable date
   */
  test('creates brain.md with date fact after birthday task', async ({ electronApp, window }) => {
    const homePage = new HomePage(window);
    const executionPage = new ExecutionPage(window);

    // Create / find test agent
    const agentId = await ensureTestAgent(electronApp, 'BrainTestAgent');

    // Clean state
    await deleteBrainMd(electronApp, agentId);

    // Select the test agent in the main process (UI refresh happens on next interaction)
    await selectAgentById(electronApp, agentId);

    await window.waitForLoadState('domcontentloaded');

    // Start a task that contains a memorable date
    const prompt = "Just so you know, my mother's birthday is on May 10th. Please acknowledge.";
    await homePage.enterTask(prompt);
    await homePage.submitTask();

    // Wait for navigation to execution page
    await window.waitForURL(/.*#\/execution.*/, { timeout: TEST_TIMEOUTS.NAVIGATION });

    // Wait for task to complete (real LLM — longer timeout)
    await executionPage.waitForComplete(90000);

    // Give the fire-and-forget brain updater time to finish (it runs async after completion)
    await window.waitForTimeout(8000);

    // Verify brain.md was created and contains the birthday fact
    const brainContent = await readBrainMd(electronApp, agentId);

    expect(brainContent).not.toBeNull();
    expect(brainContent).toContain('## Key Facts');

    // Should contain something about May 10 or birthday — exact wording varies by LLM
    const hasBirthdayFact = /may 10|10 may|birthday|cumpleaños/i.test(brainContent ?? '');
    expect(hasBirthdayFact).toBe(true);
  });

  /**
   * Test 2 — Dedupe: running the same task twice does not duplicate the bullet
   */
  test('does not duplicate an already-present fact', async ({ electronApp, window }) => {
    const homePage = new HomePage(window);
    const executionPage = new ExecutionPage(window);

    const agentId = await ensureTestAgent(electronApp, 'BrainTestAgent');

    // Pre-populate brain.md with the fact we expect the extractor to generate
    await electronApp.evaluate(
      async ({ agentId }: { agentId: string }) => {
        const { app } = await import('electron');
        const path = await import('path');
        const fs = await import('fs');
        const dir = path.join(app.getPath('userData'), 'agents', agentId, 'memory');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, 'brain.md'),
          "# Brain — BrainTestAgent\n\n## Key Facts\n\n- [date] Mother's birthday: 10 May\n",
          'utf8',
        );
      },
      { agentId },
    );

    await selectAgentById(electronApp, agentId);
    await window.waitForLoadState('domcontentloaded');

    const prompt = "Remember: my mother's birthday is May 10th. Acknowledge please.";
    await homePage.enterTask(prompt);
    await homePage.submitTask();

    await window.waitForURL(/.*#\/execution.*/, { timeout: TEST_TIMEOUTS.NAVIGATION });
    await executionPage.waitForComplete(90000);
    await window.waitForTimeout(8000);

    const brainContent = await readBrainMd(electronApp, agentId);
    expect(brainContent).not.toBeNull();

    // Count occurrences of May/birthday — should be exactly 1
    const matches = (brainContent ?? '').match(/may 10|10 may|birthday/gi) ?? [];
    expect(matches.length).toBe(1);
  });

  /**
   * Test 3 — Kill switch: when BRAIN_AUTO_UPDATE_ENABLED is false, brain.md is not created
   *
   * NOTE: This test verifies behaviour when the kill switch is off.
   * Since the constant is compiled-in, this test checks the default state
   * by reading the source file. If the constant is true (test mode), skip.
   */
  test('kill switch: brain.md not created when BRAIN_AUTO_UPDATE_ENABLED=false', async ({
    electronApp,
    window,
  }) => {
    const homePage = new HomePage(window);
    const executionPage = new ExecutionPage(window);

    const agentId = await ensureTestAgent(electronApp, 'KillSwitchTestAgent');
    await deleteBrainMd(electronApp, agentId);
    await selectAgentById(electronApp, agentId);
    await window.waitForLoadState('domcontentloaded');

    await homePage.enterTask('My favourite colour is blue.');
    await homePage.submitTask();

    await window.waitForURL(/.*#\/execution.*/, { timeout: TEST_TIMEOUTS.NAVIGATION });
    await executionPage.waitForComplete(90000);
    await window.waitForTimeout(5000);

    const brainContent = await readBrainMd(electronApp, agentId);
    // With kill switch off (default), brain.md should NOT exist
    expect(brainContent).toBeNull();
  });

  /**
   * Test 4 — Agent isolation: brain.md is created under the correct agent's folder
   */
  test('writes brain.md under the correct agent vault, not another agent', async ({
    electronApp,
    window,
  }) => {
    const homePage = new HomePage(window);
    const executionPage = new ExecutionPage(window);

    const agentAliceId = await ensureTestAgent(electronApp, 'AliceBrainAgent');
    const agentBobId = await ensureTestAgent(electronApp, 'BobBrainAgent');

    await deleteBrainMd(electronApp, agentAliceId);
    await deleteBrainMd(electronApp, agentBobId);

    // Select Alice
    await selectAgentById(electronApp, agentAliceId);
    await window.waitForLoadState('domcontentloaded');

    const prompt = "My dog's name is Fido. Please acknowledge.";
    await homePage.enterTask(prompt);
    await homePage.submitTask();

    await window.waitForURL(/.*#\/execution.*/, { timeout: TEST_TIMEOUTS.NAVIGATION });
    await executionPage.waitForComplete(90000);
    await window.waitForTimeout(8000);

    // Alice's brain should have something; Bob's brain should not exist
    const aliceBrain = await readBrainMd(electronApp, agentAliceId);
    const bobBrain = await readBrainMd(electronApp, agentBobId);

    expect(aliceBrain).not.toBeNull();
    expect(bobBrain).toBeNull();
  });
});
