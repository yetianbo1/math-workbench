/* ===========================================================
   records.js —— 学生成长档案
   项：{id, studentId, date, content, followUp, followedAt, result, createdAt}

   原来还有「类型」（谈话/作业/课堂/家校沟通），现已去掉 ——
   实际记的时候大部分都是"今天和这个孩子发生了什么"，
   先想该归哪一类反而卡住；分类不如直接看内容。
   老数据里的 type 字段保留不删（读新写旧都不影响），
   但界面上一律不再显示，也不再参与筛选。

   两种入口：
   1) 学生详情页内的「成长记录时间线」（单个学生纵向时间轴）
   2) 独立菜单「成长记录」（全部学生的记录 + 待跟进汇总）
   =========================================================== */

var recTab = 'followup';   // 独立页当前页签
var recFilterStudent = ''; // 学生筛选
var REC_PAGE = 40;         // 每次"再显示"的条数
var recLimit = REC_PAGE;   // 独立页已显示条数（"再显示"按钮累加）

function recordsOf(sid){
  return DB.records.filter(function(r){ return String(r.studentId)===String(sid); })
    .sort(function(a,b){
      if(a.date !== b.date) return a.date < b.date ? 1 : -1;   // 新→旧
      return (b.createdAt||0) - (a.createdAt||0);
    });
}
function pendingFollowUps(sid){
  return DB.records.filter(function(r){
    return r.followUp && !r.followedAt && (!sid || String(r.studentId)===String(sid));
  });
}
/* ===========================================================
   一、学生详情页内的时间线
   =========================================================== */
function renderRecordTimeline(sid){
  var list = recordsOf(sid);
  var pending = list.filter(function(r){ return r.followUp && !r.followedAt; });
  var h = '<div class="card"><div class="row" style="margin-bottom:10px">'
    +'<h2 style="margin:0;flex:1">成长记录（'+list.length+' 条'+(pending.length?'，待跟进 '+pending.length:'')+'）</h2>'
    +'<button onclick="showRecModal(null,\''+esc(sid)+'\')">+ 记一笔</button></div>';

  if(pending.length){
    h += '<div class="fu-hint">有 '+pending.length+' 条待跟进事项，点记录右侧「标记已跟进」可结案。</div>';
  }
  if(!list.length){
    h += '<div class="empty">还没有记录。<br>平时和学生的谈话、作业情况、课堂表现、家校沟通，随手记在这里。</div></div>';
    return h;
  }
  h += '<div class="tl">';
  list.forEach(function(r){
    var st = studentByKey(r.studentId);
    h += '<div class="tl-item'+(r.followUp && !r.followedAt ? ' fu':'')+'">'
      +'<div class="tl-dot"></div>'
      +'<div class="tl-body">'
      +'<div class="tl-head"><span class="tl-date">'+esc(r.date)+'</span>'
      +(st?'<span class="muted">· '+esc(st.name)+'</span>':'')
      +'</div>'
      +'<div class="tl-text">'+esc(r.content||'（无内容）')+'</div>';
    if(r.followUp){
      if(r.followedAt){
        h += '<div class="tl-fu done">✓ 已于 '+esc(r.followedAt)+' 跟进'+(r.result?'：'+esc(r.result):'')+'</div>';
      }else{
        h += '<div class="tl-fu">● 待跟进</div>';
      }
    }
    h += '<div class="tl-act">'
      +(r.followUp && !r.followedAt ? '<button class="sm" onclick="markFollowed(\''+r.id+'\')">标记已跟进</button> ':'')
      +'<button class="sm ghost" onclick="showRecModal(\''+r.id+'\')">编辑</button> '
      +'<button class="sm danger" onclick="delRec(\''+r.id+'\')">删</button></div>'
      +'</div></div>';
  });
  h += '</div></div>';
  return h;
}

/* ===========================================================
   二、独立页：成长记录
   =========================================================== */
function renderRecords(){
  var pending = pendingFollowUps();
  var all = DB.records.slice().sort(function(a,b){
    if(a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt||0) - (a.createdAt||0);
  });

  var h = '';

  /* ---- 待跟进汇总 ---- */
  h += '<div class="card"><h2>待跟进（'+pending.length+' 条）</h2>';
  if(!pending.length){
    h += '<div class="empty">目前没有需要跟进的记录。<br>在记录里勾选「需要后续跟进」，就会汇总到这里。</div>';
  } else {
    h += '<table><thead><tr><th>学生</th><th>日期</th><th>记录内容</th><th>操作</th></tr></thead><tbody>';
    pending.forEach(function(r){
      var st = studentByKey(r.studentId);
      h += '<tr><td><b>'+esc(st?st.name:'（已删除）')+'</b>'+(st?' <span class="muted">'+esc(st.id)+'</span>':'')+'</td>'
        +'<td>'+esc(r.date)+'</td>'
        +'<td style="max-width:420px">'+esc(r.content||'—')+'</td>'
        +'<td style="white-space:nowrap">'
        +'<button class="sm" onclick="markFollowed(\''+r.id+'\')">标记已跟进</button> '
        +'<button class="sm ghost" onclick="jumpStudent(\''+esc(r.studentId)+'\')">看档案</button></td></tr>';
    });
    h += '</tbody></table>';
  }
  h += '</div>';

  /* ---- 全部记录 ---- */
  h += '<div class="card"><h2>全部成长记录（'+DB.records.length+' 条）</h2>';
  h += '<div class="row">'
    +'<div class="field" style="width:220px"><label>学生</label><select onchange="recFilterStudent=this.value;recLimit=REC_PAGE;renderRecords()">'
    +'<option value="">全部学生</option>'
    +DB.students.slice().sort(function(a,b){return natCmp(a.id,b.id);}).map(function(s){
      return '<option value="'+esc(s.key)+'"'+(recFilterStudent===String(s.key)?' selected':'')+'>'+esc(s.name)+'（'+esc(s.cls?s.cls+'班 ':'')+esc(s.id)+'）</option>';
    }).join('')
    +'</select></div>'
    +(recFilterStudent?'<button class="ghost" onclick="recFilterStudent=\'\';recLimit=REC_PAGE;renderRecords()">清除筛选</button>':'')
    +'</div>';

  h += '<div class="tabs">'
    +'<span class="tab'+(recTab==='followup'?' on':'')+'" onclick="recTab=\'followup\';recLimit=REC_PAGE;renderRecords()">待跟进 '+pending.length+'</span>'
    +'<span class="tab'+(recTab==='all'?' on':'')+'" onclick="recTab=\'all\';recLimit=REC_PAGE;renderRecords()">全部 '+all.length+'</span>'
    +'</div>';

  var list = all;
  if(recTab==='followup') list = pending;
  if(recFilterStudent) list = list.filter(function(r){ return String(r.studentId)===String(recFilterStudent); });

  if(!list.length){
    h += '<div class="empty">没有符合条件的记录。</div>';
  } else {
    var shown = list.slice(0, recLimit);
    h += '<table><thead><tr><th>学生</th><th>日期</th><th>内容</th><th>跟进</th><th>操作</th></tr></thead><tbody>';
    shown.forEach(function(r){
      var st = studentByKey(r.studentId);
      h += '<tr><td><b>'+esc(st?st.name:'（已删除）')+'</b></td>'
        +'<td>'+esc(r.date)+'</td>'
        +'<td style="max-width:400px">'+esc(r.content||'—')+'</td>'
        +'<td>'+(r.followUp ? (r.followedAt ? '<span class="ok-t">✓ '+esc(r.followedAt)+'</span>' : '<span class="err">● 待跟进</span>') : '<span class="muted">—</span>')+'</td>'
        +'<td style="white-space:nowrap">'
        +'<button class="sm ghost" onclick="showRecModal(\''+r.id+'\')">编辑</button> '
        +'<button class="sm danger" onclick="delRec(\''+r.id+'\')">删</button></td></tr>';
    });
    h += '</tbody></table>';
    if(list.length > shown.length){
      h += '<div style="text-align:center;margin-top:12px"><button class="ghost" onclick="recLimit+='+REC_PAGE+';renderRecords()">'
        +'再显示 '+Math.min(REC_PAGE, list.length-shown.length)+' 条（还有 '+(list.length-shown.length)+' 条）</button></div>';
    }
  }
  h += '</div>';
  $('content').innerHTML = h;
}

function jumpStudent(sid){
  if(!studentByKey(sid)){ toast('该学生已不存在'); return; }
  goSec('students');
  selStudent = sid;
  render();
}

/* ===========================================================
   三、增删改
   =========================================================== */
function showRecModal(rid, sid){
  var r = rid ? null : null;
  if(rid){
    for(var i=0;i<DB.records.length;i++){ if(DB.records[i].id===rid){ r=DB.records[i]; break; } }
    if(!r) return;
  } else {
    r = {id:null, studentId:sid||'', date:todayStr(), content:'', followUp:false};
  }
  var defStu = r.studentId || sid || '';
  openModal('<h3>'+(rid?'编辑成长记录':'新增成长记录')+'</h3>'
    +'<div class="row">'
    +'<div class="field half"><label>学生 *</label><select id="r_stu">'
    +(DB.students.length ? DB.students.slice().sort(function(a,b){return natCmp(a.id,b.id);}).map(function(s){
        return '<option value="'+esc(s.key)+'"'+(String(defStu)===String(s.key)?' selected':'')+'>'+esc(s.name)+'（'+esc(s.cls?s.cls+'班 ':'')+esc(s.id)+'）</option>';
      }).join('') : '<option value="">（暂无学生）</option>')
    +'</select></div>'
    +'<div class="field half"><label>日期</label><input id="r_date" type="date" value="'+esc(r.date)+'"></div>'
    +'</div>'
    +'<div class="field"><label>内容</label><textarea id="r_txt" placeholder="如：今天谈话，认识到计算失误是主因，约定每天练 5 道限时题">'+esc(r.content)+'</textarea></div>'
    +'<div class="field"><label><input type="checkbox" id="r_fu" '+(r.followUp?'checked':'')+' style="width:auto;margin-right:6px;">需要后续跟进（会汇总到「成长记录」页和这里的时间线）</label></div>'
    +(r.followedAt ? '<div class="field"><label>已完成跟进</label><input id="r_fdate" type="date" value="'+esc(r.followedAt)+'">'
      +'<input id="r_result" value="'+esc(r.result||'')+'" placeholder="跟进结果，如：已重新测分，明显进步" style="margin-top:6px"></div>' : '')
    +'<div class="row" style="margin-top:6px"><button onclick="saveRec('+(rid?"'"+rid+"'":'null')+')">保存</button>'
    +'<button class="ghost" onclick="closeModal()">取消</button></div>');
}

function saveRec(rid){
  var sid = $('r_stu') ? $('r_stu').value : '';
  var date = $('r_date').value || todayStr();

  var content = $('r_txt').value.trim();
  var fu = $('r_fu').checked;
  if(!sid){ toast('请先添加学生'); return; }
  if(!content){ toast('请填写记录内容'); return; }

  if(rid){
    var r = null;
    for(var i=0;i<DB.records.length;i++){ if(DB.records[i].id===rid){ r=DB.records[i]; break; } }
    if(!r){ closeModal(); return; }
    r.studentId=sid; r.date=date; r.content=content;
    delete r.type;                /* 类型已废弃：新记录不再留这个字段 */
    /* followUp 必须总是显式赋值。以前只在 !fu 时清零、勾选时不管，
       结果「编辑一条记录并勾上需要跟进」保存后跟进标记丢掉了 —— 待跟进汇总里看不到。 */
    r.followUp = !!fu;
    if(!fu){ r.followedAt=''; r.result=''; }
    else{
      var fd = $('r_fdate'), rz = $('r_result');
      if(fd) r.followedAt = fd.value;
      if(rz) r.result = rz.value.trim();
    }
  } else {
    DB.records.push(normalizeRecord({studentId:sid, date:date, content:content, followUp:fu}));
  }
  saveDB(); closeModal();
  /* 保存后回到正确的页面：学生档案页刷新该生的档案，
     成长记录独立页刷新列表（原来调render() 会走错页面）。 */
  if(curSec==='records') renderRecords();
  else if(selStudent && studentByKey(selStudent)) renderProfile(selStudent);
  else render();
  toast(rid?'已保存':'已记录');
}

function markFollowed(id){
  for(var i=0;i<DB.records.length;i++){
    if(DB.records[i].id===id){
      DB.records[i].followedAt = todayStr();
      if(!DB.records[i].result) DB.records[i].result = '';
      break;
    }
  }
  saveDB();
  if(curSec==='records') renderRecords();
  else if(selStudent) renderProfile(selStudent);
  else render();
  toast('已标记为跟进完成');
}

function unmarkFollowed(id){
  for(var i=0;i<DB.records.length;i++){
    if(DB.records[i].id===id){ DB.records[i].followedAt=''; break; }
  }
  saveDB();
  if(curSec==='records') renderRecords();
  else if(selStudent) renderProfile(selStudent);
  else render();
  toast('已重新标记为待跟进');
}

function delRec(id){
  if(!confirm('删除这条成长记录？')) return;
  DB.records = DB.records.filter(function(r){ return r.id!==id; });
  saveDB();
  if(curSec==='records') renderRecords();
  else if(selStudent) renderProfile(selStudent);
  else render();
  toast('已删除');
}

/* 学生列表里的快捷入口 */
function quickRecord(sid){
  showRecModal(null, sid);
}
