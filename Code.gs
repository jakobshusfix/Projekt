/**
 * Jakobs HusFix – bokningsbackend (Google Apps Script)
 * =============================================================
 * Den här filen körs som en Google Apps Script-webbapp och gör fyra saker:
 *
 *   1. Tar emot bokningsförfrågningar från sajten och mejlar dem till
 *      JakobsHusFix@gmail.com.
 *   2. Låter Jakob godkänna eller neka en förfrågan – direkt i ägarpanelen på
 *      sajten (flik 3) eller från knapparna i mejlet.
 *   3. Håller koll på bokade tider: en godkänd tid kan inte bokas igen,
 *      men en nekad tid blir ledig för någon annan.
 *   4. Sköter konton och de tider Jakob själv markerar i ägarpanelen på
 *      sajten ("Lediga tider"-sektionen). Markeringarna är offentliga – alla
 *      besökare, även gäster som inte är inloggade, ser vilka tider som är
 *      lediga och vilka som är bokade. Kundnamn lämnas aldrig ut till gäster.
 *
 * Alla bokningar, konton och tidsmarkeringar sparas i ett Google-kalkylark
 * (flikarna Bokningar, Konton, Tider och Sessioner). Se README.md för
 * installationssteg (tar några minuter och kostar ingenting).
 *
 * Regler som gäller för tiderna:
 *   - En riktig kundbokning (Väntar eller Bekräftad) vinner alltid över
 *     Jakobs egna markeringar. En förfrågan som väntar på svar godkänns eller
 *     nekas antingen i ägarpanelen på sajten eller från mejlet – en bekräftad
 *     tid kan bara frigöras genom att bokningen nekas.
 *   - Jakobs markering "Bokad" håller tiden upptagen för alla.
 *   - Jakobs markering "Ledig" tar bort en egen "Bokad"-markering och gör
 *     tiden bokningsbar igen.
 *   - En tid utanför ordinarie öppettider (07–22) som Jakob markerar som
 *     ledig blir en extra bokningsbar tid på sajten.
 * =============================================================
 */

var CONFIG = {
  COMPANY: 'Jakobs HusFix',
  OWNER_NAME: 'Jakob',
  OWNER_EMAIL: 'jakobshusfix@gmail.com',
  /* Ägarkontot. Kör funktionen skapaAgarkontot en gång (den skapar kontot med
     uppgifterna nedan), logga sedan in på sajten under fliken Konto. Den här
     filen laddas aldrig upp till sajten – den klistras bara in i Google Apps
     Script. Vill du byta lösenord: ändra OWNER_PASSWORD nedan, kör
     skapaAgarkontot igen och logga in med det nya lösenordet. */
  OWNER_USER: 'jakob',
  OWNER_PASSWORD: 'JakobsHusFix2026',
  SHEET_NAME: 'Bokningar',
  /* Flikarna för konton, Jakobs tidsmarkeringar och inloggningar. */
  SHEET_ACCOUNTS: 'Konton',
  SHEET_SLOTS: 'Tider',
  SHEET_SESSIONS: 'Sessioner',
  /* Hur länge en inloggning håller innan den måste göras om. */
  SESSION_HOURS: 12,
  /* Hur många dagar en och samma förfrågan om lediga tider får omfatta. */
  MAX_DAYS_PER_REQUEST: 31,
  PRICE_PER_WINDOW: 70,
  /* Adressen till den här webbappen. Den läses normalt automatiskt från
     publiceringen (se getWebAppUrl_), men om godkänn- och nekalänkarna i
     mejlet någon gång skulle peka fel kan /exec-adressen klistras in här i
     stället. Adressen syns i webbläsarens adressfält när sajten använder
     bokningssystemet (den slutar på /exec). */
  WEB_APP_URL: '',
  /* Minsta framförhållning i minuter innan en tid får bokas. Samma regel
     finns på sajten (BOOKING_LEAD_MINUTES i js/main.js) – ändra på båda
     ställena om du ändrar den. */
  BOOKING_LEAD_MINUTES: 60,
  TZ: 'Europe/Stockholm'
};

var HEADERS = [
  'ID', 'Token', 'Skapad', 'Status', 'Namn', 'Telefon', 'E-post', 'Antal fönster',
  'Fastighet', 'Adress', 'Område', 'Datum', 'Tid', 'Pris (kr)', 'Meddelande', 'Beslutad'
];

var ACCOUNT_HEADERS = [
  'Användarnamn', 'Namn', 'Roll', 'Salt', 'Hash', 'Skapad', 'Senast inloggad'
];

var SLOT_HEADERS = ['Datum', 'Tid', 'Status', 'Ändrad av', 'Ändrad'];

var SESSION_HEADERS = ['Token', 'Användarnamn', 'Namn', 'Roll', 'Skapad', 'Går ut'];

var STATUS_WAITING = 'Väntar';
var STATUS_CONFIRMED = 'Bekräftad';
var STATUS_DECLINED = 'Avslagen';

/* Roller. Bara ROLE_OWNER får ändra tider – övriga konton kan logga in men
   ser ingen ägarflik. */
var ROLE_OWNER = 'agare';
var ROLE_STAFF = 'personal';

/* Jakobs markeringar i fliken Tider. */
var SLOT_BUSY = 'Bokad';
var SLOT_FREE = 'Ledig';
/* Tar bort markeringen helt, så att tiden går tillbaka till ordinarie schema.
   Används för att stänga en extratid som har öppnats utanför schemat. */
var SLOT_AUTO = 'Auto';

/* Tider utanför ordinarie öppettider som Jakob kan öppna som extra tider.
   Ordinarie tider styrs av isValidSlot_ nedan. */
var OPEN_HOUR_START = 7;
var OPEN_HOUR_END = 22;

/* ============================================================
   HJÄLPARE
   ============================================================ */

function clean_(v) { return String(v == null ? '' : v).trim(); }

function escapeHtml_(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function digits_(v) { return clean_(v).replace(/[^0-9]/g, ''); }

function isEmail_(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean_(v)); }

function firstName_(name) { return clean_(name).split(/\s+/)[0] || ''; }

function todayIso_() { return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd'); }

function nowStamp_() { return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd HH:mm'); }

function weekday_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean_(iso));
  if (!m) return -1;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
}

function isRealDate_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean_(iso));
  if (!m) return false;
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/* Samma tider som på sajten: mån–fre 15–20, lör–sön 10–18. */
function isValidSlot_(datum, tid) {
  return standardSlots_(datum).indexOf(clean_(tid)) !== -1;
}

/* Är tiden redan passerad – eller för nära inpå för att hinna bokas?
   Samma framförhållning som på sajten (BOOKING_LEAD_MINUTES i js/main.js). */
function isTooLateToBook_(datum, tid) {
  var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean_(datum));
  var t = /^([01]\d|2[0-3]):00$/.exec(clean_(tid));
  if (!d || !t) return true;

  var start = new Date(+d[1], +d[2] - 1, +d[3], parseInt(t[1], 10), 0, 0, 0);
  return start.getTime() < new Date().getTime() + CONFIG.BOOKING_LEAD_MINUTES * 60000;
}

/* Adressen till webbappen. Publiceringen ger rätt /exec-adress; går den inte
   att läsa (t.ex. när koden körs inifrån redigeraren) används i första hand
   WEBAPP_URL i skriptets egenskaper och därefter CONFIG.WEB_APP_URL. Utan en
   fungerande adress blir godkänn- och nekalänkarna i mejlet obrukbara – därför
   kontrolleras att det verkligen är en https-adress innan den används. */
function getWebAppUrl_() {
  var url = '';
  try { url = clean_(ScriptApp.getService().getUrl()); } catch (err) { /* körs t.ex. inifrån redigeraren */ }
  if (!isWebAppUrl_(url)) {
    url = clean_(PropertiesService.getScriptProperties().getProperty('WEBAPP_URL'));
  }
  if (!isWebAppUrl_(url)) url = clean_(CONFIG.WEB_APP_URL);
  return isWebAppUrl_(url) ? url : '';
}

function isWebAppUrl_(url) { return /^https:\/\/\S+$/.test(clean_(url)); }

function htmlOut_(html) {
  return ContentService.createTextOutput(html).setMimeType(ContentService.MimeType.HTML);
}

/* ============================================================
   SNABBA LÄSNINGAR INOM SAMMA ANROP
   Ett anrop till webbappen läser kalkylarket flera gånger om: tvåveckorslistan
   frågar efter bokningar och markeringar för var och en av de 14 dagarna, och
   varje läsning kostar tid hos Google. Här sparas kalkylarket och de inlästa
   raderna under det anrop som pågår – cachen töms alltid i början av doGet och
   doPost och varje gång något skrivs, så att svaret bygger på färsk data.
   Effekten är att "Uppdatera" på sajten svarar på en bråkdel av tiden.
   ============================================================ */

var JH_MEMO_ = {};

/* Glöm allt (key utelämnad) eller en enskild del av cachen. Skrivs något i
   kalkylarket töms också den delade cachen av de offentliga tiderna (se
   nedan), så att nästa besökare ser ändringen direkt. */
function forget_(key) {
  if (key) {
    delete JH_MEMO_[key];
    bumpRangeVersion_();
    return;
  }
  JH_MEMO_ = {};
}

/* ============================================================
   DELAD CACHE FÖR DE OFFENTLIGA TIDERNA
   Tvåveckorslistan är likadan för alla besökare, och sajten frågar efter den
   med jämna mellanrum. Svaret sparas därför i Googles cache i en halv minut,
   så att flera besökare (och sajtens egen automatiska uppdatering) delar på
   samma uträkning: svarstiden går från omkring en sekund till en bråkdel, och
   körtiden som varje anrop kostar minskar i motsvarande grad.
   En bokning eller en markering syns ändå direkt: varje skrivning höjer en
   versionsstämpel, och då gäller inte de äldre svaren längre.
   ============================================================ */

/* Hur länge ett svar får ligga i cachen. Det är säkert att ha en generös tid:
   varje skrivning i kalkylarket (bokning, godkännande, Jakobs markeringar)
   höjer versionsstämpeln direkt, och då gäller inte de äldre svaren längre.
   Tiden behövs bara för ändringar som görs direkt i kalkylarket, vilket sajten
   aldrig gör. */
var RANGE_CACHE_SECONDS = 300;
var RANGE_VERSION_KEY = 'jhfix_range_version';

/* Cachen kan vara otillgänglig (t.ex. i en enkel testmiljö). Då räknas allt
   som vanligt i stället – cachen är en genväg, aldrig en förutsättning. */
function rangeCache_() {
  try { return CacheService.getScriptCache(); } catch (err) { return null; }
}

function rangeVersion_() {
  var cache = rangeCache_();
  if (!cache) return '0';
  try { return cache.get(RANGE_VERSION_KEY) || '0'; } catch (err) { return '0'; }
}

function bumpRangeVersion_() {
  var cache = rangeCache_();
  if (!cache) return;
  try {
    /* Lång livstid: stämpeln är bara ett tal, och går den ut faller svaren
       tillbaka på version '0' – som mest en halv minut gamla. */
    cache.put(RANGE_VERSION_KEY, String(new Date().getTime()), 21600);
  } catch (err) { /* cachen är frivillig */ }
}

/* Svarar från cachen om svaret finns där, annars räknas det fram och sparas. */
function cachedJson_(key, seconds, build) {
  var cache = rangeCache_();
  var full = 'r' + rangeVersion_() + ':' + key;

  if (cache) {
    try {
      var hit = cache.get(full);
      if (hit) return JSON.parse(hit);
    } catch (err) { /* trasig post – räkna om i stället */ }
  }

  var data = build();

  if (cache) {
    try { cache.put(full, JSON.stringify(data), seconds); } catch (err) {}
  }

  return data;
}

/* Tvåveckorslistan (?from=…&dagar=…), cachad. */
function availabilityRangeCached_(fromIso, days) {
  var start = isRealDate_(fromIso) ? clean_(fromIso) : todayIso_();
  var count = parseInt(days, 10);
  if (!count || isNaN(count) || count < 1) count = 14;
  if (count > CONFIG.MAX_DAYS_PER_REQUEST) count = CONFIG.MAX_DAYS_PER_REQUEST;

  return cachedJson_('range:' + start + ':' + count, RANGE_CACHE_SECONDS, function () {
    return availabilityRange_(start, count);
  });
}

/* En enskild dag (?action=availability&datum=…), cachad på samma sätt.
   Dagens namn och bokningar (includeDetails) cachas aldrig – de hör till
   ägarpanelen och ska alltid vara färska. */
function dayAvailabilityCached_(datum, includeDetails) {
  if (includeDetails) return dayAvailability_(datum, true);

  return cachedJson_('day:' + clean_(datum), RANGE_CACHE_SECONDS, function () {
    return dayAvailability_(datum, false);
  });
}

/* ============================================================
   KALKYLARK (databasen)
   ============================================================ */

/* Öppnar kalkylarket som allt sparas i (skapar ett första gången). */
function dataSpreadsheet_() {
  if (JH_MEMO_.ss) return JH_MEMO_.ss;

  var props = PropertiesService.getScriptProperties();
  var ss = null;
  var id = props.getProperty('SPREADSHEET_ID');

  /* Om skriptet är kopplat till ett kalkylark används det, annars skapas ett. */
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; }
  }
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    ss = SpreadsheetApp.create('Jakobs HusFix – Bokningar');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }

  JH_MEMO_.ss = ss;
  return ss;
}

/* Hämtar en flik och ser till att rubrikraden finns.
   textColumns = nummer på de kolumner som ska läsas som text, så att
   kalkylarket inte tolkar om datum, tider och kontonamn. */
function getDataSheet_(name, headers, textColumns) {
  var key = 'sheet:' + name;
  if (JH_MEMO_[key]) return JH_MEMO_[key];

  var ss = dataSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    (textColumns || []).forEach(function (col) {
      sheet.getRange(1, col, sheet.getMaxRows(), 1).setNumberFormat('@');
    });
  }

  JH_MEMO_[key] = sheet;
  return sheet;
}

function getSheet_() {
  /* Skapad/Datum/Tid/Beslutad som text så att kalkylarket inte tolkar om dem. */
  return getDataSheet_(CONFIG.SHEET_NAME, HEADERS, [3, 12, 13, 16]);
}

function accountsSheet_() {
  return getDataSheet_(CONFIG.SHEET_ACCOUNTS, ACCOUNT_HEADERS, [1, 6, 7]);
}

function slotsSheet_() {
  return getDataSheet_(CONFIG.SHEET_SLOTS, SLOT_HEADERS, [1, 2]);
}

function sessionsSheet_() {
  return getDataSheet_(CONFIG.SHEET_SESSIONS, SESSION_HEADERS, [1, 5, 6]);
}

function getRows_() {
  if (JH_MEMO_.rows) return JH_MEMO_.rows;

  var sheet = getSheet_();
  var rows = [];
  var last = sheet.getLastRow();
  if (last < 2) { JH_MEMO_.rows = rows; return rows; }

  var tz = CONFIG.TZ;

  function asIso(value) {
    if (value instanceof Date) return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
    return clean_(value);
  }

  var values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    rows.push({
      row: i + 2,
      id: clean_(r[0]),
      token: clean_(r[1]),
      skapad: clean_(r[2]),
      status: clean_(r[3]),
      namn: clean_(r[4]),
      telefon: clean_(r[5]),
      epost: clean_(r[6]),
      antal: r[7],
      fastighet: clean_(r[8]),
      adress: clean_(r[9]),
      omrade: clean_(r[10]),
      datum: asIso(r[11]),
      tid: clean_(r[12]),
      pris: r[13],
      meddelande: clean_(r[14]),
      beslutad: clean_(r[15])
    });
  }

  JH_MEMO_.rows = rows;
  return rows;
}

/* Tider som en kund har en väntande eller bekräftad förfrågan på. */
/* Riktiga kundbokningar för ett datum. id:t följer med så att ägarpanelen kan
   godkänna eller neka en förfrågan direkt i listan – det är samma id som
   mejlets länkar använder. Namn och id lämnas bara ut till ett inloggat
   ägarkonto (se dayAvailability_ och action=dayinfo). */
function realBookings_(datum) {
  var wanted = clean_(datum);
  var out = [];
  getRows_().forEach(function (r) {
    if (r.datum !== wanted) return;
    if (r.status !== STATUS_WAITING && r.status !== STATUS_CONFIRMED) return;
    out.push({ id: r.id, tid: r.tid, namn: r.namn, status: r.status });
  });
  return out;
}

/* ------------------------------------------------------------
   JAKOBS EGNA MARKERINGAR (flikarna Tider och Sessioner)
   ------------------------------------------------------------ */

function readSlots_() {
  if (JH_MEMO_.slots) return JH_MEMO_.slots;

  var sheet = slotsSheet_();
  var rows = [];
  var last = sheet.getLastRow();
  if (last < 2) { JH_MEMO_.slots = rows; return rows; }

  var tz = CONFIG.TZ;
  var values = sheet.getRange(2, 1, last - 1, SLOT_HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var datum = (r[0] instanceof Date) ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : clean_(r[0]);
    rows.push({
      row: i + 2,
      datum: datum,
      tid: clean_(r[1]),
      status: clean_(r[2]),
      andradAv: clean_(r[3]),
      andrad: clean_(r[4])
    });
  }

  JH_MEMO_.slots = rows;
  return rows;
}

/* Jakobs markeringar för ett datum, som två uppslagslistor. */
function slotMarks_(datum) {
  var wanted = clean_(datum);
  var marks = { bokade: {}, lediga: {} };
  readSlots_().forEach(function (s) {
    if (s.datum !== wanted) return;
    if (s.status === SLOT_BUSY) marks.bokade[s.tid] = true;
    else if (s.status === SLOT_FREE) marks.lediga[s.tid] = true;
  });
  return marks;
}

/* Sparar (eller tar bort) en markering. status = '' tar bort raden. */
function setSlotMark_(datum, tid, status, userName) {
  var sheet = slotsSheet_();
  var rows = readSlots_();
  var found = null;

  for (var i = 0; i < rows.length; i++) {
    if (rows[i].datum === clean_(datum) && rows[i].tid === clean_(tid)) { found = rows[i]; break; }
  }

  if (!status) {
    if (found) {
      sheet.deleteRow(found.row);
      forget_('slots');   /* nästa läsning i samma anrop ska se ändringen */
    }
    return;
  }

  if (found) {
    sheet.getRange(found.row, 3).setValue(status);
    sheet.getRange(found.row, 4).setValue(clean_(userName));
    sheet.getRange(found.row, 5).setValue(nowStamp_());
    forget_('slots');
    return;
  }

  sheet.appendRow([clean_(datum), clean_(tid), status, clean_(userName), nowStamp_()]);
  forget_('slots');
}

/* Tar bort alla markeringar för en dag (dagen går tillbaka till ordinarie
   schema). Returnerar hur många markeringar som togs bort. */
function clearSlotMarks_(datum) {
  var rows = readSlots_();
  var sheet = slotsSheet_();
  var removed = 0;

  /* Bakifrån så att radnumren framför inte ändras. */
  for (var i = rows.length - 1; i >= 0; i--) {
    if (rows[i].datum !== clean_(datum)) continue;
    sheet.deleteRow(rows[i].row);
    removed++;
  }

  if (removed) forget_('slots');
  return removed;
}

/* ------------------------------------------------------------
   VILKA TIDER GÅR ATT BOKA?
   ------------------------------------------------------------ */

/* Tider som inte går att boka ett visst datum: riktiga kundbokningar plus
   Jakobs "Bokad"-markeringar, minus de av hans egna markeringar som han har
   satt till "Ledig". En riktig bokning väger alltid tyngst och kan bara
   frigöras genom att neka den i mejlet. */
function takenTimes_(datum) {
  var marks = slotMarks_(datum);
  var taken = [];

  realBookings_(datum).forEach(function (b) {
    if (taken.indexOf(b.tid) === -1) taken.push(b.tid);
  });

  keys_(marks.bokade).forEach(function (tid) {
    if (marks.lediga[tid]) return;
    if (taken.indexOf(tid) === -1) taken.push(tid);
  });

  return taken;
}

/* Finns kvar under sitt gamla namn (används av testskriptet). */
function bookedTimes_(datum) { return takenTimes_(datum); }

/* Hela timmar 07:00–21:00 som Jakob kan öppna utanför ordinarie tider.
   OPEN_HOUR_END är första timmen som inte får startas. */
function isOpenHour_(tid) {
  var m = /^([01]\d|2[0-3]):00$/.exec(clean_(tid));
  if (!m) return false;
  var hour = parseInt(m[1], 10);
  return hour >= OPEN_HOUR_START && hour < OPEN_HOUR_END;
}

function keys_(obj) {
  var out = [];
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out.push(k);
  return out;
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

function timeValue_(tid) {
  var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clean_(tid));
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 24 * 60;
}

function sortTimes_(times) {
  return times.slice().sort(function (a, b) { return timeValue_(a) - timeValue_(b); });
}

/* Dagens ordinarie bokningsbara tider – samma intervall som på sajten:
   mån–fre 15–20, lör–sön 10–18. Sista starttiden är en timme före stängning. */
function standardSlots_(datum) {
  var wd = weekday_(datum);
  if (wd < 0) return [];

  var weekend = (wd === 0 || wd === 6);
  var start = weekend ? 10 : 15;
  var end = weekend ? 18 : 20;

  var out = [];
  for (var h = start; h < end; h++) out.push(pad2_(h) + ':00');
  return out;
}

/* Extratider: hela timmar 07–21 utanför ordinarie tider som Jakob har öppnat
   och som ingen har bokat än. */
function extraFreeTimes_(datum) {
  var marks = slotMarks_(datum);
  var taken = takenTimes_(datum);
  var standard = standardSlots_(datum);
  var out = [];

  keys_(marks.lediga).forEach(function (tid) {
    if (!isOpenHour_(tid)) return;
    if (standard.indexOf(tid) !== -1) return;
    if (taken.indexOf(tid) !== -1) return;
    out.push(tid);
  });

  return sortTimes_(out);
}

/* Går tiden att boka alls? Ordinarie tid – eller en extratid Jakob öppnat. */
function isBookableSlot_(datum, tid) {
  if (isValidSlot_(datum, tid)) return true;
  var marks = slotMarks_(datum);
  return Boolean(marks.lediga[clean_(tid)]) && isOpenHour_(clean_(tid));
}

/* Hela dagsläget, exakt det sajten och ägarpanelen visar:
     slots = alla tider för dagen (ordinarie tider + öppnade extratider)
     taken = de av dem som är bokade eller blockerade
   Kundnamn (bookings) och Jakobs markeringar (marks) läggs bara på när
   includeDetails är true, alltså för en inloggad ägare – varje bokning får då
   också sitt id, så att ägarpanelen kan godkänna eller neka den. Gäster får
   aldrig veta vem som har bokat – bara att tiden är tagen. */
function dayAvailability_(datum, includeDetails) {
  var taken = takenTimes_(datum);
  var marks = slotMarks_(datum);
  var slots = standardSlots_(datum).slice();

  function add(tid) {
    if (!isOpenHour_(tid)) return;
    if (slots.indexOf(tid) === -1) slots.push(tid);
  }

  taken.forEach(add);
  keys_(marks.bokade).forEach(add);
  /* Extratiderna utanför ordinarie schema som Jakob har öppnat. */
  extraFreeTimes_(datum).forEach(add);

  var day = {
    datum: clean_(datum),
    slots: sortTimes_(slots),
    taken: sortTimes_(taken),
    updated: nowStamp_()
  };

  if (includeDetails) {
    var bookings = [];
    realBookings_(datum).forEach(function (b) {
      bookings.push({ id: b.id, tid: b.tid, namn: b.namn, status: b.status });
    });
    day.bookings = bookings;
    day.marks = {
      bokade: sortTimes_(keys_(marks.bokade)),
      lediga: sortTimes_(keys_(marks.lediga))
    };
  }

  return day;
}

/* Flera dagar i ett svar, så att sajten klarar sig med ett enda anrop. */
function availabilityRange_(fromIso, days) {
  var start = isRealDate_(fromIso) ? clean_(fromIso) : todayIso_();
  var count = parseInt(days, 10);
  if (!count || isNaN(count) || count < 1) count = 14;
  if (count > CONFIG.MAX_DAYS_PER_REQUEST) count = CONFIG.MAX_DAYS_PER_REQUEST;

  var parts = start.split('-');
  var base = Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  var out = {};

  for (var i = 0; i < count; i++) {
    var iso = Utilities.formatDate(new Date(base + i * 86400000), 'UTC', 'yyyy-MM-dd');
    out[iso] = dayAvailability_(iso, false);
  }

  return { ok: true, from: start, dagar: count, days: out };
}

function findBooking_(id) {
  var rows = getRows_();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === id) return rows[i];
  }
  return null;
}

/* En bokning för ett visst datum och en viss tid. onlyWaiting = true letar bara
   bland förfrågningar som väntar på svar. Finns flera på samma tid väljs den som
   matchar namnet, annars den första. Används när anropet saknar id – t.ex. ett
   svar som hämtades innan ägarpanelen fick id:n med sig, eller ett äldre svar som
   ligger kvar i webbläsaren. */
function findBookingOnSlot_(datum, tid, namn, onlyWaiting) {
  var rows = getRows_();
  var wantedDatum = clean_(datum);
  var wantedTid = clean_(tid);
  var wantedNamn = clean_(namn).toLowerCase();
  var forsta = null;

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (onlyWaiting && r.status !== STATUS_WAITING) continue;
    if (r.datum !== wantedDatum || r.tid !== wantedTid) continue;
    if (!forsta) forsta = r;
    if (wantedNamn && clean_(r.namn).toLowerCase() === wantedNamn) return r;
  }

  return forsta;
}

function updateDecision_(rowIndex, status) {
  var sheet = getSheet_();
  sheet.getRange(rowIndex, 4).setValue(status);
  sheet.getRange(rowIndex, 16).setValue(nowStamp_());
  forget_('rows');
}

/* ============================================================
   KONTON OCH INLOGGNING
   Konton skapas bara här i redigeraren (se skapaKonto längst ned) – sajten
   kan aldrig skapa ett konto åt sig själv. Lösenordet sparas aldrig i
   klartext: slumpad salt + 200 varv SHA-256.
   ============================================================ */

function readAccounts_() {
  if (JH_MEMO_.accounts) return JH_MEMO_.accounts;

  var sheet = accountsSheet_();
  var rows = [];
  var last = sheet.getLastRow();
  if (last < 2) { JH_MEMO_.accounts = rows; return rows; }

  var values = sheet.getRange(2, 1, last - 1, ACCOUNT_HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    rows.push({
      row: i + 2,
      anvandarnamn: clean_(r[0]),
      namn: clean_(r[1]),
      roll: clean_(r[2]),
      salt: clean_(r[3]),
      hash: clean_(r[4]),
      skapad: clean_(r[5]),
      senast: clean_(r[6])
    });
  }

  JH_MEMO_.accounts = rows;
  return rows;
}

function findAccount_(user) {
  var wanted = clean_(user).toLowerCase();
  if (!wanted) return null;
  var rows = readAccounts_();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].anvandarnamn.toLowerCase() === wanted) return rows[i];
  }
  return null;
}

function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function passwordHash_(password, salt) {
  var value = clean_(salt) + ':' + String(password == null ? '' : password);
  for (var i = 0; i < 200; i++) {
    value = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value + ':' + salt));
  }
  return value;
}

function randomToken_() { return Utilities.getUuid().replace(/-/g, ''); }

/* Skapar ett nytt konto eller uppdaterar ett befintligt. */
function saveAccount_(user, password, name, role) {
  var anvandarnamn = clean_(user);
  if (anvandarnamn.length < 3) return fail_('Användarnamnet måste vara minst 3 tecken.');
  if (!/^[A-Za-z0-9._-]+$/.test(anvandarnamn)) {
    return fail_('Användarnamnet får bara innehålla bokstäver, siffror, punkt, bindestreck och understreck.');
  }
  if (String(password == null ? '' : password).length < 8) {
    return fail_('Lösenordet måste vara minst 8 tecken.');
  }

  var roll = (clean_(role) === ROLE_OWNER) ? ROLE_OWNER : ROLE_STAFF;
  var sheet = accountsSheet_();
  var found = findAccount_(anvandarnamn);
  var salt = randomToken_().slice(0, 12);
  var hash = passwordHash_(password, salt);

  if (found) {
    sheet.getRange(found.row, 2).setValue(clean_(name) || found.namn);
    sheet.getRange(found.row, 3).setValue(roll);
    sheet.getRange(found.row, 4).setValue(salt);
    sheet.getRange(found.row, 5).setValue(hash);
    forget_('accounts');
    return { ok: true, message: 'Kontot ' + anvandarnamn + ' (' + roll + ') är uppdaterat.' };
  }

  sheet.appendRow([anvandarnamn, clean_(name) || anvandarnamn, roll, salt, hash, nowStamp_(), '']);
  forget_('accounts');
  return { ok: true, message: 'Kontot ' + anvandarnamn + ' (' + roll + ') är skapat.' };
}

/* Loggar in och ger en sessionstoken. Felmeddelandet är medvetet oprecist så
   att det inte går att lista ut vilka användarnamn som finns. */
function login_(user, password) {
  var account = findAccount_(user);
  /* Även när kontot inte finns räknas hashen fram, så att svaret tar ungefär
     lika lång tid och inte avslöjar om användarnamnet finns. */
  var hash = passwordHash_(password, account ? account.salt : 'saknas');

  if (!account || account.hash !== hash) {
    return fail_('Fel användarnamn eller lösenord. Försök igen.');
  }

  try { accountsSheet_().getRange(account.row, 7).setValue(nowStamp_()); forget_('accounts'); } catch (err) { /* inte kritiskt */ }

  var session = createSession_(account);
  return {
    ok: true,
    token: session.token,
    arAgare: account.roll === ROLE_OWNER,
    user: { anvandarnamn: account.anvandarnamn, namn: account.namn, roll: account.roll },
    message: 'Välkommen ' + (firstName_(account.namn) || account.anvandarnamn) + '!'
  };
}

/* ============================================================
   SESSIONER (inloggningar som håller i sig)
   ============================================================ */

function sessionExpiry_() {
  var d = new Date();
  d.setTime(d.getTime() + CONFIG.SESSION_HOURS * 3600000);
  return Utilities.formatDate(d, CONFIG.TZ, 'yyyy-MM-dd HH:mm');
}

/* Tar bort inloggningar som har gått ut. */
function cleanupSessions_() {
  var sheet = sessionsSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return;

  var now = nowStamp_();
  var values = sheet.getRange(2, 1, last - 1, SESSION_HEADERS.length).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (clean_(values[i][5]) < now) sheet.deleteRow(i + 2);
  }
}

function createSession_(account) {
  cleanupSessions_();
  var token = randomToken_();
  var expires = sessionExpiry_();
  sessionsSheet_().appendRow([token, account.anvandarnamn, account.namn, account.roll, nowStamp_(), expires]);
  return { token: token, expires: expires };
}

/* Vem tillhör token? null om den saknas, är fel eller har gått ut. */
function accountFromToken_(token) {
  var wanted = clean_(token);
  if (!wanted) return null;

  var sheet = sessionsSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return null;

  var now = nowStamp_();
  var values = sheet.getRange(2, 1, last - 1, SESSION_HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    if (clean_(values[i][0]) !== wanted) continue;
    if (clean_(values[i][5]) < now) return null;
    return {
      anvandarnamn: clean_(values[i][1]),
      namn: clean_(values[i][2]),
      roll: clean_(values[i][3])
    };
  }
  return null;
}

function endSession_(token) {
  var wanted = clean_(token);
  if (!wanted) return;

  var sheet = sessionsSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return;

  var values = sheet.getRange(2, 1, last - 1, SESSION_HEADERS.length).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (clean_(values[i][0]) === wanted) sheet.deleteRow(i + 2);
  }
}

/* ============================================================
   WEBBAPPENS ÄNDPUNKTER
   ============================================================ */

function doGet(e) {
  /* Nytt anrop: cachen från förra gången gäller inte längre (se JH_MEMO_). */
  forget_();

  var p = (e && e.parameter) ? e.parameter : {};
  var action = clean_(p.action);

  if (action === 'availability') {
    var datum = clean_(p.datum);

    /* En enskild dag – samma svar som förr, plus dagens alla tider så att
       sajten kan visa hela listan med lediga och bokade tider. Svaret hämtas
       från den delade cachen (se cachedJson_). */
    if (datum) {
      var day = dayAvailabilityCached_(datum, false);
      return jsonp_(clean_(p.callback), {
        ok: true,
        datum: datum,
        slots: day.slots,
        taken: day.taken,
        updated: day.updated
      });
    }

    /* Annars en hel period i ett enda svar (?from=2026-09-28&dagar=14). */
    return jsonp_(clean_(p.callback), availabilityRangeCached_(clean_(p.from), clean_(p.dagar)));
  }

  /* Vem är inloggad? Sajten frågar när den laddas om och när en flik öppnas. */
  if (action === 'me') {
    var who = accountFromToken_(clean_(p.token));
    if (!who) return jsonp_(clean_(p.callback), { ok: false, message: 'Inte inloggad.' });
    return jsonp_(clean_(p.callback), {
      ok: true,
      arAgare: who.roll === ROLE_OWNER,
      user: who
    });
  }

  /* Ägarens dagbild: dagens tider, Jakobs egna markeringar och kundbokningarna
     med namn. Bara ett inloggat ägarkonto får svaret – gäster och personal
     får den vanliga listan utan namn (se action=availability ovan). */
  if (action === 'dayinfo') {
    var dayAccess = ownerFromRequest_(p);
    if (dayAccess.error) return jsonp_(clean_(p.callback), dayAccess.error);

    var infoDatum = clean_(p.datum);
    if (!isRealDate_(infoDatum)) return jsonp_(clean_(p.callback), fail_('Ogiltigt datum.'));

    var ownerDay = dayAvailability_(infoDatum, true);
    return jsonp_(clean_(p.callback), {
      ok: true,
      arAgare: true,
      user: dayAccess.account,
      datum: infoDatum,
      ordinarie: standardSlots_(infoDatum),
      slots: ownerDay.slots,
      taken: ownerDay.taken,
      bookings: ownerDay.bookings,
      marks: ownerDay.marks,
      updated: ownerDay.updated
    });
  }

  /* Mejlets länkar: confirm/decline – och de svenska varianterna godkann/neka.
     Ett e-postprogram kan skriva om en adress en aning, så åtgärden jämförs utan
     hänsyn till stora och små bokstäver och token får komma i antingen token
     eller det kortare t. Själva beslutet tas först efter ett extra klick
     (confirm=1 eller klart=1), så att en förhandsgranskning av mejlet inte kan
     godkänna eller neka något av misstag. */
  var beslut = action.toLowerCase();
  if (beslut === 'godkann' || beslut === 'godk\u00e4nn') beslut = 'confirm';
  if (beslut === 'neka') beslut = 'decline';
  if (beslut === 'confirm' || beslut === 'decline') {
    return htmlOut_(pageHtml_(decide_(beslut,
      clean_(p.id),
      clean_(p.token) || clean_(p.t),
      clean_(p.confirm) === '1' || clean_(p.klart) === '1')));
  }

  return htmlOut_(pageHtml_({
    title: 'Bokningssystem',
    body: '<p style="color:#33454f;font-size:15px;line-height:1.7;margin:0;">' +
      'Bokningssystemet är aktivt och allt fungerar som det ska. Kontona och ' +
      'ägarpanelen på sajten använder samma adress.</p>'
  }));
}

function doPost(e) {
  /* Nytt anrop: cachen från förra gången gäller inte längre (se JH_MEMO_). */
  forget_();

  var p = (e && e.parameter) ? e.parameter : {};
  var action = clean_(p.action);

  /* En äldre version av sajten skickade formulärfälten utan action-parameter
     och fick "Okänd åtgärd." tillbaka. Känns en bokningsförfrågan igen på
     innehållet behandlas den som en bokning, så att ingen förfrågan tappas. */
  if (!action && (clean_(p.namn) || clean_(p.telefon) || clean_(p.epost))) {
    action = 'book';
  }

  var result;

  if (action === 'book') {
    result = handleBooking_(p);
  } else if (action === 'login') {
    result = login_(clean_(p.anvandare), p.losenord == null ? '' : String(p.losenord));
  } else if (action === 'logout') {
    endSession_(clean_(p.token));
    result = { ok: true, message: 'Du är utloggad.' };
  } else if (action === 'slot') {
    result = setSlot_(p);
  } else if (action === 'day') {
    result = setDay_(p);
  } else if (action === 'decision') {
    /* Ägarpanelens godkänn/neka – samma beslut som mejlets länkar, men svaret
       går tillbaka till panelen i stället för till en webbsida. */
    result = decideFromPanel_(p);
  } else {
    /* system: true betyder "anropet förstods inte alls" – till skillnad från
       "tiden går inte att boka". Sajten tar då kunden till e-postprogrammet i
       stället för att visa en teknisk text. */
    result = { ok: false, system: true, message: 'Okänd åtgärd.' };
  }

  result.jhfix = true;
  /* req/typ gör att sajten kan para ihop svaret med rätt anrop. */
  result.req = clean_(p.req);
  result.type = action || 'book';
  return htmlOut_(sinkHtml_(result));
}

/* Svar till sajtens JSONP-anrop (hämtar upptagna tider). */
function jsonp_(callback, data) {
  var body = JSON.stringify(data);
  var cb = /^[A-Za-z0-9_$.]+$/.test(clean_(callback)) ? clean_(callback) : '';
  if (!cb) {
    return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(cb + '(' + body + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/* Minimal sida som skickar resultatet tillbaka till den dolda iframen på sajten. */
function sinkHtml_(result) {
  var json = JSON.stringify(result)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return '<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Klar</title></head><body>' +
    '<script>try{if(window.parent){window.parent.postMessage(' + json + ',"*");}}catch(e){}</script>' +
    '</body></html>';
}

/* ============================================================
   ÄGARENS MARKERINGAR (kräver inloggat ägarkonto)
   ============================================================ */

/* Släpper bara igenom ett giltigt ägarkonto. Personal (och gäster) får titta
   men inte ändra tider. */
function ownerFromRequest_(p) {
  var account = accountFromToken_(clean_(p.token));
  if (!account) {
    return { error: fail_('Din inloggning har gått ut. Logga in igen för att ändra tider.') };
  }
  if (account.roll !== ROLE_OWNER) {
    return { error: fail_('Ditt konto får inte ändra tider – bara ägarkontot kan markera lediga och bokade tider.') };
  }
  return { account: account };
}

/* Är tiden upptagen av en riktig kundbokning? En sådan markering får aldrig
   skrivas över härifrån. */
function slotLock_(datum, tid) {
  var bookings = realBookings_(datum);
  var wanted = clean_(tid);
  for (var i = 0; i < bookings.length; i++) {
    if (bookings[i].tid === wanted) return bookings[i];
  }
  return null;
}

/* Markerar en enskild tid som Bokad eller Ledig. */
function setSlot_(p) {
  var access = ownerFromRequest_(p);
  if (access.error) return access.error;
  var account = access.account;

  var datum = clean_(p.datum);
  var tid = clean_(p.tid);
  var status = clean_(p.status);

  if (!isRealDate_(datum)) return fail_('Ogiltigt datum.');
  if (!isOpenHour_(tid)) {
    return fail_('Tiden måste vara en hel timme mellan ' + pad2_(OPEN_HOUR_START) + ':00 och ' + pad2_(OPEN_HOUR_END) + ':00.');
  }
  if (status !== SLOT_BUSY && status !== SLOT_FREE && status !== SLOT_AUTO) {
    return fail_('Status måste vara Bokad, Ledig eller Auto (tillbaka till ordinarie schema).');
  }

  var locked = slotLock_(datum, tid);
  if (locked) {
    if (status === SLOT_FREE) {
      return fail_('Tiden ' + tid + ' är bokad av en kund (' + locked.namn + ') och kan bara bli ledig igen genom att du nekar förfrågan – i listan över kundbokningar i ägarpanelen eller i mejlet.');
    }
    return fail_('Tiden ' + tid + ' är redan upptagen av en kundbokning (' + locked.namn + ').');
  }

  /* Låset hindrar två samtidiga klick från att skriva över varandra. */
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { /* fortsätter ändå */ }
  try {
    /* SLOT_AUTO skickar en tom status till setSlotMark_, som då tar bort raden. */
    setSlotMark_(datum, tid, status === SLOT_AUTO ? '' : status, account.namn);
  } finally {
    lock.releaseLock();
  }

  return {
    ok: true,
    datum: datum,
    tid: tid,
    status: status,
    day: dayAvailability_(datum, true),
    message: status === SLOT_BUSY
      ? 'Tiden ' + tid + ' är markerad som bokad – alla besökare ser det direkt.'
      : (status === SLOT_FREE
        ? 'Tiden ' + tid + ' är markerad som ledig och går att boka.'
        : 'Tiden ' + tid + ' följer ordinarie schema igen.')
  };
}

/* Markerar hela dagen: antingen alla ordinarie tider som bokade, eller
   återställer dagen till ordinarie schema. */
function setDay_(p) {
  var access = ownerFromRequest_(p);
  if (access.error) return access.error;
  var account = access.account;

  var datum = clean_(p.datum);
  var status = clean_(p.status);

  if (!isRealDate_(datum)) return fail_('Ogiltigt datum.');
  if (status !== SLOT_BUSY && status !== SLOT_FREE) return fail_('Status måste vara Bokad eller Ledig.');

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { /* fortsätter ändå */ }

  var message;
  try {
    if (status === SLOT_BUSY) {
      var slots = standardSlots_(datum);
      var marked = 0;
      var skipped = 0;

      for (var i = 0; i < slots.length; i++) {
        if (slotLock_(datum, slots[i])) { skipped++; continue; }
        setSlotMark_(datum, slots[i], SLOT_BUSY, account.namn);
        marked++;
      }

      message = marked + ' tider markerade som bokade.';
      if (skipped) {
        message += ' ' + skipped + ' tid' + (skipped === 1 ? '' : 'er') +
          ' var bokad av en kund och lämnades orörd.';
      }
    } else {
      var removed = clearSlotMarks_(datum);
      message = removed
        ? 'Dagen är återställd till ordinarie schema (' + removed + ' egna markeringar borttagna).'
        : 'Dagen hade inga egna markeringar – den följer redan ordinarie schema.';
    }
  } finally {
    lock.releaseLock();
  }

  return {
    ok: true,
    datum: datum,
    status: status,
    day: dayAvailability_(datum, true),
    message: message
  };
}

/* ============================================================
   NY BOKNING
   ============================================================ */

/* Har samma förfrågan redan kommit in? Sajten gör ett nytt försök när svaret
   uteblir (en webbapp som precis har startat kan ta en halv minut på sig), och
   då ska förfrågan kvitteras i stället för att bli en dubblett. Namn, telefon
   och e-post måste stämma – det är samma person med samma uppgifter. En annan
   kund på samma tid får i stället beskedet att tiden är upptagen
   (se alreadyTaken_). */
function sameRequest_(b) {
  var phone = digits_(b.telefon);
  var epost = clean_(b.epost).toLowerCase();
  var namn = clean_(b.namn).toLowerCase().replace(/\s+/g, ' ');
  if (!phone || !epost || !namn) return null;

  var rows = getRows_();
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row.datum !== b.datum || row.tid !== b.tid) continue;
    if (row.status !== STATUS_WAITING && row.status !== STATUS_CONFIRMED) continue;
    if (digits_(row.telefon) !== phone) continue;
    if (clean_(row.epost).toLowerCase() !== epost) continue;
    if (clean_(row.namn).toLowerCase().replace(/\s+/g, ' ') !== namn) continue;
    return row;
  }

  return null;
}

function handleBooking_(p) {
  var b = {
    namn: clean_(p.namn),
    telefon: clean_(p.telefon),
    epost: clean_(p.epost),
    antal: parseInt(clean_(p.antalFonster), 10),
    fastighet: clean_(p.fastighet) || 'Villa',
    adress: clean_(p.adress),
    omrade: clean_(p.omrade),
    datum: clean_(p.datum),
    tid: clean_(p.tid),
    meddelande: clean_(p.meddelande)
  };

  if (b.namn.length < 2) return fail_('Ange ditt namn.');
  if (digits_(b.telefon).length < 7) return fail_('Ange ett giltigt telefonnummer.');
  if (!isEmail_(b.epost)) return fail_('Ange en giltig e-postadress.');
  if (!b.antal || isNaN(b.antal) || b.antal < 1 || b.antal > 200) {
    return fail_('Ange antal fönster (1–200).');
  }
  if (!b.omrade) return fail_('Fyll i var du bor.');
  if (!isRealDate_(b.datum)) return fail_('Välj ett datum.');
  if (b.datum < todayIso_()) return fail_('Datumet har redan passerat.');
  if (!isBookableSlot_(b.datum, b.tid)) {
    return fail_('Välj en tid inom våra öppettider – eller en extratid som Jakob har öppnat.');
  }
  if (isTooLateToBook_(b.datum, b.tid)) {
    return fail_('Den tiden har redan passerat. Välj en tid som ligger minst ' +
      CONFIG.BOOKING_LEAD_MINUTES + ' minuter framåt i tiden.');
  }

  /* Samma förfrågan en gång till? (Sajten gör ett nytt försök när svaret
     uteblev.) Då kvitteras den i stället för att skapa en dubblett. */
  var duplicate = sameRequest_(b);
  if (duplicate) {
    return {
      ok: true,
      id: duplicate.id,
      datum: b.datum,
      tid: b.tid,
      message: 'Din bokningsförfrågan om ' + b.datum + ' kl ' + b.tid +
        ' är redan mottagen. Vi mejlar dig så snart tiden är bekräftad.'
    };
  }

  if (takenTimes_(b.datum).indexOf(b.tid) !== -1) return alreadyTaken_(b);

  /* Lås så att två samtidiga förfrågningar inte kan ta samma tid. */
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { /* fortsätter ändå */ }

  try {
    /* Färsk läsning efter låset: en annan förfrågan kan ha hunnit boka samma
       tid medan vi väntade (cachen JH_MEMO_ töms därför här). */
    forget_('rows');

    if (takenTimes_(b.datum).indexOf(b.tid) !== -1) return alreadyTaken_(b);

    var id = Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
    var token = Utilities.getUuid().replace(/-/g, '');

    getSheet_().appendRow([
      id, token, nowStamp_(), STATUS_WAITING,
      b.namn, b.telefon, b.epost, b.antal, b.fastighet, b.adress, b.omrade,
      b.datum, b.tid, b.antal * CONFIG.PRICE_PER_WINDOW, b.meddelande, ''
    ]);
    forget_('rows');

    try { sendOwnerEmail_(b, id, token); } catch (err) { /* mejlet kunde inte skickas */ }

    return {
      ok: true,
      id: id,
      datum: b.datum,
      tid: b.tid,
      message: 'Tack ' + firstName_(b.namn) + '! Din bokningsförfrågan är skickad. ' +
        'Priset från ' + (b.antal * CONFIG.PRICE_PER_WINDOW) + ' kr är ett startpris (70 kr per ' +
        'fönster) som kan variera. Det slutliga priset ges på plats vid huset efter att vi bedömt ' +
        'fönstren. Vi mejlar dig så snart tiden ' + b.datum + ' kl ' + b.tid + ' är bekräftad.'
    };
  } finally {
    lock.releaseLock();
  }
}

function fail_(message) { return { ok: false, message: message }; }

function alreadyTaken_(b) {
  return fail_('Tiden ' + b.tid + ' den ' + b.datum + ' är tyvärr redan bokad. Välj en annan tid.');
}

/* ============================================================
   MEJL TILL JAKOB (med godkänn/neka-knappar)
   ============================================================ */

function sendOwnerEmail_(b, id, token) {
  var base = getWebAppUrl_();
  var confirmUrl = base + '?action=confirm&id=' + encodeURIComponent(id) +
    '&token=' + encodeURIComponent(token);
  var declineUrl = base + '?action=decline&id=' + encodeURIComponent(id) +
    '&token=' + encodeURIComponent(token);

  MailApp.sendEmail({
    to: CONFIG.OWNER_EMAIL,
    subject: 'Ny bokningsförfrågan: ' + b.datum + ' kl ' + b.tid + ' – ' + b.namn,
    htmlBody: ownerEmailHtml_(b, confirmUrl, declineUrl),
    replyTo: b.epost,
    name: CONFIG.COMPANY
  });
}

function ownerEmailHtml_(b, confirmUrl, declineUrl) {
  var rows = [
    ['Namn', b.namn],
    ['Telefon', b.telefon],
    ['E-post', b.epost],
    ['Antal fönster', String(b.antal)],
    ['Fastighet', b.fastighet],
    ['Adress', b.adress || '–'],
    ['Område', b.omrade],
    ['Datum', b.datum],
    ['Tid', b.tid],
    ['Pris (startpris, 70 kr/fönster)', (b.antal * CONFIG.PRICE_PER_WINDOW) + ' kr'],
    ['Meddelande', b.meddelande || '–']
  ];

  var rowsHtml = '';
  rows.forEach(function (r) {
    rowsHtml += '<tr>' +
      '<td style="padding:6px 14px 6px 0;color:#5b6b75;font-size:14px;vertical-align:top;white-space:nowrap;">' +
        escapeHtml_(r[0]) + '</td>' +
      '<td style="padding:6px 0;color:#0e2a3a;font-size:14px;font-weight:600;">' +
        escapeHtml_(r[1]) + '</td>' +
      '</tr>';
  });

  return '' +
    '<div style="font-family:Arial,Helvetica,sans-serif;background:#f3f6f8;padding:24px;">' +
      '<div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e2e8ec;border-radius:14px;overflow:hidden;">' +
        '<div style="background:#0e2a3a;padding:20px 24px;">' +
          '<h1 style="margin:0;color:#ffffff;font-size:20px;">Ny bokningsförfrågan</h1>' +
          '<p style="margin:6px 0 0;color:#a9c3d1;font-size:14px;">' + escapeHtml_(CONFIG.COMPANY) + '</p>' +
        '</div>' +
        '<div style="padding:22px 24px;">' +
          '<p style="margin:0 0 14px;color:#33454f;font-size:15px;line-height:1.6;">Hej ' +
            escapeHtml_(CONFIG.OWNER_NAME) + '! En ny förfrågan har kommit in. ' +
            'Tiden är tillfälligt reserverad tills du svarar.</p>' +
          '<table style="border-collapse:collapse;width:100%;">' + rowsHtml + '</table>' +
          '<div style="margin:24px 0 6px;">' +
            '<a href="' + confirmUrl + '" style="display:inline-block;background:#1f8a4c;color:#ffffff;' +
              'text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:9px;margin:0 8px 10px 0;">' +
              'Godkänn bokningen</a>' +
            '<a href="' + declineUrl + '" style="display:inline-block;background:#c0362c;color:#ffffff;' +
              'text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:9px;margin:0 0 10px;">' +
              'Neka förfrågan</a>' +
          '</div>' +
          '<p style="margin:18px 0 0;color:#33454f;font-size:13px;line-height:1.7;">' +
            'Du kan också svara i ägarpanelen på sajten: logga in under fliken Konto och ' +
            'öppna fliken Ägare – där ligger förfrågan med knapparna Godkänn och Neka.</p>' +
          '<p style="margin:14px 0 0;color:#7b8b94;font-size:12px;line-height:1.7;">' +
            'Fungerar inte knapparna? Kopiera länkarna:<br />' +
            'Godkänn: ' + confirmUrl + '<br />Neka: ' + declineUrl + '</p>' +
        '</div>' +
      '</div>' +
    '</div>';
}

/* ============================================================
   MEJL TILL KUNDEN
   ============================================================ */

function sendCustomerEmail_(booking, isConfirm) {
  var name = escapeHtml_(firstName_(booking.namn));
  var when = escapeHtml_(booking.datum) + ' kl ' + escapeHtml_(booking.tid);
  var inner;

  if (isConfirm) {
    inner =
      '<p style="margin:0 0 12px;color:#33454f;font-size:15px;line-height:1.7;">Hej ' + name + '!</p>' +
      '<p style="margin:0 0 12px;color:#33454f;font-size:15px;line-height:1.7;">Din bokning är nu ' +
        '<strong>bekräftad</strong>: ' + when + '.</p>' +
      '<p style="margin:0 0 12px;color:#33454f;font-size:15px;line-height:1.7;">Vi kommer i tid och ' +
        'bedömer fönstren på plats vid huset. Startpriset är 70 kr per fönster, men det kan variera – ' +
        'det slutliga priset beror på fönstrens storlek och skick och lämnas innan vi börjar. Har du ' +
        'frågor är det bara att svara på det här mejlet eller ringa oss.</p>';
  } else {
    inner =
      '<p style="margin:0 0 12px;color:#33454f;font-size:15px;line-height:1.7;">Hej ' + name + '!</p>' +
      '<p style="margin:0 0 12px;color:#33454f;font-size:15px;line-height:1.7;">Tack för din ' +
        'bokningsförfrågan (' + when + '). Tyvärr kan vi inte ta den tiden.</p>' +
      '<p style="margin:0 0 12px;color:#33454f;font-size:15px;line-height:1.7;">Du är varmt välkommen ' +
        'att boka en annan tid på vår sajt, eller svara på det här mejlet så hittar vi en tid som passar.</p>';
  }

  MailApp.sendEmail({
    to: booking.epost,
    subject: isConfirm
      ? 'Din bokning hos ' + CONFIG.COMPANY + ' är bekräftad – ' + booking.datum + ' kl ' + booking.tid
      : 'Angående din bokningsförfrågan hos ' + CONFIG.COMPANY,
    htmlBody: wrapEmail_(isConfirm ? 'Bokning bekräftad' : 'Bokningsförfrågan', inner),
    name: CONFIG.COMPANY
  });
}

function wrapEmail_(title, inner) {
  return '' +
    '<div style="font-family:Arial,Helvetica,sans-serif;background:#f3f6f8;padding:24px;">' +
      '<div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e2e8ec;border-radius:14px;overflow:hidden;">' +
        '<div style="background:#0e2a3a;padding:20px 24px;">' +
          '<h1 style="margin:0;color:#ffffff;font-size:20px;">' + escapeHtml_(title) + '</h1>' +
          '<p style="margin:6px 0 0;color:#a9c3d1;font-size:14px;">' + escapeHtml_(CONFIG.COMPANY) + '</p>' +
        '</div>' +
        '<div style="padding:22px 24px;">' + inner +
          '<p style="margin:20px 0 0;color:#7b8b94;font-size:12px;line-height:1.7;">' +
            escapeHtml_(CONFIG.COMPANY) + ' · ' + escapeHtml_(CONFIG.OWNER_EMAIL) + '</p>' +
        '</div>' +
      '</div>' +
    '</div>';
}

/* ============================================================
   GODKÄNN / NEKA (länkarna i mejlet)
   ============================================================ */

function decide_(action, id, token, doIt) {
  var isConfirm = (action === 'confirm');
  var booking = findBooking_(id);

  if (!booking || booking.token !== token) {
    return {
      reason: 'bad-link', /* läses av ägarpanelens action=decision */
      title: 'Ogiltig länk',
      body: '<p style="color:#33454f;font-size:15px;line-height:1.7;margin:0;">Länken är ogiltig. ' +
        'Den kan ha skrivits av fel eller så har bokningen tagits bort.</p>'
    };
  }

  /* Sidan visas först med en knapp, så att e-postprogram som förhandsgranskar
     länkar inte råkar godkänna eller neka av misstag. */
  if (!doIt) {
    var color = isConfirm ? '#1f8a4c' : '#c0362c';
    var label = isConfirm ? 'Godkänn bokningen' : 'Neka förfrågan';
    var link = getWebAppUrl_() + '?action=' + action +
      '&id=' + encodeURIComponent(id) + '&token=' + encodeURIComponent(token) + '&confirm=1';
    return {
      title: isConfirm ? 'Godkänn bokning' : 'Neka bokning',
      body: summaryHtml_(booking) +
        '<p style="color:#33454f;font-size:15px;line-height:1.7;margin:18px 0 12px;">' +
          'Är du säker? Klicka på knappen nedan för att slutföra.</p>' +
        '<a href="' + link + '" style="display:inline-block;background:' + color +
          ';color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 24px;border-radius:9px;">' +
          label + '</a>'
    };
  }

  if (booking.status !== STATUS_WAITING) {
    return {
      reason: 'handled',
      title: 'Redan hanterad',
      body: summaryHtml_(booking) +
        '<p style="color:#33454f;font-size:15px;line-height:1.7;margin:18px 0 0;">Den här förfrågan ' +
          'är redan ' + (booking.status === STATUS_CONFIRMED ? 'godkänd' : 'nekad') + '.</p>'
    };
  }

  if (isConfirm && hasConflict_(booking)) {
    return {
      reason: 'conflict',
      title: 'Tiden är upptagen',
      body: summaryHtml_(booking) +
        '<p style="color:#c0362c;font-size:15px;line-height:1.7;margin:18px 0 0;">Tiden ' +
          escapeHtml_(booking.datum) + ' kl ' + escapeHtml_(booking.tid) +
          ' är redan bekräftad för en annan bokning. Bokningen kunde därför inte godkännas.</p>'
    };
  }

  updateDecision_(booking.row, isConfirm ? STATUS_CONFIRMED : STATUS_DECLINED);

  var emailOk = true;
  try { sendCustomerEmail_(booking, isConfirm); } catch (err) { emailOk = false; }

  return {
    /* Fälten nedan används av ägarpanelen (action=decision); webbsidan läser
       bara title och body. */
    ok: true,
    id: booking.id,
    datum: booking.datum,
    tid: booking.tid,
    namn: booking.namn,
    status: isConfirm ? STATUS_CONFIRMED : STATUS_DECLINED,
    emailOk: emailOk,
    title: isConfirm ? 'Bokningen är godkänd' : 'Förfrågan är nekad',
    body: summaryHtml_(booking) +
      '<p style="color:#33454f;font-size:15px;line-height:1.7;margin:18px 0 0;">' +
        (isConfirm
          ? 'Klart! Tiden är nu bokad och kan inte bokas av någon annan. Kunden har fått ett bekräftelsemejl.'
          : 'Klart! Tiden är nu ledig igen och kan bokas av någon annan. Kunden har fått ett mejl.') +
        (emailOk ? '' : ' <strong>Obs:</strong> mejlet till kunden kunde inte skickas automatiskt.') +
      '</p>'
  };
}

/* ============================================================
   GODKÄNN OCH NEKA FRÅN ÄGARPANELEN
   Samma beslut som mejlets knappar (decide_ ovan), men anropet kommer från
   sajten (action=decision&id=…&svar=ja|nej) och svaret innehåller hela dagens
   nya läge, så att panelen kan ritas om direkt. Bara ett inloggat ägarkonto
   kommer igenom (ownerFromRequest_).

   Bokningen pekas ut med sitt id när det finns. Saknas id:t – vilket kan hända
   om dagens bokningar hämtades innan panelen fick id:n med sig – hittas
   förfrågan i stället på datum och tid (och namn om flera väntar på samma tid),
   så att ett godkännande i panelen alltid går igenom.
   ============================================================ */
function decideFromPanel_(p) {
  var access = ownerFromRequest_(p);
  if (access.error) return access.error;

  var id = clean_(p.id);
  var pekadDatum = clean_(p.datum);
  var pekadTid = clean_(p.tid);
  var svar = clean_(p.svar).toLowerCase();
  if (svar === 'godkann' || svar === 'godk\u00e4nn' || svar === 'confirm') svar = 'ja';
  if (svar === 'neka' || svar === 'decline') svar = 'nej';
  if (svar !== 'ja' && svar !== 'nej') {
    return fail_('Svaret måste vara ja (godkänn) eller nej (neka).');
  }
  if (!id && !(pekadDatum && pekadTid)) {
    return fail_('Bokningen saknas i anropet. Uppdatera dagen och försök igen.');
  }

  var booking = id ? findBooking_(id) : null;
  if (!booking && !id) {
    booking = findBookingOnSlot_(pekadDatum, pekadTid, clean_(p.namn), true);

    if (!booking) {
      /* Ingen väntar på tiden: har den ändå en bokning har den redan fått sitt
         svar, och då sägs det rakt ut i stället för att tiden "saknas". */
      var besvarad = findBookingOnSlot_(pekadDatum, pekadTid, clean_(p.namn), false);
      if (besvarad) {
        return fail_('Förfrågan är redan ' +
          (besvarad.status === STATUS_CONFIRMED ? 'godkänd' : 'nekad') + '.');
      }
    }
  }
  if (!booking) return fail_('Bokningen finns inte kvar. Uppdatera dagen och försök igen.');

  id = booking.id;
  var datum = booking.datum;
  var tid = booking.tid;
  var isConfirm = (svar === 'ja');

  /* Låset hindrar att två klick – eller ett klick och mejlets knapp – hinner
     emellan och godkänner två förfrågningar på samma tid. */
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { /* fortsätter ändå */ }

  var beslut;
  try {
    /* Färsk läsning efter låset: någon kan ha hunnit svara medan vi väntade. */
    forget_('rows');
    beslut = decide_(isConfirm ? 'confirm' : 'decline', id, booking.token, true);
  } finally {
    lock.releaseLock();
  }

  if (!beslut.ok) {
    if (beslut.reason === 'handled') {
      var senast = findBooking_(id);
      return fail_('Förfrågan är redan ' + (senast && senast.status === STATUS_CONFIRMED ? 'godkänd' : 'nekad') + '.');
    }
    if (beslut.reason === 'conflict') {
      return fail_('Tiden ' + datum + ' kl ' + tid + ' är redan bekräftad för en annan bokning, så den här kunde inte godkännas.');
    }
    if (beslut.reason === 'bad-link') {
      return fail_('Bokningen hann ändras. Uppdatera dagen och försök igen.');
    }
    return fail_('Kunde inte spara svaret. Uppdatera dagen och försök igen.');
  }

  return {
    ok: true,
    datum: datum,
    tid: tid,
    namn: beslut.namn,
    status: beslut.status,
    /* Hela dagens nya läge: tiden är låst (godkänd) eller ledig igen (nekad),
       och en beslutad förfrågan tappar sina knappar i panelen. */
    day: dayAvailability_(datum, true),
    message: 'Förfrågan från ' + beslut.namn + ' kl ' + tid + ' är ' +
      (isConfirm ? 'godkänd – tiden är bokad och kunden har fått ett mejl.'
        : 'nekad – tiden är ledig igen och kunden har fått ett mejl.') +
      (beslut.emailOk ? '' : ' Obs: mejlet till kunden kunde inte skickas automatiskt.')
  };
}

/* Är samma datum + tid redan bekräftad för någon annan? */
function hasConflict_(booking) {
  var rows = getRows_();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.id !== booking.id && r.status === STATUS_CONFIRMED &&
        r.datum === booking.datum && r.tid === booking.tid) {
      return true;
    }
  }
  return false;
}

function summaryHtml_(b) {
  var rows = [
    ['Namn', b.namn],
    ['Telefon', b.telefon],
    ['E-post', b.epost],
    ['Datum', b.datum],
    ['Tid', b.tid],
    ['Område', b.omrade],
    ['Antal fönster', String(b.antal)]
  ];
  var html = '<table style="border-collapse:collapse;width:100%;">';
  rows.forEach(function (r) {
    html += '<tr>' +
      '<td style="padding:5px 14px 5px 0;color:#5b6b75;font-size:14px;white-space:nowrap;">' +
        escapeHtml_(r[0]) + '</td>' +
      '<td style="padding:5px 0;color:#0e2a3a;font-size:14px;font-weight:600;">' +
        escapeHtml_(r[1]) + '</td>' +
      '</tr>';
  });
  html += '</table>';
  return html;
}

function pageHtml_(o) {
  return '<!DOCTYPE html><html lang="sv"><head><meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<title>' + escapeHtml_(o.title) + ' – ' + escapeHtml_(CONFIG.COMPANY) + '</title></head>' +
    '<body style="margin:0;background:#f3f6f8;font-family:Arial,Helvetica,sans-serif;">' +
      '<div style="max-width:580px;margin:40px auto;padding:0 16px;">' +
        '<div style="background:#0e2a3a;border-radius:14px 14px 0 0;padding:22px 26px;">' +
          '<h1 style="margin:0;color:#ffffff;font-size:20px;">' + escapeHtml_(CONFIG.COMPANY) + '</h1>' +
          '<p style="margin:6px 0 0;color:#a9c3d1;font-size:14px;">' + escapeHtml_(o.title) + '</p>' +
        '</div>' +
        '<div style="background:#ffffff;border:1px solid #e2e8ec;border-top:none;border-radius:0 0 14px 14px;padding:24px 26px;">' +
          o.body +
        '</div>' +
      '</div>' +
    '</body></html>';
}

/* ============================================================
   SKAPA OCH SKÖTA KONTON (körs här i redigeraren)
   ------------------------------------------------------------
   Konton kan bara skapas härifrån – sajten kan aldrig skapa ett konto.
   Ägarkontot har redan ett användarnamn och ett lösenord i CONFIG högst
   upp i filen. Så här skapar du det (en gång):

     1. Välj funktionen skapaAgarkontot i listan högst upp och klicka Kör.
     2. Logga in på sajten under fliken Konto med uppgifterna i CONFIG.
     3. Skapa personalkonton med skapaKonto('namn', 'losenord', 'Namn',
        'personal'). Bara ägarkontot kan markera tider som bokade och lediga.
   ============================================================ */

/* Skapa ett konto. Körs funktionen utan egna uppgifter används uppgifterna i
   CONFIG högst upp i filen, dvs ägarkontot (samma sak som skapaAgarkontot).
   Med egna uppgifter skapas t.ex. ett personalkonto:
   skapaKonto('stella', 'eget-losenord', 'Stella', 'personal'). */
function skapaKonto(anvandarnamn, losenord, namn, roll) {
  if (!anvandarnamn) anvandarnamn = CONFIG.OWNER_USER;
  if (!losenord) losenord = CONFIG.OWNER_PASSWORD;
  if (!namn) namn = CONFIG.OWNER_NAME;
  if (!roll) roll = ROLE_OWNER;

  var res = saveAccount_(anvandarnamn, losenord, namn, roll);
  Logger.log(res.ok ? res.message : 'Fel: ' + res.message);
  if (res.ok) {
    Logger.log('Logga in på sajten under fliken Konto:');
    Logger.log('    Användarnamn: ' + anvandarnamn);
    Logger.log('    Lösenord:     ' + losenord);
    Logger.log('Byt lösenordet till ett eget så snart du kan: ändra OWNER_PASSWORD ' +
      'i CONFIG högst upp och kör skapaAgarkontot igen.');
  }
  return res;
}

/* Den enklaste vägen till ägarkontot: välj den här funktionen i listan högst
   upp i Apps Script och klicka Kör. Kontot skapas då med uppgifterna i CONFIG.
   Kör den igen om du har bytt användarnamn eller lösenord där. */
function skapaAgarkontot() {
  return skapaKonto();
}

function listaKonton() {
  var rows = readAccounts_();
  if (!rows.length) {
    Logger.log('Inga konton finns ännu. Kör skapaKonto för att skapa ägarkontot.');
    return rows;
  }
  rows.forEach(function (a) {
    Logger.log(a.anvandarnamn + '  ·  ' + a.namn + '  ·  ' + a.roll +
      '  ·  skapad ' + (a.skapad || '–') + '  ·  senast inloggad ' + (a.senast || '–'));
  });
  return rows;
}

function bytLosenord(anvandarnamn, nyttLosenord) {
  var account = findAccount_(anvandarnamn);
  if (!account) {
    Logger.log('Hittar inget konto med användarnamnet "' + clean_(anvandarnamn) + '".');
    return fail_('Kontot finns inte.');
  }
  var res = saveAccount_(account.anvandarnamn, nyttLosenord, account.namn, account.roll);
  Logger.log(res.message);
  return res;
}

function taBortKonto(anvandarnamn) {
  var account = findAccount_(anvandarnamn);
  if (!account) {
    Logger.log('Hittar inget konto med användarnamnet "' + clean_(anvandarnamn) + '".');
    return fail_('Kontot finns inte.');
  }

  accountsSheet_().deleteRow(account.row);
  forget_('accounts');

  /* Loggar ut kontot överallt. */
  var sheet = sessionsSheet_();
  var last = sheet.getLastRow();
  if (last >= 2) {
    var values = sheet.getRange(2, 1, last - 1, SESSION_HEADERS.length).getValues();
    for (var i = values.length - 1; i >= 0; i--) {
      if (clean_(values[i][1]).toLowerCase() === account.anvandarnamn.toLowerCase()) sheet.deleteRow(i + 2);
    }
  }

  Logger.log('Kontot "' + account.anvandarnamn + '" är borttaget.');
  return { ok: true, message: 'Kontot är borttaget.' };
}






/* ============================================================
   FELSÖKNING: GÅR INLOGGNINGEN IGENOM?

   Välj funktionen kollaInloggningen i listan högst upp och klicka Kör.
   Den går igenom hela kedjan och skriver i loggen exakt var det stoppar.
   Ingenting ändras i kalkylarket – sessionen som testas tas bort igen.
   ============================================================ */
function kollaInloggningen() {
  var rader = [];
  var atgarda = [];

  /* 1. Uppgifterna i CONFIG. */
  var user = clean_(CONFIG.OWNER_USER);
  var pass = String(CONFIG.OWNER_PASSWORD == null ? '' : CONFIG.OWNER_PASSWORD);
  rader.push('1. CONFIG: användarnamnet "' + user + '", lösenordet är ' + pass.length + ' tecken.');
  if (!user) atgarda.push('OWNER_USER är tom i CONFIG.');
  if (pass.length < 8) atgarda.push('OWNER_PASSWORD är kortare än 8 tecken.');

  /* 2. Adressen till webbappen – exakt samma adress ska stå i index.html. */
  var url = getWebAppUrl_();
  rader.push('2. Webbappens adress: ' + (url || 'INTE PUBLICERAD ÄN'));
  if (!url) {
    atgarda.push('Webbappen är inte publicerad: Deploy -> New deployment -> Web app ' +
      '(Execute as: Me, Who has access: Anyone).');
  } else {
    rader.push('   Kontrollera att bookingApiUrl i index.html är exakt den här adressen.');
    if (url.indexOf('/exec') === -1) atgarda.push('Adressen slutar inte på /exec – använd den publicerade adressen.');
  }

  /* 3. Kalkylarket som allt sparas i. */
  try {
    var ss = dataSpreadsheet_();
    rader.push('3. Kalkylarket: ' + (typeof ss.getName === 'function' ? clean_(ss.getName()) : '(namnet går inte att läsa härifrån)'));
  } catch (err) {
    atgarda.push('Kalkylarket kunde inte öppnas: ' + err);
  }

  /* 4. Kontot i fliken Konton. */
  var konton = readAccounts_();
  var account = findAccount_(user);
  rader.push('4. Fliken Konton har ' + konton.length + ' konto(n).');

  if (!account) {
    rader.push('   Kontot "' + user + '" finns INTE där.');
    atgarda.push('Kör funktionen skapaAgarkontot – kontot måste skapas en gång innan du kan logga in.');
  } else {
    var stammer = passwordHash_(pass, account.salt) === account.hash;
    rader.push('   Kontot: namn "' + account.namn + '", roll "' + account.roll +
      '", skapat ' + (account.skapad || '–') + '.');
    rader.push('   Lösenordet i CONFIG stämmer med kontot: ' + (stammer ? 'ja' : 'NEJ'));
    if (!stammer) atgarda.push('Lösenordet i CONFIG stämmer inte med kontot i kalkylarket. Kör skapaAgarkontot igen.');
    if (account.roll !== ROLE_OWNER) {
      atgarda.push('Kontot har rollen "' + account.roll + '" i stället för "' + ROLE_OWNER +
        '" – då syns inte fliken Ägare. Kör skapaAgarkontot.');
    }
  }


  /* 5. Sessioner: skapar en, läser tillbaka den och tar bort den igen. */
  if (account) {
    try {
      var session = createSession_(account);
      var tillbaka = accountFromToken_(session.token);
      endSession_(session.token);
      rader.push('5. Sessionstest: ' + (tillbaka ? 'godkänt (token fungerar)' : 'MISSLYCKADES'));
      if (!tillbaka) atgarda.push('En skapad inloggning kunde inte läsas tillbaka – titta i fliken Sessioner.');
    } catch (err) {
      atgarda.push('Sessionen kunde inte skapas: ' + err);
    }
  }

  rader.forEach(function (rad) { Logger.log(rad); });
  Logger.log('----------------------------------------------------------');

  if (atgarda.length) {
    Logger.log('ÅTGÄRDA:');
    atgarda.forEach(function (text) { Logger.log('   * ' + text); });
  } else {
    Logger.log('Servern är felfri: uppgifterna i CONFIG fungerar mot kontot i kalkylarket.');
    Logger.log('Går inloggningen ändå inte igenom på sajten beror det på publiceringen:');
    Logger.log('   * är index.html uppladdad efter att bookingApiUrl fylldes i? Öppna sajten med Ctrl+F5.');
    Logger.log('   * kör den senaste versionen? Deploy -> Manage deployments -> New version.');
    Logger.log('   * står åtkomsten på "Anyone"? Annars visas Googles inloggningssida i stället.');
  }

  return { ok: atgarda.length === 0, atgarda: atgarda, konton: konton.length };
}

/* ============================================================
   HÅLL WEBBAPPEN VAKEN (frivilligt men rekommenderat)

   En Google-webbapp som inte har använts på en stund stängs av, och den första
   besökaren får då vänta på en kallstart. Sajten klarar det – den visar
   ordinarie öppettider, säger att de bokade tiderna kontrolleras och fyller på
   så snart svaret kommer – men det går att slippa undan helt och hållet:

     1. Välj funktionen installeraVarmhallning i listan högst upp i Apps Script
        och klicka Kör (en gång).
     2. Klart. Utlösaren som skapas anropar varmhallAppen var femte minut, och
        då är webbappen alltid varm när någon öppnar sajten.

   Varmhållningen kostar någon sekund per gång (288 körningar per dygn, alltså
   några minuters körtid) och rör inte kalkylarket. Den delade cachen sköts av
   besökarna själva: varje hämtning lägger sitt svar i cacheminnet i fem
   minuter, och varje ändring tömmer den direkt.

   Vill du stänga av varmhållningen: ta bort utlösaren under klockikonen
   (Triggers) i vänstermenyn.
   ============================================================ */

/* Gör ingenting – bara startar webbappen, så att nästa besök möter en varm
   server. Anropas av den tidsstyrda utlösaren. */
function varmhallAppen() {
  return { ok: true, tid: nowStamp_() };
}

/* Skapar (eller uppdaterar) utlösaren ovan. Körs en gång från redigeraren. */
function installeraVarmhallning() {
  var befintliga = ScriptApp.getProjectTriggers();

  for (var i = 0; i < befintliga.length; i++) {
    if (befintliga[i].getHandlerFunction() === 'varmhallAppen') {
      ScriptApp.deleteTrigger(befintliga[i]);
    }
  }

  ScriptApp.newTrigger('varmhallAppen').timeBased().everyMinutes(5).create();
  Logger.log('Klart: varmhallAppen körs var femte minut och håller webbappen vaken.');
  return { ok: true, meddelande: 'Varmhållningen är på plats (var femte minut).' };
}

