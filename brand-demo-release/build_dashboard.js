// build_dashboard.js — 品牌看板
const fs = require('fs');
const path = require('path');
const { BRAND_NAME, DATA_ROOT, getBrand, getBrandRank, isOwnReference, resolveQuestion } = require('./brand_config.js');
const { classifyMedia } = require('./media_classifier.js');
const CANONICAL_NAMES = [BRAND_NAME];
const XLSX = require('xlsx');
const iconv = require('iconv-lite');

const ROOT = __dirname;
const URL_CACHE_PATH = path.join(ROOT, 'url_cache.json');
const PLATFORMS = ['doubao', 'deepseek', 'yiyan', 'yuanbao', 'qianwen'];
const P_NAMES = { doubao: '豆包', deepseek: 'DeepSeek', yiyan: '文心', yuanbao: '元宝', qianwen: '千问' };
const P_ICONS = { doubao: '', deepseek: '', yiyan: '', yuanbao: '', qianwen: '' };
const rankText = (r) => (r > 0) ? r : '—';
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function safeUrl(value) { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? esc(u.href) : ''; } catch { return ''; } }
function escCsv(s) { return String(s || '').replace(/^[=+@-]/, m => "'" + m).replace(/"/g, '""'); }

// 媒体分类：统一走 media_classifier.js (overrides正则 + xlsx字典 + 兜底)

// ---- 加载 master.csv 获取问题分类/关键词 ----
const QUESTIONS_DIR = path.join(ROOT, 'questions');

function loadDateCache() {
  try {
    if (fs.existsSync(URL_CACHE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(URL_CACHE_PATH, 'utf8'));
      const result = new Map();
      for (const [url, info] of Object.entries(raw)) {
        result.set(url, info.date || '');
      }
      return result;
    }
  } catch {}
  return new Map();
}

function loadQuestionMeta() {
  const masterPath = path.join(QUESTIONS_DIR, 'master.csv');
  if (!fs.existsSync(masterPath)) return new Map();
  const raw = fs.readFileSync(masterPath);
  let text;
  if (raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
    text = iconv.decode(raw, 'utf8').replace(/^\uFEFF/, '');
  } else {
    text = iconv.decode(raw, 'gbk');
  }
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return new Map();
  const headers = lines[0].split(',').map(h => h.trim());
  const cIdx = headers.findIndex(h => h.includes('关键词类型') || h.includes('类型') || h.includes('分类'));
  const kIdx = headers.findIndex(h => h.includes('具体关键词') || (h.includes('关键词') && !h.includes('类型')));
  const qIdx = headers.findIndex(h => h.includes('检索问题') || h.includes('问题'));
  const meta = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const q = resolveQuestion((cols[qIdx] || '').trim());
    if (!q) continue;
    meta.set(q, { category: (cols[cIdx] || '').trim(), keyword: (cols[kIdx] || '').trim() });
  }
  return meta;
}

const questionMeta = loadQuestionMeta();
const dateCache = loadDateCache();

const cliArgs = process.argv.slice(2);
const argDateIdx = cliArgs.indexOf('--date');
const RUN_DATE = argDateIdx >= 0 ? cliArgs[argDateIdx + 1] : (() => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; })();
const DATE_FOLDER = path.join(DATA_ROOT, `${RUN_DATE.slice(0,4)}-${RUN_DATE.slice(4,6)}-${RUN_DATE.slice(6,8)}`);
const BATCH_DIR = path.join(DATE_FOLDER, 'batches');
const DASHBOARD_DIR = path.join(DATE_FOLDER, 'dashboards');
if (!fs.existsSync(DASHBOARD_DIR)) fs.mkdirSync(DASHBOARD_DIR, { recursive: true });

const pd = {};
const qMap = new Map();
PLATFORMS.forEach(p => {
  if (!fs.existsSync(BATCH_DIR)) { pd[p] = { results: [] }; return; }
  const files = fs.readdirSync(BATCH_DIR).filter(f => f.startsWith(`brand-${p}-`) && f.endsWith('.json')).sort((a,b) => a.localeCompare(b, 'en', {numeric:true}));
  if (files.length === 0) { pd[p] = { results: [] }; return; }
  const results = [];
  files.forEach(f => {
    try { const batch = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, f), 'utf8')); results.push(...batch); } catch(e) {}
  });
  pd[p] = { results };
  results.forEach(r => {
    if (r.brandName !== BRAND_NAME) return;
    const nq = r.question.trim();
    if (!qMap.has(nq)) qMap.set(nq, { question: r.question, platforms: {} });
    qMap.get(nq).platforms[p] = r;
  });
  console.log(`✅ ${P_NAMES[p]}: ${results.length} 条`);
});

const qList = [];
for (const [, d] of qMap) { const row = { question: d.question, platforms: {} }; PLATFORMS.forEach(p => { row.platforms[p] = d.platforms[p] || null; }); qList.push(row); }

// Stats: per-brand per-platform
const brandStats = {};
CANONICAL_NAMES.forEach(b => {
  brandStats[b] = { total: 0, rank1: 0 };
  PLATFORMS.forEach(p => { brandStats[b][p] = { appear: 0, rank1: 0, total: 0 }; });
});
const pTotal = {};
PLATFORMS.forEach(p => { pTotal[p] = 0; });

for (const [, d] of qMap) {
  PLATFORMS.forEach(p => {
    const r = d.platforms[p];
    if (!r || r.error) return;
    pTotal[p]++;
    const brands = getBrand(r.answerText || '');
    if (brands.length > 0) {
      brands.forEach((b, i) => {
        if (brandStats[b] && brandStats[b][p]) {
          brandStats[b][p].appear++;
          if (getBrandRank(r.answerText) === 1) brandStats[b][p].rank1++;
        }
      });
    }
  });
}

// 品牌平均顺序位次（仅出现时计入）
let ydRankSum = 0, ydRankCount = 0;
for (const [, d] of qMap) {
  PLATFORMS.forEach(p => {
    const r = d.platforms[p];
    if (!r || r.error) return;
    const brands = getBrand(r.answerText || '');
    const rank = getBrandRank(r.answerText || '');
    if (rank > 0) { ydRankSum += rank; ydRankCount++; }
  });
}

const allTotal = Object.values(pTotal).reduce((a, b) => a + b, 0);
// Set per-platform totals for each brand
CANONICAL_NAMES.forEach(b => { PLATFORMS.forEach(p => { brandStats[b][p].total = pTotal[p]; }); });
// Only show brands that actually appeared
const activeBrands = CANONICAL_NAMES;

// 媒体明细数据（用于表格和CSV）
const mediaRows = [];
const csvRows = [];
const mediaSeen = new Set();
for (const [, d] of qMap) {
  PLATFORMS.forEach(p => {
    const r = d.platforms[p];
    if (!r || r.error) return;
    const refs = r.references || [];
    refs.filter(isOwnReference).forEach(ref => {
      const url = ref.url || ref.href || '';
      const cls = classifyMedia(url);
      if (!cls) return;
      const key = `${p}|${cls.name}|${url}`;
      if (mediaSeen.has(key)) return;
      mediaSeen.add(key);
      const meta = questionMeta.get(d.question.trim()) || {};
      const mediaType = cls.cat;
      const isUnknown = !cls.matched;
      const row = { platform: P_NAMES[p], category: meta.category || '', keyword: meta.keyword || '', question: d.question, mediaType, unknown: isUnknown, media: cls.name, title: ref.title || '', url };
      mediaRows.push(row);
      const pubDate = ref.date || ref.publishDate || dateCache.get(url) || '';
      row.date = pubDate;
      csvRows.push(`"${P_NAMES[p]}","${escCsv(meta.category||'')}","${escCsv(meta.keyword||'')}","${escCsv(d.question)}","${mediaType||'其他'}","${cls.name}","${escCsv(ref.title||'')}","${url}","${pubDate}"`);
    });
  });
}
const mediaCSV = '\uFEFFAI平台,关键词类型,关键词,问题,媒体类型,媒体名称,文章标题,文章链接,发布日期\n' + csvRows.join('\n');
const mediaCSVB64 = Buffer.from(mediaCSV, 'utf8').toString('base64');
const mediaJSON = JSON.stringify(mediaRows).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/<\//g, '<\\/');

// ---- 生成品牌排名 XLSX ----
const CN_NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
function getYdRankText(platformData) {
  if (!platformData) return '';
  if (platformData.error) return '采集异常';
  const brands = getBrand(platformData.answerText || '');
  const rank = getBrandRank(platformData.answerText || '');
  if (rank === -1) return BRAND_NAME + '未出现';
  return rank > 0 ? BRAND_NAME + '第' + rank + '名' : BRAND_NAME + '已出现（排名未识别）';
}

const xlsxRows = [['抽查关键词类型', '具体关键词', '检索日期', '检索问题', 'DeepSeek', '是否分类推荐', '豆包', '元宝', '是否分类推荐', '千问', '文心一言']];
qList.forEach(q => {
  const meta = questionMeta.get(q.question.trim()) || {};
  const dateStr = `${RUN_DATE.slice(0,4)}-${RUN_DATE.slice(4,6)}-${RUN_DATE.slice(6,8)}`;
  xlsxRows.push([
    meta.category || '',
    meta.keyword || '',
    dateStr,
    q.question,
    getYdRankText(q.platforms['deepseek']),
    '',
    getYdRankText(q.platforms['doubao']),
    getYdRankText(q.platforms['yuanbao']),
    '',
    getYdRankText(q.platforms['qianwen']),
    getYdRankText(q.platforms['yiyan']),
  ]);
});

const ws = XLSX.utils.aoa_to_sheet(xlsxRows);
ws['!cols'] = [
  { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 50 },
  { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 16 },
  { wch: 12 }, { wch: 16 }, { wch: 16 },
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '排名数据');
const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
const xlsxB64 = Buffer.from(xlsxBuf).toString('base64');

// 品牌固定排序：按总出现率从高到低
const brandOrder = activeBrands.map(b => ({ name: b, tAppear: PLATFORMS.reduce((s,p) => s + brandStats[b][p].appear, 0) }))
  .sort((a, b) => b.tAppear - a.tAppear)
  .map(b => b.name);
const brandRank = {};
brandOrder.forEach((b, i) => { brandRank[b] = i; });

const now = new Date().toLocaleString('zh-CN');
const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>品牌监控 — ${RUN_DATE.slice(4,6).replace(/^0/,'')}月${RUN_DATE.slice(6,8).replace(/^0/,'')}日</title><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif; background: #f0f2f5; padding: 20px; }
.container { max-width: 1400px; margin: 0 auto; }
h1 { color: #1a1a2e; margin-bottom: 8px; font-size: 24px; }
.meta { color: #666; margin-bottom: 20px; font-size: 14px; }
h2 { color: #1a1a2e; font-size: 18px; margin-bottom: 12px; margin-top: 24px; }
table { width: 100%; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06); border-collapse: separate; border-spacing: 0; margin-bottom: 24px; table-layout: auto; }
th { background: #1a1a2e; color: white; padding: 14px 12px; text-align: left; font-weight: 600; font-size: 13px; }
td { padding: 14px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; vertical-align: middle; }
tr:hover td { background: #f8f9fc; }

.appear-bar { display: inline-block; height: 18px; border-radius: 9px; min-width: 4px; background: linear-gradient(90deg, #6366f1, #818cf8); }
.rank1-bar { display: inline-block; height: 18px; border-radius: 9px; min-width: 4px; background: linear-gradient(90deg, #22c55e, #4ade80); }
.cross-rank { color: #22c55e; font-weight: 700; }
.cross-miss { color: #ef4444; font-weight: 700; }
.rank-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin: 1px; }
.rank-yd { background: #dbeafe; color: #1e40af; font-weight: 700; }
.rank-other { background: #f3f4f6; color: #9ca3af; }
.media-tag { background: #ede9fe; color: #7c3aed; }
.overview { display: flex; gap: 12px; margin-bottom: 20px; }
.ov-card { background: white; border-radius: 12px; padding: 16px 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); text-align: center; min-width: 140px; flex: 1; }
.ov-highlight { border-left: 4px solid #22c55e; }
.ov-num { font-size: 28px; font-weight: 700; color: #1a1a2e; white-space: nowrap; }
.ov-label { font-size: 12px; color: #888; margin-top: 4px; }
.cross-table { table-layout:fixed; min-width:1000px; }
.cross-table td:nth-child(2) { line-height:1.8; overflow-wrap:anywhere; padding-right:22px; }
.cross-table td:nth-child(n+3) { white-space:nowrap; }
th { position:sticky; top:0; z-index:1; }
#mediaTable { min-width:1200px; }
#mediaTable td:last-child { white-space:nowrap; }
#mediaTable td:nth-child(4) { min-width:280px; line-height:1.8; }
.overview { flex-wrap:wrap; }
</style></head><body><div class="container">
${process.argv.includes("--sample") ? '<p style="padding:16px;background:#fff3cd;border:2px solid #d99c00;font-weight:bold">合成示例数据 · 非真实平台回答 · 仅用于演示交互和统计口径</p>' : ""}
<h1>🔍 ${esc(BRAND_NAME)}监控 — ${RUN_DATE.slice(4,6).replace(/^0/,'')}月${RUN_DATE.slice(6,8).replace(/^0/,'')}日</h1>
<p class="meta">生成时间：${now} | 共 ${qList.length} 个问题 | 覆盖 5 个AI平台</p>

<div class="overview">
  <div class="ov-card"><div class="ov-num">${PLATFORMS.reduce((sum,p)=>sum+brandStats[BRAND_NAME][p].appear,0)}</div><div class="ov-label">品牌出现次数</div></div>
  <div class="ov-card"><div class="ov-num">${allTotal}</div><div class="ov-label">检测点</div></div>
  <div class="ov-card"><div class="ov-num" style="color:#4f46e5;">${(()=>{const yd=brandStats[BRAND_NAME];if(!yd)return'—';const t=PLATFORMS.reduce((s,p)=>s+(yd[p]?yd[p].appear:0),0);return allTotal>0?(t/allTotal*100).toFixed(0)+'%':'—';})()}</div><div class="ov-label">品牌总出现率</div></div>
  <div class="ov-card ov-highlight"><div class="ov-num" style="color:#1e40af;">${ydRankCount>0?(ydRankSum/ydRankCount).toFixed(1):'—'}</div><div class="ov-label">品牌平均顺序位次</div></div>
</div>

<div class="overview" style="margin-top:12px;">
${PLATFORMS.map(p => {
  const yd = brandStats[BRAND_NAME];
  const appear = yd ? (yd[p] ? yd[p].appear : 0) : 0;
  const total = pTotal[p];
  const pct = total ? (appear / total * 100).toFixed(0) : '—';
  const color = pct >= 50 ? '#22c55e' : pct >= 20 ? '#f59e0b' : '#ef4444';
  return `<div class="ov-card" style="min-width:100px;padding:10px 16px;"><div style="font-size:16px;font-weight:700;color:#1a1a2e;margin-bottom:4px;">${P_ICONS[p]} ${P_NAMES[p]}</div><div style="font-size:22px;font-weight:700;color:${color};">${total ? pct + '%' : '—'}</div><div style="font-size:11px;color:#888;">${appear}/${total}</div></div>`;
}).join('')}
</div>

<h2>📊 品牌出现率</h2>
<table><thead><tr><th>品牌</th>${PLATFORMS.map(p => `<th>${P_ICONS[p]} ${P_NAMES[p]}</th>`).join('')}<th>总计</th><th style="width:160px;">出现次数</th></tr></thead><tbody>
${(() => {
  const maxAppear = Math.max(...activeBrands.map(b => brandStats[b] ? PLATFORMS.reduce((s,p) => s + brandStats[b][p].appear, 0) : 0), 1);
  return activeBrands.map(b => ({ name: b, tAppear: PLATFORMS.reduce((s,p) => s + brandStats[b][p].appear, 0) }))
    .sort((a, b) => b.tAppear - a.tAppear)
    .map(b => {
      const r = brandStats[b.name];
      const c = b.tAppear/allTotal*100 >= 50 ? '#22c55e' : b.tAppear/allTotal*100 >= 20 ? '#f59e0b' : '#ef4444';
      const barW = Math.max(4, b.tAppear / maxAppear * 140);
      const barColor = 'linear-gradient(90deg, #6366f1, #818cf8)';
      return `<tr><td><strong>${esc(b.name)}</strong></td>${PLATFORMS.map(p => {
        const s = r[p]; const pct = s.total > 0 ? (s.appear / s.total * 100) : 0;
        const pc = pct >= 50 ? '#22c55e' : pct >= 20 ? '#f59e0b' : '#ef4444';
        return `<td style="color:${pc};font-weight:600;">${s.total ? pct.toFixed(0)+'%' : '—'} <span style="font-size:11px;color:#888;">(${s.appear}/${s.total})</span></td>`;
      }).join('')}<td style="font-weight:700;color:${c};">${allTotal>0?(b.tAppear/allTotal*100).toFixed(0):0}% <span style="font-size:11px;color:#888;">(${b.tAppear}/${allTotal})</span></td><td><span class="appear-bar" style="width:${barW}px;background:${barColor};"></span> <span style="font-size:11px;color:#888;">${b.tAppear}/${allTotal}</span></td></tr>`;
    }).join('');
})()}
</tbody></table>

<h2>🔀 跨平台品牌出现详情 <a href="data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${xlsxB64}" download="${esc(BRAND_NAME)}排名_${RUN_DATE}.xlsx" style="font-size:12px;color:#3b82f6;text-decoration:none;margin-left:12px;font-weight:400;">📥 下载XLSX</a></h2>
<div style="max-height:600px;overflow:auto;">
<table class="cross-table"><colgroup><col style="width:48px"><col>${PLATFORMS.map(() => '<col style="width:108px">').join('')}</colgroup><thead><tr><th>#</th><th>检索问题</th>${PLATFORMS.map(p => `<th>${P_ICONS[p]} ${P_NAMES[p]}</th>`).join('')}</tr></thead><tbody>
${qList.map((q, i) => {
  return `<tr><td>${i+1}</td><td style="min-width:200px;">${esc(q.question)}</td>${PLATFORMS.map(p => {
    const r = q.platforms[p];
    if (!r) return '<td style="color:#ccc;">—</td>';
    if (r.error) return '<td style="color:#f59e0b;">⚠️</td>';
    const answerBrands = getBrand(r.answerText || '');
    
    const link = r.shareUrl ? ` <a href="${safeUrl(r.shareUrl)}" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:#3b82f6;">🔗</a>` : '';
    const ydRank = getBrandRank(r.answerText || '');
    let rankHtml;
    if (ydRank === -1) {
      rankHtml = '<span class="cross-miss">未出现</span>';
    } else if (ydRank === null) {
      rankHtml = '<span class="cross-rank" title="回答中没有可确认的明确名次">已出现</span>';
    } else {
      const rn = ydRank;
      const medal = rn === 1 ? '🥇 ' : '';
      const color = rn === 1 ? '#22c55e' : rn <= 3 ? '#f59e0b' : '#ef4444';
      rankHtml = `<span style="color:${color};font-weight:700;font-size:15px;">${medal}第${rn}名</span>`;
    }
    return `<td>${rankHtml}${link}</td>`;
  }).join('')}</tr>`;
}).join('')}
</tbody></table></div>

<p class="meta">位次仅表示已识别教育品牌在回答中的顺序（章节、表格行序及正文顺序），不是平台评分或真实市场排名。词表外品牌不参与排序；未出现不计入平均位次。</p>
<h2>📰 引用媒体明细 <a href="data:text/csv;base64,${mediaCSVB64}" download="媒体引用明细_${RUN_DATE}.csv" style="font-size:12px;color:#3b82f6;text-decoration:none;margin-left:12px;font-weight:400;">📥 下载CSV</a></h2>
<p class="meta">仅展示标题明确包含当前品牌名称的引用；不采集引用文章正文或发文数据。</p>
<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
  <select id="selPlatform" onchange="filterMedia()" style="padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;outline:none;background:white;">
    <option value="">全部平台</option>
    ${PLATFORMS.map(p => `<option value="${P_NAMES[p]}">${P_ICONS[p]} ${P_NAMES[p]}</option>`).join('')}
  </select>
  <select id="selCategory" onchange="filterMedia()" style="padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;outline:none;background:white;max-width:120px;">
    <option value="">全部类型</option>
    ${(()=>{const uniq=[];const seen={};mediaRows.forEach(r=>{const c=r.category;if(c&&!seen[c]){seen[c]=true;uniq.push(c)}});return uniq.sort().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');})()}
  </select>
  <select id="selMediaType" onchange="filterMedia()" style="padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;outline:none;background:white;max-width:110px;">
    <option value="">全部媒体类型</option>
    ${(()=>{const uniq=[];const seen={};mediaRows.forEach(r=>{const t=r.mediaType||'其他';if(!seen[t]){seen[t]=true;uniq.push(t)}});return uniq.sort().map(t=>`<option value="${t}">${t}</option>`).join('');})()}
  </select>
  <select id="selMedia" onchange="filterMedia()" style="padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;outline:none;background:white;max-width:120px;">
    <option value="">全部媒体</option>
    ${(()=>{const uniq=[];const seen={};mediaRows.forEach(r=>{if(!seen[r.media]){seen[r.media]=true;uniq.push(r.media)}});return uniq.sort().map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');})()}
  </select>
  <input id="txtSearch" type="text" placeholder="🔍 搜索问题..." style="flex:1;min-width:180px;padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;outline:none;" oninput="filterMedia()">
  <span id="mediaCount" style="font-size:12px;color:#888;white-space:nowrap;">共 ${mediaRows.length} 条</span>
</div>
<div style="height:500px;overflow:auto;">
<table id="mediaTable"><thead><tr><th style="width:80px;">AI平台</th><th style="width:90px;white-space:nowrap;">关键词类型</th><th style="width:80px;">关键词</th><th style="min-width:160px;">问题</th><th style="width:80px;">媒体类型</th><th style="width:90px;">媒体名称</th><th>文章标题</th><th style="width:90px;">发布日期</th></tr></thead><tbody>
${mediaRows.map((r) => `<tr data-platform="${r.platform}" data-category="${esc(r.category||'')}" data-keyword="${esc(r.keyword||'')}" data-mediatype="${esc(r.mediaType||'其他')}" data-media="${esc(r.media)}" data-question="${esc(r.question)}">
  <td style="font-size:12px;">${r.platform}</td>
  <td style="font-size:12px;">${esc(r.category || '')}</td>
  <td style="font-size:12px;">${esc(r.keyword || '')}</td>
  <td style="font-size:12px;">${esc(r.question)}</td>
  <td style="font-size:12px;${r.unknown ? 'color:red;font-weight:600;' : ''}">${esc(r.mediaType || '其他')}</td>
  <td><span class="rank-tag media-tag">${esc(r.media)}</span></td>
  <td><a href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#3b82f6;text-decoration:none;">${esc(r.title.length > 80 ? r.title.substring(0,80) + '...' : r.title)}</a></td>
  <td style="font-size:12px;color:#888;">${esc(r.date || '')}</td>
</tr>`).join('')}
</tbody></table></div>
<script>
// 平台→媒体/类型/媒体类型映射
const platMedias = {};
const platCategories = {};
const platMediaTypes = {};
document.querySelectorAll('#mediaTable tbody tr').forEach(tr => {
  const pf = tr.dataset.platform, md = tr.dataset.media, ct = tr.dataset.category, mt = tr.dataset.mediatype;
  if (!platMedias[pf]) platMedias[pf] = new Set();
  platMedias[pf].add(md);
  if (ct) {
    if (!platCategories[pf]) platCategories[pf] = new Set();
    platCategories[pf].add(ct);
  }
  if (mt) {
    if (!platMediaTypes[pf]) platMediaTypes[pf] = new Set();
    platMediaTypes[pf].add(mt);
  }
});
const allMediaOptions = document.getElementById('selMedia').innerHTML;
const allCategoryOptions = document.getElementById('selCategory').innerHTML;
const allMediaTypeOptions = document.getElementById('selMediaType').innerHTML;

function optionEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
function filterMedia() {
  const pf = document.getElementById('selPlatform').value;
  const selC = document.getElementById('selCategory');
  const selMT = document.getElementById('selMediaType');
  const selM = document.getElementById('selMedia');
  const cat = selC.value;
  const mt = selMT.value;
  const md = selM.value;
  const kw = document.getElementById('txtSearch').value.toLowerCase();

  // 根据平台更新类型下拉选项
  if (pf) {
    const categories = [...(platCategories[pf]||[])].sort();
    selC.innerHTML = '<option value="">全部类型</option>' + categories.map(c => '<option value="' + optionEsc(c) + '">' + optionEsc(c) + '</option>').join('');
    if (cat && !categories.includes(cat)) selC.value = '';
    else if (cat) selC.value = cat;
  } else {
    selC.innerHTML = allCategoryOptions;
    if (cat) selC.value = cat;
  }
  const cat2 = selC.value;

  // 根据平台更新媒体类型下拉选项
  if (pf) {
    const mediaTypes = [...(platMediaTypes[pf]||[])].sort();
    selMT.innerHTML = '<option value="">全部媒体类型</option>' + mediaTypes.map(t => '<option value="' + optionEsc(t) + '">' + optionEsc(t) + '</option>').join('');
    if (mt && !mediaTypes.includes(mt)) selMT.value = '';
    else if (mt) selMT.value = mt;
  } else {
    selMT.innerHTML = allMediaTypeOptions;
    if (mt) selMT.value = mt;
  }
  const mt2 = selMT.value;

  // 根据平台更新媒体下拉选项
  if (pf) {
    const medias = [...(platMedias[pf]||[])].sort();
    selM.innerHTML = '<option value="">全部媒体</option>' + medias.map(m => '<option value="' + optionEsc(m) + '">' + optionEsc(m) + '</option>').join('');
    if (md && !medias.includes(md)) selM.value = '';
    else if (md) selM.value = md;
  } else {
    selM.innerHTML = allMediaOptions;
    if (md) selM.value = md;
  }
  const md2 = selM.value;

  const rows = document.querySelectorAll('#mediaTable tbody tr');
  let count = 0;
  const hasFilter = pf || cat2 || mt2 || md2 || kw;
  rows.forEach(tr => {
    const ok = (!pf || tr.dataset.platform === pf) && (!cat2 || tr.dataset.category === cat2) && (!mt2 || tr.dataset.mediatype === mt2) && (!md2 || tr.dataset.media === md2) && (!kw || tr.dataset.question.toLowerCase().includes(kw));
    tr.style.display = ok ? '' : 'none';
    if (ok) count++;
  });
  document.getElementById('mediaCount').textContent = hasFilter ? '筛选出 ' + count + ' 条' : '共 ' + rows.length + ' 条';
}
</script>

</div></body></html>`;

const outPath = path.join(DASHBOARD_DIR, 'brand-dashboard-' + RUN_DATE + '.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('\n✅ 品牌看板已生成: ' + outPath);
