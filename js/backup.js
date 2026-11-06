/* ===========================================================
   backup.js —— 数据备份与恢复
   =========================================================== */
function renderBackup(){
  var size = 0;
  try{ size = JSON.stringify(DB).length; }catch(e){}
  var hist = DB.quadDone || [];
  var histDone = hist.filter(function(x){ return x.removed === 'done'; }).length;
  var h = '<div class="card"><h2>数据备份与恢复</h2>'
    +'<p class="hint">数据保存在本机浏览器（localStorage）。请养成习惯：每次大考导入后点「导出备份」，把 JSON 文件存到 U 盘或网盘。换电脑/换浏览器后，用「导入恢复」读回。</p>'
    +'<div class="row">'
    +'<button onclick="exportJSON()">导出全部数据为 JSON（备份）</button>'
    +'<label class="ghost" style="display:inline-block;padding:8px 15px;border:1px solid var(--primary);border-radius:7px;color:var(--primary);cursor:pointer;">导入恢复 JSON'
    +'<input type="file" accept=".json" style="display:none" onchange="importJSON(this)"></label>'
    +'</div><div class="row">'
    +'<button class="ghost" onclick="exportCSV(\'students\')">导出学生表 CSV</button>'
    +'<button class="ghost" onclick="exportCSV(\'scores\')">导出成绩表 CSV</button>'
    +'<button class="ghost" onclick="exportCSV(\'records\')">导出成长记录 CSV</button>'
    +'</div>'
    +'<div class="row" style="margin-top:10px"><button class="danger" onclick="clearAll()">清空全部数据</button></div></div>';

  h += '<div class="card"><h2>当前数据概况</h2><div class="grid2">'
    +'<div><table><tbody>'
    +'<tr><td>学生</td><td>'+DB.students.length+' 人</td></tr>'
    +'<tr><td>考试</td><td>'+DB.exams.length+' 次</td></tr>'
    +'<tr><td>成绩记录</td><td>'+DB.scores.length+' 条</td></tr>'
    +'<tr><td>临界生</td><td>'+DB.students.filter(function(s){return s.isBorderline;}).length+' 人</td></tr>'
    +'</tbody></table></div><div><table><tbody>'
    +'<tr><td>课表安排</td><td>'+DB.schedule.length+' 条（分 '+DB.weeks.length+' 周，其中固定课 '
      +DB.schedule.filter(function(x){return x.fixed;}).length+' 节）</td></tr>'
    +'<tr><td>待办（四象限）</td><td>'+quadCount()+' 条（历史记录 '+hist.length+' 条：'
      +'已完成 '+histDone+' / 已删除 '+(hist.length-histDone)+'）</td></tr>'
    +'<tr><td>重要日期</td><td>'+DB.events.length+' 条</td></tr>'
    +'<tr><td>成长记录</td><td>'+DB.records.length+' 条（待跟进 '+pendingFollowUps().length+'）</td></tr>'
    +'<tr><td>数据体积</td><td>'+(size/1024).toFixed(1)+' KB</td></tr>'
    +'</tbody></table></div></div></div>';

  /* 数据自检与修复 */
  h += '<div class="card"><h2>数据体检（找问题）</h2>'
    +'<p class="hint">自动检查数据是否一致。发现问题时可以一键修复，不用手动整理。</p><div id="fixBox"></div>'
    +'<div class="row"><button class="ghost" onclick="checkData()">开始体检</button></div></div>';

  $('content').innerHTML = h;
}

/* 数据自检：找出版本不匹配、孤儿记录、重复 key 等问题 */
function checkData(){
  var box = $('fixBox');
  var issues = [];
  /* 1. 学生缺 key */
  var noKey = DB.students.filter(function(s){ return !s.key; });
  if(noKey.length) issues.push({n:noKey.length, t:'有 '+noKey.length+' 名学生缺少唯一标识', f:'<button class="sm" onclick="fixKeys()">补齐</button>'});
  /* 2. key 重复 */
  var seen = {}, dup = [];
  DB.students.forEach(function(s){ if(seen[s.key]) dup.push(s.key); seen[s.key]=1; });
  if(dup.length) issues.push({n:dup.length, t:dup.length+' 个唯一标识重复（'+dup.slice(0,3).join('、')+'…）', f:'<button class="sm" onclick="fixKeys()">重新分配</button>'});
  /* 3. 成绩/成长记录找不到对应学生（常见于早期版本按学号存，改成班级+学号后失联） */
  var lostScore = DB.scores.filter(function(sc){ return !studentByKey(sc.studentId); });
  if(lostScore.length) issues.push({n:lostScore.length, t:lostScore.length+' 条成绩找不到对应学生', f:'<button class="sm" onclick="fixRefs()">尝试重新关联</button>'});
  var lostRec = DB.records.filter(function(r){ return !studentByKey(r.studentId); });
  if(lostRec.length) issues.push({n:lostRec.length, t:lostRec.length+' 条成长记录找不到对应学生', f:'<button class="sm" onclick="fixRefs()">尝试重新关联</button>'});
  /* 4. 同学号跨班（提示，非错误） */
  var byId = {};
  DB.students.forEach(function(s){ (byId[String(s.id)] = byId[String(s.id)]||[]).push(s.cls); });
  var clash = Object.keys(byId).filter(function(id){ return byId[id].length>1; });
  if(clash.length){
    issues.push({n:clash.length, t:clash.length+' 个学号在多个班重复使用（'+clash.slice(0,5).join('、')+'…）——这是正常的，各班独立', f:'<span class="muted">无需处理</span>'});
  }
  /* 5. 空班级 */
  var noCls = DB.students.filter(function(s){ return !s.cls; });
  if(noCls.length) issues.push({n:noCls.length, t:noCls.length+' 名学生没填班级', f:'<span class="muted">可在学生档案里补</span>'});
  /* 6. 缺考数据体检：这类脏数据会悄悄算错统计，得能看出来 */
  var abNoRank = DB.scores.filter(function(sc){ return sc.absent && (sc.classRank || sc.gradeRank); });
  if(abNoRank.length){
    issues.push({n:abNoRank.length, t:abNoRank.length+' 条缺考记录还带着班排/年级排（缺考不该有排名，会挤占别人的名次）',
      f:'<button class="sm" onclick="fixAbsentRank()">清除排名</button>'});
  }
  var abBad = DB.scores.filter(function(sc){ return sc.absent && Number(sc.score)!==0; });
  /* 开学日期填错（比如填成未来的日期）会算出离谱的周次，这类脏数据要能看出来 */
  var badTerm = (DB.settings.termStart && new Date(DB.settings.termStart) > new Date()) ? 1 : 0;
  if(badTerm){
    issues.push({n:1, t:'开学日期（'+esc(DB.settings.termStart)+'）填成了未来的日期，会算出错误的周次。周次现在直接手填，这个日期已用不上了',
      f:'<button class="sm" onclick="clearTermStart()">清除开学日期</button>'});
  }
  if(abBad.length){
    issues.push({n:abBad.length, t:abBad.length+' 条缺考记录分数不是 0（不影响统计，但数据不干净）',
      f:'<button class="sm" onclick="fixAbsentScore()">归零</button>'});
  }
  /* 7. 疑似漏标的缺考：同一场里分数全是 0，可能是「没考」被当成了「考 0 分」 */
  var byExam = {};
  DB.scores.forEach(function(sc){ (byExam[sc.examId] = byExam[sc.examId]||[]).push(sc); });
  var zeroHeavy = Object.keys(byExam).filter(function(eid){
    var arr = byExam[eid].filter(function(x){ return !x.absent; });
    if(arr.length<5) return false;                /* 人太少的场次不猜 */
    var zeros = arr.filter(function(x){ return Number(x.score)===0; }).length;
    return zeros>=3 && zeros/arr.length>=0.3;      /* 三成以上是 0 分，多半是漏标 */
  });
  if(zeroHeavy.length){
    var names = zeroHeavy.map(function(eid){ var e=examById(eid); return e?e.name:eid; });
    issues.push({n:zeroHeavy.length,
      t:zeroHeavy.length+' 场考试有较多 0 分记录（'+names.slice(0,3).join('、')+'…），可能是「缺考」被当成了「考 0 分」：到「成绩名册」核对一下，勾上缺考即可',
      f:'<span class="muted">需人工核对</span>'});
  }

  if(!issues.length){
    box.innerHTML = '<p class="ok-t">✓ 体检通过，没有发现问题。数据一致。</p>';
    return;
  }
  var h = '<p class="muted" style="margin-bottom:8px;">发现 '+issues.length+' 项：</p><table><tbody>';
  issues.forEach(function(i){
    h += '<tr><td style="width:40px"><span class="badge '+(i.f.indexOf('无需')>=0?'ok':'warn')+'">'+i.n+'</span></td>'
      +'<td>'+esc(i.t)+'</td><td style="width:120px;text-align:right">'+i.f+'</td></tr>';
  });
  box.innerHTML = h + '</tbody></table>';
}
function fixKeys(){ ensureStudentKeys(DB); saveDB(); checkData(); toast('已重新分配唯一标识'); }
function fixRefs(){
  migrateRefsToKey(DB); saveDB(); checkData(); toast('已尝试重新关联');
}
/* 缺考记录的清理：排名清空、分数归零（都不影响统计，只是让数据一致） */
function fixAbsentRank(){
  var n=0;
  DB.scores.forEach(function(sc){ if(sc.absent && (sc.classRank || sc.gradeRank)){ sc.classRank=''; sc.gradeRank=''; sc.rkSrc=''; n++; } });
  saveDB(); checkData(); toast('已清除 '+n+' 条缺考记录的排名');
}
function fixAbsentScore(){
  var n=0;
  DB.scores.forEach(function(sc){ if(sc.absent && Number(sc.score)!==0){ sc.score=0; n++; } });
  saveDB(); checkData(); toast('已把 '+n+' 条缺考记录归零');
}
/* 清掉没用的开学日期（周次现在手填，不再靠日期推算） */
function clearTermStart(){
  DB.settings.termStart = '';
  saveDB(); checkData(); toast('已清除开学日期');
}

function downloadBlob(content, filename, mime){
  var blob = new Blob([content], {type:mime||'application/octet-stream'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
}

function exportJSON(){
  downloadBlob(JSON.stringify(DB, null, 2),
    '数学工作台备份_'+todayStr()+'.json', 'application/json');
  toast('已导出备份');
}

function importJSON(input){
  var f = input.files[0]; if(!f) return;
  var r = new FileReader();
  r.onload = function(){
    var d;
    try{ d = normalizeDB(JSON.parse(r.result)); }
    catch(e){ toast('文件格式错误'); input.value=''; return; }
    if(!confirm('导入将覆盖当前全部数据（含课表、待办、日程），确定继续？')){ input.value=''; return; }
    DB = d; selStudent = null; saveDB(); render();
    toast('已恢复备份');
    input.value = '';
  };
  r.readAsText(f, 'utf-8');
}

function exportCSV(type){
  var rows = [];
  if(type==='students'){
    rows.push(['学号','姓名','性别','班级','是否为临界生','薄弱知识点','备注','平时作业','课堂表现']);
    DB.students.forEach(function(s){
      rows.push([s.id,s.name,s.gender,s.cls,s.isBorderline?'是':'',s.kpTags.join('/'),s.remark,s.homework,s.performance]);
    });
  } else if(type==='records'){
    rows.push(['学号','姓名','日期','内容','需要跟进','跟进完成日期','跟进结果']);
    DB.records.slice().sort(function(a,b){ return a.date<b.date?1:(a.date>b.date?-1:0); }).forEach(function(r){
      var s = studentByKey(r.studentId);
      rows.push([r.studentId, s?s.name:'(已删除)', r.date, r.content,
        r.followUp?'是':'', r.followedAt, r.result]);
    });
  } else {
    /* 成绩表导出：分数列缺考写「缺考」文字而不是 0，
   再单独给一列「是否缺考」，方便你在 Excel 里直接筛。
     年级排名来源也要导出：'school' 是学校给的真实年级名次，'auto' 只是本地按手上这几个班
     算出来的。两者量级完全不同（几百人 vs 约 100 人），不标出来的话，
     半年后回看这份 CSV 会把两种名次当成同一把尺子，得出错误结论。 */
rows.push(['学号','姓名','考试名称','考试日期','类型','分数','是否缺考','得分率','满分','班级排名','年级排名','年级排名来源']);
    DB.scores.forEach(function(sc){
      var s = studentByKey(sc.studentId), e = examById(sc.examId);
      var ab = !!sc.absent;
      var fs = e ? fullScoreOf(e) : 100;
      rows.push([sc.studentId, s?s.name:'', e?e.name:'', e?e.date:'', e?e.type:'',
        ab ? ABSENT_TXT : sc.score,
        ab ? '缺考' : '',
        ab ? '' : (Math.round(rateOf(sc.score, fs)*10)/10)+'%',
        e?e.fullScore:'', ab?'':sc.classRank, ab?'':sc.gradeRank,
        ab ? '' : (sc.rkSrc==='school' ? '学校' : sc.rkSrc==='auto' ? '本地计算' : '')]);
    });
  }
  var csv = '\ufeff' + rows.map(function(r){
    return r.map(function(c){ return '"'+String(c==null?'':c).replace(/"/g,'""')+'"'; }).join(',');
  }).join('\n');
  var nameMap = {students:'学生表', scores:'成绩表', records:'成长记录'};
  downloadBlob(csv, nameMap[type]+'_'+todayStr()+'.csv', 'text/csv');
  toast('已导出 CSV');
}

function clearAll(){
  if(!confirm('确认清空全部数据？此操作不可恢复（除非你已有 JSON 备份）。')) return;
  if(!confirm('再次确认：将删除学生、成绩、课表、待办、日程等全部数据。')) return;
  DB = emptyDB(); selStudent = null; saveDB(); render(); toast('已清空');
}
