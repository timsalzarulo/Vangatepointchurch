'use strict';

// Fills the database with fictional demo data so you can explore the app.
// Usage: npm run seed:demo            (refuses if people already exist)
//        npm run seed:demo -- --force (adds demo data anyway)

const { openDatabase } = require('../src/db');
const { loadDemo } = require('../src/demo');

const db = openDatabase();
if (db.get('SELECT COUNT(*) AS n FROM people').n > 0 && !process.argv.includes('--force')) {
  console.error('People already exist in this database. Re-run with --force to add demo data anyway.');
  process.exit(1);
}
console.log(`Demo data loaded: ${loadDemo(db)} people.`);
db.close();
