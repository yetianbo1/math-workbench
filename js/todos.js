/* ===========================================================
   todos.js —— 首页四象限的前三格（待办）+ 其他页面的「加入待办」入口
   · 每格一个数组，数组顺序就是用户拖出来的顺序，系统不自动排序
   · 点格内「+」出现「文字 + 截至时间」两个框；时间选填，只写文字回车也能存
   · 截至时间可填 4 位日期（1105 → 11月5日）或 8 位日期+时间（11051830 → 11月5日 18:30）
   · 双击事项进入整行编辑：内容和截至时间两个框一起改；也可双击时间列单独改
   · 今天之内到期标临近、已过标过期；只给时间文字变色，不改顺序和象限
   · 完成 / 删除都进 DB.quadDone 历史记录，左侧「历史记录」页可恢复或彻底删除
   · 格内上下拖 = 排序；拖到另一个象限 = 改分类，落在松手的位置
   · 拖到第四格（今日课程看板）= 禁放，会弹回
   · 拖动过程中只改 CSS class，绝不整页重绘 —— 重绘会打断原生拖拽手势
   =========================================================== */
var QUAD_META = [
  null,
  {title:'重要 · 紧急',    cls:'q-red'},
  {title:'重要 · 不紧急',  cls:'q-blue'},
  {title:'紧急 · 不重要',  cls:'q-amber'}
];
var QUAD_DRAG_ID = '';   /* 正在拖动的事项 id */
var QUAD_DROP = null;    /* 当前落点：{q, id, pos} */
var QUAD_EDIT = null;    /* 当前这一次整行编辑：{n, id, row, retry}，见 qEditFocusOut */

/* ---------- 取数 ---------- */
function quadKey(n){ return 'q'+n; }
function quadArr(n){
  if(!DB.quad) DB.quad = {q1:[], q2:[], q3:[]};
  var k = quadKey(n);
  if(!Array.isArray(DB.quad[k])) DB.quad[k] = [];
  return DB.quad[k];
}
function quadCount(){ return quadArr(1).length + quadArr(2).length + quadArr(3).length; }
function quadFind(n, id){
  var a = quadArr(n);
  for(var i=0;i<a.length;i++){ if(a[i].id===id) return a[i]; }
  return null;
}
function quadById(id){
  for(var n=1;n<=3;n++){
    var a = quadArr(n);
    for(var i=0;i<a.length;i++){ if(a[i].id===id) return {n:n, idx:i, item:a[i]}; }
  }
  return null;
}
function quadNewItem(text, deadline, deadlineAt){
  return {id:uid('qd'), text:text, done:false, doneAt:'', createdAt:Date.now(),
          deadline:deadline || '', deadlineAt:deadlineAt || 0};
}

/* ---------- 截至时间：显示与状态 ---------- */
function dueLabel(raw){
  var s = String(raw || '');
  if(!/^(\d{4}|\d{8})$/.test(s)) return '';
  var date = (+s.slice(0,2)) + '月' + (+s.slice(2,4)) + '日';
  /* 4 位只写日期：不再拼时间，显示「11月5日」 */
  return s.length === 4 ? date : date + ' ' + s.slice(4,6) + ':' + s.slice(6,8);
}
function dueState(at){
  at = Number(at) || 0;
  if(!at) return '';
  var now = Date.now();
  if(at <= now) return 'due-over';
  var d = new Date(at), t = new Date();
  if(d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth()
     && d.getDate() === t.getDate()) return 'due-soon';
  return '';
}
/* 首页整行提醒：临近 / 过期的整行填充状态
   · 带时刻（8 位）：距离截至时间 ≤ 3 小时 → warn（橙色，提醒准备）；已过 → over（红色）
   · 只写日期（4 位）：到达截至日期当天 → warn（橙色）；过后 → over（红色）
   返回 '' / 'warn' / 'over'，只用于给整行 .qi 加 class，和 .qi-due 的文字变色互不干扰。 */
function remindState(at, hasTime){
  at = Number(at) || 0;
  if(!at) return '';
  var now = Date.now();
  if(at <= now) return 'over';
  if(hasTime){
    if(at - now <= 3*3600*1000) return 'warn';
    return '';
  }
  /* 只写日期：deadline 固定在当天 23:59:59，到达当天即提醒（整一天） */
  var d = new Date(at), t = new Date();
  if(d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth()
     && d.getDate() === t.getDate()) return 'warn';
  return '';
}
/* 页面长时间开着时，每分钟只改 class，绝不重绘（会打断拖拽）：
   · .qi-due 的时间文字变色（今天 / 过期）
   · .qi 整行的 warn / over 填充（临近 3 小时 / 到期当天 / 过期） */
function quadDueTick(){
  var dueNodes = document.querySelectorAll('.qi-due[data-at]');
  for(var i=0;i<dueNodes.length;i++){
    var el = dueNodes[i];
    el.classList.remove('due-soon');
    el.classList.remove('due-over');
    var st = dueState(el.getAttribute('data-at'));
    if(st) el.classList.add(st);
  }
  var rows = document.querySelectorAll('.qi[data-at]');
  for(var j=0;j<rows.length;j++){
    var row = rows[j];
    row.classList.remove('warn','over');
    var rs = remindState(row.getAttribute('data-at'), row.getAttribute('data-ht') === '1');
    if(rs) row.classList.add(rs);
  }
  quadReminderCheck();
}
if(typeof window !== 'undefined'){
  setInterval(quadDueTick, 60000);
  setTimeout(quadDueTick, 2000);   // 启动后尽快检查一次（含「截止前 3 分钟」提醒）
}

/* ===========================================================
   截止前 3 分钟提醒：独立最顶层弹窗（盖过其它所有弹窗）
   · 只对「带具体时刻」的事项生效（4 位纯日期没有具体时刻，无法算「3 分钟前」）
   · 进入「截至时间 − 3 分钟」窗口、且尚未提醒过 → 弹窗；一次只弹一个
   · 记在内存 QUAD_REMINDED 里，避免每分钟重复弹；改了截至时间(新 deadlineAt)会重新可弹
   · 即使你正在看别的页面，弹窗也盖在最上面（z-index 远高于普通弹窗）
   =========================================================== */
var QUAD_REMINDED = {};        // key = id@deadlineAt → 已提醒过，避免重复弹
var QUAD_REMINDER_OPEN = false;
function ensureReminderLayer(){
  var L = $('reminderLayer');
  if(L) return L;
  L = document.createElement('div');
  L.id = 'reminderLayer';
  L.className = 'reminder-bg';
  document.body.appendChild(L);
  return L;
}
function reminderClose(){
  var L = $('reminderLayer');
  if(L) L.classList.remove('show');
  QUAD_REMINDER_OPEN = false;
}
function reminderDone(id){
  var ref = quadById(id);
  reminderClose();
  if(ref) qDone(ref.n, id); else renderDashboard();
}
function reminderGoHome(){
  reminderClose();
  if(typeof goSec === 'function') goSec('dashboard');
}
function showReminder(item, n){
  if(QUAD_REMINDER_OPEN) return;
  var L = ensureReminderLayer();
  var mins = Math.max(0, Math.round((Number(item.deadlineAt) - Date.now())/60000));
  L.innerHTML =
     '<div class="reminder-card">'
    +'<div class="reminder-badge">⏰ 即将到截止时间</div>'
    +'<h3 class="reminder-title">'+esc(item.text)+'</h3>'
    +'<p class="reminder-meta">截止：'+esc(dueLabel(item.deadline))+'（还剩约 '+mins+' 分钟）</p>'
    +'<p class="reminder-tip">请现在开始做这件事，别拖到最后一刻。</p>'
    +'<div class="row reminder-actions">'
      +'<button onclick="reminderDone(\''+esc(item.id)+'\')">标记完成</button>'
      +'<button class="ghost" onclick="reminderGoHome()">去首页</button>'
      +'<button class="ghost" onclick="reminderClose()">知道了</button>'
    +'</div></div>';
  L.classList.add('show');
  QUAD_REMINDER_OPEN = true;
}
function quadReminderCheck(){
  if(QUAD_REMINDER_OPEN) return;
  if(typeof DB === 'undefined' || !DB.quad) return;
  var now = Date.now(), win = 3*60*1000;
  for(var n=1;n<=3;n++){
    var a = quadArr(n);
    for(var i=0;i<a.length;i++){
      var t = a[i];
      var at = Number(t.deadlineAt) || 0;
      if(!at) continue;
      if(String(t.deadline || '').length !== 8) continue;   // 只提醒带具体时刻的事项
      if(now < at - win) continue;                          // 还没到提醒窗口
      if(now >= at) continue;                               // 已到/过截止 → 交给整行变红
      var key = t.id + '@' + at;
      if(QUAD_REMINDED[key]) continue;                      // 本轮已提醒过
      QUAD_REMINDED[key] = true;
      showReminder(t, n);
      return;                                               // 一次只弹一个
    }
  }
}

/* ---------- 渲染某一格的事项列表 ---------- */
function quadItemsHtml(n){
  var a = quadArr(n), h = '';
  a.forEach(function(t){
    var raw = t.deadline || '', at = t.deadlineAt || 0;
    var hasTime = raw.length === 8;
    var st = dueState(at);
    var rs = remindState(at, hasTime);
    var dueHtml;
    if(raw){
      var tip = st === 'due-over' ? '已过期，双击可改' : (st === 'due-soon' ? '今天之内到期，双击可改' : '双击修改截至时间');
      dueHtml = '<span class="qi-due'+(st ? ' '+st : '')+'" data-at="'+at+'"'
        +' ondblclick="qEditDue('+n+',\''+esc(t.id)+'\')" title="'+tip+'">'
        + esc(dueLabel(raw)) + '</span>';
    } else {
      /* 没设时间：留白，但保留一个可双击的空热区 */
      dueHtml = '<span class="qi-due is-empty" data-at="0"'
        +' ondblclick="qEditDue('+n+',\''+esc(t.id)+'\')" title="双击设置截至时间"></span>';
    }
    h += '<div class="qi'+(rs ? ' '+rs : '')+'" draggable="true"'
      +' data-id="'+esc(t.id)+'" data-at="'+at+'" data-ht="'+(hasTime?1:0)+'"'
      +' ondragstart="qDragStart(event,'+n+',\''+esc(t.id)+'\')"'
      +' ondragover="qDragOverItem(event,'+n+',\''+esc(t.id)+'\')"'
      +' ondrop="qDrop(event,'+n+')" ondragend="qDragEnd()"'
      +'>'
      +'<span class="qi-grip" title="按住可拖动排序，也可拖到别的象限">⠿</span>'
      +'<span class="qi-txt" ondblclick="qEdit('+n+',\''+esc(t.id)+'\')" title="双击修改内容和截至时间">'+esc(t.text)+'</span>'
      + dueHtml
      +'<span class="qi-act">'
      +'<button class="qi-del" title="删除（移入历史记录，可恢复）" onclick="qDel('+n+',\''+esc(t.id)+'\')">×</button>'
      +'<button class="qi-done" title="完成（移入历史记录，可恢复）" onclick="qDone('+n+',\''+esc(t.id)+'\')">✓</button>'
      +'</span></div>';
  });
  return h;
}

/* ---------- 新增：点哪一格的 +，就落在哪一格 ---------- */
function qAdd(n){
  var box = document.querySelector('.quad-items[data-q="'+n+'"]');
  if(!box) return;
  var cur = box.querySelector('.qi-new input');
  if(cur){ cur.focus(); return; }
  var wrap = document.createElement('div');
  wrap.className = 'qi qi-new';
  wrap.setAttribute('onfocusout', 'qAddFocusOut(event,'+n+')');
  wrap.innerHTML = '<span class="qi-grip qi-grip-blank">⠿</span>'
    + '<input class="qi-input qi-input-text" placeholder="写点什么，回车保存" '
    +   'onkeydown="qAddKey(event,'+n+')">'
    + '<input class="qi-input qi-input-due" placeholder="选填 4/8 位" maxlength="8" inputmode="numeric" '
    +   'title="4 位只写日期：1105 = 11月5日（按当天结束到期）；8 位带时刻：11051830 = 11月5日 18:30" '
    +   'onkeydown="qAddKey(event,'+n+')">'
    + '<span class="qi-act"></span>';
  box.insertBefore(wrap, box.firstChild);
  wrap.querySelector('.qi-input-text').focus();
}
function qAddKey(e, n){
  if(e.key === 'Enter'){ e.preventDefault(); qAddSave(n); }
  else if(e.key === 'Escape'){ e.preventDefault(); renderDashboard(); }
}
/* 焦点真正离开整行才保存：从文字框跳到时间框时不能存 */
function qAddFocusOut(e, n){
  var wrap = e.currentTarget;
  setTimeout(function(){
    if(wrap.contains(document.activeElement)) return;
    /* 格式报错后再点别处 = 放弃这行，避免光标被反复拉回、走不掉 */
    if(wrap.getAttribute('data-retry') === '1'){ renderDashboard(); return; }
    qAddSave(n);
  }, 0);
}
function qAddSave(n){
  var box = document.querySelector('.quad-items[data-q="'+n+'"]');
  if(!box) return;
  var textInp = box.querySelector('.qi-new .qi-input-text');
  var dueInp  = box.querySelector('.qi-new .qi-input-due');
  if(!textInp || !dueInp) return;      /* 已存过，或 Esc 后整行已被重绘移除 */
  var v = String(textInp.value || '').trim();
  var raw = String(dueInp.value || '').trim();
  if(!v && !raw){ renderDashboard(); return; }        /* 什么都没写 = 取消 */
  if(!v){ toast('内容不能为空'); textInp.focus(); return; }
  var p = parseDueInput(raw);
  if(!p.ok){
    toast(p.msg + '，按 Esc 放弃');
    var wrap = textInp.closest ? textInp.closest('.qi-new') : null;
    if(wrap) wrap.setAttribute('data-retry', '1');
    dueInp.focus(); dueInp.select();
    return;                                          /* 整条不保存，留在时间框 */
  }
  quadArr(n).unshift(quadNewItem(v, p.raw || '', p.at || 0));
  saveDB(); renderDashboard();
}

/* ---------- 双击就地修改：内容 + 截至时间一起改 ----------
   整行变成两个输入框，回车一起保存、Esc 放弃；
   焦点在文字框和时间框之间跳动不算离开，真正点到别处才自动保存。
   「双击时间列」单独改时间的老路子仍保留在下面的 qEditDue。 */
function qEdit(n, id){
  var t = quadFind(n, id);
  if(!t) return;
  var row = document.querySelector('.qi[data-id="'+id+'"]');
  if(!row || row.classList.contains('editing')) return;
  var txtSpan = row.querySelector('.qi-txt');
  var dueSpan = row.querySelector('.qi-due');
  if(!txtSpan || !dueSpan) return;
  row.classList.add('editing');
  row.setAttribute('draggable','false');       /* 编辑时别让原生拖拽抢走选字 */
  row.setAttribute('onfocusout','qEditFocusOut(event,'+n+',\''+esc(id)+'\')');
  QUAD_EDIT = {n:n, id:id, row:row, retry:false};
  txtSpan.innerHTML = '<input class="qi-input qi-input-text" value="'+esc(t.text)+'"'
    +' onkeydown="qEditKey(event,'+n+',\''+esc(id)+'\')">';
  dueSpan.classList.add('editing');
  dueSpan.innerHTML = '<input class="qi-input qi-input-due" maxlength="8" inputmode="numeric" '
    +'placeholder="选填 4/8 位" '
    +'title="4 位只写日期（1105）或 8 位带时刻（11051830），清空即取消时间" '
    +'value="'+esc(t.deadline || '')+'"'
    +' onkeydown="qEditKey(event,'+n+',\''+esc(id)+'\')">';
  var inp = txtSpan.querySelector('input');
  inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
}
function qEditKey(e, n, id){
  if(e.key === 'Enter'){ e.preventDefault(); qEditSave(n, id); }
  else if(e.key === 'Escape'){ e.preventDefault(); qEditCancel(n, id); }
}
function qEditCancel(n, id){
  var row = document.querySelector('.qi[data-id="'+id+'"]');
  if(row) row.removeAttribute('onfocusout');
  QUAD_EDIT = null;
  renderDashboard();
}
/* 只有「当前这一次编辑」的失焦才作数：
   格式错误时把焦点拉回时间框也会触发 focusout，用令牌避免这类幽灵回调
   在之后的编辑里被误判成「点别处放弃」，把正在输入的内容冲掉。 */
function qEditFocusOut(e, n, id){
  var token = QUAD_EDIT;
  setTimeout(function(){
    if(!token || QUAD_EDIT !== token) return;
    var row = token.row;
    if(row.isConnected === false) return;
    if(row.contains && row.contains(document.activeElement)) return;
    /* 格式报错后再点别处 = 放弃这次编辑，恢复原值，避免光标被反复拉回走不掉 */
    if(token.retry){ qEditCancel(n, id); return; }
    qEditSave(n, id);
  }, 0);
}
function qEditSave(n, id){
  var row = document.querySelector('.qi[data-id="'+id+'"]');
  if(!row || !row.classList.contains('editing')) return;
  var ti = row.querySelector('.qi-txt input');
  var di = row.querySelector('.qi-due input');
  if(!ti || !di) return;
  var v = String(ti.value || '').trim();
  var raw = String(di.value || '').trim();
  var t = quadFind(n, id);
  if(!t) return;
  if(!v){ toast('内容不能为空'); qEditCancel(n, id); return; }
  var p = parseDueInput(raw);
  if(!p.ok){
    toast(p.msg + '，按 Esc 或点别处放弃');
    if(QUAD_EDIT) QUAD_EDIT.retry = true;
    di.focus(); di.select();
    return;                                    /* 文字和时间都不保存，保持原值 */
  }
  row.removeAttribute('onfocusout');
  QUAD_EDIT = null;
  t.text = v;
  t.deadline = p.raw || '';
  t.deadlineAt = p.at || 0;
  saveDB(); renderDashboard();
}

/* ---------- 双击就地修改：截至时间（清空即取消） ---------- */
function qEditDue(n, id){
  var t = quadFind(n, id);
  if(!t) return;
  var span = document.querySelector('.qi[data-id="'+id+'"] .qi-due');
  if(!span || span.querySelector('input')) return;
  span.classList.add('editing');
  span.innerHTML = '<input class="qi-input qi-input-due" maxlength="8" inputmode="numeric" '
    +'title="4 位只写日期（1105）或 8 位带时刻（11051830），清空即取消" '
    +'value="'+esc(t.deadline || '')+'"'
    +' onkeydown="qEditDueKey(event,'+n+',\''+esc(id)+'\')"'
    +' onblur="qEditDueSave('+n+',\''+esc(id)+'\')">';
  var inp = span.querySelector('input');
  inp.focus(); inp.select();
}
function qEditDueKey(e, n, id){
  if(e.key === 'Enter'){ e.preventDefault(); qEditDueSave(n, id); }
  else if(e.key === 'Escape'){ e.preventDefault(); e.target.onblur = null; renderDashboard(); }
}
function qEditDueSave(n, id){
  var span = document.querySelector('.qi[data-id="'+id+'"] .qi-due');
  if(!span) return;
  var inp = span.querySelector('input');
  if(!inp) return;
  var raw = String(inp.value || '').trim();
  inp.onblur = null;
  var t = quadFind(n, id);
  if(!t) return;
  var p = parseDueInput(raw);
  if(!p.ok){
    toast(p.msg + '，点别处或按 Esc 放弃');
    inp.onblur = function(){ renderDashboard(); };   /* 放弃这次编辑，恢复原值 */
    inp.focus(); inp.select();
    return;
  }
  t.deadline = p.raw || '';
  t.deadlineAt = p.at || 0;
  saveDB(); renderDashboard();
}

/* ---------- 历史记录：完成 / 删除统一归档 ----------
   绝不物理删除：从格内摘出后整条搬进 DB.quadDone，记下原象限和归档时刻，
   左侧「历史记录」页可以恢复或彻底删除。 */
function quadHistory(){
  if(!Array.isArray(DB.quadDone)) DB.quadDone = [];
  return DB.quadDone;
}
function quadArchive(n, id, kind){
  var a = quadArr(n), idx = -1;
  for(var i=0;i<a.length;i++){ if(a[i].id === id) idx = i; }
  if(idx < 0) return false;
  var item = a.splice(idx, 1)[0];
  item.done = (kind === 'done');
  item.doneAt = todayStr();
  item.removed = kind;
  item.removedAt = Date.now();
  item.fromQ = n;
  quadHistory().push(item);
  saveDB();                               /* 先落盘，动画期间关页面也不丢 */
  return true;
}
function qDone(n, id){
  if(!quadArchive(n, id, 'done')) return;
  var node = document.querySelector('.qi[data-id="'+id+'"]');
  if(node){
    node.classList.add('fading');
    /* 淡出后只摘掉这一行，绝不整页重绘：延迟重绘会打断这 220ms 内
       刚开始的拖拽手势或就地编辑（输入框被冲掉、改到一半的内容会丢）。 */
    setTimeout(function(){
      if(node.parentNode) node.parentNode.removeChild(node);
      var c = document.querySelector('.quad-cell[data-q="'+n+'"] .q-count');
      if(c) c.textContent = quadArr(n).length + ' 条';
    }, 220);
  }
  toast('已完成，可在左侧「历史记录」恢复');
}
function qDel(n, id){
  if(!quadArchive(n, id, 'deleted')) return;
  renderDashboard();
  toast('已移入历史记录，可恢复');
}
function histQ(t){
  var q = Number(t.fromQ);
  return (q >= 1 && q <= 3) ? q : 1;
}
function histTime(at){
  var d = new Date(Number(at) || Date.now());
  return pad2(d.getMonth()+1)+'-'+pad2(d.getDate())+' '+pad2(d.getHours())+':'+pad2(d.getMinutes());
}
function qRestore(id){
  var hist = quadHistory(), idx = -1;
  for(var i=0;i<hist.length;i++){ if(hist[i].id === id) idx = i; }
  if(idx < 0) return;
  var item = hist.splice(idx, 1)[0];
  var q = histQ(item);
  item.done = false; item.doneAt = '';
  delete item.removed; delete item.removedAt; delete item.fromQ;
  quadArr(q).unshift(item);               /* 放回原象限最前面，回首页一眼看到 */
  saveDB(); render();
  toast('已恢复到「'+QUAD_META[q].title+'」，回首页可查看');
}
function qPurge(id){
  if(!confirm('彻底删除这条历史记录？删除后无法恢复。')) return;
  DB.quadDone = quadHistory().filter(function(x){ return x.id !== id; });
  saveDB(); render(); toast('已彻底删除');
}
function qClearHistory(){
  var n = quadHistory().length;
  if(!n){ toast('历史记录是空的'); return; }
  if(!confirm('确认清空全部 '+n+' 条历史记录？清空后无法恢复。')) return;
  DB.quadDone = []; HIST_FILTER = 'all';
  saveDB(); render(); toast('历史记录已清空');
}
var HIST_FILTER = 'all';
function qHistFilter(v){ HIST_FILTER = v; renderQuadHistory(); }
function histSeg(v, label){
  return '<button class="sm '+(HIST_FILTER === v ? '' : 'ghost')+'"'
    +' onclick="qHistFilter(\''+v+'\')">'+label+'</button>';
}
function renderQuadHistory(){
  var hist = quadHistory().slice();
  var doneCnt = hist.filter(function(x){ return x.removed === 'done'; }).length;
  var delCnt = hist.length - doneCnt;
  hist.sort(function(a,b){ return (Number(b.removedAt)||0) - (Number(a.removedAt)||0); });
  var list = hist.filter(function(x){ return HIST_FILTER === 'all' || x.removed === HIST_FILTER; });

  var h = '<div class="card"><h2>历史记录</h2>'
    +'<p class="hint">首页点「✓ 完成」或「× 删除」的事项都会存到这里，随时可以「恢复」回原来的象限；'
    +'只有在这里点「彻底删除」才会真正消失。</p>'
    +'<div class="row" style="margin-top:12px;margin-bottom:0">'
      + histSeg('all','全部 '+hist.length)
      + histSeg('done','已完成 '+doneCnt)
      + histSeg('deleted','已删除 '+delCnt)
      +'<button class="sm danger" style="margin-left:auto" onclick="qClearHistory()">清空历史</button>'
    +'</div></div>';

  h += '<div class="card"><div class="hist-list">';
  if(!list.length){
    h += '<div class="empty">这里还没有记录。完成或删除首页的事项后，会出现在这里。</div>';
  } else {
    list.forEach(function(t){
      var q = histQ(t), isDone = t.removed === 'done';
      h += '<div class="hist-row">'
        +'<div class="hist-main">'
          +'<div class="hist-txt">'+esc(t.text)+'</div>'
          +'<div class="hist-meta">'
            +'<span class="badge '+(isDone ? 'ok' : 'warn')+'">'+(isDone ? '已完成' : '已删除')+'</span> '
            + esc(QUAD_META[q].title) + ' ｜ ' + histTime(t.removedAt)
            + (t.deadline ? ' ｜ 截至 ' + esc(dueLabel(t.deadline)) : '')
          +'</div>'
        +'</div>'
        +'<button class="sm" onclick="qRestore(\''+esc(t.id)+'\')">恢复</button>'
        +'<button class="sm danger" onclick="qPurge(\''+esc(t.id)+'\')">彻底删除</button>'
      +'</div>';
    });
  }
  h += '</div></div>';
  $('content').innerHTML = h;
}

/* ---------- 拖拽：格内排序 + 跨格改分类 ---------- */
function qDragStart(e, n, id){
  QUAD_DRAG_ID = id;
  QUAD_DROP = null;
  if(e.dataTransfer){
    e.dataTransfer.effectAllowed = 'move';
    try{ e.dataTransfer.setData('text/plain', id); }catch(err){}
  }
  e.currentTarget.classList.add('dragging');
}
function qClearMarks(){
  var items = document.querySelectorAll('.qi');
  for(var i=0;i<items.length;i++){
    items[i].classList.remove('drop-before');
    items[i].classList.remove('drop-after');
    /* 正在被拖的那条要保持半透明，否则拖起来就「变实」了 */
    if(!QUAD_DRAG_ID || items[i].getAttribute('data-id') !== QUAD_DRAG_ID){
      items[i].classList.remove('dragging');
    }
  }
  var cells = document.querySelectorAll('.quad-cell');
  for(var j=0;j<cells.length;j++){
    cells[j].classList.remove('drop-target');
    cells[j].classList.remove('reject');
  }
}
function qHighlight(n){
  var c = document.querySelector('.quad-cell[data-q="'+n+'"]');
  if(c) c.classList.add('drop-target');
}
/* 拖到某条事项上：按鼠标在该行的上半/下半，决定插到它前面还是后面 */
function qDragOverItem(e, n, targetId){
  e.preventDefault(); e.stopPropagation();
  if(!QUAD_DRAG_ID) return;
  if(e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  qClearMarks();
  if(targetId === QUAD_DRAG_ID){ QUAD_DROP = null; return; }  /* 拖到自己身上：不动 */
  var r = e.currentTarget.getBoundingClientRect();
  var before = e.clientY < r.top + r.height/2;
  e.currentTarget.classList.add(before ? 'drop-before' : 'drop-after');
  qHighlight(n);
  QUAD_DROP = {q:n, id:targetId, pos:before ? 'before' : 'after'};
}
/* 拖到格子空白处：追加到该格末尾 */
function qDragOverCell(e, n){
  e.preventDefault();
  if(!QUAD_DRAG_ID) return;
  if(e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  if(e.target.closest && e.target.closest('.qi')) return;   /* 交给上面那条处理 */
  qClearMarks(); qHighlight(n);
  QUAD_DROP = {q:n, id:'', pos:'end'};
}
/* 第四格是课程看板，不是分类：不 preventDefault → 浏览器禁止 drop，事项弹回 */
function qDragOverReject(e){
  if(!QUAD_DRAG_ID) return;
  qClearMarks();
  var c = document.querySelector('.quad-cell[data-q="4"]');
  if(c) c.classList.add('reject');
  QUAD_DROP = null;
}
function qDrop(e, n){
  e.preventDefault(); e.stopPropagation();
  var id = QUAD_DRAG_ID, d = QUAD_DROP;
  QUAD_DRAG_ID = ''; QUAD_DROP = null;
  qClearMarks();
  if(!id || !d) return;
  var src = quadById(id);
  if(!src || (src.n === d.q && d.id === id)) return;
  quadMove(src.n, id, d.q, d.id, d.pos);
  saveDB(); renderDashboard();
}
function qDragEnd(){
  QUAD_DRAG_ID = ''; QUAD_DROP = null;
  qClearMarks();
}
/* 从源格摘出，插到目标格的落点。同格排序也走这里。 */
function quadMove(fromN, id, toN, anchorId, pos){
  if(anchorId === id && fromN === toN) return;      /* 拖到自己身上：什么都不做 */
  var from = quadArr(fromN), i = -1;
  for(var k=0;k<from.length;k++){ if(from[k].id === id) i = k; }
  if(i < 0) return;
  var item = from.splice(i, 1)[0];
  var to = quadArr(toN), j = -1;
  if(anchorId){
    for(var m=0;m<to.length;m++){ if(to[m].id === anchorId) j = m; }
  }
  if(j < 0) to.push(item);                          /* 落在空白处 → 末尾 */
  else if(pos === 'after') to.splice(j+1, 0, item);
  else to.splice(j, 0, item);
}

/* ---------- 供学生档案 / 临界生名单调用：加入待办 ----------
   这两个页面没有象限概念，统一先进「重要 · 紧急」，老师回首页可随手拖走。 */
function addTodoForStudent(name, sid){
  quadArr(1).unshift(quadNewItem('找 ' + name + '（' + sid + '）谈话/跟进'));
  saveDB();
  toast('已加入「重要 · 紧急」，首页可拖动调整');
  if(typeof renderDashboard === 'function' && curSec === 'dashboard') renderDashboard();
}
