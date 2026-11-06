/* ===========================================================
   analysis.js —— 成绩多维分析（第三阶段）
   均分 / 及格率 / 优秀率 / 低分率 / 进步榜 / 两班对比 / 个人波动涨跌

   统计口径：
   · 阈值取自 DB.settings（passRate/goodRate/lowRate，按满分百分比，可调）
   · 两班对比按学生档案里的"班级"字段自动分组，不写死 15/16 班
   =========================================================== */

var anaTab = 'overview';   // overview | trend | compare | classes
var anaExam = '';          // 选中的考试 id
var anaBase = '';          // 进步榜的对比基准考试 id（该页自己控制，与年级排名对比无关）
var anaGrBase = '';        // 「本场成绩一览」里年级排名的对比场次（空 = 不对比）
var anaGrTouched = false;  // 用户是否手动动过年级排名对比下拉（用来区分"未设置"和"用户主动关掉"）
var anaCls = '';           // 两班对比时的班级筛选（空=全部）

/* ---------- 基础取数 ---------- */
function setAnaDefaults(){
  var ex = examsSorted();
  if(!anaExam || !examById(anaExam)) anaExam = ex.length ? ex[ex.length-1].id : '';
  if(!anaBase || !examById(anaBase)){
    // 基准默认取选中考试的前一次
    var i = ex.findIndex(function(e){ return e.id===anaExam; });
    anaBase = i>0 ? ex[i-1].id : (ex.length>1 ? ex[0].id : '');
  }
}
function scoresOf(examId, cls){
  return DB.scores.filter(function(x){
    if(x.examId!==examId) return false;
    if(!cls) return true;
    var s = studentByKey(x.studentId);
    return s && s.cls===cls;
  }).map(function(x){
    return { studentId:x.studentId, score:Number(x.score)||0,
             absent:!!x.absent, stu:studentByKey(x.studentId) };
  });
}
/* 只取「真的考了」的记录 —— 所有统计口径都走这里，
   保证平均分/及格率/优秀率/低分率/分布图的分母里没有缺考的人。 */
function validScoresOf(examId, cls){
  return scoresOf(examId, cls).filter(function(r){ return !r.absent; });
}
function allClasses(){
  var m = {};
  DB.students.forEach(function(s){ if(s.cls) m[s.cls] = 1; });
  return Object.keys(m).sort(natCmp);
}
/* 考试下拉框选项；查不到或无 id 的脏数据自动跳过。有班级的考试带上班级名 */
/* 考试下拉：只显示考试名（同名考试才补班级后缀）——
   右边紧挨着就有「只看哪个班」的下拉，班级挂在名字后面既冗余又挤眼睛。 */
function examOptions(ex, cur){
  return ex.map(function(e){
    if(!e || !e.id) return '';
    var x = examById(e.id);
    if(!x) return '';
    return '<option value="'+esc(x.id)+'"'+(cur===x.id?' selected':'')+'>'
      +esc(examOptionLabel(x))+'</option>';
  }).join('');
}

/* 单场考试的核心指标
   口径：分母 = 实考人数（缺考剔除）
   n     = 实考人数（平均分/及格率/优秀率/低分率都用它当分母）
   total = 有记录人数（含缺考），缺考的人多了会让 n < total，一眼能看出这场缺了几个
   absent= 缺考人数 */
function statOf(examId, cls){
  var e = examById(examId);
  if(!e) return null;
  var all = scoresOf(examId, cls);
  var rows = all.filter(function(r){ return !r.absent; });   /* 缺考不进统计 */
  var fs = Number(e.fullScore)||100;
  var st = DB.settings;
  var o = {
    examId:examId, name:e.name, date:e.date, full:fs, cls:cls||'',
    n:rows.length, total:all.length, absent:all.length-rows.length,
    sum:0, avg:0, max:-Infinity, min:Infinity,
    pass:0, good:0, low:0, vals:[]
  };
  if(!rows.length){
    /* 全场缺考（或没录成绩）：把max/min 兜成 0，
       否则 -Infinity/Infinity 会一路漏到页面上显示成 "Infinity%" */
    o.max = 0; o.min = 0; o.avg = 0; o.median = 0;
    o.avgRate = 0; o.maxRate = 0; o.minRate = 0; o.rangeRate = 0;
    o.passRate = 0; o.goodRate = 0; o.lowRate = 0;
    return o;
  }
  rows.forEach(function(r){
    var v = r.score;
    o.vals.push(v); o.sum += v;
    if(v>o.max) o.max=v;
    if(v<o.min) o.min=v;
    if(v >= fs*st.passRate/100) o.pass++;
    if(v >= fs*st.goodRate/100) o.good++;
    if(v <  fs*st.lowRate/100)  o.low++;
  });
  o.avg = +(o.sum/rows.length).toFixed(1);
  var sv = o.vals.slice().sort(function(a,b){return a-b;});
  var mid = Math.floor(sv.length/2);
  o.median = sv.length%2 ? sv[mid] : +((sv[mid-1]+sv[mid])/2).toFixed(1);
  o.passRate = +(o.pass/rows.length*100).toFixed(1);
  o.goodRate = +(o.good/rows.length*100).toFixed(1);
  o.lowRate  = +(o.low /rows.length*100).toFixed(1);
  /* 得分率版本：平均得分率 / 最高得分率 / 最低得分率
     注意：同一场考试内所有人满分相同，所以「先求均分再换算」和「逐个换算再求平均」
  数学上等价。这里用后者只是为了口径统一（跟分布图、进步榜都是同一套 rateOf）。*/
  var rSum = 0;
  o.vals.forEach(function(v){ rSum += rateOf(v, fs); });
  o.avgRate  = +(rSum/rows.length).toFixed(1);
  o.maxRate  = +(rateOf(o.max, fs)).toFixed(1);
  o.minRate  = +(rateOf(o.min, fs)).toFixed(1);
  o.rangeRate= +(o.maxRate - o.minRate).toFixed(1);
  return o;
}

/* 按当前显示模式取"平均"值：得分率模式给得分率，否则给原始均分 */
function avgShown(s){ return showRate() ? s.avgRate : s.avg; }
/* 最高/最低 */
function maxShown(s){ return showRate() ? s.maxRate : s.max; }
function minShown(s){ return showRate() ? s.minRate : s.min; }
/* 带单位的显示文本 */
function avgTxt(s){ return avgShown(s) + (showRate()?'%':''); }
function scoreTxt(v, examId){ return v + (showRate()?'%':''); }

/* 两人对比：进步/退步榜
   注意：两场考试满分可能不同（100 / 120…），所以涨跌一律用得分率算，
   否则「120分制考85 − 100分制考78 = +7」是假的进步。 */
function progressOf(baseId, curId, cls){
  var base = {}, cur = {};
  /* 两侧都按同一班级过滤，否则跨班学生会混进对比里 */
  /* 用 validScoresOf：缺考的人不能当 0 分基线，
     否则「缺考 → 考 60 分」会显示成 +60 分的假暴涨 */
  validScoresOf(baseId, cls).forEach(function(r){ base[r.studentId]=r.score; });
  validScoresOf(curId, cls).forEach(function(r){ cur[r.studentId]=r.score; });
  var bf = fullScoreOf(baseId), cf = fullScoreOf(curId);
  var list = [];
  Object.keys(cur).forEach(function(sid){
    if(!(sid in base)) return;                 // 缺基线成绩，无法比较
    var d = deltaVal(base[sid], bf, cur[sid], cf, 1);
    list.push({ studentId:sid, stu:studentByKey(sid),
      from:base[sid], to:cur[sid], delta:d,
      /* 两场满分不同 → 提示一下，别让老师误读 */
      diffFs: bf!==cf });
  });
  list.sort(function(a,b){ return b.delta-a.delta; });
  return list;
}

/* ---------- 主渲染 ---------- */
function renderAnalysis(){
  setAnaDefaults();
  var ex = examsSorted();
  if(!ex.length){
    $('content').innerHTML = '<div class="card"><h2>成绩分析</h2>'
      +'<div class="empty">还没有考试数据。<br>请先到「考试管理」新建考试，再到「成绩录入」导入成绩。</div></div>';
    return;
  }
  var h = '';
  h += anaHeader(ex);

  if(anaTab==='overview') h += anaOverview();
  else if(anaTab==='trend') h += anaTrend();
  else if(anaTab==='compare') h += anaCompare();
  else h += anaClasses();

  $('content').innerHTML = h;
}

function anaHeader(ex){
  /* 选中这场考试实际覆盖了哪些班 —— 直接从成绩记录里反查，最准确 */
  var clsList = examClasses(anaExam);
  var e0 = examById(anaExam);
  /* 还没导成绩时，从建考试时指定的班级兜底，让筛选器也有内容（可能不止一个班） */
  if(!clsList.length && e0) clsList = examClsList(e0);
  var h = '<div class="card"><h2>成绩分析</h2>'
    +'<div class="row">'
    +'<div class="field" style="width:220px"><label>分析哪场考试</label><select id="anaExam" onchange="anaExam=this.value;anaCls=\'\';anaGrTouched=false;setAnaDefaults();renderAnalysis()">'
    +examOptions(ex, anaExam) +'</select></div>'
    +'<div class="field" style="width:170px"><label>只看哪个班</label>'
    +'<select id="anaCls" onchange="anaCls=this.value;renderAnalysis()">'
    +'<option value="">全部班</option>'
    +clsList.map(function(c){ return '<option value="'+esc(c)+'"'+(anaCls===c?' selected':'')+'>'+esc(c)+'班</option>'; }).join('')
    +'</select></div>'
    +'<div class="field" style="width:230px"><label>分数线设置（按满分百分比）</label>'
    +'<div style="display:flex;gap:6px">'
    +'<input id="st_pass" type="number" min="1" max="99" value="'+DB.settings.passRate+'" title="及格线%" style="width:64px">'
    +'<input id="st_good" type="number" min="1" max="100" value="'+DB.settings.goodRate+'" title="优秀线%" style="width:64px">'
    +'<input id="st_low"  type="number" min="1" max="99" value="'+DB.settings.lowRate+'" title="低分线%" style="width:64px">'
    +'<button class="sm" onclick="saveThreshold()">应用</button>'
    +'</div></div>'
    /* 得分率 / 原始分 切换：各场考试满分可能不同，统一看得分率才好横向比 */
    +'<div class="field" style="width:160px"><label>成绩怎么显示</label>'
    +'<select id="st_showRate" onchange="toggleShowRate(this.value)">'
    +'<option value="1"'+(showRate()?' selected':'')+'>得分率（%）</option>'
    +'<option value="0"'+(!showRate()?' selected':'')+'>原始分数</option>'
    +'</select></div>'
    +'<div class="hint" style="flex:1;min-width:200px">依次为：及格线 / 优秀线 / 低分线。改完点「应用」。<br>'
    +'当前：≥'+(DB.settings.passRate)+'% 及格，≥'+(DB.settings.goodRate)+'% 优秀，&lt;'+(DB.settings.lowRate)+'% 算低分。</div>'
    +'</div>'
    +'<p class="hint" style="margin:-6px 0 10px">得分率 = 分数 ÷ 满分。'
    +(showRate()
      ? '现在显示<b>得分率</b>，不同满分的考试也能横向比较。'
      : '现在显示<b>原始分数</b>，注意不同满分的考试之间不能直接比。')
    +'</p>'
    /* 这场考试是哪个班的成绩 —— 一眼看清 */
    +'<div class="muted" style="margin-top:-4px;">'
    +examClsLabel(anaExam, clsList, e0)
    +'</div>'
    +'<div class="tabs">'
    +'<span class="tab'+(anaTab==='overview'?' on':'')+'" onclick="anaTab=\'overview\';renderAnalysis()">总览</span>'
    +'<span class="tab'+(anaTab==='trend'?' on':'')+'" onclick="anaTab=\'trend\';renderAnalysis()">历次均分趋势</span>'
    +'<span class="tab'+(anaTab==='compare'?' on':'')+'" onclick="anaTab=\'compare\';renderAnalysis()">进步榜</span>'
    +'<span class="tab'+(anaTab==='classes'?' on':'')+'" onclick="anaTab=\'classes\';renderAnalysis()">两班对比</span>'
    +'</div></div>';
  return h;
}

/* 这场考试的成绩实际来自哪些班（按学生档案的班级字段反查） */
function examClasses(examId){
  var m = {};
  if(!examId) return [];
  DB.scores.forEach(function(x){
    if(x.examId!==examId) return;
    var s = studentByKey(x.studentId);
    if(s && s.cls) m[s.cls] = 1;
  });
  return Object.keys(m).sort(natCmp);
}

/* 提示这场考试属于哪个班：只有一班就直说，多班就说明各有多少人 */
function examClsLabel(examId, clsList, e){
  var tag = function(c){
    var all = scoresOf(examId, c);
    var abs = all.length - validScoresOf(examId, c).length;
    return '<span class="tag">'+esc(c)+'班 '+all.length+' 人'
      + (abs ? '（缺考 '+abs+'）' : '') + '</span>';
  };
  var cntOf = function(c){ return scoresOf(examId, c).length; };
  var parts = [];
  var set = examClsList(e);       // 建考试/导入时标注的班级（可能多个）
  if(set.length>1){
    /* 跨班考试：把每个班的实考人数分别说清楚 */
    if(clsList.length===0){
      parts.push('指定为 <b>'+esc(set.join('+'))+'</b> 班的考试，目前还没有导入成绩');
    } else {
      parts.push('跨 '+clsList.length+' 个班的考试：'+clsList.map(function(c){return tag(c);}).join(''));
    }
  } else if(set.length===1){
    /* 建考试时/导入时指定过班级 */
    var cnt = cntOf(set[0]);
    if(cnt===0){
      /* 还没导入任何成绩 —— 说清楚是"指定"的，别让人以为已经有数据了 */
      parts.push('指定为 <b>'+esc(set[0])+'</b> 班的考试，目前还没有导入成绩');
    } else if(clsList.length===1 && clsList[0]===set[0]){
      var ab = cnt - validScoresOf(examId, set[0]).length;
      parts.push('这是 <b>'+esc(set[0])+'</b> 班的成绩，共 '+cnt+' 人'
        + (ab ? '（实考 '+(cnt-ab)+' 人，缺考 '+ab+' 人）' : ''));
    } else {
      parts.push('导入时标记为 <b>'+esc(set[0])+'</b> 班');
      if(clsList.length>1) parts.push('实际覆盖 '+clsList.length+' 个班：'+clsList.map(function(c){return tag(c);}).join(''));
      else if(clsList.length===0) parts.push('目前还没有成绩记录');
      else parts.push('实际为 '+tag(clsList[0]));
    }
  } else if(clsList.length===1){
    parts.push('这是 <b>'+esc(clsList[0])+'</b> 班的成绩（导入时未指定班级）');
  } else if(clsList.length>0){
    parts.push('成绩来自 '+clsList.length+' 个班：'+clsList.map(function(c){return tag(c);}).join(''));
  } else {
    parts.push('暂无成绩记录（到「成绩录入」选好班级后导入）');
  }
  return '📊 ' + parts.join('，');
}

function saveThreshold(){
  var p = Number($('st_pass').value), g = Number($('st_good').value), l = Number($('st_low').value);
  if(!(p>0&&p<100) || !(g>0&&g<=100) || !(l>0&&l<100)){
    toast('请填写 1-100 之间的有效百分比'); return;
  }
  if(p>=g){ toast('及格线应小于优秀线'); return; }
  DB.settings.passRate=p; DB.settings.goodRate=g; DB.settings.lowRate=l;
  saveDB(); renderAnalysis(); toast('分数线已更新');
}

/* 切换「得分率 / 原始分」；设置跟着存，下次打开还是你习惯的那个 */
function toggleShowRate(v){
  DB.settings.showRate = (String(v) === '1');
  saveDB();
  renderAnalysis();
  toast(DB.settings.showRate ? '已切换为得分率显示' : '已切换为原始分数显示');
}

/* ---------- 1. 总览 ---------- */
function anaOverview(){
  var o = statOf(anaExam, anaCls);
  var e = examById(anaExam);
  if(!o || (!o.n && !o.absent)){
    return '<div class="card"><h2>总览</h2><div class="empty">该场考试还没有'
      + (anaCls ? esc(anaCls)+'班' : '') +'的成绩数据。</div></div>';
  }
  /* 全场都缺考 / 没录成绩：指标没意义，直接说明情况，别显示一堆 0 */
  if(!o.n){
    return '<div class="card"><h2>'+esc(o.name)+'</h2>'
      +'<p class="muted">满分 '+o.full+' ｜ 该场'+(anaCls?esc(anaCls)+'班':'')+'共 '+o.total+' 人，全部缺考</p>'
      +'<div class="empty">这场考试没有实际参加的学生，平均分、及格率等指标算不出来。<br>'
      +'缺考已从统计中剔除，不会计入任何分母。</div></div>';
  }

  var h = '<div class="card"><h2>'+esc(o.name)+(anaCls?' · '+esc(anaCls)+'班':' · 总览')+'</h2>'
    +'<p class="muted">'+esc(o.date||'未填日期')+' ｜ 满分 '+o.full+' ｜ <b>实考 '+o.n+' 人</b>'
    +(o.absent ? ' ｜ <span style="color:#b45309">缺考 '+o.absent+' 人（已从以下各项统计中剔除）</span>' : '')
    +(anaCls ? ' ｜ '+esc(anaCls)+'班共 '+DB.students.filter(function(s){ return s.cls===anaCls; }).length+' 人'
             : ' ｜ 全校 '+allClasses().map(function(c){return c+'班'+DB.students.filter(function(s){return s.cls===c;}).length;}).join(' / '))
    +'</p>';

  /* 四个关键数字 */
  h += '<div class="grid4">'
    +statBox(showRate()?'平均得分率':'平均分', avgTxt(o), '中位数 '+(showRate()?rateOf(o.median,o.full).toFixed(1)+'%':o.median), 'var(--primary-d)')
    +statBox('及格率', o.passRate+'%', o.pass+' / '+o.n+' 人及格', 'var(--ok)')
    +statBox('优秀率', o.goodRate+'%', o.good+' / '+o.n+' 人优秀', '#7c3aed')
    +statBox('低分率', o.lowRate+'%', o.low+' / '+o.n+' 人低分', 'var(--danger)')
    +'</div>';

  /* 最高最低 */
  h += '<div class="row" style="margin-top:14px">'
    +'<div class="stat" style="flex:1"><div class="stat-num">'+maxShown(o)+'</div><div class="stat-lbl">最高'+(showRate()?'得分率':'分')+'</div></div>'
    +'<div class="stat" style="flex:1"><div class="stat-num">'+minShown(o)+'</div><div class="stat-lbl">最低'+(showRate()?'得分率':'分')+'</div></div>'
    +'<div class="stat" style="flex:1"><div class="stat-num">'+o.rangeRate+'</div><div class="stat-lbl">极差'+(showRate()?'(pt)':'')+'</div></div>'
    +'<div class="stat" style="flex:1"><div class="stat-num">'+(o.n?(o.sum/o.n).toFixed(1):0)+'</div><div class="stat-lbl">总分</div></div>'
    +'</div></div>';

  /* 得分率段分布 */
  h += '<div class="card"><h2>'+(showRate()?'得分率段分布':'分数段分布')+(anaCls?'（'+esc(anaCls)+'班）':'')+'</h2>' + histChart(anaExam, 640, anaCls) + '</div>';

/* 临界生在该场表现 */
    var bl = DB.students.filter(function(s){ return s.isBorderline && (!anaCls || s.cls===anaCls); });
    if(bl.length){
    var blRows = [], blSum=0, blN=0, blPass=0, blAbsent=[];
    bl.forEach(function(s){
      var sc = DB.scores.filter(function(x){ return String(x.studentId)===String(s.key) && x.examId===anaExam; })[0];
      if(!sc) return;
      /* 缺考单独收起来，不进均分/及格率的分母 */
      if(isAbsent(sc)){ blAbsent.push(s); return; }
      var v = Number(sc.score)||0;
      blSum+=v; blN++;
      if(v>=o.full*DB.settings.passRate/100) blPass++;
      blRows.push({s:s, v:v});
    });
    h += '<div class="card"><h2>临界生本场表现（'+bl.length+' 人，实考 '+blN+' 人'
      +(blAbsent.length ? '，缺考 '+blAbsent.length+' 人' : '')+'）</h2>';
    if(!blN){
      h += '<div class="empty">临界生在该场考试'
        + (blAbsent.length ? '全部缺考（缺考不计入统计）' : '还没有成绩') +'。</div>';
    } else {
      var blAvg = +(blSum/blN).toFixed(1);
      var blPassRate = +(blPass/blN*100).toFixed(1);
      h += '<p class="muted">临界生'+(showRate()?'平均得分率':'平均分')+' <b>'+scoreTxt(rateOf(blAvg,o.full),anaExam)
        +'</b>（全年级 '+avgTxt(o)+'）'
        +' ｜ 及格率 <b>'+blPassRate+'%</b>（全年级 '+o.passRate+'%）</p>';
      var blGap = showRate()
        ? +(rateOf(blAvg,o.full) - o.avgRate).toFixed(1)
        : +(blAvg - o.avg).toFixed(1);
      var gapUnit = showRate() ? 'pt' : '分';
      h += '<p>'+(blGap<0
        ? '<span class="badge warn">低于全年级平均 '+Math.abs(blGap)+' '+gapUnit+'</span>'
        : '<span class="badge ok">高于全年级平均 '+blGap+' '+gapUnit+'</span>')+'</p>';
      /* 原始分和得分率都要看：原始分对得上卷面（"他考了61分"），
         得分率才能跨满分比较。所以两列并列，不做取舍。 */
      h += '<table><thead><tr><th>学号</th><th>姓名</th><th>班级</th><th>本次得分</th>'
        +(showRate()?'<th>得分率</th>':'')
        +'<th>与班均差</th></tr></thead><tbody>';
      blRows.sort(function(a,b){ return a.v-b.v; }).forEach(function(r){
        var v = r.v;
        var clsAvg = statOf(anaExam, r.s.cls);
        var gap = clsAvg
          ? (showRate() ? +(rateOf(r.v,o.full) - clsAvg.avgRate).toFixed(1)
                        : +(r.v - clsAvg.avg).toFixed(1))
          : null;
        h += '<tr><td>'+esc(r.s.id)+'</td><td><b>'+esc(r.s.name)+'</b></td><td>'+esc(r.s.cls)+'</td>'
          +'<td><b>'+v+'</b></td>'
          +(showRate()?'<td>'+rateOf(r.v,o.full).toFixed(1)+'%</td>':'')
          +'<td>'+(gap===null?'<span class="muted">—</span>'
            : (gap>=0?'<span class="ok-t">+'+gap+'</span>':'<span class="err">'+gap+'</span>'))+'</td></tr>';
      });
      h += '</tbody></table>';
      /* 缺考的临界生单列出来 —— 他们需要跟进，但不该混进上面的均分里 */
      if(blAbsent.length){
        h += '<p class="hint" style="margin-top:10px">缺考（不计入平均分、及格率）：'
          + blAbsent.map(function(s){ return esc(s.name)+'（'+esc(s.cls)+'班 '+esc(s.id)+'）'; }).join('、')
          + '</p>';
      }
    }
    h += '</div>';
  }
  h += anaScoreBoard(o);
  return h;
}

/* ===========================================================
   本场成绩一览（全员名单，可升降序）
   为什么放在总览里 —— 临界生表只看十几个人，剩下三十几个孩子这轮考成什么样、
   谁进步谁退步、跟班均差多少，光看统计数字是看不出来的，得能一行行翻。
   排序用「点表头切换」而不是下拉：表格里直接点最顺手。
   =========================================================== */
var ANA_SORT = 'desc';       /* 'desc' 高→低 | 'asc' 低→高 | 'id' 学号 */
/* 两个班学号相同（715-1 和 716-1 都叫"1"），只按学号排会顺序不定，
   每次渲染可能跳行。所以按学号排序时用「班级 → 学号」两级，
   保证同一批数据每次渲染顺序完全一致。 */
function cmpStu(a, b){
  var c = natCmp(String(a.cls||''), String(b.cls||''));
  return c !== 0 ? c : natCmp(a.id, b.id);
}
/* 名次对比小结：光有一列数字不够，得直接告诉老师"整体是进是退" */
function grCompareSummary(){
  var base = anaGrBase, cur = anaExam;
  var both = 0, better = 0, worse = 0, same = 0, sumUp = 0;
  DB.students.forEach(function(s){
    var a = DB.scores.filter(function(x){ return x.studentId===s.key && x.examId===base; })[0];
    var b = DB.scores.filter(function(x){ return x.studentId===s.key && x.examId===cur; })[0];
    if(!a||!b || isAbsent(a)||isAbsent(b)) return;
    if(a.rkSrc!=='school' || b.rkSrc!=='school') return;
    var ag = gradeRankNum(a), bg = gradeRankNum(b);
    if(ag===null || bg===null) return;
    both++; sumUp += (ag-bg);
    if(bg<ag) better++; else if(bg>ag) worse++; else same++;
  });
  if(!both) return '<br>本场与「'+esc((examById(base)||{}).name||'')+'」<b>没有可对比的名次</b>（两边都得是学校给的年级名次）。';
  var avgD = Math.round(sumUp/both);
  return '<br>与「<b>'+esc((examById(base)||{}).name||'')+'</b>」相比：可对比 <b>'+both+'</b> 人，'
    + '<span class="down">进步 '+better+' 人</span>｜'
    + '<span class="up">退 '+worse+' 人</span>｜持平 '+same+' 人。'
    + '<b>平均'+(avgD>=0?'进步':'退')+' '+Math.abs(avgD)+' 名</b>'
    + (avgD>=0 ? '（整体在往上走）' : '（整体在往后退，值得关注）') + '。';
}

function anaSortBtn(key, label){
  var on = ANA_SORT===key || (key==='grank' && ANA_SORT==='grank-desc');
  /* 年级排名默认"名次小的在前"（grank），再点一次反转成 grank-desc；
     分数/得分率默认从高到低，反向后箭头也相应翻转。 */
  var arrow = key==='desc' || key==='grank' || key==='grdlt' ? '▼'
            : (key==='asc' || key==='rate' || key==='grank-desc' || key==='grdlt-desc') ? '▲' : '↕';
  return '<span class="th-sort'+(on?' on':'')+'" onclick="anaSetSort(\''+key+'\')">'
    +label+(on?' <em>'+arrow+'</em>':'')+'</span>';
}
function anaSetSort(k){
  /* 重复点同一列 → 反向；点别的列 → 用它的默认方向（从高到低）。
     年级排名是例外：名次越小越好，所以默认方向是"名次小的在前"（grank），
     再点一次变 grank-desc（名次大的在前）。 */
  if(ANA_SORT==='grank' && k==='grank') ANA_SORT = 'grank-desc';
  else if(ANA_SORT==='grank-desc' && k==='grank') ANA_SORT = 'grank';
  else if(ANA_SORT==='grdlt' && k==='grdlt') ANA_SORT = 'grdlt-desc';
  else if(ANA_SORT==='grdlt-desc' && k==='grdlt') ANA_SORT = 'grdlt';
  else if(ANA_SORT===k) ANA_SORT = (k==='desc'||k==='rate') ? 'asc' : 'desc';
  else ANA_SORT = k;
  renderAnalysis();
}

/* 一行一个学生 */
function anaScoreRow(s, sc, o, idx){
  var absent = isAbsent(sc);
  var v = Number(sc.score)||0;
  var rt = absent ? null : rateOf(v, o.full);
  /* 年级排名：老师最看重的横向参照。
     只认学校给的真实名次（rkSrc==='school'）；本地按手上两个班算出来的不算 ——
     那个参照系只有约 100 人，和年级几百人不是一把尺子，摆在一起看会误导判断。 */
  var grNum = absent ? null : gradeRankNum(sc);
  var grCell = grNum===null ? '<span class="muted">—</span>'
    : (sc.rkSrc==='auto'
        ? '<span class="muted" title="本地按班上人数算出的名次，非学校年级名次">≈'+grNum+'</span>'
        : '<b>'+grNum+'</b>');
  /* 名次变化：与选中的对比场次比。缺任一名次就显示「—」，不做无意义的换算。 */
  var grdCell = '<span class="muted">—</span>';
  if(anaGrBase && grNum!==null && sc.rkSrc!=='auto'){
    var prevSc = DB.scores.filter(function(x){
      return x.studentId===s.key && x.examId===anaGrBase;
    })[0];
    var prevGr = prevSc ? gradeRankNum(prevSc) : null;
    /* 对比场次的名次也必须是学校的：本地名次和学校名次不同量级，不能相减 */
    if(prevGr!==null && prevSc.rkSrc==='school'){
      var dd = gradeRankDelta(prevGr, grNum);
      grdCell = dd===null ? '<span class="muted">—</span>'
        : dd>0 ? '<span class="down">进步 '+dd+'</span>'
        : dd<0 ? '<span class="up">退 '+(-dd)+'</span>'
        : '<span class="muted">持平</span>';
    }
  }
  return '<tr'+(absent?' class="row-abs"':'')+'>'
    +'<td style="width:52px;color:var(--muted)">'+(idx+1)+'</td>'
    +'<td>'+esc(s.id)+'</td>'
    +'<td><b>'+esc(s.name)+'</b>'
       +(s.isBorderline?' <span class="badge warn">临界</span>':'')+'</td>'
    +'<td>'+(absent ? absentCell() : '<b>'+v+'</b>')+'</td>'
    +(showRate()?'<td>'+(rt===null?'<span class="muted">—</span>':rt.toFixed(1)+'%')+'</td>':'')
    +'<td>'+grCell+'</td>'
    +(anaGrBase?'<td>'+grdCell+'</td>':'')
    +'<td><span class="muted" onclick="openProfile(\''+esc(s.key)+'\')" style="cursor:pointer">档案 ›</span></td>'
    +'</tr>';
}

/* 找出该学生上一次「真的考了」的成绩（缺考不算，否则会显示 +90 的假暴涨） */
function prevValidScore(key, examId){
  var ex = examsSorted().filter(function(e){ return e.id!==examId; });
  /* 优先按日期往前找最近的 */
  var cur = examById(examId);
  if(cur) ex.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
  for(var i=0;i<ex.length;i++){
    var sc = DB.scores.filter(function(x){ return x.studentId===key && x.examId===ex[i].id; })[0];
    if(sc && !isAbsent(sc)) return { score:Number(sc.score)||0, full:fullScoreOf(ex[i]) };
  }
  return null;
}

function anaScoreBoard(o){
  /* 名单范围：跟上面「只看哪个班」一致；不选班就是全部 */
  var list = DB.students.filter(function(s){ return !anaCls || String(s.cls)===String(anaCls); });
  var recOf = {};
  DB.scores.forEach(function(x){ if(x.examId===anaExam) recOf[x.studentId]=x; });
  /* 有成绩的排前面（没考的沉到末尾） */
  var rows = list.map(function(s){ return {s:s, sc:recOf[s.key]||null}; });
  rows.forEach(function(r){ r.absent = r.sc ? isAbsent(r.sc) : false; });
  rows.sort(function(a,b){
    /* 按年级排名排：名次数字越小越好，所以默认升序就是"从第1名往后"。
       没名次的沉到最后（而不是当 0 排最前面，那会误导成"第一名"）。 */
    if(ANA_SORT==='grank' || ANA_SORT==='grank-desc'){
      var ag = a.sc ? gradeRankNum(a.sc) : null;
      var bg = b.sc ? gradeRankNum(b.sc) : null;
      if(ag===null && bg===null) return cmpStu(a.s, b.s);
      if(ag===null) return 1;
      if(bg===null) return -1;
      return ANA_SORT==='grank' ? ag-bg : bg-ag;
    }
    /* 按名次变化排：跟年级排名排序一样，用 anaGrBase 取对比场次的名次。
       进步（delta 大）排前面，符合"看进步榜"的直觉。 */
    if(ANA_SORT==='grdlt' || ANA_SORT==='grdlt-desc'){
      var gv = function(r){
        if(!r.sc || isAbsent(r.sc)) return null;
        var cn = gradeRankNum(r.sc);
        if(cn===null || r.sc.rkSrc==='auto' || !anaGrBase) return null;
        var ps = DB.scores.filter(function(x){ return x.studentId===r.s.key && x.examId===anaGrBase; })[0];
        var pg = ps ? gradeRankNum(ps) : null;
        if(pg===null || ps.rkSrc!=='school') return null;
        return gradeRankDelta(pg, cn);
      };
      var ad = gv(a), bd = gv(b);
      if(ad===null && bd===null) return cmpStu(a.s, b.s);
      if(ad===null) return 1;
      if(bd===null) return -1;
      return ANA_SORT==='grdlt' ? bd-ad : ad-bd;
    }
    var av = a.sc?Number(a.sc.score)||0:null;
    var bv = b.sc?Number(b.sc.score)||0:null;
    /* 没成绩 / 缺考的永远在最后，不参与高低排序 */
    if(av===null && bv===null) return cmpStu(a.s, b.s);
    if(av===null) return 1;
    if(bv===null) return -1;
    if(ANA_SORT==='asc') return av-bv;
    if(ANA_SORT==='id') return cmpStu(a.s, b.s);
    if(ANA_SORT==='rate'){
      /* 按得分率排：同一场考试满分相同，方向和按分数一致；
         万一以后混了不同满分的场次，用得分率才公平。 */
      var ar = rateOf(av, fullScoreOf(examById(a.sc.examId)));
      var br = rateOf(bv, fullScoreOf(examById(b.sc.examId)));
      return br - ar;
    }
    return bv-av;                       /* desc 默认 */
  });

  var nTested = rows.filter(function(r){ return r.sc && !r.absent; }).length;
  var nAbsent = rows.filter(function(r){ return r.absent; }).length;
  var nNone   = rows.length - nTested - nAbsent;
  /* 本场有多少人缺年级排名 —— 在表脚明确告诉老师，否则满屏「—」会让人以为功能坏了 */
  var nNoGr   = rows.filter(function(r){ return r.sc && !r.absent && gradeRankNum(r.sc)===null; }).length;

  /* ---- 年级排名对比：可选任何"已有学校年级名次"的考试作为对比场次 ----
     只列出真的有年级名次的场次：拿一场没公布年级排名的考试来对比，
     整列都是「—」，等于给老师制造一个看不懂的界面。 */
  var grCands = examsSorted().filter(function(e){
    return e.id!==anaExam && examHasGradeRank(e.id);
  });
  /* 脏值清理：对比场次不能是当前这场，也必须仍在候选列表里
     （比如刚补完名次后列表变了，或切换了分析对象）。 */
  if(anaGrBase && (anaGrBase===anaExam || !grCands.some(function(e){ return e.id===anaGrBase; }))) anaGrBase='';
  /* 默认选"上一场有名次的考试"：按日期在当前这场之前最近的一场。
     注意必须有 anaGrTouched 守卫 —— 否则用户主动选「（不对比）」把 anaGrBase 置空后，
     每次重渲染都会被这里重新选上，永远关不掉对比。 */
  if(!anaGrBase && !anaGrTouched && grCands.length){
    var curDate = (examById(anaExam)||{}).date || '';
    var before = grCands.filter(function(e){ return !e.date || e.date<=curDate; });
    anaGrBase = (before.length?before[before.length-1]:grCands[0]).id;
  }
  var grBaseName = anaGrBase ? ((examById(anaGrBase)||{}).name||'') : '';

  var h = '<div class="card"><h2>本场成绩一览（'+rows.length+' 人'
    +(anaCls?' · '+esc(anaCls)+'班':'')+'）</h2>'
    +'<div class="row" style="margin-bottom:10px">'
    +'<div class="field" style="margin:0;width:230px"><label>年级排名对比</label>'
    +'<select id="anaGrBase" onchange="anaGrBase=this.value;anaGrTouched=true;renderAnalysis()">'
    +'<option value="">（不对比）</option>'
    +grCands.map(function(e){
      return '<option value="'+esc(e.id)+'"'+(anaGrBase===e.id?' selected':'')+'>'+esc(e.name)+'</option>';
    }).join('')
    +'</select></div>'
    +(anaGrBase
      ? '<div class="hint" style="flex:1;min-width:240px">与「<b>'+esc(grBaseName)+'</b>」的名次对比。'
        +'<b>名次数字变小就是进步</b>（如 280 → 120 显示绿色「进步 160 名」）；'
        +'对比场次里没名次、或这场考试缺名次的，都显示「—」。</div>'
      : '<div class="hint" style="flex:1;min-width:240px">'
        + (grCands.length ? '选一场已有名次的考试，就多出一列「名次变化」。'
                          : '目前只有这一场考试有年级排名，暂时无法对比。'
                          + '可用「成绩录入」页的「补充年级排名」给其他考试补上名次。') + '</div>')
    +'</div>'
    +'<p class="hint">点表头可切换排序：再点一次同一列会反向。缺考的孩子排在最后，'
    +'不算进平均分。</p>'
    +'<table class="score-board"><thead><tr>'
    +'<th>#</th>'
    +'<th>'+anaSortBtn('id','学号')+'</th>'
    +'<th>姓名</th>'
    +'<th>'+anaSortBtn('desc','本次得分')+'</th>'
    +(showRate()?'<th>'+anaSortBtn('rate','得分率')+'</th>':'')
    +'<th>'+anaSortBtn('grank','年级排名')+'</th>'
    +(anaGrBase?'<th>'+anaSortBtn('grdlt','名次变化')+'</th>':'')
    +'<th></th>'
    +'</tr></thead><tbody>';
  rows.forEach(function(r,i){
    h += r.sc ? anaScoreRow(r.s, r.sc, o, i) : anaNoScoreRow(r.s, i);
  });
  h += '</tbody></table>'
    +'<p class="hint" style="margin-top:10px">实考 <b>'+nTested+'</b> 人'
    +(nAbsent?' ｜ <span style="color:#b45309">缺考 '+nAbsent+' 人</span>':'')
    +(nNone?' ｜ 未登记 '+nNone+' 人':'')
    +'。「年级排名」是学校给的年级名次，<b>数字越小越好</b>；带 <b>≈</b> 的是本地按班上人数算的，不是年级名次。'
    +(nNoGr?'<br>本场有 <b>'+nNoGr+'</b> 人没有年级排名（如学校未公布），显示为「—」，可用「补充年级排名」后填。':'')
    +(anaGrBase? grCompareSummary() : '')
    +'点「档案 ›」跳到该生档案。</p>';
  return h+'</div>';
}
/* 完全没成绩的一行 */
function anaNoScoreRow(s, idx){
  return '<tr class="row-abs">'
    +'<td style="width:52px;color:var(--muted)">'+(idx+1)+'</td>'
    +'<td>'+esc(s.id)+'</td>'
    +'<td><b>'+esc(s.name)+'</b>'
       +(s.isBorderline?' <span class="badge warn">临界</span>':'')+'</td>'
    /* 没成绩就也没有年级排名，本次得分/得分率/年级排名/名次变化合并成一格说明。
       名次变化列只在选了对比场次时才存在，所以 colspan 要跟着变。 */
    +'<td colspan="'+(showRate()?(anaGrBase?4:3):(anaGrBase?3:2))+'"><span class="muted">未登记成绩</span></td>'
    +'<td><span class="muted" onclick="openProfile(\''+esc(s.key)+'\')" style="cursor:pointer">档案 ›</span></td>'
    +'</tr>';
}

function statBox(label, num, sub, color){
  return '<div class="stat"><div class="stat-num" style="color:'+color+'">'+num+'</div>'
    +'<div class="stat-lbl">'+label+'</div>'
    +'<div class="stat-lbl" style="font-size:11.5px">'+sub+'</div></div>';
}

/* ---------- 2. 历次均分趋势 ---------- */
function anaTrend(){
  var ex = examsSorted();
  var h = '<div class="card"><h2>历次考试均分趋势</h2>';
  var rows = ex.map(function(e){ return statOf(e.id, anaCls); }).filter(function(s){ return s && s.n; });
  if(rows.length<1){
    h += '<div class="empty">至少需要一场'+(anaCls?esc(anaCls)+'班':'')+'有成绩的考试。</div></div>';
    return h;
  }
  h += multiLineChart(rows, 640, 300, anaCls);
  h += '<p class="hint">实线为'+(anaCls?esc(anaCls)+'班':'全年级')+(showRate()?'平均得分率':'均分')+'；'
    + (anaCls ? '只看'+esc(anaCls)+'班的数据；' : '表格里「班级」列说明每场考试的成绩来自哪个班；')
    + '表格中「较上次」显示'+(showRate()?'得分率':'分数')+'涨跌（红色为涨、绿色为跌）。</p></div>';

  h += '<div class="card"><h2>历次指标一览</h2>'
    +'<table><thead><tr><th>考试</th><th>班级</th><th>日期</th><th>满分</th><th>人数</th>'
    +'<th>'+(showRate()?'平均得分率':'均分')+'</th><th>较上次</th>'
    +'<th>及格率</th><th>优秀率</th><th>低分率</th><th>最高'+(showRate()?'得分率':'')+'</th><th>最低'+(showRate()?'得分率':'')+'</th></tr></thead><tbody>';
  rows.forEach(function(s,i){
    var d = i>0 ? deltaVal(rows[i-1].avg, rows[i-1].full, s.avg, s.full, 1) : null;
    /* 班级列跟着上面「只看哪个班」走。上面选了716，这里就该写716班 ——
       原来取 examClasses()（这场考试**所有**有成绩的班），
       于是选了716还是显示「715/716班」，看着像筛选没生效。 */
    var cs = anaCls ? [anaCls] : examClasses(s.examId);
    h += '<tr><td><b>'+esc(s.name)+'</b></td>'
      +'<td>'+(cs.length===1 ? esc(cs[0])+'班' : (cs.length>1 ? esc(cs.join('/'))+'班' : '—'))+'</td>'
      +'<td>'+esc(s.date||'—')+'</td><td>'+s.full+'</td><td>'+s.n+'</td>'
      +'<td><b>'+avgShown(s)+'</b></td>'
      +'<td>'+(d===null?'<span class="muted">—</span>'
        :(d>0?'<span class="up">+'+d+(showRate()?'pt':'')+'</span>':(d<0?'<span class="down">'+d+(showRate()?'pt':'')+'</span>':'<span class="muted">持平</span>')))+'</td>'
      +'<td>'+s.passRate+'%</td><td>'+s.goodRate+'%</td><td>'+s.lowRate+'%</td>'
      +'<td>'+maxShown(s)+'</td><td>'+minShown(s)+'</td></tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

/* 多场考试均分折线（每个班一条 + 全年级）
   得分率模式下纵轴是百分比刻度，各场满分不同也能横向比 */
/* onlyCls：当前只看某个班时传它 —— 图例就只列这个班，不再把两个班都画出来。
   不传（或空）则照旧：全年级加粗 + 每个班一条线。 */
function multiLineChart(rows, w, H, onlyCls){
  w = w||660; H = H||300;
  var pad={l:46,r:20,t:18,b:52};
  var R = showRate();
  var val = function(s){ return R ? s.avgRate : s.avg; };
  var maxAll = Math.max.apply(null, rows.map(val).concat([1]));
  var step = niceStep(maxAll/5);
  var yMax = step*5;
  var n = rows.length;
  var xw = (w-pad.l-pad.r)/(n-1||1);
  function px(i){ return pad.l + (n===1?0:i*xw); }
  function py(v){ return H-pad.b - (v/yMax)*(H-pad.t-pad.b); }

  var cls = onlyCls ? [onlyCls] : allClasses();
  var g = '<div class="chart-box"><svg viewBox="0 0 '+w+' '+H+'" role="img">';
  for(var v=0; v<=yMax+0.001; v+=step){
    var y=py(v);
    g+='<line x1="'+pad.l+'" y1="'+y+'" x2="'+(w-pad.r)+'" y2="'+y+'" stroke="#eef1f5"/>';
    g+='<text x="'+(pad.l-6)+'" y="'+y+'" font-size="10" fill="#9aa5b1" text-anchor="end" dominant-baseline="central">'+Math.round(v)+(R?'%':'')+'</text>';
  }
  /* 各班均分 */
  var colors=['#0d9488','#d97706','#7c3aed','#db2777','#0891b2'];
  var lines=[];
  cls.forEach(function(c,ci){
    var pts=[], has=false;
    rows.forEach(function(s,i){
      var st = statOf(s.examId, c);
      if(!st || !st.n){ pts.push(null); return; }
      has=true; pts.push(px(i)+','+py(val(st)));
    });
    if(has) lines.push({pts:pts.filter(Boolean), color:colors[ci%colors.length]});
  });
  lines.forEach(function(L){
    g+='<polyline fill="none" stroke="'+L.color+'" stroke-width="2" points="'+L.pts.join(' ')+'"/>';
  });
  /* 全年级（加粗） */
  g+='<polyline fill="none" stroke="#2f6fed" stroke-width="3" points="'
    +rows.map(function(s,i){ return px(i)+','+py(val(s)); }).join(' ')+'"/>';
  rows.forEach(function(s,i){
    g+='<circle cx="'+px(i)+'" cy="'+py(val(s))+'" r="4" fill="#2f6fed"/>';
    var vAnc = i===0 ? 'start' : (i===n-1 ? 'end' : 'middle');
    g+='<text x="'+px(i)+'" y="'+(py(val(s))-11)+'" font-size="10.5" fill="#2f6fed" text-anchor="'+vAnc+'" font-weight="600">'+val(s)+(R?'%':'')+'</text>';
    /* 横轴考试名：首尾两个点正好压在左右边界上，居中会有一半露在画布外被裁掉，
       所以改成贴边对齐（start / end），中间的点照旧居中。 */
    var anchor = i===0 ? 'start' : (i===n-1 ? 'end' : 'middle');
    var dx = i===0 ? -4 : (i===n-1 ? 4 : 0);
    g+='<text x="'+(px(i)+dx)+'" y="'+(H-pad.b+16)+'" font-size="10" fill="#7b8794" text-anchor="'+anchor+'">'+esc(s.name)+'</text>';
  });
  g+='</svg>';

  /* 图例 */
  g += '<div class="legend" style="margin-top:8px">'
    + '<span><i class="lg" style="background:#2f6fed;border-color:#2f6fed"></i>'
    +(onlyCls ? esc(onlyCls)+'班' : '全年级') + ' '+rows.length+' 场</span>';
  cls.forEach(function(c,ci){
    var anyRow = rows.some(function(s){ var st=statOf(s.examId,c); return st&&st.n; });
    if(!anyRow) return;
    g += '<span><i class="lg" style="background:'+colors[ci%colors.length]+';border-color:'+colors[ci%colors.length]+'"></i>'+esc(c)+'班</span>';
  });
  g += '</div>';
  return g;
}

/* ---------- 3. 进步榜 ---------- */
function anaCompare(){
  var ex = examsSorted();
  var h = '<div class="card"><h2>进步榜（两次考试对比）</h2><div class="row">'
    +'<div class="field" style="width:220px"><label>基准考试（起点）</label><select id="anaBase" onchange="anaBase=this.value;renderAnalysis()">'
    +examOptions(ex, anaBase) +'</select></div>'
    +'<div class="field" style="width:220px"><label>对比考试（终点）</label><select onchange="anaExam=this.value;setAnaDefaults();renderAnalysis()">'
    +examOptions(ex, anaExam) +'</select></div></div>';

  if(anaBase===anaExam){
    h += '<div class="empty">请选择两场不同的考试。</div></div>';
    return h;
  }
  var base = statOf(anaBase, anaCls), cur = statOf(anaExam, anaCls);
  var list = progressOf(anaBase, anaExam, anaCls);
  h += '<p class="muted">'+esc(base?base.name:'基准')+' → '+esc(cur?cur.name:'本次')
    + (anaCls ? '（'+esc(anaCls)+'班）' : '')
    +'，有两次成绩可比的学生 '+list.length+' 人</p>';
  if(!list.length){
    h += '<div class="empty">没有学生同时有这两场考试的成绩。</div></div>';
    return h;
  }

  var ups = list.filter(function(r){ return r.delta>0; });
  var downs = list.filter(function(r){ return r.delta<0; });
  var avgD = +(list.reduce(function(a,b){return a+b.delta;},0)/list.length).toFixed(1);
  var dUnit = showRate() ? 'pt' : '分';
  /* 两场满分不同 → 提示一下，因为此时「分数没变」不等于「得分率没变」 */
  var bf = fullScoreOf(anaBase), cf = fullScoreOf(anaExam);
  var diffFsNote = (bf!==cf)
    ? '<p class="hint">注意：'+esc(base?base.name:'基准')+' 满分 '+bf+'，'+esc(cur?cur.name:'本次')+' 满分 '+cf
      +'，满分不同不能直接比分数，所以涨跌按得分率算（单位 pt = 百分点）。</p>' : '';
  h += diffFsNote;
  h += '<div class="grid4">'
    +statBox('平均涨跌', (avgD>0?'+':'')+avgD+dUnit, '全体平均', avgD>=0?'var(--ok)':'var(--danger)')
    +statBox('进步人数', ups.length, '占 '+pct(ups.length, list.length), 'var(--ok)')
    +statBox('退步人数', downs.length, '占 '+pct(downs.length, list.length), 'var(--danger)')
    +statBox('持平', list.length-ups.length-downs.length, showRate()?'得分率未变':'分数未变', 'var(--muted)')
    +'</div>';

  /* 进步 TOP */
  h += '<h3 style="margin-top:18px">进步最大（前 15）</h3>';
  h += progTable(ups.slice(0,15), true);
  if(!ups.length) h += '<div class="empty">本次没有学生进步。</div>';

  /* 退步 TOP */
  h += '<h3 style="margin-top:18px">退步最大（前 15）</h3>';
  h += progTable(downs.slice(-15).reverse(), false);
  if(!downs.length) h += '<div class="empty">本次没有学生退步。</div>';

  h += '</div>';
  return h;
}

function pct(a,b){ return b ? (a/b*100).toFixed(0)+'%' : '0%'; }

function progTable(rows, isUp){
  if(!rows.length) return '';
  var R = showRate();
  var bFull = fullScoreOf(anaBase), cFull = fullScoreOf(anaExam);
  var baseName = (examById(anaBase)||{}).name || '基准';
  var curName  = (examById(anaExam)||{}).name  || '本次';
  var h = '<table><thead><tr><th style="width:52px">名次</th><th>学号</th><th>姓名</th><th>班级</th>'
    +'<th>'+esc(baseName)+(R?'（得分率）':'')+'</th><th>'+esc(curName)+(R?'（得分率）':'')+'</th>'
    +'<th>涨跌'+(R?'(pt)':'')+'</th><th></th></tr></thead><tbody>';
  rows.forEach(function(r,i){
    var d = r.delta;
    /* 得分率模式下同时给出原始分，方便对照 */
    var fromCell = R
      ? (Math.round(rateOf(r.from,bFull)*10)/10)+'%<br><span class="muted" style="font-size:11px">'+r.from+'/'+bFull+'</span>'
      : String(r.from);
    var toCell = R
      ? '<b>'+(Math.round(rateOf(r.to,cFull)*10)/10)+'%</b><br><span class="muted" style="font-size:11px">'+r.to+'/'+cFull+'</span>'
      : '<b>'+r.to+'</b>';
    h += '<tr><td>'+(i+1)+'</td><td>'+esc(r.studentId)+'</td>'
      +'<td><b>'+esc(r.stu?r.stu.name:'（已删除）')+'</b>'
      +((r.stu&&r.stu.isBorderline)?' <span class="badge warn">临界</span>':'')+'</td>'
      +'<td>'+esc(r.stu?r.stu.cls:'—')+'</td>'
      +'<td>'+fromCell+'</td><td>'+toCell+'</td>'
      +'<td>'+deltaCellNum(d)+'</td>'
      +'<td><button class="sm ghost" onclick="anaLookStu(\''+esc(r.studentId)+'\')">看档案</button></td></tr>';
  });
  return h+'</tbody></table>';
}
function anaLookStu(sid){
  if(!studentByKey(sid)){ toast('该学生已不存在'); return; }
  goSec('students'); selStudent = sid; render();
}

/* ---------- 4. 两班对比 ---------- */
function anaClasses(){
  var cls = allClasses();
  var ex = examsSorted();
  var cur = statOf(anaExam);
  var n = cls.length;
  var h = '<div class="card"><h2>'+(n>=2 ? n+'个班对比' : '班级成绩')+'</h2>';

  if(!cur || !cur.n){
    h += '<div class="empty">该场考试还没有成绩数据。</div></div>';
    return h;
  }
  /* 只列出这场考试真有成绩的班，免得选出空班级 */
  var withData = examClasses(anaExam);
  h += '<div class="row">'
    +'<div class="field" style="width:240px"><label>考试</label><select onchange="anaExam=this.value;anaCls=\'\';anaGrTouched=false;setAnaDefaults();renderAnalysis()">'
    +examOptions(ex, anaExam) +'</select></div>'
    +'<div class="field" style="width:200px"><label>班级（留空=全校）</label><select id="anaCls" onchange="anaCls=this.value;renderAnalysis()">'
    +'<option value=""'+(anaCls===''?' selected':'')+'>全校合计</option>'
    +(withData.length ? withData : cls).map(function(c){
        return '<option value="'+esc(c)+'"'+(anaCls===c?' selected':'')+'>'+esc(c)+'班</option>'; }).join('')
    +'</select></div></div>';

  var targets = anaCls ? [anaCls] : (withData.length ? withData : cls);
  if(!targets.length){
    h += '<div class="empty">学生档案里还没有班级信息，无法分组对比。</div></div>';
    return h;
  }

  var stats = targets.map(function(c){ return statOf(anaExam, c); }).filter(function(s){ return s && s.n; });
  if(!stats.length){
    h += '<div class="empty">'+(anaCls
      ? esc(anaCls)+'班在该场考试还没有成绩。'
      : '当前没有可用于分班对比的成绩数据。')+'</div></div>';
    return h;
  }
  if(stats.length<2 && !anaCls){
    h += '<div class="empty">需要有至少两个班级的成绩数据。当前只有 '+stats.length+' 个班有成绩。</div></div>';
    return h;
  }

  /* 核心指标对照 */
  h += '<table><thead><tr><th>班级</th><th>实考</th><th>缺考</th><th>'+(showRate()?'平均得分率':'均分')
    +'</th><th>及格率</th><th>优秀率</th>'
    +'<th>低分率</th><th>最高'+(showRate()?'得分率':'')+'</th><th>最低'+(showRate()?'得分率':'')+'</th></tr></thead><tbody>';
  stats.forEach(function(s){
    h += '<tr><td><b>'+esc(s.cls)+'班</b></td><td>'+s.n+'</td>'
      +'<td>'+(s.absent ? '<span style="color:#b45309">'+s.absent+'</span>' : '<span class="muted">0</span>')+'</td>'
      +'<td><b>'+avgShown(s)+'</b></td><td>'+s.passRate+'%</td><td>'+s.goodRate+'%</td>'
      +'<td>'+s.lowRate+'%</td><td>'+maxShown(s)+'</td><td>'+minShown(s)+'</td></tr>';
  });
  if(stats.length>=2){
    var a=stats[0], b=stats[1];
    var av = showRate()?a.avgRate:a.avg, bv = showRate()?b.avgRate:b.avg;
    h += '<tr style="background:var(--bg)"><td><b>差值</b></td><td>'+(a.n-b.n>0?'+':'')+(a.n-b.n)+'</td>'
      +'<td>'+(a.absent-b.absent>0?'+':'')+(a.absent-b.absent)+'</td>'
      +'<td>'+deltaCell(av-bv,1)+'</td>'
      +'<td>'+deltaCell(a.passRate-b.passRate,1)+'</td>'
      +'<td>'+deltaCell(a.goodRate-b.goodRate,1)+'</td>'
      +'<td>'+deltaCell(b.lowRate-a.lowRate,1,'（低分越少越好）')+'</td>'
      +'<td>'+deltaCell((showRate()?a.maxRate:a.max)-(showRate()?b.maxRate:b.max),1)+'</td>'
      +'<td>'+deltaCell((showRate()?a.minRate:a.min)-(showRate()?b.minRate:b.min),1,'（低分越高越好）')+'</td></tr>';
  }
  h += '</tbody></table>';
  h += '<p class="hint">各项比率的分母都是<b>实考人数</b>，缺考已剔除'
    + (stats.some(function(s){return s.absent;})
        ? '（' + stats.map(function(s){return esc(s.cls)+'班缺考 '+s.absent+' 人';}).join('，') + '）' : '')
    + '。</p>';
  if(stats.length>=2){
    h += '<p class="hint">差值行 = '+esc(stats[0].cls)+'班 − '+esc(stats[1].cls)+'班。'
      +'低分率那一行做了反向处理（低分率更低的一方显示为正）。</p>';
  } else {
    h += '<p class="hint">当前只选中 1 个班，暂无差值行。把班级改回「全校合计」即可两班对比。</p>';
  }

  /* 均分对比条形图（单班时不画无意义的单条图） */
  if(stats.length>=2){
    h += '<div style="margin-top:16px"><h3>各班'+(showRate()?'平均得分率':'均分')+'对比</h3>'
      + barChart(stats.map(function(s,i){
          return {label:s.cls+'班', value:avgShown(s),
                  text:avgShown(s)+(showRate()?'%':''),
                  color:['#2f6fed','#0d9488','#d97706','#7c3aed'][i%4]};
        }), 620)
      + '</div>';
  }

  /* 分数段分布并排 */
  h += '<h3 style="margin-top:18px">'+(showRate()?'得分率段':'分数段')+'分布对比</h3>';
  h += '<div class="grid2">';
  stats.forEach(function(s){
    h += '<div><p style="margin:0 0 6px;font-size:13.5px;"><b>'+esc(s.cls)+'班</b>（实考 '+s.n+' 人'
      + (s.absent ? '，缺考 '+s.absent+' 人' : '') + '）</p>'
      + classHist(s, 300) + '</div>';
  });
  h += '</div>';

  h += '</div>';
  return h;
}

function deltaCell(d, digits, tip){
  var v = +(Math.abs(d)).toFixed(digits==null?1:digits);
  if(!v) return '<span class="muted">持平</span>';
  var good = d>0;
  return '<span class="'+(good?'up':'down')+'" style="font-weight:600">'+(good?'+':'-')+v+'</span>'
    +(tip?'<br><span class="muted" style="font-size:11px">'+tip+'</span>':'');
}

/* 单班分数段分布（紧凑版）
   得分率模式下按 0-10%、10-20%…90-100% 分段，各班满分不同也能对比
   s.vals 由 statOf 生成，已经剔除了缺考的人 */
function classHist(s, w){
  var R = showRate();
  var buckets = new Array(10).fill(0);
  /* R 模式：直接用得分率（0~100）分 10 段，每段 10pt
     原始分模式：按满分分 10 段 */
  var step = R ? 10 : (s.full/10);
  s.vals.forEach(function(v){
    var x = R ? rateOf(v, s.full) : v;
    buckets[Math.min(9,Math.max(0,Math.floor(x/step)))]++;
  });
  var H=190, pad={l:26,r:8,t:14,b:34};
  var maxC = Math.max.apply(null, buckets.concat([1]));
  var bw = (w-pad.l-pad.r)/10;
  var g='<svg viewBox="0 0 '+w+' '+H+'" role="img">';
  buckets.forEach(function(c,i){
    var h=(c/maxC)*(H-pad.t-pad.b), x=pad.l+i*bw, y=H-pad.b-h;
    g+='<rect x="'+x+'" y="'+y+'" width="'+(bw-2)+'" height="'+h+'" fill="#0d9488" rx="2"/>';
    if(c>0) g+='<text x="'+(x+(bw-2)/2)+'" y="'+(y-3)+'" font-size="9" fill="#475569" text-anchor="middle">'+c+'</text>';
    var lo = Math.round(i*step), hi = Math.round((i+1)*step);
    var lbl = R ? (lo+'%') : (String(lo));
    g+='<text x="'+(x+(bw-2)/2)+'" y="'+(H-pad.b+13)+'" font-size="8" fill="#9aa5b1" text-anchor="middle">'+lbl+'</text>';
  });
  g+='</svg>';
  if(R) g+='<p class="hint" style="margin:4px 0 0;font-size:11px">横轴为得分率区间（每段 10pt）</p>';
  return g;
}
