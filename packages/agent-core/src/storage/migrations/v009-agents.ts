import type { Database } from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: 9,
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        system_prompt TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.exec(
      `INSERT INTO agents (id, name, system_prompt, created_at) VALUES ('default', 'Default', '', datetime('now'))`,
    );

    db.exec(
      `ALTER TABLE app_settings ADD COLUMN selected_agent_id TEXT NOT NULL DEFAULT 'default'`,
    );
  },
};
