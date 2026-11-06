/* ===========================================================
   schedule.js —— 个人课表（周视图 + 事务 + 自定义作息时间）
   课表项：{id, day(1-5), period(节次号), subject, cls, note,
            content, homework, w(哪一周), fixed(是否固定课)}
   作息：DB.periodTimes = [{period:1, start:'08:00', end:'08:40'}, ...]
   节次：DB.settings.periodCount（默认 10，可改 5~20），实际渲染行数还会
        跟着"数据里已排到的最大节次"走，保证不丢课
   周次：DB.weeks = [{id, name, start}]，SCHED_WEEK 是当前正在看的那一周

   为什么分周 —— 课表不是每周一样的，新的一周要手动改；
   但像教研、固定的数学课这些是不变的，所以每格可以勾「固定」，
   新建周时自动带过去，不用每周重填一遍。
   =========================================================== */
/* 节次数量：不写死。
   基准 10 节，但只要作息时间或课程排到了更高节次（第 11、12…），
   表格就自动多出对应的行 —— 这样加节次不用改代码。
   之前写死 var PERIODS = 10，加第 11 节课表就看不见那一行了。 */
var PERIODS_BASE = 10;        // 至少显示这么多节
var SCHED_DAYS = 5;            // 只显示周一至周五
var MY_CLASSES = ['15', '16']; // 我教的班，数学课用浅绿色标记
var SCHED_WEEK = '';           // 当前正在查看/编辑的周次 id

/* 实际要渲染到第几节：取「用户设置的节次」和「数据里出现过的最大节次」里较大的那个。
   取大的那个是为了不丢数据 —— 比如已经排了第 11 节的课，
   就算用户后来把设置改回 10 节，那一格也不该凭空消失。 */
function periodCount(){
  var n = PERIODS_BASE;
  if(DB.settings && Number(DB.settings.periodCount)>n) n = Number(DB.settings.periodCount);
  DB.periodTimes.forEach(function(t){
    if(t && Number(t.period)>n) n = Number(t.period);
  });
  DB.schedule.forEach(function(it){
    if(it && Number(it.period)>n) n = Number(it.period);
  });
  return n;
}

/* 保证 SCHED_WEEK 指向一个真实存在的周；返回可用周 id */
function ensureWeek(){
  if(!DB.weeks || !DB.weeks.length){
    DB.weeks = [newWeek('本周', ymd(mondayOf()))];
  }
  if(!SCHED_WEEK || !weekById(SCHED_WEEK)) SCHED_WEEK = currentWeekId();
  if(!SCHED_WEEK) SCHED_WEEK = DB.weeks[0].id;
  return SCHED_WEEK;
}

/* 当前周的某一格 */
function schedAt(day, period){
  return schedAtOf(SCHED_WEEK, day, period);
}
function periodTime(period){
  for(var i=0;i<DB.periodTimes.length;i++){
    /* 防脏数据：数组里混进 null / undefined（数据导入、手工改坏）时，
       直接 x.period 会抛错，把整个首页/课表都渲染不出来。
       这里一律跳过 —— 少显示一节课，远好过整页白屏。 */
    if(!DB.periodTimes[i]) continue;
    if(Number(DB.periodTimes[i].period)===Number(period)) return DB.periodTimes[i];
  }
  return null;
}
function timeText(period){
  var t = periodTime(period);
  if(!t || !t.start) return '';
  return t.start + (t.end ? '<br>' + t.end : '');
}

/* 判断是否为我所带班级的数学课 —— 用于浅绿色填充 */
function isMyMathClass(it){
  if(!it || !it.subject) return false;
  if(it.subject.indexOf('数学') < 0) return false;
  var c = String(it.cls || '');
  for(var i=0; i<MY_CLASSES.length; i++){
    if(c.indexOf(MY_CLASSES[i]) >= 0) return true;
  }
  return false;
}

/* 由某一周的周一(start, YYYY-MM-DD) 推算周几对应的日期标签（M/D）。
   周次表里每一列是固定的星期，加上这周的周一就能算出当天日期，
   让表头「周一/周二…」直接带上日期。 */
function dayDateLabel(start, day){
  if(!start) return '';
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(start).trim());
  if(!m) return '';
  var d = new Date(+m[1], +m[2]-1, +m[3]);
  d.setDate(d.getDate() + (Number(day)-1));
  return (d.getMonth()+1) + '/' + d.getDate();
}

function renderSchedule(){
  ensureWeek();
  var tw = todayWeekday();
  var showToday = tw <= SCHED_DAYS;          // 周末则课表内不标"今天"
  var isCurWeek = (SCHED_WEEK === currentWeekId());
  var wk = weekById(SCHED_WEEK) || {name:'本周', start:''};

  var h = '<div class="card">'
    +weekToolbar(isCurWeek)
    +'<div class="row">'
    +'<button class="ghost" onclick="batchSetTimes()">批量设置作息时间</button>'
    +'<button class="ghost" onclick="setPeriodCount()">节次数：'+periodCount()+'</button>'
    +'<button class="ghost" onclick="clearSchedule()">清空这一周课表</button>'
    +'</div>'
    +'<table class="sched"><thead><tr><th class="th-time">时间</th><th class="th-per">节次</th>';
  for(var d=1; d<=SCHED_DAYS; d++){
    var isToday = (d===tw && showToday && isCurWeek);
    var dl = dayDateLabel(wk.start, d);
    h += '<th'+(isToday?' class="is-today"':'')+'>周'+weekdayCn(d)
      + (dl ? ' <span class="wd-date">'+dl+'</span>' : '')
      + (isToday?'（今天）':'')+'</th>';
  }
  h += '</tr></thead><tbody>';
  var nPer = periodCount();
  for(var p=1; p<=nPer; p++){
    var tt = timeText(p);
    h += '<tr>'
      +'<td class="ptime" onclick="editTime('+p+')" title="点击修改第'+p+'节时间">'
      + (tt ? tt : '<span class="muted">—</span>') + '</td>'
      +'<td class="p">'+p+'</td>';
    for(var dd=1; dd<=SCHED_DAYS; dd++){
      var it = schedAt(dd,p);
      var cls = [];
      if(dd===tw && showToday && isCurWeek) cls.push('today');
      if(isMyMathClass(it)) cls.push('math');
      h += '<td class="'+cls.join(' ')+'" onclick="editSched('+dd+','+p+')">';
      if(it){
        h += '<div class="c-sub">'+esc(it.subject||'');
        /* 固定课打个小标记 —— 换周时会自动跟过去，不用重新填 */
        if(it.fixed) h += '<span class="fx" title="固定课：新建周时自动带过去">📌</span>';
        h += '</div>';
        var meta = [];
        if(it.cls) meta.push(esc(it.cls));
        if(it.note) meta.push(esc(it.note));
        if(meta.length) h += '<div class="c-meta">'+meta.join(' · ')+'</div>';
        /* 内容 / 作业 摘要（完整内容在首页「今日课程」里可直接编辑） */
        if(it.content) h += '<div class="c-sub2">'+esc(it.content).replace(/\n/g,'<br>')+'</div>';
        if(it.homework) h += '<div class="c-sub2 hw">作业：'+esc(it.homework).replace(/\n/g,'<br>')+'</div>';
      }
      h += '</td>';
    }
    h += '</tr>';
  }
  h += '</tbody></table></div>';
  $('content').innerHTML = h;
}

/* 周次切换条
   周次（第几周）是主角 —— 老师真正关心的是「这周是第几周」，
   名字只是个备注。所以左上角直接把「第6周」显示出来，
   下拉里也用「第6周（10-13 那周）」这种带周次的写法。 */
function weekToolbar(isCurWeek){
  var list = weeksSorted();
  var curId = currentWeekId();
  function label(w){
    var no = weekNoLabel(w);
    var base = no || w.name || '未命名';
    return (w.id===curId) ? base + '（本周）' : base;
  }
  var opts = list.map(function(w){
    return '<option value="'+esc(w.id)+'"'+(w.id===SCHED_WEEK?' selected':'')+'>'+esc(label(w))+'</option>';
  }).join('');

  var wk = weekById(SCHED_WEEK) || {};
  var no = weekNoLabel(wk);

  return '<div class="row weekbar">'
    +'<div class="wk-badge'+(isCurWeek?'':' dim')+'">'
      +(no ? no : '<span class="muted">未设周次</span>')
    +'</div>'
    +'<div class="field" style="margin:0"><label>切换</label>'
    +'<select onchange="switchWeek(this.value)">'+opts+'</select></div>'
    +'<button onclick="addWeek()">＋ 新建一周</button>'
    +'<button class="ghost" onclick="copyWeekToNew()">复制这一周到新周</button>'
    +'<button class="ghost" onclick="delWeek()" title="只删这一周的课，不影响其他周"'+(list.length<2?' disabled':'')+'>删这一周</button>'
    +'<button class="ghost" onclick="setWeekNo()">设置周次</button>'
    +'</div>';
}

/* 设置周次 —— 直接告诉系统「本周是第几周」，不用去算开学日期。
   为什么不做成「填开学日期自动推算」：老师其实不知道/不在意开学是哪天，
   只知道「现在第几周」。让他填一个自己不确定的日期，反而算出一堆错周次
   （比如日期填成未来日期 → 第58周，比不填还离谱）。
   所以：周次以手填为准，日期只在「这一周的周一」上另作他用。 */
function setWeekNo(){
  var wk = weekById(SCHED_WEEK) || {};
  var cur = weekNoOf(wk);
  openModal('<h3>设置周次</h3>'
    +'<p class="hint">直接填「现在是第几周」就行。'
    +'填完以后，新建的周会自动接着往下排（第6周 → 新建就是第7周）。</p>'
    +'<div class="field"><label>'+esc(SCHED_WEEK===currentWeekId()?'本周':'这一周')+'是第几周</label>'
      +'<input id="wn_v" type="number" min="1" max="30" value="'+(cur||'')+'" placeholder="如：6" style="width:120px"></div>'
    +'<p class="hint">这一周：'+esc(wk.name||'未命名')+(wk.start?'（周一 '+esc(wk.start)+'）':'')+'</p>'
    +'<div class="row"><button onclick="doSetWeekNo()">保存</button>'
    +'<button class="ghost" onclick="closeModal()">取消</button></div>');
}
function doSetWeekNo(){
  var v = $('wn_v') ? Number($('wn_v').value) : 0;
  var wk = weekById(SCHED_WEEK);
  if(!wk) return;
  wk.no = v > 0 ? v : 0;
  /* 后面已有的周跟着顺延，避免出现「本周第6周、下周第2周」这种倒退 */
  if(wk.no){
    var list = weeksSorted();
    var idx = list.map(function(w){return w.id;}).indexOf(wk.id);
    for(var i=idx+1; i<list.length; i++){
      if(list[i].no) list[i].no = wk.no + (i-idx);
    }
  }
  saveDB(); closeModal(); renderSchedule();
  toast(v>0 ? ('已设为'+weekNoLabel(wk)) : '已清除周次');
}

function switchWeek(id){
  SCHED_WEEK = id;
  renderSchedule();
}
function moveWeek(d){
  var list = weeksSorted();
  var i = list.map(function(w){return w.id;}).indexOf(SCHED_WEEK);
  var j = i + d;
  if(j<0 || j>=list.length) return;
  SCHED_WEEK = list[j].id;
  renderSchedule();
}

/* 新建周：默认把「固定课」带过去 —— 这就是"每周都一样"的那部分 */
/* 猜新周是第几周：当前周次 +1（没开学日期就只能空着） */
function nextWeekNo(){
  var n = weekNoOf(weekById(SCHED_WEEK));
  return n ? n+1 : 0;
}
/* 猜新周周一：当前周周一 +7 天；当前周没日期就留空 */
function nextMonday(){
  var wk = weekById(SCHED_WEEK);
  if(!wk || !wk.start) return '';
  var d = new Date(wk.start);
  if(isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + 7);
  return ymd(d);
}
function addWeek(){
  var guess = nextWeekNo();
  openModal('<h3>新建一周</h3>'
    +'<div class="field"><label>周一开始日期</label><input id="wk_start" type="date" value="'+esc(nextMonday())+'"></div>'
    +'<div class="field"><label>这一周的备注名（可留空）</label><input id="wk_name" value="" placeholder="如：期中考试周"></div>'
    +(DB.settings.termStart
        ? '<p class="hint">周次会按开学日期自动算成<b>第 '+(guess||'?')+' 周</b>；'
          +'也可以在下面直接改周次。</p>'
        : '<p class="hint">还没设置开学日期，周次算不出来。'
          +'可以先点「设置开学日期」，以后就不用管了。</p>')
    +'<div class="field"><label>周次（第几周，可留空自动算）</label>'
      +'<input id="wk_no" type="number" min="1" max="30" value="'+(guess||'')+'" placeholder="自动"></div>'
    +'<label class="chk"><input type="checkbox" id="wk_inherit" checked> 把上一周的「固定课」带过来'
    +'<span class="hint" style="display:block;margin:0">📌 标记的格子会自动复制；其余格子留空，自己填。</span></label>'
    +'<div class="row"><button onclick="doAddWeek(true)">创建</button>'
    +'<button class="ghost" onclick="doAddWeek(false)">只建空周</button>'
    +'<button class="ghost" onclick="closeModal()">取消</button></div>');
}
function doAddWeek(inherit){
  var name = $('wk_name') ? $('wk_name').value.trim() : '';
  var start = $('wk_start') ? $('wk_start').value : '';
  var no = $('wk_no') ? Number($('wk_no').value) || 0 : 0;
  /* 没填日期就顺着上一周自动接一周，别留空 —— 留空会让周次排序和顺延都失准 */
  if(!start) start = nextMonday();
  var w = newWeek(name, start, no);
  DB.weeks.push(w);
  if(inherit){
    /* 只复制固定课，且内容/作业清空 —— 每周要讲的新内容不能照搬 */
    weekSched(SCHED_WEEK).forEach(function(it){
      if(!it.fixed) return;
      DB.schedule.push({
        id:uid('sc'), day:it.day, period:it.period,
        subject:it.subject, cls:it.cls, note:it.note,
        content:'', homework:'',            /* 内容/作业是「这一周」的，不继承 */
        w:w.id, fixed:true
      });
    });
  }
  SCHED_WEEK = w.id;
  saveDB(); closeModal(); renderSchedule();
  var lb = weekNoLabel(w);
  toast('已新建'+(lb?lb:'这一周')+(inherit?'，固定课已带过来':''));
}
/* 快捷：整周复制到新周（连内容一起，临时改动省得重填） */
function copyWeekToNew(){
  var n = nextWeekNo();
  openModal('<h3>复制这一周到新周</h3>'
    +'<p class="hint">会把当前周（'+esc((weekById(SCHED_WEEK)||{}).name||'')+'）的<b>全部</b>格子原样复制过去，'
    +'包括内容和作业 —— 适合只改了一两节的情况。</p>'
    +'<div class="field"><label>新周周次</label><input id="wk_no" type="number" min="1" max="30" value="'+(n||'')+'"></div>'
    +'<div class="field"><label>备注名（可留空）</label><input id="wk_name" value=""></div>'
    +'<div class="row"><button onclick="doCopyWeek()">复制</button>'
    +'<button class="ghost" onclick="closeModal()">取消</button></div>');
}
function doCopyWeek(){
  var no = $('wk_no') ? Number($('wk_no').value) || 0 : 0;
  var name = $('wk_name').value.trim();
  var w = newWeek(name, nextMonday(), no);
  weekSched(SCHED_WEEK).forEach(function(it){
    DB.schedule.push({
      id:uid('sc'), day:it.day, period:it.period,
      subject:it.subject, cls:it.cls, note:it.note,
      content:it.content, homework:it.homework,
      w:w.id, fixed:it.fixed
    });
  });
  SCHED_WEEK = w.id;
  saveDB(); closeModal(); renderSchedule();
  toast('已复制到'+(weekNoLabel(w)||'新的一周'));
}
/* 删一周：只删这一周的课，不动固定标记，也不影响其他周。
   用自定义确认弹窗（带「确定」按钮），不用浏览器原生 confirm()，
   风格和页面其它弹窗统一，且不会因焦点问题被拦截。 */
function delWeek(){
  if(DB.weeks.length<2){ toast('至少要保留一周'); return; }
  var w = weekById(SCHED_WEEK);
  var n = weekSched(SCHED_WEEK).length;
  openModal('<h3>删除这一周</h3>'
    +'<p>确认删除「'+(w?esc(w.name):'')+'」？<br>这一周的 '+n+' 条课表安排会被移除，其他周不受影响。</p>'
    +'<div class="row"><button onclick="doDelWeek()">确定</button>'
    +'<button class="ghost" onclick="closeModal()">取消</button></div>');
}
function doDelWeek(){
  DB.schedule = DB.schedule.filter(function(x){ return x.w!==SCHED_WEEK; });
  DB.weeks = DB.weeks.filter(function(x){ return x.id!==SCHED_WEEK; });
  SCHED_WEEK = '';
  ensureWeek();
  saveDB(); closeModal(); renderSchedule(); toast('已删除该周');
}

/* ---------- 单节时间编辑 ---------- */
function editTime(period){
  var t = periodTime(period) || {start:'', end:''};
  openModal('<h3>第 '+period+'节 · 上课时间</h3>'
    +'<div class="row">'
    +'<div class="field half"><label>开始时间</label><input id="tm_s" type="time" value="'+esc(t.start||'')+'"></div>'
    +'<div class="field half"><label>结束时间</label><input id="tm_e" type="time" value="'+esc(t.end||'')+'"></div>'
    +'</div>'
    +'<p class="hint">如 08:00-08:40。两个都留空则清除本节时间。</p>'
    +'<div class="row"><button onclick="saveTime('+period+')">保存</button>'
    +'<button class="ghost" onclick="clearTime('+period+')">清除本节时间</button>'
    +'<button class="ghost" onclick="closeModal()">取消</button></div>');
}

function saveTime(period){
  var s = $('tm_s').value, e = $('tm_e').value;
  if(!s && !e){ clearTime(period); return; }
  if(!s){ toast('请填写开始时间'); return; }
  var t = periodTime(period);
  if(!t){ t = {period:period}; DB.periodTimes.push(t); }
  t.start = s; t.end = e;
  saveDB(); closeModal(); renderSchedule(); toast('第'+period+'节时间已保存');
}

function clearTime(period){
  DB.periodTimes = DB.periodTimes.filter(function(x){ return Number(x.period)!==Number(period); });
  saveDB(); closeModal(); renderSchedule(); toast('已清除第'+period+'节时间');
}

/* 设置每天上几节课 —— 学校作息 11 节/12 节时用这个加行 */
function setPeriodCount(){
  var cur = periodCount();
  var used = 0;
  DB.schedule.forEach(function(it){ if(it && Number(it.period)>used) used = Number(it.period); });
  var h = '<h3>每天上几节课</h3>'
    +'<p class="hint">决定课表显示多少行。改成 11，课表下方就会多出第 9~11 节，可以排课、填作息时间。<br>'
    +'范围 5~20 节。当前数据里排到第 '+used+' 节。</p>'
    +'<div class="field"><label>节次数</label>'
    +'<input id="pcInput" type="number" min="5" max="20" step="1" value="'+cur+'" style="width:110px"></div>'
    +'<div class="row"><button onclick="savePeriodCount()">保存</button> '
    +'<button class="ghost" onclick="closeModal()">取消</button></div>';
  openModal(h);
}
function savePeriodCount(){
  var v = Number($('pcInput').value);
  if(!v || v<5 || v>20){ toast('请填写 5~20 之间的节次数'); return; }
  DB.settings.periodCount = Math.round(v);
  saveDB(); closeModal(); renderSchedule();
  toast('已设置为每天 '+DB.settings.periodCount+' 节课');
}

/* ---------- 批量设置作息 ---------- */
function batchSetTimes(){
  var rows = '';
  /* 这里用 periodCount() 而不是基准值：要能填第 11 节的作息，
     弹窗里就得有第 11 行的输入框。 */
  var nPer = periodCount();
  for(var p=1; p<=nPer; p++){
    var t = periodTime(p) || {start:'', end:''};
    rows += '<tr><td style="width:60px;text-align:center;color:var(--muted);">'+p+'</td>'
      +'<td><input id="bs_'+p+'" type="time" value="'+esc(t.start||'')+'"></td>'
      +'<td><input id="be_'+p+'" type="time" value="'+esc(t.end||'')+'"></td></tr>';
  }
  openModal('<h3>批量设置作息时间</h3>'
    +'<p class="hint">按学校实际作息填写每节课的上下课时间，留空表示不设置。</p>'
    +'<table><thead><tr><th>节次</th><th>开始</th><th>结束</th></tr></thead><tbody>'+rows+'</tbody></table>'
    +'<div class="row" style="margin-top:14px"><button onclick="saveBatchTimes()">保存全部</button>'
    +'<button class="ghost" onclick="closeModal()">取消</button></div>');
}

function saveBatchTimes(){
  var arr = [];
  /* 按弹窗里实际存在的输入框来读，而不是按 periodCount() 算一个理论节次。
     万一打开弹窗后数据变了（比如另一处又加了节次），
     直接取 bs_11 会是 undefined，访问 .value 就会抛错、整个保存流程中断。 */
  for(var p=1; p<=periodCount(); p++){
    var si = $('bs_'+p), ei = $('be_'+p);
    if(!si || !ei) continue;
    var s = si.value, e = ei.value;
    if(s) arr.push({period:p, start:s, end:e});
  }
  DB.periodTimes = arr;
  saveDB(); closeModal(); renderSchedule();
  toast('作息时间已保存（'+arr.length+' 节）');
}

function editSched(day, period){
  ensureWeek();
  var it = schedAt(day, period) || {subject:'',cls:'',note:'',content:'',homework:'',fixed:false};
  var tt = timeText(period).replace(/<br>/g,'-');
  var wk = weekById(SCHED_WEEK) || {};
  openModal('<h3>'+esc(wk.name||'本周')+' · 周'+weekdayCn(day)+' · 第'+period+'节'+(tt?'（'+tt+'）':'')+'</h3>'
    +'<label class="chk"><input type="checkbox" id="s_fixed"'+(it.fixed?' checked':'')+'> '
    +'这是<b>固定课</b>（每周都一样）'
    +'<span class="hint" style="display:block;margin:2px 0 0">勾上以后，新建一周时这一格会自动带过去，不用每周重填。'
    +'没勾的课只属于「'+esc(wk.name||'本周')+'」。</span></label>'
    +'<div class="field"><label>内容（课程名 / 事务名）</label><input id="s_sub" value="'+esc(it.subject)+'" placeholder="如：数学 / 教研 / 值班"></div>'
    +'<div class="field"><label>班级（可留空）</label><input id="s_cls" value="'+esc(it.cls)+'" placeholder="如：1班"></div>'
    +'<div class="field"><label>备注（可留空）</label><input id="s_note" value="'+esc(it.note||'')+'" placeholder="如：实验室 / 三楼"></div>'
    +'<div class="field"><label>本节内容（可留空）</label><textarea id="s_content" style="min-height:60px;font-family:inherit;" placeholder="如：一次函数复习 + 课后习题讲解">'+esc(it.content||'')+'</textarea></div>'
    +'<div class="field"><label>本节作业（可留空）</label><textarea id="s_hw" style="min-height:60px;font-family:inherit;" placeholder="如：课本 P42 习题 1-5">'+esc(it.homework||'')+'</textarea></div>'
    +'<div class="row"><button onclick="saveSched('+day+','+period+')">保存</button>'
    +'<button class="ghost" onclick="delSched('+day+','+period+')">清除本格</button>'
    +'<button class="ghost" onclick="closeModal()">取消</button></div>');
}

function saveSched(day, period){
  ensureWeek();
  var sub = $('s_sub').value.trim();
  var cls = $('s_cls').value.trim();
  var note = $('s_note').value.trim();
  var content = $('s_content') ? $('s_content').value.replace(/\s+$/,'') : '';
  var hw = $('s_hw') ? $('s_hw').value.replace(/\s+$/,'') : '';
  var fixed = $('s_fixed') ? $('s_fixed').checked : false;
  if(!sub && !cls && !note && !content && !hw){ delSched(day,period); return; }
  var it = schedAt(day, period);
  if(!it){ it = {id:uid('sc'), day:day, period:period, w:SCHED_WEEK}; DB.schedule.push(it); }
  it.subject=sub; it.cls=cls; it.note=note;
  it.content=content; it.homework=hw;
  it.fixed=fixed;
  it.w = SCHED_WEEK;                 /* 归属周，防止切换周次时串周 */
  saveDB(); closeModal(); renderSchedule();
  toast('已保存'+(fixed?'（固定课，新周自动带过去）':''));
}

function delSched(day, period){
  ensureWeek();
  DB.schedule = DB.schedule.filter(function(x){
    return !(x.w===SCHED_WEEK && x.day===day && x.period===period);
  });
  saveDB(); closeModal(); renderSchedule(); toast('已清除');
}

function clearSchedule(){
  ensureWeek();
  var n = weekSched(SCHED_WEEK).length;
  var wk = weekById(SCHED_WEEK) || {};
  if(!n){ toast('这一周的课表本来就是空的'); return; }
  if(!confirm('确认清空「'+(wk.name||'本周')+'」的课表？\n将删除 '+n+' 条安排，其他周不受影响。')) return;
  DB.schedule = DB.schedule.filter(function(x){ return x.w!==SCHED_WEEK; });
  saveDB(); renderSchedule(); toast('这一周的课表已清空');
}

/* 今天课（供首页用）—— 只取「本周」。
   即使你正在看别的周，首页「今日课程」永远显示本周的课。 */
function todayClasses(){
  var tw = todayWeekday();
  return weekSched(currentWeekId()).filter(function(x){ return x.day===tw; })
    .sort(function(a,b){ return a.period - b.period; });
}

/* ===========================================================
   今日课程表的「内容 / 作业」格内直接输入
   点击单元格 → 变成多行输入框 → 点别处或 Ctrl+回车 保存，Esc 放弃
   换行用 Shift+回车（普通回车会提交，和留言框习惯一致）
   =========================================================== */

/* 单元格显示文本；空时显示灰色占位提示 */
function cellText(v){
  if(!v) return '<span class="ph">点此填写</span>';
  return esc(v).replace(/\n/g,'<br>');
}

/* 进入编辑态：把 td 内容换成 textarea */
function editInline(td, day, period, field){
  if(!td || td.querySelector('textarea')) return;   // 已在编辑中
  var it = schedAt(day, period);
  if(!it) return;
  /* 编辑前先记住原格子有多高 —— 表格行高是由内容最多的那格撑开的，
     换 textarea 后若不管，高度会塌缩成 textarea 的固定值（原来三四行的内容被压扁）。
     量出来的行高在下面用来把 textarea 撑满，视觉上完全不变。 */
  var rowH = td.offsetHeight || 0;
  var tr = td.parentNode;                     /* 锁住整行高度，编辑期间任何格子都不再改变布局 */
  var locked = (tr && rowH > 0) ? tr.style.height : '';
  if(tr && rowH > 0) tr.style.height = rowH + 'px';

  var ta = document.createElement('textarea');
  ta.className = 'inline-edit';
  ta.value = it[field] || '';
  ta.setAttribute('data-day', day);
  ta.setAttribute('data-period', period);
  ta.setAttribute('data-field', field);
  ta.setAttribute('data-locked', locked);
  ta.addEventListener('blur', function(){ inlineSave(ta); });
  ta.addEventListener('keydown', function(e){
    /* Esc 放弃；Enter 或 Ctrl+Enter 保存；Shift+Enter 换行 */
    if(e.key === 'Escape'){ e.preventDefault(); ta.dataset.cancel = '1'; ta.blur(); }
    else if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); ta.blur(); }
  });
  td.innerHTML = '';
  td.appendChild(ta);
  /* 撑到原来的行高；只写 inline style，不改全局 CSS（resize 仍可手动拉高） */
  if(rowH > 0){
    var h = rowH - parseInt(getComputedStyle(td).paddingTop||'0',10)*2 - 2;
    if(h > 40){ ta.style.height = h + 'px'; ta.style.minHeight = '0'; }
  }
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

/* 保存：Esc 标记过的丢弃；只重绘当前格，不整页刷新
   （整页刷新会把用户正在点的下一个格子替换掉，导致要点两次） */
function inlineSave(ta){
  if(!ta) return;
  var field = ta.getAttribute('data-field');
  var it = schedAt(Number(ta.getAttribute('data-day')), Number(ta.getAttribute('data-period')));
  var cancelled = ta.dataset.cancel === '1';
  var val = String(ta.value||'').replace(/\s+$/,'');
  if(!cancelled && it){
    it[field] = val;
    saveDB();
  }
  var td = ta.parentNode;
  var tr = td ? td.parentNode : null;
  if(tr) tr.style.height = ta.getAttribute('data-locked') || '';   /* 解开行高锁定 */
  if(td && td.tagName === 'TD'){
    td.innerHTML = cellText(cancelled && it ? (it[field]||'') : val);
  } else {
    renderDashboard();
  }
}
