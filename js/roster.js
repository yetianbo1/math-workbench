/* ===========================================================
   roster.js —— 成绩名册核对表

   为什么需要它 ——
   光靠「导入 Excel」标缺考不够用：Excel 里往往只列出考了的人，
   缺考的人根本没那一行，光看表格根本看不出少了谁、少了几个。
   所以这里给一张「按班级点名」的名册：这场该到的学生一个个列出来，
   分数可以直接填，没来的点一下「缺考」，谁没登记一眼就看到。

   名册只做两件事：
     1. 补录 / 修改分数（比单条下拉框快，按学号顺序一路填下来）
     2. 标记缺考（缺考不计入平均分、及格率、优秀率、低分率、分布图的分母）
   =========================================================== */

var ROSTER_EXAM = '';   // 名册当前选中的考试 id
var ROSTER_CLS = '';    // 名册当前选中的班级（空 = 该场考试涉及的所有班）

/* 名册卡片的外壳（含下拉框），插在「导入成绩」和「逐条补录」之间 */
function renderRosterCard(){
  var clsList = allClasses();
  var examOpts = '<option value="">— 请选择考试 —</option>' +
    examsSorted().map(function(e){
      var ecl = examClsList(e);
      return '<option value="'+esc(e.id)+'"'+(ecl.length===1?' data-cls="'+esc(ecl[0])+'"':'')+'>'
        +esc(examOptionLabel(e))+'</option>';
    }).join('');
  return '<div class="card"><h2>成绩名册（点名核对 + 标记缺考）</h2>'
    +'<p class="hint">选好考试和班级，这里会按学号列出<b>该班所有学生</b> —— '
    +'包括 Excel 里没有成绩、根本没出现过的那些。分数可以直接填，没来的点「缺考」。<br>'
    +'<b>缺考和考 0 分不一样</b>：缺考不会拉低班级平均分，也不会算进及格率/优秀率/低分率的分母。</p>'
    +'<div class="row">'
    +'<div class="field"><label>考试 *</label><select id="ro_exam" onchange="onRosterExam()">'+examOpts+'</select></div>'
    +'<div class="field" style="margin:0"><label>班级</label>'
    +'<select id="ro_cls" onchange="onRosterCls()">'
    +'<option value="">（这场涉及的所有班）</option>'
    +clsList.map(function(c){ return '<option value="'+esc(c)+'"'+(ROSTER_CLS===c?' selected':'')+'>'+esc(c)+'班</option>'; }).join('')
    +'</select></div>'
    +'<button onclick="rosterSaveAll()">保存全部</button>'
    +'<button class="ghost" onclick="rosterClearAll()">清空本场记录</button>'
    +'</div><div id="rosterBox"></div></div>';
}

/* 页面渲染完后把下拉的默认值填上，并画第一遍名册 */
function initRoster(){
  var se = $('ro_exam');
  if(!se) return;
  /* 默认选中最近一场考试 —— 老师来这个页面通常就是处理刚考完那场 */
  var ex = examsSorted();
  if(!ROSTER_EXAM && ex.length) ROSTER_EXAM = ex[ex.length-1].id;
  if(ROSTER_EXAM) se.value = ROSTER_EXAM;
  /* 考试自带的班级优先，省一次点击 */
  var e = examById(ROSTER_EXAM);
  if(e && e.cls){ ROSTER_CLS = e.cls; var sc=$('ro_cls'); if(sc) sc.value = e.cls; }
  renderRoster();
}
/* 切班级：必须先把 ROSTER_CLS 改掉再画。
   以前这里直接调 renderRoster()，变量还是旧班级，
   于是下拉显示 716、表格却还是 715 的学生 —— 看着像数据错乱。 */
function onRosterCls(){
  ROSTER_CLS = $('ro_cls').value;
  renderRoster();
}
function onRosterExam(){
  ROSTER_EXAM = $('ro_exam').value;
  var e = examById(ROSTER_EXAM);
  ROSTER_CLS = (e && e.cls) ? e.cls : '';
  var sc = $('ro_cls'); if(sc) sc.value = ROSTER_CLS;
  renderRoster();
}

/* 名册里要列出哪些学生：优先用「这场考试已有成绩的学生」，
   否则用「所选班级的全部学生」。前者能看出有没有录漏。 */
function rosterTargets(){
  if(ROSTER_CLS){
    return DB.students.filter(function(s){ return String(s.cls)===String(ROSTER_CLS); })
      .sort(function(a,b){ return natCmp(a.id,b.id); });
  }
  /* 没选班：这场考试谁的班里有成绩就列谁（去重） */
  var seen = {}, out = [];
  DB.scores.forEach(function(x){
    if(x.examId!==ROSTER_EXAM) return;
    var s = studentByKey(x.studentId);
    if(!s || seen[s.key]) return;
    seen[s.key] = 1; out.push(s);
  });
  if(!out.length){
    /* 这场还没任何成绩 → 退回到全部班级 */
    return DB.students.slice().sort(function(a,b){
      return natCmp(a.cls,b.cls) || natCmp(a.id,b.id);
    });
  }
  return out.sort(function(a,b){ return natCmp(a.cls,b.cls) || natCmp(a.id,b.id); });
}

function renderRoster(){
  var box = $('rosterBox');
  if(!box) return;
  if(!ROSTER_EXAM){ box.innerHTML = '<div class="empty">请先选择考试。</div>'; return; }
  var e = examById(ROSTER_EXAM);
  if(!e){ box.innerHTML = '<div class="empty">考试不存在，请重新选择。</div>'; return; }

  var list = rosterTargets();
  if(!list.length){
    box.innerHTML = '<div class="empty">没有可列出的学生。请先导入学生名册，或在上方选择班级。</div>';
    return;
  }
  var fs = fullScoreOf(e);
  var recOf = {};
  DB.scores.forEach(function(x){ if(x.examId===ROSTER_EXAM) recOf[x.studentId] = x; });

  var nDone=0, nAbs=0, nNone=0;
  var rows = list.map(function(s){
    var rec = recOf[s.key];
    var absent = rec ? !!rec.absent : false;
    var has = !!rec;
    if(absent) nAbs++; else if(has) nDone++; else nNone++;
    return {s:s, rec:rec, absent:absent, has:has};
  });

  /* 标题里的班级跟「当前所选班级」走，而不是考试自带的那个 ——
     一场考试可以分班录，名册切到 716 就该显示 716班。
     注意 ROSTER_CLS 为空（选「所有班」）时必须显示「所有班」，
     不能再回落到考试自带的班级 —— 否则表格列了 8 个人、标题却写「715班」。 */
  var shownCls = ROSTER_CLS;
  var h = '<p class="muted" style="margin:12px 0 8px">'+esc(e.name)
    +(shownCls?'（'+esc(shownCls)+'班）':'（所有班）')
    +' ｜ 满分 '+fs+' ｜ 共 '+list.length+' 人'
    +' ｜ <span style="color:#15803d">已录 '+nDone+'</span>'
    +' ｜ <span style="color:#b45309">缺考 '+nAbs+'</span>'
    +' ｜ <span style="color:#64748b">'+(nNone? '未登记 '+nNone : '全部已登记')+'</span>'
    +'</p>';

  if(nNone){
    h += '<p class="hint" style="margin:0 0 8px">有 '+nNone+' 人还没登记。'
      +'确认没来的点一下「缺考」；还没考的先留空（留空不会被算成 0 分，也不会进统计）。</p>';
  }

  h += '<table><thead><tr><th style="width:64px">学号</th><th>姓名</th>'
    +'<th style="width:76px">班级</th><th style="width:120px">分数</th>'
    +'<th style="width:96px">得分率</th><th style="width:92px">班排</th>'
    +'<th style="width:64px">缺考</th><th>状态</th></tr></thead><tbody>';
  rows.forEach(function(r,i){
    var val = (r.has && !r.absent) ? r.rec.score : '';
    var rt = (r.has && !r.absent) ? rateOf(r.rec.score, fs) : null;
    var cr  = (r.has && !r.absent) ? r.rec.classRank : '';
    h += '<tr'+(r.absent?' style="background:#fffbeb"':'')+'>'
      +'<td>'+esc(r.s.id)+'</td>'
      +'<td><b>'+esc(r.s.name)+'</b>'
        +((r.s.isBorderline)?' <span class="badge warn">临界</span>':'')+'</td>'
      +'<td>'+esc(r.s.cls||'—')+'</td>'
      +'<td><input type="number" step="0.5" class="ro-score" data-i="'+i+'" value="'
        +(val===''?'':esc(val))+'"'+(r.absent?' disabled':'')+'></td>'
      +'<td class="ro-rate" data-i="'+i+'">'+(rt==null?'<span class="muted">—</span>':(Math.round(rt*10)/10)+'%')+'</td>'
      +'<td><input class="ro-cr" data-i="'+i+'" style="width:70px" value="'
        +(cr?esc(cr):'')+'"'+(r.absent?' disabled':'')+'></td>'
      +'<td style="text-align:center"><input type="checkbox" class="ro-abs" data-i="'+i+'"'
        +(r.absent?' checked':'')+'></td>'
      +'<td>'+(r.absent ? absentCell()
            : (r.has ? '<span style="color:#15803d">已录</span>'
                     : '<span class="muted">未登记</span>'))+'</td>'
      +'</tr>';
  });
  h += '</tbody></table>';
  h += '<p class="hint" style="margin-top:10px">'
    +'分数留空 = 还没登记（<b>不算 0 分</b>，也不进统计）；勾「缺考」= 确认没参加（同样不进统计，但会记下来）。<br>'
    +'点「保存全部」一次性写入。勾了缺考的分数框会自动锁住，避免误填。</p>';
  box.innerHTML = h;
  bindRoster();
}

/* 分数改动时实时更新得分率显示；勾缺考时锁住分数框。
   用事件委托绑在容器上，重画后重新绑一次即可。 */
function bindRoster(){
  var box = $('rosterBox');
  if(!box || box._roBound) return;
  box._roBound = 1;
  box.addEventListener('input', function(e){
    var t = e.target;
    if(!t.className || t.className.indexOf('ro-score')<0) return;
    var i = t.getAttribute('data-i');
    var cell = box.querySelector('.ro-rate[data-i="'+i+'"]');
    if(!cell) return;
    var v = Number(t.value);
    var full = fullScoreOf(examById(ROSTER_EXAM));
    cell.innerHTML = (!t.value || !isFinite(v)) ? '<span class="muted">—</span>'
      : (Math.round(rateOf(v, full)*10)/10)+'%';
  });
  box.addEventListener('change', function(e){
    var t = e.target;
    if(!t.className || t.className.indexOf('ro-abs')<0) return;
    var i = t.getAttribute('data-i');
    var tr = t.closest ? t.closest('tr') : null;
    if(!tr) return;
    /* 勾了缺考 → 分数/班排锁住并清空；取消勾 → 解锁可填 */
    var sc = tr.querySelector('.ro-score'), cr = tr.querySelector('.ro-cr'),
        rt = tr.querySelector('.ro-rate'), td = tr.querySelectorAll ? tr.querySelectorAll('td') : [];
    if(sc){ sc.disabled = t.checked; if(t.checked) sc.value=''; }
    if(cr){ cr.disabled = t.checked; if(t.checked) cr.value=''; }
    if(rt) rt.innerHTML = '<span class="muted">—</span>';
    if(tr.style) tr.style.background = t.checked ? '#fffbeb' : '';
    var st = td[td.length-1];
    if(st) st.innerHTML = t.checked ? absentCell() : '<span class="muted">未登记</span>';
  });
}

/* 保存整张名册：按学号顺序读所有行，逐个写入或更新成绩记录 */
function rosterSaveAll(){
  if(!ROSTER_EXAM){ toast('请先选择考试'); return; }
  var list = rosterTargets();
  var eid = ROSTER_EXAM;
  var nUp=0, nAbs=0, nClr=0;
  list.forEach(function(s, i){
    var scoreEl = document.querySelector('.ro-score[data-i="'+i+'"]');
    var crEl    = document.querySelector('.ro-cr[data-i="'+i+'"]');
    var absEl   = document.querySelector('.ro-abs[data-i="'+i+'"]');
    if(!scoreEl || !absEl) return;
    var absent = absEl.checked;
    var raw = String(scoreEl.value||'').trim();
    var ex = DB.scores.filter(function(x){ return x.studentId===s.key && x.examId===eid; })[0];

    if(absent){
      /* 缺考：写一条 absent 记录；原本没有记录才新增，已有记录就地改标记。
         缺考了名次当然要清掉 —— 但来源标记也一起清，
         否则会留下"没有名次却标着学校给的"这种自相矛盾的数据。 */
      if(ex){ ex.absent = true; ex.score = 0; ex.classRank=''; ex.gradeRank=''; ex.rkSrc=''; }
      else DB.scores.push({studentId:s.key, examId:eid, score:0, absent:true, classRank:'', gradeRank:'', rkSrc:''});
      nAbs++; return;
    }
    if(raw===''){
      /* 分数留空 = 未登记 = 撤销这条记录。
         界面上写的就是「留空 = 还没登记」，保存必须和这句话一致，
         否则老师明明清空了框、点完保存却还留着一条旧分，会以为没生效。
         真正的 0 分可以显式填 0（'' !== 0），不会被误删。 */
      if(ex){ DB.scores = DB.scores.filter(function(x){ return x!==ex; }); nClr++; }
      return;
    }
    var v = Number(raw);
    if(!isFinite(v)) return;
    var cr = crEl ? String(crEl.value||'').trim() : '';
    /* 只改分数和班排，故意不碰 gradeRank / rkSrc：
       名册上录的是分数，学校给的年级排名是另一份数据，不该在这里被抹掉。 */
    if(ex){ ex.score=v; ex.absent=false; ex.classRank=cr; }
    else DB.scores.push({studentId:s.key, examId:eid, score:v, absent:false, classRank:cr, gradeRank:'', rkSrc:''});
    nUp++;
  });
  saveDB();
  renderRoster();
  toast('已保存：成绩 '+nUp+' 条' + (nAbs ? '，缺考 '+nAbs+' 人' : '')
    + (nClr ? '，清空 '+nClr+' 条空行' : ''));
}

/* 清空本场记录（删掉这场考试的全部成绩，含缺考标记）
   二次确认，避免手滑把一整场录入抹掉。 */
function rosterClearAll(){
  if(!ROSTER_EXAM){ toast('请先选择考试'); return; }
  var e = examById(ROSTER_EXAM);
  var n = DB.scores.filter(function(x){ return x.examId===ROSTER_EXAM; }).length;
  if(!n){ toast('这场考试还没有任何记录'); return; }
  if(!confirm('确认清空「'+(e?e.name:'这场考试')+'」的全部成绩记录（含缺考标记）共 '+n+' 条？\n\n此操作不可撤销。')) return;
  DB.scores = DB.scores.filter(function(x){ return x.examId!==ROSTER_EXAM; });
  saveDB(); renderRoster(); toast('已清空该场全部成绩记录');
}