import './style.css';
import { createLive } from './data/live.js';
import { createDemo } from './data/demo.js';
import { createGeo } from './geo.js';
import { createMap } from './map.js';
import {
  PAL, COLORS, RADII, DURS, FEE, HOME_CENTER, I, mark, esc, r2, money, cash, now, clock, ago, distM, miles,
  digits, fmtPhone, cleanHandle, hash, store, buzz
} from './util.js';

/* ---------- backend: live if keys exist, demo otherwise ---------- */
const URL_ = import.meta.env.VITE_SUPABASE_URL, KEY_ = import.meta.env.VITE_SUPABASE_ANON_KEY;
const api = URL_ && KEY_ ? createLive(URL_, KEY_) : createDemo();
const D = api.D;
// Opened from an email sign-in link? (Supabase puts the session in the URL hash.)
const cameFromLink = /access_token=|type=(signup|magiclink|email_change)/.test(location.hash);

/* ---------- app state ---------- */
const S = {
  screen: 'loading', cur: null, sel: null, sheet: 'peek', filter: 'all', codeOpen: false,
  note: '', codeInput: '', compose: null, busy: false, toast: null, landed: null,
  su: { kind: 'phone', value: '', code: '', handle: '', err: '', upgrading: false, sent: false },
  editHandle: false, payFor: null, payPick: 'card', paySkipped: false,
  dragging: false, pending: false, lastKey: '', mapScreen: null, homeView: store('homeView') || null,
  dismissedLoc: false
};
const geo = createGeo(kind => {
  if (kind === 'gps' && S.screen === 'home' && !S.centeredOnGps && geo.gps && !geo.pretend) { S.centeredOnGps = true; if (M) M.fly(geo.gps.lat, geo.gps.lng, 15.5, 120); }
  render();
});

/* ---------- helpers on data ---------- */
const uid = () => D.user && D.user.id;
const me = () => D.me || { handle: '', balance: null, payout: null, follows: [], cashouts: [] };
const pos = () => geo.pos;
function status(d) { if (d.endedAt) return 'ended'; if (now() >= d.expiresAt) return 'expired'; if (d.claimed >= d.maxPeople) return 'full'; return 'live'; }
const isMine = d => D.mine.has(d.id);
const claimsOf = id => Object.values(D.claims).filter(c => c.dropId === id).sort((a, b) => b.at - a.at);
const hasClaimed = d => Object.values(D.claims).some(c => c.dropId === d.id && c.userId === uid());
const isFollowing = id => !!id && me().follows.includes(id);
const dist = d => { const p = pos(); return p ? distM(d, p) : Infinity; };
const inside = d => { const p = pos(); return !!p && distM(d, p) <= d.r + Math.min(p.acc || 0, 30); };
const secsLeft = d => (d.expiresAt - now()) / 1000;
const live = () => Object.values(D.drops).filter(d => status(d) === 'live');
const handleOf = id => D.handles[id] || '';
function byline(d) { if (d.official) return 'Blimp'; if (isMine(d)) return 'You'; return d.ownerHandle ? '@' + d.ownerHandle : 'Anonymous dropper'; }
const zoomFor = r => 17 - Math.log2(r / 45);

/* ---------- map (one instance, moved between screens) ---------- */
const mapEl = document.createElement('div'); mapEl.id = 'mapbox';
let M = null;
function mapTap(ll) {
  if (geo.pretend || !geo.gps) { geo.setPretend(ll); if (!S.pretendTip) { S.pretendTip = true; S.note = 'Pretend location set. Turn it off in the You tab to use real GPS.'; } return; }
  if (S.screen === 'home' && S.sel) { S.sel = null; render(); }
}
function mapPick(id) {
  if (S.screen === 'home') { if (S.sel === id) open(id); else { S.sel = id; render(); scrollCard(id); } }
  else if (id !== S.cur) open(id);
}
function placeMap() {
  const slot = document.querySelector('[data-map-slot]');
  if (!slot) { S.mapScreen = null; return; }
  slot.prepend(mapEl);
  if (!M) { M = createMap(mapEl, { onTap: mapTap, onPick: mapPick }); if (S.homeView) M.jump(S.homeView.lat, S.homeView.lng, S.homeView.zoom); }
  M.resize();
  const p = pos();
  if (S.screen === 'home') {
    const ds = live().filter(d => d.visibility === 'public' || isMine(d) || D.drops[d.id]);
    M.set({ drops: filtered(ds), focus: null, sel: S.sel, claims: [], me: p });
    if (S.mapScreen !== 'home') {
      if (S.homeView) M.jump(S.homeView.lat, S.homeView.lng, S.homeView.zoom);
      else if (p) M.jump(p.lat, p.lng, 15.5); else M.jump(HOME_CENTER.lat, HOME_CENTER.lng, 15.2);
    }
  } else {
    const d = D.drops[S.cur]; if (!d) return;
    M.set({ drops: [d], focus: d.id, sel: null, claims: S.screen === 'mine' ? claimsOf(d.id) : [], me: p });
    if (S.mapScreen !== S.screen + d.id) M.jump(d.lat, d.lng, zoomFor(d.r));
  }
  S.mapScreen = S.screen === 'home' ? 'home' : S.screen + (S.cur || '');
}
function saveHomeView() { if (M && S.mapScreen === 'home') { S.homeView = M.view(); store('homeView', S.homeView); } }

/* ---------- actions ---------- */
function go(screen) {
  if (S.screen === 'home' && screen !== 'home') saveHomeView();
  S.screen = screen; S.note = ''; S.su.err = ''; render(); try { window.scrollTo(0, 0); } catch (e) { }
}
async function run(fn) {
  if (S.busy) return; S.busy = true; render();
  try { await fn(); } catch (e) { S.note = (e && e.message) || 'Something went wrong. Try again.'; S.su.err = S.screen.startsWith('su-') ? S.note : ''; }
  S.busy = false; render();
}
function open(id) {
  const d = D.drops[id]; if (!d) return;
  S.cur = id; S.sel = id; S.toast = null;
  go(isMine(d) ? 'mine' : 'drop');
}
function scrollCard(id) { setTimeout(() => { const el = document.querySelector('.dcard[data-v="' + CSS.escape(id) + '"]'); try { el && el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); } catch (e) { } }, 30); }

// sign-up
function suSend() {
  const k = S.su.kind, v = k === 'phone' ? digits(S.su.value) : S.su.value.trim();
  if (k === 'phone' && v.length !== 10) { S.su.err = 'Enter a 10-digit US number.'; return render(); }
  if (k === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { S.su.err = 'Enter a real email.'; return render(); }
  run(async () => { S.su.upgrading = await api.sendCode(k, k === 'phone' ? '+1' + v : v); S.su.sent = true; S.su.code = ''; go('su-code'); });
}
function suVerify() {
  const c = S.su.code.replace(/\D/g, ''); if (c.length !== 6) { S.su.err = 'Enter all 6 digits.'; return render(); }
  const k = S.su.kind, v = k === 'phone' ? '+1' + digits(S.su.value) : S.su.value.trim();
  run(async () => { await api.verifyCode(k, v, c, S.su.upgrading); go(me().handle ? (S.su.fromYou ? 'you' : 'su-pings') : 'su-handle'); });
}
function suHandle() {
  const h = cleanHandle(S.su.handle);
  if (!/^[a-z0-9_.]{3,20}$/.test(h)) { S.su.err = 'Use 3–20 letters, numbers, dots or underscores.'; return render(); }
  run(async () => { await api.setHandle(h); if (S.editHandle || S.su.fromYou) { S.editHandle = false; S.su.fromYou = false; go('you'); } else go('su-pings'); });
}
async function allowPings() {
  geo.start();
  try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch (e) { }
  go('home');
}
function skip() { run(async () => { await api.skip(); go('home'); }); }

// claim
function blockReason(d) {
  const st = status(d);
  if (st === 'ended' || st === 'expired') return 'This blimp drifted off.';
  if (st === 'full') return 'Every claim is taken.';
  if (isMine(d)) return 'This is your drop.';
  if (hasClaimed(d)) return 'You already claimed this one.';
  if (d.rule === 'there' && !pos()) return 'Turn on location to claim.';
  if (d.rule === 'there' && !inside(d)) return 'Get inside the zone to claim.';
  return '';
}
function doClaim() {
  const d = D.drops[S.cur]; if (!d) return;
  const why = blockReason(d); if (why) { S.note = why; return render(); }
  if (!me().payout && !S.paySkipped) { S.payFor = 'claim'; return go('payout'); }
  finishClaim();
}
function finishClaim() {
  const d = D.drops[S.cur]; if (!d) return go('home');
  run(async () => {
    const r = await api.claim(d.id, d.rule === 'there' ? pos() : null);
    S.landed = { amount: r.amount, name: r.name || d.name, balance: r.balance }; buzz(); go('landed');
  }).then(() => { if (S.note && S.screen === 'payout') go('drop'); });
}
function afterPayout() { const f = S.payFor; S.payFor = null; if (f === 'claim') finishClaim(); else if (f === 'cashout') cashOut(); else go('you'); }
function cashOut() {
  if (!me().payout) { S.payFor = 'cashout'; return go('payout'); }
  run(async () => { const a = await api.cashOut(); go('you'); S.note = 'Sent ' + money(a) + ' to ' + payoutLabel(me().payout) + '. In the real launch this is a real Stripe payout.'; });
}
const payoutLabel = p => p ? (p.type === 'bank' ? 'Bank account' : 'Debit card') + ' •••• ' + p.last4 + ' (demo)' : 'Not set up';

// drop
const newCompose = () => ({ name: '', color: 'Green', pool: '100', people: '10', r: 160, minutes: 10, vis: 'public', rule: 'there', anon: true });
function figures(c) {
  const pool = parseFloat(String(c.pool).replace(/[^0-9.]/g, '')), people = parseInt(String(c.people).replace(/[^0-9]/g, ''), 10);
  let err = '', per = 0, used = 0, fee = 0, total = 0;
  if (pool > 0 && people > 0) { per = Math.floor(pool / people * 100) / 100; used = r2(per * people); fee = r2(used * FEE); total = r2(used + fee); }
  if (!c.name.trim()) err = 'Name your drop.';
  else if (!(pool >= 1)) err = 'The pool has to be at least $1.';
  else if (!(people >= 1)) err = 'At least 1 person has to be able to claim.';
  else if (people > 500) err = 'Keep it to 500 people or fewer.';
  else if (per < 1) err = 'Keep it to at least $1 per person.';
  else if (me().balance != null && total > me().balance) err = 'Not enough play money. Add more in the You tab.';
  else if (!pos()) err = 'Turn on location (or set a pretend location) so we know where to drop it.';
  return { pool: used, per, people, fee, total, err };
}
function doFloat() {
  const c = S.compose, f = figures(c); if (f.err) { S.note = f.err; return render(); }
  const p = pos();
  run(async () => {
    const d = await api.createDrop({ name: c.name, color: c.color, pool: f.pool, people: f.people, r: c.r, minutes: c.minutes, vis: c.vis, rule: c.rule, anon: me().handle ? c.anon : true, lat: p.lat, lng: p.lng });
    S.compose = null; buzz(); S.cur = d.id; go('mine');
  });
}
function findCode() {
  const code = S.codeInput.trim().toUpperCase(); if (!code) { S.note = 'Type a drop code first.'; return render(); }
  run(async () => { const d = await api.unlock(code); S.codeInput = ''; S.codeOpen = false; open(d.id); });
}
function shareText(d) { return 'I just dropped ' + cash(d.pool) + ' on Blimp 💸 ' + d.maxPeople + ' claims only. Code: ' + d.code; }
async function share(d) {
  const text = shareText(d), url = location.origin + location.pathname + '#code=' + d.code;
  try { if (navigator.share) { await navigator.share({ title: d.name, text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text + ' ' + url); S.note = 'Copied. Paste it in your story or group chat.'; } catch (e) { S.note = text; }
  render();
}

function act(a, v, e, t) {
  switch (a) {
    case 'start': S.su = { kind: 'phone', value: '', code: '', handle: '', err: '', upgrading: false }; go('su-id'); break;
    case 'skip': skip(); break;
    case 'su-back': go(v); break;
    case 'su-kind': S.su.kind = v; S.su.value = ''; S.su.err = ''; render(); break;
    case 'su-send': suSend(); break;
    case 'su-resend': suSend(); break;
    case 'su-verify': suVerify(); break;
    case 'su-handle': suHandle(); break;
    case 'su-allow': allowPings(); break;
    case 'su-later': go('home'); break;
    case 'home': go('home'); break;
    case 'you': go('you'); break;
    case 'open': open(v); break;
    case 'compose': S.compose = S.compose || newCompose(); go('compose'); break;
    case 'color': S.compose.color = v; render(); break;
    case 'radius': S.compose.r = +v; render(); break;
    case 'dur': S.compose.minutes = +v; render(); break;
    case 'vis': S.compose.vis = v; render(); break;
    case 'rule': S.compose.rule = v; render(); break;
    case 'claim': doClaim(); break;
    case 'float': doFloat(); break;
    case 'paypick': S.payPick = v; render(); break;
    case 'paysave': run(async () => { await api.setPayout(S.payPick); }).then(() => { if (!S.note) afterPayout(); }); break;
    case 'payskip': if (S.payFor === 'claim') { S.paySkipped = true; S.payFor = null; finishClaim(); } else { S.payFor = null; go('you'); } break;
    case 'payclose': { const f = S.payFor; S.payFor = null; go(f === 'claim' ? 'drop' : 'you'); break; }
    case 'paysetup': S.payFor = 'setup'; go('payout'); break;
    case 'cashout': cashOut(); break;
    case 'addfunds': run(async () => { await api.addPlay(); S.note = 'Added $500 play money.'; }); break;
    case 'edithandle': S.editHandle = true; S.su.handle = me().handle; S.su.err = ''; go('su-handle'); break;
    case 'upgrade': S.su = { kind: 'phone', value: '', code: '', handle: '', err: '', upgrading: true, fromYou: true }; go('su-id'); break;
    case 'signout': run(async () => { await api.signOut(); S.screen = 'welcome'; }); break;
    case 'follow': run(() => api.follow(v)); break;
    case 'sim': run(() => api.simulate(S.cur)); break;
    case 'end': run(() => api.endDrop(S.cur)); break;
    case 'share': { const d = D.drops[S.cur]; if (d) share(d); break; }
    case 'copy': try { navigator.clipboard.writeText(v).then(() => { S.note = 'Code ' + v + ' copied.'; render(); }, () => { S.note = 'Code: ' + v; render(); }); } catch (err) { S.note = 'Code: ' + v; render(); } break;
    case 'filter': S.filter = v; S.sel = null; render(); break;
    case 'zoomin': M && M.zoomBy(1); break;
    case 'zoomout': M && M.zoomBy(-1); break;
    case 'recenter': { const p = pos(); if (p && M) M.fly(p.lat, p.lng, Math.max(15, M.view().zoom), S.sheet === 'full' ? 0 : 120); else { geo.start(); } break; }
    case 'sheet': if (S.swiped) { S.swiped = false; break; } S.sheet = S.sheet === 'full' ? 'peek' : 'full'; render(); break;
    case 'codeopen': S.codeOpen = !S.codeOpen; render(); if (S.codeOpen) { const el = document.getElementById('code'); el && el.focus(); } break;
    case 'cardtap': { const d = D.drops[v]; if (!d) break; if (S.sel === v) open(v); else { S.sel = v; render(); M && M.fly(d.lat, d.lng, Math.max(M.view().zoom, zoomFor(d.r)), 120); scrollCard(v); } break; }
    case 'locon': geo.start(); break;
    case 'locdismiss': S.dismissedLoc = true; render(); break;
    case 'pretendhere': { const c = M ? M.view() : HOME_CENTER; geo.setPretend({ lat: c.lat, lng: c.lng }); break; }
    case 'pretendoff': geo.setPretend(null); geo.start(); break;
    case 'moveinto': { const d = D.drops[v]; if (d) geo.setPretend({ lat: d.lat + (d.r * 0.3) / 111320, lng: d.lng }); break; }
    case 'reset-demo': if (api.reset) { api.reset(); geo.setPretend(null); S.screen = 'welcome'; render(); } break;
  }
}

/* ---------- views ---------- */
function notes() { return S.note ? '<div class="note" role="status">' + esc(S.note) + '</div>' : ''; }
function slider(label, actName, enabled, color) {
  return '<div class="slider' + (enabled ? '' : ' off') + (S.busy ? ' busy' : '') + '" data-slider="' + actName + '"><div class="fill" style="background:' + color + '"></div><div class="stxt">' + esc(S.busy ? 'Working…' : label) + '</div><button type="button" class="handle" style="background:' + (enabled ? color : '#BDBCB6') + '" aria-label="' + esc(label) + '"' + (enabled && !S.busy ? '' : ' disabled') + '>' + I.arrow + '</button></div>';
}
const primary = (label, actName, color, icon, disabled) => '<button class="btn" data-act="' + actName + '"' + (disabled || S.busy ? ' disabled' : '') + '><span>' + (S.busy ? 'Working…' : label) + '</span><span class="sq" style="background:' + color + '">' + (icon || I.arrow) + '</span></button>';
function tabs(cur) {
  return '<nav class="tabs" aria-label="Main"><button data-act="home" aria-current="' + (cur === 'home' ? 'page' : 'false') + '">' + I.map + '<span>Map</span></button>' +
    '<button class="tdrop" data-act="compose"><span>' + I.plus + '</span><span>Drop</span></button>' +
    '<button data-act="you" aria-current="' + (cur === 'you' ? 'page' : 'false') + '">' + I.user + '<span>You</span></button></nav>';
}
function blocks(d) {
  const total = Math.max(1, (d.expiresAt - d.createdAt) / 1000), l = Math.max(0, secsLeft(d));
  const n = Math.ceil(30 * l / total), hot = l / total <= 0.2 ? '#FF3B30' : '#FF7A1A'; let h = '';
  for (let i = 0; i < 30; i++) h += '<i style="background:' + (i < n ? hot : '#EDECE7') + '"></i>';
  return h;
}

function vLoading() { return '<main class="loading"><span class="tile" style="width:72px;height:72px;border-radius:18px">' + mark(48, '#111111', 'Blimp') + '</span></main>'; }
function vWelcome() {
  return '<main class="screen pad" style="padding-top:calc(56px + env(safe-area-inset-top))"><div style="margin-top:10vh;display:flex;flex-direction:column;gap:24px">' +
    '<div class="tile" style="width:96px;height:96px;border-radius:22px">' + mark(66, '#111111', 'Blimp') + '</div>' +
    '<h1 style="font-size:72px;font-weight:700;letter-spacing:-.06em;line-height:.9">blimp</h1>' +
    '<p style="margin:0;font-size:22px;line-height:1.3;color:#3A3A37">Money drops near you.<br>Grab it before it drifts off.</p>' +
    '<div style="display:flex;gap:6px">' + COLORS.map(c => '<span class="sw" style="width:16px;height:16px;background:' + PAL[c] + '"></span>').join('') + '</div></div>' +
    '<div style="margin-top:auto;display:flex;flex-direction:column;gap:6px;padding-top:32px">' + notes() + primary('Get started', 'start', 'var(--y)') +
    '<button class="link" data-act="skip">Skip sign-up for now</button><p class="fine">' + (D.mode === 'demo' ? 'Demo mode · play money · data stays on this phone' : 'Early access · play money only') + '</p></div></main>';
}
function stepHead(n, backTo) {
  return '<div class="stephead">' + (backTo ? '<button class="round soft" data-act="su-back" data-v="' + backTo + '" aria-label="Back">' + I.back + '</button>' : '<span></span>') +
    '<span class="mono" style="font-size:13px;font-weight:500">' + n + ' / 4</span>' + (S.su.fromYou ? '<button class="skip" data-act="you">Cancel</button>' : '<button class="skip" data-act="skip">Skip</button>') + '</div>';
}
const suErr = () => S.su.err ? '<div class="err" role="alert">' + esc(S.su.err) + '</div>' : '';
function vSuId() {
  const ph = S.su.kind === 'phone';
  return '<main class="screen pad">' + stepHead(1, S.su.fromYou ? null : 'welcome') +
    '<h1 class="stitle">' + (ph ? 'What’s your number?' : 'What’s your email?') + '</h1><p class="ssub">We send you a 6-digit code. One account per person, so drops stay fair.</p>' +
    '<div class="seg" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:24px"><button data-act="su-kind" data-v="phone" aria-pressed="' + ph + '">Phone</button><button data-act="su-kind" data-v="email" aria-pressed="' + !ph + '">Email</button></div>' +
    '<div class="field" style="margin-top:18px">' + (ph ?
      '<label class="label" for="su-id">Phone number</label><div style="display:flex;gap:8px"><div class="input mono" style="width:72px;flex-shrink:0;display:flex;align-items:center;justify-content:center;height:60px">+1</div><input id="su-id" class="input strong mono" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(910) 555-0142" data-bind="su.phone" value="' + esc(fmtPhone(S.su.value)) + '"></div>' :
      '<label class="label" for="su-id">Email</label><input id="su-id" class="input strong" type="email" inputmode="email" autocomplete="email" autocapitalize="none" placeholder="you@example.com" data-bind="su.email" value="' + esc(S.su.value) + '">') + suErr() + '</div>' +
    '<div style="margin-top:auto;display:flex;flex-direction:column;gap:12px;padding-top:24px"><p class="fine">' + (D.mode === 'demo' ? 'Demo mode: no code is actually sent.' : 'By continuing you agree to Blimp’s Terms and Privacy Policy.') + '</p>' + primary('Send code', 'su-send', 'var(--b)') + '</div></main>';
}
function vSuCode() {
  const shown = S.su.kind === 'phone' ? fmtPhone(S.su.value) : S.su.value;
  return '<main class="screen pad">' + stepHead(2, 'su-id') +
    '<h1 class="stitle">Enter the code</h1><p class="ssub">Sent to ' + esc(shown) + (S.su.kind === 'email' ? '. No code in the email? Tap the link in it instead — it signs you in here.' : '') + '</p>' +
    '<div class="field" style="margin-top:28px"><label class="label" for="su-code">6-digit code</label><input id="su-code" class="input strong mono otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······" data-bind="su.code" value="' + esc(S.su.code) + '">' + suErr() + notes() +
    '<button class="skip" style="align-self:flex-start;padding:0" data-act="su-resend">Resend code</button></div>' +
    '<div style="margin-top:auto;display:flex;flex-direction:column;gap:12px;padding-top:24px">' + (D.mode === 'demo' ? '<p class="fine">Demo: any 6 digits work.</p>' : '') + primary('Verify', 'su-verify', 'var(--y)') + '</div></main>';
}
function vSuHandle() {
  const editing = S.editHandle;
  return '<main class="screen pad">' + (editing ? '<div class="stephead"><button class="round soft" data-act="you" aria-label="Back">' + I.back + '</button><span></span><span></span></div>' : stepHead(3, null)) +
    '<h1 class="stitle">' + (editing ? 'Your name on Blimp' : 'Pick a name') + '</h1><p class="ssub">Shows on drops you make with your name on. You can always drop anonymously.</p>' +
    '<div class="field" style="margin-top:28px"><label class="label" for="su-handle">Name</label><div style="position:relative"><span class="mono" style="position:absolute;left:16px;top:50%;transform:translateY(-50%);font-size:20px;color:var(--muted)">@</span>' +
    '<input id="su-handle" class="input strong mono" style="padding-left:36px" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="21" placeholder="yourname" data-bind="su.handle" value="' + esc(S.su.handle) + '"></div>' + suErr() + '</div>' +
    '<div style="margin-top:auto;padding-top:24px">' + primary(editing ? 'Save' : 'Continue', 'su-handle', 'var(--o)') + '</div></main>';
}
function vSuPings() {
  return '<main class="screen pad">' + stepHead(4, null) +
    '<h1 class="stitle">Turn on pings</h1><p class="ssub">Blimp only works if it knows when you’re near a drop.</p>' +
    '<div style="margin-top:24px;background:#F2F1ED;border-radius:20px;padding:16px"><div style="background:#FFFFFF;border-radius:16px;padding:12px 14px;display:flex;flex-direction:column;gap:6px">' +
    '<div style="display:flex;align-items:center;gap:8px"><span class="tile" style="width:22px;height:22px;border-radius:6px">' + mark(15, '#111111') + '</span><span class="mono" style="font-size:11px;font-weight:700;letter-spacing:.08em">BLIMP</span><span class="muted" style="margin-left:auto;font-size:12px">now</span></div>' +
    '<div style="font-size:15px;font-weight:700">Friday on Front</div><div style="font-size:14px;color:#3A3A37">just dropped near you · $10 each</div></div></div>' +
    '<div style="margin-top:24px;display:flex;flex-direction:column;gap:16px">' +
    '<div class="perm"><span class="sq" style="background:var(--g)">' + I.pin + '</span><div><div style="font-size:16px;font-weight:700">Location</div><div class="muted" style="font-size:14px;line-height:1.4">Checks that you’re inside the drop zone when you claim. Only used while the app is open.</div></div></div>' +
    '<div class="perm"><span class="sq" style="background:var(--r)">' + I.bell + '</span><div><div style="font-size:16px;font-weight:700">Notifications</div><div class="muted" style="font-size:14px;line-height:1.4">The ping when something drops near you.</div></div></div></div>' +
    '<div style="margin-top:auto;display:flex;flex-direction:column;gap:6px;padding-top:24px">' + primary('Allow', 'su-allow', 'var(--r)') + '<button class="link" data-act="su-later">Not now</button></div></main>';
}

function filtered(ds) {
  if (S.filter === 'near') ds = ds.filter(d => d.rule === 'anywhere' || dist(d) - d.r <= 800);
  if (S.filter === 'following') ds = ds.filter(d => isFollowing(d.publicOwner));
  if (S.filter === 'ending') return ds.sort((a, b) => secsLeft(a) - secsLeft(b));
  return ds.sort((a, b) => (isFollowing(b.publicOwner) - isFollowing(a.publicOwner)) || (dist(a) - dist(b)) || (a.expiresAt - b.expiresAt));
}
function whereText(d) { if (d.rule === 'anywhere') return 'anywhere'; if (!pos()) return 'location off'; return inside(d) ? 'inside' : miles(Math.max(0, dist(d) - d.r)); }
function dcard(d) {
  const col = PAL[d.color] || PAL.Green, sel = S.sel === d.id, left = d.maxPeople - d.claimed;
  return '<button class="dcard" data-act="cardtap" data-v="' + esc(d.id) + '" aria-pressed="' + sel + '"><span class="top" style="background:' + col + '"></span><span class="in">' +
    '<span class="nm">' + esc(d.name) + '</span><span class="amt">' + cash(d.per) + '</span>' +
    '<span class="mini"><span style="width:' + Math.round(100 * left / d.maxPeople) + '%;background:' + col + '"></span></span>' +
    '<span class="meta"><span>' + left + ' left · ' + whereText(d) + '</span><span data-cd="' + esc(d.id) + '">' + clock(secsLeft(d)) + '</span></span>' +
    '<span class="go2">' + (sel ? 'Tap again to open →' : (isMine(d) ? 'Your drop' : (d.official ? 'Official drop' : (isFollowing(d.publicOwner) ? 'Following' : 'Tap to see it')))) + '</span></span></button>';
}
function dropRow(d) {
  return '<button class="row" data-act="open" data-v="' + esc(d.id) + '"><span class="sw" style="background:' + (PAL[d.color] || PAL.Green) + '"></span><span class="rmain"><span class="rname">' + esc(d.name) +
    (d.official ? ' <span class="chip tiny" style="background:var(--y)">OFFICIAL</span>' : '') + (isMine(d) ? ' <span class="chip tiny" style="background:var(--soft)">YOURS</span>' : '') +
    (!isMine(d) && isFollowing(d.publicOwner) ? ' <span class="chip tiny" style="background:var(--b)">FOLLOWING</span>' : '') + (d.visibility === 'code' ? ' <span class="chip tiny" style="background:var(--soft)">CODE</span>' : '') +
    '</span><span class="rsub mono">' + cash(d.per) + ' each · ' + (d.maxPeople - d.claimed) + ' left · ' + whereText(d) + '</span></span><span class="rcd mono" data-cd="' + esc(d.id) + '">' + clock(secsLeft(d)) + '</span></button>';
}
function locBanner() {
  if (geo.pretend) return '<div class="banner"><span style="flex:1">Pretend location is on. Tap the map to move your dot.</span><button data-act="pretendoff">Use GPS</button></div>';
  if (S.dismissedLoc || geo.status === 'ok' || geo.status === 'waiting') return geo.status === 'waiting' ? '<div class="banner"><span style="flex:1">Finding you…</span><button data-act="pretendhere">Pretend instead</button></div>' : '';
  if (geo.status === 'denied') return '<div class="banner"><span style="flex:1">Location is blocked. Allow it in your browser settings, or test with a pretend location.</span><button data-act="pretendhere">Pretend</button><button class="x" data-act="locdismiss" aria-label="Dismiss">' + I.close + '</button></div>';
  return '<div class="banner"><span style="flex:1">Turn on location to see what’s near you and claim.</span><button data-act="locon">Turn on</button><button class="x" data-act="locdismiss" aria-label="Dismiss">' + I.close + '</button></div>';
}
function vHome() {
  const ls = filtered(live().slice()), full = S.sheet === 'full';
  const past = Object.values(D.drops).filter(d => isMine(d) && status(d) !== 'live').sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const bal = me().balance == null ? '…' : money(me().balance);
  const filters = [['all', 'All'], ['near', 'Near me'], ['following', 'Following'], ['ending', 'Ending soon']];
  const emptyMsg = !D.ready ? 'Looking for drops…' : (S.filter === 'following' ? 'Nobody you follow has a drop up. Follow droppers from any named drop.' : (S.filter === 'near' ? 'Nothing within half a mile. Try All, or float your own.' : 'Nothing floating right now. Be the first. Tap Drop.'));
  const pastH = past.length ? '<div class="label" style="margin-top:6px">Your past drops</div><div class="list">' + past.map(d => '<button class="row" data-act="open" data-v="' + esc(d.id) + '"><span class="sw" style="background:' + (PAL[d.color] || PAL.Green) + '"></span><span class="rmain"><span class="rname">' + esc(d.name) + '</span><span class="rsub mono">' + d.claimed + ' claimed · drifted off</span></span><span class="rcd mono muted">recap</span></button>').join('') + '</div>' : '';
  const codeForm = S.codeOpen || full ? '<form class="coderow" data-form="code"><label for="code" class="sr">Drop code</label><input id="code" class="input" placeholder="Enter a drop code" data-bind="codeInput" value="' + esc(S.codeInput) + '" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false"><button type="submit" class="go">Go</button></form>' : '';
  return '<main class="screen"><div class="hmap" data-map-slot>' +
    '<div class="overlay"><div style="display:flex;justify-content:space-between;align-items:center"><div class="brand"><span class="tile" style="width:30px;height:30px;border-radius:8px">' + mark(21, '#111111') + '</span>blimp</div>' +
    '<button class="wallet" data-act="you" aria-label="Play balance ' + bal + '"><b>' + bal + '</b><span>PLAY MONEY</span></button></div>' +
    '<div class="chips" role="group" aria-label="Filter drops">' + filters.map(([k, l]) => '<button data-act="filter" data-v="' + k + '" aria-pressed="' + (S.filter === k) + '">' + l + '</button>').join('') + '</div>' +
    locBanner() + notes() + '</div>' +
    '<div class="ctrls" style="bottom:' + (full ? '-220px' : 'calc(var(--tabh) + 290px + env(safe-area-inset-bottom))') + '"><button data-act="zoomin" aria-label="Zoom in">+</button><button data-act="zoomout" aria-label="Zoom out">−</button><button data-act="recenter" aria-label="Center on me">' + I.locate + '</button></div>' +
    '</div>' +
    '<section class="hsheet' + (full ? ' full' : '') + '" aria-label="Drops"><button class="grab" data-act="sheet" aria-expanded="' + full + '" aria-label="' + (full ? 'Collapse list' : 'Expand list') + '"><i></i></button>' +
    '<div class="hsbody"><div class="sheethead"><b>' + (ls.length ? ls.length + (ls.length === 1 ? ' drop' : ' drops') + ' floating' : 'Floating near you') + '</b><button class="minibtn' + (S.codeOpen ? ' on' : '') + '" data-act="codeopen" aria-expanded="' + S.codeOpen + '">Have a code?</button></div>' +
    codeForm + (ls.length ? '<div class="carousel">' + ls.map(dcard).join('') + '</div>' : '<div class="empty">' + emptyMsg + '</div>') +
    (full ? (ls.length ? '<div class="label" style="margin-top:6px">All live drops</div><div class="list">' + ls.map(dropRow).join('') + '</div>' : '') + pastH : '<button class="link" style="min-height:36px;font-size:13px" data-act="sheet">Swipe up or tap for the full list</button>') +
    '</div></section>' + tabs('home') + '</main>';
}
function vDrop() {
  const d = D.drops[S.cur]; if (!d) return vHome();
  const why = blockReason(d), col = PAL[d.color] || PAL.Green, st = status(d), left = Math.max(0, d.maxPeople - d.claimed);
  let where;
  if (d.rule === 'anywhere') where = '<span class="chip" style="background:var(--b)">CLAIM FROM ANYWHERE</span>';
  else if (!pos()) where = '<span class="chip" style="background:var(--soft)">LOCATION OFF</span>';
  else if (inside(d)) where = '<span class="chip" style="background:var(--g)">YOU’RE INSIDE THE ZONE</span>';
  else where = '<span class="chip" style="background:var(--o)">' + miles(Math.max(0, dist(d) - d.r)).toUpperCase() + ' FROM THE ZONE</span>';
  const canFollow = d.publicOwner && !isMine(d) && d.publicOwner !== uid(), fol = canFollow && isFollowing(d.publicOwner);
  const sl = why ? '<div class="slider off"><div class="stxt">' + esc(why) + '</div></div>' : slider('Slide to claim ' + cash(d.per), 'claim', true, col);
  return '<main class="screen"><div class="dmap" data-map-slot><button class="round back" data-act="home" aria-label="Back">' + I.back + '</button></div>' +
    '<section class="sheet">' + notes() +
    '<div class="dname"><span class="sw" style="background:' + col + '"></span><span>' + esc(d.name) + '</span></div>' +
    '<div class="muted" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px"><span>by ' + esc(byline(d)) + '</span>' +
    (canFollow ? '<button class="minibtn' + (fol ? ' on' : '') + '" data-act="follow" data-v="' + esc(d.publicOwner) + '" aria-pressed="' + fol + '">' + (fol ? 'Following' : 'Follow') + '</button>' : '') +
    '<span>· code <b class="mono" style="color:#111111">' + esc(d.code) + '</b></span><button class="minibtn" data-act="copy" data-v="' + esc(d.code) + '">Copy</button></div>' +
    '<div class="big">' + cash(d.per) + '</div>' +
    '<div class="mono muted" style="font-size:13px;margin-top:-6px">from a ' + cash(d.pool) + ' drop · ' + left + ' of ' + d.maxPeople + ' left</div>' +
    (st === 'live' ? '<div class="cdrow mono"><span class="muted">DRIFTS OFF IN</span><span data-cd="' + esc(d.id) + '">' + clock(secsLeft(d)) + '</span></div><div class="blocks" data-blocks="' + esc(d.id) + '">' + blocks(d) + '</div>' : '') +
    '<div>' + where + '</div>' + sl +
    (d.rule === 'there' && st === 'live' && !inside(d) ? (pos() ? '<button class="link" data-act="moveinto" data-v="' + esc(d.id) + '">Testing? Pretend I’m inside the zone</button>' : '<button class="link" data-act="locon">Turn on location</button>') : '') +
    '</section></main>';
}
function vPayout() {
  const d = D.drops[S.cur], amt = S.payFor === 'claim' && d ? cash(d.per) : 'your money';
  const opts = [['card', 'Debit card', 'Fastest'], ['bank', 'Bank account', 'Standard transfer']];
  return '<main class="screen pad"><div class="stephead">' + (S.payFor === 'claim' ? '<span class="chip" style="background:var(--y)">FIRST CLAIM</span>' : '<span class="chip" style="background:var(--soft)">PAYOUTS</span>') +
    '<button class="round soft" data-act="payclose" aria-label="Close">' + I.close + '</button></div>' + notes() +
    '<h1 class="stitle">Where should ' + esc(amt) + ' go?</h1><p class="ssub">One-time setup. Payouts run through Stripe.</p>' +
    '<div style="margin-top:28px;display:flex;flex-direction:column;gap:10px">' + opts.map(([id, l, s]) => '<button class="opt" data-act="paypick" data-v="' + id + '" aria-pressed="' + (S.payPick === id) + '"><span><span style="display:block;font-size:17px;font-weight:700">' + l + '</span><span class="muted" style="font-size:14px">' + s + '</span></span><span class="mk2">' + (S.payPick === id ? I.smallcheck : '') + '</span></button>').join('') + '</div>' +
    '<div style="margin-top:auto;display:flex;flex-direction:column;gap:6px;padding-top:24px"><p class="fine">Play-money version: no real card or bank is connected yet. At launch, Stripe holds those details and Blimp never stores them.</p>' +
    primary('Continue with Stripe', 'paysave', 'var(--g)') + '<button class="link" data-act="payskip">Skip for now</button></div></main>';
}
function vLanded() {
  const l = S.landed || { amount: 0, name: '' };
  return '<main class="screen pad">' +
    '<div class="greencard"><div style="display:flex;justify-content:space-between;align-items:center"><span class="mono" style="font-size:12px;font-weight:700;letter-spacing:.08em">CLAIMED</span><span class="sq" style="width:44px;height:44px;border-radius:12px;background:#111111;color:var(--g)">' + I.check + '</span></div>' +
    '<div style="font-size:64px;font-weight:500;letter-spacing:-.05em;line-height:.95;margin-top:32px">' + cash(l.amount) + '<br>landed</div><div style="font-size:16px">' + (me().payout ? 'Ready to cash out to ' + esc(payoutLabel(me().payout)) : 'Added to your play balance') + '</div></div>' +
    '<div class="rows" style="margin:20px 4px 0"><div><span>From</span><span>' + esc(l.name) + '</span></div><div><span>Amount</span><span>' + money(l.amount) + '</span></div><div><span>Balance</span><span>' + (me().balance == null ? '…' : money(me().balance)) + '</span></div></div>' +
    '<div style="margin-top:auto;display:flex;flex-direction:column;gap:8px;padding-top:24px"><div class="muted" style="font-size:15px">Your turn to float one.</div>' +
    primary('Drop your own', 'compose', 'var(--y)', I.plus) + '<button class="link" data-act="home">Done</button></div></main>';
}
const seg = (name, items, cur, cols) => '<div class="seg" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">' + items.map(([label, val]) => '<button type="button" data-act="' + name + '" data-v="' + val + '" aria-pressed="' + (String(val) === String(cur)) + '">' + label + '</button>').join('') + '</div>';
function vCompose() {
  const c = S.compose || (S.compose = newCompose()), f = figures(c), col = PAL[c.color], hasName = !!me().handle;
  return '<main class="screen pad" style="gap:18px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center"><h1 class="title">Drop a blimp</h1><button class="round soft" data-act="home" aria-label="Close">' + I.close + '</button></div>' + notes() +
    '<div class="field"><div style="display:flex;justify-content:space-between"><label class="label" for="f-name">Name your drop</label><span class="label">' + c.name.length + '/24</span></div>' +
    '<input id="f-name" class="input" style="font-weight:700;font-size:20px" maxlength="24" placeholder="Friday on Front" data-bind="compose.name" value="' + esc(c.name) + '" autocomplete="off"></div>' +
    '<div class="field"><div class="label">Color</div><div class="swatches">' + COLORS.map(k => '<button type="button" data-act="color" data-v="' + k + '" aria-label="' + k + '" aria-pressed="' + (c.color === k) + '" style="background:' + PAL[k] + '"></button>').join('') + '</div></div>' +
    '<div class="grid2"><div class="field"><label class="label" for="f-pool">Pool ($)</label><input id="f-pool" class="input mono" inputmode="decimal" data-bind="compose.pool" value="' + esc(c.pool) + '"></div>' +
    '<div class="field"><label class="label" for="f-people">People</label><input id="f-people" class="input mono" inputmode="numeric" data-bind="compose.people" value="' + esc(c.people) + '"></div></div>' +
    '<div class="mono" style="font-size:14px;margin-top:-8px">= <span style="background:var(--y);padding:1px 6px;border-radius:4px">' + (f.per ? cash(f.per) + ' each' : '—') + '</span></div>' +
    '<div class="field"><div class="label">Radius</div>' + seg('radius', RADII, c.r, 3) + '</div>' +
    '<div class="field"><div class="label">Floats for</div>' + seg('dur', DURS, c.minutes, 4) + '</div>' +
    '<div class="field"><div class="label">Who can see it</div>' + seg('vis', [['Public', 'public'], ['Code only', 'code']], c.vis, 2) + '</div>' +
    '<div class="field"><div class="label">Who can claim</div>' + seg('rule', [['Be there', 'there'], ['Anywhere', 'anywhere']], c.rule, 2) + '</div>' +
    (hasName ? '<label class="check"><input type="checkbox" id="f-anon" data-check="anon"' + (c.anon ? ' checked' : '') + '> Drop anonymously (otherwise shows @' + esc(me().handle) + ')</label>' :
      '<div class="muted" style="font-size:14px">Drops are anonymous until you add a name in the You tab.</div>') +
    '<div class="rows" style="background:var(--soft);border-radius:16px;padding:2px 16px"><div><span>Pool</span><span>' + money(f.pool) + '</span></div><div><span>Blimp fee (5%)</span><span>' + money(f.fee) + '</span></div><div><span>Total</span><span style="font-weight:700">' + money(f.total) + '</span></div><div><span>Your balance</span><span>' + (me().balance == null ? '…' : money(me().balance)) + '</span></div></div>' +
    (f.err ? '<div class="muted" style="font-size:14px">' + esc(f.err) + '</div>' : '') +
    slider('Slide to float it', 'float', !f.err, col) +
    '<p class="fine">It drops right where you are' + (geo.pretend ? ' (your pretend location)' : '') + '. Anything unclaimed comes back to you.</p></main>';
}
function vMine() {
  const d = D.drops[S.cur]; if (!d) return vHome();
  if (status(d) !== 'live') return vRecap(d);
  const cl = claimsOf(d.id), n = d.claimed, col = PAL[d.color] || PAL.Green;
  const feed = cl.slice(0, 5).map(c => { const h = c.sim ? '' : handleOf(c.userId); return '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--soft);font-size:15px"><span class="sw" style="width:12px;height:12px;background:' + PAL[COLORS[hash(c.id) % 5]] + '"></span><span>' + (c.sim ? 'Test claim' : (h ? '@' + esc(h) : 'Someone') + ' claimed') + ' ' + cash(c.amount) + '</span><span class="mono muted" style="margin-left:auto;font-size:12px" data-ago="' + c.at + '">' + ago(c.at) + '</span></div>'; }).join('');
  return '<main class="screen"><div class="dmap" data-map-slot><button class="round back" data-act="home" aria-label="Back">' + I.back + '</button></div>' +
    '<section class="sheet">' + notes() +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div style="display:flex;flex-direction:column;gap:8px;min-width:0"><span class="chip" style="background:var(--r);align-self:flex-start">● LIVE</span><h1 style="font-size:24px;font-weight:700;letter-spacing:-.01em;overflow-wrap:anywhere">' + esc(d.name) + '</h1></div><div class="mono" style="font-size:32px;font-weight:500" data-cd="' + esc(d.id) + '">' + clock(secsLeft(d)) + '</div></div>' +
    '<div class="bar"><div style="width:' + Math.round(100 * n / d.maxPeople) + '%;background:' + col + '"></div></div>' +
    '<div class="mono" style="display:flex;justify-content:space-between;font-size:13px;margin-top:-6px"><span>' + cash(n * d.per) + ' claimed · ' + n + (n === 1 ? ' person' : ' people') + '</span><span class="muted">' + cash((d.maxPeople - n) * d.per) + ' left</span></div>' +
    '<div class="codebox"><div><div class="label">Share code</div><b>' + esc(d.code) + '</b></div><div style="display:flex;gap:6px"><button class="minibtn" data-act="copy" data-v="' + esc(d.code) + '">Copy</button><button class="minibtn on" data-act="share">Share</button></div></div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap"><span class="chip" style="background:var(--soft)">' + (d.visibility === 'code' ? 'CODE ONLY' : 'PUBLIC') + '</span><span class="chip" style="background:var(--soft)">' + (d.rule === 'there' ? 'BE THERE' : 'ANYWHERE') + '</span><span class="chip" style="background:var(--soft)">' + cash(d.per) + ' EACH</span><span class="chip" style="background:var(--soft)">' + (d.ownerHandle ? 'AS @' + esc(d.ownerHandle).toUpperCase() : 'ANONYMOUS') + '</span></div>' +
    (feed ? '<div>' + feed + '</div>' : '<div class="empty">No claims yet. Share the code, or tap “simulate a claim” to watch it fill.</div>') +
    '<button class="btn2" data-act="sim"' + (S.busy ? ' disabled' : '') + '>Test: simulate a claim</button><button class="link" data-act="end">End drop early</button></section></main>';
}
function vRecap(d) {
  const cl = claimsOf(d.id), n = d.claimed, claimed = r2(n * d.per), back = d.settled ? d.refund : r2((d.maxPeople - n) * d.per);
  let took = ''; if (n && cl.length) { const last = Math.max(...cl.map(c => c.at)); const s = Math.round((last - d.createdAt) / 1000); took = s < 60 ? s + ' seconds' : Math.round(s / 60) + (Math.round(s / 60) === 1 ? ' minute' : ' minutes'); }
  const st = status(d);
  return '<main class="screen pad">' +
    '<div style="display:flex;justify-content:space-between;align-items:center"><span class="chip" style="background:' + (st === 'full' ? 'var(--g)' : 'var(--soft)') + '">' + (st === 'full' ? 'ALL CLAIMED' : 'DRIFTED OFF') + '</span><button class="round soft" data-act="home" aria-label="Close">' + I.close + '</button></div>' + notes() +
    '<div style="margin-top:16px;font-size:20px;font-weight:700">' + esc(d.name) + '</div>' +
    '<div style="margin-top:28px;font-size:72px;font-weight:500;letter-spacing:-.05em;line-height:1">' + n + (n === 1 ? ' person' : ' people') + '</div>' +
    '<div style="font-size:22px;color:#3A3A37;line-height:1.3;margin-top:8px">' + (n ? 'grabbed ' + cash(claimed) + (took ? ' in ' + took : '') + '.' : 'didn’t make it this time.') + '</div>' +
    (n ? '<div class="squares" style="margin-top:24px">' + Array.from({ length: Math.min(n, 60) }, (_, i) => '<i style="background:' + PAL[COLORS[(i * 3) % 5]] + '"></i>').join('') + '</div>' : '') +
    '<div class="rows" style="margin-top:20px"><div><span>Dropped</span><span>' + money(d.pool) + '</span></div><div><span>Claimed</span><span>' + money(claimed) + '</span></div><div><span>Back to you</span><span>' + money(back) + (d.settled ? '' : ' (returning…)') + '</span></div></div>' +
    '<div style="margin-top:auto;display:flex;flex-direction:column;gap:8px;padding-top:24px">' + primary('Drop another', 'compose', 'var(--b)', I.plus) + '<button class="link" data-act="home">Home</button></div></main>';
}
function activity() {
  const a = [];
  Object.values(D.claims).filter(c => c.userId === uid()).forEach(c => { const d = D.drops[c.dropId]; a.push({ t: c.at, label: 'Claimed · ' + (d ? d.name : 'a drop'), amt: c.amount }); });
  Object.values(D.drops).filter(isMine).forEach(d => { a.push({ t: d.createdAt, label: 'Dropped · ' + d.name, amt: -r2(d.pool + r2(d.pool * FEE)) }); if (d.settled && d.refund > 0) a.push({ t: d.endedAt || d.expiresAt, label: 'Returned · ' + d.name, amt: d.refund }); });
  (me().cashouts || []).forEach(c => a.push({ t: c.at, label: 'Cash out (demo)', amt: -c.amt }));
  return a.sort((x, y) => y.t - x.t).slice(0, 20);
}
function vYou() {
  const m = me(), u = D.user || {}, acts = activity(), fl = m.follows || [];
  const flH = fl.length ? '<div class="list">' + fl.map(id => '<div class="row" style="cursor:default"><span class="sw" style="background:var(--b)"></span><span class="rmain"><span class="rname">' + esc(handleOf(id) ? '@' + handleOf(id) : 'Someone') + '</span><span class="rsub">Their drops ping you from anywhere</span></span><button class="minibtn on" data-act="follow" data-v="' + esc(id) + '">Unfollow</button></div>').join('') + '</div>' :
    '<div class="empty">Follow a dropper from any drop with a name on it, and you’ll get pinged for their drops wherever you are.</div>';
  const actH = acts.length ? '<div class="rows">' + acts.map(x => '<div><span style="color:#111111;font-family:\'Space Grotesk\',sans-serif;font-size:15px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(x.label) + '<br><span class="mono muted" style="font-size:11px">' + ago(x.t) + '</span></span><span style="color:' + (x.amt >= 0 ? '#15803D' : '#111111') + '">' + (x.amt >= 0 ? '+' : '') + money(x.amt) + '</span></div>').join('') + '</div>' : '<div class="empty">Nothing yet. Claim a drop or float one.</div>';
  const acct = u.isAnon ? 'Guest account (skipped sign-up)' : (u.phone ? fmtPhone((p => p.length === 11 && p[0] === '1' ? p.slice(1) : p)(String(u.phone).replace(/\D/g, ''))) + ' · verified' : (u.email ? esc(u.email) + ' · verified' : ''));
  return '<main class="screen pad" style="gap:16px;padding-bottom:calc(var(--tabh) + 40px)">' +
    '<div style="display:flex;justify-content:space-between;align-items:center"><h1 class="title">You</h1><span class="tile" style="width:36px;height:36px;border-radius:9px">' + mark(24, '#111111') + '</span></div>' + notes() +
    '<div class="card" style="display:flex;flex-direction:column;gap:8px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div style="font-size:22px;font-weight:700">' + (m.handle ? '@' + esc(m.handle) : 'No name yet') + '</div><button class="minibtn" data-act="edithandle">' + (m.handle ? 'Edit' : 'Add a name') + '</button></div>' +
    '<div class="mono muted" style="font-size:13px">' + acct + '</div>' + (u.isAnon ? '<button class="minibtn on" style="align-self:flex-start" data-act="upgrade">Sign up to keep your account</button>' : '') + '</div>' +
    '<div class="card" style="background:var(--ink);color:#FFFFFF;border:0;display:flex;flex-direction:column;gap:14px"><div class="mono" style="font-size:11px;letter-spacing:.12em;color:#BDBCB6">PLAY BALANCE</div>' +
    '<div class="mono" style="font-size:44px;font-weight:500;letter-spacing:-.02em">' + (m.balance == null ? '…' : money(m.balance)) + '</div>' +
    '<div class="grid2"><button class="btn2" style="background:var(--g);height:48px" data-act="cashout"' + (S.busy ? ' disabled' : '') + '>Cash out</button><button class="btn2" style="background:#2A2A2A;color:#FFFFFF;height:48px" data-act="addfunds"' + (S.busy ? ' disabled' : '') + '>+ $500 play</button></div></div>' +
    '<div class="label">Payouts</div><div class="row" style="cursor:default"><span class="sw" style="background:var(--g)"></span><span class="rmain"><span class="rname">' + esc(payoutLabel(m.payout)) + '</span><span class="rsub">Through Stripe at launch</span></span><button class="minibtn" data-act="paysetup">' + (m.payout ? 'Change' : 'Set up') + '</button></div>' +
    '<div class="label">Location</div><label class="switch"><span><span style="display:block;font-weight:700">Pretend location</span><span class="muted" style="font-size:13px">For testing: tap the map to set where you are.</span></span><input type="checkbox" data-check="pretend"' + (geo.pretend ? ' checked' : '') + '></label>' +
    '<div class="muted" style="font-size:13px;margin-top:-8px">GPS: ' + ({ ok: 'on', waiting: 'finding you…', denied: 'blocked in browser settings', unavailable: 'not available', off: 'off' }[geo.status]) + (geo.status !== 'ok' && geo.status !== 'waiting' ? ' · <button class="minibtn" data-act="locon">Turn on</button>' : '') + '</div>' +
    '<div class="label">Following</div>' + flH +
    '<div class="label">Activity</div>' + actH +
    (D.mode === 'demo' ? '<div class="note">Demo mode: everything stays on this phone. Add the Supabase keys (see README) to go live with real accounts.</div><button class="link" data-act="reset-demo">Reset demo</button>' : '') +
    '<button class="link" data-act="signout">Sign out</button>' + tabs('you') + '</main>';
}
function vToast() {
  if (!S.toast) return ''; const d = D.drops[S.toast.id]; if (!d) return '';
  return '<button class="toast" data-act="open" data-v="' + esc(d.id) + '"><span class="tile" style="width:36px;height:36px;border-radius:9px;flex-shrink:0">' + mark(24, '#111111') + '</span><span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span style="font-weight:700;font-size:15px">' + esc(d.name) + '</span><span style="font-size:14px;color:#3A3A37">' + (isFollowing(d.publicOwner) ? esc(byline(d)) + ' dropped · ' : 'just dropped near you · ') + cash(d.per) + ' each</span></span></button>';
}
function view() {
  if (S.screen === 'loading') return vLoading();
  const signedOut = !D.user;
  if (signedOut && !['welcome', 'su-id', 'su-code'].includes(S.screen)) S.screen = 'welcome';
  switch (S.screen) {
    case 'welcome': return vWelcome();
    case 'su-id': return vSuId();
    case 'su-code': return vSuCode();
    case 'su-handle': return vSuHandle();
    case 'su-pings': return vSuPings();
    case 'drop': return vDrop();
    case 'payout': return vPayout();
    case 'landed': return vLanded();
    case 'compose': return vCompose();
    case 'mine': return vMine();
    case 'you': return vYou();
    default: return vHome();
  }
}

/* ---------- render loop ---------- */
const app = document.getElementById('app');
function statusKey() { return S.screen + '|' + !!pos() + '|' + live().map(d => d.id + (d.rule === 'there' ? inside(d) : '')).join(',') + '|' + Object.values(D.drops).map(d => d.id + status(d)).join(','); }
function render() {
  if (S.dragging) { S.pending = true; return; }
  const a = document.activeElement, fid = a && a.id; let ss = null, se = null;
  try { ss = a.selectionStart; se = a.selectionEnd; } catch (e) { }
  const car = document.querySelector('.carousel'), body = document.querySelector('.hsbody');
  const keep = { car: car ? car.scrollLeft : 0, body: body ? body.scrollTop : 0, scr: S.screen };
  if (mapEl.parentNode) mapEl.parentNode.removeChild(mapEl);
  app.innerHTML = view() + vToast();
  placeMap();
  if (keep.scr === S.screen) { const c2 = document.querySelector('.carousel'), b2 = document.querySelector('.hsbody'); if (c2) c2.scrollLeft = keep.car; if (b2) b2.scrollTop = keep.body; }
  bindSliders(); bindSheet();
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus({ preventScroll: true }); try { if (ss != null) { const L = el.value.length; el.setSelectionRange(Math.min(ss, L), Math.min(se, L)); } } catch (e) { } } }
  S.lastKey = statusKey();
}
function bindSliders() {
  document.querySelectorAll('[data-slider]').forEach(sl => {
    const h = sl.querySelector('.handle'); if (!h || h.disabled) return;
    const fill = sl.querySelector('.fill'), txt = sl.querySelector('.stxt');
    let start = 0, dx = 0, max = 0, drag = false;
    h.addEventListener('pointerdown', e => { drag = true; S.dragging = true; start = e.clientX; max = sl.clientWidth - h.offsetWidth - 16; try { h.setPointerCapture(e.pointerId); } catch (err) { } h.style.transition = 'none'; fill.style.transition = 'none'; });
    h.addEventListener('pointermove', e => { if (!drag) return; dx = Math.max(0, Math.min(max, e.clientX - start)); h.style.transform = 'translateX(' + dx + 'px)'; fill.style.width = (dx + 64) + 'px'; txt.style.opacity = String(1 - dx / max); });
    const end = () => {
      if (!drag) return; drag = false; S.dragging = false;
      if (dx >= max * 0.9) { h.style.transform = 'translateX(' + max + 'px)'; fill.style.width = '100%'; buzz(); S.pending = false; act(sl.dataset.slider); }
      else { h.style.transition = 'transform .25s'; fill.style.transition = 'width .25s'; h.style.transform = 'translateX(0)'; fill.style.width = '0'; txt.style.opacity = '1'; if (S.pending) { S.pending = false; setTimeout(render, 260); } }
      dx = 0;
    };
    h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
    h.addEventListener('click', e => { if (e.detail === 0) act(sl.dataset.slider); });
  });
}
function bindSheet() {
  const g = document.querySelector('.hsheet .grab'); if (!g) return;
  let y0 = null;
  g.addEventListener('pointerdown', e => { y0 = e.clientY; try { g.setPointerCapture(e.pointerId); } catch (err) { } });
  g.addEventListener('pointerup', e => {
    if (y0 == null) return; const dy = e.clientY - y0; y0 = null;
    if (dy < -30 && S.sheet !== 'full') { S.sheet = 'full'; S.swiped = true; render(); }
    else if (dy > 30 && S.sheet === 'full') { S.sheet = 'peek'; S.swiped = true; render(); }
  });
}
function tick() {
  if (D.user && Object.values(D.drops).some(d => isMine(d) && !d.settled && status(d) !== 'live') && !S.settling) {
    S.settling = true; api.settleMine().catch(() => { }).finally(() => { setTimeout(() => { S.settling = false; }, 8000); });
  }
  if (S.dragging || S.screen === 'loading') return;
  if (statusKey() !== S.lastKey) return render();
  document.querySelectorAll('[data-cd]').forEach(el => { const d = D.drops[el.dataset.cd]; if (d) el.textContent = clock(secsLeft(d)); });
  document.querySelectorAll('[data-blocks]').forEach(el => { const d = D.drops[el.dataset.blocks]; if (d) el.innerHTML = blocks(d); });
  document.querySelectorAll('[data-ago]').forEach(el => { el.textContent = ago(+el.dataset.ago); });
}

app.addEventListener('click', e => { const t = e.target.closest('[data-act]'); if (!t || t.disabled) return; act(t.dataset.act, t.dataset.v, e, t); });
app.addEventListener('submit', e => { e.preventDefault(); if (e.target.dataset.form === 'code') findCode(); });
app.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return; const id = e.target && e.target.id;
  const m = { 'su-id': 'su-send', 'su-code': 'su-verify', 'su-handle': 'su-handle' };
  if (m[id]) { e.preventDefault(); act(m[id]); }
});
app.addEventListener('input', e => {
  const t = e.target, b = t.dataset.bind; if (!b) return;
  if (b === 'codeInput') { S.codeInput = t.value; return; }
  if (b === 'su.phone') { S.su.value = digits(t.value); S.su.err = ''; const f = fmtPhone(S.su.value); if (t.value !== f) { t.value = f; try { t.setSelectionRange(f.length, f.length); } catch (err) { } } return; }
  if (b === 'su.email') { S.su.value = t.value; S.su.err = ''; return; }
  if (b === 'su.code') { const c = t.value.replace(/\D/g, '').slice(0, 6); S.su.code = c; if (t.value !== c) t.value = c; S.su.err = ''; if (c.length === 6) act('su-verify'); return; }
  if (b === 'su.handle') { S.su.handle = cleanHandle(t.value); if (t.value !== S.su.handle) t.value = S.su.handle; S.su.err = ''; return; }
  if (b.startsWith('compose.') && S.compose) { S.compose[b.slice(8)] = t.value; render(); }
});
app.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.check === 'anon' && S.compose) { S.compose.anon = t.checked; render(); }
  if (t.dataset.check === 'pretend') { if (t.checked) { const c = geo.gps || (M ? M.view() : HOME_CENTER); geo.setPretend({ lat: c.lat, lng: c.lng }); } else { geo.setPretend(null); geo.start(); } }
});
window.addEventListener('resize', () => M && M.resize());
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

/* ---------- live events: pings ---------- */
api.onChange(ev => {
  if (ev && ev.type === 'newdrop') {
    const d = D.drops[ev.id];
    if (d && !isMine(d) && d.visibility === 'public' && status(d) === 'live' && now() - d.createdAt < 120000 && (dist(d) <= 2000 || isFollowing(d.publicOwner))) {
      S.toast = { id: d.id }; buzz();
      setTimeout(() => { if (S.toast && S.toast.id === d.id) { S.toast = null; render(); } }, 7000);
      try { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(d.name, { body: 'Just dropped near you · ' + cash(d.per) + ' each' }); } catch (e) { }
    }
  }
  if (S.screen === 'loading') S.screen = D.user ? 'home' : 'welcome';
  if (!D.user && !['welcome', 'su-id', 'su-code'].includes(S.screen)) S.screen = 'welcome';
  if (D.user && S.pendingCode && !S.busy) { S.codeInput = S.pendingCode; S.pendingCode = null; setTimeout(findCode, 0); }
  render();
});

/* ---------- start ---------- */
(async function boot() {
  render();
  setInterval(tick, 1000);
  geo.autoStart();
  try { await api.start(); } catch (e) { S.note = 'Couldn’t connect. Check your connection and reopen the app.'; }
  if (S.screen === 'loading') S.screen = D.user ? 'home' : 'welcome';
  if (cameFromLink && D.user && !D.user.isAnon && D.me && !D.me.handle) { S.su.handle = ''; S.screen = 'su-handle'; }
  // A shared link like blimp.app/#code=FRONT opens that drop's code
  const m = location.hash.match(/code=([A-Za-z0-9]{4,8})/);
  if (m && D.user) { S.codeInput = m[1]; history.replaceState(null, '', location.pathname); findCode(); }
  else if (m) { S.pendingCode = m[1]; }
  render();
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js').catch(() => { });
})();
