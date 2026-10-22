'use strict';

// Validates releases.json next to this script. Run from the repo root:
//   node data/validate.js
// Exits 0 and prints "OK: <n> releases valid" on success; exits 1 with a
// message on stderr otherwise.

const fs = require('fs');
const path = require('path');

const dataFile = path.join(__dirname, 'releases.json');

function fail(message) {
  console.error(`validate: ${message}`);
  process.exit(1);
}

let releases;
try {
  releases = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
} catch (err) {
  fail(`cannot read or parse ${dataFile}: ${err.message}`);
}

if (!Array.isArray(releases) || releases.length === 0) {
  fail('releases.json must contain a non-empty array of releases');
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

releases.forEach((release, index) => {
  const label = `release #${index + 1}`;

  if (release === null || typeof release !== 'object' || Array.isArray(release)) {
    fail(`${label} must be an object`);
  }
  for (const field of ['version', 'date', 'notes']) {
    if (!Object.prototype.hasOwnProperty.call(release, field)) {
      fail(`${label} is missing "${field}"`);
    }
  }
  for (const field of ['version', 'date']) {
    if (typeof release[field] !== 'string' || release[field].length === 0) {
      fail(`${label} has "${field}" that is not a non-empty string`);
    }
  }
  if (!Array.isArray(release.notes) || release.notes.length < 1) {
    fail(`${label} has "notes" that is not an array with at least 1 item`);
  }
  release.notes.forEach((note, noteIndex) => {
    if (typeof note !== 'string' || note.length === 0) {
      fail(`${label} note #${noteIndex + 1} is not a non-empty string`);
    }
  });
  if (!isValidIsoDate(release.date)) {
    fail(`${label} has date "${release.date}" which is not a valid YYYY-MM-DD date`);
  }
});

for (let i = 0; i + 1 < releases.length; i++) {
  const current = releases[i].date;
  const next = releases[i + 1].date;
  if (!(current > next)) {
    fail(`dates must be sorted strictly newest-first: ${current} (release #${i + 1}) is not later than ${next} (release #${i + 2})`);
  }
}

console.log(`OK: ${releases.length} releases valid`);
