const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { getBrand, BRAND_NAME, DATA_ROOT, resolveQuestion, isOwnReference } = require('./brand_config.js');
const iconv = require('iconv-lite');

const ROOT = __dirname;
const QUESTIONS_DIR = path.join(ROOT, 'questions');

// --- 日期/路径工具 ---
const cliArgs = process.argv.slice(2);
const argDateIdx = cliArgs.indexOf('--date');
const argQIdx = cliArgs.indexOf('--questions');
const argBatchIdx = cliArgs.indexOf('--batch');

const RUN_DATE = argDateIdx >= 0 ? cliArgs[argDateIdx + 1] : (() => {
  const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
})();
const RUN_DATE_DASH = `${RUN_DATE.slice(0,4)}-${RUN_DATE.slice(4,6)}-${RUN_DATE.slice(6,8)}`;
const DATE_FOLDER = path.join(DATA_ROOT, RUN_DATE_DASH);
// 可选:--out <相对目录> 覆盖批次输出目录(用于一次性调研,避免污染周报批次)
const argOutIdx = cliArgs.indexOf('--out');
const BATCH_DIR = argOutIdx >= 0
  ? path.join(DATA_ROOT, cliArgs[argOutIdx + 1], 'batches')
  : path.join(DATE_FOLDER, 'batches');

if (!fs.existsSync(BATCH_DIR)) fs.mkdirSync(BATCH_DIR, { recursive: true });
if (!fs.existsSync(QUESTIONS_DIR)) fs.mkdirSync(QUESTIONS_DIR, { recursive: true });

// 获取某平台当天的下一个批次序号
function nextBatchSeq(platformKey) {
  const existing = fs.readdirSync(BATCH_DIR).filter(f => f.startsWith(`brand-${platformKey}-${RUN_DATE}`));
  return String(existing.length + 1).padStart(2, '0');
}

// --- 问题加载(UTF-8 CSV,三列:抽查关键词类型, 具体关键词, 检索问题)---
let QUESTIONS_FILE = 'master.csv';
// 可选:--questions-file <csv文件名>(位于 questions/ 目录),默认 master.csv
const argQFileIdx = cliArgs.indexOf('--questions-file');
if (argQFileIdx >= 0 && cliArgs[argQFileIdx + 1]) QUESTIONS_FILE = cliArgs[argQFileIdx + 1];

// 解析 --questions 参数:支持 1-5, 1,3,8,10, 1-5,10-15 等格式
function parseQuestionRange(raw, maxId) {
  const ids = new Set();
  const parts = raw.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [a, b] = trimmed.split('-').map(Number);
      if (!isNaN(a) && !isNaN(b)) {
        for (let i = Math.max(1, a); i <= Math.min(b, maxId); i++) ids.add(i);
      }
    } else {
      const n = Number(trimmed);
      if (!isNaN(n) && n >= 1 && n <= maxId) ids.add(n);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

// 从 master.csv 加载问题(自动检测编码,GBK 自动转 UTF-8 BOM)
function loadQuestions() {
  const masterPath = path.join(QUESTIONS_DIR, QUESTIONS_FILE);
  if (!fs.existsSync(masterPath)) {
    console.error(`未找到 questions/${QUESTIONS_FILE}!`);
    process.exit(1);
  }

  const raw = fs.readFileSync(masterPath);
  let text, needsConvert = false;
  if (raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
    text = iconv.decode(raw, 'utf8').replace(/^\uFEFF/, '');
  } else {
    // GBK → 自动转 UTF-8 BOM,下次直接用
    text = iconv.decode(raw, 'gbk');
    needsConvert = true;
  }
  if (needsConvert) {
    try {
      const utf8Bom = Buffer.from('\uFEFF' + text, 'utf8');
      fs.writeFileSync(masterPath, utf8Bom);
      console.log(`  🔄 ${QUESTIONS_FILE} 已自动转为 UTF-8`);
    } catch(e) {
      // 文件被 Excel 等程序占用,跳过转换(不影响本次运行)
      console.log(`  ⚠️ ${QUESTIONS_FILE} 被占用,跳过转码(关闭 Excel 后重跑一次自动转换)`);
    }
  }
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) { console.error('master.csv 至少需要表头+一行数据'); process.exit(1); }

  const headers = lines[0].split(',').map(h => h.trim());
  const idIdx  = headers.findIndex(h => h.includes('编号'));
  const cIdx   = headers.findIndex(h => h.includes('关键词类型') || h.includes('类型') || h.includes('分类'));
  const kIdx   = headers.findIndex(h => h.includes('具体关键词') || (h.includes('关键词') && !h.includes('类型')));
  const qIdx   = headers.findIndex(h => h.includes('检索问题') || h.includes('问题'));

  const all = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const id = parseInt(cols[idIdx]);
    const q = resolveQuestion((cols[qIdx] || '').trim());
    if (!q || isNaN(id)) continue;
    all.push({ id, question: q, category: (cols[cIdx] || '').trim(), keyword: (cols[kIdx] || '').trim() });
  }

  // 范围过滤
  let selected = all;
  if (argQIdx >= 0) {
    const rangeStr = cliArgs[argQIdx + 1];
    const ids = parseQuestionRange(rangeStr, all.length);
    selected = all.filter(r => ids.includes(r.id));
    console.log(`📋 ${QUESTIONS_FILE} (${all.length}题) → 选择 ${rangeStr} → ${selected.length} 题`);
  } else {
    console.log(`📋 ${QUESTIONS_FILE} → 加载全部 ${selected.length} 题`);
  }
  return selected;
}

// 简易 CSV 行解析(处理引号内含逗号的情况)
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ',' && !inQuote) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

const QUESTIONS = loadQuestions();

const PLATFORMS = {
  deepseek: {
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com',
    inputSelector: 'textarea[placeholder*="DeepSeek"], textarea[placeholder*="发送"]',
    needLogin: true,
    maxWaitCycles: 80,
    questionDelayMs: 12000,  // DeepSeek 限频严格,每题等 12 秒
    detectMode: async (page) => {
      try {
        return await page.evaluate(() => {
          // DeepSeek:顶部有深度思考开关按钮
          const btn = document.querySelector('[aria-selected="true"], [aria-pressed="true"]');
          if (btn) {
            const t = btn.innerText.trim();
            if (t.includes('深度') || t.includes('思考') || t === 'Deep Think') return '深度思考';
            return '快速模式';
          }
          // 备用:搜索全页深度思考相关元素
          const all = document.querySelectorAll('div, span, button');
          for (const el of all) {
            const t = (el.innerText || '').trim();
            if ((t === '深度思考' || t === 'Deep Think') && el.children.length <= 1) {
              const cls = el.className || '';
              if (cls.includes('active') || cls.includes('on') || cls.includes('selected')) return '深度思考';
              return '快速模式';
            }
          }
          return '未知';
        });
      } catch { return '未知'; }
    },
    answerSelector: null, // 动态:排除 think 容器的 ds-markdown
    getAnswerText: async (page) => {
      const html = await page.evaluate(() => {
        const msgs = document.querySelectorAll('[class*="ds-markdown"]');
        let html = '';
        for (const m of msgs) {
          if (m.closest('[class*="think"]')) continue;
          html += m.innerHTML + '<br>';
        }
        if (html) return html;
        // 兜底:找消息区域,排除噪音并取最长文本
        const noiseClasses = ['sidebar', 'nav', 'header', 'footer', 'reference', 'source', 'related', 'suggest', 'recommend', 'panel', 'overlay', 'modal', 'drawer', 'popup', 'mask', 'input', 'toolbar'];
        const candidates = Array.from(document.querySelectorAll('[class*="message"], [class*="answer"], [class*="response"]'));
        const filtered = candidates.filter(c => {
          const inNoise = noiseClasses.some(nc => c.closest('[class*="' + nc + '"]'));
          if (inNoise) return false;
          return !candidates.some(other => other !== c && c.contains(other) && !other.contains(c));
        });
        if (filtered.length > 1) filtered.sort((a,b) => (b.textContent||'').length - (a.textContent||'').length);
        for (const m of filtered.slice(0, 3)) html += m.innerHTML + '<br>';
        return html;
      });
      return htmlToStructuredText(html);
    },
    loggedInCheck: async (page) => {
      try {
        const input = await page.$('textarea[placeholder*="DeepSeek"]');
        if (input) {
          const qrCode = await page.$('text=扫码登录');
          if (qrCode) return false;
          return true;
        }
        return false;
      } catch(e) { return false; }
    },
  },
  doubao: {
    name: '豆包',
    url: 'https://www.doubao.com/chat',
    inputSelector: 'div[contenteditable="true"], [role="textbox"], textarea[placeholder*="发消息"], textarea[placeholder*="说话"]',
    needLogin: true,
    maxWaitCycles: 50,  // 最多等 75 秒，避免过长等待
    questionDelayMs: 10000,  // 全平台统一题间延迟
    detectMode: async (page) => {
      try {
        return await page.evaluate(() => {
          // 豆包深度思考检测:基于真实 DOM -
          // 按钮有 data-checked="true"(开启)或 data-checked="false"(关闭)
          // 按钮内文字为"思考",父容器有 data-valid-btn="mode-select-action-btn"
          const btn = document.querySelector('[data-checked]');
          if (btn) {
            return btn.getAttribute('data-checked') === 'true' ? '深度思考' : '快速模式';
          }
          // 备用:通过 data-valid-btn 找到模式选择容器
          const container = document.querySelector('[data-valid-btn="mode-select-action-btn"]');
          if (container) {
            const innerBtn = container.querySelector('button[data-checked]');
            if (innerBtn) {
              return innerBtn.getAttribute('data-checked') === 'true' ? '深度思考' : '快速模式';
            }
          }
          // 兜底:遍历文字匹配
          const all = document.querySelectorAll('div, span, button');
          for (const el of all) {
            const t = (el.innerText || '').trim();
            if ((t === '深度思考' || t === '快速') && el.children.length <= 1) {
              if (t === '快速') return '深度思考';
              return '快速模式';
            }
          }
          return '未知';
        });
      } catch { return '未知'; }
    },
    answerSelector: null, // 动态:排除 thinking-box
    getAnswerText: async (page) => {
      const html = await page.evaluate(() => {
        // 参考文心一言写法：找所有已完成的回答，取最后一个
        // 豆包回答区域特征：data-streaming="false" + class 包含 md-box-root
        const finishedBoxes = document.querySelectorAll('[data-streaming="false"].md-box-root');
        if (finishedBoxes.length > 0) {
          return finishedBoxes[finishedBoxes.length - 1].innerHTML;
        }
        // 兜底：取最后一个 .md-box-root（避免抓到问题区域）
        const allBoxes = document.querySelectorAll('.md-box-root');
        if (allBoxes.length > 0) {
          return allBoxes[allBoxes.length - 1].innerHTML;
        }
        return '';
      });
      return htmlToStructuredText(html);
    },
    loggedInCheck: async (page) => {
      try {
        const btn = await page.$('text=登录');
        if (btn) return false;
        const input = await page.$('textarea[placeholder*="发消息"]');
        if (input) return true;
        return false;
      } catch(e) { return false; }
    },
  },
  yiyan: {
    name: '文心一言',
    url: 'https://chat.baidu.com/',
    inputSelector: 'textarea, [contenteditable="true"]',
    needLogin: true,
    maxWaitCycles: 80,
    questionDelayMs: 15000,  // 文心反爬严格,每题间隔 15 秒
    stableThreshold: 8,  // 文心一言流式输出偶尔卡顿缓冲,需要更宽松的稳定检测
    detectMode: async (page) => {
      try {
        return await page.evaluate(() => {
          // 文心一言:深度思考按钮 class 含 item__ 和 active__
          const activeItem = document.querySelector('[class*="item__"][class*="active__"]');
          if (activeItem) {
            const t = (activeItem.innerText || activeItem.textContent || '').trim();
            // "文心 5.1 思考" = 深度思考模式
            if (t.includes('思考') || t.includes('深度')) return '深度思考';
            return '快速模式';
          }
          // 备用:文字匹配
          const all = document.querySelectorAll('div, span, button, label');
          for (const el of all) {
            const t = (el.innerText || el.textContent || '').trim();
            if ((t === '深度思考' || t === '深度推理' || t === '快速回答' || t === '快速模式' || t === '文心 5.1 思考') && el.children.length <= 1) {
              const cls = (el.className || '') + ((el.parentElement?.className || ''));
              if (cls.includes('active') || el.getAttribute('aria-pressed') === 'true') {
                return t.includes('深度') || t.includes('思考') ? '深度思考' : '快速模式';
              }
            }
          }
          return '未知';
        });
      } catch { return '未知'; }
    },
    setMode: async (page) => {
      try {
        const before = await PLATFORMS.yiyan.detectMode(page);
        console.log(`  🔄 当前模式: ${before}，切换到文心 5.1...`);

        // 步骤1: 点击模式选择器按钮，展开模式菜单
        const modeBtn = page.locator('[data-testid="chat-mode-selector"]');
        await modeBtn.waitFor({ state: 'visible', timeout: 8000 });
        await modeBtn.click();
        await sleep(1000);

        // 步骤2: 点击模型行，展开模型 cascade 面板
        const modelRow = page.locator('[data-testid="chat-mode-model-row"]');
        if (await modelRow.isVisible({ timeout: 5000 })) {
          await modelRow.click();
          await sleep(1000);
        } else {
          console.log('  ⚠️ 模型行不可见，跳过切换');
          return;
        }

        // 步骤3: 点击"文心 5.1" cascade item
        const wenxinItem = page.locator('.ci-input-mode-cascade-item').filter({ hasText: '文心 5.1' });
        if (await wenxinItem.isVisible({ timeout: 5000 })) {
          await wenxinItem.click();
          console.log('  ✅ 已点击"文心 5.1"');
        } else {
          // 备用: force 点击
          await wenxinItem.click({ force: true });
          console.log('  ✅ force点击"文心 5.1"');
        }

        await sleep(2000);
        const after = await PLATFORMS.yiyan.detectMode(page);
        console.log(`  🔄 切换后模式: ${after}`);
      } catch(e) {
        console.log(`  ⚠️ setMode 异常: ${e.message.substring(0, 80)}`);
      }
    },
    answerSelector: 'div.cosd-markdown-content',
    getAnswerText: async (page) => {
      const html = await page.evaluate(() => {
        var containers = document.querySelectorAll('div.cs-history-answer div.cosd-markdown-content');
        var el = containers.length > 0 ? containers[containers.length - 1] : document.querySelector('div.cosd-markdown-content');
        return el ? el.innerHTML : '';
      });
      return htmlToStructuredText(html);
    },
    loggedInCheck: async (page) => {
      try {
        const notLoggedIn = await page.$('text=未登录');
        if (notLoggedIn) return false;
        const loginBtn = await page.$('button:has-text("登录")');
        if (loginBtn) return false;
        const input = await page.$('textarea, [contenteditable="true"]');
        if (input) return true;
        return false;
      } catch(e) { return false; }
    },
  },
  yuanbao: {
    name: '腾讯元宝',
    url: 'https://yuanbao.tencent.com',
    inputSelector: 'textarea, [contenteditable="true"]',
    needLogin: true,
    maxWaitCycles: 80,
    questionDelayMs: 10000,  // 全平台统一题间延迟
    detectMode: async (page) => {
      try {
        return await page.evaluate(() => {
          // 元宝深度思考检测:基于真实 DOM
          // 按钮有 dt-button-id="deep_think",选中时 class 含 ThinkSelector_selected
          const btn = document.querySelector('[dt-button-id="deep_think"]');
          if (btn) {
            const cls = btn.className || '';
            return cls.includes('ThinkSelector_selected') ? '深度思考' : '快速模式';
          }
          // 备用:通过"深度思考"文字查找
          const all = document.querySelectorAll('div, span');
          for (const el of all) {
            const t = (el.innerText || el.textContent || '').trim();
            if ((t === '深度思考' || t === '快速回答' || t === '深度思考 · 联网搜索') && el.children.length <= 1) {
              if (t === '快速回答') return '深度思考';
              if (t === '深度思考' || t === '深度思考 · 联网搜索') return '深度思考';
            }
          }
          return '未知';
        });
      } catch { return '未知'; }
    },
    answerSelector: 'div.hyc-common-markdown',
    getAnswerText: async (page) => {
      const html = await page.evaluate(() => {
        // 元宝:限定在 AI 回答区域内找 hyc-common-markdown,跳过思考块
        const aiBubble = document.querySelector('[class*="agent-chat__bubble--ai"], [class*="agent-chat__conv--ai"], [class*="agent-chat__list__item--ai"]');
        const scope = aiBubble || document;
        const allMds = scope.querySelectorAll('div.hyc-common-markdown');
        if (allMds.length > 0) {
          let html = '';
          for (const md of allMds) {
            // 跳过思考/推理块,跳过参考抽屉
            if (md.closest('[class*="think"], [class*="reasoning"], [class*="fold"], [class*="references"], [class*="drawer"]')) continue;
            html += md.innerHTML + '\n';
          }
          if (html.trim()) return html;
          // 全被过滤 = 只有思考/参考内容,取全部做兜底
          html = '';
          for (const md of allMds) html += md.innerHTML + '\n';
          return html;
        }
        const noiseClasses = ['sidebar', 'nav', 'header', 'footer', 'reference', 'source', 'related', 'suggest', 'recommend', 'panel', 'overlay', 'modal', 'drawer', 'popup', 'mask', 'input', 'toolbar'];
        const candidates = Array.from(document.querySelectorAll('[class*="message"], [class*="answer"], [class*="response"], [class*="chat"], [class*="markdown"]'));
        const filtered = candidates.filter(c => {
          const inNoise = noiseClasses.some(nc => c.closest('[class*="' + nc + '"]'));
          if (inNoise) return false;
          return !candidates.some(other => other !== c && c.contains(other) && !other.contains(c));
        });
        if (filtered.length > 1) filtered.sort((a,b) => (b.textContent||'').length - (a.textContent||'').length);
        let html = '';
        for (const m of filtered.slice(0, 3)) html += m.innerHTML + '<br>';
        return html;
      });
      return htmlToStructuredText(html);
    },
    loggedInCheck: async (page) => {
      try {
        const notLoggedIn = await page.$('text=未登录');
        if (notLoggedIn) return false;
        const loginBtn = await page.$('button:has-text("登录")');
        if (loginBtn) return false;
        const input = await page.$('textarea, [contenteditable="true"]');
        if (input) return true;
        return false;
      } catch(e) { return false; }
    },
  },
  qianwen: {
    name: '通义千问',
    url: 'https://www.qianwen.com/?source=tongyigw',
    inputSelector: '[contenteditable="true"], textarea',
    needLogin: true,
    maxWaitCycles: 160,  // 240 秒窗口:联网搜索回答慢时能等到(稳定即提前退出)
    maxRetries: 2,       // 空回答自动重发次数(0=关闭)
    questionDelayMs: 10000,
    detectMode: async (page) => {
      try {
        return await page.evaluate(() => {
          // 千问:深度思考按钮有 data-input-login-gate="deep-think:primary"
          const btn = document.querySelector('[data-input-login-gate="deep-think:primary"]');
          if (btn) {
            return btn.getAttribute('aria-pressed') === 'true' ? '深度思考' : '快速模式';
          }
          // 备用:通过文字查找
          const all = document.querySelectorAll('div, span, button');
          for (const el of all) {
            const t = (el.innerText || el.textContent || '').trim();
            if ((t === '深度思考' || t === '思考') && el.children.length <= 1) {
              const pressed = el.getAttribute('aria-pressed');
              if (pressed === 'true') return '深度思考';
              if (pressed === 'false') return '快速模式';
              // 继续找下一个
            }
          }
          return '未知';
        });
      } catch { return '未知'; }
    },
    answerSelector: 'div.answer-common-card',
    getAnswerText: async (page) => {
      const html = await page.evaluate(() => {
        // 千问:答案内容在 chat 消息流中,排除导航/CSS/JSON 等一切非回答内容

        // 1. 精确选择器(取最后一条回答,适配同会话多轮问答)
        const primaryNodes = document.querySelectorAll('[class*="answer-common-card"], [class*="answerCommonCard"], [class*="chat-content"], [class*="chatContent"], [class*="message-content"], [class*="messageContent"]');
        const primary = primaryNodes.length > 0 ? primaryNodes[primaryNodes.length - 1] : null;
        if (primary) {
          const clone = primary.cloneNode(true);
          // 清理:参考资料/来源/建议/思维链/script/style/code/任何含JSON的节点
          clone.querySelectorAll('[class*="reference"], [class*="source"], [class*="citation"], [class*="suggest"], [class*="recommend"], [class*="related"], [class*="input"], [class*="toolbar"], [class*="video_note"], [class*="think"], [class*="thinking"], [class*="reasoning"], [class*="thought"], script, style, link, [class*="hydrate"], code, pre, [data-render-engine], [class*="initialData"], [class*="__NEXT_DATA"]').forEach(n => n.remove());
          const t = clone.textContent.trim();
          if (t.length > 50) {
            // DOM级清扫:删掉文本含 JSON / CSS / 函数调用的非内容节点
            clone.querySelectorAll('div, span, section').forEach(n => {
              const txt = (n.textContent || '').trim();
              if ((txt.startsWith('{') && /"data"|"initial|"original|"reqId"/.test(txt)) ||
                  txt.startsWith('window._hydrate') || txt.startsWith('window.__') ||
                  (txt.startsWith('.') && /{.*}/.test(txt))) {
                n.remove();
              }
            });
            return clone.innerHTML;
          }
        }

        // 2. 兜底
        const noiseClasses = ['sidebar', 'nav', 'header', 'footer', 'reference', 'source', 'related', 'suggest', 'recommend', 'input', 'toolbar', 'action', 'share', 'feedback', 'rating', 'login', 'advertising', 'video_note', 'container-'];
        const candidates = Array.from(document.querySelectorAll('[class*="message"], [class*="answer"], [class*="response"], [class*="chat"], [class*="dialog"], [class*="conversation"]'));
        const filtered = candidates.filter(c => {
          if (c.tagName === 'BODY' || c.tagName === 'HTML') return false;
          const inNoise = noiseClasses.some(nc => c.closest && c.closest('[class*="' + nc + '"]'));
          if (inNoise) return false;
          const txt = (c.textContent || '').trim();
          if (txt.length < 100) return false;
          if (txt.startsWith('{') && txt.endsWith('}')) return false;
          if (txt.startsWith('.') && txt.includes('{')) return false;
          return !candidates.some(other => other !== c && c.contains(other) && !other.contains(c));
        });
        if (filtered.length > 1) filtered.sort((a,b) => (b.textContent||'').length - (a.textContent||'').length);
        for (const m of filtered.slice(0, 2)) {
          const clone = m.cloneNode(true);
          clone.querySelectorAll('script, style, code, pre, [class*="hydrate"], [class*="initialData"], [data-render-engine]').forEach(n => n.remove());
          const t = clone.textContent.trim();
          if (t.length > 100) {
            clone.querySelectorAll('div, span, section').forEach(n => {
              const txt = (n.textContent || '').trim();
              if ((txt.startsWith('{') && /"data"|"initial|"original|"reqId"/.test(txt)) ||
                  txt.startsWith('window._hydrate') || txt.startsWith('window.__') ||
                  (txt.startsWith('.') && /{.*}/.test(txt))) {
                n.remove();
              }
            });
            return clone.innerHTML;
          }
        }
        return '';
      });
      let text = htmlToStructuredText(html);
      // 千问深度思考文本裁剪：裁掉"深度思考已完成"开头的思考过程
      if (text.startsWith('深度思考已完成')) {
        var structuralMark = text.search(/\n#{1,3}\s/);
        if (structuralMark > 0) text = text.substring(structuralMark);
      }
      return text;
    },
    loggedInCheck: async (page) => {
      try {
        const loginBtn = await page.$('button:has-text("登录")');
        if (loginBtn) return false;
        const input = await page.$('[contenteditable="true"]');
        if (input) return true;
        return false;
      } catch(e) { return false; }
    },
    beforeInput: async (page) => {
      try {
        const btn = page.locator('[data-input-login-gate="deep-think:primary"]').first();
        await btn.waitFor({ state: 'visible', timeout: 5000 });
        const pressed = await btn.getAttribute('aria-pressed');
        if (pressed === 'true') {
          console.log('  🧠 思考模式已开启,跳过点击');
          return;
        }
        await btn.click();
        await sleep(600);
        console.log('  🧠 已点击"思考"按钮,开启深度思考模式');
      } catch (e) {
        console.log('  ⚠️ 未找到"思考"按钮,继续快速模式');
      }
    },
  }
};

// 共用:清理 answerText 中的非法 JSON 控制字符
function sanitizeAnswerText(text) {
  if (!text) return text;
  // 移除会破坏 JSON 的控制字符(U+2028行分隔符、U+2029段分隔符、ASCII控制符)
  return text.replace(/\u2028/g, '').replace(/\u2029/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// 共用:将 HTML 回答转成保留 markdown 结构的纯文本
function htmlToStructuredText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<h([1-3])[^>]*>/gi, (_, n) => '\n' + '#'.repeat(parseInt(n)) + ' ')
    .replace(/<\/h[1-3]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/t[dh]>/gi, ' |')
    .replace(/<t[dh][^>]*>/gi, ' ')
    .replace(/<\/tr>/gi, ' |\n')
    .replace(/<tr[^>]*>/gi, '| ')
    .replace(/<\/table>/gi, '\n')
    .replace(/<table[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    // JSON 数据块一刀切:遇到 {"data", window._hydrate, CSS 规则行,全部截断
    .replace(/\{("data"|"initialData"|"originalData")[\s\S]*$/, '')
    .replace(/window\._hydrate[\s\S]*$/, '')
    .replace(/^(\.|#|@)[\w-]+\s*\{[\s\S]*$/m, '')
    .replace(/\n{3,}/g, '\n\n')
    // 剥离引用脚标:[1] [30] [1,2,3] [1-3] [1][2]、Unicode上标123、以及DeepSeek的--N/-N标记
    .replace(/\[\d+(?:[,,\---]\d+)*\]/g, '')
    .replace(/[\u00B9\u00B2\u00B3\u2070\u2074\u2075\u2076\u2077\u2078\u2079]+/g, '')
    .replace(/--?\d{1,2}(?![\d%])/g, '')
    .trim();
}

// 文心回答末尾嵌入了搜索结果片段,截断以减少噪音
function stripReferenceSection(text) {
  if (!text) return text;
  var refLine = /(?:百度文库|百度知道|搜狐网|什么值得买|凤凰网|新浪财经|新浪|腾讯|网易|哔哩哔哩|B站|bilibili|知乎|小红书|抖音|voc\.com|sohu\.com|zhihu\.com).*\d{4}年\d{1,2}月\d{1,2}日/;
  var urlLine = /https?:\/\//;
  var lines = text.split('\n');
  var matchLines = [];
  for (var i = lines.length - 1; i >= 0; i--) {
    var line = lines[i].trim();
    if (refLine.test(line) || urlLine.test(line)) matchLines.push(i);
  }
  if (matchLines.length < 2) return text;
  // 取最早的匹配行(离正文最近),往前回溯到参考区块真正起点
  var cutLine = matchLines[matchLines.length - 1];  // 最小行号 = 离正文最近
  // 往前回溯到参考区块真正起点(跳过空行、缩进格式)
  for (var j = cutLine - 1; j >= Math.max(0, cutLine - 50); j--) {
    var prev = lines[j].trim();
    if (!prev) continue;  // 跳过空行和缩进
    if (!refLine.test(prev) && !urlLine.test(prev)) { cutLine = j; }
    else { break; }  // 碰到下一条参考条目,停止回溯
  }
  return lines.slice(0, cutLine).join('\n').trim() || text;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 随机延迟:base ± spread 范围内随机(毫秒),最低 500ms
function randSleep(baseMs, spreadMs) {
  const ms = Math.max(500, baseMs + (Math.random() * 2 - 1) * spreadMs);
  return new Promise(r => setTimeout(r, ms));
}
// 随机打字延迟函数(Playwright type 的 delay 参数支持函数)
function randTypeDelay() { return 20 + Math.floor(Math.random() * 80); }  // 20~100ms

async function ensureLoggedIn(page, platformKey) {
  const p = PLATFORMS[platformKey];
  if (!p.needLogin) return true;

  console.log('  🔍 检测登录状态...');
  // SPA 页面:用 commit 快速触发导航,不等 load/domcontentloaded
  try {
    await page.goto(p.url, { waitUntil: 'commit', timeout: 15000 });
  } catch(e) {
    console.log('  ⚠️ 导航异常: ' + e.message.substring(0, 60));
  }
  // console.log('  ⏳ 等待页面渲染 (10s)...');
  await sleep(10000);

  let loggedIn = await p.loggedInCheck(page);
  if (loggedIn) {
    console.log('  ✅ 已登录');
    return true;
  }

  console.log('  ⚠️ 未登录!请在浏览器窗口中手动扫码登录');
  console.log('  ⏰ 等待 120 秒超时...');

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await sleep(3000);
    try {
      loggedIn = await p.loggedInCheck(page);
      if (loggedIn) {
        console.log('  ✅ 登录成功!继续执行');
        return true;
      }
    } catch(e) {}
    const remain = Math.ceil((deadline - Date.now()) / 1000);
    if (remain % 15 === 0 && remain > 0) {
      console.log(`  ⏰ 剩余 ${remain} 秒...`);
    }
  }

  console.log('  ❌ 登录超时,跳过此平台');
  return false;
}

// 提交问题到输入框(含限频自愈重试),首轮与空回答重发共用
async function submitQuestion(page, inputBox, question) {
  await sleep(500 + Math.random() * 1500);  // 模拟人类:提问前犹豫 0.5~2 秒
  await inputBox.click();
  await sleep(300);

  // 千问的 contenteditable 不能用 fill(),需要用 type() 清空后输入
  try { await inputBox.fill(''); } catch(e) {}

  await inputBox.type(question, { delay: randTypeDelay() });
  await sleep(300 + Math.random() * 700);  // 0.3~1s 随机停顿
  await page.keyboard.press('Enter');
  console.log('  ✅ 已提交,等待回答...');

  // 限频检测:DeepSeek 等平台可能返回"发送过于频繁"
  for (let rateRetry = 0; rateRetry < 3; rateRetry++) {
    await sleep(2000);
    const rateLimit = await page.evaluate(() => {
      const body = document.body.innerText || '';
      return body.includes('过于频繁') || body.includes('稍后重试') || body.includes('请稍后再试');
    }).catch(() => false);
    if (!rateLimit) break;
    const waitSec = (rateRetry + 1) * 10;
    console.log(`  ⚠️ 检测到限频提示,${waitSec}s 后重试 (${rateRetry+1}/3)...`);
    await sleep(waitSec * 1000);
    await sleep(300 + Math.random() * 700);  // 随机犹豫
    await inputBox.click();
    await sleep(300);
    try { await inputBox.fill(''); } catch(e) {}
    await inputBox.type(question, { delay: randTypeDelay() });
    await sleep(300 + Math.random() * 700);
    await page.keyboard.press('Enter');
    console.log('  🔄 已重新提交...');
  }
}

// 等待回答稳定(maxCycles 轮 × 1.5s),并检测思考模式
// 容错:单次抓取异常(页面导航等)跳过本轮,连续 6 次异常才放弃
async function waitForAnswer(page, p, maxCycles) {
  let lastLen = 0, stable = 0, answerText = '';
  let evalErrors = 0;
  const stableThreshold = p.stableThreshold || 4;
  for (let t = 0; t < maxCycles; t++) {
    await sleep(1500);
    try {
      answerText = await p.getAnswerText(page);
      answerText = sanitizeAnswerText(answerText);
      evalErrors = 0;
    } catch(e) {
      if (++evalErrors >= 6) {
        console.log('  ⚠️ 连续 6 次抓取异常,放弃本轮等待');
        break;
      }
      continue;  // 偶发导航等:跳过本轮,下一轮继续
    }
    if (answerText && answerText.length >= 50 && answerText.length === lastLen) {
      stable++;
      if (stable >= stableThreshold) break;
    } else {
      stable = 0;
      lastLen = answerText.length;
    }
  }

  let thinkingMode = '未知';
  try {
    const hasThinking = await page.evaluate(() => {
      // 只在回答/消息区域查找(排除输入框/按钮等UI),避免误判
      const messageContainers = document.querySelectorAll(
        '[class*="message"], [class*="answer"], [class*="response"], [class*="chat-message"], [class*="bot"], [class*="assistant"]'
      );
      const searchRoots = messageContainers.length > 0 ? Array.from(messageContainers) : [document.body];
      const selectors = [
        '[class*="thinking-box"]', '[class*="thought"]',
        '[class*="reasoning"]', '[class*="deep-thinking"]',
        '[class*="think-content"]', '[class*="think-container"]',
      ];
      for (const root of searchRoots) {
        for (const sel of selectors) {
          try {
            const el = root.querySelector(sel);
            if (el && el.innerText && el.innerText.trim().length > 10) return true;
          } catch(e) {}
        }
      }
      return false;
    });
    if (hasThinking) {
      thinkingMode = '深度思考';
      console.log('  🧠 检测: 深度思考 (回答中有思考过程)');
    } else {
      thinkingMode = '快速模式';
      console.log('  🧠 检测: 快速模式 (回答中无思考过程)');
    }
  } catch(e) {}
  return { answerText, thinkingMode };
}

async function searchQuestion(page, platformKey, question, idx, skipNav = false) {
  const p = PLATFORMS[platformKey];
  console.log(`\n[${p.name}] Q${idx+1}: ${question}`);

  try {
    if (skipNav) {
      console.log('  ⏭️ 复用当前页面(首次跳过导航)');
    } else {
      console.log('  ⏳ 加载页面...');
      try {
        await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      } catch(e) {
        console.log('  ⚠️ 导航异常: ' + e.message.substring(0, 60));
      }
    }

    // 豆包:确保在"对话"模式(非"工作"模式),避免工作模式下联网搜索被限
    if (platformKey === 'doubao') {
      try {
        await page.evaluate(() => {
          // 按 Escape 清弹窗
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          // 找"对话"按钮(与"工作"并列的标签)
          const btns = document.querySelectorAll('button');
          for (const b of btns) {
            if ((b.textContent || '').trim() === '对话') {
              b.click();
              return 'clicked';
            }
          }
          // 降级:找包含"对话"文字的按钮
          for (const b of btns) {
            const t = (b.textContent || '').trim();
            if (t.includes('对话') && t.length <= 4) {
              b.click();
              return 'clicked_fuzzy';
            }
          }
          return 'not_found';
        });
        await sleep(1500);
      } catch(e) { /* 静默处理,不影响后续流程 */ }
    }

    // 思考模式:回答后统一检测,不依赖界面开关(更准)
    let thinkingMode = '未知';

    let inputBox, found = false;
    for (let retry = 0; retry < 3; retry++) {
      try {
        inputBox = page.locator(p.inputSelector).first();
        await inputBox.waitFor({ state: 'visible', timeout: 10000 });
        found = true;
        break;
      } catch(e) {
        if (retry < 2) {
          console.log(`  ⚠️ 输入框未出现,刷新重试 (${retry+1}/3)...`);
          await page.reload({ waitUntil: 'domcontentloaded' });
          await sleep(4000);
        }
      }
    }
    if (!found) {
      console.log(`  ❌ 输入框未找到,跳过此题`);
      return { platform: platformKey, question, answerText: '', charCount: 0, hasBrand: false, brandName: BRAND_NAME, shareUrl: '', references: [], thinkingMode: '未知', isOffline: true, refStatus: '异常', error: 'input_not_found' };
    }

    // 文心一言:每题提问前切换到"文心 5.1"深度思考模式
    if (p.setMode) {
      try {
        await p.setMode(page);
      } catch(e) {
        console.log(`  ⚠️ 模式切换失败: ${e.message.substring(0, 50)}`);
      }
    }

    // 平台特定:提问前的准备工作(如开启深度思考)
    if (p.beforeInput) {
      await p.beforeInput(page);
    }

    // 拒绝回答检测文案(定义在此,供下方重发逻辑与最终分析复用)
    const refusePatterns = [
      '暂时无法回答', '换个话题', '无法提供', '不能回答', '无法回答这个问题',
      '抱歉,我无法', '我无法帮助你', '无法协助', '恕我无法'
    ];

    // ====== 提交问题(含限频自愈) ======
    await submitQuestion(page, inputBox, question);

    // ====== 等待回答(首轮,完整窗口) ======
    let waitResult = await waitForAnswer(page, p, p.maxWaitCycles || 80);
    let answerText = waitResult.answerText;
    thinkingMode = waitResult.thinkingMode;

    // ====== 空回答自动重发(按平台配置 maxRetries,默认关闭) ======
    const maxRetries = p.maxRetries || 0;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const isEmpty = !answerText || answerText.length < 50;
      const isRefused = refusePatterns.some(pat => answerText.includes(pat));
      if (!isEmpty || isRefused) break;

      // 限频前置检查:命中则等 30s 再确认一次,仍命中则放弃
      const checkRateLimit = () => page.evaluate(() => {
        const body = document.body.innerText || '';
        return body.includes('过于频繁') || body.includes('稍后重试') || body.includes('请稍后再试');
      }).catch(() => false);
      if (await checkRateLimit()) {
        console.log('  ⚠️ 检测到限频提示,等 30s 后再试...');
        await sleep(30000);
        if (await checkRateLimit()) {
          console.log('  ❌ 限频持续,放弃重发');
          break;
        }
      }

      // 随机间隔,降低连续提交触发风控的概率
      const gapMs = attempt === 1 ? 8000 + Math.random() * 7000 : 15000 + Math.random() * 5000;
      console.log(`  ⏳ Q${idx+1} 第${attempt}次重发(原因:正文为空),${Math.round(gapMs/1000)}s 后重试...`);
      await sleep(gapMs);

      // 优先点"新建对话"开新会话(干净,避免多轮混淆)
      try {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('button, div, span')) {
            const t = (el.textContent || '').trim();
            if (t === '新建对话' && el.children.length <= 1) { el.click(); return; }
          }
        });
        await sleep(2000);
      } catch(e) {}

      // 重新定位输入框(页面可能已变化)
      let retryBox = null;
      for (let r = 0; r < 3; r++) {
        try {
          retryBox = page.locator(p.inputSelector).first();
          await retryBox.waitFor({ state: 'visible', timeout: 10000 });
          break;
        } catch(e) {
          if (r < 2) {
            console.log(`  ⚠️ 重发输入框未出现,刷新重试 (${r+1}/3)...`);
            await page.reload({ waitUntil: 'domcontentloaded' });
            await sleep(4000);
          }
        }
      }
      if (!retryBox) {
        console.log('  ❌ 重发时输入框未找到,放弃');
        break;
      }

      await submitQuestion(page, retryBox, question);
      // 重发窗口递减:服务端已热,通常更快
      const retryCycles = attempt === 1 ? 120 : 100;
      waitResult = await waitForAnswer(page, p, retryCycles);
      answerText = waitResult.answerText;
      thinkingMode = waitResult.thinkingMode;
    }

    // ====== 抓取分享链接 ======
    let shareUrl = '';
    try {
      const pageUrl = page.url();
      // console.log(`  🔍 当前页面 URL: ${pageUrl.substring(0, 100)}`);

      // 各平台对话 URL 本身就是分享链接
      const urlPatterns = {
        doubao: /\/chat\/\d+/,
        deepseek: /\/a\/chat\/s\//,
        yiyan: /(?:yiyan\.baidu\.com|chat\.baidu\.com)\/chat\//,
        yuanbao: /yuanbao\.(tencent|qq)\.com\/chat\//,
        qianwen: /tongyi\.aliyun\.com\/qianwen\/|\/share\//i,
      };

      if (urlPatterns[platformKey]?.test(pageUrl)) {
        shareUrl = pageUrl;
      }

      // 千问/文心:URL 变化即对话链接(含 session ID)
      if (!shareUrl && (platformKey === 'qianwen' || platformKey === 'yiyan')) {
        const startUrl = p.url;
        if (pageUrl !== startUrl) {
          shareUrl = pageUrl;
        }
      }
      if (!shareUrl && platformKey === 'doubao') {
        try {
          const clicked = await page.evaluate(() => {
            const actionBar = document.querySelector('.message-action-button-main');
            if (!actionBar) return 'no-action-bar';
            const btns = actionBar.querySelectorAll('button');
            if (btns.length < 5) return 'too-few-btns';
            btns[4].click(); // 0=复制, 1=朗读, 2=点赞, 3=点踩, 4=分享
            return 'clicked';
          });
          if (clicked === 'clicked') {
            await sleep(1500);
            await page.evaluate(() => {
              for (const el of document.querySelectorAll('button, span, div')) {
                if ((el.textContent || '').trim() === '复制链接') { el.click(); return; }
              }
            });
            await sleep(800);
            const clipUrl = await page.evaluate(async () => {
              try { return await navigator.clipboard.readText(); } catch (e) { return ''; }
            });
            if (clipUrl?.startsWith('https://')) shareUrl = clipUrl;
            await page.keyboard.press('Escape');
            await sleep(300);
          }
        } catch (e) { /* 降级到 page.url() */ }
      }
      // 文心(chat.baidu.com):点击分享→复制链接获取 URL
      if (!shareUrl && platformKey === 'yiyan') {
        try {
          const shareBtn = page.locator('[data-testid="menu-btn-share"], span[class*="menu-item"]:has(i[class*="share"]), ._menu-item_haof8_1').first();
          if (await shareBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await shareBtn.click();
            await sleep(1000);
            // 找"复制链接"按钮
            const copyBtn = page.locator('span:has-text("复制链接"), div:has-text("复制链接"), button:has-text("复制链接")').first();
            if (await copyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
              await copyBtn.click();
              await sleep(800);
              const clipUrl = await page.evaluate(async () => {
                try { return await navigator.clipboard.readText(); } catch (e) { return ''; }
              });
              if (clipUrl?.startsWith('https://')) shareUrl = clipUrl;
            }
            await page.keyboard.press('Escape');
            await sleep(300);
          }
        } catch (e) { /* 降级 */ }
      }

      if (shareUrl) {
        console.log(`  🔗 分享链接: ${shareUrl.substring(0, 80)}...`);
      } else {
        console.log(`  ⚠️ 未获取到分享链接`);
      }
    } catch (urlErr) {
      console.log(`  ⚠️ 分享链接抓取失败: ${urlErr.message}`);
      shareUrl = '';
    }

    // ====== 抓取参考资料(AI 联网搜索的源文件) ======
    let references = [];
    try {
      const isDoubao = platformKey === 'doubao';
      const isDeepSeek = platformKey === 'deepseek';
      const isYiyan = platformKey === 'yiyan';
      const isYuanbao = platformKey === 'yuanbao';
      const isQianwen = platformKey === 'qianwen';

      // === 豆包:导航到分享链接后从 _ROUTER_DATA 提取参考资料 ===
      // 更新 2026-07-27: SPA实时流中 _ROUTER_DATA 不更新,改为导航到分享链接(整页加载)后提取
      if (isDoubao) {
        try {
          if (shareUrl) {
            console.log(`  🔍 导航到分享链接提取参考资料...`);
            await page.goto(shareUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await sleep(3000);
            references = await page.evaluate(() => {
              const refs = [];
              const seen = new Set();

              function findBlock(obj, visited) {
                if (!obj || typeof obj !== 'object' || visited.has(obj)) return;
                visited.add(obj);
                if (obj.search_query_result_block) {
                  for (const r of (obj.search_query_result_block.results || [])) {
                    const tc = r.text_card;
                    if (tc && tc.url && tc.title) {
                      const url = tc.url;
                      if (url.startsWith('http') && !url.includes('doubao.com') && !url.includes('volcengine') && !seen.has(url)) {
                        seen.add(url);
                        refs.push({ title: tc.title, url: url });
                      }
                    }
                  }
                  return;
                }
                if (Array.isArray(obj)) { for (const v of obj) findBlock(v, visited); }
                else { for (const v of Object.values(obj)) findBlock(v, visited); }
              }

              if (window._ROUTER_DATA) findBlock(window._ROUTER_DATA, new WeakSet());
              return refs;
            });
            console.log(`  📄 豆包参考资料: ${references.length} 条`);
            // 导航回聊天页,准备下一题
            await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await sleep(1500);
          } else {
            console.log(`  ⚠️ 豆包无分享链接,跳过参考资料提取`);
          }
        } catch (e) { console.log('  ⚠️ 豆包参考抓取异常:', e.message); }
      }
      // === DeepSeek:需点击"N个网页"按钮展开来源面板,获取完整标题 ===
      else if (isDeepSeek) {
        try {
          // 先看回答区有没有"N个网页"字样
          const hasRefText = await page.evaluate(() => {
            return /(\d+)\s*个网页/.test(document.body.innerText);
          });
          if (!hasRefText) {
            console.log(`  ⚠️ DeepSeek 回答中无"个网页"字样(可能未联网搜索)`);
            // 不报错,正常返回空数组
          } else {
            // 点击 "N个网页" 按钮展开来源列表
            const refPanelBtn = page.locator('.f93f59e4').first();
            const btnVisible = await refPanelBtn.isVisible({ timeout: 2000 }).catch(() => false);
            console.log(`  🔍 DeepSeek 参考按钮可见: ${btnVisible}`);
            if (btnVisible) {
              await refPanelBtn.click();
              await sleep(2000);
            } else {
              console.log(`  ⚠️ DeepSeek .f93f59e4 选择器未找到`);
            }
            // 展开后面板中的 a 标签才有完整标题(来源名称+日期+文章标题)
            references = await page.evaluate(() => {
            const refs = [];
            const allLinks = document.querySelectorAll('a[href*="http"]');
            allLinks.forEach(a => {
              const href = a.href || '';
              // 过滤内部链接
              if (href.includes('chat.deepseek.com') || href.includes('deepseek.com/a/')) return;
              if (!href.startsWith('http')) return;
              const text = (a.innerText || '').trim();
              // 来源卡片中的文字通常较长(来源名+日期+编号+标题)
              if (text.length > 20 && text.length < 500) {
                // 提取标题部分(去掉来源名和日期行)
                const lines = text.split('\n').filter(l => l.trim().length > 3);
                const title = lines.slice(2).join(' ').substring(0, 200) || text.substring(0, 200);
                refs.push({ title, url: href });
              }
            });
            // 去重
            const seen = new Set();
            return refs.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true; });
          });
          // 关闭来源面板
          await page.keyboard.press('Escape');
          await sleep(300);
          } // else: hasRefText
        } catch (e) {}
      }
      // === 文心一言(chat.baidu.com):点击参考按钮展开,从 data-long-press-ext-info 提取 URL ===
      else if (isYiyan) {
        try {
          // 直接从 DOM 提取参考列表(不点击按钮,避免触发页面渲染导致控制台刷屏)
          const yiyanRefs = await page.evaluate(() => {
            const refs = [];
            const seen = new Set();
            // 找所有参考列表项(新UI class: _reference-item_xxx)
            const items = document.querySelectorAll('[class*="_reference-item"], [class*="reference-item"], li[data-long-press-ext-info]');
            for (const item of items) {
              // 从 data-long-press-ext-info 提取 link
              let url = '';
              const extInfo = item.getAttribute('data-long-press-ext-info') || '';
              if (extInfo) {
                try {
                  // HTML 中 &quot; 需要还原为 "
                  const parsed = JSON.parse(extInfo.replace(/&quot;/g, '"'));
                  url = parsed.link || '';
                } catch(e) { /* JSON parse failed */ }
              }
              // 兜底:直接找 a 标签
              if (!url) {
                const a = item.querySelector('a[href]');
                if (a) url = a.href || '';
              }
              // 标题:._text_xxx 或 .titleInfo__xxx
              const titleEl = item.querySelector('[class*="_text_"], [class*="titleInfo"]');
              const title = (titleEl?.textContent || item.textContent || '').trim().substring(0, 200);
              if (!url && !title) continue;
              const key = url || title;
              if (seen.has(key)) continue;
              seen.add(key);
              if (title.length > 3) refs.push({ title, url });
            }
            return refs;
          });
          references.push(...yiyanRefs);
          // console.log(`  📚 文心参考资料: ${yiyanRefs.length} 篇`);
          // if (yiyanRefs.length > 0) {
          //   yiyanRefs.slice(0, 3).forEach(r => console.log(`     ${r.title.substring(0,50)} → ${(r.url||'(无链接)').substring(0,60)}`));
          // }
        } catch (e) { console.log('  yiyan ref error:', e.message); }
      }
      // === 元宝:点击"源"按钮打开右侧引用抽屉,URL在li的dt-ext6中 ===
      else if (isYuanbao) {
        try {
          // 等待回答工具栏渲染("源"按钮可能在回答稳定后才异步出现)
          await sleep(2000);

          // 多渠道点击"源"按钮(带重试:最多试 3 次,每次等 1.5s)
          const srcSelectors = [
            '[data-toolbar-type="citation"]',          // 最可靠:data 属性精确匹配
            'div[class*="ToolbarSearchGuid_searchGuidTool"]',
            'div[class*="searchGuidTool"]',
          ];
          let clicked = false;

          for (let retry = 0; retry < 3 && !clicked; retry++) {
            if (retry > 0) await sleep(1500);

            // 先尝试 CSS 选择器
            for (const sel of srcSelectors) {
              const btn = page.locator(sel).first();
              try {
                await btn.waitFor({ state: 'visible', timeout: 2000 });
                await btn.scrollIntoViewIfNeeded();
                await btn.click({ timeout: 5000 });
                await sleep(2500);
                clicked = true;
                break;
              } catch (_) { /* 没找到,继续下一个 */ }
            }
            if (clicked) break;

            // fallback: evaluate 精确找"源"按钮(textContent 就是"源",且在工具栏区域内)
            const found = await page.evaluate(() => {
              const all = document.querySelectorAll('div, span, button');
              for (const el of all) {
                const t = (el.textContent || '').trim();
                if ((t === '源' || /^\d+\s*源$/.test(t)) && el.children.length <= 2) {
                  const rect = el.getBoundingClientRect();
                  if (rect.width > 20 && rect.width < 200) {
                    el.scrollIntoView({ block: 'center' });
                    el.click();
                    return t;
                  }
                }
              }
              return '';
            });
            if (found) {
              console.log(`  📄 evaluate 匹配源按钮: "${found}" (第${retry+1}次重试)`);
              await sleep(2500);
              clicked = true;
            }
          }
          if (!clicked) { console.log('  ⚠️ 元宝 "源" 按钮未找到'); }
          else { console.log(`  📄 元宝源按钮已点击`); }

          // 从引用来源抽屉中提取(新结构:data-url 在子元素 hyc-common-markdown__ref_card 上)
          references = await page.evaluate(() => {
            const refs = [];
            const seen = new Set();
            // 主选择器:agent-dialogue-references__item(LI元素)
            const items = document.querySelectorAll('.agent-dialogue-references__item');
            if (items.length === 0) {
              // 降级:找抽屉内任何带 data-url 的引用卡片
              const cards = document.querySelectorAll('[class*="ref_card"][data-url]');
              cards.forEach(card => {
                const url = card.getAttribute('data-url') || '';
                if (!url || !url.startsWith('http') || seen.has(url)) return;
                seen.add(url);
                const title = (card.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 200);
                if (title) refs.push({ title, url });
              });
              return refs;
            }
            items.forEach(item => {
              // 优先从子元素获取 data-url
              const refCard = item.querySelector('[data-url]');
              const url = refCard ? refCard.getAttribute('data-url') : '';
              if (!url || !url.startsWith('http') || seen.has(url)) return;
              seen.add(url);
              const title = (item.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 200);
              if (title) refs.push({ title, url });
            });
            return refs;
          });
          // 关闭引用来源抽屉
          await page.keyboard.press('Escape');
          await sleep(300);
        } catch (e) { console.log('  yuanbao ref error:', e.message); }
      }
      // === 通义千问:点击"N篇来源"按钮,扫全页链接(DeepSeek模式) ===
      else if (isQianwen) {
        try {
          // 用 Playwright 原生 API 点击(不用 evaluate() 里的 el.click())
          const refBtn = page.locator('text=篇来源').first();
          const btnVisible = await refBtn.isVisible({ timeout: 2000 }).catch(() => false);
          if (btnVisible) {
            // 点击后轮询来源卡片:面板异步加载时也能等到(最多 3 次点击 × 12 秒)
            for (let c = 0; c < 3; c++) {
              await refBtn.click();
              console.log(`  📄 千问来源按钮已点击 (第${c+1}次)`);
              let gotItems = false;
              for (let w = 0; w < 6; w++) {
                await sleep(2000);
                gotItems = await page.evaluate(() => document.querySelectorAll('[class*="source-item"]').length > 0).catch(() => false);
                if (gotItems) break;
              }
              if (gotItems) break;
            }
          } else {
            // 兜底:evaluate 文本匹配找按钮
            console.log(`  ⚠️  locator 未找到,尝试 evaluate 匹配...`);
            const found = await page.evaluate(() => {
              const all = document.querySelectorAll('div, span, button, a, li, generic');
              for (const el of all) {
                const t = (el.textContent || '').trim();
                if (t.length < 30 && el.children.length <= 2 &&
                    (/\d+\s*篇?来源/.test(t) || /来源\s*\d+/.test(t))) {
                  el.click();
                  return t;
                }
              }
              return '';
            });
            console.log(`  📄 evaluate 匹配: "${found}"`);
            if (found) await sleep(3000);
          }

          // DEBUG: 深度探测面板内容
          const deepDive = await page.evaluate(() => {
            const panels = document.querySelectorAll('[class*="sidebar"], [class*="drawer"], [class*="panel"], [class*="dialog"], [class*="popup"], [class*="overlay"], [class*="reference"], [class*="source"], [class*="modal"], [class*="float"], [class*="mask"], [class*="card"], [role="dialog"]');
            const result = { panelCount: panels.length, hasALinks: 0, hasDivs: 0, hasDataUrl: 0, sampleTag: '', sampleClass: '', sampleHTML: '', totalAllLinks: 0 };
            result.totalAllLinks = document.querySelectorAll('a[href*="http"]').length;
            for (const p of panels) {
              result.hasALinks += p.querySelectorAll('a[href]').length;
              result.hasDivs += p.querySelectorAll('div').length;
              result.hasDataUrl += p.querySelectorAll('[data-url], [data-href], [data-link]').length;
            }
            if (panels.length > 0) {
              const last = panels[panels.length - 1];
              result.sampleTag = last.tagName;
              result.sampleClass = (last.className || '').substring(0, 120);
              result.sampleHTML = last.outerHTML.substring(0, 600);
            }
            return result;
          });
          console.log(`  [DIVE] panels=${deepDive.panelCount} pageLinks=${deepDive.totalAllLinks} aInPanels=${deepDive.hasALinks} divs=${deepDive.hasDivs} dataUrl=${deepDive.hasDataUrl}`);
          if (deepDive.sampleTag) {
            // console.log(`  [DIVE] sample: ${deepDive.sampleTag}.${deepDive.sampleClass}`);
            // console.log(`  [DIVE]   html: ${deepDive.sampleHTML.substring(0, 400)}`);
          }

          // 千问来源卡片:解析 data-click-extra 中的 ref_url
          const qianwenRefs = await page.evaluate(() => {
            const refs = [];
            const seen = new Set();
            // 遍历所有来源卡片(source-item)
            const items = document.querySelectorAll('[class*="source-item"]');
            for (const item of items) {
              // 从 data-click-extra 或 data-exposure-extra 提取 ref_url
              let refUrl = '';
              for (const attr of ['data-click-extra', 'data-exposure-extra', 'data-log-params']) {
                const raw = item.getAttribute(attr);
                if (!raw) continue;
                try {
                  const parsed = JSON.parse(raw);
                  if (parsed.ref_url && parsed.ref_url.startsWith('http')) {
                    refUrl = parsed.ref_url;
                    break;
                  }
                } catch(e) {
                  // JSON 可能不完整,用正则兜底提取
                  const m = raw.match(/"ref_url"\s*:\s*"(https?:\/\/[^"]+)/);
                  if (m) { refUrl = m[1]; break; }
                }
              }
              if (!refUrl || seen.has(refUrl)) continue;
              seen.add(refUrl);
              // 提取标题和来源
              const titleEl = item.querySelector('[class*="title"]');
              const sourceEl = item.querySelector('[class*="name"]');
              const title = (titleEl ? titleEl.textContent.trim() : '')
                || (sourceEl ? sourceEl.textContent.trim() : '')
                || (item.textContent || '').trim().split('\n')[0].trim();
              refs.push({ title: title.substring(0, 200) || refUrl, url: refUrl });
            }
            return refs;
          });

          references.push(...qianwenRefs);
          // console.log(`  📚 千问参考资料: ${qianwenRefs.length} 篇`);
          // if (qianwenRefs.length > 0) {
          //   qianwenRefs.slice(0, 3).forEach(r => console.log(`     ${r.title.substring(0,40)} → ${r.url.substring(0,60)}`));
          // }

          await page.keyboard.press('Escape');
          await sleep(300);
        } catch (e) { console.log('  qianwen ref error:', e.message); }
      }

      references = references.filter(isOwnReference);
      // === 通用后处理 ===
      if (references.length > 0) {
        console.log(`  📚 参考资料: ${references.length} 篇`);
        const topDomains = {};
        references.forEach(ref => {
          try {
            if (ref.url) {
              const url = new URL(ref.url);
              const host = url.hostname.replace(/^www\.|^m\./, '');
              topDomains[host] = (topDomains[host] || 0) + 1;
            }
          } catch(e) {}
        });
        const sortedDomains = Object.entries(topDomains).sort((a, b) => b[1] - a[1]).slice(0, 5);
        // console.log(`  🌐 来源平台: ${sortedDomains.map(([d,c]) => `${d}×${c}`).join(', ')}`);
      } else {
        console.log(`  ⚠️ 未抓取到参考资料(${platformKey}平台可能无参考来源或需调整选择器)`);
      }
    } catch (refErr) {
      console.log(`  ⚠️ 参考资料抓取失败: ${refErr.message}`);
    }


    references = references.filter(isOwnReference);
    // === 分析 ===
    // 拒绝回答检测(refusePatterns 定义已上移至提交前,供重发逻辑复用)
    const isRefused = refusePatterns.some(p => answerText.includes(p));
    if (isRefused && answerText.length < 200) {
      console.log(`  🚫 检测到拒答,标记为异常`);
      return { platform: platformKey, question, answerText, charCount: answerText.length,
        hasBrand: false, brandName: BRAND_NAME,
        shareUrl, references: [], thinkingMode, isOffline: true, refStatus: '拒答', error: '回答被拒绝' };
    }

    const brands = getBrand(answerText);
    const brandRank = brands.length > 0 ? brands : [];
    const isOffline = null;
    const refStatus = '未采集来源';
    console.log(`  🏷️ 品牌: ${brandRank.slice(0,5).join(', ') || '无'}`);

    const hasBrand = brands.length > 0;

    return { brandName: BRAND_NAME, platform: platformKey, question, answerText, charCount: answerText.length, hasBrand, brands: brandRank, shareUrl, references, thinkingMode, isOffline, refStatus };
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
    return { platform: platformKey, question, answerText: '', charCount: 0, hasBrand: false, brandName: BRAND_NAME, brands: [], shareUrl: '', references: [], thinkingMode: '未知', isOffline: true, refStatus: '异常', error: e.message };
  }
}

async function runPlatform(platformKey) {
  const p = PLATFORMS[platformKey];
  if (!p) {
    console.error(`未知平台: ${platformKey}`);
    console.log(`可用平台: ${Object.keys(PLATFORMS).join(', ')}`);
    process.exit(1);
  }

  const startTime = Date.now();
  console.log(`\n========== ${p.name} ==========`);

  // ====== 全平台 CDP:连接到用户手动打开的 Chrome ======
  let browser;
  let retries = 0;
  while (retries < 5) {
    try {
      browser = await chromium.connectOverCDP('http://localhost:9223', { timeout: 15000 });
      console.log('  🔗 已连接到 Chrome');
      break;
    } catch (e) {
      retries++;
      console.log(`  ⚠️ CDP 连接失败 (${retries}/5): ${e.message.substring(0, 80)}`);
      if (retries < 5) {
        const wait = retries * 2000 + 3000; // 5s, 7s, 9s, 11s 递进等待
        console.log(`  🔄 ${wait/1000}秒后重试...`);
        await sleep(wait);
      }
    }
  }
  if (!browser) {
    console.log('  ❌ 无法连接到 Chrome CDP 端口 (9223)');
    console.log('  💡 请确保 Chrome 以调试模式启动:');
    console.log('     chrome.exe --remote-debugging-port=9223');
    console.log('  💡 并关闭所有 Chrome 窗口后重新用上述命令启动');
    // 写出带 error 标记的 batch 文件,让 retry 机制和仪表板识别
    const seq = argBatchIdx >= 0 ? String(parseInt(cliArgs[argBatchIdx + 1])).padStart(2, '0') : nextBatchSeq(platformKey);
    const batchFile = path.join(BATCH_DIR, `brand-${platformKey}-${RUN_DATE}-${seq}.json`);
    if (argBatchIdx >= 0) {
      // --batch 模式下 CDP 失败:不覆盖已有数据
      console.log(`  ⚠️ CDP 连接失败,已有批次 ${seq} 保持不变`);
    } else {
      const errorResults = QUESTIONS.map(q => ({
        platform: platformKey,
        question: q.question,
        answerText: '', charCount: 0,
        hasBrand: false, brandName: BRAND_NAME,
        shareUrl: '', references: [], thinkingMode: '未知', isOffline: true, refStatus: 'CDP断开',
        error: 'CDP连接失败', category: q.category, keyword: q.keyword,
      }));
      fs.writeFileSync(batchFile, JSON.stringify(errorResults, null, 2), 'utf8');
      console.log(`💾 错误批次已保存:${batchFile}`);
    }
    process.exitCode = 1; // 标记失败,run_all.ps1 能识别
    return;
  }

  // 创建新页面(优先用 browser.newPage() 兼容不同 CDP 版本)
  let page;
  try {
    const contexts = browser.contexts();
    if (contexts.length > 0) {
      page = await contexts[0].newPage();
    } else {
      page = await browser.newPage();
    }
  } catch (e) {
    try { page = await browser.newPage(); } catch (e2) {
      page = await browser.contexts()[0].newPage();
    }
  }

  // 导航到平台
  console.log(`  🌐 打开 ${p.name}...`);
  await page.goto(p.url, { waitUntil: 'commit', timeout: 15000 });
  await sleep(5000);

  // 跑问题(每题独立 try-catch,页面/browser 断开自动重连)
  const results = [];
  let seq, batchFile, priorResults = null;
  if (argBatchIdx >= 0) {
    seq = String(parseInt(cliArgs[argBatchIdx + 1])).padStart(2, '0');
    batchFile = path.join(BATCH_DIR, `brand-${platformKey}-${RUN_DATE}-${seq}.json`);
    if (fs.existsSync(batchFile)) {
      const raw = fs.readFileSync(batchFile, 'utf8');
      priorResults = JSON.parse(raw.replace(/\u2028/g, '').replace(/\u2029/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''));
      console.log(`  📂 读取已有批次 ${seq}(${priorResults.length} 题),将合并覆盖`);
    }
  } else {
    seq = nextBatchSeq(platformKey);
    batchFile = path.join(BATCH_DIR, `brand-${platformKey}-${RUN_DATE}-${seq}.json`);
  }
  for (let i = 0; i < QUESTIONS.length; i++) {
    const qObj = QUESTIONS[i];
    const qLabel = `[${i+1}/${QUESTIONS.length}]`;
    console.log(`\n${qLabel} Q: ${qObj.question.substring(0, 40)}...`);
    try {
      // 页面存活检测:标签页被关掉后自动恢复
      try {
        await page.evaluate(() => document.title);
      } catch (e) {
        console.log('  🔄 页面已断开,重新创建...');
        try {
          const contexts = browser.contexts();
          page = contexts.length > 0 ? await contexts[0].newPage() : await browser.newPage();
        } catch (e2) {
          page = await browser.newPage();
        }
        await page.goto(p.url, { waitUntil: 'commit', timeout: 15000 });
        await sleep(5000);
      }
      const r = await searchQuestion(page, platformKey, qObj.question, i, i === 0);
      r.category = qObj.category;
      r.keyword = qObj.keyword;
      results.push(r);
      // 增量保存:每题跑完立即写入,防止中途崩溃丢数据
      try {
        fs.writeFileSync(batchFile, JSON.stringify(priorResults ? [...priorResults.filter(old => !results.some(current => current.question === old.question)), ...results] : results, null, 2), 'utf8');
      } catch (wErr) {
        console.log(`  ⚠️ 增量保存失败: ${wErr.message}`);
      }
      // 题间延时(应对限频,如 DeepSeek "发送过于频繁")
      // 使用 randSleep 加入 ±30% 随机抖动,避免固定间隔被识别为脚本
      if (i < QUESTIONS.length - 1 && p.questionDelayMs) {
        const jitterMs = p.questionDelayMs * 0.3;  // ±30% 抖动
        console.log(`  ⏳ 等 ~${(p.questionDelayMs/1000).toFixed(0)}s (限频, 随机抖动)...`);
        await randSleep(p.questionDelayMs, jitterMs);
      }
    } catch (err) {
      const msg = err.message || '';
      const isClosed = msg.includes('closed') || msg.includes('detached');
      console.log(`  ❌ ${qLabel} 异常: ${msg.substring(0, 80)}`);

      if (isClosed) {
        // CDP 连接断了:尝试重连
        console.log('  🔄 尝试重连 Chrome CDP...');
        try {
          browser = await chromium.connectOverCDP('http://localhost:9223');
          const freshPage = await browser.contexts()[0].newPage();
          page = freshPage;
          console.log('  ✅ 重连成功,重新导航...');
          await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(3000);
          console.log('  ✅ 导航完成,继续');
        } catch (re) {
          console.log('  ❌ 重连失败: ' + re.message.substring(0, 60));
        }
        // 标记当前题目为错误,继续下一个
      }

      results.push({
        platform: platformKey,
        question: qObj.question,
        answerText: '',
        hasBrand: false, brandName: BRAND_NAME,
        charCount: 0,
        shareUrl: '',
        references: [],
        isOffline: true,
        refStatus: '异常',
        error: msg.substring(0, 200),
        thinkingMode: '未知',
        category: qObj.category,
        keyword: qObj.keyword,
      });
      // 增量保存错误结果
      try {
        fs.writeFileSync(batchFile, JSON.stringify(priorResults ? [...priorResults.filter(old => !results.some(current => current.question === old.question)), ...results] : results, null, 2), 'utf8');
      } catch (wErr) {}
    }
    await sleep(3000);
  }

  // --batch 合并模式:用新结果覆盖已有批次中的对应题目
  if (priorResults) {
    const newMap = new Map(results.map(r => [r.question, r]));
    const merged = priorResults.map(r => newMap.get(r.question) || r);
    for (const r of results) {
      if (!priorResults.some(o => o.question === r.question)) merged.push(r);
    }
    fs.writeFileSync(batchFile, JSON.stringify(merged, null, 2), 'utf8');
    console.log(`  🔄 已合并到批次 ${seq}:覆盖 ${newMap.size} 题,保留 ${priorResults.length - newMap.size} 题`);
  }

  try { await page.close(); } catch(e) {}
  // 不关浏览器(用户手动管理的 Chrome)

  // 单平台 HTML 报告已关闭,统一由 build_dashboard.js 生成聚合看板
  // const htmlFile = path.join(DATA_DIR, `report_${platformKey}_${timestamp}.html`);
  // generateHtmlReport(results, p.name, htmlFile);
  // console.log(`📄 HTML报告已生成:${htmlFile}`);

  console.log(`\n📊 ${p.name} 汇总:`);
  const okCount = results.filter(r => r.hasBrand !== undefined && !r.error).length;
  const errCount = results.filter(r => r.error).length;
  console.log(`  成功: ${okCount}/${results.length} | 异常: ${errCount}`);
  results.forEach((r, i) => {
    let ok;
    if (r.hasBrand) {
      ok = '已出现';
    } else {
      ok = r.error ? 'ERROR' : '未出现';
    }
    console.log(`  ${i+1}. ${r.question.substring(0,15)}... | ${BRAND_NAME}:${ok} | ${r.charCount}字`);
  });
  console.log(`\n  ✅ ${p.name} 完成 (${okCount}/${results.length} 成功, ${errCount} 异常)`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const mins = Math.floor(elapsed / 60);
  const secs = (elapsed % 60).toFixed(1);
  console.log(`  ⏱️ 脚本检索总耗时: ${mins > 0 ? mins + '分' : ''}${secs}秒`);
  console.log('');

  process.exitCode = okCount === 0 ? 1 : errCount > 0 ? 2 : 0;

  // CDP 模式:断开连接(不关 Chrome),否则 Node.js 进程退不出
  try { await browser.close(); } catch(e) {}
}


const platform = process.argv[2] || 'deepseek';
runPlatform(platform).catch(e => { console.error('💥 致命错误:', e.message); process.exit(1); });
