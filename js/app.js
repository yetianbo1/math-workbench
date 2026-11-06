/* ===========================================================
   app.js —— 导航路由 + 启动
   =========================================================== */
var SECTIONS = [
  {key:'dashboard', name:'工作台首页', render:function(){ renderDashboard(); }},
  {key:'schedule',  name:'课表',       render:function(){ renderSchedule(); }},
  {key:'events',    name:'日程提醒',   render:function(){ renderEvents(); }},
  {key:'students',  name:'学生档案',   render:function(){ renderStudents(); }},
  {key:'records',   name:'成长记录',   render:function(){ renderRecords(); }},
  {key:'analysis',  name:'成绩分析',   render:function(){ renderAnalysis(); }},
  {key:'scores',    name:'成绩录入',   render:function(){ renderScores(); }},
  {key:'exams',     name:'考试管理',   render:function(){ renderExams(); }},
  {key:'borderline',name:'临界生名单', render:function(){ renderBorderline(); }},
  {key:'kpstats',   name:'薄弱知识点', render:function(){ renderKpStats(); }},
  {key:'history',   name:'历史记录',   render:function(){ renderQuadHistory(); }},
  {key:'backup',    name:'数据备份',   render:function(){ renderBackup(); }}
];

var curSec = 'dashboard';

function buildNav(){
  var nav = $('nav');
  nav.innerHTML = SECTIONS.map(function(s){
    return '<a data-sec="'+s.key+'">' + s.name + '</a>';
  }).join('');
  nav.addEventListener('click', function(e){
    var a = e.target.closest ? e.target.closest('a') : null;
    if(!a) return;
    curSec = a.getAttribute('data-sec');
    selStudent = null;
    render();
  });
}

function goSec(key){
  var a = document.querySelector('#nav a[data-sec="'+key+'"]');
  if(a) a.click();
}

function updateMeta(){
  var nfu = pendingFollowUps().length;
  $('headerMeta').textContent =
    '学生 ' + DB.students.length +
    ' ｜ 考试 ' + DB.exams.length +
    ' ｜ 待办 ' + quadCount() +
    (nfu ? ' ｜ 待跟进 ' + nfu : '');
}

function render(){
  updateMeta();
  Array.prototype.forEach.call(document.querySelectorAll('#nav a'), function(x){
    x.classList.toggle('active', x.getAttribute('data-sec')===curSec);
  });
  var sec = null;
  SECTIONS.forEach(function(s){ if(s.key===curSec) sec = s; });
  if(!sec){ curSec='dashboard'; sec = SECTIONS[0]; }
  sec.render();
}

/* 启动 */
document.addEventListener('DOMContentLoaded', function(){
  buildNav();
  $('modalBg').addEventListener('click', function(e){
    if(e.target === $('modalBg')) closeModal();
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape') closeModal();
  });
  render();
  if(MIGRATED){
    setTimeout(function(){
      toast('已从旧版迁移 '+DB.students.length+' 名学生数据');
    }, 500);
  }
});
