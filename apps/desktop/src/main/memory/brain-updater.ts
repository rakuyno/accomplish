import fs from 'fs';
import path from 'path';
import type { StorageAPI } from '@accomplish_ai/agent-core';
import { extractBrainFacts, type BrainItem, type GetApiKeyFn } from '@accomplish_ai/agent-core';

// Kill switch — set to true to enable auto-updates
const BRAIN_AUTO_UPDATE_ENABLED = false;

const BRAIN_FILENAME = 'brain.md';
const BRAIN_MAX_BYTES = 4096;
const BRAIN_SNIPPET_BYTES = 1024; // how much of existing brain to send to extractor
const KEY_FACTS_HEADING = '## Key Facts';

function getMemoryDir(userDataPath: string, agentId: string): string {
  return path.join(userDataPath, 'agents', agentId, 'memory');
}

function normaliseBullet(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse existing bullets from the Key Facts section of brain.md.
 * Returns a Set of normalised bullet texts for deduplication.
 */
function parseExistingBullets(content: string): Set<string> {
  const set = new Set<string>();
  let inKeyFacts = false;

  for (const line of content.split('\n')) {
    if (line.trim() === KEY_FACTS_HEADING) {
      inKeyFacts = true;
      continue;
    }
    if (inKeyFacts) {
      if (line.startsWith('## ') && line.trim() !== KEY_FACTS_HEADING) {
        break; // next heading
      }
      const match = line.match(/^- \[(?:preference|decision|constraint|date)\] (.+)$/);
      if (match) {
        set.add(normaliseBullet(match[1]));
      }
    }
  }

  return set;
}

/**
 * Reconstruct brain.md content from the heading block (lines before Key Facts)
 * and a list of bullets, enforcing BRAIN_MAX_BYTES by dropping oldest bullets.
 */
function rebuildBrainContent(headerBlock: string, bullets: string[]): string {
  // Drop bullets from the front (oldest) until content fits
  for (let drop = 0; drop <= bullets.length; drop++) {
    const remaining = bullets.slice(drop);
    const sections = [KEY_FACTS_HEADING, '', ...remaining, ''].join('\n');
    const full = headerBlock ? `${headerBlock}\n\n${sections}` : sections;
    if (Buffer.byteLength(full, 'utf8') <= BRAIN_MAX_BYTES || remaining.length === 0) {
      return full;
    }
  }
  return headerBlock;
}

/**
 * Extract the block of content before the Key Facts section (title + other sections).
 * This is preserved verbatim when rewriting.
 */
function extractHeaderBlock(content: string): { header: string; bullets: string[] } {
  const lines = content.split('\n');
  const keyFactsIdx = lines.findIndex((l) => l.trim() === KEY_FACTS_HEADING);

  if (keyFactsIdx === -1) {
    return { header: content.trimEnd(), bullets: [] };
  }

  const header = lines.slice(0, keyFactsIdx).join('\n').trimEnd();
  const bullets: string[] = [];

  for (const line of lines.slice(keyFactsIdx + 1)) {
    if (line.startsWith('## ') && line.trim() !== KEY_FACTS_HEADING) break;
    if (/^- \[/.test(line)) bullets.push(line);
  }

  return { header, bullets };
}

function formatBullet(item: BrainItem): string {
  return `- [${item.type}] ${item.text}`;
}

function getLastTextMessage(messages: { type: string; content: string }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === 'text' && msg.content.trim()) return msg.content.trim().slice(0, 400);
  }
  return '';
}

export async function updateBrainFromTask(
  taskId: string,
  userDataPath: string,
  storage: StorageAPI,
  getApiKey: GetApiKeyFn,
): Promise<void> {
  if (!BRAIN_AUTO_UPDATE_ENABLED) return;

  const task = storage.getTask(taskId);
  if (!task) return;

  const agentId = task.agentId ?? 'default';
  const agent = storage.getAgentById(agentId);
  const agentName = agent?.name ?? agentId;

  const dir = getMemoryDir(userDataPath, agentId);
  const brainPath = path.join(dir, BRAIN_FILENAME);

  // Read existing brain.md (may not exist yet)
  let existingContent = '';
  try {
    if (fs.existsSync(brainPath)) {
      existingContent = fs.readFileSync(brainPath, 'utf8');
    }
  } catch {
    return; // fail-closed: can't read existing file safely
  }

  const existingSnippet = existingContent.slice(0, BRAIN_SNIPPET_BYTES);
  const existingBullets = parseExistingBullets(existingContent);

  const items = await extractBrainFacts(
    {
      agentId,
      agentName,
      prompt: task.prompt,
      summary: task.summary ?? '',
      resultText: getLastTextMessage(task.messages),
      existingBrainSnippet: existingSnippet,
    },
    getApiKey,
  );

  if (!items || items.length === 0) return;

  // Dedupe: only keep items not already in the brain
  const newItems = items.filter((item) => !existingBullets.has(normaliseBullet(item.text)));
  if (newItems.length === 0) return;

  const { header, bullets } = extractHeaderBlock(existingContent);

  // Determine header: if brain.md doesn't exist yet, create a minimal one
  const finalHeader = header.trim() || `# Brain — ${agentName}`;
  const updatedBullets = [...bullets, ...newItems.map(formatBullet)];
  const newContent = rebuildBrainContent(finalHeader, updatedBullets);

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(brainPath, newContent, 'utf8');
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Memory] Updated brain.md (+${newItems.length} fact(s)) for agent ${agentId}`);
    }
  } catch (err) {
    console.warn('[Memory] Failed to write brain.md:', err);
  }
}
