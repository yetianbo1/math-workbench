/* ===========================================================
   students.js —— 学生档案（列表 / 详情 / 编辑 / 临界生 / 薄弱知识点）
   按班级分开管理：顶部班级页签（全部 / 715 / 716…），班级来自学生档案的"班级"字段
   「薄弱知识点」列支持格内直接点着输入，不用进编辑弹窗
   =========================================================== */
var stuSort = 'critical';
var stuCls = '';        // 当前选中的班级，空 = 全部
var selStudent = null;

/* ===========================================================
   renderStudents() —— 整页渲染（含搜索框、排序、页签、表格）
   搜索时走 refreshStuList()，只换表格那块，搜索框原地不动。
   原因：整页 innerHTML 重写会把正在打字的 input 元素销毁，
        焦点一丢拼音输入法的候选组态就被打断（表现为"打字卡住"）。
   =========================================================== */
function renderStudents(){
  if(selStudent){ renderProfile(selStudent); return; }
  var q = stuQuery();
  var all = DB.students.slice();

  /* 班级页签：数据里出现过哪些班就显示哪些 */
  var classes = allClasses();
  if(stuCls && classes.indexOf(stuCls)<0) stuCls = '';   // 班没了则回到全部
  var cntOf = function(c){ return c ? all.filter(function(s){ return String(s.cls)===String(c); }).length : all.length; };

  var h = '<div class="card"><div class="row">'
    +'<input class="search" id="searchIn" placeholder="搜索姓名或学号" value="'+esc(q)+'">'
    +'<div class="field" style="margin:0;width:150px"><label>排序方式</label><select id="sortMode" onchange="stuSort=this.value;renderStudents()">'
    +'<option value="critical"'+(stuSort==='critical'?' selected':'')+'>临界生优先</option>'
    +'<option value="id"'+(stuSort==='id'?' selected':'')+'>学号</option>'
    +'<option value="name"'+(stuSort==='name'?' selected':'')+'>姓名</option>'
    +'<option value="cls"'+(stuSort==='cls'?' selected':'')+'>班级</option>'
    +'</select></div>'
    +'<button class="ghost" onclick="showAddStudent()">+ 新增学生</button>'
    +'<button class="ghost" onclick="goSec(\'scores\')">批量导入</button>'
    +'<button class="danger" onclick="delAllStudents()">'
      +(stuCls ? '删除'+esc(stuCls)+'班全部学生' : '批量删除所有学生')+'</button>'
    +'</div>';

  /* 班级页签 */
  h += '<div class="tabs">'
    +'<span class="tab'+(!stuCls?' on':'')+'" onclick="setStuCls(\'\')">全部 '+cntOf('')+'</span>'
    +classes.map(function(c){
      return '<span class="tab'+(stuCls===c?' on':'')+'" onclick="setStuCls(\''+esc(c)+'\')">'+esc(c)+'班 '+cntOf(c)+'</span>';
    }).join('')
    +'</div>';

  /* 表格单独装在 stuList 里，搜索时只换这一块（知识点提示池也跟着一块走） */
  h += '<div id="stuList">' + stuTableHtml() + '</div>';
  h += '</div>';
  $('content').innerHTML = h;
  bindStuSearch();
}

/* 表格 + 提示池（搜索框不动，只重画这里） */
function stuTableHtml(){
  var q = stuQuery();
  var all = DB.students.slice();
  var list = stuFiltered(q);
  var h = '<table><thead><tr><th>学号</th><th>姓名</th><th>性别</th><th>班级</th><th>是否为临界生</th><th>薄弱知识点</th><th>操作</th></tr></thead><tbody>';
  if(!list.length) h += '<tr><td colspan="7" class="muted" style="text-align:center;padding:22px;">'
    +(all.length ? '没有匹配「'+esc(q)+'」的学生。' : '暂无学生，请先「新增学生」或在「成绩录入」批量导入。')+'</td></tr>';
  list.forEach(function(s){
    h += '<tr><td>'+esc(s.id)+'</td><td><b>'+esc(s.name)+'</b></td><td>'+esc(s.gender)+'</td><td>'+esc(s.cls)+'</td>'
      +'<td><button class="sm '+(s.isBorderline?'bwarn':'ghost')+'" onclick="toggleBL(\''+esc(s.key)+'\')">'+(s.isBorderline?'★ 临界生':'☆ 设为临界')+'</button></td>'
      +kpCellHtml(s)
      +'<td><button class="sm" onclick="quickRecord(\''+esc(s.key)+'\')" title="给 '+esc(s.name)+' 记一笔成长记录">记成长</button> '
      +'<button class="sm ghost" onclick="openProfile(\''+esc(s.key)+'\')">查看</button> '
      +'<button class="sm ghost" onclick="addTodoForStudent(\''+esc(s.name)+'\',\''+esc(s.key)+'\')">加入待办</button></td></tr>';
  });
  h += '</tbody></table>';
  h += '<datalist id="kpPoolList">' + kpPoolOptions() + '</datalist>';
  return h;
}

/* 搜索词：统一从搜索框取，去空格转小写 */
function stuQuery(){
  var inp = $('searchIn');
  return inp ? String(inp.value||'').trim().toLowerCase() : '';
}

/* 按当前班级页签 + 搜索词 + 排序方式过滤 */
function stuFiltered(q){
  var list = stuCls ? DB.students.filter(function(s){ return String(s.cls)===String(stuCls); }) : DB.students.slice();
  if(q) list = list.filter(function(s){
    return String(s.name).toLowerCase().indexOf(q)>=0 || String(s.id).toLowerCase().indexOf(q)>=0;
  });
  if(stuSort==='critical') list.sort(function(a,b){ return (b.isBorderline?1:0)-(a.isBorderline?1:0) || natCmp(a.id,b.id); });
  else if(stuSort==='id') list.sort(function(a,b){ return natCmp(a.id,b.id); });
  else if(stuSort==='name') list.sort(function(a,b){ return String(a.name).localeCompare(String(b.name),'zh'); });
  else if(stuSort==='cls') list.sort(function(a,b){ return natCmp(a.cls,b.cls) || String(a.name).localeCompare(String(b.name),'zh'); });
  return list;
}

/* 只重画表格，搜索框 DOM 保持不变（焦点、光标、输入法组态都不受影响） */
function refreshStuList(){
  var box = $('stuList');
  if(box) box.innerHTML = stuTableHtml();
}

/* 搜索框事件绑定
   关键：拼音输入法组词期间（isComposing）不重画，
   否则整块表格换掉会打断候选组态，表现为打字卡住、选词失灵。 */
var stuComposing = false;
function bindStuSearch(){
  var si = $('searchIn');
  if(!si || si._stBound) return;
  si._stBound = 1;
  si.addEventListener('compositionstart', function(){ stuComposing = true; });
  si.addEventListener('compositionend', function(){
    stuComposing = false;
    clearTimeout(window._st); window._st = setTimeout(refreshStuList, 120);
  });
  si.addEventListener('input', function(e){
    if(stuComposing || (e && e.isComposing)) return;   /* 组词中，先不重画 */
    clearTimeout(window._st);
    window._st = setTimeout(refreshStuList, 120);
  });
  /* 键盘导航：上下键移动焦点，方便不点鼠标连续搜索 */
  si.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); clearTimeout(window._st); refreshStuList(); }
    else if(e.key === 'Escape'){
      e.preventDefault(); si.value = '';
      clearTimeout(window._st); refreshStuList();
    } else if(e.key === 'ArrowDown'){
      var b = document.querySelector('#stuList tbody tr td button');
      if(b) b.focus();
    }
  });
}

/* ===========================================================
   「薄弱知识点」列：格内直接点着输入
   点一下 → 变成输入框（逗号分隔多个知识点）→ 回车/点别处保存，Esc 放弃
   点标签 = 改这个学生的全部标签；双击单个标签 = 只删那一个
   =========================================================== */

/* 单元格显示态：有标签就一串可点的标签，没标签显示灰色占位 */
function kpCellHtml(s){
  return '<td class="kp-cell" data-key="'+esc(s.key)+'" onclick="editKp(\''+esc(s.key)+'\')"'
    + ' title="点击直接输入，多个知识点用逗号分隔；双击单个标签可删除">'+kpCellInner(s)+'</td>';
}

/* 格内 HTML（首次渲染和保存后共用一份，避免两处写法不一致） */
function kpCellInner(s){
  if(!s.kpTags || !s.kpTags.length) return '<span class="kp-ph">点此填写薄弱知识点</span>';
  return s.kpTags.map(function(t){
    return '<span class="tag kp-tag"'
      + ' onclick="event.stopPropagation();editKp(\''+esc(s.key)+'\')"'
      + ' ondblclick="event.stopPropagation();delKpTag(\''+esc(s.key)+'\',\''+esc(t)+'\')"'
      + ' title="点击可修改；双击此标签可单独删除">'+esc(t)+'</span>';
  }).join('');
}

/* 拼 CSS 属性选择器时转义引号/反斜杠：key 理论上只是"班级-学号"，
   但万一学号里带了引号，querySelector 会直接抛错把页面搞挂，这里挡一下 */
function cssEsc(v){
  return String(v==null?'':v).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
}

/* 已收集的知识点，做成 datalist 选项，输入时可下拉选，不用手打全称 */function kpPoolOptions(){
  var pool = (DB.kpPool && DB.kpPool.length) ? DB.kpPool : allKpTags();
  return pool.map(function(t){ return '<option value="'+esc(t)+'">'; }).join('');
}
/* 兜底：知识点池为空时，从所有学生身上现扫一遍 */
function allKpTags(){
  var seen = {}, arr = [];
  DB.students.forEach(function(s){
    (s.kpTags||[]).forEach(function(t){ if(t && !seen[t]){ seen[t]=1; arr.push(t); } });
  });
  return arr;
}

/* 进入编辑态：把整格换成一个 input（逗号分隔一格搞定，不用逐个标签点） */
function editKp(key){
  var s = studentByKey(key);
  if(!s) return;
  var td = document.querySelector('.kp-cell[data-key="' + cssEsc(key) + '"]');
  if(!td || td.querySelector('input')) return;      // 找不到格 / 已在编辑

  /* 与今日课程同样的问题：表格行高由最高的格子撑开，换成 input 后行会塌。
     先量出原行高并锁住，input 撑满，视觉完全不变。 */
  var rowH = td.offsetHeight || 0;
  var tr = (td.parentNode && td.parentNode.tagName === 'TR') ? td.parentNode : null;
  var locked = (tr && rowH > 0) ? tr.style.height : '';
  if(tr && rowH > 0) tr.style.height = rowH + 'px';

  var inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'kp-inline';
  inp.setAttribute('list', 'kpPoolList');
  inp.setAttribute('data-key', key);
  inp.setAttribute('data-locked', locked);
  inp.value = (s.kpTags || []).join('，');
  inp.addEventListener('blur', function(){ kpSave(inp); });
  inp.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){ e.preventDefault(); inp.dataset.cancel = '1'; inp.blur(); }
    else if(e.key === 'Enter'){ e.preventDefault(); inp.blur(); }
  });
  td.innerHTML = '';
  td.appendChild(inp);
  if(rowH > 0){
    var pad = parseInt(getComputedStyle(td).paddingTop||'0',10)*2;
    var h = rowH - pad - 2;
    if(h > 24){ inp.style.height = h + 'px'; }
  }
  inp.focus();
  inp.select();
}

/* 保存：支持中英文逗号、顿号、分号、换行做分隔；Esc 标记过的直接还原 */
function kpSave(inp){
  if(!inp) return;
  var key = inp.getAttribute('data-key');
  var cancelled = inp.dataset.cancel === '1';
  var val = String(inp.value || '');
  if(!cancelled){
    var s = studentByKey(key);
    if(s){
      var kp = val.split(/[,，、;；\n\r]+/).map(function(t){ return t.trim(); }).filter(Boolean);
      /* 去重但保持顺序，避免同一个知识点被手打两次 */
      var seen = {}, uniq = [];
      kp.forEach(function(t){ if(!seen[t]){ seen[t]=1; uniq.push(t); } });
      s.kpTags = uniq;
      mergeKpPool(uniq);          /* 顺手把新词收进知识点库，下次别的学生就能选到 */
      saveDB();
    }
  }
  var td = inp.parentNode;
  var tr = td ? td.parentNode : null;
  if(tr && tr.tagName === 'TR') tr.style.height = inp.getAttribute('data-locked') || '';
  var s2 = studentByKey(key);
  if(td && s2){ td.innerHTML = kpCellInner(s2); }        /* 只重画这一格，不整页刷新 */
  else if(selStudent) renderProfile(selStudent);
  else if(curSec === 'borderline') renderBorderline();
  else renderStudents();
  refreshKpPool();
}

/* 新收了新知识点 → 补一下 datalist，让提示词跟着更新。
   提示池现在跟着表格块（#stuList）一起重画，所以两处都要能找；
   getElementById 只能命中第一个，用 querySelectorAll 全部更新更稳。 */
function refreshKpPool(){
  var list = document.querySelectorAll('#kpPoolList');
  for(var i=0; i<list.length; i++) list[i].innerHTML = kpPoolOptions();
}

/* 双击某个标签 = 删掉这一个知识点（其余不动） */
function delKpTag(key, tag){
  var s = studentByKey(key);
  if(!s) return;
  var arr = (s.kpTags||[]).filter(function(t){ return t !== tag; });
  if(arr.length === (s.kpTags||[]).length) return;
  s.kpTags = arr;
  saveDB();
  var td = document.querySelector('.kp-cell[data-key="' + cssEsc(key) + '"]');
  if(td) td.innerHTML = kpCellInner(s);
  else if(selStudent) renderProfile(selStudent);
  else if(curSec === 'borderline') renderBorderline();
  else renderStudents();
  toast('已删除「'+tag+'」');
}

/* 切班级：学生档案和临界生名单共用 stuCls，按当前所在页决定重绘哪个 */
function setStuCls(c){
  stuCls = String(c||'');
  if(curSec === 'borderline') renderBorderline();
  else renderStudents();
}

function toggleBL(id){
  var s = studentByKey(id); if(!s) return;
  s.isBorderline = !s.isBorderline;
  saveDB(); renderStudents();
  toast((s.isBorderline?'已将 ':'已取消 ')+s.name+(s.isBorderline?' 标记为临界生':' 的临界生标记'));
}

/* 打开学生档案：成绩分析 / 成绩录入等板块点「档案」跳转过来。
   必须先切到学生档案板块（curSec）再设 selStudent——
   只设 selStudent 的话 render() 还是渲染原板块，界面不会有任何变化。 */
function openProfile(id){
  if(!studentByKey(id)){ toast('该学生已不存在'); return; }
  curSec = 'students';
  selStudent = id;
  render();
}

function renderProfile(id){
  var s = studentByKey(id);
  if(!s){ selStudent=null; render(); return; }
  var h = '<div class="row noprint"><button class="ghost" onclick="backToList()">← 返回列表</button>'
    +'<button class="ghost" onclick="showEditStudent(\''+esc(id)+'\')">编辑档案</button>'
    +'<button class="ghost" onclick="addTodoForStudent(\''+esc(s.name)+'\',\''+esc(id)+'\')">加入待办</button>'
    +'<span style="flex:1"></span>'
    +'<button class="danger" onclick="askDelStudent(\''+esc(id)+'\')">删除该学生</button></div>';

  var tags = s.kpTags.length ? s.kpTags.map(function(t){return '<span class="tag">'+esc(t)+'</span>';}).join('') : '<span class="muted">—</span>';
  h += '<div class="grid2">'
    +'<div class="card"><h2>'+esc(s.name)+'（'+esc(s.id)+'）</h2>'
    +'<p class="muted">性别：'+esc(s.gender)+' ｜ 班级：'+esc(s.cls)+' ｜ 临界生：'+(s.isBorderline?'<span class="badge warn">是</span>':'<span class="badge ok">否</span>')
    +' ｜ 待跟进：'+(pendingFollowUps(id).length ? '<span class="err">'+pendingFollowUps(id).length+' 条</span>' : '<span class="ok-t">无</span>')+'</p>'
    +'<div class="field"><label>个人情况备注</label><div style="white-space:pre-wrap;">'+esc(s.remark||'—')+'</div></div>'
    +'<div class="field"><label>平时作业</label><div style="white-space:pre-wrap;">'+esc(s.homework||'—')+'</div></div>'
    +'<div class="field"><label>课堂表现</label><div style="white-space:pre-wrap;">'+esc(s.performance||'—')+'</div></div>'
    +'<div class="field"><label>薄弱知识点标签（点下面标签可直接改，双击单个标签删除）</label><div class="kp-cell kp-profile" data-key="'+esc(id)+'" onclick="editKp(\''+esc(id)+'\')" title="点击直接输入，多个知识点用逗号分隔">'+tags+'</div></div></div>'
    +'<div class="card"><h2>成绩波动</h2>'+trendChart(id)+'</div></div>';

  h += gradeRankChart(id);
  h += '<div class="card"><h2>历次成绩（含相比上次涨跌）</h2>' + trendTable(id) + '</div>';
  h += renderRecordTimeline(id);
  h += '<datalist id="kpPoolList">' + kpPoolOptions() + '</datalist>';
  $('content').innerHTML = h;
}

function backToList(){ selStudent=null; render(); }

/* 删除学生：先告知会连带删掉多少东西，让老师看清再确认 */
function askDelStudent(key){
  var s = studentByKey(key);
  if(!s){ toast('该学生已不存在'); return; }
  var nsc = DB.scores.filter(function(x){ return String(x.studentId)===String(key); }).length;
  var nrec = DB.records.filter(function(x){ return String(x.studentId)===String(key); }).length;
  var nfu = pendingFollowUps(key).length;
  var msg = '即将删除学生：'+s.name+'（'+(s.cls?s.cls+'班 ':'')+s.id+'）\n\n'
    + '同时会一并删除：\n'
    + '· 成绩记录 '+nsc+' 条\n'
    + '· 成长记录 '+nrec+' 条'
    + (nfu ? '（其中 '+nfu+' 条待跟进）' : '') + '\n\n'
    + '删除后无法撤销，除非你已导出 JSON 备份。';
  if(!confirm(msg+'\n\n确定要删除吗？')) return;
  if((nsc+nrec) > 0){
    if(!confirm('再次确认：将永久删除该生及其 '+nsc+' 条成绩、'+nrec+' 条成长记录。\n\n真的要删除吗？')) return;
  }
  delStudent(key);
}

function showAddStudent(){
  /* 从某个班的页签进来时，默认填好班级，省一次手输 */
  var d = {id:'',name:'',gender:'男',cls:stuCls||'',remark:'',homework:'',performance:'',kpTags:[]};
  openStudentModal(null, d);
}
function showEditStudent(id){ openStudentModal(id); }

function openStudentModal(id, def){
  var s = id ? studentByKey(id) : (def || {id:'',name:'',gender:'男',cls:'',remark:'',homework:'',performance:'',kpTags:[]});
  if(!s) return;
  /* 班级做成可输入的下拉：既能选已有班，也能直接敲新班（如 715） */
  var clsList = allClasses();
  var clsOpts = '<option value="">（未分班）</option>'
    + clsList.map(function(c){ return '<option value="'+esc(c)+'"'+(String(s.cls)===String(c)?' selected':'')+'>'+esc(c)+'班</option>'; }).join('');
  openModal('<h3>'+(id?'编辑学生档案':'新增学生')+'</h3>'
    +'<div class="row">'
    +'<div class="field half"><label>学号 *</label><input id="m_id" value="'+esc(s.id)+'" '+(id?'disabled':'')+'></div>'
    +'<div class="field half"><label>姓名 *</label><input id="m_name" value="'+esc(s.name)+'"></div>'
    +'</div><div class="row">'
    +'<div class="field half"><label>性别</label><select id="m_gender"><option'+(s.gender==='男'?' selected':'')+'>男</option><option'+(s.gender==='女'?' selected':'')+'>女</option></select></div>'
    +'<div class="field half"><label>班级</label><input id="m_cls" list="clsList" value="'+esc(s.cls)+'" placeholder="如 715 / 716"></div>'
    +'</div>'
    +'<datalist id="clsList">'+clsOpts.replace(/<option[^>]*>/g,'<option value="').replace(/<\/option>/g,'">')+'</datalist>'
    +'<div class="field"><label>个人情况备注</label><textarea id="m_remark">'+esc(s.remark)+'</textarea></div>'
    +'<div class="field"><label>平时作业</label><textarea id="m_homework">'+esc(s.homework)+'</textarea></div>'
    +'<div class="field"><label>课堂表现</label><textarea id="m_performance">'+esc(s.performance)+'</textarea></div>'
    +'<div class="field"><label>薄弱知识点标签（逗号分隔）</label><input id="m_kp" value="'+esc((s.kpTags||[]).join(','))+'"></div>'
    +'<div class="field"><label><input type="checkbox" id="m_bl" '+(s.isBorderline?'checked':'')+' style="width:auto;margin-right:6px;">标记为临界生</label></div>'
    +'<div class="row" style="margin-top:6px"><button onclick="saveStudent('+(id?"'"+esc(id)+"'":'null')+')">保存</button>'
    +'<button class="ghost" onclick="closeModal()">取消</button></div>');
}

function saveStudent(id){
  var nid = $('m_id').value.trim(), name = $('m_name').value.trim();
  if(!id && !nid){ toast('请填写学号'); return; }
  if(!name){ toast('请填写姓名'); return; }
  var kp = $('m_kp').value.split(',').map(function(t){return t.trim();}).filter(Boolean);
  if(id){
    var s = studentByKey(id);
    if(!s){ closeModal(); return; }
    var oldKey = s.key;
    s.name=name; s.gender=$('m_gender').value; s.cls=$('m_cls').value.trim();
    s.remark=$('m_remark').value; s.homework=$('m_homework').value; s.performance=$('m_performance').value;
    s.kpTags=kp; s.isBorderline=$('m_bl').checked;
    /* 班级改了 → key 也要跟着变，并把成绩/成长记录一起改过来，别把数据甩掉 */
    var newKey = studentKey(s.id, s.cls);
    if(newKey !== oldKey){
      var other = studentByKey(newKey);
      if(other){ toast(newKey+' 已被另一位学生占用，请改班级或学号'); return; }
      s.key = newKey;
      DB.scores.forEach(function(sc){ if(sc.studentId===oldKey) sc.studentId = newKey; });
      DB.records.forEach(function(r){ if(r.studentId===oldKey) r.studentId = newKey; });
      if(selStudent===oldKey) selStudent = newKey;
    }
  } else {
    var cls = $('m_cls').value.trim();
    /* 同一班里学号不能重复（不同班可以重号） */
    if(studentByIdCls(nid, cls)){ toast('该班（'+cls+'）里学号 '+nid+' 已存在'); return; }
    DB.students.push({id:nid, name:name, gender:$('m_gender').value, cls:cls,
      key:studentKey(nid, cls),
      remark:$('m_remark').value, homework:$('m_homework').value, performance:$('m_performance').value,
      kpTags:kp, isBorderline:$('m_bl').checked});
  }
  mergeKpPool(kp); ensureStudentKeys(); saveDB(); closeModal();
  if(selStudent) renderProfile(selStudent); else render();
  toast('已保存');
}

function delStudent(id){
  var s0 = studentByKey(id);
  var who = s0 ? (s0.name+'（'+s0.cls+'班 '+s0.id+'）') : '';
  if(!confirm('确认删除该学生？其成绩记录与成长记录也会一并删除。'+(who?'\n\n'+who:''))) return;
  var nrec = DB.records.filter(function(r){ return String(r.studentId)===String(id); }).length;
  if(nrec && !confirm('该生有 '+nrec+' 条成长记录，删除后无法恢复。\n\n仍要删除吗？')) return;
  DB.students = DB.students.filter(function(s){ return s.key!==String(id); });
  DB.scores = DB.scores.filter(function(sc){ return String(sc.studentId)!==String(id); });
  DB.records = DB.records.filter(function(r){ return String(r.studentId)!==String(id); });
  if(String(selStudent)===String(id)) selStudent=null;
  saveDB(); render(); toast('已删除');
}

function delAllStudents(){
  /* 选中某个班时只删该班；「全部」页签才删所有人 */
  if(stuCls){
    var list = DB.students.filter(function(s){ return String(s.cls)===String(stuCls); });
    var keys = {}; list.forEach(function(s){ keys[s.key]=1; });
    var nrec = DB.records.filter(function(r){ return keys[r.studentId]; }).length;
    var nsc = DB.scores.filter(function(sc){ return keys[sc.studentId]; }).length;
    if(!list.length){ toast(stuCls+'班还没有学生'); return; }
    if(!confirm('【第 1 次确认】即将删除 '+stuCls+'班 '+list.length+' 名学生'
      +'，以及 '+nsc+' 条成绩、'+nrec+' 条成长记录。\n\n'
      +'其他班的学生不受影响。\n\n确定继续吗？')) return;
    if(!confirm('【第 2 次确认】删除后无法撤销，除非你已导出 JSON 备份。\n\n真的要删除 '+stuCls+'班全部学生吗？')) return;
    DB.students = DB.students.filter(function(s){ return String(s.cls)!==String(stuCls); });
    DB.scores  = DB.scores.filter(function(sc){ return !keys[sc.studentId]; });
    DB.records = DB.records.filter(function(r){ return !keys[r.studentId]; });
    if(selStudent && keys[selStudent]) selStudent = null;
    saveDB(); render(); toast('已删除 '+stuCls+'班 '+list.length+' 名学生');
    return;
  }

  var n = DB.students.length, sc = DB.scores.length;
  if(!n){ toast('当前没有学生数据，无需删除'); return; }
  if(!confirm('【第 1 次确认】即将删除全部 '+n+' 名学生及其 '+sc+' 条成绩记录。\n\n确定继续吗？')) return;
  if(!confirm('【第 2 次确认】删除后无法撤销，除非你已导出 JSON 备份。\n\n真的要删除全部学生吗？')) return;
  if(!confirm('【第 3 次确认】最后确认：'+n+' 名学生与 '+sc+' 条成绩将被永久清空（课表、待办、日程保留）。\n\n点击“确定”执行删除。')) return;
  DB.students=[]; DB.scores=[]; DB.kpPool=[];
  selStudent=null; saveDB(); render(); toast('已删除全部学生及成绩');
}
