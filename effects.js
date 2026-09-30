/* ==========================================================================
   Jakobs HusFix – effects.js
   Rörelseeffekter: förladdning, läsindikator, musljus, intoningar, räknare,
   ordvisa rubriker, spotljus och lutning på kort, magnetiska knappar,
   klickringel och ringen på "till toppen"-knappen.
   Allt är progressiv förbättring – sidan fungerar precis lika bra utan JS, och
   varje effekt stängs av vid reducerad rörelse eller på pekskärm.
   ========================================================================== */
(function () {
  "use strict";

  var doc = document;
  var reduceQuery = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  var prefersReduced = !!(reduceQuery && reduceQuery.matches);
  var hasFinePointer = !!(window.matchMedia &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches);

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }

  function onReady(fn) {
    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  /* ----------------------------------------------------------------------
     1. FÖRLADDNING
     Överlägget ligger över hela sidan till dess att skriptet säger till.
     Det stängs när sidan är färdigladdad – men tidigast efter PRELOADER_MIN_MS,
     så att övergången hinner ses – och alltid efter en tidsgräns. Det kan
     alltså aldrig bli kvar och blockera innehållet.
     ---------------------------------------------------------------------- */
  /* Hur länge förladdningen minst visas (ms). Den är kort med flit: överlägget
     ligger över hela sidan, och två sekunder på varje sidladdning kändes som
     att sajten var långsam. Höj värdet för en längre startbild. */
  var PRELOADER_MIN_MS = 600;
  /* Yttersta tidsgräns (ms): stänger förladdningen även om "load" uteblir. */
  var PRELOADER_SAFETY_MS = 3000;

  var introWaiters = [];
  var introDone = false;

  /* Beskedet som går ut när förladdningen är borta. main.js väntar på samma
     signal innan sektionsintoningarna startar (se "Intoningar av sektioner"
     där), så att hela startsvepet spelas upp medan sidan syns – även vid en
     omladdning. Klassen på <html> gör det möjligt att i efterhand se att
     beskedet redan har gått ut. */
  var INTRO_DONE_EVENT = "jakobshusfix:intro-done";

  /* Kör fn så snart förladdningen är borta (eller direkt om den redan är det).
     Används av intoningarna, så att de startar först när sidan syns. */
  function whenIntroDone(fn) {
    if (introDone) { fn(); } else { introWaiters.push(fn); }
  }

  function finishIntro() {
    if (introDone) return;
    introDone = true;
    doc.documentElement.classList.add("intro-done");

    var waiters = introWaiters.slice();
    introWaiters.length = 0;
    each(waiters, function (fn) { fn(); });

    var notice = null;
    try { notice = new window.CustomEvent(INTRO_DONE_EVENT); } catch (err) { notice = null; }
    if (notice) doc.dispatchEvent(notice);
  }

  function initPreloader() {
    var preloader = doc.getElementById("preloader");
    if (!preloader) { finishIntro(); return; }

    var dismissed = false;
    var shownAt = Date.now();
    var safety = window.setTimeout(function () { dismiss(); }, PRELOADER_SAFETY_MS);

    function dismiss() {
      if (dismissed) return;

      /* Är sidan redan färdigladdad väntar vi in den minsta visningstiden. */
      var remaining = PRELOADER_MIN_MS - (Date.now() - shownAt);
      if (remaining > 0) {
        window.clearTimeout(safety);
        safety = window.setTimeout(dismiss, remaining);
        return;
      }

      dismissed = true;
      window.clearTimeout(safety);
      /* Tonar ut via css/effects.css (.js .preloader.is-done). */
      preloader.classList.add("is-done");
      preloader.setAttribute("aria-hidden", "true");
      /* Ta bort överlägget helt när övergången är klar. */
      window.setTimeout(function () {
        if (preloader.parentNode) preloader.parentNode.removeChild(preloader);
      }, prefersReduced ? 0 : 700);
      finishIntro();
    }

    if (doc.readyState === "complete") {
      window.requestAnimationFrame(dismiss);
    } else {
      window.addEventListener("load", function () {
        window.requestAnimationFrame(dismiss);
      }, { once: true });
    }
  }

  /* ----------------------------------------------------------------------
     1b. HÖGST UPP VID OMLADDNING – MEN ALDRIG MOT BESÖKAREN
     Webbläsarens egen återställning av scrollpositionen är avstängd i
     index.html (history.scrollRestoration = "manual"), så en omladdning börjar
     redan i toppen. Här kontrolleras det en gång, direkt när skriptet startar:
     står sidan ändå inte högst upp (några webbläsare återställer positionen på
     egen hand) sätts den till toppen, utan mjuk rullning.

     Tidigare gjordes samma kontroll även när "load" och "pageshow" kom. Det var
     orsaken till att sidan ibland for upp till toppen av sig själv: de
     händelserna kan komma många sekunder efter att sidan har visats – lata
     bilder och sena anrop fördröjer dem – och hade besökaren då redan rullat
     ned, eller klickat på en menylänk, försvann platsen de tittade på. Ingen
     senare kontroll görs därför: efter den här stunden rör inget sidan själv.
     ---------------------------------------------------------------------- */
  function initTopOnReload() {
    var root = doc.documentElement;
    if (!(window.scrollY || root.scrollTop || 0)) return;

    var previous = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
    root.style.scrollBehavior = previous;
  }

  /* ----------------------------------------------------------------------
     2. LÄSINDIKATOR OCH RINGEN PÅ "TILL TOPPEN"
     ---------------------------------------------------------------------- */
  function initScrollChrome() {
    var bar = doc.getElementById("scrollProgress");
    var toTop = doc.getElementById("toTop");
    var circle = toTop ? toTop.querySelector(".to-top-ring circle") : null;
    var length = 0;

    if (circle) {
      var radius = parseFloat(circle.getAttribute("r")) || 0;
      length = 2 * Math.PI * radius;
      circle.style.strokeDasharray = length.toFixed(2);
      circle.style.strokeDashoffset = length.toFixed(2);
      circle.style.transition = "stroke-dashoffset .15s linear";
    }
    if (!bar && !circle) return;

    var queued = false;

    function paint() {
      queued = false;
      var scrollable = doc.documentElement.scrollHeight - window.innerHeight;
      var progress = scrollable > 0
        ? Math.min(1, Math.max(0, window.scrollY / scrollable))
        : 0;
      if (bar) bar.style.setProperty("--progress", progress.toFixed(4));
      if (circle) circle.style.strokeDashoffset = (length * (1 - progress)).toFixed(2);
    }

    function request() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(paint);
    }

    paint();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
  }

  /* ----------------------------------------------------------------------
     3. LJUS SOM FÖLJER MUSPEKAREN
     Ljuskäglan ska sitta mitt på pekaren. Positionen skrivs därför till
     translate-egenskapen och inte till transform: i css/effects.css pulsar
     ljuset med scale-egenskapen (is-fast/is-down), och enligt reglerna för
     transform räknas transform-funktionerna innanför scale medan translate
     ligger utanför. Låg positionen i transform skulle skalningen multiplicera
     förskjutningen – ljuset hamnade då vid sidan av pekaren så fort det rörde
     på sig – medan det med translate alltid blir exakt centrerat, hur mycket
     det än skalas.
     Den glider mot målet varje bildruta, men eftersläpningen klipps vid ett
     par pixlar: hur fort man än rör musen kan ljuset aldrig hamna mer än
     MAX_LAG bakom. Rör man musen snabbt sträcks ljuset ut och när musknappen
     trycks ned drar det ihop sig – det styrs av klasserna is-fast/is-down i
     css/effects.css. När pekaren står stilla slutar skriptet rita helt, så
     inget arbete sker i onödan.
     ---------------------------------------------------------------------- */
  function initCursorGlow() {
    var glow = doc.getElementById("cursorGlow");
    if (!glow) return;

    /* På pekskärmar och med reducerad rörelse behövs inget musljus. */
    if (!hasFinePointer || prefersReduced) {
      if (glow.parentNode) glow.parentNode.removeChild(glow);
      return;
    }

    var FOLLOW = 0.4;    /* andel av det kvarvarande avståndet per bildruta */
    var MAX_LAG = 2;     /* största tillåtna eftersläpning, i pixlar */
    var targetX = 0;
    var targetY = 0;
    var x = 0;
    var y = 0;
    var frame = null;
    var started = false;
    var fast = false;

    /* translate-egenskapen finns i alla webbläsare som också kan skala ljuset.
       I en äldre webbläsare finns ingen skalning att ta hänsyn till, och då går
       det lika bra att flytta elementet med transform. */
    var useTranslate = "translate" in glow.style;

    function place(px, py) {
      if (useTranslate) glow.style.translate = px + "px " + py + "px";
      else glow.style.transform = "translate3d(" + px + "px," + py + "px,0)";
    }

    function paint() {
      frame = null;

      /* Glid mot målet ... */
      x += (targetX - x) * FOLLOW;
      y += (targetY - y) * FOLLOW;

      /* ... men aldrig mer än MAX_LAG efter pekaren. */
      var lagX = targetX - x;
      var lagY = targetY - y;
      if (lagX > MAX_LAG) x = targetX - MAX_LAG;
      else if (lagX < -MAX_LAG) x = targetX + MAX_LAG;
      if (lagY > MAX_LAG) y = targetY - MAX_LAG;
      else if (lagY < -MAX_LAG) y = targetY + MAX_LAG;

      place(x.toFixed(2), y.toFixed(2));

      if (Math.abs(targetX - x) > 0.2 || Math.abs(targetY - y) > 0.2) {
        frame = window.requestAnimationFrame(paint);
      } else {
        /* Stilla: snäpp till exakt läge och låt ljuset krympa tillbaka. */
        x = targetX;
        y = targetY;
        place(x, y);
        if (fast) {
          fast = false;
          glow.classList.remove("is-fast");
        }
      }
    }

    doc.addEventListener("mousemove", function (event) {
      var distance = Math.abs(event.clientX - targetX) + Math.abs(event.clientY - targetY);

      if (!started) {
        /* Första rörelsen: börja där pekaren faktiskt är, så att ljuset inte
           far in från sidans övre vänstra hörn. */
        started = true;
        x = event.clientX;
        y = event.clientY;
      }

      targetX = event.clientX;
      targetY = event.clientY;

      /* Olika tröskel för att sätta på och stänga av, så att ljuset inte
         fladdrar när pekaren rör sig lagom fort. Klassen rörs bara när värdet
         verkligen ändras – annars tvingas en stilomräkning fram för varje
         mushändelse, vilket i sig gör att ljuset sackar efter. */
      var next = fast ? distance > 8 : distance > 26;
      if (next !== fast) {
        fast = next;
        glow.classList.toggle("is-fast", fast);
      }

      if (!glow.classList.contains("is-on")) glow.classList.add("is-on");
      if (!frame) frame = window.requestAnimationFrame(paint);
    }, { passive: true });

    doc.addEventListener("pointerdown", function () {
      glow.classList.add("is-down");
    }, { passive: true });

    doc.addEventListener("pointerup", function () {
      glow.classList.remove("is-down");
    }, { passive: true });

    /* Pekaren lämnar fönstret: släck ljuset i stället för att lämna det kvar. */
    doc.addEventListener("mouseleave", function () {
      fast = false;
      glow.classList.remove("is-on", "is-fast", "is-down");
    });
  }

  /* ----------------------------------------------------------------------
     4. INTONINGAR VID SKROLL
     Markerade element (data-reveal) tonar in när de kommer in i vyn.
     Fördröjningen hämtas från data-reveal-delay, riktningen från värdet.
     ---------------------------------------------------------------------- */
  function initReveal() {
    var items = doc.querySelectorAll("[data-reveal]");
    if (!items.length) return;

    each(items, function (el) {
      var delay = parseInt(el.getAttribute("data-reveal-delay") || "0", 10);
      if (delay > 0) el.style.setProperty("--reveal-delay", delay + "ms");
    });

    function showAll() {
      each(items, function (el) { el.classList.add("is-visible"); });
    }

    if (prefersReduced || !("IntersectionObserver" in window)) { showAll(); return; }

    /* Startar först när förladdningen är borta, så att intoningen syns. */
    whenIntroDone(function () {
      var observer = new IntersectionObserver(function (entries) {
        each(entries, function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });

      each(items, function (el) { observer.observe(el); });
    });
  }

  /* ----------------------------------------------------------------------
     5. RÄKNARE
     Siffror med data-count-to räknas upp när de blir synliga.
     ---------------------------------------------------------------------- */
  function renderCounter(el, value) {
    el.textContent = String(value) + (el.getAttribute("data-count-suffix") || "");
  }

  /* Startar räkningen en gång per element. Med instant = true sätts slutvärdet
     direkt – används när elementet redan passerat vyn (t.ex. efter ett hopp mitt
     i sidan), så att siffran aldrig kan bli stående på sin starttext. */
  function runCounter(el, instant) {
    if (el.getAttribute("data-count-started") === "1") return;
    el.setAttribute("data-count-started", "1");

    var target = parseFloat(el.getAttribute("data-count-to"));
    if (isNaN(target)) return;

    if (prefersReduced || instant) { renderCounter(el, target); return; }

    var duration = parseInt(el.getAttribute("data-count-duration") || "1500", 10);
    var started = null;

    function step(now) {
      if (started === null) started = now;
      var t = Math.min(1, (now - started) / duration);
      /* Ease-out-expo: siffran far iväg snabbt och landar mjukt i stället för
         att rusa i jämn takt hela vägen. */
      var eased = t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
      renderCounter(el, Math.round(target * eased));
      if (t < 1) window.requestAnimationFrame(step);
    }

    renderCounter(el, 0);
    window.requestAnimationFrame(step);

    /* Säkerhetsnät: siffran ska alltid stå på sitt riktiga värde, även om
       bildrutan (requestAnimationFrame) inte skulle köra. */
    window.setTimeout(function () { renderCounter(el, target); }, duration + 400);
  }

  function initCounters() {
    var counters = doc.querySelectorAll("[data-count-to]");
    if (!counters.length) return;

    if (!("IntersectionObserver" in window)) {
      each(counters, function (el) { runCounter(el); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      each(entries, function (entry) {
        if (!entry.isIntersecting) return;
        runCounter(entry.target);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.55 });

    whenIntroDone(function () {
      each(counters, function (el) { observer.observe(el); });
    });
  }

  /* ----------------------------------------------------------------------
     6. ORDVIS RUBRIKANIMERING
     Rubriker med klassen split-target delas i ord som glider in i tur och
     ordning. Inline-formatering (t.ex. <em>) behålls som ett eget ord.
     ---------------------------------------------------------------------- */
  function buildWord(text, words) {
    var outer = doc.createElement("span");
    outer.className = "split-word";
    var inner = doc.createElement("span");
    inner.textContent = text;
    outer.appendChild(inner);
    words.push(outer);
    return outer;
  }

  function splitIntoWords(target) {
    var words = [];
    var frag = doc.createDocumentFragment();

    each(Array.prototype.slice.call(target.childNodes), function (node) {
      if (node.nodeType === 3) {
        /* Textnod: dela på blanksteg, men behåll dem mellan orden. */
        node.nodeValue.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            frag.appendChild(doc.createTextNode(part));
          } else {
            frag.appendChild(buildWord(part, words));
          }
        });
        return;
      }

      if (node.nodeType === 1) {
        /* <em>, <strong> m.m. blir ett eget ord och behåller sin stil. */
        var outer = doc.createElement("span");
        outer.className = "split-word";
        var inner = doc.createElement("span");
        inner.appendChild(node.cloneNode(true));
        outer.appendChild(inner);
        frag.appendChild(outer);
        words.push(outer);
      }
    });

    if (!words.length) return words;

    while (target.firstChild) target.removeChild(target.firstChild);
    target.appendChild(frag);
    return words;
  }

  function initSplitText() {
    var targets = doc.querySelectorAll(".split-target");
    if (!targets.length || prefersReduced) return;

    each(targets, function (target) {
      var words = splitIntoWords(target);
      if (!words.length) return;

      each(words, function (word, index) {
        word.style.setProperty("--word-delay", (120 + index * 70) + "ms");
      });

      /* Klassen läggs på i nästa bildruta så att övergången hinner starta.
         Reservvägen ser till att orden aldrig kan bli kvar gömda. */
      var shown = false;
      function show() {
        if (shown) return;
        shown = true;
        target.classList.add("is-split-in");
      }

      whenIntroDone(function () {
        window.requestAnimationFrame(show);
        window.setTimeout(show, 120);
      });
    });
  }

  /* ----------------------------------------------------------------------
     7. SPOTLJUS OCH LUTNING PÅ KORT
     Sätter --mx/--my (läget i procent) som kortets ljuskägla följer, se
     .card::after i css/components.css, och lutar kortet en aning mot pekaren.
     Lutningen skrivs till de egna egenskaperna rotate/scale, inte till
     transform – då läggs den ovanpå svajningen som css/components.css kör på
     transform när kortet är i hover, i stället för att slå ut den. Båda
     värdena glider mot sitt mål, så kortet följer pekaren mjukt.
     ---------------------------------------------------------------------- */
  function initSpotlight() {
    var cards = doc.querySelectorAll("[data-tilt]");
    if (!cards.length || !hasFinePointer || prefersReduced) return;

    var LEAN = 1.2;    /* grader i sidled */
    var GROW = 1.014;  /* hur mycket kortet växer under pekaren */

    each(cards, function (card) {
      var lean = 0;
      var grow = 1;
      var targetLean = 0;
      var targetGrow = 1;
      var hovering = false;
      var frame = null;

      function paint() {
        frame = null;
        lean += (targetLean - lean) * 0.16;
        grow += (targetGrow - grow) * 0.16;

        if (Math.abs(targetLean - lean) > 0.005 || Math.abs(targetGrow - grow) > 0.0005) {
          card.style.rotate = lean.toFixed(3) + "deg";
          card.style.scale = grow.toFixed(4);
          frame = window.requestAnimationFrame(paint);
        } else if (hovering) {
          card.style.rotate = lean.toFixed(3) + "deg";
          card.style.scale = grow.toFixed(4);
        } else {
          /* Tillbaka i vila: lämna tillbaka styrningen till CSS. */
          card.style.rotate = "";
          card.style.scale = "";
        }
      }

      card.addEventListener("mousemove", function (event) {
        var rect = card.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        var px = (event.clientX - rect.left) / rect.width;
        var py = (event.clientY - rect.top) / rect.height;

        card.style.setProperty("--mx", (px * 100).toFixed(2) + "%");
        card.style.setProperty("--my", (py * 100).toFixed(2) + "%");

        hovering = true;
        targetLean = (0.5 - px) * LEAN * 2;
        targetGrow = GROW;
        if (!frame) frame = window.requestAnimationFrame(paint);
      }, { passive: true });

      card.addEventListener("mouseleave", function () {
        card.style.setProperty("--mx", "50%");
        card.style.setProperty("--my", "0%");
        hovering = false;
        targetLean = 0;
        targetGrow = 1;
        if (!frame) frame = window.requestAnimationFrame(paint);
      });
    });
  }

  /* ----------------------------------------------------------------------
     8. MAGNETISKA KNAPPAR
     Knappar med data-magnetic följer muspekaren en aning. Även här glider
     knappen mot målet i stället för att hoppa dit, och när pekaren lämnar
     knappen glider den tillbaka till sitt vanliga läge.
     ---------------------------------------------------------------------- */
  function initMagnetic() {
    var items = doc.querySelectorAll("[data-magnetic]");
    if (!items.length || !hasFinePointer || prefersReduced) return;

    each(items, function (el) {
      var strength = parseFloat(el.getAttribute("data-magnetic")) || 6; /* px */
      var tx = 0;
      var ty = 0;
      var x = 0;
      var y = 0;
      var active = false;
      var frame = null;

      function paint() {
        frame = null;
        x += (tx - x) * 0.15;
        y += (ty - y) * 0.15;
        el.style.transform = "translate3d(" + x.toFixed(2) + "px," + y.toFixed(2) + "px,0)";

        if (Math.abs(tx - x) > 0.05 || Math.abs(ty - y) > 0.05) {
          frame = window.requestAnimationFrame(paint);
        } else if (!active) {
          /* Tillbaka i vila: släpp styrningen till CSS (lyft, skugga, hover). */
          el.style.transform = "";
        }
      }

      el.addEventListener("mousemove", function (event) {
        var rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        var dx = (event.clientX - rect.left - rect.width / 2) / (rect.width / 2);
        var dy = (event.clientY - rect.top - rect.height / 2) / (rect.height / 2);
        active = true;
        tx = dx * strength;
        ty = dy * strength;
        if (!frame) frame = window.requestAnimationFrame(paint);
      }, { passive: true });

      el.addEventListener("mouseleave", function () {
        active = false;
        tx = 0;
        ty = 0;
        if (!frame) frame = window.requestAnimationFrame(paint);
      });
    });
  }

  /* ----------------------------------------------------------------------
     9. PARALLAX
     Element med data-parallax rör sig dubbelt så långsamt som sidan
     (0.10 = tio procent av avståndet till mitten av vyn).
     ---------------------------------------------------------------------- */
  function initParallax() {
    var items = doc.querySelectorAll("[data-parallax]");
    if (!items.length || prefersReduced) return;

    var queued = false;

    function paint() {
      queued = false;
      var middle = window.innerHeight / 2;
      each(items, function (el) {
        var speed = parseFloat(el.getAttribute("data-parallax")) || 0.1;
        var rect = el.getBoundingClientRect();
        var offset = (rect.top + rect.height / 2 - middle) * speed;
        el.style.transform = "translate3d(0," + offset.toFixed(2) + "px,0)";
      });
    }

    function request() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(paint);
    }

    paint();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
  }

  /* ----------------------------------------------------------------------
     9b. SÄKERHETSNÄT FÖR INTONINGAR OCH RÄKNARE
     main.js tonar in sektionshuvuden, kort, steg och formulär genom att sätta
     klassen .reveal och sedan .is-visible via en IntersectionObserver, och
     effects.js gör samma sak för [data-reveal] och räknarna. Skulle
     observatören inte rapportera – vilket kan hända i ovanliga webbläsare,
     förhandsvisningar och skärmdumpar – eller elementen hoppas förbi vid ett
     hopp mitt i sidan, ligger innehållet annars kvar osynligt och räknarna på
     sin starttext. Därför visas allt som finns i vyn vid start och därefter vid
     varje skroll; element som redan passerat vyn visas utan fördröjning.
     ---------------------------------------------------------------------- */
  function initRevealFallback() {
    var queued = false;
    var hidden = ".reveal:not(.is-visible), [data-reveal]:not(.is-visible)";

    function inView(rect) {
      return rect.top < window.innerHeight * 0.94 && rect.bottom > 0;
    }

    function sweep() {
      queued = false;

      /* Före förladdningen är klar rör vi ingenting. Annars hinner elementen i
         första vyn tonas in bakom överlägget, och när det lyfts står sidan
         redan färdig i stället för att spelas upp från början. */
      if (!introDone) return;

      each(doc.querySelectorAll(hidden), function (el) {
        var rect = el.getBoundingClientRect();
        if (inView(rect)) {
          el.classList.add("is-visible");
        } else if (rect.bottom <= 0) {
          /* Redan förbi vyn: visa direkt, utan att någon hinner se övergången. */
          el.classList.add("is-visible", "is-instant");
        }
      });

      each(doc.querySelectorAll("[data-count-to]"), function (el) {
        if (el.getAttribute("data-count-started") === "1") return;
        var rect = el.getBoundingClientRect();
        if (inView(rect)) runCounter(el);
        else if (rect.bottom <= 0) runCounter(el, true);
      });
    }

    function request() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(sweep);
    }

    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
    window.addEventListener("load", request);
    whenIntroDone(request);
    window.setTimeout(request, 1500);
    window.setTimeout(request, 3500);
  }

  /* ----------------------------------------------------------------------
     9c. KLICKRINGEL
     En mjuk ring som sprids från pekaren när man trycker ned musen på en
     knapp, en rad i förslagslistan eller en dag i kalendern. Lyssnaren sitter
     på dokumentet och letar upp rätt element med closest(), så att rader som
     skapas senare – förslagslistan byggs om vid varje sökning – också får sin
     ringel. Ringeln tar bort sig själv när animationen är klar.
     ---------------------------------------------------------------------- */
  function initRipple() {
    if (prefersReduced) return;

    var target = ".btn, .combo-list li, .dp-day";

    doc.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) return;

      var el = event.target && event.target.closest ? event.target.closest(target) : null;
      if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return;

      var rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      var size = Math.max(rect.width, rect.height) * 2.2;
      var ripple = doc.createElement("span");

      ripple.className = "btn-ripple";
      ripple.setAttribute("aria-hidden", "true");
      ripple.style.width = size + "px";
      ripple.style.height = size + "px";
      ripple.style.left = (event.clientX - rect.left - size / 2) + "px";
      ripple.style.top = (event.clientY - rect.top - size / 2) + "px";
      el.appendChild(ripple);

      window.setTimeout(function () {
        if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
      }, 700);
    }, { passive: true });
  }

  /* ----------------------------------------------------------------------
     10. START
     ---------------------------------------------------------------------- */
  onReady(function () {
    initPreloader();
    initTopOnReload();
    initScrollChrome();
    initCursorGlow();
    initReveal();
    initCounters();
    initSplitText();
    initSpotlight();
    initMagnetic();
    initRipple();
    initParallax();
    initRevealFallback();
  });
})();

