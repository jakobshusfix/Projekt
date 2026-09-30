/* ==========================================================================
   Jakobs HusFix – main.js
   Hanterar navigation, serviceområdeskontroll och bokningsformulär.
   ========================================================================== */
(function () {
  "use strict";

  /* ----------------------------------------------------------------------
     0. BOKNINGS-API OCH KONTAKTVÄGAR
     Adressen till Google Apps Script-webbappen. Är den tom (inte inkopplad
     ännu) skickas bokningsförfrågan i stället som ett färdigifyllt mejl till
     COMPANY_EMAIL, så att den alltid hamnar i mejlen.
     ---------------------------------------------------------------------- */
  var APP_CONFIG = window.JAKOBS_HUSFIX_CONFIG || {};
  var BOOKING_API_URL = String(APP_CONFIG.bookingApiUrl || "").trim();
  var COMPANY_EMAIL = String(APP_CONFIG.companyEmail || "jakobshusfix@gmail.com").trim();
  var COMPANY_PHONE = String(APP_CONFIG.companyPhone || "46793584957").replace(/[^0-9]/g, "");
  var COMPANY_PHONE_DISPLAY = String(APP_CONFIG.companyPhoneDisplay || "079-358 49 57");

  /* Feltexterna är skrivna till besökaren, inte till utvecklaren: de säger vad
     som händer och vad man kan göra i stället. Den tekniska förklaringen
     (publiceringen, /exec-adressen och sådant) hamnar i konsolen, dit bara den
     som felsöker tittar. Så står det aldrig något obegripligt på sajten. */
  var hintLogged = false;

  function logHint(detail) {
    if (hintLogged) return;
    hintLogged = true;
    try {
      if (window.console && window.console.warn) console.warn("[Jakobs HusFix] " + detail);
    } catch (err) { /* konsolen finns inte – inget att göra */ }
  }

  /* Adressen till webbappen saknas i index.html. */
  function serverMissingText() {
    logHint("bookingApiUrl saknas i index.html. Klistra in webbappens /exec-adress " +
      "och ladda upp filen igen (se google-apps-script/README.md, steg 4).");
    return "Bokningssystemet är inte inkopplat just nu. Ring " + COMPANY_PHONE_DISPLAY +
      " så hjälper vi dig direkt.";
  }

  /* Anropet kom fram men svaret uteblev. Nästan alltid en kallstart hos Google
     (webbappen startar om efter en stund utan besök) eller ett tillfälligt fel
     – sajten gör därför ett nytt försök av sig själv. */
  function serverBusyText() {
    logHint("Bokningsservern svarade inte. Kontrollera att webbappen är publicerad med " +
      "åtkomsten \"Anyone\", att bookingApiUrl slutar på /exec och att den senaste " +
      "versionen är utlagd (se google-apps-script/README.md).");
    return "Bokningssystemet svarar inte just nu – vi försöker igen automatiskt. " +
      "Vill du inte vänta: ring " + COMPANY_PHONE_DISPLAY + ".";
  }

  /* ----------------------------------------------------------------------
     1. SERVICEOMRÅDE
     Företagets kärnområde är Norrort – med Sollentuna och Häggvik i spetsen –
     men uppdrag tas även i närliggande delar av Stockholm. Kunden anger sin
     ort eller sitt postnummer – båda kontrolleras mot listorna nedan.
     ---------------------------------------------------------------------- */

  var SERVICE_AREAS = [
    { name: "Sollentuna",   aliases: ["tureberg", "sollentuna centrum"], postal: ["191", "192"] },
    { name: "Edsberg",      aliases: [],        postal: ["192"] },
    { name: "Helenelund",   aliases: [],        postal: ["192"] },
    { name: "Häggvik",      aliases: [],        postal: ["192"] },
    { name: "Norrviken",    aliases: [],        postal: ["192"] },
    { name: "Rotebro",      aliases: [],        postal: ["192"] },
    { name: "Ulriksdal",    aliases: ["ulriksdal, solna"], postal: ["170"] },
    { name: "Bergshamra",   aliases: [],        postal: ["170"] },
    { name: "Solna",        aliases: ["solna strand", "hagalund", "rasunda"], postal: ["169", "170", "171"] },
    { name: "Sundbyberg",   aliases: ["ursvik", "hallonbergen", "dyrby"], postal: ["172", "174"] },
    { name: "Kista",        aliases: [],        postal: ["164"] },
    { name: "Akalla",       aliases: [],        postal: ["164"] },
    { name: "Husby",        aliases: [],        postal: ["164"] },
    { name: "Rinkeby",      aliases: [],        postal: ["163"] },
    { name: "Tensta",       aliases: [],        postal: ["163"] },
    { name: "Hjulsta",      aliases: [],        postal: ["163"] },
    { name: "Spånga",       aliases: ["spanga", "bromsten"], postal: ["163", "165"] },
    { name: "Vällingby",    aliases: ["vallingby", "racksta", "blackeberg"], postal: ["162"] },
    { name: "Hässelby",     aliases: ["hasselby"], postal: ["165"] },
    { name: "Danderyd",     aliases: ["djursholm", "stocksund", "enebyberg"], postal: ["182"] },
    { name: "Täby",         aliases: ["taby", "nasbypark", "gribbylund"], postal: ["183", "187"] },
    { name: "Vallentuna",   aliases: [],        postal: ["186"] },
    { name: "Upplands Väsby", aliases: ["upplands vasby"], postal: ["194"] }
  ];

  var ALLOWED_POSTAL_PREFIXES = [
    "191", "192",          /* Sollentuna */
    "163", "164", "165",   /* Spånga, Kista, Tensta, Hässelby */
    "162",                 /* Vällingby */
    "169", "170", "171",   /* Solna, Bergshamra, Ulriksdal */
    "172", "174",          /* Sundbyberg */
    "182",                 /* Danderyd */
    "183", "187",          /* Täby */
    "186",                 /* Vallentuna */
    "194"                  /* Upplands Väsby */
  ];

  /* Ta bort å/ä/ö, versaler och extra tecken så jämförelsen blir tolerant. */
  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* Plocka fram ett 5-siffrigt postnummer ur t.ex. "191 40" eller "19140". */
  function extractPostal(value) {
    var digitsOnly = String(value || "").replace(/[^0-9]/g, "");
    var match = digitsOnly.match(/\d{5}/);
    if (match) return match[0];
    if (digitsOnly.length === 5) return digitsOnly;
    return null;
  }

  /* Snabb uppslagslista med normaliserade ortsnamn. */
  var AREA_INDEX = [];
  SERVICE_AREAS.forEach(function (area) {
    [area.name].concat(area.aliases || []).forEach(function (key) {
      var norm = normalize(key);
      if (norm) AREA_INDEX.push({ key: norm, label: area.name });
    });
  });

  function startsWith(text, prefix) {
    return text.slice(0, prefix.length) === prefix;
  }

  /* Sant om needle förekommer som ett helt ord i haystack. */
  function containsWord(haystack, needle) {
    return (" " + haystack + " ").indexOf(" " + needle + " ") !== -1;
  }

  /* Matchar fritext mot kända ortsnamn.
     - "Häggvik, Sollentuna" innehåller ortnamnet "Häggvik" (delsträng).
     - "Kist" och "Soln" är prefix av kända orter.
     Ordet måste dock matchas på ordgräns så att t.ex. "malm" inte
     av misstag matchas mot "norrmalm". */
  function matchAreaName(input) {
    var norm = normalize(input);
    if (!norm) return null;

    for (var i = 0; i < AREA_INDEX.length; i++) {
      if (AREA_INDEX[i].key === norm) return AREA_INDEX[i].label;
    }

    for (var j = 0; j < AREA_INDEX.length; j++) {
      var key = AREA_INDEX[j].key;
      if (key.length >= 4 && norm.indexOf(key) !== -1) return AREA_INDEX[j].label;
    }

    if (norm.length >= 4) {
      for (var k = 0; k < AREA_INDEX.length; k++) {
        var areaKey = AREA_INDEX[k].key;
        if (startsWith(areaKey, norm) || containsWord(areaKey, norm)) {
          return AREA_INDEX[k].label;
        }
      }
    }
    return null;
  }

  /* Avgör om en ort/ett postnummer ligger inom serviceområdet. */
  function checkServiceArea(raw) {
    if (!raw || !String(raw).trim()) {
      return { ok: false, empty: true, message: "Fyll i var du bor." };
    }

    var postal = extractPostal(raw);
    if (postal) {
      var prefix = postal.slice(0, 3);
      if (ALLOWED_POSTAL_PREFIXES.indexOf(prefix) !== -1) {
        return { ok: true, matched: "postnummer " + postal, message: "" };
      }
      return {
        ok: false,
        matched: null,
        message: "Tyvärr – postnummer " + postal + " ligger utanför vårt område. " +
                 "Norrort är vårt kärnområde, men vi kör även i närliggande delar av Stockholm."
      };
    }

    var areaLabel = matchAreaName(raw);
    if (areaLabel) {
      return { ok: true, matched: areaLabel, message: "" };
    }

    return {
      ok: false,
      matched: null,
      message: "Tyvärr – vi känner inte igen \u201d" + String(raw).trim() + "\u201d i vårt serviceområde. " +
               "Vi utgår från Norrort och kör inte för långt bort."
    };
  }

  window.HusFixArea = {
    areas: SERVICE_AREAS,
    check: checkServiceArea
  };

  /* ----------------------------------------------------------------------
     2. GRÄNSSNITT VID START
     Fyller datalist, områdeschips, årtal och mobilmeny.
     ---------------------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", function () {

    /* Datumfältet får inte ligga i det förflutna. */
    var datumInput = document.getElementById("datum");
    if (datumInput) {
      var today = new Date();
      var yyyy = today.getFullYear();
      var mm = String(today.getMonth() + 1).padStart(2, "0");
      var dd = String(today.getDate()).padStart(2, "0");
      datumInput.min = yyyy + "-" + mm + "-" + dd;
    }

    /* ------------------------------------------------------------------
       BOKNINGSBARA TIDER
       Man kan boka alla dagar, men inom olika tidsramar:
         - måndag–fredag: 15:00–20:00
         - lördag–söndag: 10:00–18:00
       Tiderna byggs om varje gång datumet ändras. Dagens datum går att
       boka ända fram till stängning – men bara de tider som ligger minst
       BOOKING_LEAD_MINUTES framåt i tiden, så att ingen kan boka en tid
       som redan har börjat. Ändra talet här om du vill ha kortare eller
       längre framförhållning.

       OBS: samma regel finns i google-apps-script/Code.gs
       (CONFIG.BOOKING_LEAD_MINUTES) – ändra på båda ställena.
       ------------------------------------------------------------------ */
    var BOOKING_LEAD_MINUTES = 60;
    var tidSelect = document.getElementById("tid");

    /* Tolkar "ÅÅÅÅ-MM-DD" manuellt (ISO-strängar stöds inte överallt). */
    function parseDateValue(value) {
      var parts = String(value || "").split("-");
      if (parts.length !== 3) return null;

      var year = parseInt(parts[0], 10);
      var month = parseInt(parts[1], 10);
      var day = parseInt(parts[2], 10);
      if (!year || !month || !day) return null;

      var date = new Date(year, month - 1, day);
      return isNaN(date.getTime()) ? null : date;
    }

    function timeSlotsForDate(value) {
      var date = parseDateValue(value);
      if (!date) return [];

      var day = date.getDay();                 /* 0 = söndag, 6 = lördag */
      var isWeekend = day === 0 || day === 6;
      var startHour = isWeekend ? 10 : 15;     /* första bokningsbara starttid */
      var endHour = isWeekend ? 18 : 20;       /* stängning – sista starten är en timme innan */

      var slots = [];
      for (var hour = startHour; hour < endHour; hour++) {
        slots.push((hour < 10 ? "0" + hour : String(hour)) + ":00");
      }
      return slots;
    }

    /* Gör om ett Date till "ÅÅÅÅ-MM-DD". */
    function isoDate(date) {
      return date.getFullYear() + "-" +
        String(date.getMonth() + 1).padStart(2, "0") + "-" +
        String(date.getDate()).padStart(2, "0");
    }

    /* Tiderna ovan, men bara de som fortfarande går att boka. Dagens datum
       tappar de tider som redan har passerat (eller ligger närmare i tiden
       än framförhållningen); övriga dagar är oförändrade. */
    function bookableSlotsForDate(value) {
      var date = parseDateValue(value);
      if (!date) return [];

      var earliest = Date.now() + BOOKING_LEAD_MINUTES * 60000;

      return timeSlotsForDate(value).filter(function (slot) {
        var parts = slot.split(":");
        var start = new Date(date.getFullYear(), date.getMonth(), date.getDate(),
                             parseInt(parts[0], 10), parseInt(parts[1], 10));
        return start.getTime() > earliest;
      });
    }

    /* Finns det något kvar att boka den dagen? (Används av datumväljaren.) */
    function hasBookableSlots(date) {
      return bookableSlotsForDate(isoDate(date)).length > 0;
    }

    /* Hur länge ett JSONP-anrop får vänta på svar (ms). En varm webbapp svarar
       på omkring en sekund, men den som möter en webbapp som precis har startat
       kan behöva vänta en halv minut – därför får det allra första försöket en
       generösare tidsgräns, och de följande väntar tills appen är varm. Listan
       ligger kvar under tiden, så besökaren ser inget tomrum. */
    var JSONP_TIMEOUT_MS = 20000;
    var JSONP_FIRST_TIMEOUT_MS = 30000;

    /* Hämtar upptagna tider för ett datum från bokningsservern (JSONP). */
    function jsonpRequest(params, onSuccess, onError, timeoutMs) {
      var cbName = "__jhfix_cb_" + Math.random().toString(36).slice(2) + Date.now();
      var script = document.createElement("script");
      var done = false;
      var limit = timeoutMs || JSONP_TIMEOUT_MS;
      var timer = setTimeout(function () { cleanup(); if (onError) onError(); }, limit);

      function cleanup() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        /* Återkallelsen får inte tas bort direkt: kommer svaret ändå (efter
           tidsgränsen) skulle anropet till en borttagen funktion ge ett
           kryptiskt "Script error." i konsolen. En tom funktion tar emot det
           i stället och städas bort strax efteråt. */
        window[cbName] = function () {};
        window.setTimeout(function () {
          try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
        }, 60000);
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      /* Kommer svaret först efter tidsgränsen har anropet redan gett upp. Då
         får svaret inte göra något alls – annars visar webbläsaren ett kryptiskt
         "Script error." i konsolen, eftersom svaret körs från en annan domän. */
      window[cbName] = function (data) {
        if (done) return;
        cleanup();
        onSuccess(data);
      };

      var query = [];
      Object.keys(params).forEach(function (key) {
        query.push(encodeURIComponent(key) + "=" + encodeURIComponent(params[key]));
      });
      query.push("callback=" + encodeURIComponent(cbName));

      script.src = BOOKING_API_URL +
        (BOOKING_API_URL.indexOf("?") === -1 ? "?" : "&") + query.join("&");
      script.onerror = function () { cleanup(); if (onError) onError(); };
      document.body.appendChild(script);
    }

    /* ----------------------------------------------------------------------
       VARMHÅLLNING AV BOKNINGSSERVERN
       En Google-webbapp som inte har använts på några minuter startas om från
       början, och den första förfrågan till en kall app kan ta en halv minut.
       Sidan skickar därför ett minimalt anrop med jämna mellanrum: action=me
       utan token svarar direkt utan att röra kalkylarket, men startar ändå
       appen. När besökaren sedan trycker på Uppdatera är servern varm och
       svarar på under en sekund. Anropet skickas när sidan är klar, när fliken
       kommer tillbaka i förgrunden och när muspekaren närmar sig Uppdatera –
       men aldrig oftare än WARM_TTL_MS, så att servern inte matas i onödan.
       ---------------------------------------------------------------------- */
    var WARM_TTL_MS = 120000;
    var warmStartedAt = 0;
    var warmBusy = false;

    function warmServer() {
      if (!BOOKING_API_URL || warmBusy) return;
      if (warmStartedAt && Date.now() - warmStartedAt < WARM_TTL_MS) return;

      /* Tiden sätts innan anropet skickas: en kall app kan låta förfrågan rinna
         ut, och det är just den förfrågan som startar appen. Nästa anrop ska
         därför inte skickas direkt efteråt. */
      warmStartedAt = Date.now();
      warmBusy = true;

      jsonpRequest({ action: "me", token: "" }, function () {
        warmBusy = false;
        warmStartedAt = Date.now();
      }, function () {
        warmBusy = false;
      });
    }

    function fetchTakenTimes(dateISO, onDone) {
      jsonpRequest({ action: "availability", datum: dateISO }, function (data) {
        onDone((data && data.taken) ? data.taken : []);
      }, function () {
        /* Nås inte servern visas alla tider – servern kontrollerar ändå vid bokning. */
        onDone([]);
      });
    }

    /* Ritar tidslistan. Är API:t konfigurerat filtreras bokade tider bort. */
    function populateTimeSlots() {
      if (!tidSelect) return;

      var dateISO = datumInput ? datumInput.value : "";
      var daySlots = timeSlotsForDate(dateISO);
      var slots = bookableSlotsForDate(dateISO);
      var previous = tidSelect.value;

      /* Ett val som hör till ett annat datum är inte längre relevant. */
      if (extraPicked && extraPicked.datum !== dateISO) extraPicked = null;

      function render(list, placeholderText) {
        /* Besökaren kan precis ha valt en tid genom att klicka i listan över
           lediga tider, och svaret från servern kan komma strax därefter. Det
           valet får inte skrivas över – och en extratid som ägaren har öppnat
           finns inte bland de ordinarie tiderna, så den läggs tillbaka. */
        var keep = tidSelect.value;
        if (extraPicked && extraPicked.datum === dateISO) {
          keep = extraPicked.tid;
          if (list.indexOf(keep) === -1 && OPEN_HOURS.indexOf(keep) !== -1) {
            list = list.concat([keep]).sort();
          }
        }
        if (list.indexOf(keep) === -1) keep = previous;

        tidSelect.innerHTML = "";
        var placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = placeholderText || "Välj tid";
        tidSelect.appendChild(placeholder);

        list.forEach(function (slot) {
          var option = document.createElement("option");
          option.value = slot;
          option.textContent = slot;
          tidSelect.appendChild(option);
        });

        tidSelect.disabled = list.length === 0;
        tidSelect.value = list.indexOf(keep) !== -1 ? keep : "";
      }

      if (!dateISO || !daySlots.length) { render([], "Välj datum först"); return; }
      /* Dagens tider kan redan ha passerat – då är inget kvar den dagen. */
      if (!slots.length) { render([], "Inga tider kvar – välj ett annat datum"); return; }
      if (!BOOKING_API_URL) { render(slots); return; }

      render([], "Laddar lediga tider\u2026");
      fetchTakenTimes(dateISO, function (taken) {
        if ((datumInput ? datumInput.value : "") !== dateISO) return; /* datum hann ändras */
        var free = slots.filter(function (slot) { return taken.indexOf(slot) === -1; });
        render(free, free.length ? "Välj tid" : "Inga lediga tider");
      });
    }

    if (datumInput) {
      datumInput.addEventListener("change", populateTimeSlots);
      datumInput.addEventListener("input", populateTimeSlots);
    }

    /* Väljer besökaren en annan tid själv gäller den i listan. */
    if (tidSelect) {
      tidSelect.addEventListener("change", function () {
        if (extraPicked && tidSelect.value !== extraPicked.tid) extraPicked = null;
      });
    }

    populateTimeSlots();

    /* Årtal i sidfoten. */
    var yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    /* Förslag till ort-/postnummerfälten (egen lista i stället för datalist). */
    var AREA_SUGGESTIONS = [];
    SERVICE_AREAS.forEach(function (area) {
      AREA_SUGGESTIONS.push(area.name);
      (area.postal || []).forEach(function (code) {
        AREA_SUGGESTIONS.push(area.name + " (" + code + ")");
      });
    });

    function areaMatches(query) {
      var needle = normalize(query);
      var result = [];
      for (var i = 0; i < AREA_SUGGESTIONS.length; i++) {
        if (!needle || normalize(AREA_SUGGESTIONS[i]).indexOf(needle) !== -1) {
          result.push(AREA_SUGGESTIONS[i]);
        }
      }
      return result;
    }

    /* Egen förslagslista där pilen både öppnar OCH stänger listan. */
    function initCombo(wrapId, inputId, listId) {
      var wrap = document.getElementById(wrapId);
      var input = document.getElementById(inputId);
      var list = document.getElementById(listId);
      if (!wrap || !input || !list) return;

      var toggle = wrap.querySelector("[data-combo-toggle]");
      var closeTimer = null;

      function isOpen() { return wrap.classList.contains("open"); }

      function cancelClose() {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      }

      function closeList() {
        cancelClose();
        wrap.classList.remove("open");
        input.setAttribute("aria-expanded", "false");
      }

      function renderList(query) {
        list.innerHTML = "";

        var items = areaMatches(query);
        if (!items.length) {
          var empty = document.createElement("li");
          empty.className = "combo-empty";
          empty.textContent = "Inga träffar";
          list.appendChild(empty);
          return;
        }

        items.forEach(function (item) {
          var li = document.createElement("li");
          li.setAttribute("role", "option");
          li.textContent = item;
          /* Hindra att fältet tappar fokus när man klickar i listan. */
          li.addEventListener("mousedown", function (event) { event.preventDefault(); });
          li.addEventListener("click", function () {
            input.value = item;
            /* Skicka input-händelsen först (så formuläret rensar ev. fel),
               stäng sedan listan så att den inte öppnas igen av lyssnaren. */
            input.dispatchEvent(new Event("input", { bubbles: true }));
            closeList();
            input.focus();
          });
          list.appendChild(li);
        });
      }

      function openList() {
        cancelClose();
        renderList(input.value);
        wrap.classList.add("open");
        input.setAttribute("aria-expanded", "true");
      }

      /* Pilen: öppnar om listan är stängd, stänger om den redan är uppe. */
      if (toggle) {
        toggle.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          if (isOpen()) { closeList(); } else { openList(); }
        });
      }

      input.addEventListener("click", function () {
        if (!isOpen()) openList();
      });

      input.addEventListener("input", function () {
        renderList(input.value);
        wrap.classList.add("open");
        input.setAttribute("aria-expanded", "true");
      });

      input.addEventListener("keydown", function (event) {
        if (event.key === "Escape" || event.key === "Enter") closeList();
      });

      input.addEventListener("blur", function () {
        /* Liten fördröjning så att klick i listan hinner registreras. */
        cancelClose();
        closeTimer = setTimeout(function () { closeTimer = null; closeList(); }, 150);
      });

      /* Stäng när man klickar utanför fältet. */
      document.addEventListener("click", function (event) {
        if (!wrap.contains(event.target)) closeList();
      });
    }

    initCombo("areaQuickCombo", "areaQuick", "areaQuickList");
    initCombo("omradeCombo", "omradeInput", "omradeList");

    /* ------------------------------------------------------------------
       EGEN RULLISTA FÖR <select>
       Ersätter webbläsarens inbyggda pil och ruta så att de ser ut precis
       som ort-fältets pil och förslagsruta. Den riktiga <select> ligger
       kvar (dolt) i formuläret, så inlämning och validering fungerar som förut.
       ------------------------------------------------------------------ */
    function initSelectCombo(comboId) {
      var wrap = document.getElementById(comboId);
      if (!wrap) return;

      var select = wrap.querySelector("select");
      var display = wrap.querySelector("[data-combo-display]");
      var valueEl = wrap.querySelector("[data-combo-value]");
      var list = wrap.querySelector(".combo-list");
      var toggle = wrap.querySelector("[data-combo-toggle]");
      if (!select || !display || !list) return;

      function items() {
        return Array.prototype.slice.call(list.querySelectorAll('[role="option"]'));
      }

      function isOpen() { return wrap.classList.contains("open"); }

      /* Speglar <select> i det synliga fältet och i listan. */
      function syncDisplay() {
        var chosen = select.options[select.selectedIndex];
        if (valueEl) valueEl.textContent = chosen ? chosen.textContent : "";
        display.disabled = select.disabled;
        wrap.classList.toggle("is-empty", !chosen || chosen.value === "");
        wrap.classList.toggle("is-disabled", select.disabled);
      }

      function setActive(el) {
        items().forEach(function (opt) { opt.classList.remove("is-active"); });
        if (el) {
          el.classList.add("is-active");
          display.setAttribute("aria-activedescendant", el.id);
        } else {
          display.removeAttribute("aria-activedescendant");
        }
      }

      function renderList() {
        list.innerHTML = "";
        var current = select.value;

        Array.prototype.forEach.call(select.options, function (option, index) {
          if (option.value === "") return;   /* "Välj tid" visas bara i fältet */

          var li = document.createElement("li");
          li.id = comboId + "-opt-" + index;
          li.setAttribute("role", "option");
          li.setAttribute("data-index", String(index));
          li.textContent = option.textContent;
          if (option.value === current) {
            li.classList.add("is-selected");
            li.setAttribute("aria-selected", "true");
          } else {
            li.setAttribute("aria-selected", "false");
          }
          li.addEventListener("mousedown", function (event) { event.preventDefault(); });
          li.addEventListener("click", function () { choose(option.value); });
          list.appendChild(li);
        });
      }

      function choose(value) {
        select.value = value;
        /* Skicka händelserna så att formuläret rensar ev. felmarkering. */
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        syncDisplay();
        closeList();
        display.focus();
      }

      function openList() {
        if (select.disabled) return;
        renderList();
        wrap.classList.add("open");
        display.setAttribute("aria-expanded", "true");
        setActive(list.querySelector(".is-selected") || items()[0] || null);
      }

      function closeList() {
        wrap.classList.remove("open");
        display.setAttribute("aria-expanded", "false");
        setActive(null);
      }

      function moveActive(step) {
        var all = items();
        if (!all.length) return;
        var current = all.indexOf(list.querySelector(".is-active"));
        if (current === -1) current = step > 0 ? -1 : 0;
        setActive(all[Math.min(all.length - 1, Math.max(0, current + step))]);
      }

      display.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (isOpen()) { closeList(); } else { openList(); }
      });

      /* Pilen: får samma hover-markering som ort-fältets pil och öppnar/stänger. */
      if (toggle) {
        toggle.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          if (isOpen()) { closeList(); } else { openList(); }
        });
      }

      display.addEventListener("keydown", function (event) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (!isOpen()) openList();
          moveActive(event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Escape") {
          if (isOpen()) { event.stopPropagation(); closeList(); }
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!isOpen()) { openList(); return; }
          var active = list.querySelector(".is-active");
          if (active) { active.click(); }
        }
      });

      document.addEventListener("click", function (event) {
        if (!wrap.contains(event.target)) closeList();
      });

      /* Håll fältet i takt med <select>: nya tider, disabled-läge och reset. */
      if (window.MutationObserver) {
        new MutationObserver(function () {
          syncDisplay();
          if (isOpen()) renderList();
        }).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
      }
      if (select.form) {
        select.form.addEventListener("reset", function () {
          setTimeout(function () { syncDisplay(); closeList(); }, 0);
        });
      }

      syncDisplay();
    }

    initSelectCombo("fastighetCombo");
    initSelectCombo("tidCombo");

    /* ------------------------------------------------------------------
       EGEN DATUMVÄLJARE
       Ersätter webbläsarens inbyggda kalender (som inte går att styla).
       ------------------------------------------------------------------ */
    var MANADER = ["januari", "februari", "mars", "april", "maj", "juni",
                   "juli", "augusti", "september", "oktober", "november", "december"];
    var VECKODAGAR = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

    function initDatePicker() {
      var wrap = document.getElementById("datumCombo");
      var input = document.getElementById("datum");
      var panel = document.getElementById("datumKalender");
      if (!wrap || !input || !panel) return;

      var toggle = wrap.querySelector("[data-combo-toggle]");
      var view = null;       /* månaden som visas */
      var selected = null;   /* valt datum */

      function today() {
        var d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
      }

      function isSameDay(a, b) {
        return a && b && a.getFullYear() === b.getFullYear() &&
               a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
      }

      function isOpen() { return wrap.classList.contains("open"); }

      function closePanel() {
        wrap.classList.remove("open");
        input.setAttribute("aria-expanded", "false");
      }

      function openPanel() {
        view = null;
        render();
        wrap.classList.add("open");
        input.setAttribute("aria-expanded", "true");
      }

      function render() {
        var min = today();
        if (!view) {
          var base = selected || min;
          view = { year: base.getFullYear(), month: base.getMonth() };
        }

        var firstDay = new Date(view.year, view.month, 1);
        var offset = (firstDay.getDay() + 6) % 7;          /* måndag först */
        var daysInMonth = new Date(view.year, view.month + 1, 0).getDate();

        var chevronPrev = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(90deg)"><path d="M6 9l6 6 6-6" /></svg>';
        var chevronNext = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(-90deg)"><path d="M6 9l6 6 6-6" /></svg>';
        var html = '<div class="dp-head">' +
          '<button type="button" class="dp-nav" data-dp="prev" aria-label="Föregående månad">' + chevronPrev + "</button>" +
          '<span class="dp-title">' + MANADER[view.month] + " " + view.year + "</span>" +
          '<button type="button" class="dp-nav" data-dp="next" aria-label="Nästa månad">' + chevronNext + "</button>" +
          "</div>";

        html += '<div class="dp-weekdays">';
        VECKODAGAR.forEach(function (namn) { html += "<span>" + namn + "</span>"; });
        html += "</div>";

        html += '<div class="dp-grid">';
        for (var i = 0; i < offset; i++) html += '<span class="dp-blank"></span>';
        for (var day = 1; day <= daysInMonth; day++) {
          var date = new Date(view.year, view.month, day);
          /* Dagar där alla tider redan passerat (t.ex. idag efter stängning)
             går inte att välja – de skulle ändå vara tomma. */
          var disabled = date < min || !hasBookableSlots(date);
          var cls = "dp-day" + (disabled ? " is-disabled" : "") +
                    (isSameDay(date, selected) ? " is-selected" : "");
          html += '<button type="button" class="' + cls + '" data-day="' + day + '"' +
                  (disabled ? " disabled" : "") + ">" + day + "</button>";
        }
        html += "</div>";

        panel.innerHTML = html;

        var prev = panel.querySelector('[data-dp="prev"]');
        var next = panel.querySelector('[data-dp="next"]');
        prev.disabled = (view.year === min.getFullYear() && view.month === min.getMonth());
        /* stopPropagation: annars hinner knappen kopplas bort av render() innan
           dokumentets "klicka utanför"-kontroll, som då stänger panelen. */
        prev.addEventListener("click", function (event) {
          event.stopPropagation();
          shift(-1);
        });
        next.addEventListener("click", function (event) {
          event.stopPropagation();
          shift(1);
        });

        Array.prototype.forEach.call(panel.querySelectorAll("[data-day]"), function (btn) {
          btn.addEventListener("click", function (event) {
            event.stopPropagation();
            select(new Date(view.year, view.month, parseInt(btn.getAttribute("data-day"), 10)));
          });
        });
      }

      function shift(step) {
        var month = view.month + step;
        view = {
          year: view.year + Math.floor(month / 12),
          month: ((month % 12) + 12) % 12
        };
        render();
      }

      function select(date) {
        selected = date;
        input.value = isoDate(date);
        closePanel();
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }

      if (toggle) {
        toggle.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          if (isOpen()) { closePanel(); } else { openPanel(); }
        });
      }

      input.addEventListener("click", function () {
        if (!isOpen()) openPanel();
      });

      input.addEventListener("keydown", function (event) {
        if (event.key === "Escape" || event.key === "Enter") closePanel();
      });

      document.addEventListener("click", function (event) {
        if (!wrap.contains(event.target)) closePanel();
      });

      if (input.form) {
        input.form.addEventListener("reset", function () {
          selected = null;
          view = null;
        });
      }
    }

    initDatePicker();

    /* ------------------------------------------------------------------
       NÄSTA LEDIGA TID (kortet i hero-sektionen)
       Texten räknas fram ur exakt samma tider som formuläret använder,
       så att kortet aldrig lovar något annat än det som går att boka.
       Är bokningsservern inkopplad frågas den dessutom vilka tider som
       redan är tagna. Utan JavaScript visas öppettiderna i stället.
       ------------------------------------------------------------------ */
    var DAGAR = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
    var NEXT_AVAILABLE_DAYS = 14;   /* så många dagar framåt vi letar */

    function initNextAvailable() {
      var textEl = document.querySelector("[data-next-available]");
      var labelEl = document.querySelector("[data-next-available-label]");
      if (!textEl) return;

      var midnight = new Date();
      midnight.setHours(0, 0, 0, 0);

      function dayAt(offset) {
        return new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() + offset);
      }

      /* "Idag kl 16:00", "Imorgon kl 15:00" eller "Lördag kl 10:00". */
      function describe(date, slot) {
        var offset = Math.round((date.getTime() - midnight.getTime()) / 86400000);
        if (offset === 0) return "Idag kl " + slot;
        if (offset === 1) return "Imorgon kl " + slot;
        var namn = DAGAR[date.getDay()];
        return namn.charAt(0).toUpperCase() + namn.slice(1) + " kl " + slot;
      }

      function show(date, slot) {
        textEl.textContent = describe(date, slot);
        if (labelEl) labelEl.textContent = "Nästa lediga tid";
      }

      function search(offset) {
        if (offset > NEXT_AVAILABLE_DAYS) {
          textEl.textContent = "Fullbokat just nu – ring oss";
          return;
        }

        var date = dayAt(offset);
        var slots = bookableSlotsForDate(isoDate(date));
        if (!slots.length) { search(offset + 1); return; }

        /* Utan bokningsserver känner vi bara till öppettiderna. */
        if (!BOOKING_API_URL) { show(date, slots[0]); return; }

        fetchTakenTimes(isoDate(date), function (taken) {
          var free = slots.filter(function (slot) { return taken.indexOf(slot) === -1; });
          if (free.length) { show(date, free[0]); } else { search(offset + 1); }
        });
      }

      search(0);
    }

    initNextAvailable();

    /* Klickbara chips i serviceområdes-sektionen. */
    var areaList = document.getElementById("areaList");
    if (areaList) {
      SERVICE_AREAS.forEach(function (area) {
        var li = document.createElement("li");
        li.textContent = area.name;
        areaList.appendChild(li);
      });
    }

    /* Mobilmeny. */
    var navToggle = document.getElementById("navToggle");
    var primaryNav = document.getElementById("primaryNav");
    if (navToggle && primaryNav) {
      navToggle.addEventListener("click", function () {
        var isOpen = primaryNav.classList.toggle("open");
        navToggle.setAttribute("aria-expanded", String(isOpen));
      });
      primaryNav.addEventListener("click", function (event) {
        if (event.target.tagName === "A") {
          primaryNav.classList.remove("open");
          navToggle.setAttribute("aria-expanded", "false");
        }
      });
    }

    /* ------------------------------------------------------------------
       3. SNABBKOLL AV OMRÅDE (serviceområdes-sektionen)
       ------------------------------------------------------------------ */
    var quickInput = document.getElementById("areaQuick");
    var quickBtn = document.getElementById("areaQuickBtn");
    var quickResult = document.getElementById("areaQuickResult");

    function renderQuickResult() {
      if (!quickInput || !quickResult) return;
      var result = checkServiceArea(quickInput.value);

      quickResult.classList.remove("ok", "fail");
      if (result.ok) {
        quickResult.classList.add("ok");
        quickResult.textContent = "\u2713 Ja! Vi putsar fönster hos dig (" + result.matched + "). Boka tid nedan.";
      } else {
        quickResult.classList.add("fail");
        quickResult.textContent = result.empty ? "Fyll i din ort eller ditt postnummer." : result.message;
      }
    }

    if (quickBtn) quickBtn.addEventListener("click", renderQuickResult);
    if (quickInput) {
      quickInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          renderQuickResult();
        }
      });
    }

    /* ------------------------------------------------------------------
       4. LEDIGA TIDER, KONTO OCH ÄGARPANEL
       Alla besökare – även gäster utan konto – ser de kommande två veckornas
       lediga och bokade tider. Är bokningsservern inkopplad hämtas tiderna
       därifrån, annars visas ordinarie öppettider. Loggar ägarkontot in
       (rollen ROLE_OWNER i Code.gs) låses fliken "Ägare" upp och Jakob kan
       markera tider som bokade eller lediga för alla. Själva reglerna ligger
       i google-apps-script/Code.gs – här visas bara resultatet.
       ------------------------------------------------------------------ */
    var LEDIGA_DAGAR = 14;          /* så många dagar visar listan */
    /* Hur ofta listan uppdaterar sig själv medan den syns i vyn. Ett svar från
       en varm server tar omkring en sekund, och servern svarar dessutom från en
       delad cache (se rangeCache_ i Code.gs), så en trekvart är både snabbt och
       billigt. */
    var LEDIGA_REFRESH_MS = 45000;

    /* Hur länge sajten väntar innan den försöker igen efter ett misslyckat
       anrop. Korta väntetider först – en kallstart är oftast över på några
       sekunder – och sedan längre, men aldrig längre än att listan hänger med. */
    var RANGE_RETRY_MS = [3000, 6000, 12000, 20000, 30000];
    var SESSION_KEY = "jhfix_session";
    var OPEN_HOURS = [];            /* 07:00–21:00 – samma timmar som Code.gs */

    for (var openHour = 7; openHour < 22; openHour++) {
      OPEN_HOURS.push((openHour < 10 ? "0" : "") + openHour + ":00");
    }

    /* Inloggningen sparas lokalt, så att en omladdning av sidan inte loggar ut
       ägaren. Token går ut av sig själv efter 12 timmar i bokningssystemet. */
    function readSession() {
      try {
        var raw = window.localStorage ? window.localStorage.getItem(SESSION_KEY) : null;
        var saved = raw ? JSON.parse(raw) : null;
        return (saved && saved.token) ? saved : null;
      } catch (err) {
        return null;
      }
    }

    function writeSession(value) {
      try {
        if (!window.localStorage) return;
        if (value) window.localStorage.setItem(SESSION_KEY, JSON.stringify(value));
        else window.localStorage.removeItem(SESSION_KEY);
      } catch (err) { /* Privat läge utan lagring – inloggningen gäller då bara i fliken. */ }
    }

    /* Dagens datum + offset som "ÅÅÅÅ-MM-DD". */
    function isoOffset(offset) {
      var now = new Date();
      return isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
    }

    /* Klockslaget som HH:MM (används i statusraderna). */
    function clockNow() {
      var now = new Date();
      return (now.getHours() < 10 ? "0" : "") + now.getHours() + ":" +
        (now.getMinutes() < 10 ? "0" : "") + now.getMinutes();
    }

    /* ------------------------------------------------------------------
       SENASTE SVARET FRÅN BOKNINGSSERVERN
       Listan över lediga och bokade tider sparas i webbläsaren. Kommer
       besökaren tillbaka – eller laddar om sidan – ritas tiderna upp direkt,
       även om webbappen hos Google precis då startar om (kallstart) och
       behöver en stund på sig. Sedan uppdateras listan mot servern i
       bakgrunden, och raden under listan säger från vilket klockslag tiderna
       kommer. Cachen kastas så snart den inte längre börjar på dagens datum.
       ------------------------------------------------------------------ */
    var RANGE_CACHE_KEY = "jhfix_range_v1";

    function readRangeCache() {
      try {
        var raw = window.localStorage ? window.localStorage.getItem(RANGE_CACHE_KEY) : null;
        var saved = raw ? JSON.parse(raw) : null;
        if (!saved || !saved.days || !saved.stamp) return null;

        /* Datumen flyttar sig: en lista som börjar på ett annat datum än idag
           är för gammal och kastas. */
        if (saved.from !== isoOffset(0)) return null;
        return saved;
      } catch (err) {
        return null;
      }
    }

    function writeRangeCache(days) {
      try {
        if (!window.localStorage || !days) return;
        window.localStorage.setItem(RANGE_CACHE_KEY, JSON.stringify({
          from: isoOffset(0),
          at: Date.now(),
          stamp: clockNow(),
          days: days
        }));
      } catch (err) { /* Privat läge utan lagring: cachen är bara en genväg. */ }
    }

    /* Sätts av initSlotBoard, så att bokningsformuläret kan be listan om nya
       tider direkt efter en skickad förfrågan. */
    var refreshSlotBoard = function () {};

    /* "Idag – torsdag 1 oktober", "Imorgon – …" respektive "Fredag 3 oktober". */
    function slotDayName(iso) {
      var date = parseDateValue(iso);
      if (!date) return iso;

      var text = DAGAR[date.getDay()] + " " + date.getDate() + " " + MANADER[date.getMonth()];
      if (iso === isoOffset(0)) return "Idag \u2013 " + text;
      if (iso === isoOffset(1)) return "Imorgon \u2013 " + text;
      return text.charAt(0).toUpperCase() + text.slice(1);
    }

    /* Kort datum till dagknapparna i ägarpanelen: "Tor 1/10". */
    function slotDayShort(iso) {
      var date = parseDateValue(iso);
      if (!date) return iso;
      return DAGAR[date.getDay()].slice(0, 3) + " " +
        date.getDate() + "/" + (date.getMonth() + 1);
    }

    /* Kundnamn och tider skrivs in i HTML – därför escapas allt som kommer
       från servern, även om bokningssystemet redan har städat det. */
    function escapeText(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    /* Läser skrolläget på ett sätt som fungerar i alla webbläsare. */
    function readScroll() {
      return window.scrollY || document.documentElement.scrollTop || 0;
    }

    /* Kör fn i nästa bildruta – men bara om bildrutan kommer direkt. Blir
       webbläsaren fördröjd (tung sida, flik i bakgrunden, långsam enhet) är
       mätvärdet man utgick från gammalt, och en "återställning" av skrolläget
       skulle då flytta sidan till en plats besökaren lämnade för länge sedan. */
    function shortly(fn, maxAgeMs) {
      var at = Date.now();

      window.requestAnimationFrame(function () {
        if (Date.now() - at > (maxAgeMs || 250)) return;
        fn();
      });
    }

    /* Sätter tillbaka skrolläget utan mjuk scrollning. Mjuk rullning vore
       fel här: besökaren ska inte se att sidan "rättar sig". */
    function writeScroll(y) {
      var root = document.documentElement;
      var previous = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo(0, y);
      root.style.scrollBehavior = previous;
    }

    /* Byter ut innehållet i en lista utan att sidan hoppar. Webbläsarens
       skrollankare kan nämligen flytta skrolläget när en stor del av sidan
       byts ut på en gång (listan över lediga tider ritas om varje minut), och
       då far besökaren uppåt utan att ha rört något. Vi tar vara på läget och
       ställer tillbaka det om webbläsaren har rört sig – direkt, och en
       bildruta senare om ankaret rättar sig först då. */
    function replaceHtml(el, html) {
      if (!el) return;

      var before = readScroll();
      el.innerHTML = html;

      if (Math.abs(readScroll() - before) > 1) writeScroll(before);

      shortly(function () {
        if (Math.abs(readScroll() - before) > 1) writeScroll(before);
      });
    }

    /* ------------------------------------------------------------------
       POST TILL BOKNINGSSYSTEMET
       Inloggning och ägarens markeringar skickas med fetch(), precis som
       bokningsformuläret (se sendBookingRequest). Varje anrop märks med req,
       så att svaret kan paras ihop med rätt klick.

       Varför inte ett dolt formulär i en iframe? Googles svar på en webbapp
       har X-Frame-Options: SAMEORIGIN och CSP frame-ancestors 'self', så
       webbläsaren visar aldrig svarsidan i en iframe på vår egen domän – då
       kommer inget svar alls. fetch() får däremot läsa svaret, eftersom
       webbappen svarar med Access-Control-Allow-Origin: *.
       ------------------------------------------------------------------ */
    var slotRequests = {};
    var slotReqCounter = 0;

    /* Plockar ut svarsobjektet ur sidan som bokningssystemet skickar tillbaka.
       Servern lägger JSON:en i ett postMessage-anrop (se sinkHtml_ i Code.gs),
       t.ex. window.parent.postMessage({"ok":true,…},"*"). Klammerräknaren
       hoppar över citattecken, så att en klammer inuti en text – till exempel
       i ett kundmeddelande – inte förstör tolkningen. */
    function parseServerReply(text) {
      if (!text) return null;

      var start = text.indexOf("postMessage(");
      if (start === -1) {
        /* Skulle servern någon gång svara med ren JSON går det också bra. */
        try { return JSON.parse(text); } catch (err) { return null; }
      }

      start = text.indexOf("{", start);
      if (start === -1) return null;

      var depth = 0;
      var inText = false;
      var escaped = false;

      for (var i = start; i < text.length; i++) {
        var ch = text.charAt(i);

        if (inText) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') inText = false;
          continue;
        }

        if (ch === '"') { inText = true; continue; }
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(text.slice(start, i + 1)); } catch (err) { return null; }
          }
        }
      }

      return null;
    }

    /* Formulärfält och parametrar som "namn=Anna&telefon=0701234567". */
    function encodeFields(fields) {
      return Object.keys(fields).map(function (key) {
        return encodeURIComponent(key) + "=" +
          encodeURIComponent(fields[key] == null ? "" : fields[key]);
      }).join("&");
    }

    /* Skickar uppgifterna till bokningssystemet och ger svaret till onDone.
       Anropet är en vanlig formulärpost (application/x-www-form-urlencoded),
       vilket webbläsaren skickar utan förkoll – den har alltså inget emot att
       svaret kommer från en annan domän. failText är texten som visas om
       servern inte svarar alls (besökaren får en vänligare text än ägaren). */
    /* Hur länge ett svar får vänta (ms) per försök, och hur många försök som
       görs innan besökaren får ett besked. En webbapp som precis har startat
       kan ta en halv minut på sig; då är ett nytt försök strax efteråt mycket
       snabbare, eftersom appen nu är varm. onRetry (frivillig) används för att
       berätta i gränssnittet att ett nytt försök pågår. */
    var POST_TIMEOUT_MS = 20000;
    var POST_ATTEMPTS = 2;
    var POST_RETRY_WAIT_MS = 1200;

    function sendToServer(body, onDone, failText, onRetry) {
      if (!BOOKING_API_URL) {
        onDone({ ok: false, message: serverMissingText() });
        return;
      }

      var failure = { ok: false, system: true, message: failText || serverBusyText() };
      var attempt = 0;

      /* Ett nytt försök när svaret uteblev. Det är säkert för alla anrop sajten
         skickar: servern känner igen en bokningsförfrågan som redan har kommit
         in med samma namn, telefon och e-post (se handleBooking_ i Code.gs) och
         kvitterar den i stället för att skapa en dubblett. */
      function retryOrGiveUp() {
        attempt++;
        if (attempt >= POST_ATTEMPTS) { onDone(failure); return; }

        /* Första försöket startade webbappen; det här möter en varm server. */
        if (onRetry) onRetry();
        window.setTimeout(tryOnce, POST_RETRY_WAIT_MS);
      }

      function tryOnce() {
        var contentType = "application/x-www-form-urlencoded;charset=UTF-8";
        var timer = 0;
        var done = false;

        /* Utan svar inom POST_TIMEOUT_MS ska knappen inte stå och snurra för
           evigt. result = null betyder "inget användbart svar". */
        function finish(result) {
          if (done) return;
          done = true;
          if (timer) window.clearTimeout(timer);
          if (result) { onDone(result); return; }
          retryOrGiveUp();
        }

        timer = window.setTimeout(function () { finish(null); }, POST_TIMEOUT_MS);

        if (typeof window.fetch === "function") {
          window.fetch(BOOKING_API_URL, {
            method: "POST",
            headers: { "Content-Type": contentType },
            body: body,
            redirect: "follow"
          }).then(function (response) {
            return response.text();
          }).then(function (text) {
            /* Går svaret inte att läsa är det lika illa som att servern tiger. */
            finish(parseServerReply(text));
          })["catch"](function () { finish(null); });
          return;
        }

        /* Reserv för äldre webbläsare utan fetch. */
        try {
          var request = new XMLHttpRequest();
          request.open("POST", BOOKING_API_URL, true);
          request.setRequestHeader("Content-Type", contentType);
          request.onload = function () { finish(parseServerReply(request.responseText)); };
          request.onerror = function () { finish(null); };
          request.send(body);
        } catch (err) {
          finish(null);
        }
      }

      tryOnce();
    }

    function postToServer(params, onDone, onRetry) {
      /* Ett äldre svar som aldrig kom ska inte kunna skriva över det nya. */
      Object.keys(slotRequests).forEach(function (key) {
        var stale = slotRequests[key];
        delete slotRequests[key];
        stale(null);
      });

      var req = "r" + (++slotReqCounter) + "-" + Date.now();
      slotRequests[req] = onDone;

      var fields = {};
      Object.keys(params).forEach(function (key) { fields[key] = params[key]; });
      fields.req = req;

      sendToServer(encodeFields(fields), function (result) {
        var waiting = slotRequests[req];
        if (!waiting) return;
        delete slotRequests[req];
        waiting(result);
      }, null, onRetry);
    }

    /* Väljer en tid i bokningens tidslista. Den egna komboboxen speglas av en
       MutationObserver i initSelectCombo, så en minimal ändring i listan räcker
       för att fältet ska visa samma tid. */
    function pickTimeInForm(value) {
      if (!tidSelect || !value) return false;

      var found = false;
      Array.prototype.forEach.call(tidSelect.options, function (option) {
        if (option.value === value) found = true;
      });

      /* En extratid som ägaren har öppnat finns inte i den ordinarie listan –
         lägg till den så att bokningen kan skickas med rätt tid. */
      if (!found && OPEN_HOURS.indexOf(value) !== -1) {
        var extra = document.createElement("option");
        extra.value = value;
        extra.textContent = value;
        tidSelect.appendChild(extra);
        found = true;
      }
      if (!found) return false;

      /* Kom ihåg valet så att tidslistan inte tömmer det när svaret från
         servern kommer in strax efter datumbytet. */
      extraPicked = { datum: datumInput ? datumInput.value : "", tid: value };

      tidSelect.value = value;
      var probe = document.createElement("option");
      probe.value = "";
      probe.disabled = true;
      tidSelect.appendChild(probe);
      tidSelect.removeChild(probe);
      tidSelect.dispatchEvent(new Event("input", { bubbles: true }));
      tidSelect.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    /* Delarna i en panel får en liten förskjutning i tiden, så att listan
       kommer in som en våg i stället för allt på en gång. CSS läser värdet i
       animation-delay: var(--stagger). Bara den panel som visas nu får det –
       en bakgrundsuppdatering ska inte sätta fart på något. */
    function staggerItems(panel) {
      var groups = panel.querySelectorAll(".slot-days, .owner-days, .owner-hours");

      Array.prototype.forEach.call(groups, function (group) {
        Array.prototype.forEach.call(group.children, function (child, index) {
          child.style.setProperty("--stagger", Math.min(index, 16) * 24 + "ms");
        });
      });
    }

    /* Låter en lista som precis har fyllts tona in som en våg – används första
       gången listan får sitt innehåll. En bakgrundsuppdatering rör sig inte:
       då ligger raderna redan där. Returnerar false om listan sitter i en dold
       flik, för då finns inget att visa. */
    function sweepIn(container) {
      if (!container || container.closest("[hidden]")) return false;

      Array.prototype.forEach.call(container.children, function (child, index) {
        child.style.setProperty("--stagger", Math.min(index, 16) * 24 + "ms");
      });

      container.classList.remove("is-enter");
      void container.offsetWidth; /* startar om animationen */
      container.classList.add("is-enter");

      container.addEventListener("animationend", function handler(event) {
        if (event.target !== container) return;
        container.classList.remove("is-enter");
        container.removeEventListener("animationend", handler);
      });

      return true;
    }

    /* Flikarna i sektionen. Returnerar funktionen som visar en flik, så att
       ägarpanelen kan öppnas direkt efter inloggning. */
    function initSlotTabs() {
      var buttons = document.querySelectorAll("[data-slot-tab]");
      var panels = document.querySelectorAll("[data-slot-panel]");
      if (!buttons.length) return null;

      function visibleButtons() {
        var out = [];
        Array.prototype.forEach.call(buttons, function (button) {
          if (!button.hidden) out.push(button);
        });
        return out;
      }

      /* Visar en flik. Den nya panelen tonar in med en liten glidning och
         tiderna kommer in en efter en, så att bytet syns – särskilt steget
         från kontot till ägarpanelen, där knapparna annars bara plötsligt
         står där. Den gamla panelen försvinner direkt; en utgående animation
         hade bara gjort bytet långsammare. */
      function show(name) {
        Array.prototype.forEach.call(buttons, function (button) {
          var active = button.getAttribute("data-slot-tab") === name;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-selected", active ? "true" : "false");
          button.tabIndex = active ? 0 : -1;
        });

        /* Panelerna är olika höga: byter man från den långa tidslistan till det
           korta inloggningskortet kan webbläsaren flytta vyn för att behålla
           sitt ankare, och då ser det ut som att sidan av sig själv far upp
           till toppen. Vi står kvar där vi stod. */
        var before = readScroll();

        Array.prototype.forEach.call(panels, function (panel) {
          var active = panel.getAttribute("data-slot-panel") === name;
          panel.hidden = !active;
          panel.classList.remove("is-enter");
          if (!active) return;

          staggerItems(panel);

          /* Klassen sätts i nästa bildruta, så att webbläsaren hinner se att
             panelen var dold – annars hoppar den över intoningen. */
          window.requestAnimationFrame(function () {
            if (!panel.hidden) panel.classList.add("is-enter");
          });
        });

        if (Math.abs(readScroll() - before) > 1) writeScroll(before);
        shortly(function () {
          if (Math.abs(readScroll() - before) > 1) writeScroll(before);
        });
      }

      Array.prototype.forEach.call(buttons, function (button) {
        button.addEventListener("click", function () {
          show(button.getAttribute("data-slot-tab"));
        });

        /* Vänster-/högerpil flyttar mellan flikarna, som i en vanlig tabbmeny. */
        button.addEventListener("keydown", function (event) {
          var step = event.key === "ArrowRight" ? 1 : (event.key === "ArrowLeft" ? -1 : 0);
          if (!step) return;

          event.preventDefault();
          var list = visibleButtons();
          var index = list.indexOf(button);
          if (index === -1) return;

          var next = list[(index + step + list.length) % list.length];
          show(next.getAttribute("data-slot-tab"));
          next.focus();
        });
      });

      show("tider");
      return show;
    }

    function initSlotBoard() {
      var daysEl = document.getElementById("slotDays");
      if (!daysEl) return;

      var updatedEl = document.getElementById("slotUpdated");
      var ageEl = document.getElementById("slotAge");
      var dotEl = document.getElementById("slotDot");
      var refreshBtn = document.getElementById("slotRefresh");
      var refreshLabel = refreshBtn ? refreshBtn.querySelector(".slot-refresh-label") : null;
      var ownerTab = document.getElementById("tabAgare");
      var loginForm = document.getElementById("loginForm");
      var loginUser = document.getElementById("loginUser");
      var loginPass = document.getElementById("loginPass");
      var loginBtn = document.getElementById("loginBtn");
      var logoutBtn = document.getElementById("logoutBtn");
      var accountOut = document.getElementById("accountOut");
      var ownerLogout = document.getElementById("ownerLogout");
      var loginMessage = document.getElementById("loginMessage");
      var accountTitle = document.getElementById("accountTitle");
      var accountLead = document.getElementById("accountLead");
      var ownerDaysEl = document.getElementById("ownerDays");
      var ownerLabelEl = document.getElementById("ownerDayLabel");
      var ownerHoursEl = document.getElementById("ownerHours");
      var ownerMessage = document.getElementById("ownerMsg");
      var ownerBookingsEl = document.getElementById("ownerBookings");
      var ownerBusyDay = document.getElementById("ownerBusyDay");
      var ownerResetDay = document.getElementById("ownerResetDay");
      var ownerReload = document.getElementById("ownerReload");
      var ownerReloadLabel = ownerReload ? ownerReload.textContent : "Uppdatera";

      var showPanel = initSlotTabs() || function () {};
      var session = readSession();
      var days = null;      /* svaret från availabilityRange_ i Code.gs */
      var ownerPick = null; /* valt datum i ägarpanelen */
      var ownerDay = null;  /* vald dag med kundnamn (dayinfo eller sparat svar) */

      var rangeToken = 0;        /* bara det senaste svaret över lediga tider får ritas */
      var rangeBusy = false;     /* ett anrop är redan på väg */
      var rangeStartedAt = 0;    /* när anropet som är på väg skickades */
      var manualAsked = false;   /* har besökaren tryckt på Uppdatera? */
      var daysFromServer = false;/* har vi någonsin fått ett riktigt svar? */
      var lastGood = "";         /* klockslaget för det senaste riktiga svaret */
      var savingClock = null;    /* tiden som är på väg till servern */
      var decisionBusy = "";     /* förfrågan som är på väg att godkännas/nekas */
      /* Statusen som betyder "förfrågan väntar på svar" – samma ord som
         STATUS_WAITING i Code.gs. Bara en sådan förfrågan kan godkännas eller
         nekas, och då visas knapparna i listan över kundbokningar. */
      var STATUS_WAITING = "V\u00e4ntar";
      var daysPainted = false;   /* har den allmänna listan fått sitt innehåll? */
      var ownerPainted = false;  /* har ägarpanelens tider fått sitt innehåll? */
      var rangeFails = 0;        /* antal misslyckade hämtningar i rad */
      var rangeRetryTimer = 0;   /* nedräkningen till nästa automatiska försök */
      var rangeVisible = true;   /* syns listan i vyn just nu? */
      var lastGoodAt = 0;        /* när det senaste riktiga svaret kom (ms) */

      /* Kort kvittens under panelen. ok = true (grön), false (röd) eller inget
         värde alls för neutral information. */
      function note(el, text, ok) {
        if (!el) return;
        el.classList.remove("ok", "fail");
        el.textContent = text || "";
        if (text && typeof ok === "boolean") el.classList.add(ok ? "ok" : "fail");
      }

      /* Kvitterar att en hämtning pågår: knappen snurrar, texten byter skepnad
         och knappen stängs av, så att ett klick alltid ger svar direkt. */
      function setRefreshBusy(busy) {
        if (!refreshBtn) return;

        refreshBtn.disabled = busy;
        refreshBtn.classList.toggle("is-busy", busy);
        refreshBtn.setAttribute("aria-busy", busy ? "true" : "false");
        if (refreshLabel) refreshLabel.textContent = busy ? "Uppdaterar…" : "Uppdatera";
      }

      /* Liten kvittens när svaret har kommit: knappen visar "Uppdaterad" en
         kort stund. Ett nytt klick tar över direkt. */
      var refreshDoneTimer = 0;

      function markRefreshDone() {
        if (!refreshBtn || !refreshLabel) return;

        refreshBtn.classList.add("is-done");
        refreshLabel.textContent = "Uppdaterad";

        if (refreshDoneTimer) window.clearTimeout(refreshDoneTimer);
        refreshDoneTimer = window.setTimeout(function () {
          refreshBtn.classList.remove("is-done");
          if (!refreshBtn.classList.contains("is-busy")) refreshLabel.textContent = "Uppdatera";
        }, 1800);
      }

      /* Statusraden ovanför listan läses upp av skärmläsaren (role="status").
         Den skrivs därför bara om när något verkligen har ändrats – eller när
         besökaren själv trycker på Uppdatera. Klockslaget för den senaste
         kontrollen ligger i den tysta raden #slotAge i stället. */
      function setStatus(text, warning, force) {
        if (!updatedEl) return;

        updatedEl.classList.toggle("is-warning", Boolean(warning));
        if (!force && !warning && updatedEl.textContent === text) return;
        updatedEl.textContent = text;
      }

      /* Tyst rad: när listan senast kontrollerades mot bokningsservern, eller
         en vänlig förklaring medan servern startar. */
      function setAge(text, hint) {
        if (!ageEl) return;

        ageEl.classList.toggle("is-hint", Boolean(hint));
        if (ageEl.textContent === text) return;
        ageEl.textContent = text;
      }

      /* Pricken i statusraden: "live" när svaret är färskt, "sync" medan sajten
         kopplar upp sig igen. Klasserna styr färgen (css/components.css) och
         pulsen (css/effects.css). */
      function setLink(state) {
        if (!dotEl) return;
        dotEl.classList.toggle("is-live", state === "live");
        dotEl.classList.toggle("is-sync", state === "sync");
      }

      /* ---------- lediga och bokade tider ---------- */

      /* Listan är två veckor framåt. Grönt = går att boka, rött = upptaget
         (kundbokning eller Jakobs egen "Bokad"-markering). Gäster ser bara
         tiderna – aldrig vem som har bokat.

         Listan ritas bara om där den har ändrats: varje dag får en signatur av
         sina tider, och bara de dagar som byter läge skrivs om. Det går snabbt,
         inget hoppar till – och de tider som bytte läge blinkar till en gång,
         så att en uppdatering syns även när svaret kom på en millisekund. */
      function buildDay(iso) {
        var day = days[iso] || {};
        var slots = day.slots || [];
        var taken = day.taken || [];
        var free = 0;
        var times = "";

        slots.forEach(function (slot) {
          if (taken.indexOf(slot) !== -1) {
            times += '<span class="slot-time slot-time--busy" data-slot-status="busy" ' +
              'title="Redan bokad">' + escapeText(slot) + "</span>";
            return;
          }

          free++;
          times += '<button type="button" class="slot-time slot-time--free" data-slot-status="free" ' +
            'data-slot-book="' + escapeText(iso) + '" data-slot-time="' + escapeText(slot) + '" ' +
            'title="Boka ' + escapeText(slot) + '">' + escapeText(slot) + "</button>";
        });

        var name = slotDayName(iso);
        var count = free ? (free === 1 ? "1 ledig" : free + " lediga") : "Fullbokat";
        var signature = slots.join(",") + "#" + taken.join(",") + "#" + name;
        var inner = '<div class="slot-day-head">' +
            '<h3 class="slot-day-name">' + escapeText(name) + "</h3>" +
            '<span class="slot-day-count">' + count + "</span>" +
          "</div>" +
          (times
            ? '<div class="slot-times">' + times + "</div>"
            : '<p class="slot-empty">Inga tider den här dagen.</p>');

        return {
          free: free,
          signature: signature,
          inner: inner,
          card: '<article class="slot-day' + (iso === isoOffset(0) ? " slot-day--today" : "") +
            '" data-day="' + iso + '" data-signature="' + escapeText(signature) + '">' + inner + "</article>"
        };
      }

      /* Vilket läge varje tid har i ett kort som redan står i listan. Används
         för att se vilka tider som faktiskt ändrades vid en uppdatering. */
      function slotStates(card) {
        var out = {};
        Array.prototype.forEach.call(card.querySelectorAll("[data-slot-status]"), function (el) {
          out[el.textContent] = el.getAttribute("data-slot-status");
        });
        return out;
      }

      /* Tider som bytte läge (ledig ⇄ bokad) blinkar till en gång. */
      function flashChanges(card, before) {
        Array.prototype.forEach.call(card.querySelectorAll("[data-slot-status]"), function (el) {
          var was = before[el.textContent];
          if (!was || was === el.getAttribute("data-slot-status")) return;

          el.classList.add("is-flash");
          window.setTimeout(function () { el.classList.remove("is-flash"); }, 1500);
        });
      }

      function renderDays(userAsked) {
        if (!days) return;

        var isoList = Object.keys(days).sort();
        var cards = Array.prototype.slice.call(daysEl.querySelectorAll(".slot-day"));
        /* Samma dagar i samma ordning? Annars har dygnet bytts ut och hela
           listan ritas om på en gång. */
        var sameList = cards.length === isoList.length;

        if (sameList) {
          for (var i = 0; i < isoList.length; i++) {
            if (cards[i].getAttribute("data-day") !== isoList[i]) { sameList = false; break; }
          }
        }

        var freeTotal = 0;

        if (!sameList) {
          var html = "";

          isoList.forEach(function (iso) {
            var block = buildDay(iso);
            freeTotal += block.free;
            html += block.card;
          });

          replaceHtml(daysEl, html || '<p class="slot-empty">Inga tider att visa just nu.</p>');
          daysEl.classList.remove("is-loading");
          daysEl.removeAttribute("aria-busy");

          /* Första gången listan får sitt innehåll tonar dagarna in en efter en. */
          if (!daysPainted && html && sweepIn(daysEl)) daysPainted = true;
        } else {
          isoList.forEach(function (iso, index) {
            var block = buildDay(iso);
            freeTotal += block.free;

            var card = cards[index];
            if (card.getAttribute("data-signature") === block.signature) return;

            var before = slotStates(card);
            card.setAttribute("data-signature", block.signature);
            replaceHtml(card, block.inner);
            flashChanges(card, before);
          });
        }

        setStatus(freeTotal
          ? (freeTotal === 1 ? "1 ledig tid" : freeTotal + " lediga tider")
          : "Inga lediga tider de närmaste två veckorna", false, Boolean(userAsked));

        /* Klockslaget skrivs av den som hämtade svaret (loadRange) och inte
           här: listan ritas även om när ägaren markerar en tid, och då är
           tiderna inte kontrollerade mot servern på nytt. */

        /* Prickarna på ägarpanelens dagknappar bygger på samma data. */
        renderOwnerDays();
      }

      /* Försöker igen av sig själv. Väntetiden växer för varje misslyckat
         försök men stannar vid en halv minut, och ett svar som lyckas
         nollställer räknaren. Är fliken i bakgrunden väntar vi med anropet –
         då finns ingen som ser listan, och nästa gång fliken öppnas hämtas
         tiderna direkt i stället. */
      function scheduleRetry() {
        if (rangeRetryTimer) return;

        var index = Math.min(Math.max(rangeFails - 1, 0), RANGE_RETRY_MS.length - 1);
        rangeRetryTimer = window.setTimeout(function () {
          rangeRetryTimer = 0;
          if (document.hidden) return;
          loadRange(true);
        }, RANGE_RETRY_MS[index]);
      }

      function clearRetry() {
        if (!rangeRetryTimer) return;
        window.clearTimeout(rangeRetryTimer);
        rangeRetryTimer = 0;
      }

      /* Bokningsservern svarar inte just nu. Listan visar då ordinarie
         öppettider – och raden ovanför säger det, så att ingen tror att
         tiderna är kontrollerade mot bokningarna. Sajten fortsätter att
         försöka i bakgrunden tills svaret kommer, så besökaren behöver inte
         göra något. Tiderna är inte bokade förrän förfrågan är skickad –
         servern kontrollerar alltid en gång till. */
      function renderFallbackDays() {
        var out = {};
        for (var i = 0; i < LEDIGA_DAGAR; i++) {
          var iso = isoOffset(i);
          out[iso] = { datum: iso, slots: bookableSlotsForDate(iso), taken: [] };
        }
        days = out;
        renderDays();

        /* Ingen "uppdaterad kl ..." här: tiderna är inte kontrollerade mot
           bokningarna, och det ska raden säga. */
        setAge(BOOKING_API_URL ? "Uppdaterar automatiskt\u2026" : "", Boolean(BOOKING_API_URL));

        setStatus(BOOKING_API_URL
          ? "Ordinarie öppettider \u2013 de bokade tiderna kontrolleras just nu."
          : "Ordinarie öppettider \u2013 bokningssystemet är inte inkopplat.", true, true);
      }

      /* Hämtar de två veckorna. quiet = tyst bakgrundsuppdatering, manual =
         besökaren tryckte på Uppdatera (då kvitterar knappen och statusraden
         alltid). Det går bara ett anrop åt gången: hinner ett klick in medan
         servern arbetar hänger det på anropet som redan är ute i stället för
         att skicka en ny förfrågan – utom när det har hunnit arbeta en stund,
         för då startas en frisk förfrågan så att svaret inte dröjer.

         Går anropet inte igenom behåller vi det senaste svaret från servern i
         stället för att visa en lista där allt ser ledigt ut – och sajten
         försöker igen av sig själv (se scheduleRetry) tills svaret kommer. Det
         första försöket, som kan träffa en webbapp som precis har startat, får
         dessutom ett nytt försök direkt. */
      function loadRange(quiet, manual) {
        if (!BOOKING_API_URL) { renderFallbackDays(); return; }

        if (manual) { manualAsked = true; setRefreshBusy(true); }

        if (rangeBusy) {
          if (!manual) return;
          /* Nyss startat: låt anropet som är ute svara. Har det redan arbetat
             en stund startar vi om, så att klicket får ett färskt svar. */
          if (Date.now() - rangeStartedAt < 3000) return;
          rangeToken++;
          rangeBusy = false;
        }

        var token = ++rangeToken;
        var round = 0;
        rangeBusy = true;
        rangeStartedAt = Date.now();

        /* Startar bokningsservern? Då får besökaren veta varför det dröjer i
           stället för att tro att knappen har fastnat. Texten ligger i den
           tysta raden, så att skärmläsaren inte avbryts i onödan. Har vi redan
           tider att visa handlar det om en vanlig uppdatering – då räcker det
           att säga det. */
        var hintTimer = window.setTimeout(function () {
          if (token !== rangeToken) return;
          setAge(daysFromServer ? "Uppdaterar\u2026" : "Startar bokningsservern\u2026", true);
        }, 1200);

        function stop(ok) {
          if (token !== rangeToken) return;
          window.clearTimeout(hintTimer);
          rangeBusy = false;

          if (!manualAsked) return;
          manualAsked = false;
          setRefreshBusy(false);
          if (ok) markRefreshDone();
        }

        /* Lyckat svar: tiderna sparas i webbläsaren, pricken blir grön och
           klockslaget skrivs i den tysta raden. */
        function succeeded(data, asked) {
          stop(true);
          rangeFails = 0;
          clearRetry();

          days = data.days;
          daysFromServer = true;
          lastGood = clockNow();
          lastGoodAt = Date.now();
          writeRangeCache(days);

          renderDays(asked);
          setLink("live");
          setAge("Uppdaterad kl " + lastGood, false);
        }

        /* Misslyckat svar: behåll det senaste vi vet och försök igen om en
           stund. Ingen felsökt text till besökaren – raden säger bara hur
           gamla tiderna är. */
        function failed() {
          stop(false);
          rangeFails++;

          if (daysFromServer) {
            setLink("sync");
            setAge("Visar tiderna från kl " + (lastGood || "\u2013") +
              " \u2013 uppdaterar automatiskt\u2026", true);
          } else if (days) {
            setLink("sync");
            setAge("Uppdaterar automatiskt\u2026", true);
          } else {
            renderFallbackDays();
            setLink("sync");
          }

          scheduleRetry();
        }

        function attempt() {
          jsonpRequest({ action: "availability", from: isoOffset(0), dagar: LEDIGA_DAGAR },
            function (data) {
              if (token !== rangeToken) return;

              if (data && data.ok && data.days) {
                succeeded(data, Boolean(manual || manualAsked));
                return;
              }

              failed();
            },
            function () {
              if (token !== rangeToken) return;

              round++;
              /* Kallstart hos Google: den första förfrågan startar webbappen
                 och kan ta en halv minut. En ny förfrågan strax efteråt möter
                 en varm app och svarar då på under en sekund. */
              if (round < 3) {
                setAge("Startar bokningssystemet\u2026", true);
                window.setTimeout(attempt, round === 1 ? 1200 : 2500);
                return;
              }
              failed();
            },
            /* Första försöket får vänta längre än de följande: det är det som
               kan träffa en webbapp som precis har startat. */
            round === 0 ? JSONP_FIRST_TIMEOUT_MS : JSONP_TIMEOUT_MS);
        }

        attempt();
      }

      /* Klick på en ledig tid fyller i bokningsformuläret och tar besökaren dit,
         så att ingen behöver skriva datum och tid för hand. */
      function goToBooking(text) {
        if (statusEl) {
          statusEl.classList.remove("fail");
          statusEl.classList.add("ok");
          statusEl.textContent = text;
        }

        var section = document.getElementById("boka");
        if (section && section.scrollIntoView) {
          section.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }

      function bookInForm(iso, tid) {
        if (!datumInput || !tidSelect) return;

        datumInput.value = iso;
        datumInput.dispatchEvent(new Event("input", { bubbles: true }));
        datumInput.dispatchEvent(new Event("change", { bubbles: true }));

        /* Tidslistan fylls på efterhand som datumet ändras, så vi försöker några
           gånger innan vi ger upp. */
        var tries = 0;

        function attempt() {
          if (pickTimeInForm(tid)) {
            goToBooking("Tiden " + slotDayName(iso) + " kl " + tid +
              " är ifylld \u2013 fyll bara i dina uppgifter.");
            return;
          }

          tries++;
          if (tries >= 6) {
            goToBooking("Välj en tid i listan \u2013 " + tid +
              " kan precis ha blivit bokad av någon annan.");
            return;
          }
          setTimeout(attempt, 350);
        }

        attempt();
      }

      daysEl.addEventListener("click", function (event) {
        var button = event.target.closest ? event.target.closest("[data-slot-book]") : null;
        if (!button) return;
        bookInForm(button.getAttribute("data-slot-book"), button.getAttribute("data-slot-time"));
      });

      if (refreshBtn) {
        /* Knappen hämtar alltid på nytt – men bara ett anrop åt gången (se
           loadRange). Att lägga muspekaren på knappen värmer servern i förväg,
           så att själva klicket oftast svarar på under en sekund. */
        refreshBtn.addEventListener("click", function () { loadRange(false, true); });
        refreshBtn.addEventListener("pointerenter", function () { warmServer(); });
        refreshBtn.addEventListener("focus", function () { warmServer(); });
      }

      /* Håll listan färsk: var 30:e sekund medan den syns i vyn, och varje gång
         fliken får fokus igen. Båda är tysta bakgrundsuppdateringar – de väntar
         om ett anrop redan är på väg, så att bokningsservern aldrig får flera
         samtidiga förfrågningar från samma besökare.

         Är listan nedskrollad eller fliken i bakgrunden hämtas inga tider; då
         skickas i stället ett minimalt varmhållningsanrop då och då, så att
         webbappen inte somnar och nästa blick på listan får svar på under en
         sekund. */
      window.setInterval(function () {
        if (document.hidden) return;
        if (rangeVisible) { loadRange(true); return; }
        warmServer();
      }, LEDIGA_REFRESH_MS);

      document.addEventListener("visibilitychange", function () {
        if (document.hidden) return;

        /* Fliken har varit borta en stund. Anropet nedan startar webbappen om
           den har somnat, så någon särskild varmhållning behövs inte här. */
        clearRetry();
        loadRange(true);
      });

      /* Syns listan i vyn? Är den nedskrollad finns det ingen anledning att
         hämta nya tider – och kommer den tillbaka hämtas de direkt om svaret är
         äldre än en uppdateringsperiod. */
      if (window.IntersectionObserver) {
        new window.IntersectionObserver(function (entries) {
          rangeVisible = Boolean(entries[0] && entries[0].isIntersecting);
          if (!rangeVisible) return;
          if (!lastGoodAt || Date.now() - lastGoodAt > LEDIGA_REFRESH_MS) loadRange(true);
        }, { rootMargin: "150px" }).observe(daysEl);
      }

      /* Nätet är tillbaka: hämta tiderna direkt i stället för att vänta på
         nästa varv. */
      window.addEventListener("online", function () {
        rangeFails = 0;
        clearRetry();
        loadRange(true);
      });

      /* ---------- konto ---------- */

      /* Anpassar panelen efter om någon är inloggad. Fliken Ägare finns bara
         för ägarkontot – personal och gäster ser den inte alls. */
      function setAccount() {
        var loggedIn = Boolean(session && session.token);
        var isOwner = Boolean(session && session.arAgare);

        if (ownerTab) {
          var wasHidden = ownerTab.hidden;
          ownerTab.hidden = !isOwner;

          /* När ägarkontot loggar in lyser fliken till en kort stund, så att
             det syns att den har låsts upp och var den finns. */
          if (isOwner && wasHidden) {
            ownerTab.classList.remove("is-unlocked");
            void ownerTab.offsetWidth; /* startar om animationen */
            ownerTab.classList.add("is-unlocked");
          }
        }
        if (loginForm) loginForm.hidden = loggedIn;
        if (accountOut) accountOut.hidden = !loggedIn;
        if (logoutBtn) logoutBtn.hidden = !loggedIn;
        if (ownerLogout) ownerLogout.hidden = !loggedIn;

        if (accountTitle) accountTitle.textContent = loggedIn ? "Inloggad" : "Logga in";
        if (accountLead) {
          accountLead.textContent = loggedIn
            ? "Du är inloggad som " + (session.namn || session.user) +
              (isOwner
                ? ". Öppna fliken Ägare för att markera lediga och bokade tider."
                : " (personal). Bara ägarkontot kan markera lediga och bokade tider.")
            : "Ägarkontot och personalen loggar in här. Konton skapas av Jakob i " +
              "bokningssystemet \u2013 sajten kan aldrig skapa ett konto åt sig själv.";
        }

        /* Är man inte ägare ska ägarfliken inte stå kvar som vald. */
        if (!isOwner) {
          showPanel("tider");
          ownerPick = null;
        }
      }

      /* Frågar servern om en sparad inloggning fortfarande gäller. */
      function checkSession() {
        if (!session || !BOOKING_API_URL) { setAccount(); return; }

        jsonpRequest({ action: "me", token: session.token },
          function (data) {
            /* Svaret kan komma efter att ägaren har loggat ut: då ska det inte
               återuppliva en inloggning som redan är avslutad. */
            if (!data || !data.ok) {
              if (session) {
                session = null;
                writeSession(null);
              }
            } else if (session) {
              session.arAgare = data.arAgare === true;
              if (data.user) {
                session.user = data.user.anvandarnamn;
                session.namn = data.user.namn;
              }
              writeSession(session);
            }

            setAccount();
            if (session && session.arAgare) loadOwnerDay(isoOffset(0));
          },
          function () { setAccount(); });
      }

      if (loginForm) {
        loginForm.addEventListener("submit", function (event) {
          event.preventDefault();

          var user = loginUser ? loginUser.value.trim() : "";
          var pass = loginPass ? loginPass.value : "";

          if (!user || !pass) {
            note(loginMessage, "Fyll i både användarnamn och lösenord.", false);
            return;
          }

          if (loginBtn) loginBtn.disabled = true;
          note(loginMessage, "Loggar in\u2026", null);

          function retryHint() {
            /* Första försöket startade webbappen; det här möter en varm server. */
            note(loginMessage, "Bokningssystemet startar \u2013 ett nytt f\u00f6rs\u00f6k g\u00f6rs\u2026", null);
          }

          postToServer({ action: "login", anvandare: user, losenord: pass }, function (result) {
            if (loginBtn) loginBtn.disabled = false;

            /* null = ett nyare anrop hann före, då behövs ingen felruta. */
            if (!result) return;

            if (!result.ok) {
              note(loginMessage, result.message || "Kunde inte logga in. Försök igen.", false);
              return;
            }

            session = {
              token: result.token,
              user: result.user ? result.user.anvandarnamn : user,
              namn: result.user ? result.user.namn : user,
              arAgare: result.arAgare === true
            };
            writeSession(session);
            if (loginPass) loginPass.value = "";

            note(loginMessage, result.message || "Inloggad.", true);
            setAccount();

            if (session.arAgare) {
              showPanel("agare");
              loadOwnerDay(isoOffset(0));
            }
          }, retryHint);
        });
      }

      /* Loggar ut. Utloggningen gäller i webbläsaren direkt (token och
         ägarpanel töms), och servern gör sig av med sessionen samtidigt.
         Knappen finns både på kontokortet och i ägarpanelen. */
      function logOut() {
        var token = session ? session.token : "";

        session = null;
        ownerPick = null;
        ownerDay = null;
        savingClock = null;
        decisionBusy = "";
        writeSession(null);

        /* Ägarpanelens innehåll hör till inloggningen och ska inte ligga kvar
           i webbläsaren efteråt. */
        if (ownerDaysEl) replaceHtml(ownerDaysEl, "");
        if (ownerHoursEl) replaceHtml(ownerHoursEl, "");
        if (ownerBookingsEl) replaceHtml(ownerBookingsEl, "");
        if (ownerLabelEl) ownerLabelEl.textContent = "";

        setAccount();

        /* Beskedet står på kontokortet – visa det även om utloggningen gjordes
           inifrån ägarpanelen. */
        showPanel("konto");
        if (loginPass) loginPass.value = "";
        note(loginMessage, "Du är utloggad. Välkommen tillbaka när du vill.", true);

        /* Servern gör sig av med sessionen på riktigt också. Kommer anropet
           inte fram är det ingen fara: token slutar att gälla av sig själv. */
        if (token) postToServer({ action: "logout", token: token }, function () {});
      }

      if (logoutBtn) logoutBtn.addEventListener("click", logOut);
      if (ownerLogout) ownerLogout.addEventListener("click", logOut);

      /* ---------- ägarpanelen ---------- */

      /* Dagknapparna för de två veckorna. En prick betyder att något redan är
         upptaget den dagen. */
      function renderOwnerDays() {
        if (!ownerDaysEl) return;

        var html = "";
        for (var i = 0; i < LEDIGA_DAGAR; i++) {
          var iso = isoOffset(i);
          var day = days ? days[iso] : null;
          var taken = day && day.taken ? day.taken.length : 0;

          html += '<button type="button" class="owner-day-btn' +
            (iso === ownerPick ? " is-active" : "") +
            '" data-owner-day="' + iso + '"' +
            ' title="' + escapeText(slotDayName(iso)) + (taken ? " \u2013 " + taken + " tider upptagna" : "") + '">' +
            escapeText(slotDayShort(iso)) +
            (taken ? '<span class="owner-day-dot" aria-hidden="true"></span>' : "") +
            "</button>";
        }

        replaceHtml(ownerDaysEl, html);
      }

      /* Hämtar en dag med kundnamn. Bara ett inloggat ägarkonto får svaret –
         gäster och personal får den vanliga listan utan namn. quiet = rör inte
         beskedet, så att en kvittens efter ett klick står kvar. */
      function loadOwnerDay(iso, quiet) {
        ownerPick = iso || ownerPick || isoOffset(0);
        renderOwnerDays();

        if (!session || !session.token) return;

        if (!BOOKING_API_URL) {
          note(ownerMessage, serverMissingText(), false);
          return;
        }

        if (!quiet) { note(ownerMessage, "Hämtar dagen\u2026", null); setReloadBusy(true); }

        var ownerAttempt = 0;
        /* Token sparas här. Loggar ägaren ut medan ett försök är på väg ska
           försöket avbrytas i stället för att läsa en inloggning som inte
           finns längre. */
        var ownerToken = session.token;

        function fetchDay() {
          ownerAttempt++;
          if (!session || session.token !== ownerToken) {
            setReloadBusy(false);
            return;
          }

          jsonpRequest({ action: "dayinfo", token: ownerToken, datum: ownerPick },
            function (data) {
              setReloadBusy(false);
              if (!data || !data.ok) {
                note(ownerMessage, (data && data.message) || "Kunde inte hämta dagen.", false);
                return;
              }

              applyDay(data);
              if (!quiet) {
                note(ownerMessage, data.updated ? "Dagens läge uppdaterat " + data.updated : "", null);
              }
            },
            function () {
              /* Webbappen kan ha varit kall (den startar om efter en stund utan
                 besök). Ett nytt försök strax efteråt möter en server som redan
                 är igång – samma tanke som för listan över lediga tider. */
              if (ownerAttempt < 3) {
                if (!quiet) note(ownerMessage, "Startar bokningssystemet\u2026", null);
                window.setTimeout(fetchDay, ownerAttempt === 1 ? 1200 : 2500);
                return;
              }

              setReloadBusy(false);
              note(ownerMessage, serverBusyText(), false);
            },
            /* Första försöket får vänta längre: det kan träffa en webbapp som
               precis har startat. */
            ownerAttempt === 1 ? JSONP_FIRST_TIMEOUT_MS : JSONP_TIMEOUT_MS);
        }

        fetchDay();
      }

      /* Den allmänna listan behöver bara tiderna och de tagna tiderna –
         kundnamnen och Jakobs egna markeringar stannar i ägarpanelen, precis
         som för gäster. */
      function publicDay(day) {
        return {
          datum: day.datum,
          slots: (day.slots || []).slice(),
          taken: (day.taken || []).slice(),
          updated: day.updated
        };
      }

      /* Lägger in ett nytt dagsläge i ägarpanelen och i den allmänna listan,
         så att ägaren ser precis vad besökarna ser. Används både av svaret på
         en hämtning och av svaret när en tid har sparats. */
      function applyDay(day) {
        if (!day || !day.datum) return;

        ownerDay = day;
        if (days) days[day.datum] = publicDay(day);

        renderOwnerDay(day);
        if (days) renderDays();
      }

      /* Alla timmar 07–21 för vald dag. Grön = ledig, röd = tagen. Ett klick
         växlar mellan Bokad och Ledig. En kundbokning är låst – en förfrågan
         som väntar på svar godkänns eller nekas i listan nedan. */
      function renderOwnerDay(day) {
        if (!ownerHoursEl) return;

        var taken = day.taken || [];
        var ordinarie = day.ordinarie || timeSlotsForDate(day.datum);
        /* Tider utanför ordinarie schema som Jakob har öppnat (Ledig-markering). */
        var oppnade = (day.marks && day.marks.lediga) ? day.marks.lediga : [];
        var customer = {};

        (day.bookings || []).forEach(function (booking) { customer[booking.tid] = booking; });

        var html = "";

        OPEN_HOURS.forEach(function (clock) {
          var booking = customer[clock];
          var isTaken = taken.indexOf(clock) !== -1;
          var isExtra = ordinarie.indexOf(clock) === -1;
          var action;
          var title;
          var cls = "owner-hour";
          var sub = "";

          if (booking) {
            cls += " owner-hour--locked";
            action = "locked";

            if (booking.status === STATUS_WAITING) {
              title = "Förfrågan från " + booking.namn + " väntar på svar. Tiden är låst – " +
                "godkänn eller neka den i listan nedan.";
            } else {
              title = "Bokad av " + booking.namn + " (" + booking.status +
                "). En bekräftad tid är låst och kan inte bokas av någon annan.";
            }

            sub = '<small class="owner-hour-name">' + escapeText(booking.namn) + "</small>";
          } else if (isTaken) {
            cls += " owner-hour--busy";
            action = "free";
            title = "Markerad som bokad. Klicka för att göra tiden ledig igen.";
          } else if (isExtra) {
            /* Utanför ordinarie schema. Är tiden öppnad stänger vi den, annars
               öppnar vi den som extratid – båda syns direkt för besökarna. */
            var isOpen = oppnade.indexOf(clock) !== -1;

            cls += " owner-hour--free owner-hour--extra";

            if (isOpen) {
              action = "auto";
              title = "Extratid som du har öppnat. Klicka för att stänga den igen.";
            } else {
              action = "free";
              title = "Utanför ordinarie schema. Klicka för att öppna tiden som extratid.";
            }
          } else {
            cls += " owner-hour--free";
            action = "busy";
            title = "Ledig. Klicka för att markera tiden som bokad.";
          }

          /* Tiden som är på väg till servern pulserar tills svaret kommer. */
          if (savingClock === clock) cls += " is-saving";

          html += '<button type="button" class="' + cls + '"' +
            (action === "locked" ? ' disabled aria-disabled="true"' : "") +
            ' data-owner-slot="' + escapeText(clock) + '" data-owner-action="' + action + '"' +
            ' title="' + escapeText(title) + '">' +
            escapeText(clock) + sub +
            "</button>";
        });

        replaceHtml(ownerHoursEl, html);

        /* Första gången tiderna visas tonar de in en efter en. */
        if (!ownerPainted && sweepIn(ownerHoursEl)) ownerPainted = true;

        if (ownerLabelEl) ownerLabelEl.textContent = slotDayName(day.datum);

        /* Kundbokningar för dagen – bara ägaren ser dem. En förfrågan som
           väntar på svar får knapparna Godkänn och Neka, så att svaret kan ges
           direkt här i stället för i mejlet (samma beslut, se action=decision
           i Code.gs). */
        if (ownerBookingsEl) {
          var rows = "";
          (day.bookings || []).slice().sort(function (a, b) {
            return a.tid < b.tid ? -1 : (a.tid > b.tid ? 1 : 0);
          }).forEach(function (booking) {
            var waiting = booking.status === STATUS_WAITING;
            var bookingId = String(booking.id == null ? "" : booking.id);
            var busy = decisionBusy && decisionBusy === decisionKey(day.datum, booking);
            var buttons = "";

            if (waiting) {
              buttons = '<span class="owner-booking-btns">' +
                '<button type="button" class="btn btn-primary btn-sm"' +
                  ' data-owner-decision="ja"' + (busy ? " disabled" : "") +
                  ' title="Godk\u00e4nn f\u00f6rfr\u00e5gan \u2013 tiden bokas och kunden f\u00e5r ett mejl.">Godk\u00e4nn</button>' +
                '<button type="button" class="btn btn-ghost btn-sm"' +
                  ' data-owner-decision="nej"' + (busy ? " disabled" : "") +
                  ' title="Neka f\u00f6rfr\u00e5gan \u2013 tiden blir ledig igen och kunden f\u00e5r ett mejl.">Neka</button>' +
                "</span>";
            }

            /* Bokningens uppgifter står på raden, så att anropet kan peka ut
               förfrågan även om svaret från servern skulle sakna id (se
               sendDecision). */
            rows += '<li class="owner-booking"' +
              ' data-owner-booking="' + escapeText(bookingId) + '"' +
              ' data-owner-booking-day="' + escapeText(day.datum) + '"' +
              ' data-owner-booking-slot="' + escapeText(booking.tid) + '"' +
              ' data-owner-booking-namn="' + escapeText(booking.namn || "") + '">' +
              '<span class="owner-booking-what"><strong>kl ' + escapeText(booking.tid) + "</strong> " +
                escapeText(booking.namn) + " \u2013 " + escapeText(booking.status) + "</span>" +
              buttons +
              "</li>";
          });

          replaceHtml(ownerBookingsEl, rows || "<li>Ingen kundbokning den här dagen.</li>");
        }
      }

      /* Ritar markeringen direkt medan svaret är på väg. Att vänta på servern
         kändes tidigare som att klicket inte tog: först sparades tiden, sedan
         hämtades hela dagen om och till sist hela tvåveckorslistan. Nu syns
         markeringen på en gång, och serverns svar (som är facit) ritar om
         panelen när det kommer. Reglerna är desamma som i Code.gs. */
      function markLocally(clock, status) {
        if (!ownerDay || ownerDay.datum !== ownerPick) return;

        var isExtra = timeSlotsForDate(ownerPick).indexOf(clock) === -1;
        var marks = ownerDay.marks || (ownerDay.marks = { bokade: [], lediga: [] });

        if (!marks.bokade) marks.bokade = [];
        if (!marks.lediga) marks.lediga = [];

        function toggle(list, on) {
          var index = list.indexOf(clock);
          if (on && index === -1) { list.push(clock); list.sort(); }
          if (!on && index !== -1) list.splice(index, 1);
        }

        if (status === "Bokad") {
          toggle(ownerDay.taken, true);
          toggle(marks.bokade, true);
          toggle(marks.lediga, false);
        } else {
          toggle(ownerDay.taken, false);
          toggle(marks.bokade, false);

          /* Ledig: en extratid utanför schemat öppnas. Auto: markeringen tas
             bort och tiden följer ordinarie schema igen. */
          toggle(marks.lediga, status === "Ledig");
          if (isExtra) toggle(ownerDay.slots, status === "Ledig");
        }

        renderOwnerDay(ownerDay);
        if (days) { days[ownerPick] = publicDay(ownerDay); renderDays(); }
      }

      /* Klick på en tid i ägarpanelen: växlar Bokad / Ledig / ordinarie. */
      function toggleOwnerSlot(clock, action) {
        if (action === "locked") return;

        if (!session || !session.token || !ownerPick) {
          note(ownerMessage, "Logga in med ägarkontot först.", false);
          return;
        }

        var status = action === "busy" ? "Bokad" : (action === "free" ? "Ledig" : "Auto");

        savingClock = clock;
        markLocally(clock, status);
        note(ownerMessage, "Sparar\u2026", null);

        postToServer({
          action: "slot", token: session.token, datum: ownerPick, tid: clock, status: status
        }, function (result) {
          if (!result) { savingClock = null; return; }

          savingClock = null;

          if (!result.ok) {
            note(ownerMessage, result.message || "Kunde inte spara markeringen.", false);
            loadOwnerDay(ownerPick, true); /* serverns läge gäller */
            return;
          }

          note(ownerMessage, result.message || "Sparat.", true);

          /* Servern svarar med hela dagens nya läge, kundnamn och markeringar
             inräknade. Det räcker för panelen – och tvåveckorslistan hämtas om
             i bakgrunden, så att besökarna ser samma sak direkt. */
          applyDay(result.day);
          loadRange(true);
        }, function () {
          note(ownerMessage, "Bokningssystemet startar \u2013 ett nytt f\u00f6rs\u00f6k g\u00f6rs\u2026", null);
        });
      }

      /* Hela dagen på en gång: bokad eller tillbaka till ordinarie schema. */
      function sendDay(status) {
        if (!session || !session.token || !ownerPick) {
          note(ownerMessage, "Logga in med ägarkontot först.", false);
          return;
        }

        savingClock = null;
        note(ownerMessage, "Sparar\u2026", null);
        setOwnerBusy(true);

        postToServer({ action: "day", token: session.token, datum: ownerPick, status: status },
          function (result) {
            setOwnerBusy(false);
            if (!result) return;

            if (!result.ok) {
              note(ownerMessage, result.message || "Kunde inte spara dagen.", false);
              return;
            }

            note(ownerMessage, result.message || "Sparat.", true);

            /* Svaret innehåller hela dagens nya läge – både panelen och den
               allmänna listan uppdateras direkt från det. */
            applyDay(result.day);
            loadRange(true);
          }, function () {
            note(ownerMessage, "Bokningssystemet startar \u2013 ett nytt f\u00f6rs\u00f6k g\u00f6rs\u2026", null);
          });
      }

      /* Godkänner eller nekar en förfrågan direkt i ägarpanelen. Servern gör
         exakt samma sak som när mejlets knapp används (decide_ i Code.gs):
         godkänner förfrågan och mejlar kunden, eller nekar den och gör tiden
         ledig igen. Svaret innehåller hela dagens nya läge, som ritas om direkt
         – och tvåveckorslistan hämtas i bakgrunden, så att besökarna ser samma
         sak. svar är "ja" (godkänn) eller "nej" (neka). */
      /* Nyckeln som stänger av just den radens knappar medan svaret är på väg.
         Samma nyckel oavsett om bokningen hade ett id med sig eller inte. */
      function decisionKey(datum, booking) {
        if (booking && booking.id) return String(booking.id);
        return String(datum || "") + " " + String((booking && booking.tid) || "");
      }

      /* Godkänner eller nekar en förfrågan i listan. Anropet pekar ut bokningen
         med sitt id när det finns – samma id som mejlets länkar använder – och
         annars med datum, tid och namn. Servern svarar med hela dagens nya läge,
         så att panelen och besökslistan kan ritas om direkt. */
      function sendDecision(target, svar) {
        if (!session || !session.token || !ownerPick) {
          note(ownerMessage, "Logga in med \u00e4garkontot f\u00f6rst.", false);
          return;
        }

        var id = (target && target.id) ? String(target.id) : "";
        var datum = (target && target.datum) ? String(target.datum) : "";
        var tid = (target && target.tid) ? String(target.tid) : "";

        /* Utan både id och datum + tid går förfrågan inte att peka ut. */
        if (!id && !(datum && tid)) {
          note(ownerMessage, "Kunde inte l\u00e4sa f\u00f6rfr\u00e5gan. Uppdatera dagen och f\u00f6rs\u00f6k igen.", false);
          return;
        }

        var godkann = svar === "ja";
        var request = { action: "decision", token: session.token, svar: svar };

        if (id) request.id = id;
        if (datum) request.datum = datum;
        if (tid) request.tid = tid;
        if (target && target.namn) request.namn = target.namn;

        decisionBusy = id || (datum + " " + tid);
        /* Knapparna för raden stängs av medan svaret är på väg. */
        if (ownerDay) renderOwnerDay(ownerDay);
        note(ownerMessage, godkann ? "Godk\u00e4nner\u2026" : "Nekar\u2026", null);

        postToServer(request, function (result) {
          var svarId = decisionBusy;
          decisionBusy = "";

          if (!result) {
            /* Inget användbart svar – knapparna tillbaka och dagens riktiga
               läge hämtas om, så att inget står kvar och ser fel ut. */
            if (ownerDay) renderOwnerDay(ownerDay);
            note(ownerMessage, svarId
              ? "Inget svar fr\u00e5n bokningssystemet. F\u00f6rs\u00f6k igen."
              : "", false);
            loadOwnerDay(ownerPick, true);
            return;
          }

          if (!result.ok) {
            /* En äldre version av bokningssystemet känner inte igen åtgärden –
               varken med system-flaggan eller med sitt gamla svar "Okänd
               åtgärd.". Mejlets knappar gör samma sak och fungerar ändå. */
            var gammalVersion = result.system === true ||
              String(result.message || "").indexOf("Ok\u00e4nd \u00e5tg\u00e4rd") !== -1;

            note(ownerMessage, gammalVersion
              ? "Bokningssystemet \u00e4r en \u00e4ldre version och k\u00e4nner inte igen godk\u00e4nnandet. Svara via mejlet s\u00e5 l\u00e4nge, och l\u00e4gg ut den senaste versionen i Apps Script (Deploy \u2192 Manage deployments \u2192 Version: New version \u2192 Deploy) och ladda om sidan."
              : (result.message || "Kunde inte spara svaret."), false);
            /* Serverns läge gäller – någon annan kan ha hunnit före. */
            loadOwnerDay(ownerPick, true);
            return;
          }

          note(ownerMessage, result.message || (godkann ? "Bokningen \u00e4r godk\u00e4nd." : "F\u00f6rfr\u00e5gan \u00e4r nekad."), true);
          applyDay(result.day);
          loadRange(true);
        }, function () {
          note(ownerMessage, "Bokningssystemet startar \u2013 ett nytt f\u00f6rs\u00f6k g\u00f6rs\u2026", null);
        });
      }

      /* Stänger av dagknapparna medan svaret är på väg, så att samma dag inte
         kan skickas i väg två gånger av misstag. */
      function setOwnerBusy(busy) {
        if (ownerBusyDay) ownerBusyDay.disabled = busy;
        if (ownerResetDay) ownerResetDay.disabled = busy;
      }

      /* Kvitterar att dagens tider hämtas om, så att knappen svarar direkt. */
      function setReloadBusy(busy) {
        if (!ownerReload) return;
        ownerReload.disabled = busy;
        ownerReload.textContent = busy ? "Hämtar\u2026" : ownerReloadLabel;
      }

      if (ownerBusyDay) {
        ownerBusyDay.addEventListener("click", function () { sendDay("Bokad"); });
      }
      if (ownerResetDay) {
        ownerResetDay.addEventListener("click", function () { sendDay("Ledig"); });
      }
      if (ownerReload) {
        ownerReload.addEventListener("click", function () { loadOwnerDay(ownerPick); });
        ownerReload.addEventListener("pointerenter", function () { warmServer(); });
        ownerReload.addEventListener("focus", function () { warmServer(); });
      }

      if (ownerDaysEl) {
        ownerDaysEl.addEventListener("click", function (event) {
          var button = event.target.closest ? event.target.closest("[data-owner-day]") : null;
          if (!button) return;
          loadOwnerDay(button.getAttribute("data-owner-day"));
        });
      }

      if (ownerHoursEl) {
        ownerHoursEl.addEventListener("click", function (event) {
          var button = event.target.closest ? event.target.closest("[data-owner-slot]") : null;
          if (!button || button.disabled) return;
          toggleOwnerSlot(button.getAttribute("data-owner-slot"),
            button.getAttribute("data-owner-action"));
        });
      }

      /* Klick på Godkänn/Neka i listan över kundbokningar. Bokningens uppgifter
         läses från raden, så att anropet fungerar både när servern skickade med
         ett id och när den inte gjorde det. */
      if (ownerBookingsEl) {
        ownerBookingsEl.addEventListener("click", function (event) {
          var button = event.target.closest ? event.target.closest("[data-owner-decision]") : null;
          if (!button || button.disabled) return;

          var row = button.closest ? button.closest(".owner-booking") : null;
          sendDecision({
            id: row ? row.getAttribute("data-owner-booking") : "",
            datum: row ? row.getAttribute("data-owner-booking-day") : "",
            tid: row ? row.getAttribute("data-owner-booking-slot") : "",
            namn: row ? row.getAttribute("data-owner-booking-namn") : ""
          }, button.getAttribute("data-owner-decision"));
        });
      }

      /* ---------- start ---------- */

      setAccount();

      /* Det senaste svaret från bokningsservern visas direkt, så att listan
         aldrig står tom medan webbappen startar. Raden under listan säger från
         vilket klockslag tiderna kommer, så att ingen tror att de är
         kontrollerade just nu – och hämtningen nedan tar färska tider. */
      var cached = readRangeCache();
      if (cached) {
        days = cached.days;
        daysFromServer = true;
        lastGood = cached.stamp;
        lastGoodAt = cached.at || 0;

        renderDays();
        setLink("sync");
        setAge("Visar tiderna från kl " + cached.stamp + " \u2013 uppdaterar\u2026", true);
      } else {
        /* Första besöket, eller en cache som hunnit bli för gammal: visa
           ordinarie öppettider direkt i stället för en tom platshållare. Raden
           ovanför säger att de bokade tiderna kontrolleras just nu, och
           hämtningen nedan byter ut listan mot de riktiga tiderna så snart
           svaret kommer. Ingen behöver vänta på en tom ruta. */
        renderFallbackDays();
        setLink("sync");
      }

      loadRange();
      renderOwnerDays();

      /* Hämtningen ovan startar webbappen. Därför räknas tiden för varmhållningen
         från och med nu i stället för att ett extra anrop skickas direkt. */
      warmStartedAt = Date.now();

      /* Bokningsformuläret ber listan om nya tider direkt efter en skickad
         förfrågan, så att den bokade tiden syns som upptagen på en gång. */
      refreshSlotBoard = function () {
        rangeFails = 0;
        clearRetry();
        loadRange(true);
      };

      /* Inloggningen kontrolleras strax efteråt: då får anropet om lediga
         tider möta en webbapp som redan har startat. Den allra första
         förfrågan till en kall webbapp tar annars hela tiden. */
      window.setTimeout(checkSession, 600);

      /* Ägarens dagbild hålls färsk så länge fliken är framme. Den hämtas tyst,
         så att en kvittens efter ett klick står kvar. */
      window.setInterval(function () {
        if (!document.hidden && session && session.arAgare && ownerPick) loadOwnerDay(ownerPick, true);
      }, LEDIGA_REFRESH_MS);
    }

    initSlotBoard();

    /* ------------------------------------------------------------------
       5. BOKNINGSFORMULÄR
       ------------------------------------------------------------------ */
    var form = document.getElementById("bookingForm");
    if (!form) return;

    var statusEl = document.getElementById("formStatus");
    var omradeInput = document.getElementById("omradeInput");

    /* Tiden besökaren valde i listan över lediga tider – kan vara en extratid
       som ägaren har öppnat. Fylls i av pickTimeInForm och läses av render()
       i populateTimeSlots, så att ett sent svar från servern inte tömmer valet. */
    var extraPicked = null;

    /* Är bokningsservern inkopplad skickas förfrågan dit med fetch(), annars
       som mejl till COMPANY_EMAIL – se sendBookingByEmail längre ned. Utan
       JavaScript postas formuläret i stället till mailto-adressen i
       index.html. */

    /* ------------------------------------------------------------------
       PRIS: 70 KR PER FÖNSTER (STARTPRIS)
       ------------------------------------------------------------------ */
    var PRICE_PER_WINDOW = 70;
    var antalInput = document.getElementById("antalFonster");
    var priceEstimateEl = document.getElementById("priceEstimate");

    /* Formaterar 1400 som "1 400". */
    function formatKr(amount) {
      return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
    }

    function updatePriceEstimate() {
      if (!priceEstimateEl) return;

      var count = parseInt(antalInput ? antalInput.value : "", 10);
      if (isNaN(count) || count < 1) {
        priceEstimateEl.textContent = "";
        priceEstimateEl.classList.remove("visible");
        return;
      }

      priceEstimateEl.textContent = "Prisuppskattning: " + count + " fönster \u00d7 " +
        PRICE_PER_WINDOW + " kr = från " + formatKr(count * PRICE_PER_WINDOW) +
        " kr (startpris som kan variera). Slutpriset ges på plats vid huset efter bedömning av fönstren.";
      priceEstimateEl.classList.add("visible");
    }

    if (antalInput) {
      antalInput.addEventListener("input", updatePriceEstimate);
      antalInput.addEventListener("change", updatePriceEstimate);
    }
    updatePriceEstimate();

    /* Vissa fält heter något annat i DOM än i formuläret (områdesfältet har
       t.ex. id="omradeInput" men name="omrade"). Formulärets egna fält letas
       därför upp först via name/id – annars kan en sektion med samma id
       (som #omrade) råka fångas i stället. */
    function fieldEl(id) {
      if (form.elements && form.elements[id]) return form.elements[id];
      return document.getElementById(id) || null;
    }

    function fieldWrap(id) {
      var el = fieldEl(id);
      return el ? el.closest(".field") : null;
    }

    function setError(id, message) {
      var wrap = fieldWrap(id);
      var errorEl = form.querySelector('[data-error-for="' + id + '"]');
      if (wrap) wrap.classList.toggle("invalid", Boolean(message));
      if (errorEl) errorEl.textContent = message || "";
    }

    function clearErrors() {
      ["namn", "telefon", "epost", "antalFonster", "omrade", "datum", "tid"].forEach(function (id) {
        setError(id, "");
      });
      if (statusEl) {
        statusEl.textContent = "";
        statusEl.classList.remove("ok", "fail");
      }
    }

    /* Rensa fältets felmarkering så snart användaren rättar det. */
    Array.prototype.forEach.call(form.querySelectorAll("input, select, textarea"), function (el) {
      el.addEventListener("input", function () {
        var wrap = el.closest(".field");
        if (wrap) wrap.classList.remove("invalid");
        var errorEl = el.id ? form.querySelector('[data-error-for="' + el.id + '"]') : null;
        if (errorEl) errorEl.textContent = "";
      });
    });

    /* Live-kontroll av området när man lämnar fältet. */
    if (omradeInput) {
      omradeInput.addEventListener("blur", function () {
        var value = omradeInput.value.trim();
        if (!value) { setError("omrade", ""); return; }
        var result = checkServiceArea(value);
        setError("omrade", result.ok ? "" : result.message);
      });
    }

    /* ------------------------------------------------------------------
       SKICKA FÖRFRÅGAN TILL BOKNINGS-API:T
       Uppgifterna skickas med fetch() (se sendToServer), så att sidan inte
       laddas om. Svaret därifrån visas under formuläret.
       ------------------------------------------------------------------ */
    var submitBtn = document.getElementById("submitBtn");
    /* Sattes ett nytt försök i väg? Används för att kunna förklara för kunden
       varför tiden kan vara upptagen trots att förfrågan gick fram. */
    var bookingRetried = false;

    function setSubmitting(busy) {
      if (!submitBtn) return;
      submitBtn.disabled = busy;
      submitBtn.textContent = busy ? "Skickar\u2026" : "Skicka bokningsförfrågan";
    }

    function finishBooking(result) {
      setSubmitting(false);
      if (!statusEl) return;
      statusEl.classList.remove("ok", "fail");

      /* Kom förfrågan inte in i bokningssystemet alls (tekniskt fel, eller ett
         svar som inte kommer därifrån)? Då är det inget fel på kundens
         uppgifter. Kunden får i stället sitt eget e-postprogram öppnat med hela
         förfrågan färdigifylld, så att den alltid når fram. Den tekniska
         förklaringen skrivs bara i konsolen. */
      if (result && !result.ok && isSystemFailure(result)) {
        console.warn("[Jakobs HusFix] Bokningssystemet kunde inte ta emot " +
          "förfrågan: " + result.message + " (öppnar e-postprogrammet i stället)");
        handOverToMailApp();
        return;
      }

      statusEl.textContent = (result && result.message)
        ? result.message
        : (result && result.ok ? "Din förfrågan är skickad." : "Något gick fel. Försök igen.");

      /* Gjordes ett nytt försök (första svaret uteblev) och nekades sedan tiden
         som upptagen? Då kan den första förfrågan ändå ha kommit fram. Servern
         i den senaste versionen känner igen en sådan dubblett och svarar att
         förfrågan redan är mottagen, men den här raden hjälper kunden om en
         äldre version av servern ligger kvar. */
      if (result && !result.ok && bookingRetried) {
        statusEl.textContent += " Osäker? Mejla " + COMPANY_EMAIL + " eller ring " +
          COMPANY_PHONE_DISPLAY + " – förfrågan kan ändå ha kommit fram.";
      }

      statusEl.classList.add(result && result.ok ? "ok" : "fail");
      if (result && result.ok) {
        /* Bygg telefonlänkarna innan formuläret töms. */
        var waUrl = bookingWhatsAppUrl();
        var smsUrl = bookingSmsUrl();
        form.reset();
        populateTimeSlots();
        updatePriceEstimate();
        /* Den bokade tiden är nu upptagen – visa nästa lediga i hero-kortet. */
        initNextAvailable();
        /* …och låt listan över lediga tider hämta det nya läget direkt, så att
           besökaren ser sin egen tid som upptagen med en gång. */
        refreshSlotBoard();
        if (statusEl) {
          statusEl.innerHTML += ' Vill du även skicka till oss på telefon? ' +
            '<a href="' + waUrl + '" target="_blank" rel="noopener">WhatsApp</a> eller ' +
            '<a href="' + smsUrl + '">SMS</a>.';
        }
      }
    }

    /* Samlar formulärets fält på samma sätt som en vanlig inskickning hade
       gjort, så att bokningssystemet får exakt samma uppgifter som förr.
       action=book talar om vilken åtgärd servern ska utföra (se doPost i
       Code.gs). Utan den parametern svarar servern "Okänd åtgärd." – formuläret
       skickas ju normalt till en mejladress och har därför inget action-fält. */
    function bookingFormBody() {
      var parts = ["action=book"];
      var fields = form.elements;

      for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        if (!field.name || field.disabled) continue;
        if ((field.type === "checkbox" || field.type === "radio") && !field.checked) continue;
        parts.push(encodeURIComponent(field.name) + "=" +
          encodeURIComponent(field.value == null ? "" : field.value));
      }

      return parts.join("&");
    }

    function sendBookingRequest() {
      if (!BOOKING_API_URL) {
        /* Ingen bokningsserver inkopplad i konfigurationen: då tar kundens eget
           e-postprogram över (eller telefonvägen om ingen adress är ifylld). */
        if (COMPANY_EMAIL) { sendBookingByEmail(); return; }
        sendBookingToPhone();
        return;
      }

      setSubmitting(true);
      bookingRetried = false;
      if (statusEl) {
        statusEl.textContent = "Skickar din bokningsförfrågan\u2026";
        statusEl.classList.remove("ok", "fail");
      }

      /* Servern har en egen tidsgräns i sendToServer och svarar med ett
         felmeddelande om den tiger – finishBooking visar det under formuläret.
         Går det första försöket inte igenom (webbappen kan ha varit kall) görs
         ett nytt försök automatiskt; servern känner igen förfrågan och skapar
         aldrig en dubblett. */
      sendToServer(bookingFormBody(), finishBooking,
        "Det tog för lång tid. Kontrollera anslutningen och försök igen, eller mejla " +
        COMPANY_EMAIL + ".", function () {
          bookingRetried = true;
          if (!statusEl) return;
          statusEl.textContent = "Bokningssystemet startar \u2013 skickar ett nytt f\u00f6rs\u00f6k\u2026";
          statusEl.classList.remove("ok", "fail");
        });
    }

    /* Bygger en färdig sammanställning av bokningen som text (till WhatsApp/SMS). */
    function buildBookingMessage() {
      function val(name) {
        var el = form.elements[name];
        return el ? String(el.value || "").trim() : "";
      }
      return "Bokningsförfrågan från hemsidan\n\n" +
        "Namn: " + val("namn") + "\n" +
        "Telefon: " + val("telefon") + "\n" +
        "E-post: " + val("epost") + "\n" +
        "Antal fönster: " + val("antalFonster") + "\n" +
        "Typ av fastighet: " + val("fastighet") + "\n" +
        "Gatuadress: " + (val("adress") || "-") + "\n" +
        "Ort/postnummer: " + val("omrade") + "\n" +
        "Datum och tid: " + val("datum") + " kl " + val("tid") + "\n" +
        "Meddelande: " + (val("meddelande") || "-");
    }

    function bookingWhatsAppUrl() {
      return "https://wa.me/" + COMPANY_PHONE + "?text=" + encodeURIComponent(buildBookingMessage());
    }

    function bookingSmsUrl() {
      return "sms:+" + COMPANY_PHONE + "?body=" + encodeURIComponent(buildBookingMessage());
    }

    /* ------------------------------------------------------------------
       NÖDLUCKA: RESERVVÄGAR I FORMULÄRET
       Under formuläret finns alltid "Kopiera uppgifterna", WhatsApp, SMS och
       ring. De använder exakt samma uppgifter som mejlet, så att förfrågan når
       fram även om kundens e-postprogram inte öppnas.
       ------------------------------------------------------------------ */
    var backupNote = document.getElementById("backupNote");
    var backupText = document.getElementById("backupText");
    var copyBtn = document.getElementById("copyBtn");
    var backupWhatsApp = document.getElementById("backupWhatsApp");
    var backupSms = document.getElementById("backupSms");
    var backupMail = document.getElementById("backupMail");

    /* Kort kvittens under reservknapparna. ok = true (grön), false (röd) eller
       inget värde alls för neutral information. */
    function setBackupNote(message, ok) {
      if (!backupNote) return;
      backupNote.classList.remove("ok", "fail");
      backupNote.textContent = message || "";
      if (message && typeof ok === "boolean") backupNote.classList.add(ok ? "ok" : "fail");
    }

    /* Kopiering som även fungerar i äldre webbläsare och när sidan har öppnats
       direkt från datorn (file://), där navigator.clipboard saknas. */
    function legacyCopyText(text) {
      var box = document.createElement("textarea");
      box.value = text;
      box.setAttribute("readonly", "");
      box.style.position = "fixed";
      box.style.top = "-1000px";
      box.style.opacity = "0";
      document.body.appendChild(box);
      box.select();
      if (box.setSelectionRange) box.setSelectionRange(0, text.length);

      var ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }

      document.body.removeChild(box);
      return ok;
    }

    function copyText(text, done) {
      function fallback() { done(legacyCopyText(text)); }

      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
      } else {
        fallback();
      }
    }

    /* Kopierar hela förfrågan. Går det inte att kopiera automatiskt visas
       texten i en ruta i stället, färdig att markera och kopiera för hand. */
    function copyBookingMessage() {
      var text = buildBookingMessage();

      copyText(text, function (ok) {
        if (ok) {
          if (backupText) backupText.hidden = true;
          setBackupNote("Kopierat! Klistra in uppgifterna i ett mejl till " + COMPANY_EMAIL +
            " eller i valfri meddelandeapp.", true);
          return;
        }

        if (backupText) {
          backupText.value = text;
          backupText.hidden = false;
          backupText.focus();
          backupText.select();
          if (backupText.setSelectionRange) backupText.setSelectionRange(0, text.length);
        }
        setBackupNote("Kunde inte kopiera åt dig. Uppgifterna står i rutan här under – " +
          "markera texten och tryck Ctrl+C (Cmd+C på Mac), eller skicka dem via " +
          "WhatsApp, SMS eller telefon.", false);
      });
    }

    /* Öppnar WhatsApp med hela bokningsförfrågan färdigifylld. */
    function openBookingWhatsApp() {
      var waUrl = bookingWhatsAppUrl();
      var win = window.open(waUrl, "_blank");
      if (!win) window.location.href = waUrl;
    }

    /* Håller reservknapparna i takt med numret och adressen i konfigurationen.
       Länkarna i index.html är bara en reserv för besökare som har JavaScript
       avstängt. */
    function initBackupChannels() {
      var generic = "Hej! Jag vill boka fönsterputs.";
      if (backupWhatsApp) {
        backupWhatsApp.href = "https://wa.me/" + COMPANY_PHONE +
          "?text=" + encodeURIComponent(generic);
      }
      if (backupSms) {
        backupSms.href = "sms:+" + COMPANY_PHONE +
          "?body=" + encodeURIComponent(generic);
      }
      /* Mailto-länken är den reservväg som går till besökarens eget
         e-postprogram. Ämnesraden sätts även för besökare utan JavaScript. */
      if (backupMail && COMPANY_EMAIL) {
        backupMail.href = "mailto:" + COMPANY_EMAIL +
          "?subject=" + encodeURIComponent("Bokningsförfrågan från hemsidan");
      }
    }
    initBackupChannels();

    if (copyBtn) {
      copyBtn.addEventListener("click", function () { submitBooking("copy"); });
    }

    /* Utan JavaScript öppnas länkarna som de är. Med JavaScript fylls hela
       förfrågan i – efter samma kontroll som den vanliga skicka-knappen. */
    if (backupWhatsApp) {
      backupWhatsApp.addEventListener("click", function (event) {
        event.preventDefault();
        submitBooking("whatsapp");
      });
    }
    if (backupSms) {
      backupSms.addEventListener("click", function (event) {
        event.preventDefault();
        submitBooking("sms");
      });
    }
    /* Öppnar besökarens eget e-postprogram med hela förfrågan. Klicket kommer
       från besökaren själv, vilket är den säkraste vägen till det program som är
       standard på enheten – även om webbläsaren skulle ha stoppat det
       automatiska öppnandet efter skicka-knappen. */
    if (backupMail) {
      backupMail.addEventListener("click", function (event) {
        event.preventDefault();
        submitBooking("mail");
      });
    }

    /* Färdigt mejl till företagets adress: namn, datum och tid i ämnesraden och
       hela förfrågan som brödtext. */
    function bookingEmailUrl() {
      var el = form.elements;
      var namn = el.namn ? String(el.namn.value || "").trim() : "";
      var datum = el.datum ? String(el.datum.value || "").trim() : "";
      var tid = el.tid ? String(el.tid.value || "").trim() : "";

      return "mailto:" + COMPANY_EMAIL +
        "?subject=" + encodeURIComponent("Bokningsförfrågan – " + namn + ", " + datum + " kl " + tid) +
        "&body=" + encodeURIComponent(buildBookingMessage());
    }

    /* Öppnar en mailto-adress så att besökarens eget e-postprogram tar över.
       En mailto-adress öppnas alltid av det program besökaren själv har valt som
       sitt vanliga e-postprogram – sajten pekar aldrig ut någon särskild klient
       och väljer inget konto, så både avsändare och inställningar är besökarens
       egna. Länken får ligga kvar i dokumentet en kort stund och placeras
       utanför bilden i stället för att döljas: vissa webbläsare struntar i klick
       på länkar som är display:none eller redan borttagna, och då händer inget. */
    function openDefaultMailApp(mailUrl) {
      var link = document.createElement("a");
      link.href = mailUrl;
      link.tabIndex = -1;
      link.setAttribute("aria-hidden", "true");
      link.style.position = "fixed";
      link.style.top = "0";
      link.style.left = "-9999px";

      document.body.appendChild(link);

      try {
        link.click();
      } catch (err) {
        /* Äldre webbläsare där klick på en osynlig länk inte går fram. */
        window.location.href = mailUrl;
      }

      window.setTimeout(function () {
        if (link.parentNode) link.parentNode.removeChild(link);
      }, 1000);
    }

    /* Öppnar besökarens eget e-postprogram med hela bokningsförfrågan
       färdigifylld till COMPANY_EMAIL. Används när ingen bokningsserver är
       inkopplad, när bokningssystemet inte kunde ta emot förfrågan och när
       besökaren trycker på "Öppna i e-postprogrammet" i nödluckan. Formuläret
       töms inte – går det inte att öppna programmet finns en färdig länk och
       reservknapparna kvar under formuläret.

       intro (frivillig) skriver inledningen i beskedet under formuläret, så att
       kunden får veta varför e-postprogrammet öppnas. */
    function sendBookingByEmail(intro) {
      var mailUrl = bookingEmailUrl();

      /* Länken i nödluckan får hela förfrågan, så att den som klickar där
         skickar precis samma uppgifter som det automatiska öppnandet. */
      if (backupMail) backupMail.href = mailUrl;

      openDefaultMailApp(mailUrl);

      setSubmitting(false);
      setBackupNote("Uppgifterna ligger färdiga i mejlet – tryck bara på skicka. " +
        "Öppnas inget e-postprogram? Klicka på ”Öppna i e-postprogrammet” här " +
        "ovan, eller kopiera uppgifterna och klistra in dem i ett eget mejl till " +
        COMPANY_EMAIL + ".");

      if (!statusEl) return;
      statusEl.classList.remove("fail");
      statusEl.classList.add("ok");
      statusEl.innerHTML = (intro ? intro + " " : "") +
        "Vi öppnar ditt eget e-postprogram – det du har som standard på enheten – " +
        "med hela bokningsförfrågan. Avsändaren blir din egen adress där. Tryck " +
        "bara på skicka i programmet, så kommer förfrågan till " +
        '<a href="' + mailUrl + '">' + COMPANY_EMAIL + "</a>. " +
        "Öppnas inget program? Klicka på adressen här, eller ring " +
        '<a href="tel:+' + COMPANY_PHONE + '">' + COMPANY_PHONE_DISPLAY + "</a>.";
    }

    /* Betyder svaret att förfrågan inte kom in i bokningssystemet alls (i
       stället för att tiden inte går att boka)? Ett sådant fel ska inte mötas av
       en teknisk text: kunden får skicka förfrågan med sitt eget e-postprogram i
       stället. Svaret från en äldre version av servern känns igen på texten, ett
       nyare sätter system: true, och ett svar som inte kommer från
       bokningssystemet alls saknar jhfix-flaggan. */
    function isSystemFailure(result) {
      if (!result || result.ok) return false;
      if (result.system === true) return true;
      if (result.jhfix !== true) return true;

      var message = String(result.message || "");
      if (!message) return true;
      return message.indexOf("Okänd åtgärd") !== -1 ||
        message.indexOf("inte påslaget") !== -1;
    }

    /* Tar över med kundens eget e-postprogram när bokningssystemet inte svarade
       eller inte förstod förfrågan. */
    function handOverToMailApp() {
      if (!COMPANY_EMAIL) { sendBookingToPhone(); return; }
      sendBookingByEmail("Bokningssystemet svarade inte just nu, så i stället öppnar vi " +
        "ditt e-postprogram.");
    }

    /* Skickar bokningen till företagets telefonnummer via WhatsApp.
       (Används bara om ingen e-postadress är ifylld i konfigurationen.) */
    function sendBookingToPhone() {
      var smsUrl = bookingSmsUrl();

      if (statusEl) {
        statusEl.classList.remove("fail");
        statusEl.classList.add("ok");
        statusEl.innerHTML = "Nästan klart! Vi öppnar WhatsApp med din bokningsförfrågan " +
          "färdigifylld till " + COMPANY_PHONE_DISPLAY + " – tryck bara på skicka där. " +
          'Öppnas inte WhatsApp? Skicka som <a href="' + smsUrl + '">SMS</a> eller ' +
          'ring <a href="tel:+' + COMPANY_PHONE + '">' + COMPANY_PHONE_DISPLAY + "</a>.";
      }

      openBookingWhatsApp();
    }

    /* Kontrollerar hela formuläret och markerar fälten som är fel. Returnerar
       true när allt stämmer. Används av både "Skicka bokningsförfrågan" och
       reservknapparna, så att alla vägar skickar samma fullständiga uppgifter. */
    function validateBookingForm() {
      clearErrors();

      var values = {
        namn: form.namn.value.trim(),
        telefon: form.telefon.value.trim(),
        epost: form.epost.value.trim(),
        antalFonster: form.antalFonster.value.trim(),
        fastighet: form.fastighet.value,
        omrade: form.omrade.value.trim(),
        datum: form.datum.value,
        tid: form.tid.value
      };

      var firstInvalid = null;
      function fail(id, message) {
        setError(id, message);
        if (!firstInvalid) firstInvalid = fieldEl(id);
      }

      if (values.namn.length < 2) fail("namn", "Ange ditt namn.");
      if (values.telefon.replace(/[^0-9]/g, "").length < 7) fail("telefon", "Ange ett giltigt telefonnummer.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.epost)) fail("epost", "Ange en giltig e-postadress.");
      var fonsterAntal = parseInt(values.antalFonster, 10);
      if (!values.antalFonster || isNaN(fonsterAntal) || fonsterAntal < 1) {
        fail("antalFonster", "Ange antal fönster (minst 1).");
      } else if (fonsterAntal > 200) {
        fail("antalFonster", "Kontakta oss direkt om det gäller fler än 200 fönster.");
      }

      /* Här avgörs om kunden bor inom serviceområdet. */
      var areaResult = checkServiceArea(values.omrade);
      if (!areaResult.ok) fail("omrade", areaResult.empty ? "Fyll i var du bor." : areaResult.message);

      var chosenDate = parseDateValue(values.datum);
      if (!values.datum || !chosenDate) {
        fail("datum", "Välj ett datum.");
      } else {
        var today = new Date(); today.setHours(0, 0, 0, 0);
        if (chosenDate < today) fail("datum", "Datumet har redan passerat.");
      }
      var daySlots = timeSlotsForDate(values.datum);
      var allowedSlots = bookableSlotsForDate(values.datum);
      if (!values.tid) {
        fail("tid", values.datum ? "Välj en tid." : "Välj datum först.");
      } else if (daySlots.indexOf(values.tid) === -1) {
        fail("tid", "Tiden ligger utanför våra bokningsbara tider för den dagen " +
          "(mån–fre 15:00–20:00, lör–sön 10:00–18:00).");
      } else if (allowedSlots.indexOf(values.tid) === -1) {
        fail("tid", "Tiden har redan passerat. Välj en senare tid.");
      }

      if (firstInvalid) {
        firstInvalid.focus();
        if (statusEl) {
          statusEl.textContent = "Kontrollera de markerade fälten och försök igen.";
          statusEl.classList.add("fail");
        }
        return false;
      }

      return true;
    }

    /* Skickar förfrågan. channel är "auto" (den vanliga knappen) eller någon av
       nödluckans vägar: "mail" (besökarens eget e-postprogram), "copy",
       "whatsapp" och "sms". */
    function submitBooking(channel) {
      if (!validateBookingForm()) {
        if (channel !== "auto") {
          setBackupNote("Fyll i de markerade fälten först – sedan skickas samma " +
            "uppgifter härifrån.", false);
        }
        return;
      }

      /* Ett gammalt svar från en tidigare reservväg ska inte ligga kvar. */
      setBackupNote("");
      if (backupText) backupText.hidden = true;

      if (channel === "copy") { copyBookingMessage(); return; }
      /* "mail" betyder alltid besökarens eget e-postprogram – även om en
         bokningsserver är inkopplad, eftersom knappen är ett aktivt val. */
      if (channel === "mail") { sendBookingByEmail(); return; }
      if (channel === "sms") { window.location.href = bookingSmsUrl(); return; }
      if (channel === "whatsapp") { openBookingWhatsApp(); return; }

      /* Allt är giltigt. Är bokningsservern inkopplad skickas förfrågan dit,
         annars som färdigifyllt mejl till COMPANY_EMAIL. Är ingen e-postadress
         ifylld används telefonvägen (WhatsApp/SMS) i sista hand. */
      if (BOOKING_API_URL) {
        sendBookingRequest();
        return;
      }

      if (COMPANY_EMAIL) {
        sendBookingByEmail();
        return;
      }

      sendBookingToPhone();
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      submitBooking("auto");
    });
  });

  /* ----------------------------------------------------------------------
     5. GLOBALA FINTJUSTERINGAR
     Sticky-header-skugga, mobilmeny, "till toppen" och mjuka intoningar.
     Ren progressiv förbättring – sidan fungerar precis lika bra utan JS.
     ---------------------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", function () {
    var prefersReduced = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* Sticky-header: lägg på skugga så snart sidan scrollats. */
    var header = document.querySelector(".site-header");
    if (header) {
      var paintHeader = function () {
        header.classList.toggle("is-scrolled", window.scrollY > 8);
      };
      paintHeader();
      window.addEventListener("scroll", paintHeader, { passive: true });
    }

    /* Mobilmeny: håll aria-label i takt med läget och stäng med Escape. */
    var navToggle = document.getElementById("navToggle");
    var primaryNav = document.getElementById("primaryNav");
    if (navToggle && primaryNav) {
      navToggle.addEventListener("click", function () {
        var open = primaryNav.classList.contains("open");
        navToggle.setAttribute("aria-label", open ? "Stäng meny" : "Öppna meny");
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && primaryNav.classList.contains("open")) {
          primaryNav.classList.remove("open");
          navToggle.setAttribute("aria-expanded", "false");
          navToggle.setAttribute("aria-label", "Öppna meny");
          navToggle.focus();
        }
      });
    }

    /* ----------------------------------------------------------------------
       Till toppen
       Logotypen, "Till toppen" i sidfoten och den flytande knappen ska alla ta
       dig högst upp. Länkarna har href="#top" och fungerar därför även utan JS,
       men själva hoppet sköts här. Skälet är att målet #top är sidhuvudet, som
       ligger klibbigt högst upp i vyn: webbläsaren anser då att målet redan är
       synligt och scrollar ingenting alls. Därför tar vi över klicket och går
       till position 0 i stället.
       ---------------------------------------------------------------------- */
    function scrollToTop() {
      var from = window.scrollY || document.documentElement.scrollTop || 0;

      /* Ett rakt hopp, utan mjuk scrollning. Används vid reducerad rörelse och
         som reserv i webbläsare som inte klarar scrollTo({behavior}). */
      function jump() {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        if (document.body) document.body.scrollTop = 0;
      }

      if (prefersReduced) { jump(); return; }

      try {
        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      } catch (err) {
        jump();
        return;
      }

      /* Rörde vi oss inte alls (några webbläsare tystar anropet) tar vi ett
         rakt hopp i stället, så att knappen aldrig kan bli verkningslös. */
      window.setTimeout(function () {
        var now = window.scrollY || 0;
        if (now > 0 && now >= from) jump();
      }, 300);
    }

    /* Länkar till sidans topp: logotypen och "Till toppen" i sidfoten. */
    document.addEventListener("click", function (event) {
      var target = event.target;
      var link = target && target.closest ? target.closest('a[href="#top"]') : null;
      if (!link) return;

      event.preventDefault();
      scrollToTop();

      /* Adressfältet lämnas utan #top, så att en ny tryckning gör precis samma
         sak och så att en omladdning inte fastnar vid ett avsnitt. */
      if (window.history && window.history.replaceState) {
        try {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        } catch (err) { /* Tillåts inte för file:// i alla webbläsare – strunt samma. */ }
      }
    });

    /* Den flytande knappen tonas in en bit ned på sidan och tar samma väg upp. */
    var toTop = document.getElementById("toTop");
    if (toTop) {
      var paintToTop = function () {
        toTop.classList.toggle("is-visible", window.scrollY > 600);
      };
      paintToTop();
      window.addEventListener("scroll", paintToTop, { passive: true });
      toTop.addEventListener("click", function () {
        scrollToTop();

        /* Fokus flyttas till logotypen först när hoppet har landat. En
           fokusering mitt i en mjuk scrollning avbryter den – webbläsaren
           tolkar fokuseringen som en ny scrollning och stoppar den pågående,
           så sidan blev stående en bit ned. */
        function focusBrand(tries) {
          if (window.scrollY > 4 && tries < 30) {
            window.setTimeout(function () { focusBrand(tries + 1); }, 60);
            return;
          }
          var brand = document.querySelector(".brand");
          if (brand) brand.focus({ preventScroll: true });
        }
        focusBrand(0);
      });
    }

    /* ----------------------------------------------------------------------
       Mjuka intoningar när sektioner scrollas in i vyn
       Elementen görs osynliga direkt (.reveal), men själva observationen
       startar först när förladdningen är borta – samma besked som js/effects.js
       skickar. Startade den tidigare hann första vyn tonas in bakom överlägget
       och stod färdig när sidan blev synlig, i stället för att spelas upp från
       början varje gång sidan laddas om.
       ---------------------------------------------------------------------- */
    var INTRO_DONE_EVENT = "jakobshusfix:intro-done";

    function whenIntroDone(fn) {
      if (document.documentElement.classList.contains("intro-done")) { fn(); return; }

      var done = false;
      function run() {
        if (done) return;
        done = true;
        document.removeEventListener(INTRO_DONE_EVENT, run);
        fn();
      }

      document.addEventListener(INTRO_DONE_EVENT, run);
      /* Säkerhetsnät om effects.js inte skulle köra: innehållet får aldrig bli
         kvar osynligt. */
      window.setTimeout(run, 4000);
    }

    if (!prefersReduced && "IntersectionObserver" in window) {
      var revealTargets = document.querySelectorAll(
        ".section-head, .card, .step, .price-banner, .image-band .container, " +
        ".omrade-copy, .area-list-wrap, .om-oss-inner > *, .booking-form, " +
        ".aside-card, .hero-card"
      );

      if (revealTargets.length) {
        Array.prototype.forEach.call(revealTargets, function (el, index) {
          el.classList.add("reveal");
          /* Liten fördröjning så att kort i samma rad tonas in i tur och ordning. */
          el.style.animationDelay = ((index % 4) * 70) + "ms";
        });

        whenIntroDone(function () {
          var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
              if (entry.isIntersecting) {
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
              }
            });
          }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });

          Array.prototype.forEach.call(revealTargets, function (el) {
            observer.observe(el);
          });
        });
      }
    }

  });
})();
