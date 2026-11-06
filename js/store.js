/* ===========================================================
   store.js —— 数据层：localStorage 读写 + 旧版单文件数据迁移
   =========================================================== */
var STORE_KEY = 'math_workbench_v2';
var LEGACY_KEY = 'math_student_archive_v1';

function emptyDB(){
  return {
    version: 2,
    students: [], exams: [], scores: [], kpPool: [],
    schedule: [], periodTimes: [], todos: [], events: [], records: [],
    /* 首页四象限：前三格各一个数组，数组顺序就是格内顺序；
       quadDone 是「历史记录」（完成 + 删除都进这里，可在左侧历史记录页恢复）；
       classTasks 是每节课的「本节任务」。
       旧的 todos 保留在库里不物理删除 —— 首页不再读它，等于从界面上删掉了，
       但数据仍在本机 localStorage，随时可找回（相当于天然备份）。 */
    quad: {q1:[], q2:[], q3:[]}, quadDone: [], classTasks: {},
    weeks: [],
    settings: defaultSettings()
  };
}

/* 分数段阈值（按满分百分比，可在成绩分析页调整）
   showRate: 成绩默认以「得分率」展示；关掉则显示原始分数 */
function defaultSettings(){
  return { passRate:60, goodRate:85, lowRate:40, showRate:true, periodCount:10 };
}
function normalizeSettings(s){
  var d = defaultSettings();
  if(!s || typeof s !== 'object') return d;
  d.passRate = Number(s.passRate) > 0 ? Number(s.passRate) : 60;
  d.goodRate = Number(s.goodRate) > 0 ? Number(s.goodRate) : 85;
  d.lowRate  = Number(s.lowRate)  > 0 ? Number(s.lowRate)  : 40;
  /* 老数据没有这个字段 → 默认得分率（用户当前需求） */
  d.showRate = (s.showRate === undefined) ? true : !!s.showRate;
  /* 开学日期：填了就能自动推算「现在是第几周」，不用每周手动改名字 */
  d.termStart = s.termStart || '';
  /* 每天上几节课：默认 10 节，学校作息不同（11 节/12 节）时在课表页改。
     至少 5 节、最多 20 节 —— 超出这个范围多半是误填。 */
  var pc = Number(s.periodCount);
  d.periodCount = (pc >= 5 && pc <= 20) ? Math.round(pc) : 10;
  return d;
}

function normalizeStudent(s){
  s.id = String(s.id == null ? '' : s.id);
  s.name = s.name || '';
  s.gender = s.gender || '';
  s.cls = s.cls || '';
  s.remark = s.remark || '';
  s.homework = s.homework || '';
  s.performance = s.performance || '';
  s.kpTags = Array.isArray(s.kpTags) ? s.kpTags : [];
  s.isBorderline = !!s.isBorderline;
  return s;
}

/* 学生唯一标识 = 班级 + 学号。
   两个班可能有相同学号（715 班的 1 号 和 716 班的 1 号），只用学号做主键会互相顶掉，
   所以内部一律用 key 关联成绩/成长记录，界面上仍显示学号。 */
function studentKey(id, cls){
  var c = String(cls==null?'':cls), n = String(id==null?'':id);
  return (c ? c : '无班') + '-' + n;
}
/* 分配 key，保证全库唯一（同名同班同号的重名学生也分开）
   注意：必须接收 db 参数，不能读全局 DB —— 因为 loadDB() 是在 `var DB = ...`
   赋值之前调用的，那时全局 DB 还是 undefined。 */
function ensureStudentKeys(db){
  db = db || DB;
  var used = {};
  db.students.forEach(function(s){
    if(!s.key){
      var base = studentKey(s.id, s.cls), k = base, i = 2;
      while(used[k]){ k = base + '#' + (i++); }
      s.key = k;
    } else {
      var k2 = s.key, j = 2;
      while(used[k2]){ k2 = s.key + '#' + (j++); }
      s.key = k2;
    }
    used[s.key] = 1;
  });
}
/* 老数据迁移：成绩/成长记录里存的是纯学号 → 换成 key。
   只有当该学号在库里唯一指向一个人时才敢换；多人同号就保持原样，宁可对不上也不错配。
   同样必须接收 db 参数（原因见上）。 */
function migrateRefsToKey(db){
  db = db || DB;
  var byId = {}, byKey = {};
  db.students.forEach(function(s){
    byKey[s.key] = 1;
    var k = String(s.id);
    (byId[k] = byId[k] || []).push(s.key);
  });
  var fix = function(obj){
    var cur = String(obj.studentId);
    if(byKey[cur]) return;                      // 已经是 key
    var cand = byId[cur];
    if(cand && cand.length===1) obj.studentId = cand[0];
    /* 多义时不改：宁可这条记录暂时对不上学生，也不要挂到别人头上 */
  };
  db.scores.forEach(fix);
  db.records.forEach(fix);
  db.todos.forEach(function(t){ if(t.studentId) fix(t); });
}

function normalizeRecord(r){
  r.id = r.id || uid('rc');
  r.studentId = String(r.studentId == null ? '' : r.studentId);
  r.date = r.date || todayStr();
  /* 老数据里的 type（谈话/作业/…）保留不删，读写都不受影响，
     但界面已不再显示，也不再补默认值 —— 新记录不带这个字段。 */
  r.content = r.content || '';
  r.followUp = !!r.followUp;        // 需要后续跟进
  r.followedAt = r.followedAt || ''; // 跟进完成日期
  r.result = r.result || '';         // 跟进结果
  r.createdAt = r.createdAt || Date.now();
  return r;
}

/* ---- 截至时间：4 位「月月日日」或 8 位「月月日日时时分分」 ----
   1105     = 11月5日，只写日期；按当天结束（23:59:59）算到期，
             这样「今天到期」当天标临近、过了这天才是过期，不会一大早就变红。
   11051830 = 11月5日 18:30，带具体时刻。
   都不带年份，年份由系统后台补：默认今年，若该时刻已过则算明年。
   关键：补出来的年份在「保存那一刻」固化成 deadlineAt 时间戳，之后不再重算。
   否则每次渲染都把过去的时间推到明年，已过期的状态永远不会出现。 */
function parseDueInput(raw){
  var s = String(raw == null ? '' : raw).trim();
  if(!s) return {ok:true, empty:true, at:0};
  if(!/^(\d{4}|\d{8})$/.test(s))
    return {ok:false, msg:'填 4 位日期或 8 位日期+时间，如 1105 或 11051830'};
  var mo = +s.slice(0,2), dd = +s.slice(2,4);
  var hasTime = s.length === 8;
  var hh = hasTime ? +s.slice(4,6) : 23;
  var mi = hasTime ? +s.slice(6,8) : 59;
  var sec = hasTime ? 0 : 59;
  if(mo < 1 || mo > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59)
    return {ok:false, msg:'月份 / 日期 / 小时 / 分钟不对，如 1105 或 11051830'};
  var now = new Date(), y = now.getFullYear();
  var dt = new Date(y, mo-1, dd, hh, mi, sec, 0);
  /* Date 会把 2 月 30 日悄悄滚到 3 月，回读一次才能判出这个日期不存在 */
  if(dt.getMonth() !== mo-1 || dt.getDate() !== dd)
    return {ok:false, msg:'这个日期不存在（比如 2 月没有 30 日）'};
  if(dt.getTime() <= now.getTime()){
    var next = new Date(y+1, mo-1, dd, hh, mi, sec, 0);
    /* 明年若没有这一天（如 2/29），就留在今年，让它自然成为已过期 */
    if(next.getMonth() === mo-1 && next.getDate() === dd) dt = next;
  }
  return {ok:true, empty:false, raw:s, at:dt.getTime(), year:dt.getFullYear(), hasTime:hasTime};
}

/* ---- 首页四象限待办 ----
   每格一个数组，数组顺序即用户拖出来的顺序，不按时间/优先级自动排序。
   一条事项归属哪一格，由它「在哪个数组里」决定，不额外存 quadrant 字段：
   这样跨格拖动只是一次 splice + splice，不会出现字段和位置对不上的脏数据。 */
function normalizeQuadItem(t){
  t.id = t.id || uid('qd');
  t.text = String(t.text == null ? '' : t.text);
  t.done = !!t.done;
  t.doneAt = t.done ? (t.doneAt || '') : '';
  t.createdAt = t.createdAt || Date.now();
  t.deadline = /^(\d{4}|\d{8})$/.test(String(t.deadline == null ? '' : t.deadline))
    ? String(t.deadline) : '';
  t.deadlineAt = Number(t.deadlineAt) || 0;
  /* 容错：手工导入 / 旧数据只有 4 或 8 位没时间戳时，按当前时刻补一次并固定 */
  if(t.deadline && !t.deadlineAt){
    var p = parseDueInput(t.deadline);
    if(p.ok && !p.empty) t.deadlineAt = p.at;
    else t.deadline = '';
  }
  if(!t.deadline) t.deadlineAt = 0;
  return t;
}
function normalizeQuad(q){
  q = (q && typeof q === 'object') ? q : {};
  var out = {q1:[], q2:[], q3:[]};
  ['q1','q2','q3'].forEach(function(k){
    var arr = Array.isArray(q[k]) ? q[k] : [];
    out[k] = arr.filter(Boolean).map(normalizeQuadItem)
                .filter(function(t){ return !t.done && t.text; });
  });
  return out;
}

/* ---- 历史记录（quadDone）----
   完成和删除都进同一份数组，用 removed 区分；fromQ 记住原来在哪个象限，
   恢复时放回原格。老版本存档只有 done / doneAt，这里补齐成同一套字段。 */
function normalizeHistoryItem(t){
  t = normalizeQuadItem(t);
  if(t.removed !== 'done' && t.removed !== 'deleted')
    t.removed = t.done ? 'done' : 'deleted';       /* 老存档一律算「已完成」 */
  t.fromQ = (Number(t.fromQ) >= 1 && Number(t.fromQ) <= 3) ? Number(t.fromQ) : 1;
  if(!Number(t.removedAt)){
    var d = t.doneAt ? new Date(String(t.doneAt).replace(/-/g,'/')) : null;
    t.removedAt = (d && !isNaN(d.getTime())) ? d.getTime() : Date.now();
  }
  return t;
}

/* 待办：现在只有文字 + 完成标记。旧的 priority / due 字段保留但不再使用。 */
function normalizeTodo(t){
  t.id = t.id || uid('td');
  t.text = String(t.text == null ? '' : t.text);
  t.done = !!t.done;
  t.doneAt = t.done ? (t.doneAt || '') : '';
  t.priority = t.priority || 'mid';
  t.due = t.due || '';
  t.note = t.note || '';
  t.createdAt = t.createdAt || Date.now();
  return t;
}

function normalizeSchedule(it){
  it.id = it.id || uid('sc');
  it.day = Number(it.day) || 1;
  it.period = Number(it.period) || 1;
  it.subject = it.subject || '';
  it.cls = it.cls || '';
  it.note = it.note || '';
  it.content = it.content || '';       // 今日课程表：本节要讲的内容
  it.homework = it.homework || '';     // 今日课程表：本节布置的作业
  it.w = it.w || '';                   // 归属哪一周（周次 id）
  it.fixed = !!it.fixed;               // 是否「固定课」：换周时自动带过去
  return it;
}

/* ===========================================================
   周次（课表按周分开）
   为什么要有 —— 课表并不是每周一样的：新的一周要手动更新，
   但其中有些格子（教研、固定的数学课）是不变的。
   所以每条课表都带 w（属于哪一周）和 fixed（是否固定课）：
     · 不勾 fixed → 只在这一周存在
     · 勾了 fixed → 新建周时自动带过去，不用每周重填
   =========================================================== */
function normalizeWeek(w){
  w.id = w.id || uid('wk');
  w.name = w.name || '';
  w.start = w.start || '';      // 该周周一日期 YYYY-MM-DD，用于自动判断"当前周"
  w.no = Number(w.no) || 0;     // 教学周次（第几周）；0 = 没填，交给日期自动推算
  return w;
}
function newWeek(name, start, no){
  return normalizeWeek({ id:uid('wk'), name:name||'', start:start||'', no:Number(no)||0 });
}

/* 取某个周的课表项；wId 为空时按"当前周"（SCHED_WEEK）取 */
function weekSched(wId){
  return DB.schedule.filter(function(x){ return x.w===wId; });
}
/* 某周（或当前周）某天某节的课 */
function schedAtOf(wId, day, period){
  var list = weekSched(wId);
  for(var i=0;i<list.length;i++){
    if(list[i].day===day && list[i].period===period) return list[i];
  }
  return null;
}
/* 本周一（ISO：周一为一周之首） */
function mondayOf(date){
  var d = date ? new Date(date) : new Date();
  var wd = d.getDay();                       // 0=周日 … 6=周六
  var back = (wd === 0) ? 6 : (wd - 1);      // 周日要退到上周一
  d.setDate(d.getDate() - back);
  return d;
}
function ymd(d){
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2);
}
/* 找出"当前该看哪一周"：优先匹配今天所在的那周（按 start 日期），
   找不到就用最后一周（老师通常在看最近/最新的那张） */
function currentWeekId(){
  if(!DB.weeks.length) return '';
  var mon = ymd(mondayOf());
  var hit = null, fallback = DB.weeks[0].id;
  DB.weeks.forEach(function(w){ fallback = w.id; if(w.start && w.start===mon) hit = w.id; });
  return hit || fallback;
}
/* 某一周的周次标签：周次以「老师手填的 no」为准。
   另外两个兜底来源：
   ② 名字里写着「第6周」这种 —— 老数据、以及老师自己起的名
   ③ 按开学日期推算 —— 早期版本用过的方案，现在只在下两种情况下生效：
      老师确实填了 termStart，且这一周的周一日期**不晚于本周一**。
      （日期填成未来的话会算出「第58周」这种离谱结果，宁可不算。）
   优先级：no > 名字 > 日期推算。 */
function weekNoOf(w){
  if(!w) return 0;
  if(w.no) return w.no;
  var m = /第\s*(\d{1,2})\s*周/.exec(String(w.name||''));
  if(m) return Number(m[1]);
  var ts = DB.settings && DB.settings.termStart;
  if(!ts || !w.start) return 0;
  var a = new Date(ts), b = new Date(w.start);
  if(isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  if(b > mondayOf()) return 0;              /* 周一还没到（或日期填错了）→ 不用它算 */
  var days = Math.round((b - a) / 86400000);
  if(days < 0) return 0;                     /* 开学的日期比这一周还晚 → 数据有问题 */
  var n = Math.floor(days/7) + 1;
  return n >= 1 ? n : 0;
}
/* 显示用的周次文字，比如「第6周」；算不出来就返回空 */
function weekNoLabel(w){
  var n = weekNoOf(w);
  return n ? '第'+n+'周' : '';
}
function weekById(id){
  for(var i=0;i<DB.weeks.length;i++) if(DB.weeks[i].id===id) return DB.weeks[i];
  return null;
}
/* 周次排序：先按日期，没日期的按创建顺序待在最后。
   注意不能只按 start 排 —— 空字符串 '' 在 localeCompare 里会排到最前面，
   导致「没填日期的周」插到中间，「本周第6周、下一周反而在前面」，
   后面周次顺延就会算错间隔。 */
function weeksSorted(){
  return DB.weeks.slice().sort(function(a,b){
    var sa = a.start||'', sb = b.start||'';
    if(sa && sb) return sa.localeCompare(sb);
    if(sa) return -1;                 /* 有日期的在前 */
    if(sb) return 1;
    return 0;                         /* 都没日期：保持创建顺序 */
  });
}

function normalizeDB(d){
  if(!d || typeof d !== 'object') return emptyDB();
  d.version = 2;
  d.students = Array.isArray(d.students) ? d.students.map(normalizeStudent) : [];
  d.exams = Array.isArray(d.exams) ? d.exams : [];
  d.scores = Array.isArray(d.scores) ? d.scores : [];
  d.kpPool = Array.isArray(d.kpPool) ? d.kpPool : [];
  /* ---- 周次（旧数据迁移的关键）----
     原来课表只有一张、每周通用。现在按周分开存：
     DB.weeks = [{id, name, start(该周周一日期)}]
     每条 DB.schedule 用 w 指向所属周，fixed 标记「固定课」。
     老数据没有 w 也没有 weeks —— 建一个「本周」把它们全收进来，并标成 fixed，
     这样升级后行为和以前完全一样，以后新建周时这些课会自动跟过去。
     注意：必须在 normalizeSchedule 补默认值**之前**判断，
     否则 fixed 会被补成 false，就再也认不出哪些是老数据了。 */
  var rawSched = Array.isArray(d.schedule) ? d.schedule : [];
  var isLegacy = !Array.isArray(d.weeks) || !d.weeks.length;
  d.weeks = (Array.isArray(d.weeks) ? d.weeks.filter(Boolean) : []).map(normalizeWeek);
  if(!d.weeks.length) d.weeks = [newWeek('本周')];
  var w0 = d.weeks[0].id;
  rawSched.forEach(function(it){
    if(!it) return;
    if(isLegacy){
      if(!it.w) it.w = w0;
      if(!('fixed' in it)) it.fixed = true;
    }
    if(!it.w || !d.weeks.some(function(w){ return w.id===it.w; })) it.w = w0;
  });
  d.schedule = rawSched.filter(Boolean).map(normalizeSchedule);
  d.periodTimes = Array.isArray(d.periodTimes) ? d.periodTimes : [];
  d.todos = Array.isArray(d.todos) ? d.todos.map(normalizeTodo) : [];
  /* 四象限数据：老库没有这些字段时补空，旧 todos 原样保留不动 */
  d.quad = normalizeQuad(d.quad);
  d.quadDone = Array.isArray(d.quadDone)
    ? d.quadDone.filter(Boolean).map(normalizeHistoryItem) : [];
  d.classTasks = (d.classTasks && typeof d.classTasks === 'object' && !Array.isArray(d.classTasks))
    ? d.classTasks : {};
  d.events = Array.isArray(d.events) ? d.events : [];
  d.records = Array.isArray(d.records) ? d.records.map(normalizeRecord) : [];
  d.settings = normalizeSettings(d.settings);
  ensureStudentKeys(d);       // 先给每人分配唯一 key（传 d，因为此刻全局 DB 还没赋值）
  migrateRefsToKey(d);        // 再把成绩/成长记录里的学号换成 key
  d.exams.forEach(function(e){
    e.id = e.id || uid('e');
    e.name = e.name || '';
    e.cls = e.cls || '';                 // 这场考试属于哪个班（导入成绩时标记）
    e.date = e.date || '';
    e.type = e.type || '月考';
    e.fullScore = Number(e.fullScore) || 100;
  });
  d.scores.forEach(function(s){
    s.score = Number(s.score) || 0;
    /* absent = 缺考：这节课/这场考试没参加。
       注意它和「考了 0 分」是两回事 —— 缺考不能进平均分/及格率的分母，
       0 分可以。所以必须单独一个标记位，不能靠 score===0 区分。 */
    s.absent = !!s.absent;
    s.classRank = s.classRank || '';
    s.gradeRank = s.gradeRank || '';
    /* rkSrc = 年级排名的来源：'school' 学校给的真实年级名次（几百人的量级），
       'auto' 本地按手上这几个班算出来的（只有 ~100 人，名次不可与学校比），
       '' 没有年级排名。
       这个标记存在的唯一理由：autoRank 绝不能覆盖学校数据。 */
    s.rkSrc = (s.rkSrc==='school' || s.rkSrc==='auto') ? s.rkSrc : '';
    /* 老数据（引入 rkSrc 之前）里已有的年级排名，一律当学校给的：
       那个年代只可能从 Excel 导入，无法凭空算出来。 */
    if(!s.rkSrc && s.gradeRank) s.rkSrc = 'school';
  });
  return d;
}

/* ---- 旧版单文件数据迁移 ---- */
function migrateLegacy(){
  var raw = null;
  try{ raw = localStorage.getItem(LEGACY_KEY); }catch(e){ return null; }
  if(!raw) return null;
  var old;
  try{ old = JSON.parse(raw); }catch(e){ return null; }
  if(!old || !Array.isArray(old.students) || !old.students.length) return null;
  return normalizeDB({
    version: 2,
    students: old.students,
    exams: old.exams || [],
    scores: old.scores || [],
    kpPool: old.kpPool || [],
    schedule: [], periodTimes: [], todos: [], events: [], records: [],
    settings: defaultSettings()
  });
}

function loadDB(){
  var raw = null;
  try{ raw = localStorage.getItem(STORE_KEY); }catch(e){}
  if(raw){
    try{ return normalizeDB(JSON.parse(raw)); }catch(e){}
  }
  return migrateLegacy() || emptyDB();
}

var DB = loadDB();
var MIGRATED = false;
(function(){
  // 判断本次是否为迁移加载
  try{
    MIGRATED = !localStorage.getItem(STORE_KEY) && !!localStorage.getItem(LEGACY_KEY) && DB.students.length > 0;
  }catch(e){ MIGRATED = false; }
})();

function saveDB(){
  try{
    /* 保存前兜底：任何新增学生的代码路径都应已生成 key，
       这里再确保一次（并补齐成绩/成长记录的引用），杜绝"有学生没 key"的坏数据。 */
    if(typeof ensureStudentKeys === 'function'){
      ensureStudentKeys(DB);
      migrateRefsToKey(DB);
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(DB));
  }
  catch(e){ toast('保存失败：浏览器存储空间可能已满'); }
}

/* ---- 通用访问 ---- */
function uid(p){ return (p||'id') + Date.now().toString(36) + Math.floor(Math.random()*1e6).toString(36); }

/* 按内部唯一 key 找学生（成绩/成长记录都靠它关联，绝不能退回按学号找） */
function studentByKey(key){
  if(key==null) return null;
  var k = String(key);
  for(var i=0;i<DB.students.length;i++){ if(DB.students[i].key===k) return DB.students[i]; }
  return null;
}
/* 按学号找学生 —— 仅用于"学号唯一"的场景（如手工补录、导入查重）。
   若有多个班用了同一学号，返回第一个；调用方需自己判断是否够用。 */
function studentById(id){ for(var i=0;i<DB.students.length;i++){ if(String(DB.students[i].id)===String(id)) return DB.students[i]; } return null; }
/* 按「学号 + 班级」找学生 */
function studentByIdCls(id, cls){
  cls = String(cls==null?'':cls);
  for(var i=0;i<DB.students.length;i++){
    var s = DB.students[i];
    if(String(s.id)===String(id) && String(s.cls||'')===cls) return s;
  }
  return null;
}
function examById(id){ for(var i=0;i<DB.exams.length;i++){ if(DB.exams[i].id===id) return DB.exams[i]; } return null; }

/* ===========================================================
   年级排名（gradeRank）—— 两个来源必须分清，不能混用
   ───────────────────────────────────────────────────────────
   'school'：学校给的真实年级名次。全年级几百人，1 名就是真的第 1。
   'auto'  ：本地按手上这几个班（约 100 人）算出来的。
             名次数字看着小，其实只在两个班内部成立，
             拿去和学校名次比大小是没有意义的。
   ''      ：这场考试本来就没有年级排名（很多考试不出年级排名）。

   为什么要标记：autoRank() 会给所有成绩重算年级排名。
   如果不加这个标记，它会把学校给的真实名次静默覆盖成局部名次，
   而且原值找不回来。所以覆盖前必须先判断来源。
   =========================================================== */

/* 取这条成绩的年级排名数字；空/非数字一律返回 null（不是 0） */
function gradeRankNum(sc){
  if(!sc) return null;
  var v = Number(sc.gradeRank);
  return (sc.gradeRank==='' || sc.gradeRank==null || isNaN(v) || v<=0) ? null : v;
}
/* 有学校给的年级排名（用于跨场次对比的筛选条件） */
function hasSchoolGradeRank(sc){ return !!sc && gradeRankNum(sc)!==null && sc.rkSrc==='school'; }

/* 名次变化：名次数字变小 = 进步，所以"进步 N 名"返回正数。
   prev 为 null（没有更早的参照场次）时返回 null，界面显示「—」。 */
function gradeRankDelta(prevNum, curNum){
  if(prevNum==null || curNum==null) return null;
  return prevNum - curNum;
}

/* 这场考试里有没有任何一条学校给的年级排名 */
function examHasGradeRank(examId){
  return DB.scores.some(function(sc){
    return sc.examId===examId && hasSchoolGradeRank(sc);
  });
}
function mergeKpPool(tags){
  (tags||[]).forEach(function(t){ if(t && DB.kpPool.indexOf(t)<0) DB.kpPool.push(t); });
}
function examsSorted(){
  return DB.exams.slice().sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); });
}

/* 一场考试可以覆盖多个班（两个班一起考同一份卷子很常见）。
   e.cls 存逗号分隔的字符串，如 "715,716"；历史数据是单值 "715"，照样能读。
   所有地方都通过这个函数拿班级数组，不要直接读 e.cls。 */
function examClsList(e){
  if(!e || !e.cls) return [];
  return String(e.cls).split(',').map(function(s){ return s.trim(); })
    .filter(function(s){ return !!s; });
}

/* 考试下拉里的显示文字：默认只给考试名，不带班级 —— 右边已经有「本次成绩属于哪个班」
   了，再在名字后面挂个「（715班）」既冗余又挤眼睛。
   但如果有两场考试名字完全一样，光看名字分不出是哪场，这时候才补上班级后缀。 */
function examOptionLabel(e){
  var nm = e.name || '（未命名）';
  var same = DB.exams.filter(function(x){ return (x.name||'（未命名）')===nm; }).length;
  var cs = examClsList(e);
  return same>1 && cs.length ? nm+'（'+cs.join('+')+'班）' : nm;
}

/* ===========================================================
   得分率：分数 ÷ 满分 × 100%
   为什么要有这个 —— 各场考试满分可能不同（100 / 120 / 150…），
   直接比较原始分数是错的：120 分制考 85 分其实比 100 分制考 78 分差。
   统一折算成得分率后，跨考试、跨班级才能横向比较。
   =========================================================== */

/* 某场考试的满分（脏数据/老数据兜底 100） */
function fullScoreOf(examOrId){
  var e = (examOrId && typeof examOrId === 'object') ? examOrId : examById(examOrId);
  var v = e ? Number(e.fullScore) : NaN;
  return (isFinite(v) && v > 0) ? v : 100;
}

/* 得分率（百分数数值，0~100+；考试有超分可能所以不封顶） */
function rateOf(score, full){
  var f = Number(full), s = Number(score);
  if(!isFinite(f) || f <= 0) return 0;
  if(!isFinite(s)) return 0;
  /* 保留 4 位小数：既能体现精度，又能消掉 110/100*100 = 110.00000000000001 这类浮点尾数 */
  return +(s / f * 100).toFixed(4);
}

/* 当前是否以得分率展示 */
function showRate(){ return !!(DB.settings && DB.settings.showRate); }

/* 图表刻度：把「大概要几格」变成一个人类看得懂的整数步长（1/2/5/10/20/25…）
   之前用 yMax/5 会算出 18、36、54 这种轴，读起来很怪 */
function niceStep(raw){
  var x = Math.abs(Number(raw)||0);
  if(!(x>0)) return 1;
  var mag = Math.pow(10, Math.floor(Math.log(x)/Math.LN10));
  var norm = x/mag;
  var step = norm<=1?1 : norm<=2?2 : norm<=5?5 : 10;
  return step*mag;
}

/* 把「分数 + 所属考试」渲染成一段显示文本（统一出口，全站都走这里）
   得分率模式：86.5%   ｜   原始分模式：104/120
   small=true 时附带原始分小字，方便两种模式都看到数 */
function fmtScore(score, examOrId, opt){
  opt = opt || {};
  var s = Number(score)||0, full = fullScoreOf(examOrId);
  if(showRate()){
    var r = rateOf(s, full);
    var txt = (Math.round(r*10)/10) + '%';
    if(opt.withRaw) txt += '<span class="muted" style="font-size:.82em;margin-left:4px">'+s+'/'+full+'</span>';
    return txt;
  }
  var txt2 = String(s);
  if(opt.withRaw) txt2 += '<span class="muted" style="font-size:.82em;margin-left:4px">满分'+full+'</span>';
  return txt2;
}

/* 纯数值版（给 SVG 图表、排序、比较用，不能带 HTML） */
function scoreVal(score, examOrId){
  var s = Number(score)||0;
  return showRate() ? +(rateOf(s, fullScoreOf(examOrId))).toFixed(1) : s;
}

/* 涨跌幅：优先用得分率算，跨满分才可比 */
function deltaVal(from, fromFull, to, toFull, digits){
  var a = showRate() ? rateOf(from, fromFull) : Number(from);
  var b = showRate() ? rateOf(to,   toFull)   : Number(to);
  var d = b - a;
  return +d.toFixed(digits==null ? 1 : digits);
}

/* 涨跌单元格：带正负号和单位（得分率模式下加 %，红涨绿跌） */
function deltaCellNum(d){
  if(d === null || d === undefined) return '<span class="muted">—</span>';
  if(d === 0) return '<span class="muted">持平</span>';
  var u = showRate() ? 'pt' : '分';
  return '<span class="'+(d>0?'up':(d<0?'down':'muted'))+'" style="font-weight:600">'
    + (d>0?'+':'') + d + '</span>'
    + '<span class="muted" style="font-size:.82em;margin-left:2px">'+u+'</span>';
}

/* 两个值的差（表格里的「差值」行） */
function diffCell(d, tip){
  var v = +Math.abs(d).toFixed(1);
  if(!v) return '<span class="muted">持平</span>';
  var good = d>0;
  return '<span class="'+(good?'up':'down')+'" style="font-weight:600">'+(good?'+':'-')+v+'</span>'
    + (tip?'<br><span class="muted" style="font-size:11px">'+tip+'</span>':'');
}

/* ===========================================================
   缺考：跟「考了 0 分」必须区分开

   为什么不能拿 0 分代替缺考 ——
   0 分是真实成绩（差，但参加了），要进平均分、要算低分率；
   缺考是没参加，把 0 分算进去会同时干两件错事：
     ① 拉低班级平均分和得分率（那个孩子根本没考）
     ② 把「低分率/不及格率」算高（缺考不是考砸，是没考）
   所以统计时一律剔除，且分母只算实考人数。
   =========================================================== */

/* 这条成绩是不是缺考（缺考时 score 字段不参与任何计算） */
function isAbsent(sc){ return !!(sc && sc.absent); }

/* 单元格统一显示：缺考就显示「缺考」，不显示成 0 分 / 0% */
var ABSENT_TXT = '缺考';
function absentCell(){
  return '<span class="absent-tag">缺考</span>';
}
/* 得分率/分数的统一出口，遇到缺考自动显示「缺考」 */
function fmtScoreOrAbsent(sc, opt){
  if(isAbsent(sc)) return absentCell();
  return fmtScore(sc.score, sc.examId, opt);
}

/* 从 Excel/粘贴的文本里认缺考。
   学校里常见的写法挺杂，能认就认，认不出就当普通分数（Number 后是 NaN 也归缺考）。 */
var ABSENT_WORDS = ['缺考','缺','缺席','未考','未参加','请假','免考','缺测','absent','缺考/','-','—','／','/','无'];
function parseScoreCell(raw){
  var t = String(raw==null?'':raw).trim();
  if(!t) return { absent:true, score:0 };          /* 空单元格 = 没参加 */
  var low = t.toLowerCase();
  for(var i=0;i<ABSENT_WORDS.length;i++){
    if(low===ABSENT_WORDS[i] || low===ABSENT_WORDS[i].toLowerCase()){
      return { absent:true, score:0 };
    }
  }
  var n = Number(t);
  if(!isFinite(n)) return { absent:true, score:0 }; /* 认不出的文字，当缺考更安全（宁可标缺考也别当 0 分拉低均分） */
  return { absent:false, score:n };
}
