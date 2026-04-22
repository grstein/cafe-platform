/**
 * @fileoverview Conversation history repository for the multi-tenant platform.
 *
 * Stores chat messages (user + assistant + tool calls) in SQLite,
 * enabling recent context retrieval for the agent pipeline enricher.
 * Factory pattern — call createConversationRepo(db).
 */

/** @typedef {import('better-sqlite3').Database} Database */

/**
 * @typedef {Object} ConversationMessage
 * @property {number} id
 * @property {string} phone
 * @property {string} role - 'user', 'assistant', or 'tool'.
 * @property {string} content - Message content text.
 * @property {string|null} tool_name - Tool name if role is 'tool'.
 * @property {string} created_at
 */

/**
 * Creates a conversation repository bound to the given database instance.
 *
 * @param {Database} db - better-sqlite3 database instance (already migrated).
 * @returns {ReturnType<typeof _buildRepo>}
 */
export function createConversationRepo(db) {
  return _buildRepo(db);
}

/**
 * @param {Database} db
 */
function _buildRepo(db) {
  // ── Prepared statements ──────────────────────────────────────────────

  const stmtInsert = db.prepare(
    'INSERT INTO conversations (phone, role, content, tool_name) VALUES (?, ?, ?, ?)'
  );

  const stmtGetRecent = db.prepare(
    [
      'SELECT * FROM conversations',
      "WHERE phone = ? AND created_at >= datetime('now', ? || ' minutes')",
      'ORDER BY created_at ASC',
    ].join(' ')
  );

  const stmtGetCount = db.prepare(
    [
      'SELECT COUNT(*) AS count FROM conversations',
      "WHERE phone = ? AND created_at >= datetime('now', ? || ' minutes')",
    ].join(' ')
  );

  const stmtCleanup = db.prepare(
    "DELETE FROM conversations WHERE created_at < datetime('now', ? || ' days')"
  );

  const stmtGetLastN = db.prepare(
    'SELECT * FROM conversations WHERE phone = ? ORDER BY created_at DESC LIMIT ?'
  );

  // ── Public API ───────────────────────────────────────────────────────

  return {
    /**
     * Add a message to the conversation history.
     *
     * @param {string} phone - Phone number.
     * @param {string} role - Message role ('user', 'assistant', 'tool').
     * @param {string} content - Message content.
     * @param {string|null} [toolName=null] - Tool name if role is 'tool'.
     * @returns {number} The inserted row ID.
     */
    addMessage(phone, role, content, toolName = null) {
      const result = stmtInsert.run(phone, role, content, toolName);
      return Number(result.lastInsertRowid);
    },

    /**
     * Get recent conversation messages within a time window.
     *
     * @param {string} phone - Phone number.
     * @param {number} [minutes=30] - How many minutes back to look.
     * @returns {ConversationMessage[]} Messages in chronological order.
     */
    getRecent(phone, minutes = 30) {
      return stmtGetRecent.all(phone, '-' + minutes);
    },

    /**
     * Count messages within a time window.
     *
     * @param {string} phone - Phone number.
     * @param {number} [minutes=30] - How many minutes back to look.
     * @returns {number} Message count.
     */
    getCount(phone, minutes = 30) {
      const row = stmtGetCount.get(phone, '-' + minutes);
      return row.count;
    },

    /**
     * Get the N most recent messages (newest first).
     *
     * @param {string} phone - Phone number.
     * @param {number} [limit=50] - Maximum number of messages.
     * @returns {ConversationMessage[]} Messages newest-first.
     */
    getLastN(phone, limit = 50) {
      return stmtGetLastN.all(phone, limit);
    },

    /**
     * Delete messages older than the given number of days.
     *
     * @param {number} [days=7] - Delete messages older than this many days.
     * @returns {number} Number of rows deleted.
     */
    cleanup(days = 7) {
      const result = stmtCleanup.run('-' + days);
      return result.changes;
    },
  };
}
