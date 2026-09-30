# Jakobs HusFix – bokningar till Gmail

Den här mappen innehåller en liten gratis "server" som gör att sajtens
bokningsformulär fungerar på riktigt:

1. När en kund skickar en bokningsförfrågan skickas den automatiskt som
   e-post till **jakobshusfix@gmail.com**.
2. I mejlet finns två knappar: **Godkänn bokningen** och **Neka förfrågan**.
3. Godkänner Jakob tiden blir den upptagen och kan inte bokas av någon annan.
4. Nekar Jakob förfrågan blir tiden ledig igen och någon annan kan boka den.

Inget kreditkort eller webbhotell behövs – allt körs på Googles egna servrar
och ingår i Gmails gratiskonto. Bokningarna sparas dessutom i ett
Google-kalkylark så att du enkelt kan se dem i efterhand.

---

## Så kan bokningen nå dig

Alla bokningsförfrågningar går till **jakobshusfix@gmail.com**. Det finns fyra
vägar – de två första är inkopplade direkt och de två sista är reservvägar som
alltid finns kvar i formuläret.
Allt styrs under `window.JAKOBS_HUSFIX_CONFIG` i `index.html` (längst ned).

1. **Till e-post – standard, kräver ingen server.**
   När kunden skickar formuläret öppnas **kundens eget e-postprogram** med hela
   förfrågan (namn, telefon, adress, datum, tid, antal fönster m.m.)
   färdigifylld till `companyEmail` (standard: `jakobshusfix@gmail.com`).
   Öppnandet sker med en `mailto:`-adress, och en sådan öppnas alltid av det
   program kunden själv har valt som sitt vanliga e-postprogram (Outlook,
   Apple Mail, Gmail-appen, Thunderbird ...). Sajten pekar aldrig ut någon
   särskild klient och väljer inget konto – avsändaren blir kundens egen adress
   i det program hen använder. Kunden trycker bara på *skicka*, och mejlet
   hamnar i din inbox. I statusraden och i rutan under formuläret finns
   dessutom WhatsApp, SMS och telefonnummer som alternativ, ifyllda med samma
   uppgifter.

2. **Till Gmail automatiskt – kräver engångsinstallation.**
   Fyll i `bookingApiUrl` enligt stegen nedan. Då skickas bokningen
   automatiskt till `OWNER_EMAIL` i `Code.gs` (sätt den till samma adress som
   `companyEmail`) med knappar för Godkänn/Neka, och bokade tider låses så att
   ingen kan boka dem igen.

3. **Till telefon via WhatsApp/SMS – sista utväg.**
   Lämnas `companyEmail` **tom** öppnas WhatsApp med förfrågan färdigifylld
   till företagets nummer i stället. Numret ställs in under `companyPhone`
   (utan `+` och mellanslag, t.ex. `46793584957`) och `companyPhoneDisplay`
   (det som visas, t.ex. `079-358 49 57`).

4. **Reservknappar i formuläret – fungerar alltid.**
   Under formuläret finns alltid *Öppna i e-postprogrammet*, *Kopiera
   uppgifterna*, *Skicka på WhatsApp*, *Skicka som SMS* och *Ring 079-358 49
   57*. De kontrollerar formuläret på samma sätt som skicka-knappen och
   använder exakt samma uppgifter, så att förfrågan når fram även om
   e-postprogrammet inte öppnades automatiskt. *Öppna i e-postprogrammet* är en
   vanlig `mailto:`-länk som besökaren klickar på själv – den går därför alltid
   till besökarens eget, förvalda e-postprogram, även om webbläsaren skulle ha
   stoppat det automatiska öppnandet. Har besökaren JavaScript avstängt öppnar
   knapparna WhatsApp, SMS eller telefonen med en kort hälsning i stället.
   Numret och adressen står därför även i klartext i `index.html` (i
   `form-backup`-rutan) – ändrar du dem måste du uppdatera både
   konfigurationen och knapparna.

Väg 1 och 2 kan användas samtidigt – väg 2 används automatiskt så snart
`bookingApiUrl` är ifylld. Har besökaren JavaScript avstängt skickas
formuläret ändå till samma adress, då via formulärets `action`. Reservknapparna
i väg 4 ligger kvar under formuläret hela tiden, oavsett vilken väg som används.

Sajten märker varje anrop till bokningssystemet med vilken åtgärd det gäller
(`action=book` för en bokningsförfrågan). Kan servern ändå inte ta emot
förfrågan – en kallstart, ett nätfel, en äldre version av webbappen eller ett
svar som inte kommer från bokningssystemet – visas ingen teknisk text för
kunden: sajten tar då över med **väg 1** och öppnar kundens eget e-postprogram
med hela förfrågan färdigifylld, och skriver i statusraden varför. Nekas
förfrågan av en bokningsregel (t.ex. *"tiden är redan bokad"*) visas däremot
serverns eget besked som vanligt.

Den här versionen av `Code.gs` känner dessutom igen en förfrågan som kommer utan
`action` (äldre, cachad `js/main.js` hos en besökare): den behandlas som en
bokning i stället för att besvaras med *"Okänd åtgärd."*. Ett anrop som inte alls
går att förstå märks med `system: true`, så att sajten kan skilja på "tekniskt
fel" och "tiden går inte att boka".

---

## Filer

| Fil | Beskrivning |
| --- | --- |
| `Code.gs` | Själva servern (klistras in i Google Apps Script). |
| `appsscript.json` | Inställningar (tidzon, "vem får köra"). Valfri. |
| `test-backend.js` | Testskript som kontrollerar hela backend: bokningar, konton, inloggning, godkännande och nekande (via mejlets länkar och från ägarpanelen), ägarpanelens markeringar, den delade cachen, dubblettskyddet vid ett nytt försök och att ett anrop från sajten utan `action` ändå blir en bokning. |
| `README.md` | Den här guiden. Den övergripande beskrivningen av sajten ligger i `../README.md`. |

I själva sajten är det bara en rad i `index.html` som behöver fyllas i
(se steg 4 nedan).

## Steg för steg (tar ca 5 minuter)

### Steg 1 – Skapa skriptet

Enklast är att koppla skriptet till ett kalkylark, så sparas bokningarna där:

1. Gå till [sheets.google.com](https://sheets.google.com) och skapa ett nytt
   kalkylark. Döp det till t.ex. **Jakobs HusFix – Bokningar**.
2. Klicka **Tillägg → Apps Script**. Ett kodfönster öppnas.
3. Radera allt i filen `Code.gs` och klistra in **hela** innehållet från
   `google-apps-script/Code.gs`.
4. Kontrollera att tidszonen är rätt: **Projektinställningar** (kugghjulet) →
   *Tidszon* → `(GMT+01:00) Stockholm`.
5. Spara med diskettikonen.

> Vill du hellre ha ett helt fristående skript? Gå till
> [script.google.com](https://script.google.com) → **Nytt projekt**. Koden
> skapar då automatiskt ett eget kalkylark första gången en bokning kommer in.

### Steg 2 – Publicera som webbapp

1. Tryck **Deploy (Publicera) → New deployment (Ny distribution)**.
2. Välj typ **Web app** (kugghjulet vid "Select type").
3. **Execute as (Kör som):** `Me (Jag)` – då skickas mejlen från ditt Gmail.
4. **Who has access (Vem har åtkomst):** `Anyone (Vem som helst)` – annars kan
   besökare inte boka.
5. Tryck **Deploy** och godkänn behörigheterna:
   *Välj konto → Advanced → Go to … (unsafe) → Allow*. Det är din egen kod.
6. Kopiera **Web app URL** (den slutar på `/exec`).

### Steg 3 – Snabbtest (frivilligt)

Öppna URL:en i webbläsaren. Du ska se texten *"Bokningssystemet är aktivt…"*.

Testa även tiderna genom att lägga till
`?action=availability&datum=2026-12-05&callback=cb` i slutet av adressen.

### Steg 4 – Koppla sajten till servern

Öppna `index.html` och leta upp raden längst ned:

```js
window.JAKOBS_HUSFIX_CONFIG = {
  bookingApiUrl: "",
  companyEmail: "jakobshusfix@gmail.com"
};
```

Klistra in din URL mellan citattecknen, t.ex.:

```js
window.JAKOBS_HUSFIX_CONFIG = {
  bookingApiUrl: "https://script.google.com/macros/s/AKfy.../exec",
  companyEmail: "jakobshusfix@gmail.com"
};
```

Spara. Klart!

> **Viktigt:** fliken **Konto**, ägarpanelen och tidsmarkeringarna fungerar bara
> när den här adressen är ifylld. Är den tom (eller är den nya `index.html` inte
> uppladdad ännu) svarar inloggningen *"Bokningsservern är inte inkopplad"*.
> Utan steg 4 går det fortfarande att skicka bokningsförfrågningar – de skickas
> då via besökarens e-postprogram i stället.
>
> **Går inloggningen ändå inte igenom?** Kör funktionen `kollaInloggningen` i
> Apps Script. Den går igenom hela kedjan och skriver i loggen exakt vad som
> saknas – kontot, lösenordet, rollen eller publiceringen.

### Steg 5 – Testa hela flödet

1. Öppna sajten och skicka en bokningsförfrågan.
2. Du ska nu få ett mejl till **jakobshusfix@gmail.com**.
3. Klicka på **Godkänn bokningen** i mejlet och sedan på knappen på sidan.
4. Ladda om sajten – tiden ska nu vara borta från listan och gå inte att boka.
5. Testa att **neka** en annan förfrågan – den tiden blir ledig igen.
6. Gör om försöket och svara i stället i **ägarpanelen**: logga in under fliken
   *Konto* (steg 6), öppna fliken **Ägare** och välj dagen i listan. Förfrågan
   står under tiderna med knapparna **Godkänn** och **Neka** – tiden ska byta
   läge direkt, kunden få samma mejl som från mejlets knapp och knapparna
   försvinna när beslutet är taget.

## Konton och ägarpanelen

Rutan med tider på sajten har tre flikar: **Lediga tider**, **Konto** och
**Ägare**. Ägare-fliken är gömd och dyker bara upp för ett inloggat
ägarkonto.

### Steg 6 – Skapa ägarkontot (görs en gång)

Konton kan bara skapas inifrån skriptet – sajten kan aldrig skapa ett konto åt
sig själv. Ägarkontot är redan förberett i `Code.gs`, med ett färdigt
användarnamn och lösenord:

Så här gör du:

1. Öppna skriptet (kalkylarket → **Tillägg → Apps Script**).
2. Välj funktionen `skapaAgarkontot` i listan högst upp och klicka **Kör**.
   Kontot skapas och loggen visar användarnamnet och lösenordet.
3. Öppna sajten, gå till fliken **Konto** och logga in med uppgifterna ovan.
   Ägare-fliken dyker då upp automatiskt.
4. Byt gärna lösenordet efter första inloggningen (se nedan).

Uppgifterna finns i `CONFIG` högst upp i `Code.gs`. Så byter du lösenord:

1. Ändra `OWNER_PASSWORD` i `CONFIG` (och `OWNER_USER` om du vill ha ett annat
   användarnamn) och spara.
2. Kör `skapaAgarkontot` igen – samma konto uppdateras med de nya uppgifterna.
3. Logga in på sajten med de nya uppgifterna.

Kontot ligger i kalkylarket och ändras direkt när du kör funktionen. Webbappen
behöver bara publiceras om (Deploy → Manage deployments → New version) ifall du
har ändrat något annat i `Code.gs`.

Användarnamnet måste vara minst 3 tecken (bokstäver, siffror, punkt, bindestreck
och understreck) och lösenordet minst 8 tecken.

Anställda får egna konton med rollen `personal`. Skriv in deras uppgifter i
`skapaKonto` och kör den en gång, t.ex.
`skapaKonto('stella', 'eget-losenord', 'Stella', 'personal')`. De kan logga in
och titta på tiderna, men de får ingen Ägare-flik och kan inte ändra något –
bara ägarkontot får markera tider.

| Funktion i Apps Script | Vad den gör |
| --- | --- |
| `skapaAgarkontot()` | Skapar eller uppdaterar ägarkontot med uppgifterna i `CONFIG`. Det är den här du kör. |
| `skapaKonto(anvandarnamn, losenord, namn, roll)` | Skapar eller uppdaterar ett konto. Utan egna uppgifter används uppgifterna i `CONFIG`. Rollen är `agare` eller `personal`. |
| `listaKonton()` | Skriver ut alla konton i loggen. |
| `bytLosenord(anvandarnamn, nyttLosenord)` | Byter lösenord för ett konto. |
| `taBortKonto(anvandarnamn)` | Tar bort kontot och loggar ut det överallt. |
| `kollaInloggningen()` | **Felsökning:** skriver ut uppgifterna i `CONFIG`, webbappens adress, kontots roll, om lösenordet stämmer och om en session kan skapas – plus vad som ska åtgärdas. Ändrar inget i kalkylarket (testsessionen tas bort igen). |

Lösenordet sparas aldrig i klartext – kalkylarket innehåller ett salt och en
hash. Inloggningen håller i `SESSION_HOURS` timmar (12 som standard) och sparas
i besökarens webbläsare, så du slipper logga in varje gång.

> **Viktigt:** standardlösenordet står i klartext i `Code.gs`. Den filen laddas
> aldrig upp till sajten (den klistras bara in i Apps Script), men byt
> lösenordet när du har loggat in första gången och lägg inte
> `google-apps-script`-mappen på en publik webbserver.

### Steg 7 – Markera tider i ägarpanelen

Fliken **Ägare** visar de kommande 14 dagarna. Varje dag har en prick som visar
om något är markerat, och varje tid är en knapp med tre lägen:

| Läge i panelen | Betydelse | Vad besökarna ser |
| --- | --- | --- |
| **Bokad** | Tiden är upptagen. | Tiden blir röd i listan och går inte att boka. |
| **Ledig** | Tiden är bokningsbar. | Tiden blir grön och går att boka. |
| **Auto** (grå) | Ingen egen markering – tiden följer ordinarie schema. | Tiden visas bara om den ligger inom öppettiderna. |

* **Markera hela dagen som bokad** markerar alla ordinarie tider på en gång.
* **Återställ dagen** tar bort dagens egna markeringar.
* En tid utanför ordinarie schema (t.ex. 09:00) kan **öppnas som extratid**:
  välj *Ledig* och tiden dyker upp i den offentliga listan och går att boka.
  Välj *Auto* för att stänga den igen.
* En tid som en kund har bokat är **låst**. Den visas med kundens namn och kan
  bara bli ledig igen genom att neka bokningen. *Markera hela dagen* hoppar över
  låsta tider och talar om hur många som lämnades orörda.
* **Förfrågningar godkänns och nekas direkt i panelen.** Under tiderna listas
  dagens kundbokningar, och en förfrågan som väntar på svar har knapparna
  **Godkänn** och **Neka**. Det är samma beslut som mejlets länkar tar – bara
  utan att lämna sajten – och hela dagen ritas om direkt, så att besökarna ser
  ändringen på en gång. Anropet pekar ut förfrågan med sitt `id` (samma id som
  mejlets länkar använder). Skulle dagens bokningar ha hämtats utan `id` – t.ex.
  från en äldre version av sajten – går beslutet ändå igenom: servern letar då
  upp den väntande förfrågan på `datum` + `tid` (och `namn` om flera väntar på
  samma tid), se `decideFromPanel_` och `findBookingOnSlot_`. Ett beslut som
  redan är taget (i mejlet eller i panelen) kan inte tas om: panelen svarar då
  *"Förfrågan är redan godkänd/nekad"* och visar serverns läge.
* Ändringen syns direkt hos alla besökare. Markeringarna är offentliga, men
  **kundnamnen ser bara ägarkontot**.

Bara hela timmar mellan 07:00 och 21:00 kan markeras – övriga tider blir
extratider. Ordinarie öppettider är 15:00–20:00 på vardagar och 10:00–18:00 på
helger.

## Anpassa


Vill du att bokningarna ska gå till en annan adress ändrar du `OWNER_EMAIL`
ovan **och** `companyEmail` i `index.html`, så att båda vägarna går till samma
inkorg. **Kom ihåg:** efter en ändring i `Code.gs` måste webbappen publiceras om
(se "Uppdatera koden" nedan).

`BOOKING_LEAD_MINUTES` är hur långt i förväg en tid måste bokas. Sajten
erbjuder bara tider som ligger minst så många minuter framåt i tiden – även
för dagens datum – och servern säger nej till resten. Samma regel finns i
`js/main.js` (`BOOKING_LEAD_MINUTES`), så ändra på båda ställena.

## Så ser kalkylarket ut

Varje förfrågan blir en rad med kolumnerna:

`ID · Token · Skapad · Status · Namn · Telefon · E-post · Antal fönster ·
Fastighet · Adress · Område · Datum · Tid · Pris (kr) · Meddelande · Beslutad`

**Status** är det viktiga:

| Status | Betydelse |
| --- | --- |
| `Väntar` | Förfrågan är inne, tiden är tillfälligt reserverad. |
| `Bekräftad` | Jakob har godkänt – tiden är bokad och kan inte bokas igen. |
| `Avslagen` | Jakob nekade – tiden är ledig för någon annan. |

Både `Väntar` och `Bekräftad` håller tiden upptagen, så att två personer inte
kan stå i kö på samma tid. Så snart du nekar frigörs tiden.

### Fyra flikar i kalkylarket

| Flik | Innehåll |
| --- | --- |
| `Bokningar` | Alla förfrågningar (kolumnerna ovan). |
| `Konton` | Användarnamn, namn, roll, salt, hash, skapad, senast inloggad. |
| `Tider` | Jakobs markeringar: datum, tid, status (`Bokad` eller `Ledig`), ändrad av, ändrad. En `Auto`-markering tar bort raden igen. |
| `Sessioner` | Aktiva inloggningar. Rader som har gått ut städas automatiskt. |

Flikarna skapas av sig själva första gången de behövs – du behöver inte göra
något i kalkylarket.

## Uppdatera koden senare

1. Redigera `Code.gs` som vanligt och spara.
2. **Deploy → Manage deployments**.
3. Klicka på pennan vid din distribution, välj **Version: New version** och
   tryck **Deploy**. (Annars körs den gamla versionen kvar – cachen och
   dubblettskyddet i den nya koden gäller inte förrän du gör det här.)
4. Kör `installeraVarmhallning` en gång om du vill ha varmhållningen på
   (se **Snabbare svar** nedan). Den behöver bara köras en gång.

## Felsökning

| Problem | Lösning |
| --- | --- |
| Inloggningen går inte igenom och du vet inte varför | Kör funktionen `kollaInloggningen` i Apps Script (välj den i listan högst upp och klicka **Kör**) och läs loggen. Den säger exakt vad som saknas: kontot i fliken `Konton`, lösenordet i `CONFIG`, kontots roll eller själva publiceringen. |
| Inga mejl kommer | Kontrollera att webbappen körs som **Me** och har åtkomst **Anyone**. Titta under **Executions** i vänstermenyn i Apps Script efter felmeddelanden. |
| Inget e-postprogram öppnas hos kunden | Kunden kan använda länkarna i statusraden (mejl, WhatsApp, SMS). Kontrollera att `companyEmail` är ifylld i `index.html`. |
| Sajten visar "Något gick fel" | Kontrollera att `bookingApiUrl` i `index.html` är exakt den URL som slutar på `/exec`. |
| Inloggningen svarar "Bokningssystemet är inte inkopplat just nu. Ring …" | `bookingApiUrl` i `index.html` är tom, eller så är den uppdaterade `index.html` inte uppladdad till webbhotellet. Fyll i `/exec`-adressen (steg 4), ladda upp filen igen och öppna sajten med **Ctrl+F5**. Den tekniska förklaringen står i webbläsarens konsol (F12). |
| Inloggningen "svarar inte" eller att svaret uteblir | Sajten gör ett nytt försök av sig själv (och visar det i rutan), vilket nästan alltid räcker: en webbapp som precis har startat kan ta en halv minut. Svarar den ändå inte, kontrollera att webbappen körs som **Me** med åtkomsten **Anyone** (steg 2) och lägg ut den senaste versionen: **Deploy → Manage deployments**, klicka på pennan och välj **Version: New version → Deploy**. Den tekniska förklaringen står i konsolen (F12). |
| Inloggningen säger "Fel användarnamn eller lösenord" | Kör funktionen `kollaInloggningen` i Apps Script – den visar om kontot finns och om lösenordet stämmer. Saknas kontot: kör `skapaAgarkontot` i Apps Script. Användarnamnet `jakob` kan skrivas med stora eller små bokstäver, lösenordet `JakobsHusFix2026` måste vara exakt. Har du bytt lösenord i `CONFIG` måste du köra `skapaAgarkontot` igen. |
| Tiderna visas inte | Öppna URL:en i webbläsaren – visas inte "Bokningssystemet är aktivt" är publiceringen inte klar. |
| Texten ovan listan säger "Ordinarie öppettider – de bokade tiderna kontrolleras just nu" | Sajten har inte fått svar än, men visar i stället för en tom ruta de ordinarie öppettiderna och fortsätter att försöka i bakgrunden (3, 6, 12, 20 och sedan var 30:e sekund). När svaret kommer byter listan till de riktiga tiderna av sig själv. Står texten kvar länge: kontrollera publiceringen, lägg ut den senaste versionen och sätt på varmhållningen (se "Snabbare svar" nedan). |
| Listan visar bara "Ordinarie öppettider – bokningssystemet är inte inkopplat" | `bookingApiUrl` i `index.html` är tom – fyll i `/exec`-adressen (steg 4) och ladda upp filen igen. |
| Besökaren ser text om "Anyone", "publicerad" eller "/exec" på sajten | Ska inte hända: sådant visas bara i webbläsarens konsol (F12). Ladda upp den senaste `js/main.js` – den äldre versionen skrev ut felsökningstexten i rutan. |
| Sidan hoppar upp till toppen av sig själv | Ska inte hända: listan över lediga tider byts ut på plats (skrolläget sparas) och startsidan hoppar bara till toppen innan besökaren själv har rört sidan. Kommer det tillbaka: öppna konsolen (F12) och se om något annat skript skrollar, och kontrollera att `js/main.js` och `js/effects.js` är de senast uppladdade. |
| Bokningen sparas men sidan bekräftar inte | Öppna kalkylarket och kontrollera raden – mejlet har ändå skickats. |
| Det tar lång tid att markera en tid i ägarpanelen | Markeringen syns direkt och bara ett anrop behövs. Dröjer ändå kvittensen beror det på att webbappen svarar långsamt (kallstart) eller på att en gammal version ligger kvar – lägg ut den senaste: **Deploy → Manage deployments → Version: New version → Deploy** (steg 6). |
| Knapparna **Godkänn**/**Neka** i ägarpanelen gör ingenting, eller svarar "Bokningssystemet är en äldre version och känner inte igen godkännandet…" | Den version av webbappen som är utlagd är äldre än `Code.gs` och känner inte igen panelens anrop (`action=decision`). Lägg ut den senaste versionen: **Deploy → Manage deployments → pennan → Version: New version → Deploy** – och ladda om sajten med **Ctrl+F5** (webbläsaren har kvar den gamla `js/main.js`). |
| "Kunde inte läsa förfrågan. Uppdatera dagen och försök igen." i ägarpanelen | Rader i listan saknade allt som behövs för att peka ut förfrågan. Panelen skickar med `id`, och annars `datum`, `tid` och `namn`, så meddelandet betyder i praktiken att sidan är mycket gammal: ladda om med **Ctrl+F5** och lägg ut senaste versionen i Apps Script om det inte hjälper (se raden ovan). |
| "Förfrågan är redan godkänd/nekad" i ägarpanelen | Någon har redan svarat – mejlets knapp, en annan flik eller en kollega. Panelen visar serverns läge i stället, och tiden är uppdaterad. |
| "Tiden … är redan bekräftad för en annan bokning" | Två kunder har skickat en förfrågan på samma tid och den ena är redan godkänd. Neka den andra förfrågan – då blir tiden ledig igen och kunden får ett mejl. |
| Hur ser jag vilken version som ligger ute? | Skicka ett tomt anrop till webbappen: `curl -X POST -d "action=decision&svar=ja" "<adressen som slutar på /exec>"`. Svarar den `"message":"Okänd åtgärd."` är den utlagda versionen äldre än `Code.gs` – lägg ut en ny version (raden ovan). Svarar den `"message":"Din inloggning har gått ut. …"` finns panelens godkännande/nekande med i den utlagda versionen. |
| Det tar lång tid innan listan får riktiga tider | En webbapp som inte har använts på en stund startar om från början (kallstart) och kan då ta en halv minut om den dessutom måste öppna kalkylarket. Sajten visar listan direkt (ordinarie öppettider med texten att de bokade tiderna kontrolleras), försöker om av sig själv och byter till de riktiga tiderna så snart svaret kommer. Bästa botemedlet är de två cacharna och varmhållningen i **Snabbare svar** nedan – se särskilt till att den senaste versionen är utlagd. |
| "Det tog för lång tid" | Tillfälligt nätverksproblem. Be kunden försöka igen. |

## Snabbare svar (två cachar och en frivillig varmhållning)

Tvåveckorslistan frågar efter bokningar och markeringar för var och en av de 14
dagarna. Förut lästes kalkylarket om för varje dag – ett tjugotal läsningar per
anrop, och varje läsning kostar tid hos Google. Nu finns tre saker som gör svaret
snabbt:

1. **Cache under ett anrop** (`JH_MEMO_` högst upp i `Code.gs`). Kalkylarket och
   de inlästa raderna sparas under det anrop som pågår och töms i början av varje
   anrop och varje gång något skrivs – svaret bygger alltid på färsk data.
2. **Delad cache mellan besökare** (`rangeCache_`, 5 minuter). Svaret på
   tvåveckorslistan är likadant för alla och läggs i Googles cache, så flera
   besökare (och sajtens egen uppdatering var 45:e sekund) delar på samma
   uträkning. **Den här delen rör inte kalkylarket alls**, och det är den stora
   vinsten: ett svar som annars tar tjugo sekunder kommer på ett par sekunder.
   Varje skrivning – en bokning, ett godkännande i mejlet, ett svar i
   ägarpanelen eller en markering i panelen – höjer en versionsstämpel, och då
   gäller de gamla svaren inte längre. En ändring syns därför direkt, trots
   cachen.
3. **Varmhållning (frivillig, men rekommenderad).** Välj funktionen
   `installeraVarmhallning` i listan högst upp i Apps Script och klicka **Kör** en
   gång. Den skapar en utlösare som anropar `varmhallAppen` var femte minut, så
   att webbappen inte hinner somna. Vill du stänga av den: ta bort utlösaren
   under klockikonen (**Triggers**) i vänstermenyn.

Sajten klarar sig utan punkt 3 – den visar då ordinarie öppettider, säger att de
bokade tiderna kontrolleras och fyller på så snart svaret kommer – men med
varmhållningen på plats är listan alltid färdig på ett par sekunder.

**Den nya versionen måste läggas ut för att cacharna ska gälla:**
**Deploy → Manage deployments → pennan → Version: New version → Deploy**.

## Kvoter och säkerhet

* Ett gratis Gmail-konto får skicka 100 mejl per dygn – det räcker gott.
* Godkännande/nekande sker via en säker slumpad länk och kräver dessutom ett
  extra klick på en bekräftelsesida, så att e-postprogram som förhandsgranskar
  länkar inte råkar svara av misstag.
* Samma beslut kan tas i ägarpanelen, men då krävs ett inloggat ägarkonto.
  Servern tar ett scriptlås runt beslutet, så att ett klick i panelen och ett
  klick i mejlet aldrig kan godkänna två förfrågningar på samma tid.
* Servern kontrollerar alltid tiderna en extra gång innan en bokning sparas,
  så att samma tid inte kan bokas två gånger.

## Testa koden lokalt (frivilligt)

Om du vill kontrollera att `Code.gs` fungerar efter en ändring kan du köra
testskriptet från projektets rotmapp:

```powershell
cscript //nologo google-apps-script\test-backend.js
```

Alla kontroller ska visa `PASS`, och sista raden ska säga `0 misslyckade`.
Testet kör den riktiga `Code.gs` mot ett låtsaskalkylark och kontrollerar bland
annat:

* att en bokning sparas, mejlas till Jakob och låser tiden,
* att godkännande och nekande fungerar (med det extra klicket),
* att konton skapas och att fel lösenord nekas,
* att ägarkontot skapas med uppgifterna i `CONFIG` (`skapaAgarkontot`) och att
  det går att logga in med dem,
* att felsökningen `kollaInloggningen` godkänner uppgifterna i `CONFIG`, säger
  till när kontot saknas och inte lämnar någon session efter sig,
* att ägarkontot skiljs från personalen och att bara ägarkontot får ändra
  tider,
* att markeringarna `Bokad`, `Ledig` och `Auto` gör rätt sak,
* att en extratid utanför schemat kan öppnas och stängas igen,
* att en kundbokning är låst och inte kan ändras i ägarpanelen,
* att gäster aldrig får se kundnamn eller bokningsdetaljer.

Testet behöver ingen publicerad webbapp – det körs helt lokalt på Windows.


