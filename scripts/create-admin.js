'use strict';

// Create (or reset the password of) an admin user from the command line.
// Usage: npm run create-admin -- "Full Name" email@example.org "a long password"

const { openDatabase } = require('../src/db');
const { hashPassword } = require('../src/auth');

const [name, email, password] = process.argv.slice(2);
if (!name || !email || !password || password.length < 10) {
  console.error('Usage: npm run create-admin -- "Full Name" email@example.org "password (10+ chars)"');
  process.exit(1);
}

const db = openDatabase();
db.run(
  `INSERT INTO users (name, email, password_hash, role) VALUES (:name, :email, :hash, 'admin')
   ON CONFLICT (email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash, role = 'admin'`,
  { name, email: email.toLowerCase(), hash: hashPassword(password) },
);
db.run('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = :email)', { email: email.toLowerCase() });
console.log(`Admin ${email} is ready.`);
db.close();
