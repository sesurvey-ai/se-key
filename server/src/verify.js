import { db } from './db.js';

const total = db.prepare('SELECT COUNT(*) AS c FROM records').get().c;
const withSurvey = db.prepare("SELECT COUNT(*) AS c FROM records WHERE survey_no != ''").get().c;
const uniqueClaims = db.prepare('SELECT COUNT(DISTINCT claim_no) AS c FROM records').get().c;
const uniqueSurveys = db.prepare("SELECT COUNT(DISTINCT survey_no) AS c FROM records WHERE survey_no != ''").get().c;
const minDate = db.prepare("SELECT MIN(created_at) AS d FROM records WHERE created_at != ''").get().d;
const maxDate = db.prepare("SELECT MAX(created_at) AS d FROM records WHERE created_at != ''").get().d;

console.log({ total, withSurvey, uniqueClaims, uniqueSurveys, minDate, maxDate });

console.log('\nwork_type breakdown:');
for (const row of db.prepare("SELECT work_type, COUNT(*) AS c FROM records GROUP BY work_type ORDER BY c DESC").all()) {
  console.log(' ', JSON.stringify(row.work_type), '->', row.c);
}

console.log('\n5 most recent rows:');
for (const row of db.prepare('SELECT * FROM records ORDER BY id DESC LIMIT 5').all()) {
  console.log(' ', row);
}
