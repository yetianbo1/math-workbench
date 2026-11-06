/* ===========================================================
   dashboard.js —— 工作台首页：只保留 2×2 四象限
   grid 按 DOM 顺序行优先放置：
     左上 2 重要·不紧急 | 右上 1 重要·紧急
     左下 3 紧急·不重要 | 右下 4 今日课程
   · 「重要·紧急」在「今日课程」正上方（同一右列），今日课程保持原位
   · 前三格可增删改、可拖动；第四格是课程看板，只读 + 一行「本节任务」输入
   · 布局 A：右列更宽（44 : 56），四格等高，第四格内容多时格内滚动
   · 课程行按节次（时间）混排并标班级；已上完的课沿用旧规则自动收起
   =========================================================== */
function renderDashboard(){
  var h = '<div class="quad-grid">'
    + quadTodoCell(2)   /* 左上 */
    + quadTodoCell(1)   /* 右上：与右下「今日课程」同列，在其正上方 */
    + quadTodoCell(3)   /* 左下 */
    + quadClassCell()   /* 右下 */
    + '</div>';
  $('content').innerHTML = h;
}

/* ---------- 前三格：待办 ---------- */
function quadTodoCell(n){
  var meta = QUAD_META[n];
  var a = quadArr(n);
  return '<section class="quad-cell '+meta.cls+'" data-q="'+n+'">'
    + '<div class="q-head">'
      + '<div class="q-title">'+meta.title+'</div>'
      + '<div class="q-tools"><span class="q-count">'+a.length+' 条</span>'
      + '<button class="q-add" title="添加事项" onclick="qAdd('+n+')">+</button></div>'
    + '</div>'
    + '<div class="quad-items" data-q="'+n+'"'
      + ' ondragover="qDragOverCell(event,'+n+')" ondrop="qDrop(event,'+n+')">'
      + quadItemsHtml(n)
    + '</div>'
  + '</section>';
}

/* ---------- 第四格：今日课程 + 本节任务 ---------- */
function quadClassCell(){
  var all = todayClasses();
  /* 已结束的课不再占地方：真正要看的是「今天还剩几节课」 */
  var classes = all.filter(function(it){ return !isClassOver(it); });
  var doneCnt = all.length - classes.length;

  var h = '<section class="quad-cell q-green" data-q="4" ondragover="qDragOverReject(event)">'
    + '<div class="q-head">'
      + '<div class="q-title">今日课程</div>'
      + '<div class="q-tools"><span class="q-count">'
        + (classes.length ? '还有 '+classes.length+' 节' : (doneCnt ? '已上完 '+doneCnt+' 节' : ''))
      + '</span></div>'
    + '</div>'
    + '<div class="quad-classes">';

  if(!all.length){
    h += '<div class="q-empty">今天没有课。可在左侧「课表」中添加</div>';
  } else if(!classes.length && all.every(function(it){ var t=periodTime(it.period); return t && t.end; })){
    h += '<div class="q-empty">今天的课都上完了，'+doneCnt+' 节全部结束。</div>';
  } else {
    classes.forEach(function(it){
      var t = periodTime(it.period);
      var timeTxt = t && t.start ? (t.start + (t.end ? '-'+t.end : '')) : '';
      var k = classTaskKey(it);
      h += '<div class="qc-row">'
        + '<div class="qc-main">'
          + '<span class="qc-p">第'+it.period+'节</span>'
          + (timeTxt ? '<span class="qc-time">'+esc(timeTxt)+'</span>' : '')
          + '<span class="qc-sub">'+esc(it.subject || '—')+'</span>'
          + (it.cls ? '<span class="qc-cls">'+esc(it.cls)+'班</span>' : '')
        + '</div>'
        + '<input class="qc-task" data-key="'+esc(k)+'" placeholder="点此填写本节任务"'
          + ' value="'+esc(classTaskText(it))+'"'
          + ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"'
          + ' onchange="qTaskSave(this)">'
      + '</div>';
    });
  }
  return h + '</div></section>';
}

/* 「本节任务」的主键：周次 + 星期 + 节次 + 班级(+科目) + 日期。
   带日期是关键 —— 固定课会被继承到新的一周，但只要日期不是今天，
   这条任务就取不到，所以「只对今天有效」是天然成立的，不会下周又冒出来。 */
function classTaskKey(it){
  return [currentWeekId(), it.day, it.period, String(it.cls||''),
          String(it.subject||''), todayStr()].join('|');
}
function classTaskText(it){
  var r = DB.classTasks[classTaskKey(it)];
  return r ? String(r.text || '') : '';
}
/* 保存时就手清掉不是今天的键，避免长期累积一堆过期任务 */
function qTaskSave(inp){
  var today = todayStr();
  Object.keys(DB.classTasks).forEach(function(k){
    var v = DB.classTasks[k];
    if(!v || v.date !== today) delete DB.classTasks[k];
  });
  var key = inp.getAttribute('data-key');
  var v = String(inp.value || '').trim();
  if(v) DB.classTasks[key] = {text:v, date:today};
  else delete DB.classTasks[key];
  saveDB();
}

/* 这节课是否已经结束（下课时间已过）
   判断只用下课时间：没有 end 就一律当作「没结束」—— 宁可多显示，
   也不能凭开始时间猜，万一拖堂了就把还在上的课藏掉。 */
function isClassOver(it){
  var t = periodTime(it.period);
  if(!t || !t.end) return false;
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(t.end).trim());
  if(!m) return false;
  var now = new Date();
  var end = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                     Number(m[1]), Number(m[2]), 0, 0);
  return now.getTime() > end.getTime();
}
