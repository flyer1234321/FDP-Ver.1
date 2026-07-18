// Regressionstester för FDP-räknaren — kör med:  node fdp-tests.mjs
// Läser index.html i samma mapp, extraherar beräkningslogiken och kör referensfall
// mot EASA ORO.FTL / CS FTL.1 (inkl. exempel från EASA:s FAQ).
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]
  .replace('"use strict";', '')
  .replace(/\blet\b/g, 'var').replace(/\bconst\b/g, 'var'); // gör tillstånd åtkomligt efter eval

// Minimal DOM-shim så skriptet kan laddas utan webbläsare
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
try { globalThis.navigator = {}; } catch { /* Node ≥21 har inbyggd navigator */ }
const els = {};
globalThis.document = {
  documentElement: { setAttribute() {} },
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: id => els[id] || (els[id] = { innerHTML: '', addEventListener() {}, classList: { toggle() {}, contains: () => false } }),
};
(0, eval)(src);

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok ? '' : `  — fick ${actual}, väntade ${expected}`));
}

console.log('— Tabell 2 (ORO.FTL.205(b)(1)) —');
eq('06:00, 2 sektorer → 13:00', fmt(lT2('06:00', 2)), '13:00');
eq('13:29, 2 sektorer → 13:00', fmt(lT2('13:29', 2)), '13:00');
eq('13:30, 2 sektorer → 12:45', fmt(lT2('13:30', 2)), '12:45');
eq('17:00, 1 sektor  → 11:00', fmt(lT2('17:00', 1)), '11:00');
eq('04:00, 2 sektorer → 11:00 (nattband)', fmt(lT2('04:00', 2)), '11:00');
eq('05:00, 3 sektorer → 11:30', fmt(lT2('05:00', 3)), '11:30');
eq('12:00, 4 sektorer → 12:00', fmt(lT2('12:00', 4)), '12:00');
eq('06:00, 10 sektorer → 9:00 (golv)', fmt(lT2('06:00', 10)), '9:00');

console.log('— Tabell 3 (okänd acklimatisering) —');
eq('2 sektorer → 11:00', fmt(lT3(2)), '11:00');
eq('4 sektorer → 10:00', fmt(lT3(4)), '10:00');
eq('8 sektorer → 9:00 (golv)', fmt(lT3(8)), '9:00');

console.log('— Acklimatisering (ORO.FTL.105(1), Tabell 1) —');
const TT = L.sv;
eq('<2h tidsskillnad → B', acclim(1, 200, TT).code, 'B');
eq('5h skillnad, <48h → B', acclim(5, 24, TT).code, 'B');
eq('5h skillnad, 60h → X', acclim(5, 60, TT).code, 'X');
eq('5h skillnad, 100h → D', acclim(5, 100, TT).code, 'D');
eq('11h skillnad, 100h → X', acclim(11, 100, TT).code, 'X');

console.log('— Flygplatsstandby (CS FTL.1.225(a), EASA FAQ) —');
mode = 'standby';
S.sbyType = 'airport'; S.asbSplit = false; S.sbyStart = '06:00'; S.reportTime = '12:00'; S.offTime = '20:00'; S.sectors = 4;
let c = calcSby();
eq('ASB 6h före FDP: bas 12:00 − (6−4)h → gräns 10:00', fmt(c.redLimit), '10:00');
eq('Kombinerad ASB+FDP-gräns = 16:00', c.awLim, 960);
eq('ASB räknas fullt som duty', c.dc, 360);

console.log('— Hemma-standby (CS FTL.1.225(b)) —');
S.sbyType = 'other'; S.isCalled = true; S.aug = false; S.split = false;
S.sbyStart = '04:00'; S.sbyEnd = '16:00'; S.callTime = '10:30'; S.reportTime = '15:00'; S.offTime = '21:00'; S.sectors = 3;
c = calcSby();
eq('SBY→report 11:00', fmt(c.sbyBefore), '11:00');
eq('Nattkredit 04:00–07:00 = 3:00', fmt(c.nc), '3:00');
eq('Avdrag = (11−6) − 3 = 2:00', fmt(c.red), '2:00');
eq('Bas 15:00/3 sektorer = 11:30', fmt(c.baseFDP), '11:30');
eq('Gräns = 11:30 − 2:00 = 9:30', fmt(c.redLimit), '9:30');

console.log('— Split duty (CS FTL.1.220) —');
eq('Rast 4h från 10:00, ej suitable → 4:00 räknas', fmt(splitBreakCountable('10:00', 4, false)), '4:00');
eq('Rast 8h från 10:00, ej suitable → 6:00 (6h-tak)', fmt(splitBreakCountable('10:00', 8, false)), '6:00');
eq('Rast 5h från 01:00, ej suitable → 1:00 (WOCL exkl.)', fmt(splitBreakCountable('01:00', 5, false)), '1:00');
eq('Rast 8h, suitable accommodation → 8:00 (hela rasten)', fmt(splitBreakCountable('10:00', 8, true)), '8:00');

console.log('— Lokala nätter (ORO.FTL.105(15): 8h inom 22:00–08:00) —');
eq('Vila 20:00 + 12h → 1 natt', localNights('20:00', 12), 1);
eq('Vila 23:00 + 8.5h (23:00–07:30) → 1 natt', localNights('23:00', 8.5), 1);
eq('Vila 23:00 + 7h → 0 nätter', localNights('23:00', 7), 0);
eq('Vila 20:00 + 36h → 2 nätter', localNights('20:00', 36), 2);

console.log('— Disruptive schedule (ORO.FTL.105(8)) —');
let d = disruptive('05:30', '15:00', 'early');
eq('Early type: incheck 05:30 → early start', d.early, true);
d = disruptive('06:30', '15:00', 'early');
eq('Early type: incheck 06:30 → ej early start', d.early, false);
d = disruptive('06:30', '15:00', 'late');
eq('Late type: incheck 06:30 → early start', d.early, true);
d = disruptive('15:00', '23:30', 'early');
eq('Early type: utcheck 23:30 → late finish', d.late, true);
d = disruptive('15:00', '23:30', 'late');
eq('Late type: utcheck 23:30 → ej late finish', d.late, false);
d = disruptive('15:00', '00:30', 'late');
eq('Late type: utcheck 00:30 → late finish', d.late, true);

console.log('— In-flight rest & E1/CD (CS FTL.1.205, ORO.FTL.205(f), FAQ 47599) —');
mode = 'normal'; nView = 'advanced';
N.report = '08:00'; N.off = '22:00'; N.sectors = 2; N.tz = 0; N.hrs = 0;
N.restFac = 'class1'; N.extraCrew = 1; N.split = false; N.ext = false; N.cd = false; N.longSector = false;
let n = calcNorm();
eq('1 extra, klass 1 → 16:00', fmt(n.lim), '16:00');
N.longSector = true; n = calcNorm();
eq('+ lång sektor (>9h, ≤2 sektorer) → 17:00', fmt(n.lim), '17:00');
N.restFac = 'none'; N.extraCrew = 0; N.longSector = false;
N.report = '08:00'; N.sectors = 2; N.ext = true; N.cd = true; n = calcNorm();
eq('E1 (+1h) + CD delar 2h-pott → bas 13:00 + 2:00 = 15:00', fmt(n.lim), '15:00');
N.ext = false; n = calcNorm();
eq('Enbart CD → bas 13:00 + 2:00 = 15:00', fmt(n.lim), '15:00');
N.cd = false; n = calcNorm();
eq('Utan förlängning → 13:00', fmt(n.lim), '13:00');

console.log('— Vila (ORO.FTL.235) —');
N.prevDuty = 13; N.prevRest = 12; n = calcNorm();
eq('Vila 12h < föreg. duty 13h → underkänd', n.rOk, false);
N.prevRest = 13; n = calcNorm();
eq('Vila 13h ≥ föreg. duty 13h → godkänd', n.rOk, true);
N.away = true; N.prevDuty = 8; N.prevRest = 10; n = calcNorm();
eq('Borta från bas: 10h räcker', n.rOk, true);
N.away = false; n = calcNorm();
eq('Hemma: 10h räcker inte (min 12h)', n.rOk, false);

console.log('\n' + pass + ' godkända, ' + fail + ' underkända');
process.exit(fail ? 1 : 0);
