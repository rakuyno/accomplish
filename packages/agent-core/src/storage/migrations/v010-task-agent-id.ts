import type { Database } from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: 10,
  up: (db: Database) => {
    db.exec(`ALTER TABLE tasks ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default'`);
  },
};
