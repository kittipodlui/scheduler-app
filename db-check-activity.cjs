/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const mysql = require('mysql2/promise');

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) {
    env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

(async () => {
  const db = await mysql.createConnection({
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
  });

  const [users] = await db.query('SELECT id, username FROM users WHERE active = 1 ORDER BY id DESC LIMIT 5');
  console.log('users', users);

  for (const row of users) {
    const [subjects] = await db.query(
      `SELECT s.subject_key, s.label, s.kind, s.category_id, p.is_added
       FROM subjects s
       LEFT JOIN user_subject_preferences p ON p.subject_key = s.subject_key AND p.user_id = ?
       WHERE (s.user_id IS NULL OR s.user_id = ?)
       ORDER BY s.category_id, s.sort_order, s.label`,
      [row.id, row.id],
    );
    console.log(row.username, subjects);
  }

  await db.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
