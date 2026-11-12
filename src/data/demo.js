// Demo backend: runs entirely on this phone (no accounts needed).
// Used until Supabase keys are added. Mirrors the server rules in supabase/schema.sql.
import { distM, r2, now, store, FEE } from '../util.js';

const KEY = 'demo-v1';
const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const code5 = () => Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join('');
const uid = () => 'u' + Math.random().toString(36).slice(2, 10);

function seed() {
  const t = now();
  const mk = (id, name, color, pool, per, max, lat, lng, r, vis, code) => ({
    id, official: true, publicOwner: null, ownerHandle: null, name, color, pool, per, maxPeople: max, claimed: 0,
    lat, lng, r, visibility: vis, rule: 'there', code, createdAt: t, expiresAt: t + 30 * 864e5, endedAt: null, settled: false, refund: 0
  });
  return {
    user: null, me: null,
    drops: {
      'official-welcome': mk('official-welcome', 'Welcome to Blimp', 'Yellow', 500, 10, 50, 34.23573, -77.94782, 160, 'public', 'BLIMP'),
      'official-secret': mk('official-secret', 'Secret on Front', 'Red', 100, 10, 10, 34.23860, -77.94900, 100, 'code', 'FRONT')
    },
    mine: [], claims: {}, unlocks: [], handles: {}
  };
}

export function createDemo() {
  let S = store(KEY) || seed();
  const D = { mode: 'demo', ready: false, user: null, me: null, drops: {}, mine: new Set(), claims: {}, handles: {} };
  let listener = () => { };
  const save = () => store(KEY, S);
  const visible = d => d.visibility === 'public' || S.mine.includes(d.id) || S.unlocks.includes(d.id);
  function sync(ev) {
    D.user = S.user; D.me = S.me; D.handles = { ...S.handles }; D.mine = new Set(S.mine);
    D.drops = {}; Object.values(S.drops).forEach(d => { if (visible(d)) D.drops[d.id] = { ...d }; });
    D.claims = {}; Object.values(S.claims).forEach(c => { if (c.userId === (S.user && S.user.id) || S.mine.includes(c.dropId)) D.claims[c.id] = c; });
    D.ready = true; save(); listener(ev || {});
  }
  const need = () => { if (!S.user) throw new Error('Sign in first.'); return S.user.id; };
  const fail = m => { throw new Error(m); };
  const isOver = d => d.endedAt || now() >= d.expiresAt || d.claimed >= d.maxPeople;
  function settle(d) {
    if (d.settled || !isOver(d)) return;
    const back = r2(Math.max(0, d.maxPeople - d.claimed) * d.per);
    if (S.mine.includes(d.id) && back > 0) S.me.balance = r2(S.me.balance + back);
    d.settled = true; d.refund = back;
  }
  const newUser = extra => { S.user = { id: uid(), isAnon: true, phone: '', email: '', ...extra }; S.me = { handle: '', balance: 500, payout: null, follows: [], cashouts: [] }; };

  return {
    D,
    onChange(fn) { listener = fn; },
    async start() { sync(); },
    async skip() { if (!S.user) newUser({}); sync(); },
    async sendCode(kind, value) { return !!(S.user && S.user.isAnon); },
    async verifyCode(kind, value, token) {
      if (!/^\d{6}$/.test(token)) fail('Enter all 6 digits.');
      if (!S.user) newUser({});
      S.user.isAnon = false; S.user[kind === 'phone' ? 'phone' : 'email'] = value; sync();
    },
    async setHandle(h) {
      const me = need();
      if (!/^[a-z0-9_.]{3,20}$/.test(h)) fail('Use 3–20 letters, numbers, dots or underscores.');
      if (Object.entries(S.handles).some(([u, x]) => u !== me && x === h)) fail('@' + h + ' is taken. Try another.');
      S.handles[me] = h; S.me.handle = h; sync(); return h;
    },
    async createDrop(p) {
      const me = need();
      if (!p.name.trim()) fail('Name your drop.');
      if (!(p.people >= 1 && p.people <= 500)) fail('Between 1 and 500 people can claim.');
      if (!(p.pool >= 1)) fail('The pool has to be at least $1.');
      const per = Math.floor(p.pool / p.people * 100) / 100; if (per < 1) fail('Keep it to at least $1 per person.');
      const used = r2(per * p.people), total = r2(used + r2(used * FEE));
      if (S.me.balance < total) fail('Not enough play money for that drop.');
      const anon = S.me.handle ? p.anon : true, t = now();
      S.me.balance = r2(S.me.balance - total);
      const d = {
        id: 'd' + t.toString(36) + Math.random().toString(36).slice(2, 6), official: false,
        publicOwner: anon ? null : me, ownerHandle: anon ? null : S.me.handle, name: p.name.trim().slice(0, 24), color: p.color,
        pool: used, per, maxPeople: p.people, claimed: 0, lat: p.lat, lng: p.lng, r: p.r, visibility: p.vis, rule: p.rule,
        code: code5(), createdAt: t, expiresAt: t + p.minutes * 60000, endedAt: null, settled: false, refund: 0
      };
      S.drops[d.id] = d; S.mine.push(d.id); sync(); return D.drops[d.id];
    },
    async claim(id, pos) {
      const me = need(), d = S.drops[id]; if (!d) fail('That drop doesn’t exist.');
      if (d.visibility === 'code' && !S.unlocks.includes(id) && !S.mine.includes(id)) fail('Enter the drop code first.');
      if (d.endedAt || now() >= d.expiresAt) fail('This blimp drifted off.');
      if (d.claimed >= d.maxPeople) fail('Every claim is taken.');
      if (S.mine.includes(id)) fail('This is your drop.');
      if (Object.values(S.claims).some(c => c.dropId === id && c.userId === me)) fail('You already claimed this one.');
      if (d.rule === 'there') { if (!pos) fail('Turn on location to claim.'); if (distM(d, pos) > d.r + Math.min(pos.acc || 0, 30)) fail('Get inside the zone to claim.'); }
      const c = { id: 'c' + now().toString(36) + Math.random().toString(36).slice(2, 5), dropId: id, userId: me, amount: d.per, lat: pos && pos.lat, lng: pos && pos.lng, sim: false, at: now() };
      S.claims[c.id] = c; d.claimed++; S.me.balance = r2(S.me.balance + d.per); settle(d); sync();
      return { amount: d.per, balance: S.me.balance, name: d.name };
    },
    async endDrop(id) { const d = S.drops[id]; if (!S.mine.includes(id)) fail('Not your drop.'); if (!isOver(d)) d.endedAt = now(); settle(d); sync(); },
    async simulate(id) {
      const d = S.drops[id]; if (!S.mine.includes(id)) fail('Not your drop.'); if (isOver(d)) fail('This drop is over.');
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * d.r * 0.9;
      const c = { id: 's' + now().toString(36) + Math.random().toString(36).slice(2, 5), dropId: id, userId: null, amount: d.per, sim: true, at: now(),
        lat: d.lat + rr * Math.cos(a) / 111320, lng: d.lng + rr * Math.sin(a) / (111320 * Math.cos(d.lat * Math.PI / 180)) };
      S.claims[c.id] = c; d.claimed++; settle(d); sync();
    },
    async settleMine() { let n = 0; S.mine.forEach(id => { const d = S.drops[id]; if (d && !d.settled && isOver(d)) { settle(d); n++; } }); if (n) sync(); },
    async unlock(code) {
      need(); const d = Object.values(S.drops).find(x => x.code === code.trim().toUpperCase());
      if (!d) fail('No drop with that code.'); if ((d.endedAt || now() >= d.expiresAt) && !S.mine.includes(d.id)) fail('That drop already drifted off.');
      if (!S.unlocks.includes(d.id)) S.unlocks.push(d.id); sync(); return D.drops[d.id];
    },
    async follow(userId) { need(); const f = S.me.follows; const i = f.indexOf(userId); if (i >= 0) f.splice(i, 1); else f.push(userId); sync(); },
    async setPayout(type) { need(); S.me.payout = { type, last4: type === 'bank' ? '6789' : '4242' }; sync(); },
    async cashOut() {
      need(); if (!S.me.payout) fail('Set up payouts first.'); const amt = S.me.balance; if (amt <= 0) fail('Nothing to cash out yet.');
      S.me.cashouts.unshift({ amt, at: now(), to: (S.me.payout.type === 'bank' ? 'Bank account' : 'Debit card') + ' •••• ' + S.me.payout.last4 + ' (demo)' });
      S.me.balance = 0; sync(); return amt;
    },
    async addPlay() { need(); S.me.balance = Math.min(100000, r2(S.me.balance + 500)); sync(); },
    async signOut() { S.user = null; S.me = null; sync(); },
    reset() { S = seed(); sync(); }
  };
}
