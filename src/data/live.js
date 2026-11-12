// Real backend: Supabase (accounts, database, live updates).
// Every money move and rule check happens in the database functions (supabase/schema.sql).
import { createClient } from '@supabase/supabase-js';

const normDrop = r => ({
  id: r.id, official: r.official, publicOwner: r.public_owner, ownerHandle: r.owner_handle,
  name: r.name, color: r.color, pool: +r.pool, per: +r.per, maxPeople: r.max_people, claimed: r.claimed_count,
  lat: r.lat, lng: r.lng, r: r.radius_m, visibility: r.visibility, rule: r.rule, code: r.code,
  createdAt: Date.parse(r.created_at), expiresAt: Date.parse(r.expires_at),
  endedAt: r.ended_at ? Date.parse(r.ended_at) : null, settled: r.settled, refund: +r.refund
});
const normClaim = r => ({ id: String(r.id), dropId: r.drop_id, userId: r.user_id, amount: +r.amount, lat: r.lat, lng: r.lng, sim: r.simulated, at: Date.parse(r.created_at) });
const friendly = e => {
  const m = (e && (e.message || e.error_description)) || 'Something went wrong. Try again.';
  if (/anonymous sign-ins are disabled/i.test(m)) return 'Skipping sign-up isn’t turned on yet. In Supabase: Authentication → Sign In / Providers → allow anonymous sign-ins.';
  if (/sms|phone provider|twilio/i.test(m)) return 'Phone codes aren’t set up yet. Use email for now.';
  if (/rate limit/i.test(m)) return 'Too many codes sent. Wait a minute and try again.';
  return m;
};

export function createLive(url, key) {
  const sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const D = { mode: 'live', ready: false, user: null, me: null, drops: {}, mine: new Set(), claims: {}, handles: {} };
  let listener = () => { }, channel = null, poll = null;
  const emit = ev => listener(ev || {});

  async function loadAll() {
    const uid = D.user.id;
    const [w, p, own, dr, cl, hs, co] = await Promise.all([
      sb.from('wallets').select('*').eq('user_id', uid).maybeSingle(),
      sb.from('profiles').select('handle').eq('id', uid).maybeSingle(),
      sb.from('drop_owners').select('drop_id'),
      sb.from('drops').select('*').order('created_at', { ascending: false }).limit(400),
      sb.from('claims').select('*').order('created_at', { ascending: false }).limit(1500),
      sb.from('profiles').select('id,handle').not('handle', 'is', null).limit(2000),
      sb.from('cashouts').select('*').order('created_at', { ascending: false }).limit(20)
    ]);
    const wl = w.data || {};
    D.me = {
      handle: p.data && p.data.handle || '', balance: wl.balance != null ? +wl.balance : null,
      payout: wl.payout_type ? { type: wl.payout_type, last4: wl.payout_last4 } : null,
      follows: wl.follows || [], cashouts: (co.data || []).map(c => ({ amt: +c.amount, at: Date.parse(c.created_at), to: c.destination }))
    };
    D.mine = new Set((own.data || []).map(r => r.drop_id));
    D.drops = {}; (dr.data || []).forEach(r => { D.drops[r.id] = normDrop(r); });
    D.claims = {}; (cl.data || []).forEach(r => { D.claims[String(r.id)] = normClaim(r); });
    D.handles = {}; (hs.data || []).forEach(r => { D.handles[r.id] = r.handle; });
    D.ready = true; emit();
  }

  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('blimp-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drops' }, ({ eventType, new: r }) => {
        if (!r || !r.id) return;
        const isNew = eventType === 'INSERT' && !D.drops[r.id];
        D.drops[r.id] = normDrop(r); emit(isNew ? { type: 'newdrop', id: r.id } : null);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'claims' }, ({ new: r }) => { if (r && r.id) { D.claims[String(r.id)] = normClaim(r); emit(); } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallets' }, ({ new: r }) => {
        if (!r || r.user_id !== D.user.id || !D.me) return;
        D.me.balance = +r.balance; D.me.follows = r.follows || [];
        D.me.payout = r.payout_type ? { type: r.payout_type, last4: r.payout_last4 } : null; emit();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, ({ new: r }) => {
        if (!r || !r.id) return; if (r.handle) D.handles[r.id] = r.handle;
        if (r.id === D.user.id && D.me) D.me.handle = r.handle || ''; emit();
      })
      .subscribe();
    clearInterval(poll);
    poll = setInterval(() => { if (D.user && !document.hidden) loadAll().catch(() => { }); }, 30000);
  }

  async function onSession(session) {
    if (!session) { D.user = null; D.me = null; D.ready = true; if (channel) { sb.removeChannel(channel); channel = null; } emit(); return; }
    const u = session.user;
    D.user = { id: u.id, isAnon: !!u.is_anonymous, phone: u.phone || '', email: u.email || '' };
    await loadAll(); subscribe();
  }

  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw new Error(friendly(error)); return data; };
  const ensureUser = async () => { if (!D.user) { const { error } = await sb.auth.signInAnonymously(); if (error) throw new Error(friendly(error)); } };

  return {
    D,
    onChange(fn) { listener = fn; },
    async start() {
      const { data } = await sb.auth.getSession();
      sb.auth.onAuthStateChange((evt, session) => {
        if (evt === 'SIGNED_IN' || evt === 'SIGNED_OUT' || evt === 'USER_UPDATED') setTimeout(() => onSession(session).catch(() => { }), 0);
      });
      await onSession(data.session);
    },
    async skip() { await ensureUser(); },
    // Sign-up / upgrade a guest account with phone or email (6-digit code)
    async sendCode(kind, value) {
      const upgrading = D.user && D.user.isAnon;
      let res;
      if (upgrading) res = await sb.auth.updateUser(kind === 'phone' ? { phone: value } : { email: value });
      else res = await sb.auth.signInWithOtp(kind === 'phone' ? { phone: value } : { email: value, options: { shouldCreateUser: true } });
      if (res.error) throw new Error(friendly(res.error));
      return upgrading;
    },
    async verifyCode(kind, value, token, upgrading) {
      const type = kind === 'phone' ? (upgrading ? 'phone_change' : 'sms') : (upgrading ? 'email_change' : 'email');
      const { error } = await sb.auth.verifyOtp(kind === 'phone' ? { phone: value, token, type } : { email: value, token, type });
      if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'That code didn’t work. Check it or resend.' : friendly(error));
      const { data } = await sb.auth.getSession(); await onSession(data.session);
    },
    async setHandle(h) { const v = await rpc('set_handle', { p_handle: h }); D.me.handle = v; D.handles[D.user.id] = v; emit(); return v; },
    async createDrop(p) {
      const r = await rpc('create_drop', {
        p_name: p.name, p_color: p.color, p_pool: p.pool, p_people: p.people, p_radius: p.r, p_minutes: p.minutes,
        p_visibility: p.vis, p_rule: p.rule, p_anon: p.anon, p_lat: p.lat, p_lng: p.lng
      });
      D.drops[r.id] = normDrop(r); D.mine.add(r.id); loadAll().catch(() => { }); return D.drops[r.id];
    },
    async claim(id, pos) {
      const r = await rpc('claim_drop', { p_drop: id, p_lat: pos ? pos.lat : null, p_lng: pos ? pos.lng : null, p_accuracy: pos ? pos.acc || 0 : 0 });
      if (D.me) D.me.balance = +r.balance;
      loadAll().catch(() => { }); return { amount: +r.amount, balance: +r.balance, name: r.name };
    },
    async endDrop(id) { await rpc('end_drop', { p_drop: id }); await loadAll(); },
    async simulate(id) { await rpc('simulate_claim', { p_drop: id }); await loadAll(); },
    async settleMine() { const n = await rpc('settle_my_drops'); if (n) await loadAll(); },
    async unlock(code) { const r = await rpc('unlock_code', { p_code: code }); D.drops[r.id] = normDrop(r); emit(); return D.drops[r.id]; },
    async follow(userId) { const f = await rpc('toggle_follow', { p_user: userId }); D.me.follows = f || []; emit(); },
    async setPayout(type) { await rpc('set_payout', { p_type: type }); await loadAll(); },
    async cashOut() { const a = await rpc('cash_out'); await loadAll(); return +a; },
    async addPlay() { await rpc('add_play_money'); await loadAll(); },
    async signOut() { await sb.auth.signOut(); }
  };
}
