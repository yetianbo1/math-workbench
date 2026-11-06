/* ===========================================================
   scores.js —— 成绩录入（Excel/CSV/xlsm）、考试管理、临界生、知识点统计
   =========================================================== */

/* 上次用的班级：一次导一个班，记住上次选的那个，少点一次 */
var SCORE_CLS = '';

/* 切换考试时，如果这场考试之前导入过成绩，自动带出它的班级 */
/* 导入区的班级改了，名册跟着换 —— 两个卡片上下紧邻，
   不同步就会出现「上面导716、下面还在点名715」的错觉。
   考试没选时不动名册（名册以它自己的选择为准）。 */
function syncRosterCls(){
  var se = $('scoreExam');
  if(!se || !se.value) return;
  ROSTER_EXAM = se.value;
  ROSTER_CLS = SCORE_CLS;
  var re = $('ro_exam'); if(re) re.value = ROSTER_EXAM;
  var rc = $('ro_cls');  if(rc) rc.value = ROSTER_CLS;
  renderRoster();
}
function syncExamCls(){
  var e = examById($('scoreExam').value);
  var cs = examClsList(e);
  /* 只有单班考试才自动带出班级；跨班考试保持当前选择，
     否则 e.cls="715,716" 塞进单选下拉会匹配不到任何选项、看起来像"没选班"。 */
  if(e && cs.length===1){
    SCORE_CLS = cs[0];
    var sel = $('scoreCls');
    if(sel) sel.value = cs[0];
  }
  syncRosterCls();
}

/* 从已粘贴的表格里猜班级：
   若表里有「班级」列直接用；否则看这些学号在学生档案里都指向哪个班。 */
function autoGuessScoreCls(){
  var p = parseTable($('scoreText').value);
  if(!p){ toast('请先粘贴成绩数据'); return; }
  var iC = headKey(p.headers,['班级']);
  if(iC>=0){
    var seen = {};
    p.rows.forEach(function(r){ if(r[iC]) seen[String(r[iC]).trim()] = 1; });
    var ks = Object.keys(seen);
    if(ks.length===1){
      var sel=$('scoreCls'); if(sel) sel.value = ks[0];
      SCORE_CLS = ks[0];
      syncRosterCls();
      toast('表格里写着「'+ks[0]+'」，已帮你选中');
    } else {
      toast('表格里有多个班级：'+ks.join('、')+'，请手动选择');
    }
    return;
  }
  /* 没有班级列：按学号反查学生档案。
     注意不能用 studentById —— 它只返回第一个匹配的，
     两个班学号相同时会误判成"只有一个班"。这里统计全部命中。 */
  var iStu = headKey(p.headers,['学号']);
  if(iStu<0){ toast('表格里没有「学号」列，无法自动判断班级'); return; }
  var byCls = {};
  p.rows.forEach(function(r){
    var id=r[iStu]; if(!id) return;
    var target = String(id);
    DB.students.forEach(function(s){
      if(String(s.id)===target && s.cls) byCls[s.cls]=1;
    });
  });
  var ks = Object.keys(byCls);
  if(ks.length===1){
    var sel2=$('scoreCls'); if(sel2) sel2.value = ks[0];
    SCORE_CLS = ks[0];
    syncRosterCls();
    toast('这批学号都属于「'+ks[0]+'」，已帮你选中');
  } else if(ks.length===0){
    toast('这些学号在学生档案里都找不到，请先导入学生或手动选班级');
  } else {
    toast('学号分散在 '+ks.join('、')+' 多个班，请手动选择');
  }
}

/* ---------- 成绩录入 ---------- */
function renderScores(){
  /* 考试下拉：只显示考试名（同名考试才补班级后缀），班级由右边那个下拉决定 */
  var examOpts = '<option value="">— 请选择目标考试 —</option>' +
    examsSorted().map(function(e){
      var ecl = examClsList(e);
      return '<option value="'+esc(e.id)+'"'+(ecl.length===1?' data-cls="'+esc(ecl[0])+'"':'')+'>'
        +esc(examOptionLabel(e))+'</option>';
    }).join('');

  /* 班级选项：已有班级 + 自由输入 */
  var clsList = allClasses();
  var clsInput = '<input id="stuCls" list="importClsList" placeholder="如 715 / 716" style="width:130px">'
    +'<datalist id="importClsList">'+clsList.map(function(c){ return '<option value="'+esc(c)+'">'; }).join('')+'</datalist>';

  var h = '<div class="card"><h2>导入学生信息（学号 + 姓名，可选性别 / 班级）</h2>'
    +'<p class="hint">支持：① Excel 中选中区域复制后粘贴；② 上传 CSV/TXT；③ 选择 .xlsx / .xlsm 文件。列名：学号、姓名、性别、班级（至少含学号与姓名）。</p>'
    +'<div class="row"><div class="field" style="margin:0"><label>整张表归入哪个班（表格没有「班级」列时用）</label>'
    +clsInput+'</div>'
    +'<div class="muted" style="margin-bottom:8px">分两个班导入时：先导入 715 班那份，这里填 715；再导入 716 班那份，改成 716。<br>'
    +'表格里本身带「班级」列的话，以表格里的为准，这里会被忽略。</div></div>'
    +'<div class="row"><textarea id="stuText" placeholder="在此粘贴 Excel 数据（Tab 分隔）…"></textarea></div>'
    +'<div class="row"><button onclick="previewStudentImport()">解析预览</button> '
    +fileBtn('选择CSV/TXT文件','.csv,.txt',"fileToText('stuText',this)")+' '
    +fileBtn('选择Excel(.xlsx/.xlsm)','.xlsx,.xlsm',"fileToXlsm('stu',this)")+' '
    +'<button class="ghost" onclick="showAddStudent()">+ 新增学生</button></div>'
    +'<div id="stuPreview"></div></div>';

  h += '<div class="card"><h2>导入成绩（选定目标考试 + 学号 / 姓名 / 成绩）</h2>'
    +'<p class="hint">先选「目标考试」，本次成绩全部归入该考试。列名：学号、姓名、成绩（或"分数"）、满分、班级排名、年级排名。若表格自带「考试名称」列则按列分配。<br>'
    +'表格里有<b>年级排名</b>列时会当作<b>学校给的真实年级名次</b>保存，并在学生档案里跟踪其变化；'
    +'没有排名的考试会被跳过、不影响其他场次的对比。系统不会用本地算的排名覆盖学校给的名次。</p>'
    +'<div class="row"><div class="field"><label>目标考试 *</label><select id="scoreExam" onchange="syncExamCls()">'+examOpts+'</select></div>'
    +'<div class="field" style="margin:0"><label>本次成绩属于哪个班 *</label>'
    +'<select id="scoreCls" onchange="SCORE_CLS=this.value;syncRosterCls()"><option value="">— 请选择 —</option>'
    +clsList.map(function(c){ return '<option value="'+esc(c)+'"'+(SCORE_CLS===c?' selected':'')+'>'+esc(c)+'班</option>'; }).join('')
    +'</select></div>'
    +'<button class="ghost" onclick="goSec(\'exams\')">去考试管理新建</button>'
    +'<button class="ghost" onclick="autoGuessScoreCls()">从表格自动判断</button></div>'
    +'<p class="hint" style="margin-top:-4px;">导入时按「学号 + 班级」匹配学生，所以两个班学号重复也不会串。<br>'
    +'一次导一个班：先选好班级再导入。表格里自带「班级」列的话，以表格里的为准。<br>'
    +'成绩格写<b>「缺考」「请假」或留空</b>，会记成缺考 —— 不算0 分、不进班级统计。'
    +'人没在表里出现的话，用下面的<b>成绩名册</b>补上。</p>'
    +'<div class="row"><textarea id="scoreText" placeholder="在此粘贴成绩数据…"></textarea></div>'
    +'<div class="row"><button onclick="previewScoreImport()">解析预览</button> '
    +fileBtn('选择CSV/TXT文件','.csv,.txt',"fileToText('scoreText',this)")+' '
    +fileBtn('选择Excel(.xlsx/.xlsm)','.xlsx,.xlsm',"fileToXlsm('score',this)")+'</div>'
    +'<div id="scorePreview"></div></div>';

  h += renderGradeRankImportCard();
  h += renderRosterCard();

  h += '<div class="card"><h2>网页内逐条补录 / 修改成绩</h2><div class="row">'
    +'<div class="field"><label>学生</label><select id="s_stu">'+DB.students.slice().sort(function(a,b){return natCmp(a.id,b.id);}).map(function(s){
        return '<option value="'+esc(s.key)+'">'+esc(s.name)+'（'+esc(s.cls?s.cls+'班 ':'')+esc(s.id)+'）</option>'; }).join('')+'</select></div>'
    +'<div class="field"><label>考试</label><select id="s_exam">'+examsSorted().map(function(e){
        return '<option value="'+esc(e.id)+'">'+esc(e.name)+'</option>'; }).join('')+'</select></div>'
    +'<div class="field"><label>分数</label><input id="s_score" style="width:110px"></div>'
    +'<div class="field"><label>班级排名</label><input id="s_cr" style="width:90px"></div>'
    +'<div class="field"><label>年级排名</label><input id="s_gr" style="width:90px"></div>'
    +'<label style="display:flex;align-items:center;gap:5px;margin:0;white-space:nowrap;">'
    +'<input type="checkbox" id="s_absent" style="width:auto"> 缺考</label>'
    +'<button onclick="saveScore()">保存成绩</button></div>'
    +'<p class="hint" style="margin-top:6px">勾了「缺考」就不用填分数 —— 缺考不会被算进班级平均分、及格率的分母。</p></div>';

  $('content').innerHTML = h;
  initRoster();
}

function fileBtn(label, accept, onchange){
  return '<label class="ghost" style="display:inline-block;padding:8px 15px;border:1px solid var(--primary);border-radius:7px;color:var(--primary);cursor:pointer;">'
    +label+'<input type="file" accept="'+accept+'" style="display:none" onchange="'+onchange+'"></label>';
}

function fileToText(target, input){
  var f = input.files[0]; if(!f) return;
  var r = new FileReader();
  r.onload = function(){
    $(target).value = r.result;
    if(target==='stuText') previewStudentImport(); else previewScoreImport();
  };
  r.readAsText(f, 'utf-8');
}

function fileToXlsm(kind, input){
  var f = input.files[0]; if(!f) return;
  if(typeof XLSX === 'undefined'){ toast('Excel 解析库未加载，无法读取表格'); return; }
  var r = new FileReader();
  r.onload = function(){
    try{
      var wb = XLSX.read(r.result, {type:'array'});
      var ws = wb.Sheets[wb.SheetNames[0]];
      var m = sheetToMatrix(ws);
      if(!m){ toast('该工作表为空'); return; }
      if(kind==='stu'){ $('stuText').value = matrixToText(m); previewStudentImport(); }
      else { $('scoreText').value = matrixToText(m); previewScoreImport(); }
    }catch(err){ toast('Excel 解析失败：'+err.message); }
  };
  r.readAsArrayBuffer(f);
}

function sheetToMatrix(ws){
  var a = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  var rows = a.map(function(r){
    return Array.isArray(r) ? r.map(function(c){ return c==null?'':String(c).trim(); }) : [];
  }).filter(function(r){ return r.length && r.some(function(c){ return c!==''; }); });
  if(!rows.length) return null;
  return {headers:rows[0], rows:rows.slice(1)};
}
function matrixToText(m){
  if(!m) return '';
  return [m.headers.join('\t')].concat(m.rows.map(function(r){ return r.join('\t'); })).join('\n');
}
function parseTable(text){
  var lines = String(text).replace(/\r/g,'').split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
  if(!lines.length) return null;
  var delim = lines[0].indexOf('\t')>=0 ? '\t' : (lines[0].indexOf(',')>=0 ? ',' : /\s+/);
  var headers = lines[0].split(delim).map(function(h){ return h.trim(); });
  var rows = lines.slice(1).map(function(l){ return l.split(delim).map(function(c){ return c.trim(); }); });
  return {headers:headers, rows:rows};
}
function headKey(headers, keys){
  for(var i=0;i<keys.length;i++){
    var idx = headers.findIndex(function(h){ return h && h.indexOf(keys[i])>=0; });
    if(idx>=0) return idx;
  }
  return -1;
}

function previewStudentImport(){
  var p = parseTable($('stuText').value), box = $('stuPreview');
  if(!p){ box.innerHTML='<p class="err">没有可解析的数据，请先粘贴或选择文件。</p>'; return; }
  var iStu = headKey(p.headers,['学号']), iName = headKey(p.headers,['姓名']),
      iC = headKey(p.headers,['班级']);
  if(iStu<0 || iName<0){ box.innerHTML='<p class="err">学生表需含「学号」和「姓名」列，当前表头：'+esc(p.headers.join('、'))+'</p>'; return; }

  var defCls = iC<0 ? ($('stuCls') ? $('stuCls').value.trim() : '') : '';
  var st = analyzeStudentImport(p, iStu, iName, iC, defCls);

  var extra = '';
  if(iC<0){
    extra = defCls ? '，将全部归入 <b>'+esc(defCls)+'</b> 班'
                  : '，<span class="err">未指定班级（导入后班级为空）</span>';
  }
  var html = '<p class="ok-t">识别为【学生信息】，共 '+st.total+' 行（学号 '+st.distinct+' 个不同）'+extra+'。'
    +' 将新增 <b>'+st.add+'</b> 人，更新 <b>'+st.upd+'</b> 人。</p>';

  /* 撞号警告：同一份表里学号重复（两班学号撞了但又归到同一个班，只能靠姓名区分） */
  if(st.dupInFile.length){
    html += '<p class="err">⚠ 本表内有学号重复且班级相同：'+esc(st.dupInFile.join('、'))
      +'。这些行会按姓名判断，若两个人真同名，后一个会覆盖前一个。</p>';
  }
  /* 跨班撞号提醒（不再危险，但值得告知） */
  if(st.crossClash.length){
    html += '<p class="hint">注：有 '+st.crossClash.length+' 个学号在别的班已存在（如 '
      +esc(st.crossClash.slice(0,3).join('、'))+(st.crossClash.length>3?' 等':'')+'）。'
      +'这些是不同班的学生，现在可以共存了，不会互相覆盖。</p>';
  }
  box.innerHTML = html
    +'<div class="row"><button onclick="doImportStudents()">确认导入学生</button></div>';
}

/* 预分析导入结果：新增/更新各多少，有无同表重复、跨班撞号 */
function analyzeStudentImport(p, iStu, iName, iC, defCls){
  var add=0, upd=0, dupInFile=[], crossClash=[], total=0;
  var seenThisFile = {};
  p.rows.forEach(function(r){
    var id=r[iStu]; if(!id||!r[iName]) return;
    total++;
    var cls = iC>=0 ? (r[iC]||'') : defCls;
    var key = String(id)+'\u0001'+String(cls);
    if(seenThisFile[key]){
      if(dupInFile.indexOf(id)<0) dupInFile.push(id);
    }
    seenThisFile[key] = 1;
    var s = studentByIdCls(id, cls);
    if(s) upd++;
    else {
      add++;
      /* 该学号在别的班已存在 → 只是提示，不会覆盖 */
      var other = null;
      for(var k=0;k<DB.students.length;k++){
        var x = DB.students[k];
        if(String(x.id)===String(id) && String(x.cls||'')!==String(cls)){ other = x; break; }
      }
      if(other && crossClash.indexOf(String(id))<0) crossClash.push(String(id));
    }
  });
  return {add:add, upd:upd, total:total, distinct:Object.keys(seenThisFile).length,
    dupInFile:dupInFile, crossClash:crossClash};
}

function doImportStudents(){
  var p = parseTable($('stuText').value); if(!p) return;
  var iStu=headKey(p.headers,['学号']), iName=headKey(p.headers,['姓名']),
      iG=headKey(p.headers,['性别']), iC=headKey(p.headers,['班级']);
  if(iStu<0||iName<0){ toast('学生表需含学号、姓名'); return; }
  /* 表格没有「班级」列时，用上方填的「整张表归入哪个班」 */
  var defCls = iC<0 && $('stuCls') ? $('stuCls').value.trim() : '';
  var st = analyzeStudentImport(p, iStu, iName, iC, defCls);
  /* 同表内学号+班级完全重复 → 会认错人，必须拦下让老师确认 */
  if(st.dupInFile.length){
    if(!confirm('⚠ 警告：本表中学号重复（'+st.dupInFile.join('、')+'），且班级相同。\n\n'
      +'这意味着表里可能有重名或重复行，导入时会互相覆盖。\n\n'
      +'建议先检查 Excel。确定要继续导入吗？')) return;
  }
  var n=0, upd=0;
  p.rows.forEach(function(r){
    var id=r[iStu]; if(!id||!r[iName]) return;
    var cls = iC>=0 ? (r[iC]||'') : defCls;
    /* 按「学号 + 班级」找，绝不按学号单独找 —— 否则两个班撞号会互相顶掉 */
    var s=studentByIdCls(id, cls);
    if(s){
      s.name=r[iName]||s.name;
      if(iG>=0) s.gender=r[iG]||s.gender;
      if(cls) s.cls=cls;
      upd++;
    } else {
      DB.students.push({id:id, name:r[iName], gender:iG>=0?r[iG]:'', cls:cls,
        key:studentKey(id, cls),                    /* 唯一标识：班级-学号 */
        remark:'', homework:'', performance:'', kpTags:[], isBorderline:false});
      n++;
    }
  });
  ensureStudentKeys();
  saveDB(); renderScores(); toast('学生：新增 '+n+' 人，更新 '+upd+' 人'
    + (defCls ? '（已归入 '+defCls+' 班）' : ''));
}

/* 成绩表匹配学生。规则（按可靠性从高到低）：
   1. 表格带「班级」列 → 学号 + 班级 精确匹配
   2. 用户在页面上指定了「本次成绩属于哪个班」→ 学号 + 该班 精确匹配
   3. 都没给，但该学号在全校只出现一次 → 可以安全匹配
   4. 都没给，且该学号在多个班都存在 → 无法确定，返回 null 交给上层报告并跳过
   返回 null 绝不"猜"一个人 —— 猜错就把成绩记到别的班学生头上了。 */
function matchScoreStudent(sid, name, cls){
  if(sid){
    if(cls) return studentByIdCls(sid, cls);
    var c = $('scoreCls') ? $('scoreCls').value.trim() : '';
    if(c) return studentByIdCls(sid, c);
    var hits = DB.students.filter(function(x){ return String(x.id)===String(sid); });
    return hits.length===1 ? hits[0] : null;
  }
  if(name){
    var byName = DB.students.filter(function(x){ return x.name===name; });
    if(byName.length===1) return byName[0];
    return null;   /* 同名多人 → 不猜 */
  }
  return null;
}

function previewScoreImport(){
  var p = parseTable($('scoreText').value), box = $('scorePreview');
  if(!p){ box.innerHTML='<p class="err">没有可解析的数据，请先粘贴或选择文件。</p>'; return; }
  var iStu=headKey(p.headers,['学号']), iName=headKey(p.headers,['姓名']),
      iScore=headKey(p.headers,['分数','成绩']), iExam=headKey(p.headers,['考试名称']),
      iC=headKey(p.headers,['班级']);
  if(iScore<0){ box.innerHTML='<p class="err">成绩表需含「成绩」（或「分数」）列，当前表头：'+esc(p.headers.join('、'))+'</p>'; return; }
  if(iStu<0 && iName<0){ box.innerHTML='<p class="err">成绩表需含「学号」或「姓名」用于匹配学生。</p>'; return; }
  var target = $('scoreExam').value;
  if(iExam<0 && !target){ box.innerHTML='<p class="err">表格无「考试名称」列，请先在上方选择目标考试。</p>'; return; }
  var cnt=0, bad=0, absent=0, ambiguous=[];
  p.rows.forEach(function(r){
    var sid=iStu>=0?r[iStu]:null;
    var s = matchScoreStudent(sid, iName>=0?r[iName]:null, iC>=0?r[iC]:'');
    if(!s){
      if(sid && studentById(sid)) ambiguous.push(sid);
      bad++; return;
    }
    /* 表格里写「缺考」或留空的，认成缺考，不当 0 分 */
    if(parseScoreCell(r[iScore]).absent) absent++;
    cnt++;
  });
  var h = '<p class="ok-t">识别为【成绩】，共 '+cnt+' 条有效，'+bad+' 条因学号/姓名匹配不到学生被跳过。'
    +(absent ? '其中 <b>'+absent+'</b> 条为<b>缺考</b>（单元格写了「缺考」或留空），不计入班级统计。' : '')
    +'</p>';
  if(ambiguous.length){
    h += '<p class="err">⚠ 有 '+ambiguous.length+' 条的学号存在于其他班（如 '+esc(ambiguous.slice(0,5).join('、'))
      +'），本表没写班级、也没指定本次成绩的班级，无法确定成绩属于谁，已跳过。<br>'
      +'<b>解决：</b>在本页上方「本次成绩属于哪个班」里选好班级，或让 Excel 带上「班级」列，再重新导入。</p>';
  }
  box.innerHTML = h +'<div class="row"><button onclick="doImportScores()">确认导入成绩</button></div>';
}
function doImportScores(){
  var p = parseTable($('scoreText').value); if(!p) return;
  var iStu=headKey(p.headers,['学号']), iName=headKey(p.headers,['姓名']),
      iScore=headKey(p.headers,['分数','成绩']), iExam=headKey(p.headers,['考试名称']),
      iFs=headKey(p.headers,['满分']), iCr=headKey(p.headers,['班级排名']), iGr=headKey(p.headers,['年级排名']),
      iC=headKey(p.headers,['班级']);
  if(iScore<0){ toast('成绩表需含成绩列'); return; }
  var target = $('scoreExam').value;
  if(iExam<0 && !target){ toast('请先选择目标考试'); return; }
  var selCls = $('scoreCls') ? $('scoreCls').value.trim() : '';
  /* 只导一个班但没选班级 → 明确拦下，避免成绩混进两个班让人看不懂 */
  var n=0, warn=0, nAbs=0, nGr=0, skipped=[];
  if(iC<0 && !selCls){
    var multi = {};                     // 该学号出现在几个班
    if(iStu>=0){
      p.rows.forEach(function(r){
        var id=r[iStu]; if(!id) return;
        DB.students.forEach(function(s){ if(String(s.id)===String(id)) multi[id]=1; });
      });
    }
    var multiCnt = Object.keys(multi).length;
    if(multiCnt>0){
      toast('请先选择「本次成绩属于哪个班」—— 有 '+multiCnt+' 个学号在多个班都存在');
      return;
    }
  }
  p.rows.forEach(function(r){
    var sid=iStu>=0?r[iStu]:null;
    var rowCls = iC>=0 ? r[iC] : selCls;
    var s = matchScoreStudent(sid, iName>=0?r[iName]:null, rowCls);
    if(!s){
      if(sid && studentById(sid) && skipped.indexOf(sid)<0) skipped.push(sid);
      warn++; return;
    }
    var e;
    if(iExam>=0){
      var en=r[iExam];
      e = DB.exams.filter(function(x){ return x.name===en; })[0];
      if(!e){
        e={id:uid('e'), name:en, date:'', type:'月考', fullScore:(iFs>=0?(Number(r[iFs])||100):100)};
        DB.exams.push(e);
      }
    } else {
      e = examById(target);
    }
    if(!e){ warn++; return; }
    /* 把这次导入的班级记在考试上 —— 分析页据此显示"这是哪个班的成绩"。
       跨班考试（e.cls 已有多个班）不要再覆盖，只在缺这一个班时补上。 */
    if(selCls && examClsList(e).indexOf(selCls)<0){
      e.cls = examClsList(e).concat([selCls]).join(',');
    }
    /* 单元格写「缺考」/ 留空 → 记成缺考，绝不当 0 分（会把班级均分拉低） */
    var parsed = parseScoreCell(r[iScore]);
    var grRaw = (iGr>=0 && !parsed.absent) ? String(r[iGr]||'').trim() : '';
    var grNum = Number(grRaw);
    var hasGr = !!grRaw && !isNaN(grNum) && grNum>0;
    var rec={studentId:s.key, examId:e.id, score:parsed.score, absent:parsed.absent,
      classRank:(parsed.absent?'':iCr>=0?r[iCr]:''), gradeRank:(parsed.absent?'':grRaw),
      /* 表里有年级排名 → 认定是学校给的真实名次，标成 'school'，
         之后 autoRank 就不会再覆盖它。 */
      rkSrc:(hasGr?'school':'')};
    var ex = DB.scores.filter(function(x){ return x.studentId===s.key && x.examId===e.id; })[0];
    if(ex){ Object.keys(rec).forEach(function(k){ ex[k]=rec[k]; }); }
    else { DB.scores.push(rec); }
    if(parsed.absent) nAbs++;
    if(hasGr) nGr++;
    n++;
  });
  if(selCls) SCORE_CLS = selCls;          // 记住，下次导另一个班直接切换
  saveDB(); renderScores();
  var msg = '成绩导入 '+n+' 条' + (selCls ? '（'+selCls+'班）' : '') + '，跳过 '+warn+' 条'
    + (nAbs ? '，其中缺考 '+nAbs+' 人（不计入班级统计）' : '');
  /* 年级排名：读到要说读到多少条；没读到列也要说一声，
     否则老师会以为"表里明明有排名怎么系统没显示"。 */
  if(nGr) msg += '，含年级排名 '+nGr+' 条';
  else if(iGr<0) msg += '，本表没有「年级排名」列';
  else msg += '，「年级排名」列全部为空';
  if(skipped.length){
    msg += '（其中 '+skipped.length+' 个学号跨班无法确定，已跳过。请选择「本次成绩属于哪个班」后重导）';
  }
  toast(msg);
}

/* ===========================================================
   补充年级排名 —— 给已录好的考试事后补填年级名次

   为什么需要这个功能：
   老师往往是先录了整场考试成绩，几天后学校才公布年级排名。
   这时如果重新导入整份成绩表，会把已有分数覆盖一遍（风险大）；
   而用「网页内逐条补录」一个个手填，50 个人 × 几场考试根本不现实。

   这个工具只做一件事：按「目标考试」把名次写进去。
     · 不碰分数、不碰班排、不碰缺考标记 —— 已有成绩一律原样保留
     · 已经填过年级排名的，默认不覆盖（除非勾选「覆盖」），防止误操作丢数据
     · 没名次就跳过，不会凭空造数据
   =========================================================== */
function renderGradeRankImportCard(){
  var h = '<div class="card"><h2>补充年级排名（给已录好的考试后补名次）</h2>'
    +'<p class="hint">先在下面<b>导入成绩</b>里录好整场考试，之后学校公布年级排名了，在这里补填即可 —— '
    +'本工具<b>只写年级排名，不会动分数和班排</b>。<br>'
    +'表格列名：<b>学号、年级排名</b>（可选<b>姓名</b>用于人工核对、<b>班级</b>用于两个班学号重复时消歧）。'
    +'两个班学号会重复，所以表里带上班级列最稳妥。</p>'
    +'<div class="row">'
    +'<div class="field"><label>补哪场考试 *</label><select id="gr_exam">'
    +'<option value="">— 请选择目标考试 —</option>'
    +examsSorted().map(function(e){
      /* 下拉里直接标出"已有几个名次 / 共几个人"，补名次时不用来回切页核对 */
      var tot = DB.scores.filter(function(x){ return x.examId===e.id; }).length;
      var got = DB.scores.filter(function(x){ return x.examId===e.id && hasSchoolGradeRank(x); }).length;
      var mark = tot===0 ? '（未录成绩）' : (got===0 ? '（有名次 0/'+tot+'）' : got<tot ? '（有名次 '+got+'/'+tot+'）' : '');
      return '<option value="'+esc(e.id)+'">'+esc(examOptionLabel(e))+'（已录 '+tot+' 人）'+mark+'</option>';
    }).join('')
    +'</select></div>'
    +'<div class="field"><label>匹配不到学号时按</label><select id="gr_defcls">'
    +'<option value="">（不按班级猜，只按学号）</option>'
    +allClasses().map(function(c){ return '<option value="'+esc(c)+'">'+esc(c)+'班</option>'; }).join('')
    +'</select></div>'
    +'<label style="display:flex;align-items:center;gap:6px;margin:0;white-space:nowrap;">'
    +'<input type="checkbox" id="gr_over" style="width:auto"> 覆盖已填的名次</label>'
    +'</div>'
    +'<div class="row"><textarea id="grText" placeholder="在这里粘贴 Excel 数据（学号&#9;年级排名）…"></textarea></div>'
    +'<div class="row"><button onclick="previewGradeRankImport()">解析预览</button> '
    +fileBtn('选择CSV/TXT文件','.csv,.txt',"fileToText('grText',this)")+' '
    +fileBtn('选择Excel(.xlsx/.xlsm)','.xlsx,.xlsm',"fileToXlsm('gr',this)")+'</div>'
    +'<div id="grPreview"></div></div>';
  return h;
}

/* 把表格行解析成「要写名次的目标列表」，并记录各种异常供预览展示。
   返回 {ok:[…], skipNoScore:[], skipDup:[], skipBlank:[], skipOver:[]}
   每项 ok：{student, rank} */
function analyzeGradeRankImport(){
  var p = parseTable($('grText').value);
  if(!p) return null;
  var iStu = headKey(p.headers,['学号','考号']), iName = headKey(p.headers,['姓名']),
      iGr   = headKey(p.headers,['年级排名','年级名次','年名次']), iC = headKey(p.headers,['班级']);
  if(iStu<0 && iName<0) return {err:'表格里找不到「学号」列，也没有「姓名」列，无法确定是谁的成绩。'};
  if(iGr<0) return {err:'表格里找不到「年级排名」列。需要「学号 + 年级排名」两列。'};

  var eid = $('gr_exam').value;
  if(!eid) return {err:'请先选择要补哪一场考试。'};
  var defCls = $('gr_defcls').value;
  var overwrite = $('gr_over') && $('gr_over').checked;

  var res = {ok:[], skipNoScore:[], skipDup:[], skipBlank:[], skipOver:[], noRankYet:0};
  var seen = {};
  p.rows.forEach(function(r){
    var sid = iStu>=0 ? String(r[iStu]||'').trim() : '';
    var nm  = iName>=0 ? String(r[iName]||'').trim() : '';
    if(!sid && !nm) return;
    /* 匹配学生：优先「学号+班级」，其次按默认班级，最后纯学号（仅当全库唯一） */
    var rowCls = iC>=0 ? String(r[iC]||'').trim() : defCls;
    var s = null;
    if(sid && rowCls) s = studentByIdCls(sid, rowCls);
    if(!s && sid) s = matchScoreStudent(sid, nm||null, rowCls);
    if(!s && nm){
      var byName = DB.students.filter(function(x){ return x.name===nm; });
      if(byName.length===1) s = byName[0];
    }
    if(!s){ (res.skipDup||(res.skipDup=[])).push(sid||nm); return; }

    var raw = String(r[iGr]||'').trim();
    if(!raw){ res.skipBlank.push({sid:s.id, name:s.name, cls:s.cls}); return; }
    var v = Number(raw);
    if(isNaN(v) || v<=0){ res.skipBlank.push({sid:s.id, name:s.name, cls:s.cls}); return; }
    /* 偶尔会看到「280.5」这种并列名次，取整再存，避免界面上出现"第280.5名" */
    v = Math.round(v);

    /* 同一张表里出现两次同一个学生 → 后者覆盖前者，但要提示 */
    if(seen[s.key]){ res.skipDup.push(s.id); }
    seen[s.key] = 1;

    /* 这场考试里根本没有这个人的成绩 → 不硬塞（那会造出一条没分数的脏记录） */
    var sc = DB.scores.filter(function(x){ return x.studentId===s.key && x.examId===eid; })[0];
    if(!sc){ res.skipNoScore.push({sid:s.id, name:s.name, cls:s.cls}); return; }
    /* 已有学校名次且没勾覆盖 → 保护，不动 */
    if(!overwrite && hasSchoolGradeRank(sc)){ res.skipOver.push({sid:s.id, name:s.name, cls:s.cls, old:gradeRankNum(sc)}); return; }
    if(!hasSchoolGradeRank(sc)) res.noRankYet++;
    res.ok.push({s:s, rank:v, old:sc.rkSrc==='auto'?gradeRankNum(sc):null});
  });
  res.eid = eid;
  return res;
}

function previewGradeRankImport(){
  var box = $('grPreview');
  var res = analyzeGradeRankImport();
  if(!res){ box.innerHTML='<p class="err">没有可解析的数据，请先粘贴或选择文件。</p>'; return; }
  if(res.err){ box.innerHTML='<p class="err">'+esc(res.err)+'</p>'; return; }

  var e = examById(res.eid);
  var h = '';
  if(res.ok.length){
    h += '<p class="ok-t">可写入 <b>'+res.ok.length+'</b> 条年级排名（考试：'+esc(e?e.name:'')+'）。'
      + '其中 <b>'+res.noRankYet+'</b> 条是原本空着的，'
      + (res.ok.length-res.noRankYet)+' 条会覆盖已有名次。已有分数、班排、缺考标记均不受影响。</p>';
    h += '<table><thead><tr><th>学号</th><th>姓名</th><th>班级</th><th>现有年排</th><th>将写入</th></tr></thead><tbody>';
    res.ok.slice(0,200).forEach(function(o){
      h += '<tr><td>'+esc(o.s.id)+'</td><td><b>'+esc(o.s.name)+'</b></td><td>'+esc(o.s.cls||'—')+'</td>'
        +'<td>'+(o.old!=null?'<span class="muted">≈'+o.old+'（本地）</span>':'<span class="muted">—</span>')+'</td>'
        +'<td><b style="color:#7c3aed">'+o.rank+'</b></td></tr>';
    });
    h += '</tbody></table>';
    if(res.ok.length>200) h += '<p class="hint">（表格太长，只预览前 200 条，确认后仍会全部写入 '+res.ok.length+' 条）</p>';
    h += '<div class="row"><button onclick="doImportGradeRank()">确认写入 '+res.ok.length+' 条</button></div>';
  } else {
    h += '<p class="err">没有可写入的年级排名。</p>';
  }
  /* 各类跳过原因都要说清楚，尤其"这场考试没这个人的成绩"——
     最可能是选错了考试，或名次表里混进了别的考试的人。 */
  if(res.skipNoScore && res.skipNoScore.length){
    h += '<p class="err">⚠ <b>'+res.skipNoScore.length+'</b> 人在这场考试里<b>没有成绩记录</b>，已跳过：'
      + esc(res.skipNoScore.slice(0,20).map(function(x){return x.name+'('+x.cls+' '+x.sid+')';}).join('、'))
      + (res.skipNoScore.length>20?' …':'')
      + '<br>请确认是否选错了考试，或名次表里混进了这场考试没有的学生。</p>';
  }
  if(res.skipOver && res.skipOver.length){
    h += '<p class="hint"><b>'+res.skipOver.length+'</b> 人已填过学校年级排名，默认保留未改（'
      + esc(res.skipOver.slice(0,15).map(function(x){return x.name+'('+x.old+')';}).join('、'))
      + (res.skipOver.length>15?' …':'')
      + '）。确实要改请勾选「覆盖已填的名次」。</p>';
  }
  if(res.skipBlank && res.skipBlank.length){
    h += '<p class="hint">' + res.skipBlank.length + ' 行年级排名为空或不是正整数，已跳过（不算「没有排名」，只是这次没填）。</p>';
  }
  if(res.skipDup && res.skipDup.length){
    h += '<p class="hint">' + res.skipDup.length + ' 行没能确定是哪位学生（可能学号重复且表里没班级列），已跳过。'
      + '建议在表格里加上「班级」列。</p>';
  }
  box.innerHTML = h;
}

function doImportGradeRank(){
  var res = analyzeGradeRankImport();
  if(!res || res.err || !res.ok.length){ toast('没有可写入的数据，请先解析预览'); return; }
  var n = 0;
  res.ok.forEach(function(o){
    var sc = DB.scores.filter(function(x){ return x.studentId===o.s.key && x.examId===res.eid; })[0];
    if(!sc) return;
    sc.gradeRank = String(o.rank);
    /* 标记为学校给的真实名次 —— 之后 autoRank 就不会再覆盖它 */
    sc.rkSrc = 'school';
    n++;
  });
  saveDB();
  /* renderScores() 会重建整个页面，补充工具里的下拉和文本框都会被清空，
     所以先把用户填的内容和选中的考试记下来，重建后再放回去 ——
     否则刚导入完，预览区就变成"请先选择目标考试"，让人以为没成功。 */
  var keepExam = res.eid, keepText = $('grText') ? $('grText').value : '',
      keepOver = $('gr_over') ? $('gr_over').checked : false,
      keepDef = $('gr_defcls') ? $('gr_defcls').value : '';
  renderScores();
  if($('gr_exam')) $('gr_exam').value = keepExam;
  if($('gr_defcls')) $('gr_defcls').value = keepDef;
  if($('gr_over')) $('gr_over').checked = keepOver;
  if($('grText')) $('grText').value = keepText;
  previewGradeRankImport();
  var e = examById(keepExam);
  toast('已写入 '+n+' 条年级排名（'+(e?e.name:'')+'），可在学生档案查看走势');
}

function saveScore(){
  var sid=$('s_stu').value, eid=$('s_exam').value;
  if(!sid||!eid){ toast('请先选择学生和考试'); return; }
  var ab = $('s_absent') && $('s_absent').checked;
  /* 缺考时分数强制归 0（不参与统计，但字段得有值，别留 NaN） */
  var grV = ab ? '' : String($('s_gr').value||'').trim();
  var grN = Number(grV);
  var rec={studentId:sid, examId:eid, absent:ab,
    score: ab ? 0 : (Number($('s_score').value)||0),
    classRank: ab ? '' : $('s_cr').value, gradeRank: grV,
    /* 手填的年级排名同样视为学校给的（老师从别处抄来的），保护不被 autoRank 覆盖 */
    rkSrc: (!ab && grV && !isNaN(grN) && grN>0) ? 'school' : ''};
  var sc = DB.scores.filter(function(x){ return x.studentId===sid && x.examId===eid; })[0];
  if(sc){ Object.keys(rec).forEach(function(k){ sc[k]=rec[k]; }); }
  else DB.scores.push(rec);
  saveDB(); toast(ab ? '已标记为缺考（不计入班级统计）' : '成绩已保存'); renderScores();
}

/* ---------- 考试管理 ---------- */
function renderExams(){
  var clsList = allClasses();
  var h = '<div class="card"><h2>新增考试</h2>'
    +'<p class="hint">一次导一个班的成绩时，可以先在这里建考试并指定班级，导入时就不用重复选了。<br>'
    +'两个班考同一份卷子时，按住 Ctrl（Mac 是 ⌘）<b>多选</b>即可。</p><div class="row">'
    +'<div class="field" style="width:220px"><label>考试名称 *</label><input id="e_name" placeholder="如 3月月考"></div>'
    +'<div class="field" style="margin:0;width:180px"><label>属于哪个班（可多选）</label>'
    +'<select id="e_cls" multiple size="'+(clsList.length>3?4:Math.max(2,clsList.length+1))+'" style="width:100%">'
    +clsList.map(function(c){ return '<option value="'+esc(c)+'"'+(SCORE_CLS===c?' selected':'')+'>'+esc(c)+'班</option>'; }).join('')
    +'</select></div>'
    +'<div class="field"><label>日期</label><input id="e_date" type="date"></div>'
    +'<div class="field"><label>类型</label><select id="e_type"><option>月考</option><option>期中</option><option>期末</option><option>随堂</option><option>其他</option></select></div>'
    +'<div class="field"><label>满分</label><input id="e_fs" style="width:90px" value="100"></div>'
    +'<button onclick="addExam()">添加考试</button></div></div>';

  h += '<div class="card"><h2>考试列表（'+DB.exams.length+'）</h2>'
    +'<p class="hint">「班级」列显示这场考试的成绩来自哪个班 —— 导入成绩时选了班级就会自动标上。'
    +'「实考 / 缺考」里的缺考人数不计入任何统计。</p>'
    +'<table><thead><tr><th>名称</th><th>班级</th><th>日期</th><th>类型</th><th>满分</th>'
    +'<th>实考</th><th>缺考</th><th>年级排名</th><th>操作</th></tr></thead><tbody>';
  if(!DB.exams.length) h += '<tr><td colspan="9" class="muted" style="text-align:center;padding:22px;">暂无考试，请先添加。</td></tr>';
  examsSorted().forEach(function(e){
    var so = statOf(e.id);
    var c = so ? so.total : 0, nAbs = so ? so.absent : 0;
    var cs = examClasses(e.id);
    var set = examClsList(e);          // 建考试/导入时指定的班级（可能多个）
    /* 这场考试有多少人已经拿到学校年级排名 —— 用来提示"这场还缺名次" */
    var nGrTot = DB.scores.filter(function(x){ return x.examId===e.id && !x.absent; }).length;
    var nGr = DB.scores.filter(function(x){ return x.examId===e.id && hasSchoolGradeRank(x); }).length;
    var clsTxt;
    /* 优先显示建考试时指定的班级；没成绩也能看到。
       有成绩但跨了多个班时如实提示，避免"只显示一个班"让人误解。 */
    if(cs.length===1){
      clsTxt = '<span class="tag">'+esc(cs[0])+'班</span>'
             + (set.length===1 && set[0]!==cs[0] ? ' <span class="muted" title="建考试时选的是 '+esc(set[0])+'班">（建时选'+esc(set[0])+'）</span>' : '');
    } else if(cs.length>1){
      clsTxt = '<span class="muted" title="成绩来自：'+esc(cs.join('、'))+'班">'+esc(cs.length)+' 个班</span>';
    } else if(set.length>1){
      clsTxt = '<span class="tag" title="建考试时指定的班级，尚未导入成绩">'+esc(set.join('+'))+'班</span>';
    } else if(set.length===1){
      clsTxt = '<span class="tag" title="建考试时指定的班级，尚未导入成绩">'+esc(set[0])+'班</span>';
    } else {
      clsTxt = '<span class="muted">—</span>';
    }
    /* 名册只接受单个班；这场考试跨多班时传空 = 两个班的名册都列出来 */
    var rosterCls = set.length===1 ? set[0] : '';
    h += '<tr><td>'+esc(e.name)+'</td><td>'+clsTxt+'</td><td>'+esc(e.date||'—')+'</td><td>'+esc(e.type)+'</td><td>'+esc(e.fullScore)+'</td>'
      +'<td>'+(c || '<span class="muted">0</span>')+'</td>'
      +'<td>'+(nAbs ? '<span style="color:#b45309">'+nAbs+'</span>' : '<span class="muted">0</span>')+'</td>'
      +'<td>'+(nGrTot===0 ? '<span class="muted">—</span>'
        : nGr===0 ? '<span class="err">缺</span>'
        : nGr<nGrTot ? '<span style="color:#b45309">'+nGr+'/'+nGrTot+'</span>'
        : '<span class="ok-t">'+nGr+'/'+nGrTot+'</span>')+'</td>'
      +'<td><button class="sm" onclick="gotoRoster(\''+esc(e.id)+'\',\''+esc(rosterCls)+'\')">名册</button> '
      +'<button class="sm '+(nGr<nGrTot?'bwarn':'ghost')+'" onclick="jumpGradeRankImport(\''+esc(e.id)+'\')" '
        +'title="学校公布年级排名后，在这里补填；只写名次，不会动分数">补名次</button> '
      +'<button class="sm ghost" onclick="editExamCls(\''+esc(e.id)+'\')">改班级</button> '
      +'<button class="sm ghost" onclick="showDist(\''+esc(e.id)+'\')">分布图</button> '
      +'<button class="sm ghost" onclick="addEventForExam(\''+esc(e.name)+'\',\''+esc(e.date||'')+'\')">加入倒计时</button> '
      +'<button class="sm danger" onclick="delExam(\''+esc(e.id)+'\')">删除</button></td></tr>';
  });
  h += '</tbody></table><div class="row" style="margin-top:12px">'
    +'<button class="ghost" onclick="autoRank()">自动计算排名</button>'
    +'<span class="muted">班排全部重算；年排只填<b>没有学校名次</b>的场次（本地约两个班的尺度），学校给的名次一律保留。</span></div></div>';

  /* 从考试列表直接跳到「补充年级排名」并选中这场考试 */
  h += '<div class="card"><h2>年级排名还没补齐？</h2>'
    +'<p class="hint">点上表任意一场考试的「<b>补名次</b>」，会跳到「成绩录入」页下方的补充工具并自动选中这场考试。<br>'
    +'「年级排名」列显示的是「已有学校名次的人数 / 实考人数」：'
    +'<span class="err">缺</span> 表示一个都还没有，<span style="color:#b45309">20/48</span> 表示只补了一部分，'
    +'<span class="ok-t">48/48</span> 表示齐了。<b>这场考试本来就不公布年级排名的话，忽略这一列即可</b>，'
    +'它不影响任何统计。</p>'
    +'<div class="row"><button class="ghost" onclick="goSec(\'scores\')">去补充年级排名</button></div></div>';
  h += '<div id="distBox"></div>';
  $('content').innerHTML = h;
}

/* 从考试列表点「补名次」跳到成绩录入页的补充工具，并选中这场考试 */
function jumpGradeRankImport(examId){
  goSec('scores');
  var sel = $('gr_exam');
  if(sel){
    sel.value = examId;
    var box = $('grText');
    if(box && box.scrollIntoView) box.scrollIntoView({behavior:'smooth', block:'center'});
    box && box.focus();
  } else {
    toast('请稍候，页面还在加载');
  }
}

/* 从考试列表点「名册」跳到成绩录入页并定位到这场考试 */
function gotoRoster(examId, cls){
  ROSTER_EXAM = examId;
  ROSTER_CLS = cls || '';
  goSec('scores');
  var se = $('ro_exam'); if(se) se.value = examId;
  var sc = $('ro_cls');  if(sc) sc.value = ROSTER_CLS;
  renderRoster();
  var box = $('rosterBox');
  if(box && box.scrollIntoView) box.scrollIntoView({behavior:'smooth', block:'center'});
}

function addExam(){
  var name = $('e_name').value.trim();
  /* e_cls 是多选下拉：把所有选中的班拼成 "715,716" 存起来 */
  var picked = selectedExamCls();
  var cls = picked.join(',');
  if(!name){ toast('请填写考试名称'); return; }
  /* 同名考试：同名但班级不同也允许（两个班各考一场同名试很常见） */
  if(cls){
    if(DB.exams.some(function(e){ return e.name===name && examClsList(e).join(',')===cls; })){
      toast('已存在「'+name+'」（'+picked.join('+')+'班），请换个名称或班级'); return;
    }
  } else if(DB.exams.some(function(e){ return e.name===name; })){
    toast('同名考试已存在'); return;
  }
  DB.exams.push({id:uid('e'), name:name, cls:cls, date:$('e_date').value,
    type:$('e_type').value, fullScore:Number($('e_fs').value)||100});
  if(picked.length===1) SCORE_CLS = picked[0];
  saveDB(); renderExams(); toast('已添加'+(cls?'（'+picked.join('+')+'班）':''));
}

/* 读「新增考试」里多选下拉勾中的班级 */
function selectedExamCls(){
  var sel = $('e_cls');
  if(!sel) return [];
  return Array.prototype.filter.call(sel.options, function(o){ return o.selected; })
    .map(function(o){ return o.value; });
}

/* 已建好的考试要改班级（比如「第一次月考」想同时算715+716） */
function editExamCls(id){
  var e = examById(id); if(!e) return;
  var cur = examClsList(e), all = allClasses();
  if(!all.length){ toast('学生档案里还没有班级信息，先去「学生档案」补上班级'); return; }
  var h = '<h3>改「'+esc(e.name)+'」的班级</h3>'
    +'<p class="hint" style="margin:0 0 10px">按住 Ctrl（Mac 是 ⌘）可多选。两个班考同一份卷子，就同时勾上这两个班。<br>'
    +'这里只是标注这场考试涉及哪几个班；实际统计仍以导入的成绩为准。</p>'
    +'<div class="row" style="margin-bottom:6px">'
    +'<label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer">'
    +'<input type="checkbox" id="ecAll"'+(cur.length===all.length?' checked':'')+' onchange="toggleAllExamCls(this.checked)"> 全选</label></div>'
    +'<div class="row" style="gap:14px">'
    +all.map(function(c){
        return '<label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer">'
          +'<input type="checkbox" class="ecBox" value="'+esc(c)+'"'+(cur.indexOf(c)>=0?' checked':'')+'> '+esc(c)+'班</label>';
      }).join('')
    +'</div>'
    +'<div class="row"><button onclick="saveExamCls(\''+esc(id)+'\')">保存</button> '
    +'<button class="ghost" onclick="closeModal()">取消</button></div>';
  openModal(h);
}
function toggleAllExamCls(on){
  Array.prototype.forEach.call(document.querySelectorAll('.ecBox'), function(b){ b.checked = on; });
}
function saveExamCls(id){
  var e = examById(id); if(!e) return;
  var picked = Array.prototype.filter.call(document.querySelectorAll('.ecBox'), function(b){ return b.checked; })
    .map(function(b){ return b.value; });
  e.cls = picked.join(',');
  saveDB(); closeModal(); renderExams();
  toast(picked.length ? '已设为 '+picked.join('+')+' 班的考试' : '已清空班级（暂不指定）');
}
function delExam(id){
  if(!confirm('删除该考试？相关成绩也会删除。')) return;
  DB.exams = DB.exams.filter(function(e){ return e.id!==id; });
  DB.scores = DB.scores.filter(function(sc){ return sc.examId!==id; });
  saveDB(); renderExams();
}
function addEventForExam(name, date){
  if(!date){ toast('该考试没有日期，无法加入倒计时'); return; }
  DB.events.push({id:uid('ev'), title:name, date:date, type:'考试', note:''});
  saveDB(); toast('已加入日程提醒');
}
function showDist(id){ $('distBox').innerHTML = '<div class="card"><h2>'+(showRate()?'得分率段分布':'分数段分布')+'</h2>'+histChart(id)+'</div>'; }

/* 自动排名：缺考的人不参与排名（否则会占掉一个名次，
   还可能因为 score=0 排到最后，把真实考生的名次整体挤下去）。

   ⚠ 关键约束：学校给的年级排名（rkSrc==='school'）绝不能被覆盖。
   本地算出来的名次只在手上这几个班（约 100 人）里成立，
   学校名次是全年级（几百人）的真实名次，量级完全不同。
   两者混用会得出完全错误的结论，而且原值一旦被覆盖就找不回来了。
   所以这里只为「没有学校名次」的记录写年级排名，并统计跳过了多少条。 */
function autoRank(){
  var keptSchool = 0, written = 0;
  DB.exams.forEach(function(e){
    var all = DB.scores.filter(function(x){ return x.examId===e.id && !x.absent; })
      .map(function(x){ return {sc:x, s:studentByKey(x.studentId)}; })
      .filter(function(o){ return o.s; });
    /* 已有学校名次的先摘出来，本地算完再放回去 */
    var free = all.filter(function(o){ return o.sc.rkSrc!=='school'; });
    keptSchool += all.length - free.length;
    free.slice().sort(function(a,b){ return Number(b.sc.score)-Number(a.sc.score); })
      .forEach(function(o,i){ o.sc.gradeRank = i+1; o.sc.rkSrc = 'auto'; written++; });
    /* 缺考的人清掉名次，免得留着上次的旧名次造成误解 */
    DB.scores.filter(function(x){ return x.examId===e.id && x.absent; })
      .forEach(function(x){ x.classRank=''; x.gradeRank=''; x.rkSrc=''; });
    /* 班级排名本地总能算（班内名次，参照系就是本班），照旧全量写 */
    var byClass = {};
    all.forEach(function(o){ (byClass[o.s.cls] = byClass[o.s.cls]||[]).push(o); });
    Object.keys(byClass).forEach(function(k){
      byClass[k].sort(function(a,b){ return Number(b.sc.score)-Number(a.sc.score); });
      byClass[k].forEach(function(o,i){ o.sc.classRank = i+1; });
    });
  });
  saveDB(); renderExams();
  toast('排名已计算：班排全部重算，年排写入 '+written+' 条'
    + (keptSchool ? '；'+keptSchool+' 条学校年级排名已保留未覆盖' : '')
    + '（缺考者不参与排名）');
}

/* ---------- 临界生名单 ---------- */
function renderBorderline(){
  var clsList = allClasses();
  if(stuCls && clsList.indexOf(stuCls)<0) stuCls = '';
  var all = DB.students;
  var cntOf = function(c){ return c ? all.filter(function(s){ return String(s.cls)===String(c); }).length : all.length; };

  var h = '<div class="card"><h2>临界生名单</h2>'
    +'<p class="hint">默认列出「手动标记为临界生」的学生；勾选下方选项可按分数线额外筛选（任一次考试低于该分数即列入）。</p>'
    +'<div class="tabs">'
    +'<span class="tab'+(!stuCls?' on':'')+'" onclick="setStuCls(\'\')">全部班级</span>'
    +clsList.map(function(c){
      return '<span class="tab'+(stuCls===c?' on':'')+'" onclick="setStuCls(\''+esc(c)+'\')">'+esc(c)+'班 '+cntOf(c)+'</span>';
    }).join('')
    +'</div>'
    +'<div class="row">'
    +'<label style="display:flex;align-items:center;gap:6px;margin:0;"><input type="checkbox" id="bl_use" style="width:auto" '+(BL_USE?'checked':'')+' onchange="BL_USE=this.checked;renderBorderline()"> 同时显示低于分数线者</label>'
    +'<input id="bl_line" style="width:110px" value="'+esc(BL_LINE)+'" onchange="BL_LINE=this.value;renderBorderline()"> <span class="muted">分</span></div>';
  var line = Number(BL_LINE)||0;
  var lowIds = {};
  /* 缺考不算「低于分数线」——没考不是考砸，不能因此被列为临界生 */
  if(BL_USE) DB.scores.forEach(function(sc){ if(!sc.absent && Number(sc.score)<line) lowIds[sc.studentId]=1; });
  var list = DB.students.filter(function(s){
    /* 注意 lowIds 是按内部 key 存的（两个班学号会重号），
       这里必须用 s.key 去查，不能用 s.id —— 否则查不到 */
    return s.isBorderline || lowIds[s.key];
  });
  if(stuCls) list = list.filter(function(s){ return String(s.cls)===String(stuCls); });
  if(stuSort==='critical') list.sort(function(a,b){ return (b.isBorderline?1:0)-(a.isBorderline?1:0) || natCmp(a.id,b.id); });

  h += '<table><thead><tr><th>学号</th><th>姓名</th><th>班级</th><th>是否为临界生</th><th>薄弱知识点</th>'
    +'<th>'+(showRate()?'最低得分率':'最低分')+'</th><th>操作</th></tr></thead><tbody>';
  if(!list.length) h += '<tr><td colspan="7" class="muted" style="text-align:center;padding:22px;">暂无临界生。</td></tr>';
  list.forEach(function(s){
    var R = showRate();
    /* 得分率模式下取「历次最低得分率」而不是「历次最低分」——
       各场满分不同，原始低分可能是满分低的场次拉出来的假象。
       缺考直接跳过：没考的人不该有「最低分」。 */
    var minTxt = '—', minVal = null, nAbs=0;
    DB.scores.forEach(function(x){
      if(String(x.studentId)!==String(s.key)) return;
      if(x.absent){ nAbs++; return; }
      var r = rateOf(Number(x.score)||0, fullScoreOf(x.examId));
      if(minVal===null || r<minVal){
        minVal = r;
        minTxt = R ? (Math.round(r*10)/10)+'%' : String(Number(x.score)||0);
        if(R) minTxt += '<br><span class="muted" style="font-size:11px">'+x.score+'/'+fullScoreOf(x.examId)+'</span>';
      }
    });
    if(nAbs) minTxt += '<br><span class="muted" style="font-size:11px">缺考 '+nAbs+' 次（不计）</span>';
    h += '<tr><td>'+esc(s.id)+'</td><td>'+esc(s.name)+'</td><td>'+esc(s.cls)+'</td>'
      +'<td><button class="sm '+(s.isBorderline?'bwarn':'ghost')+'" onclick="toggleBL(\''+esc(s.key)+'\');renderBorderline()">'+(s.isBorderline?'★ 临界生':'☆ 设为临界')+'</button></td>'
      +kpCellHtml(s)+'<td>'+minTxt+'</td>'
      +'<td><button class="sm" onclick="openProfile(\''+esc(s.key)+'\')">档案</button> '
      +'<button class="sm ghost" onclick="addTodoForStudent(\''+esc(s.name)+'\',\''+esc(s.key)+'\')">加入待办</button></td></tr>';
  });
  h += '</tbody></table></div>';
  h += '<datalist id="kpPoolList">' + kpPoolOptions() + '</datalist>';
  $('content').innerHTML = h;
}
var BL_USE = false, BL_LINE = '72';

/* ---------- 薄弱知识点统计 ---------- */
function renderKpStats(){
  var cnt = {};
  DB.students.forEach(function(s){ s.kpTags.forEach(function(t){ if(t) cnt[t]=(cnt[t]||0)+1; }); });
  var arr = Object.keys(cnt).map(function(k){ return [k,cnt[k]]; }).sort(function(a,b){ return b[1]-a[1]; });
  var h = '<div class="card"><h2>薄弱知识点统计（按学生人次）</h2>';
  if(!arr.length) h += '<div class="empty">暂无标签数据。请到学生档案中为学生添加薄弱知识点标签。</div>';
  else {
    var max = arr[0][1];
    arr.forEach(function(kv){
      h += '<div class="kpbar"><span class="name">'+esc(kv[0])+'</span>'
        +'<span class="track"><span class="fill" style="width:'+(kv[1]/max*100)+'%"></span></span>'
        +'<span class="cnt">'+kv[1]+' 人</span></div>';
    });
  }
  h += '</div>';
  if(DB.kpPool.length){
    h += '<div class="card"><h2>知识点标签库（'+DB.kpPool.length+' 个，自动收集）</h2><div>'
      + DB.kpPool.map(function(t){ return '<span class="tag">'+esc(t)+'</span>'; }).join('') + '</div></div>';
  }
  $('content').innerHTML = h;
}
