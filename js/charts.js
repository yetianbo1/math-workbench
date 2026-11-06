/* ===========================================================
   charts.js —— 手写 SVG 图表（零依赖、离线可用）
   =========================================================== */

/* 个人成绩波动图：本人成绩 + 本班平均
   得分率模式下画的是得分率（%），各场满分不同也能看趋势 */
function trendChart(studentId, w){
  w = w || 620;
  var s = studentByKey(studentId);
  if(!s) return '<div class="empty">未找到学生</div>';
  var exams = examsSorted();
  var R = showRate();
  var labels=[], vals=[], avg=[], absAt={};
  exams.forEach(function(e, ei){
    var sc = DB.scores.filter(function(x){ return String(x.studentId)===String(studentId) && x.examId===e.id; })[0];
    if(!sc) return;
    var fs = fullScoreOf(e);
    labels.push(e.name);
    /* 缺考：这条折线断开（不进 polyline），但记住位置，明细表里要显示「缺考」 */
    if(isAbsent(sc)){ absAt[ei] = true; vals.push(null); avg.push(null); return; }
    if(R) vals.push(+rateOf(Number(sc.score), fs).toFixed(1));
    else vals.push(Number(sc.score));
    var same = DB.scores.filter(function(x){
      if(x.examId!==e.id) return false;
      if(x.absent) return false;              /* 班均也不含缺考的人 */
      var st = studentByKey(x.studentId);
      return st && st.cls===s.cls;
    }).map(function(x){
      return R ? rateOf(Number(x.score), fs) : Number(x.score);
    });
    avg.push(same.length ? +(same.reduce(function(a,b){return a+b;},0)/same.length).toFixed(1) : null);
  });
  if(!labels.length) return '<div class="empty">暂无成绩数据可绘图。</div>';

  var H=300, pad={l:44,r:18,t:18,b:56};
  /* 注意 vals 里有 null（缺考），必须先滤掉再算 maxV，
     而且 Math.max 遇到 null 会被当 0，把Y 轴压扁 */
  var realV = vals.filter(function(v){ return v!=null; });
  var all = realV.concat(avg.filter(function(v){return v!=null;}));
  if(!all.length) return '<div class="empty">该生暂无实考成绩。</div>';
  var maxV = Math.max.apply(null, all.concat([10]));
  var step = niceStep(maxV/5);
  var yMax = step*5;
  var n = labels.length;
  var xw = (w-pad.l-pad.r)/(n-1||1);
  function px(i){ return pad.l + (n===1 ? 0 : i*xw); }
  function py(v){ return H-pad.b - (v/yMax)*(H-pad.t-pad.b); }
  /* 把连续的非空点切成一段段，缺考点处断开——直接连过去会画出「假进步」 */
  function segments(arr){
    var segs=[], cur=[];
    arr.forEach(function(v,i){
      if(v==null){ if(cur.length){ segs.push(cur); cur=[]; } }
      else cur.push(px(i)+','+py(v));
    });
    if(cur.length) segs.push(cur);
    return segs;
  }

  var g = '<svg viewBox="0 0 '+w+' '+H+'" role="img">';
  for(var v=0; v<=yMax+0.001; v+=step){
    var y=py(v);
    g+='<line x1="'+pad.l+'" y1="'+y+'" x2="'+(w-pad.r)+'" y2="'+y+'" stroke="#eef1f5"/>';
    g+='<text x="'+(pad.l-6)+'" y="'+y+'" font-size="10" fill="#9aa5b1" text-anchor="end" dominant-baseline="central">'+Math.round(v)+(R?'%':'')+'</text>';
  }
  /* 班级平均折线（虚线） */
  segments(avg).forEach(function(seg){
    if(seg.length>1) g+='<polyline fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="5 4" points="'+seg.join(' ')+'"/>';
  });
  /* 本人折线 */
  segments(vals).forEach(function(seg){
    if(seg.length>1) g+='<polyline fill="none" stroke="#2f6fed" stroke-width="2.5" points="'+seg.join(' ')+'"/>';
  });
  labels.forEach(function(lb,i){
    /* 缺考：画一个空心标记 + 「缺考」二字，不画成 0 分的点 */
    if(vals[i]==null){
      g+='<circle cx="'+px(i)+'" cy="'+py(0)+'" r="3.5" fill="#fff" stroke="#b45309" stroke-width="2" stroke-dasharray="2 2"/>';
      g+='<text x="'+px(i)+'" y="'+(py(0)-10)+'" font-size="10" fill="#b45309" text-anchor="middle" font-weight="600">缺考</text>';
      g+='<text x="'+px(i)+'" y="'+(H-pad.b+16)+'" font-size="10" fill="#7b8794" text-anchor="middle">'+esc(lb)+'</text>';
      return;
    }
    g+='<circle cx="'+px(i)+'" cy="'+py(vals[i])+'" r="3.5" fill="#2f6fed"/>';
    g+='<text x="'+px(i)+'" y="'+(py(vals[i])-10)+'" font-size="10.5" fill="#2f6fed" text-anchor="middle">'+vals[i]+(R?'%':'')+'</text>';
    /* 相比上次的涨跌（红涨绿跌）。
       上一场若缺考就不标涨跌 —— 缺考不是成绩，「缺考→85分」不是 +85 的暴涨。 */
    var prev = i>0 ? vals[i-1] : null;
    for(var k=i-1;k>=0;k--){ if(vals[k]!=null){ prev=vals[k]; break; } }
    if(prev!=null){
      var d = +(vals[i]-prev).toFixed(1);
      if(d!==0){
        var up = d>0;
        var ty = py(vals[i]) - 24;
        g+='<text x="'+px(i)+'" y="'+ty+'" font-size="10" font-weight="600" text-anchor="middle" fill="'+(up?'#dc2626':'#15803d')+'">'
          +(up?'↑+':'↓')+Math.abs(d)+'</text>';
      }
    } else if(i>0){
      g+='<text x="'+px(i)+'" y="'+(py(vals[i])-24)+'" font-size="9.5" text-anchor="middle" fill="#9aa5b1">首次实考</text>';
    }
    g+='<text x="'+px(i)+'" y="'+(H-pad.b+16)+'" font-size="10" fill="#7b8794" text-anchor="middle">'+esc(lb)+'</text>';
  });
  g+='</svg>';
  var nAbs = Object.keys(absAt).length;
  g+='<p class="hint">蓝线：本人'+(R?'得分率':'分数')+'（线上数字为'+(R?'得分率':'得分')+'，↑/↓ 为相比上次的涨跌，红涨绿跌'
    +(R?'，单位 pt = 百分点；因为各场满分可能不同，所以统一看得分率':'')+'）；灰虚线：本班平均'
    +(R?'得分率':'分')+'（同样不含缺考者）。'
    +(nAbs ? '<br>该生有 '+nAbs+' 场缺考：折线在缺考点断开，缺考不算 0 分，也不参与涨跌计算。' : '')
    +'</p>';
  return g;
}

/* ===========================================================
   年级排名走势图 —— 只画学校给的真实年级名次（rkSrc==='school'）

   为什么单独画一张图，而不是叠加在得分率折线上：
   得分率是"越高越好"（0~100%），年级名次是"越小越好"（1~几百），
   量纲和方向都相反。硬塞进一张图要配双轴，而双轴图的两条线交点
   完全没有意义，看的人很容易得出"分数涨了名次也涨了"这种错误结论。
   分成两张图，各自的方向和刻度都直观，不容易误读。

   只有学校名次才画：本地按两个班算出来的名次参照系只有 ~100 人，
   和几百人的年级名次不是同一把尺子，混在一起画趋势是错的。
   没有名次的场次直接跳过（折线断开），不画成 0。
   =========================================================== */
function gradeRankChart(studentId, w){
  var s = studentByKey(studentId);
  if(!s) return '';
  w = w || 620;
  var R = showRate();
  /* 参照系 = 本班实考人数：名次不可能优于这个数，作为纵轴的物理上限提示 */
  var clsTotal = DB.students.filter(function(x){ return String(x.cls)===String(s.cls); }).length;

  var pts = [];   /* {exam, rank, prev, delta} */
  var labels = [], ranks = [], absAt = {};
  examsSorted().forEach(function(e, ei){
    var sc = DB.scores.filter(function(x){
      return String(x.studentId)===String(studentId) && x.examId===e.id;
    })[0];
    if(!sc) return;
    labels.push(e.name);
    var rn = hasSchoolGradeRank(sc) ? gradeRankNum(sc) : null;
    ranks.push(rn);
    /* 缺考同样断开，且标注出来 */
    if(isAbsent(sc)) absAt[ei] = true;
  });
  var valid = ranks.filter(function(v){ return v!=null; });
  if(valid.length<1){
    return '<div class="card"><h2>年级排名走势</h2><div class="empty">'
      + '该生还没有学校提供的年级排名。</div>'
      + '<p class="hint">年级排名需要从学校拿：导入成绩时在表格里带上「<b>年级排名</b>」列，'
      + '或在「网页内逐条补录」里手填。没有排名的考试会被自动跳过，不影响其他场次的对比。</p></div>';
  }

  var H=240, pad={l:42,r:18,t:18,b:56};
  var maxV = Math.max.apply(null, valid);
  var step = niceStep(maxV/4) || 1;
  var yMax = Math.max(step*4, Math.ceil(maxV/step)*step);
  /* Y 轴倒置：名次 1 在最上面，这样"线往上走"就是名次变好，和直觉一致 */
  var n = labels.length;
  var xw = (w-pad.l-pad.r)/(n-1||1);
  function px(i){ return pad.l + (n===1 ? 0 : i*xw); }
  function py(v){ return pad.t + (v/yMax)*(H-pad.t-pad.b); }

  function segments(arr){
    var segs=[], cur=[];
    arr.forEach(function(v,i){
      if(v==null){ if(cur.length){ segs.push(cur); cur=[]; } }
      else cur.push({x:px(i), y:py(v), v:v, i:i});
    });
    if(cur.length) segs.push(cur);
    return segs;
  }

  var g = '<svg viewBox="0 0 '+w+' '+H+'" role="img">';
  for(var v=0; v<=yMax+0.001; v+=step){
    var y=py(v);
    g+='<line x1="'+pad.l+'" y1="'+y+'" x2="'+(w-pad.r)+'" y2="'+y+'" stroke="#eef1f5"/>';
    g+='<text x="'+(pad.l-6)+'" y="'+y+'" font-size="10" fill="#9aa5b1" text-anchor="end" dominant-baseline="central">'+v+'</text>';
  }
  var segs = segments(ranks);
  segs.forEach(function(seg){
    if(seg.length>1){
      g+='<polyline fill="none" stroke="#7c3aed" stroke-width="2.5" points="'
        + seg.map(function(p){ return p.x+','+p.y; }).join(' ') +'"/>';
    }
  });
  /* 单点场次也要画出来，否则只有一个点的折线段会被跳过、名次就看不见了 */
  segs.forEach(function(seg){
    seg.forEach(function(p, idx){
      var alone = (seg.length===1);
      if(!alone && idx!==0 && idx!==seg.length-1) return;
      g+='<circle cx="'+p.x+'" cy="'+p.y+'" r="3.5" fill="#7c3aed"/>';
    });
  });

  /* 名次涨跌：跟"上一次有年级排名的考试"比，中间的缺排名场次全部跳过 */
  var lastNum = null, nSkip = 0;
  labels.forEach(function(lb, i){
    var x = px(i);
    var rn = ranks[i];
    if(rn!=null){
      var d = gradeRankDelta(lastNum, rn);
      g+='<text x="'+x+'" y="'+(py(rn)-11)+'" font-size="10.5" fill="#7c3aed" text-anchor="middle" font-weight="600">'+rn+'</text>';
      if(d!=null && d!==0){
        /* 名次数字变小 = 进步 → 用"进步N名"的绿色；落后用红色 */
        var better = d>0;
        g+='<text x="'+x+'" y="'+(py(rn)-24)+'" font-size="10" font-weight="600" text-anchor="middle" fill="'
          +(better?'#15803d':'#dc2626')+'">'+(better?'↑进步':'↓退')+Math.abs(d)+'名</text>';
      }
      lastNum = rn;
    } else {
      nSkip++;
      var tag = absAt[i] ? '缺考' : '无年级排名';
      g+='<circle cx="'+x+'" cy="'+(py(yMax)) +'" r="3.5" fill="#fff" stroke="#b9c2cc" stroke-width="2" stroke-dasharray="2 2"/>';
      g+='<text x="'+x+'" y="'+(py(yMax)-9)+'" font-size="9.5" fill="#b9c2cc" text-anchor="middle">'+tag+'</text>';
    }
    g+='<text x="'+x+'" y="'+(H-pad.b+16)+'" font-size="10" fill="#7b8794" text-anchor="middle">'+esc(lb)+'</text>';
  });
  g+='</svg>';

  var best = Math.min.apply(null, valid);
  var worst = Math.max.apply(null, valid);
  g+='<p class="hint">紫线：学校给的年级名次，<b>越靠上名次越好</b>，线上数字即名次。'
    + '本班共 '+clsTotal+' 人，所以名次最好不会优于第 1 名。'
    + (valid.length>1 ? '目前最好第 '+best+' 名，最差第 '+worst+' 名。' : '')
    + (nSkip ? '<br>有 '+nSkip+' 场没有年级排名（虚线标记），已自动跳过，不参与涨跌对比。' : '')
    + '</p>';
  return '<div class="card"><h2>年级排名走势</h2>'+g+'</div>';
}

/* 个人成绩明细表：分数 + 得分率 + 班排年排 + 相比上次涨跌 */
function trendTable(studentId){
  var exams = examsSorted();
  if(!exams.length) return '<div class="empty">尚未录入考试</div>';
  var R = showRate();
  /* 本班人数：给"≈ 名次"（本地算的）一个参照系，让老师知道它不是年级名次 */
  var stu = studentByKey(studentId);
  var clsN = stu ? DB.students.filter(function(x){ return String(x.cls)===String(stu.cls); }).length : 0;
  /* 按考试时间正序收集有成绩的场次；某场缺考则不参与涨跌计算，下一场与上一次有成绩的场次比 */
  var rows = [];
  exams.forEach(function(e){
    var sc = DB.scores.filter(function(x){ return String(x.studentId)===String(studentId) && x.examId===e.id; })[0];
    if(!sc) return;
    rows.push({ e:e, score:Number(sc.score)||0, full:fullScoreOf(e),
                absent:isAbsent(sc), sc:sc });
  });
  if(!rows.length) return '<div class="empty">该生暂无成绩记录。</div>';
  var nAbs = rows.filter(function(r){ return r.absent; }).length;
  var nNoGr = rows.filter(function(r){ return gradeRankNum(r.sc)===null; }).length;
  var nAuto = rows.filter(function(r){ return r.sc.rkSrc==='auto' && gradeRankNum(r.sc)!==null; }).length;

  var h = '<table><thead><tr><th>考试</th><th>日期</th><th>满分</th><th>分数</th>'
    +'<th>得分率</th><th>较上次</th>'
    +'<th>班排</th><th>年排</th><th>年排变化</th></tr></thead><tbody>';
  /* 年排变化的参照：上一次"有年级排名"的场次。
     中间没有排名的考试要跳过而不是当成 0，否则会算出荒唐的巨大退步。 */
  var lastGr = null;
  rows.forEach(function(r,i){
    var grNum = gradeRankNum(r.sc);
    var grDelta = (r.absent || grNum===null) ? null : gradeRankDelta(lastGr, grNum);

    /* 缺考：整行显示「缺考」，分数/得分率/排名留空，不参与涨跌 */
    if(r.absent){
      h += '<tr style="background:#fffbeb"><td><b>'+esc(r.e.name)+'</b></td><td>'+esc(r.e.date||'—')+'</td>'
        +'<td>'+r.full+'</td><td>'+absentCell()+'</td><td>—</td>'
        +'<td><span class="muted">—</span></td><td>—</td><td>—</td><td>—</td></tr>';
      return;
    }
    /* 涨跌跟「上一次实考」比，跳过中间的缺考场次 */
    var prev = null;
    for(var k=i-1;k>=0;k--){ if(!rows[k].absent){ prev=rows[k]; break; } }
    var d = prev ? deltaVal(prev.score, prev.full, r.score, r.full, 1) : null;
    var rt = +(rateOf(r.score, r.full)).toFixed(1);
    /* 年排来源不同，可信度也不同，必须显示得让人一眼分出来：
       学校名次直接显示；本地两个班算的加「≈」并标灰，避免和学校名次混为一谈。 */
    var grCell = grNum===null ? '<span class="muted">—</span>'
      : (r.sc.rkSrc==='auto'
          ? '<span class="muted" title="本地按本班约 '+clsN+' 人算出的名次，不是学校年级名次">≈'+grNum+'</span>'
          : '<b>'+grNum+'</b>');
    var grDltCell = grDelta===null ? '<span class="muted">—</span>'
      : (grDelta>0 ? '<span class="down">进步 '+grDelta+' 名</span>'   /* 名次变小=进步，用绿色 */
        : grDelta<0 ? '<span class="up">退 '+(-grDelta)+' 名</span>'
        : '<span class="muted">持平</span>');
    h += '<tr><td><b>'+esc(r.e.name)+'</b></td><td>'+esc(r.e.date||'—')+'</td>'
      +'<td>'+r.full+'</td><td><b>'+r.score+'</b></td>'
      +'<td>'+(R?'<b>'+rt+'%</b>':'<span class="muted">'+rt+'%</span>')+'</td>'
      +'<td>'+(d===null?'<span class="muted">—</span>'
        :(d>0?'<span class="up">+'+d+(R?'pt':'')+'</span>':(d<0?'<span class="down">'+d+(R?'pt':'')+'</span>':'<span class="muted">持平</span>')))+'</td>'
      +'<td>'+esc(r.sc.classRank||'—')+'</td><td>'+grCell+'</td><td>'+grDltCell+'</td></tr>';
    if(grNum!==null) lastGr = grNum;
  });
  return h+'</tbody></table>'
    + '<p class="hint">「较上次」按得分率计算（单位 pt），不同满分的考试之间也能正确比较。'
    + '<br>「年排变化」与上一次<b>有年级排名</b>的考试比较'
    + (nNoGr ? '；该生有 '+nNoGr+' 场<b>没有年级排名</b>，已跳过，不影响其余场次的对比。' : '。')
    + (nAbs ? '<br>该生有 '+nAbs+' 场<b>缺考</b>：缺考不计入班级各项统计，'
        + '也不参与个人涨跌计算（下一场与上一次<b>实考</b>比）。' : '')
    + (nAuto ? '<br><b>≈</b> 开头的是本地按本班约 '+clsN+' 人算出的名次，不是学校年级名次，'
        + '不参与「年排变化」的对比。' : '')
    + '</p>';
}

/* 分数段分布直方图
   得分率模式下按 0-10%、10-20%…90-100% 分段，不受各班满分影响
   缺考不画进分布里（他们没考，画进去会凭空多一根 0 分的柱子） */
function histChart(examId, w, cls){
  w = w || 620;
  var e = examById(examId); if(!e) return '';
  var fs = Number(e.fullScore)||100;
  var R = showRate();
  var all = scoresOf(examId, cls);
  var vals = validScoresOf(examId, cls).map(function(x){ return x.score; });
  var nAbsent = all.length - vals.length;
  if(!vals.length){
    return '<div class="empty">该考试'+(cls?esc(cls)+'班':'')
      + (nAbsent ? '全部缺考（'+nAbsent+' 人），没有可统计的成绩。' : '暂无成绩。') +'</div>';
  }
  var buckets = new Array(10).fill(0);
  var step = R ? 10 : (fs/10);
  vals.forEach(function(v){
    var x = R ? rateOf(v, fs) : v;
    buckets[Math.min(9, Math.max(0, Math.floor(x/step)))]++;
  });
  var H=250, pad={l:36,r:14,t:16,b:42};
  var maxC = Math.max.apply(null, buckets.concat([1]));
  var bw = (w-pad.l-pad.r)/10;
  var g='<svg viewBox="0 0 '+w+' '+H+'" role="img">';
  buckets.forEach(function(c,i){
    var h=(c/maxC)*(H-pad.t-pad.b), x=pad.l+i*bw, y=H-pad.b-h;
    g+='<rect x="'+x+'" y="'+y+'" width="'+(bw-3)+'" height="'+h+'" fill="#2f6fed" rx="2"/>';
    if(c>0) g+='<text x="'+(x+(bw-3)/2)+'" y="'+(y-4)+'" font-size="10" fill="#475569" text-anchor="middle">'+c+'</text>';
    g+='<text x="'+(x+(bw-3)/2)+'" y="'+(H-pad.b+15)+'" font-size="9" fill="#9aa5b1" text-anchor="middle">'
      +Math.round(i*step)+'-'+Math.round((i+1)*step)+(R?'%':'')+'</text>';
  });
  g+='</svg><p class="hint">'+(R
    ? '横轴为得分率区间（每段 10pt）'
    : '满分 '+fs) + (cls?'，'+esc(cls)+'班':'') +'，实考 '+vals.length+' 人'
    + (nAbsent ? '，缺考 '+nAbsent+' 人（不计入）' : '') +'。</p>';
  return g;
}

/* 横向条形图：两班均分等对比 */
function barChart(items, w){
  w = w || 560;
  if(!items.length) return '<div class="empty">暂无数据</div>';
  var rowH=34, H=items.length*rowH+16, pad={l:96,r:56,t:8,b:8};
  var maxV = Math.max.apply(null, items.map(function(i){return i.value;}).concat([1]));
  var g='<svg viewBox="0 0 '+w+' '+H+'" role="img">';
  items.forEach(function(it,i){
    var y=pad.t+i*rowH;
    var bw=Math.max(2, (it.value/maxV)*(w-pad.l-pad.r));
    g+='<text x="'+(pad.l-8)+'" y="'+(y+rowH/2)+'" font-size="12" fill="#475569" text-anchor="end" dominant-baseline="central">'+esc(it.label)+'</text>';
    g+='<rect x="'+pad.l+'" y="'+(y+7)+'" width="'+bw+'" height="'+(rowH-16)+'" fill="'+(it.color||'#2f6fed')+'" rx="3"/>';
    g+='<text x="'+(pad.l+bw+8)+'" y="'+(y+rowH/2)+'" font-size="12" fill="#1f2933" dominant-baseline="central">'+(it.text!=null?it.text:it.value)+'</text>';
  });
  g+='</svg>';
  return g;
}
