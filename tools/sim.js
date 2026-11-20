// 灯りの岬の早回し。index.html の表（GENS・UPS・SHIP_KINDS・ACHS など）をそのまま読み、
// 「1秒に3回磨く・回収まで考えていちばんお得な物を買う・金の船は全部（出て3秒で）導く・生き物も触る・広告なし」で回す。
// 使い方: node tools/sim.js index.html [時間=3] [種の数=4]（DEBUG=1 で最長の買い物間隔・新しい物の時刻・日誌の節目も出す）
'use strict';
const fs = require('fs');
const file = process.argv[2], HOURS = +(process.argv[3] || 3), NSEED = +(process.argv[4] || 4);
const src = fs.readFileSync(file, 'utf8');

function grab(name) {
  const m = src.match(new RegExp('var ' + name + ' = '));
  if (!m) return undefined;
  let i = m.index + m[0].length, open = src[i], close = open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) { const e = src.indexOf(';', i); return Function('return (' + src.slice(i, e) + ')')(); }
  let d = 0, j = i, q = null;
  for (; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === open) d++; else if (c === close) { d--; if (!d) break; }
  }
  return Function('return (' + src.slice(i, j + 1) + ')')();
}
function num(name, dflt) { const m = src.match(new RegExp('[ ,]' + name + ' = ([0-9.e]+)[,;]')); return m ? +m[1] : dflt; }

const GENS = grab('GENS'), UPS = grab('UPS'), RANKS = grab('RANKS').map(r => r[0]);
const SHIP_KINDS = grab('SHIP_KINDS');             // B があれば
const ACHS = grab('ACHS');                         // C があれば
const SHIP_SEC = num('SHIP_SEC', 45);
const SHIP_MIN = num('SHIP_MIN', +((src.match(/Math\.max\((\d+), cps\(\) \* 45\)/) || [0, 100])[1]));
const FOG_SHIP = num('FOG_SHIP_RATE', 1);          // E1 があれば 2
const ACH_X = num('ACH_X', 0.01);
const KINDS = [['octopus', 34, 8, 20], ['seal', 28, 12, 30], ['gull', 28, 6, 15], ['whale', 10, 40, 150]];
const GI = {}; GENS.forEach((g, i) => GI[g.id] = i);

function sim(seed, T) {
  let r = seed * 7919 + 13;
  const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
  const NG = GENS.length;
  const S = { light: 0, total: 0, taps: 0, guided: 0, owned: GENS.map(() => 0), ups: new Set(), met: {}, ach: new Set(), shipN: { cargo: 0, fest: 0, mirror: 0 }, rank: 0 };
  const gm = GENS.map(() => 1);
  let allU = 1, tapM = 1, share = 0, pages = 0, gapDiv = 1, longX = 1, cargoX = 1;
  const allM = () => allU * (1 + 0.05 * Object.keys(S.met).length) * (1 + ACH_X * S.ach.size * (1 + pages));
  const cpsB = () => { let s = 0; for (let i = 0; i < NG; i++) s += S.owned[i] * GENS[i].cps * gm[i]; return s * allM(); };
  let gold = false, fest = 0, mirror = 0, fog = false;
  const festX = () => (fest > 0 && SHIP_KINDS ? SHIP_KINDS.fest.x : 1);
  const cpsNow = () => cpsB() * (gold ? 1.5 : 1) * festX();
  const shown = i => i === 0 || S.owned[i - 1] > 0 || S.owned[i] > 0 || S.total >= GENS[i].base * 0.5;
  const upVis = u => !S.ups.has(u.id) && S.total >= u.cost * 0.25 &&
    (!u.gen || S.owned[GI[u.gen]] >= (u.need || 1)) && (!u.guided || S.guided >= u.guided) && (!u.achs || S.ach.size >= u.achs);
  const seen = new Set(), ev = [], buys = [], dead = [];
  let deadAt = null, t = 0;
  const dt = 1 / 3;
  let nextShip = 10, ship = null, nextCr = 52.5, cr = null, fogT = 70 + rnd() * 60, fogL = 0;
  const achAt = []; let festTime = 0, comboTime = 0, ranks = [], events = { fogShip: 0, goldFest: 0, festCargo: 0 };
  function apply(u) {
    S.ups.add(u.id);
    if (u.gen) gm[GI[u.gen]] *= 2;
    if (u.all) allU *= u.all;
    if (u.tap) tapM *= u.tap;
    if (u.share) share += u.share;
    if (u.page) pages++;
    if (u.ship === 'gap') gapDiv *= u.x;
    if (u.ship === 'long') longX *= u.x;
    if (u.ship === 'cargo') cargoX *= u.x;
  }
  function achDone(a) {
    const c = cpsB();
    switch (a.k) {
      case 'total': return S.total >= a.n;
      case 'cps': return c >= a.n;
      case 'taps': return S.taps >= a.n;
      case 'guided': return S.guided >= a.n;
      case 'ship': return S.shipN[a.kind] >= a.n;
      case 'own': return S.owned[GI[a.gen]] >= a.n;
      case 'ups': return S.ups.size >= a.n;
      case 'metAll': return Object.keys(S.met).length >= KINDS.length;
      case 'met': return (S.met[a.kind] || 0) >= a.n;
      case 'rank': return S.rank >= a.n;
      case 'ev': return ({ eFogShip: events.fogShip, eGoldFest: events.goldFest, eFestCargo: events.festCargo })[a.id] > 0;
      default: return false;
    }
  }
  while (t < T) {
    const dayT = t % 480; gold = dayT >= 260 && dayT < 305;
    if (fest > 0) { festTime += dt; if (gold) comboTime += dt; }
    fest -= dt; mirror -= dt;
    const whole = Math.abs(t - Math.round(t)) < 1e-6;
    if (whole) {
      if (ACHS) ACHS.forEach(a => { if (!S.ach.has(a.id) && achDone(a)) { S.ach.add(a.id); if (S.ach.size % 10 === 0 || S.ach.size === 35) achAt.push([S.ach.size, t, S.total]); } });
      for (let i = 0; i < NG; i++) if (shown(i) && !seen.has('g' + i)) { seen.add('g' + i); ev.push([t, GENS[i].id]); }
      UPS.forEach(u => { if (upVis(u) && !seen.has(u.id)) { seen.add(u.id); ev.push([t, u.id]); } });
      // 何も買えない時間
      let minC = Infinity;
      for (let i = 0; i < NG; i++) if (shown(i)) minC = Math.min(minC, Math.ceil(GENS[i].base * Math.pow(1.15, S.owned[i])));
      UPS.forEach(u => { if (upVis(u)) minC = Math.min(minC, u.cost); });
      if (S.light < minC) { if (deadAt === null) deadAt = t; } else if (deadAt !== null) { dead.push([deadAt, t]); deadAt = null; }
      for (let guard = 0; guard < 100; guard++) {
        const cb = cpsB(), am = allM(), inc0 = cb + 3 * (tapM + cb * share);
        const shipShare = 0.6;   // 金の船が運ぶ光は毎秒のおよそ6割（採点用のおおよそ）
        let best = null, bs = Infinity;
        const consider = (cost, d, act) => { if (d <= 0) return; const sc = Math.max(0, cost - S.light) / inc0 + cost / d; if (sc < bs) { bs = sc; best = { cost, act }; } };
        for (let i = 0; i < NG; i++) if (shown(i)) {
          const c = Math.ceil(GENS[i].base * Math.pow(1.15, S.owned[i]));
          consider(c, GENS[i].cps * gm[i] * am * (1 + 3 * share), () => { S.owned[i]++; buys.push([t, GENS[i].id]); });
        }
        UPS.forEach(u => {
          if (!upVis(u)) return;
          let d = 0;
          if (u.gen) d = S.owned[GI[u.gen]] * GENS[GI[u.gen]].cps * gm[GI[u.gen]] * am * (1 + 3 * share);
          else if (u.all) d = cb * (u.all - 1) * (1 + 3 * share);
          else if (u.tap) d = 3 * tapM * (u.tap - 1);
          else if (u.share) d = 3 * cb * u.share;
          else if (u.page) d = cb * ACH_X * S.ach.size / (1 + ACH_X * S.ach.size * (1 + pages));
          else if (u.ship === 'gap') d = cb * shipShare * (u.x - 1);
          else if (u.ship === 'long') d = cb * 0.35 * (u.x - 1);
          else if (u.ship === 'cargo') d = cb * 0.5 * (u.x - 1);
          consider(u.cost, d, () => { apply(u); buys.push([t, u.id]); });
        });
        if (best && S.light >= best.cost) { S.light -= best.cost; best.act(); } else break;
      }
    }
    // 収入
    const c = cpsNow();
    const tp = (tapM + c * share) * (mirror > 0 && SHIP_KINDS ? SHIP_KINDS.mirror.x : 1);
    const g = c * dt + tp; S.light += g; S.total += g; S.taps++;
    // 霧（霧笛を持っているときだけ）
    if (S.owned[GI.horn] > 0) { if (fogL > 0) { fogL -= dt; } else { fogT -= dt; if (fogT <= 0) { fogL = 22 + rnd() * 12; fogT = 100 + rnd() * 80; } } }
    fog = fogL > 0;
    // 金の船
    if (!ship) { nextShip -= dt * (fog ? FOG_SHIP : 1); if (nextShip <= 0) {
      let kind = 'cargo';
      if (SHIP_KINDS && S.guided > 0) {
        const w = {}; let sum = 0;
        for (const k in SHIP_KINDS) { w[k] = (k === 'fest' && fest > 0) || (k === 'mirror' && mirror > 0) ? 0 : SHIP_KINDS[k].w; sum += w[k]; }
        let x = rnd() * sum; for (const k in w) { x -= w[k]; if (x <= 0) { kind = k; break; } }
      }
      ship = { t0: t, done: false, kind };
    } } else {
      if (!ship.done && t - ship.t0 >= 3) {
        ship.done = true; S.guided++; S.shipN[ship.kind]++;
        if (fog) events.fogShip++;
        if (ship.kind === 'cargo') { if (fest > 0) events.festCargo++; const rw = Math.max(SHIP_MIN, cpsNow() * SHIP_SEC * cargoX); S.light += rw; S.total += rw; }
        else if (ship.kind === 'fest') { fest = SHIP_KINDS.fest.sec * longX; if (gold) events.goldFest++; }
        else { mirror = SHIP_KINDS.mirror.sec * longX; }
      }
      if (t - ship.t0 >= 29) { ship = null; nextShip = (25 + rnd() * 25) / gapDiv; }
    }
    if (fest > 0 && gold) events.goldFest++;
    // 生き物
    if (!cr) { nextCr -= dt; if (nextCr <= 0) cr = { t0: t }; }
    else if (t - cr.t0 >= 2) {
      let x = rnd() * 100, k = KINDS[0]; for (const kk of KINDS) { x -= kk[1]; if (x <= 0) { k = kk; break; } }
      const rw = Math.max(k[3], cpsNow() * k[2]); S.light += rw; S.total += rw; S.met[k[0]] = (S.met[k[0]] || 0) + 1;
      cr = null; nextCr = 45 + rnd() * 45;
    }
    const range = 3 + 1.5 * Math.log10(1 + S.total);
    while (S.rank < RANKS.length - 1 && range >= RANKS[S.rank + 1]) { S.rank++; ranks.push([t, S.rank]); }
    t += dt;
  }
  if (deadAt !== null) dead.push([deadAt, T]);
  return { achAt, ev, buys, dead, ranks, festTime, comboTime, shipN: S.shipN, guided: S.guided, ach: S.ach.size, T };
}

const W = [0, 10, 20, 30, 45, 60, 90, 120, 150, 180].filter(x => x <= HOURS * 60);
const rows = {}, rk = {}, rkn = {};
let festPct = 0, comboPct = 0, kinds = { cargo: 0, fest: 0, mirror: 0 }, achN = 0;
for (let sd = 1; sd <= NSEED; sd++) {
  const R = sim(sd, HOURS * 3600);
  if (process.env.DEBUG && sd === 1) {
    const g = []; for (let i = 1; i < R.buys.length; i++) g.push([R.buys[i][0] - R.buys[i - 1][0], R.buys[i - 1][0], R.buys[i][1]]);
    g.sort((a, b) => b[0] - a[0]); console.log('最長の買い物間隔:', g.slice(0, 10).map(x => (x[0] / 60).toFixed(1) + '分→' + x[2] + '@' + (x[1] / 60).toFixed(0)).join(' | '));
    console.log('日誌:', R.achAt.map(a => a[0] + '件@' + (a[1] / 60).toFixed(0) + '分(合計' + a[2].toExponential(1) + ')').join(' '));
    console.log('新しい物:', R.ev.map(e => e[1] + '@' + (e[0] / 60).toFixed(0)).join(' '));
  }
  R.ranks.forEach(([t, k]) => { rk[k] = (rk[k] || 0) + t; rkn[k] = (rkn[k] || 0) + 1; });
  festPct += R.festTime / R.T / NSEED; comboPct += R.comboTime / R.T / NSEED; achN += R.ach / NSEED;
  for (const k in kinds) kinds[k] += R.shipN[k] / R.guided / NSEED;
  for (let i = 0; i < W.length - 1; i++) {
    const a = W[i] * 60, b = W[i + 1] * 60, key = W[i] + '–' + W[i + 1] + '分';
    const o = rows[key] = rows[key] || { n: 0, wn: 0, gb: 0, gbw: 0, dead: 0, dmax: 0 };
    const evs = R.ev.filter(e => e[0] >= a && e[0] < b).map(e => e[0]);
    let p = [a, ...evs, b], mg = 0; for (let j = 1; j < p.length; j++) mg = Math.max(mg, p[j] - p[j - 1]);
    const bt = R.buys.filter(e => e[0] >= a && e[0] < b).map(e => e[0]);
    let q = [a, ...bt, b], mb = 0; for (let j = 1; j < q.length; j++) mb = Math.max(mb, q[j] - q[j - 1]);
    const ds = R.dead.map(([x, y]) => [Math.max(x, a), Math.min(y, b)]).filter(([x, y]) => y > x);
    o.n += evs.length / NSEED; o.wn += mg / 60 / NSEED; o.gb += mb / 60 / NSEED; o.gbw = Math.max(o.gbw, mb / 60);
    o.dead += ds.reduce((s, [x, y]) => s + y - x, 0) / 60 / NSEED;
    o.dmax = Math.max(o.dmax, ...ds.map(([x, y]) => (y - x) / 60), 0);
  }
}
console.log('| 時間 | 新しく出た物 | 次の新しい物までの最長 | 買い物の最長の間隔（平均／いちばん長い種） | 何も買えない時間（最長） |');
console.log('|---|---|---|---|---|');
for (const k in rows) { const o = rows[k]; console.log(`| ${k} | ${o.n.toFixed(1)} | ${o.wn.toFixed(1)}分 | ${o.gb.toFixed(1)}分／${o.gbw.toFixed(1)}分 | ${o.dead.toFixed(1)}分（${o.dmax.toFixed(1)}分） |`); }
const names = grab('RANKS').map(r => r[1]);
console.log('格: ' + Object.keys(rk).map(k => names[k] + ' ' + (rk[k] / rkn[k] / 60).toFixed(0) + '分' + (rkn[k] < NSEED ? `(${rkn[k]}/${NSEED})` : '')).join(' → '));
if (SHIP_KINDS) console.log(`金の船: 積み荷 ${(kinds.cargo * 100).toFixed(0)}% / 灯祭り ${(kinds.fest * 100).toFixed(0)}% / 鏡職人 ${(kinds.mirror * 100).toFixed(0)}%、灯祭りの時間 ${(festPct * 100).toFixed(1)}%、凪と重なる ${(comboPct * 100).toFixed(2)}%`);
if (ACHS) console.log(`日誌: ${HOURS}時間で平均 ${achN.toFixed(1)}件 / ${ACHS.length}`);
