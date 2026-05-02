/**
 * Generates an Anki .apkg from DeckCard[] (basic + cloze support).
 */

import initSqlJs from 'sql.js';
import JSZip from 'jszip';
import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs';
import type { DeckCard } from './types';

// Fixed IDs — separate from the chat deck to avoid merge conflicts
const DECK_ID = 1700000000010;
const MODEL_ID_BASIC = 1700000000011;
const MODEL_ID_CLOZE = 1700000000012;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function fieldChecksum(data: string): number {
  const hash = createHash('sha1').update(data, 'utf8').digest('hex');
  return parseInt(hash.substring(0, 8), 16);
}

function generateGuid(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

const CSS = `.card {
  font-family: "Helvetica Neue", Arial, sans-serif;
  font-size: 18px;
  color: #1a1a2e;
  background: #ffffff;
  padding: 20px;
  line-height: 1.7;
}
.front { font-size: 22px; font-weight: bold; margin-bottom: 12px; text-align: center; }
.back { font-size: 16px; color: #333; white-space: pre-wrap; text-align: left; }
hr#answer { border: none; border-top: 2px solid #e0e0e0; margin: 16px 0; }
.cloze { font-weight: bold; color: #3b82f6; }
.nightMode.card, .night_mode .card { color: #f0f0f0; background: #1a1a1a; }
.nightMode .back, .night_mode .back { color: #e8e8e8; }
.nightMode .front, .night_mode .front { color: #ffffff; }
.nightMode hr#answer, .night_mode hr#answer { border-top-color: #555; }
.nightMode .cloze, .night_mode .cloze { color: #60a5fa; }`;

function buildBasicModel() {
  return {
    id: String(MODEL_ID_BASIC),
    name: '学習カード（ベーシック）',
    type: 0,
    mod: nowSec(),
    usn: 0,
    sortf: 0,
    did: null,
    tmpls: [{
      name: 'Card 1',
      ord: 0,
      qfmt: '<div class="front">{{Front}}</div>',
      afmt: '{{FrontSide}}\n<hr id="answer">\n<div class="back">{{Back}}</div>',
      bqfmt: '',
      bafmt: '',
      did: null,
      bfont: '',
      bsize: 0,
    }],
    flds: [
      { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
      { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
    ],
    css: CSS,
    latexPre: '',
    latexPost: '',
    tags: [],
    vers: [],
  };
}

function buildClozeModel() {
  return {
    id: String(MODEL_ID_CLOZE),
    name: '学習カード（穴埋め）',
    type: 1,
    mod: nowSec(),
    usn: 0,
    sortf: 0,
    did: null,
    tmpls: [{
      name: 'Cloze',
      ord: 0,
      qfmt: '{{cloze:Text}}',
      afmt: '{{cloze:Text}}<br><br><div class="back">{{Extra}}</div>',
      bqfmt: '',
      bafmt: '',
      did: null,
      bfont: '',
      bsize: 0,
    }],
    flds: [
      { name: 'Text', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
      { name: 'Extra', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
    ],
    css: CSS,
    latexPre: '',
    latexPost: '',
    tags: [],
    vers: [],
  };
}

export async function generateApkgFromDeckCards(
  cards: DeckCard[],
  deckName: string
): Promise<Buffer> {
  const wasmPath = path.join(process.cwd(), 'public', 'sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  const SQL = await initSqlJs({ wasmBinary: wasmBinary.buffer as ArrayBuffer });
  const db = new SQL.Database();

  // Schema
  db.run(`CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER NOT NULL, mod INTEGER NOT NULL, scm INTEGER NOT NULL, ver INTEGER NOT NULL, dty INTEGER NOT NULL, usn INTEGER NOT NULL, ls INTEGER NOT NULL, conf TEXT NOT NULL, models TEXT NOT NULL, decks TEXT NOT NULL, dconf TEXT NOT NULL, tags TEXT NOT NULL)`);
  db.run(`CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT NOT NULL, mid INTEGER NOT NULL, mod INTEGER NOT NULL, usn INTEGER NOT NULL, tags TEXT NOT NULL, flds TEXT NOT NULL, sfld INTEGER NOT NULL, csum INTEGER NOT NULL, flags INTEGER NOT NULL, data TEXT NOT NULL)`);
  db.run(`CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER NOT NULL, did INTEGER NOT NULL, ord INTEGER NOT NULL, mod INTEGER NOT NULL, usn INTEGER NOT NULL, type INTEGER NOT NULL, queue INTEGER NOT NULL, due INTEGER NOT NULL, ivl INTEGER NOT NULL, factor INTEGER NOT NULL, reps INTEGER NOT NULL, lapses INTEGER NOT NULL, left INTEGER NOT NULL, odue INTEGER NOT NULL, odid INTEGER NOT NULL, flags INTEGER NOT NULL, data TEXT NOT NULL)`);
  db.run(`CREATE TABLE revlog (id INTEGER PRIMARY KEY, cid INTEGER NOT NULL, usn INTEGER NOT NULL, ease INTEGER NOT NULL, ivl INTEGER NOT NULL, lastIvl INTEGER NOT NULL, factor INTEGER NOT NULL, time INTEGER NOT NULL, type INTEGER NOT NULL)`);
  db.run(`CREATE TABLE graves (usn INTEGER NOT NULL, oid INTEGER NOT NULL, type INTEGER NOT NULL)`);
  db.run('CREATE INDEX ix_notes_usn ON notes (usn)');
  db.run('CREATE INDEX ix_cards_usn ON cards (usn)');
  db.run('CREATE INDEX ix_cards_nid ON cards (nid)');
  db.run('CREATE INDEX ix_cards_sched ON cards (did, queue, due)');
  db.run('CREATE INDEX ix_revlog_usn ON revlog (usn)');
  db.run('CREATE INDEX ix_revlog_cid ON revlog (cid)');

  const now = nowSec();
  const hasBasic = cards.some((c) => c.type === 'basic');
  const hasCloze = cards.some((c) => c.type === 'cloze');

  const models: Record<string, unknown> = {};
  if (hasBasic) models[String(MODEL_ID_BASIC)] = buildBasicModel();
  if (hasCloze) models[String(MODEL_ID_CLOZE)] = buildClozeModel();

  const deck = {
    [String(DECK_ID)]: {
      id: DECK_ID, name: deckName, desc: '', mod: now, usn: 0, conf: 1,
      extendRev: 50, extendNew: 10, collapsed: false, browserCollapsed: false,
      dyn: 0, newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0],
    },
    '1': {
      id: 1, name: 'Default', conf: 1, desc: '', mod: now, usn: 0,
      collapsed: false, browserCollapsed: false, dyn: 0,
      extendNew: 10, extendRev: 50, newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0],
    },
  };

  const deckConf = {
    '1': {
      id: 1, mod: 0, name: 'Default', usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true,
      new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
      lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
      rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 100 },
    },
  };

  const globalConf = {
    activeDecks: [DECK_ID], curDeck: DECK_ID, newSpread: 0, collapseTime: 1200,
    timeLim: 0, estTimes: true, dueCounts: true, curModel: null, nextPos: 1,
    sortType: 'noteFld', sortBackwards: false, addToCur: true, dayLearnFirst: false, schedVer: 2,
  };

  db.run(`INSERT INTO col VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    1, now, now, now, 11, 0, 0, 0,
    JSON.stringify(globalConf),
    JSON.stringify(models),
    JSON.stringify(deck),
    JSON.stringify(deckConf),
    '{}',
  ]);

  let cardDue = 1;
  for (const card of cards) {
    const noteId = Date.now() + cardDue;
    const guid = generateGuid();
    const modelId = card.type === 'cloze' ? MODEL_ID_CLOZE : MODEL_ID_BASIC;
    // Basic: Front\x1fBack  |  Cloze: Text\x1fExtra
    const flds = `${card.front}\x1f${card.back}`;
    const sfld = card.front;
    const csum = fieldChecksum(sfld);
    const tagsStr = card.tags.length > 0 ? ' ' + card.tags.join(' ') + ' ' : '';

    db.run(`INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
      noteId, guid, modelId, now, -1, tagsStr, flds, sfld, csum, 0, '',
    ]);

    const cardId = noteId + 1000000;
    db.run(`INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      cardId, noteId, DECK_ID, 0, now, -1, 0, 0, cardDue, 0, 0, 0, 0, 0, 0, 0, 0, '',
    ]);

    cardDue++;
    await new Promise((r) => setTimeout(r, 1));
  }

  const sqliteBuffer = Buffer.from(db.export());
  db.close();

  const zip = new JSZip();
  zip.file('collection.anki2', sqliteBuffer);
  zip.file('media', '{}');

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
