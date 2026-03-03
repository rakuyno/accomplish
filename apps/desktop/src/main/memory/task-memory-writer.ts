import fs from 'fs';
import path from 'path';
import type { TaskResult, StorageAPI } from '@accomplish_ai/agent-core';

const INDEX_FILENAME = 'index.md';
const INDEX_MAX_ENTRIES = 50;

function getMemoryDir(userDataPath: string, agentId: string): string {
  return path.join(userDataPath, 'agents', agentId, 'memory');
}

function formatDate(isoString: string): string {
  return isoString.slice(0, 10); // YYYY-MM-DD
}

function extractLastTextMessage(messages: { type: string; content: string }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === 'text' && msg.content.trim()) {
      return msg.content.trim();
    }
  }
  return '';
}

function extractTitleFromFile(filePath: string): string {
  try {
    const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
    if (firstLine.startsWith('# '))
      return firstLine.slice(2).replace(/\r?\n/g, ' ').trim().slice(0, 120);
  } catch {
    // fall through
  }
  return path.basename(filePath, '.md');
}

function updateMemoryIndex(dir: string, agentName: string): void {
  try {
    const entries = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md') && f !== INDEX_FILENAME)
      .sort() // lexicographic == chronological because filename starts YYYY-MM-DD
      .reverse()
      .slice(0, INDEX_MAX_ENTRIES);

    const lines = [`# Memory index (Agent: ${agentName})`, ''];
    for (const filename of entries) {
      const dateStr = filename.slice(0, 10); // YYYY-MM-DD
      const title = extractTitleFromFile(path.join(dir, filename));
      lines.push(`- ${dateStr} — [${filename}](./${filename}) — ${title}`);
    }
    lines.push('');

    fs.writeFileSync(path.join(dir, INDEX_FILENAME), lines.join('\n'), 'utf8');
  } catch (err) {
    console.warn('[Memory] Failed to update index:', err);
  }
}

export async function writeTaskMemory(
  taskId: string,
  result: TaskResult,
  userDataPath: string,
  storage: StorageAPI,
): Promise<void> {
  try {
    const task = storage.getTask(taskId);
    if (!task) {
      console.warn(`[Memory] Task ${taskId} not found in DB, skipping memory write`);
      return;
    }

    const agentId = task.agentId ?? 'default';
    const agent = storage.getAgentById(agentId);
    const agentName = agent?.name ?? agentId;

    const dateStr = formatDate(task.completedAt ?? task.createdAt ?? new Date().toISOString());
    const filename = `${dateStr}_${taskId}.md`;
    const dir = getMemoryDir(userDataPath, agentId);
    const filePath = path.join(dir, filename);

    // Idempotency guard — never overwrite an existing memory file
    if (fs.existsSync(filePath)) {
      return;
    }

    const title = task.summary ?? task.prompt.slice(0, 80);
    const resultText = extractLastTextMessage(task.messages);
    const statusLabel =
      result.status === 'success'
        ? 'completed'
        : result.status === 'interrupted'
          ? 'interrupted'
          : 'failed';

    const lines: string[] = [
      `# ${title}`,
      '',
      `- Date: ${dateStr}`,
      `- Agent: ${agentName} (${agentId})`,
      `- Status: ${statusLabel}`,
      `- Task ID: ${taskId}`,
      '',
      '## Prompt',
      '',
      task.prompt,
      '',
    ];

    if (task.summary && task.summary !== task.prompt) {
      lines.push('## Summary', '', task.summary, '');
    }

    if (resultText) {
      lines.push('## Result', '', resultText, '');
    }

    const content = lines.join('\n');

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[Memory] Wrote task memory: ${filePath}`);

    updateMemoryIndex(dir, agentName);
  } catch (err) {
    console.warn('[Memory] Failed to write task memory:', err);
  }
}
