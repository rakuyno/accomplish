/**
 * Brain fact extractor for auto-updating brain.md
 *
 * Extracts stable facts (preferences, decisions, constraints, dates) from a
 * completed task and returns them as structured JSON. Uses the same provider
 * fallback chain as the task summarizer.
 *
 * Returns null if extraction fails or produces no usable output — callers
 * must treat null as "abort, do not modify brain.md".
 */

import type { ApiKeyProvider } from '../common/types/provider.js';
import type { GetApiKeyFn } from './summarizer.js';

export type { GetApiKeyFn };

export type BrainItemType = 'preference' | 'decision' | 'constraint' | 'date';

export interface BrainItem {
  type: BrainItemType;
  text: string;
  importance: number;
}

interface ExtractorInput {
  agentId: string;
  agentName: string;
  prompt: string;
  summary: string;
  resultText: string;
  existingBrainSnippet: string; // first 1KB of current brain.md to avoid LLM re-generating known facts
}

function buildExtractorPrompt(input: ExtractorInput): string {
  const existing = input.existingBrainSnippet.trim()
    ? `\nExisting brain facts (DO NOT repeat these):\n${input.existingBrainSnippet.trim()}\n`
    : '';

  return `You are a memory extraction system for AI agent "${input.agentName}" (id: ${input.agentId}).
Analyze the task below and extract stable, reusable facts worth remembering for future tasks.
Output ONLY valid JSON — no explanation, no markdown fences, no text before or after:
{"items":[{"type":"preference|decision|constraint|date","text":"...","importance":0.0-1.0}]}

Rules:
- max 5 items
- text max 120 chars, plain language, no markdown
- types: preference (user likes/dislikes), decision (agreed direction), constraint (hard limit), date (important date/deadline)
- only include facts genuinely useful for future tasks
- if nothing relevant: {"items":[]}
- importance: 1.0 = critical, 0.5 = useful, 0.0 = marginal
${existing}
Task prompt: ${input.prompt.slice(0, 500)}
Task summary: ${input.summary.slice(0, 200)}
Task result: ${input.resultText.slice(0, 400)}`;
}

function parseResponse(raw: string): BrainItem[] | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).items)
  ) {
    return null;
  }

  const VALID_TYPES: BrainItemType[] = ['preference', 'decision', 'constraint', 'date'];
  const items: BrainItem[] = [];

  for (const raw of (parsed as { items: unknown[] }).items) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (
      typeof item.type !== 'string' ||
      !VALID_TYPES.includes(item.type as BrainItemType) ||
      typeof item.text !== 'string' ||
      !item.text.trim()
    ) {
      continue;
    }
    items.push({
      type: item.type as BrainItemType,
      text: String(item.text).trim().slice(0, 120),
      importance:
        typeof item.importance === 'number' ? Math.min(1, Math.max(0, item.importance)) : 0.5,
    });
    if (items.length >= 5) break;
  }

  return items;
}

async function callProvider(
  provider: ApiKeyProvider,
  apiKey: string,
  prompt: string,
): Promise<string | null> {
  switch (provider) {
    case 'anthropic': {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-latest',
          max_tokens: 250,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`Anthropic ${res.status}`);
      const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
      return data.content?.[0]?.text ?? null;
    }
    case 'openai': {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 250,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}`);
      const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
      return data.choices?.[0]?.message?.content ?? null;
    }
    case 'google': {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 250 },
          }),
        },
      );
      if (!res.ok) throw new Error(`Google ${res.status}`);
      const data = (await res.json()) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      };
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    }
    case 'xai': {
      const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'grok-3',
          max_tokens: 250,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`xAI ${res.status}`);
      const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
      return data.choices?.[0]?.message?.content ?? null;
    }
    default:
      return null;
  }
}

export async function extractBrainFacts(
  input: ExtractorInput,
  getApiKey: GetApiKeyFn,
): Promise<BrainItem[] | null> {
  const prompt = buildExtractorPrompt(input);
  const providers: ApiKeyProvider[] = ['anthropic', 'openai', 'google', 'xai'];

  for (const provider of providers) {
    const apiKey = getApiKey(provider);
    if (!apiKey) continue;

    try {
      const raw = await callProvider(provider, apiKey, prompt);
      if (!raw) continue;
      const items = parseResponse(raw);
      if (items !== null) {
        return items;
      }
      // parse failed — try next provider
      console.warn(`[BrainExtractor] ${provider} returned unparseable response`);
    } catch (err) {
      console.warn(`[BrainExtractor] ${provider} failed:`, err);
    }
  }

  return null;
}
