/* ===========================================================
   ui.js —— 通用工具：DOM、转义、提示、弹窗、日期
   =========================================================== */
function $(id){ return document.getElementById(id); }
function el(tag, cls, html){ var e=document.createElement(tag); if(cls) e.className=cls; if(html!=null) e.innerHTML=html; return e; }
function esc(s){
  if(s==null) return '';
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
var _toastTimer=null;
function toast(msg){
  var t=$('toast'); if(!t) return;
  t.textContent=msg; t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(function(){ t.classList.remove('show'); }, 2400);
}
function openModal(html){ var m=$('modal'); if(!m) return; m.innerHTML=html; $('modalBg').classList.add('show'); }
function closeModal(){ var b=$('modalBg'); if(b) b.classList.remove('show'); }

/* ---- 日期工具 ---- */
function todayStr(){
  var d=new Date();
  return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
}
function pad2(n){ return n<10 ? '0'+n : ''+n; }
function parseDate(s){
  if(!s) return null;
  var p=String(s).split('-');
  if(p.length<3) return null;
  var d=new Date(Number(p[0]), Number(p[1])-1, Number(p[2]));
  return isNaN(d.getTime()) ? null : d;
}
function daysUntil(s){
  var d=parseDate(s); if(!d) return null;
  var t=new Date(); t.setHours(0,0,0,0);
  return Math.round((d - t) / 86400000);
}
/* 星期：1=周一 ... 7=周日 */
function todayWeekday(){
  var w=new Date().getDay();
  return w===0 ? 7 : w;
}
function fmtCn(s){
  var d=parseDate(s); if(!d) return s||'—';
  return (d.getMonth()+1)+'月'+d.getDate()+'日';
}
function weekdayCn(n){ return ['一','二','三','四','五','六','七'][n-1]; }

/* ---- 自然排序（"2" 应排在 "10" 前面） ----
   把字符串拆成「数字段」和「非数字段」，数字段按数值比、非数字段按字典比。
   例：学号 2 / 10 / 1 / 001 → 1 / 001 / 2 / 10
   学号可能带前缀（如 20260101）或后缀（如 15-02），同样适用。 */
function natCmp(a, b){
  var sa = String(a==null?'':a), sb = String(b==null?'':b);
  if(sa===sb) return 0;
  var re = /(\d+)|(\D+)/g, ra, rb, na, nb;
  var la = sa.toLowerCase().match(re) || [], lb = sb.toLowerCase().match(re) || [];
  var n = Math.min(la.length, lb.length);
  for(var i=0;i<n;i++){
    ra = la[i]; rb = lb[i];
    na = /^\d+$/.test(ra); nb = /^\d+$/.test(rb);
    if(na && nb){
      var d = Number(ra) - Number(rb);
      if(d) return d;                    // 数值大小
    } else if(na !== nb){
      return na ? -1 : 1;                // 数字段优先于文字段
    } else {
      if(ra < rb) return -1;             // 字典序
      if(ra > rb) return 1;
    }
  }
  return la.length - lb.length;          // 段数少者在前（如 "1" 早于 "1-01"）
}
