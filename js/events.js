/* ===========================================================
   events.js —— 重要日期倒计时（无每年重复）
   项：{id, title, date, type, note}
   =========================================================== */
var EVT_TYPES = ['考试','家长会','教研','交材料','运动会','其他'];

function renderEvents(){
  var h = '<div class="card"><h2>新增重要日期</h2><div class="row">'
    +'<div class="field" style="flex:1;min-width:220px"><label>事件名称</label><input id="v_title" placeholder="如：期中考试 / 家长会"></div>'
    +'<div class="field" style="width:160px"><label>日期</label><input id="v_date" type="date"></div>'
    +'<div class="field" style="width:130px"><label>类型</label><select id="v_type">'+EVT_TYPES.map(function(t){return '<option>'+t+'</option>';}).join('')+'</select></div>'
    +'<div class="field" style="flex:1;min-width:180px"><label>备注（可留空）</label><input id="v_note" placeholder="如：第2周周三"></div>'
    +'<button onclick="addEvent()">添加</button></div></div>';

  var list = DB.events.slice().sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); });
  h += '<div class="card"><h2>日期清单（共 '+DB.events.length+' 条）</h2>';
  if(!list.length){
    h += '<div class="empty">还没有添加任何重要日期。</div>';
  } else {
    list.forEach(function(e){
      var d = daysUntil(e.date);
      /* getDay() 返回 0=周日…6=周六；weekdayCn 期望 1=周一…7=周日，
         所以 0 要换算成 7，否则周日会被当成「周1」。 */
      var dObj = parseDate(e.date) || new Date();
      var wd = dObj.getDay(); wd = (wd === 0 ? 7 : wd);
      var weekdayLabel = '周' + weekdayCn(wd);
      var cls = d===null ? '' : (d<0 ? 'past' : (d<=7 ? 'soon' : ''));
      var badge;
      if(d===null) badge = '<span class="m">未设日期</span>';
      else if(d<0) badge = '<b style="color:#9aa5b1">已过</b>';
      else if(d===0) badge = '<b>今天</b>';
      else badge = '<b>'+d+'</b>';
      var tail = [];
      if(d!==null && d>=0) tail.push('天后');
      h += '<div class="evt '+cls+'">'
        +'<div class="days">'+badge+(tail.length?'<small>'+tail.join('')+'</small>':'')+'</div>'
        +'<div class="info"><div class="t">'+esc(e.title)+'</div>'
        +'<div class="m">'+fmtCn(e.date)+' '+weekdayLabel+'</div></div>'
        +'<span class="tp">'+esc(e.type||'其他')+'</span>'
        +'<button class="sm ghost" onclick="editEvent(\''+e.id+'\')">编辑</button>'
        +'<button class="sm danger" onclick="delEvent(\''+e.id+'\')">删</button>'
        +'</div>';
      if(e.note) h += '<div class="muted" style="padding:0 4px 8px 68px;">'+esc(e.note)+'</div>';
    });
  }
  h += '</div>';
  $('content').innerHTML = h;
}

function addEvent(){
  var title = $('v_title').value.trim();
  var date = $('v_date').value;
  if(!title){ toast('请填写事件名称'); return; }
  if(!date){ toast('请选择日期'); return; }
  DB.events.push({id:uid('ev'), title:title, date:date, type:$('v_type').value, note:$('v_note').value.trim()});
  saveDB(); renderEvents(); toast('已添加');
}

function editEvent(id){
  var e=null;
  for(var i=0;i<DB.events.length;i++){ if(DB.events[i].id===id){ e=DB.events[i]; break; } }
  if(!e) return;
  openModal('<h3>编辑日期</h3>'
    +'<div class="field"><label>名称</label><input id="ev_title" value="'+esc(e.title)+'"></div>'
    +'<div class="field"><label>日期</label><input id="ev_date" type="date" value="'+esc(e.date||'')+'"></div>'
    +'<div class="field"><label>类型</label><select id="ev_type">'+EVT_TYPES.map(function(t){return '<option'+(e.type===t?' selected':'')+'>'+t+'</option>';}).join('')+'</select></div>'
    +'<div class="field"><label>备注</label><input id="ev_note" value="'+esc(e.note||'')+'"></div>'
    +'<div class="row"><button onclick="saveEvent(\''+id+'\')">保存</button>'
    +'<button class="ghost" onclick="closeModal()">取消</button></div>');
}

function saveEvent(id){
  for(var i=0;i<DB.events.length;i++){
    var e=DB.events[i];
    if(e.id===id){
      e.title=$('ev_title').value.trim()||e.title;
      e.date=$('ev_date').value; e.type=$('ev_type').value; e.note=$('ev_note').value.trim();
      break;
    }
  }
  saveDB(); closeModal(); renderEvents(); toast('已保存');
}

function delEvent(id){
  if(!confirm('删除这条日期提醒？')) return;
  DB.events = DB.events.filter(function(e){ return e.id!==id; });
  saveDB(); renderEvents(); toast('已删除');
}

/* 供首页用：最近 N 个未过期事件 */
function upcomingEvents(n){
  n = n || 3;
  return DB.events.filter(function(e){ var d=daysUntil(e.date); return d!==null && d>=0; })
    .sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); })
    .slice(0,n);
}
