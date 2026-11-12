import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const q = (s, p) => db.query(s, p);
await db.exec(`
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create role anon; create role authenticated;
create publication supabase_realtime;
`);
const sqlText=fs.readFileSync('supabase/schema.sql','utf8').replace(/create extension[^;]*;/,'');
try { await db.exec(sqlText); } catch(e){ console.log('SCHEMA ERROR:', e.message); process.exit(1); }
const A='11111111-1111-1111-1111-111111111111', B='22222222-2222-2222-2222-222222222222', C='33333333-3333-3333-3333-333333333333';
for (const u of [A,B,C]) await q('insert into auth.users(id) values ($1)',[u]);
const as = async (u, sql, params) => { await db.exec(`select set_config('request.jwt.claim.sub','${u}',false)`); try { return (await q(sql, params)).rows; } catch(e) { return {err: e.message}; } };
const bal = async u => (await q('select balance from wallets where user_id=$1',[u])).rows[0].balance;
const ok=(name,cond)=>console.log((cond?'PASS ':'FAIL ')+name);

ok('wallet created with 500', Number(await bal(A))===500);
ok('handle set', (await as(A,"select set_handle('@Vance') h"))[0]?.h==='vance');
ok('handle taken blocked', (await as(B,"select set_handle('vance')")).err?.includes('taken'));
const welcome=(await q("select id from drops where code='BLIMP'")).rows[0].id;
const secret=(await q("select id from drops where code='FRONT'")).rows[0].id;
// claim outside zone
ok('outside zone blocked', (await as(B,'select claim_drop($1,$2,$3)',[welcome,34.2450,-77.9480])).err?.includes('inside the zone'));
// claim inside
const r=await as(B,'select claim_drop($1,$2,$3) j',[welcome,34.23580,-77.94790]);
ok('claim inside works', r[0]?.j?.amount==10 && Number(await bal(B))===510);
ok('double claim blocked', (await as(B,'select claim_drop($1,$2,$3)',[welcome,34.23580,-77.94790])).err?.includes('already'));
ok('code drop needs code', (await as(B,'select claim_drop($1,$2,$3)',[secret,34.2386,-77.9490])).err?.includes('code first'));
ok('unlock by code', (await as(B,"select name n from unlock_code('front')"))[0]?.n==='Secret on Front');
ok('code drop claim after unlock', (await as(B,'select claim_drop($1,$2,$3) j',[secret,34.2386,-77.9490]))[0]?.j?.amount==10);
// create drop by A named
const dres=await as(A,"select * from create_drop('Friday on Front','Green',100,10,160,10,'public','there',false,34.2357,-77.9478)"); if(dres.err) console.log('CREATE ERR',dres.err); const d=dres[0];
ok('create drop charges pool+fee', Number(await bal(A))===395 && d.owner_handle==='vance' && d.public_owner===A);
const anonD=(await as(A,"select * from create_drop('Anon one','Blue',20,2,100,2,'public','anywhere',true,34.2357,-77.9478)"))[0];
ok('anon drop hides owner', anonD.public_owner===null && anonD.owner_handle===null);
ok('own drop claim blocked', (await as(A,'select claim_drop($1,$2,$3)',[d.id,34.2357,-77.9478])).err?.includes('your drop'));
ok('anywhere rule works', (await as(C,'select claim_drop($1,null,null) j',[anonD.id]))[0]?.j?.amount==10);
ok('simulate by non-owner blocked', (await as(B,'select simulate_claim($1)',[d.id])).err?.includes('Not your drop'));
await as(A,'select simulate_claim($1)',[d.id]); await as(A,'select simulate_claim($1)',[d.id]);
ok('simulated claims counted', (await q('select claimed_count from drops where id=$1',[d.id])).rows[0].claimed_count===2);
await as(A,'select end_drop($1)',[d.id]);
const dd=(await q('select settled, refund from drops where id=$1',[d.id])).rows[0];
console.log('  A balance after end:',await bal(A),'refund',dd.refund);ok('end drop refunds unclaimed', dd.settled && Number(dd.refund)===80 && Number(await bal(A))===454);
ok('claim after end blocked', (await as(C,'select claim_drop($1,$2,$3)',[d.id,34.2357,-77.9478])).err?.includes('drifted'));
ok('settle again is no-op', (await as(A,'select settle_my_drops() n'))[0].n===0 && Number(await bal(A))===454);
// fill anon drop (2 people): C claimed already; B claims -> full -> settled refund 0
await as(B,'select claim_drop($1,null,null)',[anonD.id]);
ok('full drop settles with 0 refund', (await q('select settled,refund from drops where id=$1',[anonD.id])).rows[0].settled);
ok('follow toggles', (await as(B,'select toggle_follow($1) f',[A]))[0].f.length===1);
ok('cash out needs payout', (await as(B,'select cash_out()')).err?.includes('payout'));
await as(B,"select set_payout('card')");
ok('cash out works', Number((await as(B,'select cash_out() a'))[0].a)===530 && Number(await bal(B))===0);
ok('add play money', Number((await as(B,'select add_play_money() b'))[0].b)===500);
ok('not enough money', (await as(C,"select create_drop('Big','Red',5000,10,160,10,'public','there',true,34.2,-77.9)")).err?.includes('Not enough'));
ok('signed-out blocked', (await as('', "select add_play_money()")).err?.includes('Sign in'));
console.log('done');
