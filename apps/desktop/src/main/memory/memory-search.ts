import fs from 'fs';
import path from 'path';

export interface MemorySnippet {
  title: string;
  ref: string;
  text: string;
  score: number;
}

export interface MemorySearchOptions {
  topK?: number;
  maxChars?: number;
  scanLimit?: number;
}

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'is',
  'it',
  'on',
  'at',
  'be',
  'as',
  'de',
  'la',
  'el',
  'en',
  'que',
  'con',
  'para',
  'es',
  'un',
  'una',
  'los',
  'las',
  'por',
  'se',
  'su',
  'al',
  'del',
  'lo',
  'si',
  'no',
  'yo',
  'me',
]);

const MAX_FILE_READ_BYTES = 102400; // 100 KB cap for large files
const SECTION_EXCERPT_CHARS = 400;

// Metadata lines written by V1 writer — skip when falling back to raw body
const METADATA_LINE_PREFIXES = ['- date:', '- agent:', '- status:', '- task'];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function readFileHead(filePath: string, maxBytes: number): string {
  let fd: number | undefined;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > maxBytes) {
      const buf = Buffer.alloc(maxBytes);
      fd = fs.openSync(filePath, 'r');
      const bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0);
      return buf.slice(0, bytesRead).toString('utf8');
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

interface ParsedNote {
  title: string;
  summary: string;
  result: string;
  prompt: string;
}

/**
 * Parse a V1 memory markdown file into named sections.
 * Sections are delimited by ## headings; unknown sections are ignored.
 * Falls back gracefully for notes that don't match V1 structure.
 */
function parseNote(content: string): ParsedNote {
  const lines = content.split('\n');
  let title = '';
  let currentSection = '';
  const sections: Record<string, string[]> = { summary: [], result: [], prompt: [] };
  const rawBodyLines: string[] = [];

  for (const line of lines) {
    if (!title && line.startsWith('# ')) {
      title = line.slice(2).replace(/\r?\n/g, ' ').trim().slice(0, 120);
      continue;
    }
    if (line.startsWith('## ')) {
      currentSection = line.slice(3).trim().toLowerCase();
      continue;
    }
    if (currentSection && currentSection in sections) {
      sections[currentSection].push(line);
    } else if (!currentSection) {
      // Lines before first ## heading (metadata block — collect for fallback)
      rawBodyLines.push(line);
    }
  }

  const extract = (key: string) =>
    sections[key].join(' ').replace(/\s+/g, ' ').trim().slice(0, SECTION_EXCERPT_CHARS);

  // Fallback: raw body with metadata lines stripped
  const fallback = rawBodyLines
    .filter((l) => {
      const lower = l.trim().toLowerCase();
      return lower.length > 0 && !METADATA_LINE_PREFIXES.some((p) => lower.startsWith(p));
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SECTION_EXCERPT_CHARS);

  return {
    title,
    summary: extract('summary') || fallback,
    result: extract('result'),
    prompt: extract('prompt'),
  };
}

/**
 * Build the display snippet shown in <memory-context>.
 * Priority: Summary → Result → Prompt (each up to SECTION_EXCERPT_CHARS).
 */
function buildSnippet(note: ParsedNote): string {
  const parts: string[] = [];
  if (note.summary) parts.push(note.summary);
  if (note.result) parts.push(note.result);
  if (parts.length === 0 && note.prompt) parts.push(note.prompt);
  return parts.join(' | ').slice(0, SECTION_EXCERPT_CHARS * 2);
}

/**
 * Weighted keyword score:
 *   title  ×3   (high signal — derived from task.summary)
 *   summary ×2  (AI-generated summary)
 *   result  ×1
 *   prompt  ×1
 */
function scoreNote(note: ParsedNote, queryTokens: string[]): number {
  let score = 0;
  const titleTokens = tokenize(note.title);
  const summaryTokens = tokenize(note.summary);
  const resultTokens = tokenize(note.result);
  const promptTokens = tokenize(note.prompt);

  for (const token of queryTokens) {
    if (titleTokens.some((t) => t.includes(token))) score += 3;
    if (summaryTokens.some((t) => t.includes(token))) score += 2;
    if (resultTokens.some((t) => t.includes(token))) score += 1;
    if (promptTokens.some((t) => t.includes(token))) score += 1;
  }
  return score;
}

export function searchMemory(
  agentId: string,
  query: string,
  userDataPath: string,
  options?: MemorySearchOptions,
): MemorySnippet[] {
  const topK = options?.topK ?? 3;
  const maxChars = options?.maxChars ?? 1200;
  const scanLimit = options?.scanLimit ?? 50;

  try {
    const dir = path.join(userDataPath, 'agents', agentId, 'memory');
    if (!fs.existsSync(dir)) return [];

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md') && f !== 'index.md')
      .sort()
      .reverse()
      .slice(0, scanLimit);

    const results: MemorySnippet[] = [];

    for (const filename of files) {
      const filePath = path.join(dir, filename);
      const content = readFileHead(filePath, MAX_FILE_READ_BYTES);
      if (!content) continue;

      const note = parseNote(content);
      const score = scoreNote(note, queryTokens);

      if (score > 0) {
        results.push({
          title: note.title || filename,
          ref: filename,
          text: buildSnippet(note),
          score,
        });
      }
    }

    if (results.length === 0) {
      if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') {
        console.log(
          `[Memory] searchMemory: 0 results for agentId=${agentId} query="${query.slice(0, 60)}"`,
        );
      }
      return [];
    }

    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, topK);

    // Enforce total maxChars budget by truncating lowest-score snippets first
    let totalChars = top.reduce((sum, s) => sum + s.title.length + s.ref.length + s.text.length, 0);
    for (let i = top.length - 1; i >= 0 && totalChars > maxChars; i--) {
      const excess = totalChars - maxChars;
      const s = top[i];
      if (s.text.length > excess) {
        s.text = s.text.slice(0, s.text.length - excess);
        totalChars = maxChars;
      } else {
        totalChars -= s.text.length + s.title.length + s.ref.length;
        top.splice(i, 1);
      }
    }

    return top;
  } catch (err) {
    console.warn('[Memory] searchMemory failed:', err);
    return [];
  }
}
