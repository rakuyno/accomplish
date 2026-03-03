import { getDatabase } from '../database.js';

export interface Agent {
  id: string;
  name: string;
  system_prompt: string;
  created_at: string;
}

interface AgentRow {
  id: string;
  name: string;
  system_prompt: string;
  created_at: string;
}

function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    system_prompt: row.system_prompt,
    created_at: row.created_at,
  };
}

export function getAllAgents(): Agent[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM agents ORDER BY created_at ASC').all() as AgentRow[];
  return rows.map(rowToAgent);
}

export function getAgentById(id: string): Agent | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined;
  return row ? rowToAgent(row) : null;
}

export function createAgent(agent: Omit<Agent, 'created_at'>): Agent {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO agents (id, name, system_prompt, created_at) VALUES (?, ?, ?, ?)').run(
    agent.id,
    agent.name,
    agent.system_prompt,
    now,
  );
  return { ...agent, created_at: now };
}

export function updateAgent(
  id: string,
  fields: Partial<Pick<Agent, 'name' | 'system_prompt'>>,
): void {
  const db = getDatabase();
  const parts: string[] = [];
  const values: unknown[] = [];

  if (fields.name !== undefined) {
    parts.push('name = ?');
    values.push(fields.name);
  }
  if (fields.system_prompt !== undefined) {
    parts.push('system_prompt = ?');
    values.push(fields.system_prompt);
  }

  if (parts.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE agents SET ${parts.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteAgent(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM agents WHERE id = ?').run(id);
}

export function getSelectedAgentId(): string {
  const db = getDatabase();
  const row = db.prepare('SELECT selected_agent_id FROM app_settings WHERE id = 1').get() as
    | { selected_agent_id: string }
    | undefined;
  return row?.selected_agent_id ?? 'default';
}

export function setSelectedAgentId(agentId: string): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET selected_agent_id = ? WHERE id = 1').run(agentId);
}

export function getSelectedAgent(): Agent | null {
  const agentId = getSelectedAgentId();
  return getAgentById(agentId);
}
