/**
 * @fileoverview Conversation history repository — PostgreSQL, async.
 */

/**
 * @param {import('postgres').Sql} sql
 */
export function createConversationRepo(sql) {
  return {
    async addMessage(phone, role, content, toolName = null) {
      const [row] = await sql`
        INSERT INTO conversations (phone, role, content, tool_name)
        VALUES (${phone}, ${role}, ${content}, ${toolName})
        RETURNING id
      `;
      return Number(row.id);
    },

    async getRecent(phone, minutes = 30) {
      return sql`
        SELECT * FROM conversations
        WHERE phone = ${phone}
          AND created_at >= NOW() - (${minutes} || ' minutes')::INTERVAL
        ORDER BY created_at ASC
      `;
    },

    async getCount(phone, minutes = 30) {
      const [row] = await sql`
        SELECT COUNT(*)::int AS count FROM conversations
        WHERE phone = ${phone}
          AND created_at >= NOW() - (${minutes} || ' minutes')::INTERVAL
      `;
      return row.count;
    },

    async getLastN(phone, limit = 50) {
      return sql`
        SELECT * FROM conversations
        WHERE phone = ${phone}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    },

    async cleanup(days = 7) {
      const result = await sql`
        DELETE FROM conversations
        WHERE created_at < NOW() - (${days} || ' days')::INTERVAL
      `;
      return result.count;
    },
  };
}
