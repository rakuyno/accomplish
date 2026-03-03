import type { Database } from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: 11,
  up: (db: Database) => {
    db.exec(`UPDATE agents SET name = 'Omnibot' WHERE id = 'default' AND name = 'Default'`);
  },
};
