// ============================================================
// Funktionellt test av google-apps-script/Code.gs
// Körs med:  cscript //nologo test-backend.js
// Google-tjänsterna byts ut mot enkla minnesobjekt.
// ============================================================

// ---------- Polyfills (JScript är gammalt) ----------
if (!Array.prototype.forEach) {
  Array.prototype.forEach = function (fn) { for (var i = 0; i < this.length; i++) fn(this[i], i, this); };
}
if (!Array.prototype.indexOf) {
  Array.prototype.indexOf = function (x) { for (var i = 0; i < this.length; i++) if (this[i] === x) return i; return -1; };
}
if (!Array.prototype.filter) {
  Array.prototype.filter = function (fn) { var o = []; for (var i = 0; i < this.length; i++) if (fn(this[i])) o.push(this[i]); return o; };
}
if (!String.prototype.trim) {
  String.prototype.trim = function () { return this.replace(/^\s+|\s+$/g, ''); };
}
if (typeof JSON === 'undefined') { JSON = {}; }
(function () {
  function quote(s) {
    s = String(s);
    var out = '"';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '"') out += '\\"';
      else if (c === '\\') out += '\\\\';
      else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else out += c;
    }
    return out + '"';
  }
  JSON.stringify = function (v) {
    if (v === null || typeof v === 'undefined') return 'null';
    var t = typeof v;
    if (t === 'string') return quote(v);
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return String(v);
    if (v instanceof Array) {
      var a = [];
      for (var i = 0; i < v.length; i++) a.push(JSON.stringify(v[i]));
      return '[' + a.join(',') + ']';
    }
    if (t === 'object') {
      var b = [];
      for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) b.push(quote(k) + ':' + JSON.stringify(v[k]));
      return '{' + b.join(',') + '}';
    }
    return 'undefined';
  };
})();

/* JScript har ingen JSON.parse (den finns i Apps Script). Den här räcker för
   det testet behöver: strängar, tal, sant/falskt, null, listor och objekt. */
if (!JSON.parse) {
  JSON.parse = function (text) {
    text = String(text);
    var at = 0;

    function skip() {
      while (at < text.length && ' \t\r\n'.indexOf(text.charAt(at)) !== -1) at++;
    }

    function string() {
      var out = '';
      at++; /* inledande citattecken */
      while (at < text.length) {
        var c = text.charAt(at++);
        if (c === '"') return out;
        if (c !== '\\') { out += c; continue; }

        var e = text.charAt(at++);
        if (e === 'n') out += '\n';
        else if (e === 't') out += '\t';
        else if (e === 'r') out += '\r';
        else if (e === 'u') { out += String.fromCharCode(parseInt(text.substr(at, 4), 16)); at += 4; }
        else out += e;
      }
      throw new Error('JSON: oavslutad strang');
    }

    function literal() {
      var rest = text.slice(at);
      if (rest.indexOf('true') === 0) { at += 4; return true; }
      if (rest.indexOf('false') === 0) { at += 5; return false; }
      if (rest.indexOf('null') === 0) { at += 4; return null; }

      var m = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(rest);
      if (!m) throw new Error('JSON: ogiltigt varde vid ' + at);
      at += m[0].length;
      return parseFloat(m[0]);
    }

    function array() {
      var out = [];
      at++; /* [ */
      skip();
      if (text.charAt(at) === ']') { at++; return out; }

      while (at < text.length) {
        out.push(value());
        skip();
        if (text.charAt(at) === ',') { at++; continue; }
        if (text.charAt(at) === ']') { at++; return out; }
        throw new Error('JSON: ogiltig lista vid ' + at);
      }
      throw new Error('JSON: oavslutad lista');
    }

    function object() {
      var out = {};
      at++; /* { */
      skip();
      if (text.charAt(at) === '}') { at++; return out; }

      while (at < text.length) {
        skip();
        if (text.charAt(at) !== '"') throw new Error('JSON: nyckeln maste vara en strang vid ' + at);
        var key = string();
        skip();
        if (text.charAt(at) !== ':') throw new Error('JSON: vantade : vid ' + at);
        at++;
        out[key] = value();
        skip();
        if (text.charAt(at) === ',') { at++; continue; }
        if (text.charAt(at) === '}') { at++; return out; }
        throw new Error('JSON: ogiltigt objekt vid ' + at);
      }
      throw new Error('JSON: oavslutat objekt');
    }

    function value() {
      skip();
      var ch = text.charAt(at);
      if (ch === '{') return object();
      if (ch === '[') return array();
      if (ch === '"') return string();
      return literal();
    }

    return value();
  };
}

// ---------- Filer ----------
function readUtf8(path) {
  var s = new ActiveXObject("ADODB.Stream");
  s.Type = 2; s.Charset = "utf-8"; s.Open(); s.LoadFromFile(path);
  var t = s.ReadText(); s.Close();
  return t.replace(/^\uFEFF/, '');
}
function pad(n) { return (n < 10 ? '0' : '') + n; }

// ---------- Google-stubbar ----------
var EMAILS = [];
var UUID_COUNTER = 0;
var PROPS = {};

function FakeSheet() { this.rows = []; this.frozen = 0; }
FakeSheet.prototype.appendRow = function (arr) { this.rows.push(arr.slice(0)); };
FakeSheet.prototype.getLastRow = function () { return this.rows.length; };
FakeSheet.prototype.getMaxRows = function () { return 1000; };
FakeSheet.prototype.setFrozenRows = function (n) { this.frozen = n; };
/* Raderar en hel rad, precis som Google Sheets: raderna under flyttar upp. */
FakeSheet.prototype.deleteRow = function (r) { this.rows.splice(r - 1, 1); };
FakeSheet.prototype.getRange = function (r, c, nr, nc) {
  var self = this;
  return {
    setNumberFormat: function () { return this; },
    setValue: function (v) { if (self.rows[r - 1]) self.rows[r - 1][c - 1] = v; return this; },
    getValues: function () {
      var out = [];
      for (var i = 0; i < nr; i++) out.push(self.rows[r - 1 + i] ? self.rows[r - 1 + i].slice(0) : []);
      return out;
    }
  };
};

var SPREADSHEET = (function () {
  var sheets = {};
  return {
    getSheetByName: function (name) { return sheets[name] || null; },
    insertSheet: function (name) { sheets[name] = new FakeSheet(); return sheets[name]; },
    getId: function () { return 'fake-id'; }
  };
})();

var SpreadsheetApp = {
  getActiveSpreadsheet: function () { return SPREADSHEET; },
  openById: function () { return SPREADSHEET; },
  create: function () {
    return { getSheetByName: function () { return null; },
      insertSheet: function () { return new FakeSheet(); }, getId: function () { return 'x'; } };
  }
};

var PropertiesService = {
  getScriptProperties: function () {
    return {
      getProperty: function (k) { return PROPS[k] || null; },
      setProperty: function (k, v) { PROPS[k] = v; }
    };
  }
};

/* Apps Scripts CacheService (den delade cachen mellan anrop). Testet har en
   enkel ordbok: innehållet ska gå att läsa tillbaka, skrivas över och tas bort
   – precis som på riktigt. Livstiderna behövs inte för kontrollerna. */
var CACHE_STORE = {};
var CacheService = {
  getScriptCache: function () {
    return {
      get: function (k) {
        return Object.prototype.hasOwnProperty.call(CACHE_STORE, k) ? CACHE_STORE[k] : null;
      },
      put: function (k, v) { CACHE_STORE[k] = String(v); },
      remove: function (k) { delete CACHE_STORE[k]; }
    };
  }
};

var ScriptApp = { getService: function () { return { getUrl: function () { return 'https://script.google.com/macros/s/FAKE/exec'; } }; } };

var Utilities = {
  formatDate: function (date, tz, fmt) {
    var y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    var h = date.getHours(), mi = date.getMinutes();
    if (fmt === 'yyyy-MM-dd') return y + '-' + pad(m) + '-' + pad(d);
    return y + '-' + pad(m) + '-' + pad(d) + ' ' + pad(h) + ':' + pad(mi);
  },
  getUuid: function () {
    UUID_COUNTER++;
    var h = UUID_COUNTER.toString(16);
    while (h.length < 8) h = '0' + h;
    return h + '-0000-0000-0000-000000000000';
  },

  /* Googles riktiga SHA_256 finns bara i Apps Script. Har racker en enkel
     hash: samma losenord och salt ger alltid samma strang och olika losenord
     ger olika, sa att inloggningen gar att prova pa riktigt. */
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  computeDigest: function (algorithm, value) {
    var text = String(value);
    var seed = 2166136261;
    for (var i = 0; i < text.length; i++) {
      seed = ((seed ^ text.charCodeAt(i)) * 16777619) >>> 0;
    }
    var bytes = [];
    for (var b = 0; b < 32; b++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      bytes.push((seed >>> 24) & 0xff);
    }
    return bytes;
  }
};

var LockService = {
  getScriptLock: function () { return { waitLock: function () { return true; }, releaseLock: function () {} }; }
};

var MailApp = { sendEmail: function (opts) { EMAILS.push(opts); } };

/* Apps Scripts Logger. Raderna samlas sa att testet kan kontrollera att
   skapaKonto skriver ut anvandarnamn och losenord. */
var LOGS = [];
var Logger = {
  log: function (value) { LOGS.push(String(value)); }
};

var ContentService = {
  MimeType: { HTML: 'text/html', JSON: 'application/json', JAVASCRIPT: 'text/javascript' },
  createTextOutput: function (s) {
    var o = { text: s, mime: 'text/plain' };
    o.setMimeType = function (m) { o.mime = m; return o; };
    o.getContent = function () { return o.text; };
    o.getMimeType = function () { return o.mime; };
    return o;
  }
};

// ---------- Ladda backend-koden ----------
var SCRIPT_DIR = WScript.ScriptFullName.replace(/[^\\\/]+$/, '');
eval(readUtf8(SCRIPT_DIR + 'Code.gs'));

// ---------- Testhjälp ----------
var PASS = 0, FAIL = 0;
function check(name, cond, extra) {
  if (cond) { PASS++; WScript.Echo('  PASS  ' + name); }
  else { FAIL++; WScript.Echo('  FAIL  ' + name + (extra ? '  --> ' + extra : '')); }
}
function lastEmailTo(addr) {
  for (var i = EMAILS.length - 1; i >= 0; i--) if (EMAILS[i].to === addr) return EMAILS[i];
  return null;
}
function isoInDays(n) {
  var d = new Date(); d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, CONFIG.TZ, 'yyyy-MM-dd');
}
function validTimeFor(iso) {
  var p = iso.split('-');
  var wd = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
  return (wd === 0 || wd === 6) ? '11:00' : '16:00';
}
function baseBooking(datum, tid, extras) {
  var b = {
    action: 'book', namn: 'Anna Andersson', telefon: '070-123 45 67',
    epost: 'anna@example.com', antalFonster: '12', fastighet: 'Villa',
    adress: 'Testgatan 1', omrade: 'Häggvik 192 40', datum: datum, tid: tid,
    meddelande: 'Hej!'
  };
  if (extras) for (var k in extras) b[k] = extras[k];
  return b;
}
function tokenFor(id) {
  var rows = getRows_();
  for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i].token;
  return null;
}
/* Det svar en helt utloggad besokare far for ett datum (utan kundnamn). */
function guestDay(iso) {
  return doGet({ parameter: { action: 'availability', datum: iso, callback: 'cb' } }).getContent();
}
/* Svaret till sajten (JSON:en klamras ut ur <script>postMessage(...)</script>). */
function postText(params) {
  return doPost({ parameter: params }).getContent();
}

WScript.Echo('== Jakobs HusFix - backendtest ==');

var D1 = isoInDays(10), T1 = validTimeFor(D1);
var D2 = isoInDays(11), T2 = validTimeFor(D2);
var D3 = isoInDays(12), T3 = validTimeFor(D3);

// 1. Ledig tid -> bokning sparas och mejl skickas
WScript.Echo('\n1. Forsta bokningen');
var r1 = handleBooking_(baseBooking(D1, T1));
check('bokning accepteras', r1.ok === true, JSON.stringify(r1));
check('upptagen tid registreras', bookedTimes_(D1).indexOf(T1) !== -1);
check('mejl till jakobshusfix@gmail.com', lastEmailTo('jakobshusfix@gmail.com') !== null);
check('mejlet har godkann- och nekalankar',
  lastEmailTo('jakobshusfix@gmail.com').htmlBody.indexOf('action=confirm') !== -1 &&
  lastEmailTo('jakobshusfix@gmail.com').htmlBody.indexOf('action=decline') !== -1);

// 2. Samma tid kan inte bokas igen
WScript.Echo('\n2. Andra personen forsoker samma tid');
var r2 = handleBooking_(baseBooking(D1, T1, { namn: 'Bo Bengtsson', epost: 'bo@example.com' }));
check('nekas (redan bokad)', r2.ok === false && r2.message.indexOf('redan bokad') !== -1, JSON.stringify(r2));

// 3. Availability-endpointen (JSONP)
WScript.Echo('\n3. Availability via doGet');
var avail = doGet({ parameter: { action: 'availability', datum: D1, callback: 'cb' } });
check('svarar som JSONP', avail.getContent().indexOf('cb(') === 0, avail.getContent());
check('innehaller den bokade tiden', avail.getContent().indexOf('"' + T1 + '"') !== -1, avail.getContent());
check('MIME ar javascript', avail.getMimeType() === 'text/javascript');
var avail2 = doGet({ parameter: { action: 'availability', datum: D2, callback: 'cb' } }).getContent();
check('annat datum ar ledigt', avail2.indexOf('"taken":[]') !== -1, avail2);

// 4. Validering
WScript.Echo('\n4. Validering pa servern');
check('fel tid avvisas', handleBooking_(baseBooking(D2, '03:00')).ok === false);
// 2026-12-05 ar en lordag, 2026-12-07 en mandag.
check('helg 09:00 avvisas', isValidSlot_('2026-12-05', '09:00') === false);
check('helg 11:00 tillats', isValidSlot_('2026-12-05', '11:00') === true);
check('vardag 14:00 avvisas', isValidSlot_('2026-12-07', '14:00') === false);
check('vardag 16:00 tillats', isValidSlot_('2026-12-07', '16:00') === true);
check('gammalt datum avvisas', handleBooking_(baseBooking('2020-01-01', '16:00')).ok === false);
check('tid som redan passerat avvisas', isTooLateToBook_(isoInDays(-1), '16:00') === true);
check('tid senare i veckan tillats', isTooLateToBook_(isoInDays(2), '10:00') === false);
check('framtida tid tillats', isTooLateToBook_(isoInDays(3), '16:00') === false);
check('otydlig tid avvisas', isTooLateToBook_(isoInDays(3), 'sen') === true);
check('fel e-post avvisas', handleBooking_(baseBooking(D2, '16:00', { epost: 'fel' })).ok === false);

// 5. Godkann-sidan kraver ett extra klick
WScript.Echo('\n5. Godkann-sida kraver extra klick');
var id1 = r1.id, token1 = tokenFor(id1);
var page = doGet({ parameter: { action: 'confirm', id: id1, token: token1 } }).getContent();
check('visar bekraftelseknapp', page.indexOf('Godkann bokningen') !== -1 || page.indexOf('Godk') !== -1);
check('status fortfarande Vantar', findBooking_(id1).status === 'V\u00e4ntar');

// 6. Godkann pa riktigt
WScript.Echo('\n6. Godkann bokningen');
var done = doGet({ parameter: { action: 'confirm', id: id1, token: token1, confirm: '1' } }).getContent();
check('status = Bekraftad', findBooking_(id1).status === 'Bekr\u00e4ftad');
check('tiden fortfarande upptagen', bookedTimes_(D1).indexOf(T1) !== -1);
check('kundmejl skickat', lastEmailTo('anna@example.com') !== null);
check('bekraftelsesida visas', done.indexOf('Bokningen') !== -1);

// 7. Ogiltig token
WScript.Echo('\n7. Ogiltig token');
var bad = doGet({ parameter: { action: 'confirm', id: id1, token: 'fel', confirm: '1' } }).getContent();
check('nekas', bad.indexOf('Ogiltig') !== -1);

// 8. Neka -> tiden blir ledig for nagon annan
WScript.Echo('\n8. Neka en forfragan');
var r8 = handleBooking_(baseBooking(D2, T2, { namn: 'Bo Bengtsson', epost: 'bo@example.com' }));
check('bokning av Bo accepteras', r8.ok === true);
var id8 = r8.id, token8 = tokenFor(id8);
check('tiden ar upptagen', bookedTimes_(D2).indexOf(T2) !== -1);
var decPage = doGet({ parameter: { action: 'decline', id: id8, token: token8 } }).getContent();
check('neka-sida kraver klick', findBooking_(id8).status === 'V\u00e4ntar');
doGet({ parameter: { action: 'decline', id: id8, token: token8, confirm: '1' } });
check('status = Avslagen', findBooking_(id8).status === 'Avslagen');
check('tiden ar nu LEDIG', bookedTimes_(D2).indexOf(T2) === -1);
check('kundmejl om nej skickat', lastEmailTo('bo@example.com') !== null);
var r8b = handleBooking_(baseBooking(D2, T2, { namn: 'Cissi Carlsson', epost: 'cissi@example.com' }));
check('nagon annan kan boka tiden', r8b.ok === true, JSON.stringify(r8b));

// 9. Tva vantande pa samma tid -> konflikt vid godkannande
WScript.Echo('\n9. Konflikt pa samma tid');
function addPending(id, token, datum, tid) {
  getSheet_().appendRow([id, token, nowStamp_(), 'V\u00e4ntar', 'Test Testsson', '070-000 00 00',
    'test@example.com', 5, 'Villa', '', 'Solna', datum, tid, 350, '', '']);
}
addPending('C000000001', 'tokc1', D3, T3);
addPending('C000000002', 'tokc2', D3, T3);
var c1 = decide_('confirm', 'C000000001', 'tokc1', true);
check('forsta godkanns', findBooking_('C000000001').status === 'Bekr\u00e4ftad' && c1.title.indexOf('godk') !== -1);
var c2 = decide_('confirm', 'C000000002', 'tokc2', true);
check('andra stoppas (konflikt)', c2.title.indexOf('upptagen') !== -1 || c2.title.indexOf('tagen') !== -1, c2.title);
check('andra ar fortfarande Vantar', findBooking_('C000000002').status === 'V\u00e4ntar');
var c2d = decide_('decline', 'C000000002', 'tokc2', true);
check('andra kan nekas', findBooking_('C000000002').status === 'Avslagen' && c2d.title.indexOf('nekad') !== -1);
check('tiden ar kvar (C1 bekraftad)', bookedTimes_(D3).indexOf(T3) !== -1);

// 10. doPost-svaret (samma svar som sajten läser med fetch)
WScript.Echo('\n10. doPost-svar till sajten');
var D4 = isoInDays(13);
var post = doPost({ parameter: baseBooking(D4, validTimeFor(D4)) }).getContent();
check('innehaller postMessage', post.indexOf('postMessage') !== -1);
check('innehaller jhfix-flaggan', post.indexOf('jhfix') !== -1);
check('MIME ar html', doPost({ parameter: { action: 'book' } }).getMimeType() === 'text/html');

// ============================================================
// 11. Konton och inloggning (flikarna Konton och Sessioner)
// ============================================================
WScript.Echo('\n11. Konton och inloggning');
var OWNER_USER = 'jakob', OWNER_PASS = 'hemligt-losenord';
var STAFF_USER = 'stella', STAFF_PASS = 'personal-losenord';

check('agarkontot skapas', saveAccount_(OWNER_USER, OWNER_PASS, 'Jakob HusFix', ROLE_OWNER).ok === true);
check('personalkontot skapas', saveAccount_(STAFF_USER, STAFF_PASS, 'Stella Personal', ROLE_STAFF).ok === true);
check('kort losenord avvisas', saveAccount_('kortis', 'kort', 'Kort Is', ROLE_STAFF).ok === false);
check('fel losenord nekas', login_(OWNER_USER, 'fel-losenord').ok === false);
check('okant konto nekas', login_('ingen-sadan', OWNER_PASS).ok === false);

var ownerLogin = login_(OWNER_USER, OWNER_PASS);
check('ratt losenord ger en token', ownerLogin.ok === true && String(ownerLogin.token).length >= 8, JSON.stringify(ownerLogin));
check('agarkontot far arAgare = true', ownerLogin.arAgare === true);
check('inloggningen sparar namn och roll',
  ownerLogin.user && ownerLogin.user.roll === ROLE_OWNER && ownerLogin.user.namn === 'Jakob HusFix');

var staffLogin = login_(STAFF_USER, STAFF_PASS);
check('personalen far arAgare = false', staffLogin.ok === true && staffLogin.arAgare === false, JSON.stringify(staffLogin));

var meOwner = doGet({ parameter: { action: 'me', token: ownerLogin.token, callback: 'cb' } }).getContent();
check('me svarar for agaren', meOwner.indexOf('"ok":true') !== -1 && meOwner.indexOf('"arAgare":true') !== -1, meOwner);
check('me lamnar aldrig ut salt eller hash', meOwner.indexOf('salt') === -1 && meOwner.indexOf('hash') === -1, meOwner);
check('me med fel token nekas',
  doGet({ parameter: { action: 'me', token: 'fel', callback: 'cb' } }).getContent().indexOf('"ok":false') !== -1);

check('utloggning svarar ok', postText({ action: 'logout', token: ownerLogin.token }).indexOf('"ok":true') !== -1);
check('token galler inte efter utloggning',
  doGet({ parameter: { action: 'me', token: ownerLogin.token, callback: 'cb' } }).getContent().indexOf('"ok":false') !== -1);

var ownerToken = login_(OWNER_USER, OWNER_PASS).token;
check('agaren kan logga in igen efter utloggning', String(ownerToken).length >= 8);

// ------------------------------------------------------------
// 11b. Agarkontot med uppgifterna i CONFIG (skapaAgarkontot)
// ------------------------------------------------------------
WScript.Echo('\n11b. Agarkontot skapas med uppgifterna i CONFIG');
LOGS = [];
var builtOwner = skapaKonto();
check('skapaKonto utan argument anvander CONFIG.OWNER_USER',
  builtOwner.ok === true && findAccount_(CONFIG.OWNER_USER) !== null, JSON.stringify(builtOwner));
check('CONFIG-losenordet ar minst 8 tecken', String(CONFIG.OWNER_PASSWORD).length >= 8);
check('loggen visar anvandarnamn och losenord',
  LOGS.join(' | ').indexOf(CONFIG.OWNER_USER) !== -1 &&
  LOGS.join(' | ').indexOf(CONFIG.OWNER_PASSWORD) !== -1, LOGS.join(' | '));
check('CONFIG-losenordet ger ett agarkonto',
  login_(CONFIG.OWNER_USER, CONFIG.OWNER_PASSWORD).arAgare === true);
check('anvandarnamnet ar skiftlagesokansligt',
  login_(String(CONFIG.OWNER_USER).toUpperCase(), CONFIG.OWNER_PASSWORD).ok === true);
check('skapaAgarkontot skapar agarkontot', skapaAgarkontot().ok === true);
check('kontot far namnet fran CONFIG.OWNER_NAME',
  findAccount_(CONFIG.OWNER_USER).namn === CONFIG.OWNER_NAME);
check('det gamla losenordet slutade galla', login_(OWNER_USER, OWNER_PASS).ok === false);

/* Testet ger kontot sitt eget namn tillbaka, sa att kontrollerna nedan inte
   beror pa vad som star i CONFIG.OWNER_NAME. */
saveAccount_(CONFIG.OWNER_USER, CONFIG.OWNER_PASSWORD, 'Jakob HusFix', ROLE_OWNER);

/* Resten av testet loggar in precis som Jakob gor pa sajten. */
ownerToken = login_(CONFIG.OWNER_USER, CONFIG.OWNER_PASSWORD).token;
check('agarkontot kan logga in med uppgifterna i CONFIG', String(ownerToken).length >= 8);

/* Sajtens Konto-flik loggar in via doPost med faltnamnen anvandare/losenord. */
var siteLogin = postText({ action: 'login', anvandare: CONFIG.OWNER_USER, losenord: CONFIG.OWNER_PASSWORD });
check('sajtens inloggning svarar ok med CONFIG-uppgifterna',
  siteLogin.indexOf('"ok":true') !== -1 && siteLogin.indexOf('"arAgare":true') !== -1, siteLogin);

/* Felsokningen som Jakob kor i redigeraren ska peka ratt och inte lamna
   nagra spår efter sig i kalkylarket. */
var sessionsBeforeDiag = sessionsSheet_().getLastRow();
LOGS = [];
var diagnos = kollaInloggningen();
var diagnosText = LOGS.join('\n');
check('kollaInloggningen godkanner CONFIG-uppgifterna', diagnos.ok === true, diagnosText);
check('kollaInloggningen visar kontots roll', diagnosText.indexOf(ROLE_OWNER) !== -1, diagnosText);
check('kollaInloggningen sager att losenordet stammer',
  diagnosText.indexOf('med kontot: ja') !== -1, diagnosText);
check('kollaInloggningen provar en session', diagnosText.indexOf('Sessionstest: godk') !== -1, diagnosText);
check('kollaInloggningen lamnar inga sessioner efter sig',
  sessionsSheet_().getLastRow() === sessionsBeforeDiag);

/* Saknas kontot ska felsokningen saga det och hänvisa till skapaAgarkontot. */
var sparatAnvandarnamn = CONFIG.OWNER_USER;
CONFIG.OWNER_USER = 'finns-inte-har';
LOGS = [];
var diagnos2 = kollaInloggningen();
var diagnos2Text = LOGS.join('\n');
check('kollaInloggningen ser att kontot saknas',
  diagnos2.ok === false && diagnos2Text.indexOf('finns INTE') !== -1, diagnos2Text);
check('kollaInloggningen hanvisar till skapaAgarkontot',
  diagnos2Text.indexOf('skapaAgarkontot') !== -1, diagnos2Text);
CONFIG.OWNER_USER = sparatAnvandarnamn;


// ============================================================
// 12. Bara agarkontot far andra tider
// ============================================================
WScript.Echo('\n12. Bara agarkontot far andra tider');
var D5 = isoInDays(15), T5 = validTimeFor(D5);
var D6 = isoInDays(16), T6 = validTimeFor(D6);
var EXTRA = '09:00', EXTRA2 = '08:00';

var guestTry = setSlot_({ datum: D5, tid: T5, status: SLOT_BUSY });
check('utan inloggning nekas markeringen',
  guestTry.ok === false && guestTry.message.indexOf('inloggning') !== -1, JSON.stringify(guestTry));
var staffTry = setSlot_({ token: staffLogin.token, datum: D5, tid: T5, status: SLOT_BUSY });
check('personalen nekas markeringen',
  staffTry.ok === false && staffTry.message.indexOf('garkontot') !== -1, JSON.stringify(staffTry));
check('ingen markering sparades', readSlots_().length === 0);
check('utan inloggning nekas hela dagen', setDay_({ datum: D6, status: SLOT_BUSY }).ok === false);

check('en tid utanfor 07-21 nekas',
  setSlot_({ token: ownerToken, datum: D5, tid: '22:00', status: SLOT_BUSY }).ok === false);
check('en halvtimme nekas',
  setSlot_({ token: ownerToken, datum: D5, tid: '14:30', status: SLOT_BUSY }).ok === false);
check('en okand status nekas',
  setSlot_({ token: ownerToken, datum: D5, tid: T5, status: 'Kanske' }).ok === false);
check('ett ogiltigt datum nekas',
  setSlot_({ token: ownerToken, datum: '2026-13-45', tid: T5, status: SLOT_BUSY }).ok === false);
check('hela dagen kraver Bokad eller Ledig',
  setDay_({ token: ownerToken, datum: D6, status: 'Kanske' }).ok === false);

// ============================================================
// 13. Jakobs markeringar: Bokad, Ledig och Auto
// ============================================================
WScript.Echo('\n13. Jakobs markeringar: Bokad, Ledig och Auto');

var busy = setSlot_({ token: ownerToken, datum: D5, tid: T5, status: SLOT_BUSY });
check('Bokad-markeringen sparas', busy.ok === true && takenTimes_(D5).indexOf(T5) !== -1, JSON.stringify(busy));
check('kvittensen forklarar vad som hande', busy.message.indexOf('markerad som bokad') !== -1, busy.message);
check('markeringen sparar vem som gjorde den', readSlots_()[0].andradAv === 'Jakob HusFix', JSON.stringify(readSlots_()));
check('gasten ser tiden som tagen', guestDay(D5).indexOf('"taken":["' + T5 + '"]') !== -1, guestDay(D5));

var freed = setSlot_({ token: ownerToken, datum: D5, tid: T5, status: SLOT_FREE });
check('Ledig-markeringen gor tiden bokningsbar igen',
  freed.ok === true && takenTimes_(D5).indexOf(T5) === -1, JSON.stringify(freed));
check('kvittensen sager att tiden gar att boka', freed.message.indexOf('markerad som ledig') !== -1, freed.message);
check('gasten ser tiden som ledig igen', guestDay(D5).indexOf('"taken":[]') !== -1, guestDay(D5));

check('09:00 ar en extratid utanfor ordinarie schema',
  isValidSlot_(D5, EXTRA) === false && isOpenHour_(EXTRA) === true);
check('extratiden gar inte att boka innan den oppnats', isBookableSlot_(D5, EXTRA) === false);
var opened = setSlot_({ token: ownerToken, datum: D5, tid: EXTRA, status: SLOT_FREE });
check('extratiden oppnas som Ledig', opened.ok === true && isBookableSlot_(D5, EXTRA) === true, JSON.stringify(opened));
check('gasten ser extratiden i dagens lista', guestDay(D5).indexOf('"' + EXTRA + '"') !== -1, guestDay(D5));

var extraBooking = handleBooking_(baseBooking(D5, EXTRA, { namn: 'Extra Kunden', epost: 'extra@example.com' }));
check('en kund kan boka extratiden', extraBooking.ok === true, JSON.stringify(extraBooking));
check('extratiden ar nu tagen', takenTimes_(D5).indexOf(EXTRA) !== -1);
check('Auto pa en kundbokad extratid nekas',
  setSlot_({ token: ownerToken, datum: D5, tid: EXTRA, status: SLOT_AUTO }).message.indexOf('kundbokning') !== -1);

setSlot_({ token: ownerToken, datum: D5, tid: EXTRA2, status: SLOT_FREE });
check('en oppnad extratid ar bokningsbar', isBookableSlot_(D5, EXTRA2) === true);
var closed = setSlot_({ token: ownerToken, datum: D5, tid: EXTRA2, status: SLOT_AUTO });
check('Auto stanger extratiden', closed.ok === true && isBookableSlot_(D5, EXTRA2) === false, JSON.stringify(closed));
check('Auto tar bort markeringen helt', slotMarks_(D5).lediga[EXTRA2] === undefined);
check('kvittensen sager att tiden foljer ordinarie schema', closed.message.indexOf('ordinarie schema') !== -1, closed.message);

// ============================================================
// 14. En riktig kundbokning ar last
// ============================================================
WScript.Echo('\n14. En riktig kundbokning ar last');
check('Annas bokning ar bekraftad', findBooking_(id1).status === 'Bekr\u00e4ftad');

var lockedAsFree = setSlot_({ token: ownerToken, datum: D1, tid: T1, status: SLOT_FREE });
check('en kundbokad tid kan inte bli ledig',
  lockedAsFree.ok === false && lockedAsFree.message.indexOf('en kund') !== -1, JSON.stringify(lockedAsFree));
check('agaren ser kundens namn i felmeddelandet', lockedAsFree.message.indexOf('Anna Andersson') !== -1, lockedAsFree.message);
var lockedAsBusy = setSlot_({ token: ownerToken, datum: D1, tid: T1, status: SLOT_BUSY });
check('en kundbokad tid kan inte markeras om',
  lockedAsBusy.ok === false && lockedAsBusy.message.indexOf('kundbokning') !== -1, JSON.stringify(lockedAsBusy));
check('bokningen ar orord', findBooking_(id1).status === 'Bekr\u00e4ftad');
check('ingen egen markering skrevs for Annas dag',
  readSlots_().filter(function (s) { return s.datum === D1; }).length === 0);

// ============================================================
// 15. Gaster far aldrig se kundnamn
// ============================================================
WScript.Echo('\n15. Gaster far aldrig se kundnamn');
var guestD1 = guestDay(D1);
check('gastsvaret visar att tiden ar tagen', guestD1.indexOf('"taken":["' + T1 + '"]') !== -1, guestD1);
check('gastsvaret innehaller inte kundens namn', guestD1.indexOf('Anna Andersson') === -1, guestD1);
check('gastsvaret innehaller inga bokningsdetaljer',
  guestD1.indexOf('bookings') === -1 && guestD1.indexOf('marks') === -1, guestD1);

var infoGuest = doGet({ parameter: { action: 'dayinfo', datum: D1, callback: 'cb' } }).getContent();
check('dayinfo utan inloggning nekas',
  infoGuest.indexOf('"ok":false') !== -1 && infoGuest.indexOf('Anna') === -1, infoGuest);
var infoStaff = doGet({ parameter: { action: 'dayinfo', datum: D1, token: staffLogin.token, callback: 'cb' } }).getContent();
check('dayinfo nekas aven for personalen',
  infoStaff.indexOf('"ok":false') !== -1 && infoStaff.indexOf('Anna') === -1, infoStaff);
check('dayinfo med ogiltigt datum nekas',
  doGet({ parameter: { action: 'dayinfo', datum: '2026-13-45', token: ownerToken, callback: 'cb' } })
    .getContent().indexOf('"ok":false') !== -1);

var infoOwner = doGet({ parameter: { action: 'dayinfo', datum: D1, token: ownerToken, callback: 'cb' } }).getContent();
check('dayinfo ger agaren dagens kundbokningar', infoOwner.indexOf('Anna Andersson') !== -1, infoOwner);
check('dayinfo markerar att svaret ar for agaren', infoOwner.indexOf('"arAgare":true') !== -1, infoOwner);
check('dayinfo innehaller de ordinarie tiderna', infoOwner.indexOf('"ordinarie":[') !== -1, infoOwner);
check('dayinfo innehaller dagens tider och tagna tider',
  infoOwner.indexOf('"slots":[') !== -1 && infoOwner.indexOf('"taken":[') !== -1, infoOwner);
check('dayinfo innehaller markeringar som listor', infoOwner.indexOf('"marks":{"bokade":[') !== -1, infoOwner);

// ============================================================
// 16. Hela dagen pa en gang
// ============================================================
WScript.Echo('\n16. Hela dagen pa en gang');
var dayBusy = setDay_({ token: ownerToken, datum: D6, status: SLOT_BUSY });
check('hela dagen markeras som bokad', dayBusy.ok === true, JSON.stringify(dayBusy));
check('alla ordinarie tider ar tagna',
  takenTimes_(D6).length === standardSlots_(D6).length, JSON.stringify(takenTimes_(D6)));
check('kvittensen raknar upp tiderna', dayBusy.message.indexOf('markerade som bokade') !== -1, dayBusy.message);
check('gastlistan visar dagen som fullbokad',
  guestDay(D6).indexOf('"taken":' + JSON.stringify(sortTimes_(standardSlots_(D6)))) !== -1, guestDay(D6));

var sista = handleBooking_(baseBooking(D6, T6, { namn: 'Sista Kunden', epost: 'sista@example.com' }));
check('en kund kan inte boka en dag Jakob har stangt',
  sista.ok === false && sista.message.indexOf('redan bokad') !== -1, JSON.stringify(sista));

var daySkip = setDay_({ token: ownerToken, datum: D1, status: SLOT_BUSY });
check('kundbokade tider lamnas ororda nar dagen marks',
  daySkip.ok === true && daySkip.message.indexOf('en kund') !== -1, daySkip.message);
check('Annas tid ar fortfarande last', slotLock_(D1, T1) !== null);
check('kvittensen visar hur manga tider som markerades', daySkip.message.indexOf('markerade som bokade') !== -1, daySkip.message);

var dayReset = setDay_({ token: ownerToken, datum: D6, status: SLOT_FREE });
check('dagen gar tillbaka till ordinarie schema',
  dayReset.ok === true && takenTimes_(D6).length === 0, JSON.stringify(dayReset));
check('kvittensen forklarar aterstallningen', dayReset.message.indexOf('ordinarie schema') !== -1, dayReset.message);
check('inga egna markeringar for D6 kvar',
  readSlots_().filter(function (s) { return s.datum === D6; }).length === 0);

// ============================================================
// 17. Extratider i hela listan (availability med from och dagar)
// ============================================================
WScript.Echo('\n17. Extratider i hela listan');
setSlot_({ token: ownerToken, datum: D5, tid: EXTRA2, status: SLOT_FREE });
var range = doGet({ parameter: { action: 'availability', from: D5, dagar: '2', callback: 'cb' } }).getContent();
check('periodsvaret har from och antal dagar',
  range.indexOf('"from":"' + D5 + '"') !== -1 && range.indexOf('"dagar":2') !== -1, range);
check('periodsvaret har en post per dag', range.indexOf('"days":{"' + D5 + '":') !== -1, range);
check('extratiden ligger i dagens tidslista', range.indexOf('"slots":["' + EXTRA2 + '"') !== -1, range);
check('periodsvaret innehaller inga kundnamn',
  range.indexOf('Anna') === -1 && range.indexOf('Extra Kunden') === -1, range);
check('periodsvaret innehaller inga bokningsdetaljer', range.indexOf('bookings') === -1, range);
check('for manga dagar begransas',
  doGet({ parameter: { action: 'availability', from: D1, dagar: '40', callback: 'cb' } })
    .getContent().indexOf('"dagar":31') !== -1);

// ============================================================
// 18. Svaret till sajten (JSON:en i svarsidan)
// ============================================================
WScript.Echo('\n18. Svaret till sajten');
var posted = postText({ action: 'slot', token: ownerToken, datum: D5, tid: T5, status: SLOT_BUSY, req: 'r7-1' });
check('svaret markerar ratt anrop',
  posted.indexOf('"req":"r7-1"') !== -1 && posted.indexOf('"type":"slot"') !== -1, posted);
check('svaret har jhfix-flaggan', posted.indexOf('"jhfix":true') !== -1, posted);
check('markeringen syns i svaret',
  posted.indexOf('"ok":true') !== -1 && posted.indexOf('"bokade":["' + T5 + '"]') !== -1, posted);
check('dagens tider foljer med i svaret',
  posted.indexOf('"slots":[') !== -1 && posted.indexOf('"taken":[') !== -1, posted);
check('en oppnad extratid svarar ok',
  postText({ action: 'slot', token: ownerToken, datum: D5, tid: '07:00', status: SLOT_FREE, req: 'r7-2' })
    .indexOf('"ok":true') !== -1);
check('Auto svarar ok',
  postText({ action: 'slot', token: ownerToken, datum: D5, tid: '07:00', status: SLOT_AUTO, req: 'r7-3' })
    .indexOf('"ok":true') !== -1);
check('okand atgard svaras med fel', postText({ action: 'nagot-annat' }).indexOf('"ok":false') !== -1);

// ============================================================
// 19. Den delade cachen for de offentliga tiderna
// ============================================================
WScript.Echo('\n19. Delad cache for de offentliga tiderna');
var D7 = isoInDays(20), T7 = validTimeFor(D7);

var cacheA = doGet({ parameter: { action: 'availability', from: D7, dagar: '1', callback: 'cb' } }).getContent();
check('forsta hamtningen raknas fram', cacheA.indexOf('"taken":[]') !== -1, cacheA);

/* En rad som skrivs direkt i kalkylarket (utanfor serverns egna vagar) ska
   inte synas forran cachen har gatt ut – det ar just det som gor cachen snabb
   for besokarna. */
var raderForeCachen = getSheet_().getLastRow();
addPending('C000000009', 'tokc9', D7, T7);
check('raden skrevs direkt i kalkylarket', getSheet_().getLastRow() === raderForeCachen + 1,
  'rader i arket: ' + getSheet_().getLastRow());

var cacheB = doGet({ parameter: { action: 'availability', from: D7, dagar: '1', callback: 'cb' } }).getContent();
check('svaret kommer fran cachen', cacheB.indexOf('"taken":[]') !== -1, cacheB);

/* En riktig skrivning hojer versionsstampeln, och da galler inte cachen
   langre: besokarna ser markeringen direkt. */
var versionBefore = rangeVersion_();
setSlot_({ token: ownerToken, datum: D7, tid: '07:00', status: SLOT_BUSY });
check('en skrivning hojer versionsstampeln', rangeVersion_() !== versionBefore);

var cacheC = doGet({ parameter: { action: 'availability', from: D7, dagar: '1', callback: 'cb' } }).getContent();
check('en markering syns direkt trots cachen', cacheC.indexOf('"07:00"') !== -1, cacheC);
check('cachen lamnar aldrig ut kundnamn', cacheC.indexOf('Test Testsson') === -1, cacheC);

/* En dag som bara agaren far se cachas inte alls. */
var cacheDetails = dayAvailabilityCached_(D7, true);
check('agarens dagbild cachas inte',
  typeof cacheDetails.bookings !== 'undefined' && typeof cacheDetails.marks !== 'undefined');

// ============================================================
// 20. Samma forfragan tva ganger (sajtens automatiska nya forsok)
// ============================================================
WScript.Echo('\n20. Samma forfragan tva ganger');
var D8 = isoInDays(21), T8 = validTimeFor(D8);
var douple = { namn: 'Doris Dubbel', telefon: '070-555 66 77', epost: 'doris@example.com' };
var rowsBefore = getRows_().length;

var firstTry = handleBooking_(baseBooking(D8, T8, douple));
check('forsta forfragan bokas', firstTry.ok === true, JSON.stringify(firstTry));

var secondTry = handleBooking_(baseBooking(D8, T8, douple));
check('andra forsoket kvitteras i stallet for att bokas om',
  secondTry.ok === true && secondTry.id === firstTry.id, JSON.stringify(secondTry));
check('ingen dubblett skapades', getRows_().length === rowsBefore + 1,
  'nya rader: ' + (getRows_().length - rowsBefore));

var annan = handleBooking_(baseBooking(D8, T8, { namn: 'Olle Olsson', telefon: '070-555 66 78', epost: 'olle@example.com' }));
check('en annan person pa samma tid nekas anda',
  annan.ok === false && annan.message.indexOf('redan bokad') !== -1, JSON.stringify(annan));
check('en nekad forfragan lamnar inga rader efter sig', getRows_().length === rowsBefore + 1);

// ============================================================
// 21. Varmhallningen av webbappen
// ============================================================
WScript.Echo('\n21. Varmhallningen av webbappen');
var warm = varmhallAppen();
check('varmhallAppen svarar ok', warm.ok === true, JSON.stringify(warm));
check('varmhallAppen ror inte kalkylarket', getSheet_().getLastRow() === getRows_().length + 1,
  'rader i arket: ' + getSheet_().getLastRow());
check('installeraVarmhallning finns', typeof installeraVarmhallning === 'function');

// ============================================================
// 22. Anropet fran sajten (formularets falt + action=book)
// ============================================================
WScript.Echo('\n22. Anropet fran sajten');
var D9 = isoInDays(23), T9 = validTimeFor(D9);

/* Exakt det som skickades fran sajten: formularets falt, men ingen
   action-parameter – svaret blev da "Okand atgard." och bokningen nadde aldrig
   fram. Servern ska kanna igen en sadan forfragan pa innehållet. */
var utanAction = baseBooking(D9, T9);
delete utanAction.action;
var svarUtanAction = postText(utanAction);
check('utan action men med bokningsfalt behandlas den som en bokning',
  svarUtanAction.indexOf('Ok\u00e4nd \u00e5tg\u00e4rd') === -1 &&
  svarUtanAction.indexOf('"ok":true') !== -1, svarUtanAction);
check('bokningen sparades anda', bookedTimes_(D9).indexOf(T9) !== -1);

var svarOkand = postText({ action: 'nagot-helt-annat' });
check('okand atgard markeras som systemfel (system:true)',
  svarOkand.indexOf('"system":true') !== -1, svarOkand);
check('ett rent skrapanrop blir inte en bokning',
  doPost({ parameter: { skrapa: '1' } }).getContent().indexOf('Ok\u00e4nd \u00e5tg\u00e4rd') !== -1);

// ============================================================
// 23. Godkann och neka i agarpanelels lista (action=decision)
// ============================================================
WScript.Echo('\n23. Agarpanelels godkann och neka');
function countEmailsTo(addr) {
  var n = 0;
  for (var i = 0; i < EMAILS.length; i++) if (EMAILS[i].to === addr) n++;
  return n;
}

var D10 = isoInDays(25), T10 = validTimeFor(D10);
var r10 = handleBooking_(baseBooking(D10, T10, { namn: 'Petra Vantar', epost: 'petra@example.com' }));
var id10 = r10.id;
check('en vantande forfragan finns', r10.ok === true && findBooking_(id10).status === 'V\u00e4ntar',
  JSON.stringify(r10));

/* Id:t foljer med i agarens dagbild, sa att panelen vet vilken bokning
   knapparna hor till – men aldrig i det publika svaret. */
var info10 = doGet({ parameter: { action: 'dayinfo', datum: D10, token: ownerToken, callback: 'cb' } }).getContent();
check('dagbilden innehaller bokningens id', info10.indexOf('"id":"' + id10 + '"') !== -1, info10);
check('dagbilden visar att forfragan vantar', info10.indexOf('"status":"V\u00e4ntar"') !== -1, info10);
var gast10 = guestDay(D10);
check('gastsvaret innehaller varken id eller namn',
  gast10.indexOf(id10) === -1 && gast10.indexOf('Petra') === -1, gast10);

/* Bara ett inloggat agarkonto far svara pa en forfragan. */
check('utan inloggning nekas beslutet',
  postText({ action: 'decision', id: id10, svar: 'ja' }).indexOf('"ok":false') !== -1);
check('personalen far inte svara',
  postText({ action: 'decision', token: staffLogin.token, id: id10, svar: 'ja' }).indexOf('"ok":false') !== -1);
check('okant svar nekas',
  postText({ action: 'decision', token: ownerToken, id: id10, svar: 'kanske' }).indexOf('"ok":false') !== -1);
check('utan id nekas beslutet',
  postText({ action: 'decision', token: ownerToken, svar: 'ja' }).indexOf('"ok":false') !== -1);
check('okant id nekas',
  postText({ action: 'decision', token: ownerToken, id: 'finns-inte', svar: 'ja' }).indexOf('"ok":false') !== -1);
check('ingen av de nekade forfragningarna beslutades', findBooking_(id10).status === 'V\u00e4ntar');

/* Riktigt beslut: godkann. */
var beslutJa = postText({ action: 'decision', token: ownerToken, id: id10, svar: 'ja', req: 'r9-1' });
check('godkannandet svarar ok', beslutJa.indexOf('"ok":true') !== -1, beslutJa);
check('godkannandet markerar anropet',
  beslutJa.indexOf('"req":"r9-1"') !== -1 && beslutJa.indexOf('"type":"decision"') !== -1, beslutJa);
check('status = Bekraftad', findBooking_(id10).status === 'Bekr\u00e4ftad');
check('kunden fick ett bekraftelsemejl', lastEmailTo('petra@example.com') !== null);
check('svaret sager att forfragan ar godkand', beslutJa.indexOf('godk\u00e4nd') !== -1, beslutJa);
check('svaret klagar inte pa mejlet', beslutJa.indexOf('kunde inte skickas') === -1, beslutJa);
check('svaret innehaller hela dagens lage',
  beslutJa.indexOf('"day":{"datum":"' + D10 + '"') !== -1 && beslutJa.indexOf('"bookings":[') !== -1, beslutJa);
check('den godkanda tiden ar last i dagens lage',
  beslutJa.indexOf('"taken":["' + T10 + '"]') !== -1 &&
  beslutJa.indexOf('"status":"Bekr\u00e4ftad"') !== -1, beslutJa);
check('tiden ar upptagen for besokarna', bookedTimes_(D10).indexOf(T10) !== -1);

/* Samma beslut en gang till: servern svarar att den redan ar hanterad, utan att
   skicka ett nytt mejl och utan att kalla det ett systemfel (sajten ska visa
   beskedet rakt upp och ner). */
var mejlFore = countEmailsTo('petra@example.com');
var beslutIgen = postText({ action: 'decision', token: ownerToken, id: id10, svar: 'ja' });
check('en redan hanterad forfragan nekas', beslutIgen.indexOf('"ok":false') !== -1, beslutIgen);
check('beskedet sager att den redan ar godkand', beslutIgen.indexOf('redan godk\u00e4nd') !== -1, beslutIgen);
check('inga nya vantar skapades', beslutIgen.indexOf('"ok":true') === -1, beslutIgen);
check('ett vanligt besked ar inte ett systemfel', beslutIgen.indexOf('"system":true') === -1, beslutIgen);
check('inget nytt mejl skickades till kunden', countEmailsTo('petra@example.com') === mejlFore);

/* Tva forfragningar pa samma tid: den andra kan inte godkannas. */
var D11 = isoInDays(26), T11 = validTimeFor(D11);
addPending('C000000021', 'tokc21', D11, T11);
addPending('C000000022', 'tokc22', D11, T11);
var forsta11 = postText({ action: 'decision', token: ownerToken, id: 'C000000021', svar: 'ja' });
check('den forsta pa tiden godkanns', forsta11.indexOf('"ok":true') !== -1, forsta11);
var andra11 = postText({ action: 'decision', token: ownerToken, id: 'C000000022', svar: 'ja' });
check('den andra stoppas av konflikten',
  andra11.indexOf('"ok":false') !== -1 && andra11.indexOf('redan bekr\u00e4ftad') !== -1, andra11);
check('den andra ar kvar som vantande', findBooking_('C000000022').status === 'V\u00e4ntar');

/* Neka i stallet: tiden blir ledig igen, men bara for den nekade forfragan. */
var neka11 = postText({ action: 'decision', token: ownerToken, id: 'C000000022', svar: 'nej' });
check('nekandet svarar ok', neka11.indexOf('"ok":true') !== -1, neka11);
check('status = Avslagen', findBooking_('C000000022').status === 'Avslagen');
check('svaret sager att forfragan ar nekad', neka11.indexOf('nekad') !== -1, neka11);
check('hela dagen foljer med i svaret', neka11.indexOf('"day":{"datum":"' + D11 + '"') !== -1, neka11);
check('kunden i den nekade forfragan har fatt ett mejl', lastEmailTo('test@example.com') !== null);
check('den godkanda bokningen ligger kvar pa tiden', bookedTimes_(D11).indexOf(T11) !== -1);

/* Mejlets lankar: de svenska orden, token i t och ett annat ord an 1 for att
   bekrafta ska ocksa fungera – ett e-postprogram kan skriva om adressen. */
var D12 = isoInDays(27), T12 = validTimeFor(D12);
var r12 = handleBooking_(baseBooking(D12, T12, { namn: 'Gustav Godkann', epost: 'gustav@example.com' }));
var id12 = r12.id, token12 = tokenFor(id12);
var sida12 = doGet({ parameter: { action: 'godkann', id: id12, t: token12 } }).getContent();
check('godkann-sidan visas med svensk lank', sida12.indexOf('Godk\u00e4nn bokningen') !== -1, sida12);
check('status ar kvar som vantande', findBooking_(id12).status === 'V\u00e4ntar');
doGet({ parameter: { action: 'godkann', id: id12, t: token12, klart: '1' } });
check('godkannandet genomfordes med svensk lank', findBooking_(id12).status === 'Bekr\u00e4ftad');
var sida13 = doGet({ parameter: { action: 'NEKA', id: id12, token: token12 } }).getContent();
check('stora bokstaver i atgarden fungerar', sida13.indexOf('Neka f\u00f6rfr\u00e5gan') !== -1, sida13);
var sida14 = doGet({ parameter: { action: 'decline', id: id12, t: token12 } }).getContent();
check('token i t fungerar aven har', sida14.indexOf('Ogiltig l\u00e4nk') === -1, sida14);

/* Utan id: anropet kan peka ut forfragan med datum + tid i stallet. Det ar reserv-
   vagen for ett svar som hamtades innan agarpaneelen fick id:n med sig. */
var D13 = isoInDays(28), T13 = validTimeFor(D13);
var r13 = handleBooking_(baseBooking(D13, T13, { namn: 'Nils Utan Id', epost: 'nils@example.com' }));
var id13 = r13.id;
check('en vantande forfragan utan id finns', findBooking_(id13).status === 'V\u00e4ntar');

check('okant datum + tid nekas',
  postText({ action: 'decision', token: ownerToken, datum: isoInDays(40), tid: T13, svar: 'ja' }).indexOf('"ok":false') !== -1);
check('datum utan tid nekas',
  postText({ action: 'decision', token: ownerToken, datum: D13, svar: 'ja' }).indexOf('"ok":false') !== -1);
check('fel tid nekas',
  postText({ action: 'decision', token: ownerToken, datum: D13, tid: '03:00', svar: 'ja' }).indexOf('"ok":false') !== -1);
check('ingen av de nekade forfragningarna beslutades', findBooking_(id13).status === 'V\u00e4ntar');

var beslut13 = postText({ action: 'decision', token: ownerToken, datum: D13, tid: T13, svar: 'ja' });
check('godkannandet utan id svarar ok', beslut13.indexOf('"ok":true') !== -1, beslut13);
check('ratt forfragan godkandes utan id', findBooking_(id13).status === 'Bekr\u00e4ftad');
check('svaret namner kunden', beslut13.indexOf('Nils Utan Id') !== -1, beslut13);
check('hela dagen foljer med aven utan id', beslut13.indexOf('"day":{"datum":"' + D13 + '"') !== -1, beslut13);
check('tiden ar upptagen for besokarna aven utan id', bookedTimes_(D13).indexOf(T13) !== -1);
check('kunden fick ett bekraftelsemejl aven utan id', lastEmailTo('nils@example.com') !== null);

/* En redan hanterad forfragan kan inte beslutas igen via datum + tid. */
var mejlNils = countEmailsTo('nils@example.com');
var igen13 = postText({ action: 'decision', token: ownerToken, datum: D13, tid: T13, svar: 'ja' });
check('en hanterad forfragan nekas aven via datum + tid',
  igen13.indexOf('"ok":false') !== -1 && igen13.indexOf('redan godk\u00e4nd') !== -1, igen13);
check('en hanterad forfragan ar inte ett systemfel', igen13.indexOf('"system":true') === -1, igen13);
check('inget nytt mejl gick ut', countEmailsTo('nils@example.com') === mejlNils);

/* Neka utan id: en annan vantande forfragan pa en egen tid blir ledig igen. */
var D15 = isoInDays(30), T15 = validTimeFor(D15);
var r15 = handleBooking_(baseBooking(D15, T15, { namn: 'Nora Nekas', epost: 'nora@example.com' }));
var neka15 = postText({ action: 'decision', token: ownerToken, datum: D15, tid: T15, svar: 'nej' });
check('nekandet utan id svarar ok', neka15.indexOf('"ok":true') !== -1, neka15);
check('status = Avslagen aven utan id', findBooking_(r15.id).status === 'Avslagen');
check('svaret sager att forfragan ar nekad', neka15.indexOf('nekad') !== -1, neka15);
check('tiden ar ledig igen for besokarna', bookedTimes_(D15).indexOf(T15) === -1);
check('kunden i den nekade forfragan har fatt ett mejl', lastEmailTo('nora@example.com') !== null);

/* Tva forfragningar pa samma tid: namnet i anropet pekar ut ratt en, sa att
   panelen inte kan godkanna fel kund. */
function addPendingNamed(id, token, datum, tid, namn) {
  getSheet_().appendRow([id, token, nowStamp_(), 'V\u00e4ntar', namn, '070-000 00 00',
    'test@example.com', 5, 'Villa', '', 'Solna', datum, tid, 350, '', '']);
}

var D14 = isoInDays(29), T14 = validTimeFor(D14);
addPendingNamed('C000000031', 'tokc31', D14, T14, 'Forsta Vantaren');
addPendingNamed('C000000032', 'tokc32', D14, T14, 'Andra Vantaren');
/* De tva raderna skrevs direkt i kalkylarket, sa testets lasning maste goras om. */
forget_('rows');
check('utan namn valjs den forsta vantande',
  findBookingOnSlot_(D14, T14, '', true).id === 'C000000031');
check('namnet valjer ratt forfragan',
  findBookingOnSlot_(D14, T14, 'Andra Vantaren', true).id === 'C000000032');

var val14 = postText({ action: 'decision', token: ownerToken, datum: D14, tid: T14, namn: 'Andra Vantaren', svar: 'ja' });
check('godkannandet traffar ratt kund', val14.indexOf('"ok":true') !== -1 &&
  val14.indexOf('Andra Vantaren') !== -1, val14);
check('den valda forfragan ar godkand', findBooking_('C000000032').status === 'Bekr\u00e4ftad');
check('den andra ar kvar som vantande', findBooking_('C000000031').status === 'V\u00e4ntar');

WScript.Echo('\n== ' + PASS + ' godkanda, ' + FAIL + ' misslyckade ==');
if (FAIL > 0) WScript.Quit(1);


