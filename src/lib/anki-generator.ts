/**
 * Generates an Anki .apkg binary from a list of cards.
 *
 * .apkg format = ZIP containing:
 *   - collection.anki2  (SQLite database)
 *   - media             (JSON: {} when no media files)
 *
 * Fixed IDs ensure every export merges into the same deck in AnkiDroid.
 */

import initSqlJs from 'sql.js';
import JSZip from 'jszip';
import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs';
import type { AnkiCard, ExportPattern } from './types';

// ─── Fixed IDs (never change — guarantees merge into one deck) ───────────────
const DECK_ID = 1700000000001;
const MODEL_ID_EN_TO_JA = 1700000000002;
const MODEL_ID_JA_TO_EN = 1700000000003;
const DECK_NAME = 'AI英会話';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** SHA-1 based checksum used by Anki for notes */
function fieldChecksum(data: string): number {
  const hash = createHash('sha1').update(data, 'utf8').digest('hex');
  return parseInt(hash.substring(0, 8), 16);
}

/** Random GUID string for notes (Anki requires globally-unique ids) */
function generateGuid(): string {
  const chars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// ─── Model (Note Type) definitions ───────────────────────────────────────────

const CSS = `.card {
  font-family: "Helvetica Neue", Arial, sans-serif;
  font-size: 20px;
  text-align: center;
  color: #1a1a2e;
  background-color: #ffffff;
  padding: 20px;
  line-height: 1.6;
}
.front { font-size: 24px; font-weight: bold; margin-bottom: 12px; }
.back { font-size: 16px; color: #444; white-space: pre-wrap; text-align: left; }
hr#answer { border: none; border-top: 2px solid #e0e0e0; margin: 16px 0; }`;

function buildModel(pattern: ExportPattern) {
  const id = pattern === 'en-to-ja' ? MODEL_ID_EN_TO_JA : MODEL_ID_JA_TO_EN;
  const name =
    pattern === 'en-to-ja'
      ? 'AI英会話カード (英→日)'
      : 'AI英会話カード (日→英)';

  // Pattern A: English front, Japanese back (with TTS on front)
  // Pattern B: Japanese front, English back (with TTS on back)
  const qfmt =
    pattern === 'en-to-ja'
      ? '<div class="front">{{Front}}</div>\n{{tts en_US:Front}}'
      : '<div class="front">{{Back}}</div>';

  const afmt =
    pattern === 'en-to-ja'
      ? '{{FrontSide}}\n<hr id="answer">\n<div class="back">{{Back}}</div>'
      : '{{FrontSide}}\n<hr id="answer">\n<div class="back">{{Front}}</div>\n{{tts en_US:Front}}';

  return {
    id: String(id),
    name,
    type: 0,
    mod: nowSec(),
    usn: 0,
    sortf: 0,
    did: null,
    tmpls: [
      {
        name: 'Card 1',
        ord: 0,
        qfmt,
        afmt,
        bqfmt: '',
        bafmt: '',
        did: null,
        bfont: '',
        bsize: 0,
      },
    ],
    flds: [
      {
        name: 'Front',
        ord: 0,
        sticky: false,
        rtl: false,
        font: 'Arial',
        size: 20,
        media: [],
      },
      {
        name: 'Back',
        ord: 1,
        sticky: false,
        rtl: false,
        font: 'Arial',
        size: 20,
        media: [],
      },
    ],
    css: CSS,
    latexPre:
      '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
    latexPost: '\\end{document}',
    tags: [],
    vers: [],
  };
}

// ─── Deck definition ─────────────────────────────────────────────────────────

function buildDeck() {
  const now = nowSec();
  return {
    [String(DECK_ID)]: {
      id: DECK_ID,
      name: DECK_NAME,
      desc: 'AI英会話アプリで自動生成されたデッキ',
      mod: now,
      usn: 0,
      conf: 1,
      extendRev: 50,
      extendNew: 10,
      collapsed: false,
      browserCollapsed: false,
      dyn: 0,
      newToday: [0, 0],
      revToday: [0, 0],
      lrnToday: [0, 0],
      timeToday: [0, 0],
    },
    '1': {
      id: 1,
      name: 'Default',
      conf: 1,
      desc: '',
      mod: now,
      usn: 0,
      collapsed: false,
      browserCollapsed: false,
      dyn: 0,
      extendNew: 10,
      extendRev: 50,
      newToday: [0, 0],
      revToday: [0, 0],
      lrnToday: [0, 0],
      timeToday: [0, 0],
    },
  };
}

const DECK_CONF = {
  '1': {
    id: 1,
    mod: 0,
    name: 'Default',
    usn: 0,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    new: {
      bury: true,
      delays: [1, 10],
      initialFactor: 2500,
      ints: [1, 4, 7],
      order: 1,
      perDay: 20,
      separate: true,
    },
    lapse: {
      delays: [10],
      leechAction: 0,
      leechFails: 8,
      minInt: 1,
      mult: 0,
    },
    rev: {
      bury: true,
      ease4: 1.3,
      fuzz: 0.05,
      ivlFct: 1,
      maxIvl: 36500,
      minSpace: 1,
      perDay: 100,
    },
  },
};

const GLOBAL_CONF = {
  activeDecks: [DECK_ID],
  curDeck: DECK_ID,
  newSpread: 0,
  collapseTime: 1200,
  timeLim: 0,
  estTimes: true,
  dueCounts: true,
  curModel: null,
  nextPos: 1,
  sortType: 'noteFld',
  sortBackwards: false,
  addToCur: true,
  dayLearnFirst: false,
  schedVer: 2,
};

// ─── Main export function ─────────────────────────────────────────────────────

export async function generateApkg(
  cards: AnkiCard[],
  pattern: ExportPattern
): Promise<Buffer> {
  // Load sql.js WASM from public directory (copied via postinstall)
  const wasmPath = path.join(process.cwd(), 'public', 'sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  const SQL = await initSqlJs({ wasmBinary });

  const db = new SQL.Database();

  // ── Schema ────────────────────────────────────────────────────────────────
  db.run(`CREATE TABLE col (
    id INTEGER PRIMARY KEY,
    crt INTEGER NOT NULL,
    mod INTEGER NOT NULL,
    scm INTEGER NOT NULL,
    ver INTEGER NOT NULL,
    dty INTEGER NOT NULL,
    usn INTEGER NOT NULL,
    ls  INTEGER NOT NULL,
    conf TEXT NOT NULL,
    models TEXT NOT NULL,
    decks TEXT NOT NULL,
    dconf TEXT NOT NULL,
    tags TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE notes (
    id   INTEGER PRIMARY KEY,
    guid TEXT    NOT NULL,
    mid  INTEGER NOT NULL,
    mod  INTEGER NOT NULL,
    usn  INTEGER NOT NULL,
    tags TEXT    NOT NULL,
    flds TEXT    NOT NULL,
    sfld INTEGER NOT NULL,
    csum INTEGER NOT NULL,
    flags INTEGER NOT NULL,
    data TEXT    NOT NULL
  )`);

  db.run(`CREATE TABLE cards (
    id     INTEGER PRIMARY KEY,
    nid    INTEGER NOT NULL,
    did    INTEGER NOT NULL,
    ord    INTEGER NOT NULL,
    mod    INTEGER NOT NULL,
    usn    INTEGER NOT NULL,
    type   INTEGER NOT NULL,
    queue  INTEGER NOT NULL,
    due    INTEGER NOT NULL,
    ivl    INTEGER NOT NULL,
    factor INTEGER NOT NULL,
    reps   INTEGER NOT NULL,
    lapses INTEGER NOT NULL,
    left   INTEGER NOT NULL,
    odue   INTEGER NOT NULL,
    odid   INTEGER NOT NULL,
    flags  INTEGER NOT NULL,
    data   TEXT    NOT NULL
  )`);

  db.run(`CREATE TABLE revlog (
    id      INTEGER PRIMARY KEY,
    cid     INTEGER NOT NULL,
    usn     INTEGER NOT NULL,
    ease    INTEGER NOT NULL,
    ivl     INTEGER NOT NULL,
    lastIvl INTEGER NOT NULL,
    factor  INTEGER NOT NULL,
    time    INTEGER NOT NULL,
    type    INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE graves (
    usn  INTEGER NOT NULL,
    oid  INTEGER NOT NULL,
    type INTEGER NOT NULL
  )`);

  db.run('CREATE INDEX ix_notes_usn ON notes (usn)');
  db.run('CREATE INDEX ix_cards_usn ON cards (usn)');
  db.run('CREATE INDEX ix_cards_nid ON cards (nid)');
  db.run('CREATE INDEX ix_cards_sched ON cards (did, queue, due)');
  db.run('CREATE INDEX ix_revlog_usn ON revlog (usn)');
  db.run('CREATE INDEX ix_revlog_cid ON revlog (cid)');

  // ── Insert col ────────────────────────────────────────────────────────────
  const now = nowSec();
  const modelDef = buildModel(pattern);
  const modelId =
    pattern === 'en-to-ja' ? MODEL_ID_EN_TO_JA : MODEL_ID_JA_TO_EN;

  db.run(
    `INSERT INTO col VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      1,
      now,
      now,
      now,
      11,
      0,
      0,
      0,
      JSON.stringify(GLOBAL_CONF),
      JSON.stringify({ [String(modelId)]: modelDef }),
      JSON.stringify(buildDeck()),
      JSON.stringify(DECK_CONF),
      '{}',
    ]
  );

  // ── Insert notes & cards ──────────────────────────────────────────────────
  let cardDue = 1;
  for (const card of cards) {
    const noteId = Date.now() + cardDue; // unique ms-based id
    const guid = generateGuid();
    // Fields separator in Anki is \x1f
    const flds = `${card.front}\x1f${card.back}`;
    const sfld = card.front;
    const csum = fieldChecksum(sfld);

    db.run(`INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
      noteId,
      guid,
      modelId,
      now,
      -1,
      '',
      flds,
      sfld,
      csum,
      0,
      '',
    ]);

    const cardId = noteId + 1000000;
    db.run(`INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      cardId,
      noteId,
      DECK_ID,
      0,
      now,
      -1,
      0,   // type: new
      0,   // queue: new
      cardDue,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      '',
    ]);

    cardDue++;
    // Small delay to ensure unique noteId
    await new Promise((r) => setTimeout(r, 1));
  }

  // ── Export as buffer ──────────────────────────────────────────────────────
  const sqliteBuffer = Buffer.from(db.export());
  db.close();

  // ── Package into .apkg (ZIP) ──────────────────────────────────────────────
  const zip = new JSZip();
  zip.file('collection.anki2', sqliteBuffer);
  zip.file('media', '{}');

  const apkgBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return apkgBuffer;
}
