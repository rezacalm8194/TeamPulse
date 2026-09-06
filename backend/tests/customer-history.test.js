const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
function fn(name) {
  const match = new RegExp(`(?:async\\s+)?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  let depth=0;
  for(let i=source.indexOf('{',match.index);i<source.length;i++) {
    if(source[i]==='{')depth++;
    if(source[i]==='}'&&--depth===0)return source.slice(match.index,i+1);
  }
  throw Error(name);
}
function setup() {
  const db={meta:{timezone:'Asia/Tehran'},students:[{id:1,name:'مینا',note:'عمومی',archived:true}],sessions:[],payments:[],packages:[],package_types:[{id:1,label:'مشاوره'}]};
  const context=vm.createContext({_db:db,Intl,Date,_P:Promise.resolve.bind(Promise),_save:()=>{},_nextId:()=>2,_reconcileStudentPaymentReminders:()=>{},
    _formatJalali:(...p)=>p.join('/'),_todayJalali:()=>[1405,6,15],
    _jalaliKey:s=>Number(String(s||'').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).split('/').map((x,i)=>i?x.padStart(2,'0'):x).join('')),
    fmt:String,fa:String,escapeHtml:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;')});
  for(const name of ['studentIsoJalali','studentContactSchedule','studentContactScheduleHtml','studentTimeline','studentTimelineHtml','studentPinnedNoteHtml'])vm.runInContext(fn(name),context);
  const start=source.indexOf('  students: {',source.indexOf('window.api = {'));
  const end=source.indexOf('\n  packages:',start);
  assert.ok(end>start);
  context.api=vm.runInContext('({'+source.slice(start,end)+'})',context).students;
  return {db,context};
}
test('timeline merges only this customer’s sessions, payments and purchases, newest first',()=>{
  const {db,context:c}=setup(); db.students[0].note='';
  db.sessions=[{id:1,student_id:1,date_jalali:'1405/06/12',title:'جلسه اول',note:'<script>unsafe</script>'},{id:2,student_id:9,date_jalali:'1405/07/01'}];
  db.payments=[{id:1,student_id:1,date_jalali:'1405/06/14',amount:500,currency:'تومان'}];
  db.packages=[{id:1,student_id:1,start_date:'1405/06/13',type_id:1,total_amount:1000}];
  assert.deepEqual(Array.from(c.studentTimeline(1),e=>e.type),['payment','purchase','session']);
  assert.match(c.studentTimelineHtml(1),/openSessionDetail\(1\)/);
  assert.doesNotMatch(c.studentTimelineHtml(1),/<script>/);
  assert.match(c.studentTimelineHtml(1,1),/نمایش بیشتر/);
});
test('single and bulk conversion stamp once and appear in the timeline',async()=>{
  for(const bulk of [false,true]){
    const {db,context:c}=setup();
    const convert=()=>bulk?c.api.bulkArchiveAction({ids:[1],action:'convert'}):c.api.setArchived({id:1,archived:false});
    await convert();
    assert.ok(Date.parse(db.students[0].converted_from_archive_at));
    assert.ok(c.studentTimeline(1).some(e=>e.type==='conversion'&&e.date_jalali));
    db.students[0].converted_from_archive_at='2020-01-01T00:00:00Z'; db.students[0].archived=true;
    await convert(); assert.equal(db.students[0].converted_from_archive_at,'2020-01-01T00:00:00Z');
  }
});
test('pin-only update preserves customer, purchases and payments; unchanged pin keeps its date',async()=>{
  const {db,context:c}=setup();
  db.packages=[{id:7,student_id:1,total_amount:1000}];db.payments=[{id:3,student_id:1,amount:100}];
  const before=JSON.stringify({packages:db.packages,payments:db.payments});
  await c.api.update({id:1,pinned_note:'  مهم  '});
  assert.equal(db.students[0].pinned_note,'مهم');assert.equal(db.students[0].name,'مینا');assert.equal(db.students[0].note,'عمومی');
  assert.equal(JSON.stringify({packages:db.packages,payments:db.payments}),before);
  db.students[0].pinned_note_updated_at='2026-01-01T00:00:00Z';
  await c.api.update({id:1,pinned_note:'مهم'});
  assert.equal(db.students[0].pinned_note_updated_at,'2026-01-01T00:00:00Z');
  assert.match(c.studentPinnedNoteHtml(db.students[0]),/مهم/);
  const detail=fn('openStudentDetail');
  assert.ok(detail.indexOf('studentPinnedNoteHtml(s)')<detail.indexOf('<h3>اطلاعات'));
  assert.ok(detail.indexOf('studentTimelineHtml(id)')<detail.indexOf('<h3>پکیج‌ها'));
  await c.api.update({id:1,pinned_note:'x'.repeat(600)});assert.equal(db.students[0].pinned_note.length,500);
  await c.api.update({id:1,pinned_note:''});assert.equal(db.students[0].note,'عمومی');
});
test('schedule chooses nearest session on or after today, latest session independently, then timestamp fallback',()=>{
  const {db,context:c}=setup();
  db.sessions=['1405/06/10','1405/06/20','1405/06/15','۱۴۰۵/۰۶/۱۸'].map((date_jalali,id)=>({id,student_id:1,date_jalali}));
  assert.equal(c.studentContactSchedule(1).next_session_date,'1405/06/15');
  assert.equal(c.studentContactSchedule(1).last_session_date,'1405/06/20');
  assert.equal(c.studentContactSchedule(1,'1405/06/21').next_session_date,'');
  db.sessions=[];db.students[0].last_activity_at='2026-09-06T10:00:00Z';
  assert.ok(c.studentContactSchedule(1).last_contact_date);assert.equal(c.studentContactSchedule(1).next_session_date,'');
});
test('new customer gets separate pin, conversion and note date defaults',async()=>{
  const {db,context:c}=setup();
  await c.api.add({name:'جدید',lname:'مشتری',pinned_note:'پین',packages:[]});
  assert.equal(db.students[1].pinned_note,'پین');assert.equal(db.students[1].converted_from_archive_at,'');
  assert.ok(db.students[1].pinned_note_updated_at);
});
test('migration defaults preserve existing pin and conversion; asset and worker versions agree',()=>{
  const migration=fn('_migrate');
  const defaults=migration.match(/\['pinned_note','converted_from_archive_at','note_updated_at','pinned_note_updated_at'\]\.forEach\(k=>\{if\(s\[k\]===undefined\)s\[k\]='';\}\);/);
  assert.ok(defaults);
  const legacy={note:'عمومی'};
  vm.runInNewContext(defaults[0],{s:legacy});
  assert.equal(legacy.pinned_note,'');assert.equal(legacy.converted_from_archive_at,'');
  legacy.pinned_note='مهم';legacy.converted_from_archive_at='2026-01-01T00:00:00Z';
  vm.runInNewContext(defaults[0],{s:legacy});assert.equal(legacy.pinned_note,'مهم');assert.equal(legacy.converted_from_archive_at,'2026-01-01T00:00:00Z');
  const version=source.match(/const TP_ASSET_V = 'tp(\d+)'/)[1];
  assert.ok(source.includes(`/sw.js?v=team-pulse-static-v${version}`));
  const worker=fs.readFileSync(path.resolve(__dirname,'../../sw.js'),'utf8');
  assert.ok(worker.includes(`team-pulse-static-v${version}`));
  const html=fs.readFileSync(path.resolve(__dirname,'../../app.html'),'utf8');
  for(const match of html.matchAll(/\?v=tp(\d+)/g))assert.equal(match[1],version);
});
