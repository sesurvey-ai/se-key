import { db, initSchema } from './db.js';

initSchema();

const { count } = db.prepare('SELECT COUNT(*) AS count FROM records').get();
console.log(`schema ready. current row count: ${count}`);
