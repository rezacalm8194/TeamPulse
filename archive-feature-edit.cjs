const fs=require('fs');
let s=fs.readFileSync('app.js','utf8').replace(/\r\n/g,'\n');
function rep(a,b){if(!s.includes(a))throw Error(a.slice(0,100));s=s.replace(a,b);}
rep("appLanguage:'fa' };","appLanguage:'fa', archive_stale_days:14 };");
rep('d.meta = {...DEFAULT_META,...(d.meta||{})};','d.meta = {...DEFAULT_META,...(d.meta||{})};\n  if(!Number.isFinite(Number(d.meta.archive_stale_days))||Number(d.meta.archive_stale_days)<1)d.meta.archive_stale_days=14;');
rep('d.reminders.forEach(r=>{','d.reminders.forEach(r=>{if(r.source===undefined)r.source=\'\';');
rep("if(s.relationship_status===undefined)s.relationship_status='';","if(s.relationship_status===undefined)s.relationship_status='';\n    ['next_activity_type','next_activity_date','next_activity_note','last_activity_at'].forEach(k=>{if(s[k]===undefined)s[k]='';});");
rep('s.archived=false;s.updated_at=touchedAt;','s.archived=false;s.last_activity_at=touchedAt;s.updated_at=touchedAt;');
rep("s.relationship_status=String(p.value||'');s.updated_at=touchedAt;","s.relationship_status=String(p.value||'');s.last_activity_at=touchedAt;s.updated_at=touchedAt;");
rep('s.archived=!!p.archived;s.updated_at=new Date().toISOString();','s.archived=!!p.archived;s.last_activity_at=new Date().toISOString();s.updated_at=s.last_activity_at;');
rep('const item={id,name,lname,phone:',"const item={id,name,lname,next_activity_type:p.next_activity_type||'',next_activity_date:p.next_activity_date||'',next_activity_note:p.next_activity_note||'',last_activity_at:p.last_activity_at||'',phone:");
rep('return _P({ok:true,count:added.length});','return _P({ok:true,count:added.length,ids:added.map(s=>s.id)});');
rep("const description=p.description??p.address??p.main_need??s.description??s.address??s.main_need??'';","const description=p.description??p.address??p.main_need??s.description??s.address??s.main_need??'';\n      if((p.relationship_status!==undefined&&p.relationship_status!==s.relationship_status)||['next_activity_type','next_activity_date','next_activity_note'].some(k=>p[k]!==undefined&&p[k]!==s[k]))s.last_activity_at=new Date().toISOString();\n      ['next_activity_type','next_activity_date','next_activity_note'].forEach(k=>{if(p[k]!==undefined)s[k]=p[k];});");
rep("package_id:p.package_id||null,title:p.title||'یادآوری'","package_id:p.package_id||null,source:p.source||'',title:p.title||'یادآوری'");
rep('if(cat){\n      const sc=',"if(archiveStaleFilter==='stale'&&!isArchiveStale(s))return false;\n    if(archiveStaleFilter==='fresh'&&isArchiveStale(s))return false;\n    if(cat){\n      const sc=");
rep('<div class="archive-toolbar-filters">','<div class="archive-toolbar-filters">${archiveViewControlsHtml()}');
rep('<div class="archive-mobile-list" id="archive-mobile-list"></div>','<div class="archive-mobile-list" id="archive-mobile-list"></div><div class="archive-pipeline" id="archive-pipeline" dir="rtl"></div>');
rep('  updateArchiveBulkbar();\n}\n\nfunction toggleArchiveMobileCard','  paintArchivePipeline(rows);\n  updateArchiveBulkbar();\n}\n\nfunction toggleArchiveMobileCard');
rep('<div class="archive-actions"><button','${archiveActivityHtml(s)}<div class="archive-actions"><button class="btn btn-ghost btn-sm" onclick="markArchiveFollowup(${s.id})">پیگیری</button><button');
rep('<div class="archive-mobile-sub">','${archiveActivityHtml(s)}<div class="archive-mobile-sub">');
const start=s.indexOf('async function markArchiveFollowup('),end=s.indexOf('\nfunction openArchiveMobileMore',start);
s=s.slice(0,start)+`function markArchiveFollowup(id){const person=archiveStudents.find(x=>Number(x.id)===Number(id));if(!person)return;openModal('پیگیری بایگانی',archiveActivityFields(person),[{label:'ذخیره',cls:'btn-primary',action:\`saveArchiveFollowup(\${id})\`},{label:'انصراف',cls:'btn-ghost',action:'closeModal()'}]);initDatePickers();}
`+s.slice(end);
rep("${archiveExtraFieldsHtml(s,'archive',['نوع فعالیت','شهر'])}","${archiveActivityFields(s)}${archiveExtraFieldsHtml(s,'archive',['نوع فعالیت','شهر'])}");
rep('async function saveArchivePerson(id){const old=',"async function saveArchivePerson(id){const activity=readArchiveActivity(false);if(!activity)return;const old=");
rep('const data={name,lname,phone:document.getElementById(\'ar-phone\')',"const data={...activity,name,lname,phone:document.getElementById('ar-phone')");
rep("}else await window.api.students.addArchivedBulk([data]);closeModal();","}else {const result=await window.api.students.addArchivedBulk([data]);id=result.ids[0];}if(activity.next_activity_date||old?.next_activity_date)await persistArchiveActivity(id,activity);closeModal();");
fs.writeFileSync('app.js',s.replace(/\n/g,'\r\n'));

