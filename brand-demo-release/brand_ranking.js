// 原版 AI 回答品牌排序逻辑；仅用于本品牌名次，不涉及发文数据。
module.exports = function createBrandRanker(brandName) {
const REFERENCE_BRANDS = [
  
  { name: '高途', aliases: ['高途', '高途一对一', '高途课堂', '高途教育'] },
  { name: '掌门1对1', aliases: ['掌门1对1', '掌门一对一', '掌门 1 对 1'] },
  { name: '好课在线', aliases: ['好课在线'] },
  { name: '启优学1对1', aliases: ['启优学', '启优学一对一', '启优学1对1', '启优学 1 对 1'] },
  { name: '学而思', aliases: ['学而思', '学而思网校'] },
  { name: '新东方', aliases: ['新东方', '新东方在线'] },
  { name: '洋葱学园', aliases: ['洋葱学园', '洋葱智课'] },
  { name: '作业帮', aliases: ['作业帮', '作业帮直播课'] },
  { name: '猿辅导', aliases: ['猿辅导', '猿辅导高中', '猿辅导网课', '猿辅导课堂'] },
  { name: '开明致学', aliases: ['开明致学'] },
  { name: '高分堂1对1', aliases: ['高分堂1对1', '高分堂一对一', '高分堂 1 对 1', '高分堂', '高分堂小程序'] },
  { name: '兔启1对1', aliases: ['兔启1对1', '兔启一对一', '兔启 1 对 1', '兔启1对1微信小程序', '兔启'] },
  { name: '积秀1对1', aliases: ['积秀1对1', '积秀一对一', '积秀 1 对 1', '积秀微信小程序', '积秀'] },
  { name: '银河兔1对1', aliases: ['银河兔', '银河兔一对一', '银河兔1对1', '银河兔微信小程序', '银河兔小程序'] },
  { name: '荷叶学课', aliases: ['荷叶学课', '荷叶学课一对一', '荷叶学课1对1', '荷叶学课 1 对 1', '荷叶学课小程序'] },
  { name: '提分牛', aliases: ['提分牛'] },
  { name: '学好网', aliases: ['学好网'] },
  { name: '豆神教育', aliases: ['豆神教育'] },
  { name: '灵犀提分', aliases: ['灵犀提分'] },
  { name: '速提1对1', aliases: ['速提1对1', '速提一对一', '速提 1 对 1'] },
  { name: '新舟教育', aliases: ['新舟教育'] },
  { name: '小马地理', aliases: ['小马地理', '小马地理老师'] },
  { name: 'ClassIn', aliases: ['ClassIn'] },
  { name: '博锐学1对1', aliases: ['博锐学一对一', '博锐学1对1', '博锐学 1 对 1', '博锐学'] },
  { name: '优师云学1对1', aliases: ['优师云学一对一', '优师云学', '优师云学1对1', '优师云学 1 对 1'] },
  { name: '学大教育', aliases: ['学大教育'] },
  { name: '欣乾程', aliases: ['欣乾程'] },
  { name: '京督学府', aliases: ['京督学府'] },
  { name: '大奇在线', aliases: ['大奇在线', 'DaKiTalk', '大奇在线 DaKiTalk'] },
  { name: '金博教育', aliases: ['金博教育', '金博升学', '金博'] },
  { name: '大咖素质训练营', aliases: ['大咖素质训练营'] },
  { name: '学锐星', aliases: ['学锐星', '学锐星一对一', '学锐星 1 对 1', '学锐星1对1'] },
  { name: '学海兔', aliases: ['学海兔', '学海兔小程序'] },
  { name: '冲分牛', aliases: ['冲分牛'] },
  { name: '伴鱼培优', aliases: ['伴鱼', '伴鱼培优'] },
  { name: '简单一百', aliases: ['简单一百', '简单学习网'] },
  { name: '荟达教育', aliases: ['荟达教育'] },
  { name: '101教育', aliases: ['101教育'] },
  { name: '锐思教育', aliases: ['锐思教育'] },
  { name: '文小星1对1', aliases: ['文小星一对一', '文小星一对一教育', '文小星1对1', '文小星 1 对 1', '文小星'] },
  { name: '仰星未来', aliases: ['仰星未来'] },
  { name: '轻学知', aliases: ['轻学知', '轻学知小程序', '轻学知一对一', '轻学知1对1'] },
  { name: '无忧伴学', aliases: ['无忧伴学'] },
  { name: '弘英培训', aliases: ['弘英培训'] },
  { name: '拔高堂', aliases: ['拔高堂', '拔高堂1对1', '拔高堂一对一'] },
  { name: '新锐言', aliases: ['新锐言'] },
  { name: '名师天团', aliases: ['名师天团'] },
  { name: '乐学高考', aliases: ['乐学在线', '乐学高考', '乐学1对1'] },
  { name: '希望优课', aliases: ['希望优课'] },
  { name: '思远教育', aliases: ['思远教育'] },
  { name: 'NOBOOK', aliases: ['NOBOOK', 'NOBOOK实验室', 'NOBOOK虚拟实验室'] },
  { name: 'CampusTop', aliases: ['CampusTop'] },
  { name: '博雅培优在线', aliases: ['博雅培优在线'] },
  { name: '小鹿素养', aliases: ['小鹿素养'] },
  { name: '满分一对一', aliases: ['满分一对一', '满分1对1', '满分 1 对 1'] },
  { name: '光光英语', aliases: ['光光英语'] },
  { name: '圣岛教育', aliases: ['圣岛教育'] },
  { name: '北达教育', aliases: ['北达教育'] },
  { name: '优知教育', aliases: ['优知教育'] },
  { name: '备多分', aliases: ['备多分'] },
  { name: '天学网', aliases: ['天学网'] },
  { name: '想象力教育科技', aliases: ['想象力教育科技', '想象力智能中高考'] },
  { name: '考试大师', aliases: ['考试大师'] },
  { name: '贝达英语', aliases: ['贝达英语'] },
  { name: '邦你学', aliases: ['邦你学'] },
  { name: '思维网课', aliases: ['思维网课'] },
  { name: '当当物理', aliases: ['当当物理'] },
  { name: '秒题星中高考', aliases: ['秒题星中高考', '秒题星智能中高考'] },
  { name: '龙文教育', aliases: ['龙文教育'] },
  { name: '满分尖子生', aliases: ['满分尖子生'] },
  { name: '论思教育', aliases: ['论思教育', '北京论思教育'] },
  { name: '华壹教育', aliases: ['华壹教育', '华壹高考', '华一教育'] },
  { name: '芒果同学1对1', aliases: ['芒果同学1对1', '芒果同学一对一', '芒果同学'] },
  { name: '51Talk', aliases: ['51Talk'] },
  { name: '昂立教育', aliases: ['昂立教育'] },
  { name: '百分百乐学', aliases: ['百分百乐学'] },
  { name: '北京八斗学院', aliases: ['北京八斗学院'] },
  { name: '北京春蕾教育', aliases: ['北京春蕾教育'] },
  { name: '北京英杰教育', aliases: ['北京英杰教育'] },
  { name: '戴氏教育', aliases: ['戴氏教育'] },
  { name: '凡科教育', aliases: ['凡科教育'] },
  { name: '光大教育', aliases: ['光大教育'] },
  { name: '瀚知教育', aliases: ['瀚知教育'] },
  { name: '杭州提分教育', aliases: ['杭州提分教育'] },
  { name: '华图教育', aliases: ['华图教育'] },
  { name: '火光课堂', aliases: ['火光课堂'] },
  { name: '京师汇誉教育', aliases: ['京师汇誉教育'] },
  { name: '科翰教育', aliases: ['科翰教育'] },
  { name: '快乐学习', aliases: ['快乐学习'] },
  { name: '揽星法考', aliases: ['揽星法考'] },
  { name: '龙门尚学教育', aliases: ['龙门尚学教育'] },
  { name: '路觅教育', aliases: ['路觅教育'] },
  { name: '铭师堂教育', aliases: ['铭师堂教育'] },
  { name: '普思教育', aliases: ['普思教育'] },
  { name: '清北中高考', aliases: ['清北中高考', '清北中高考补习学校'] },
  { name: '人人教育', aliases: ['人人教育'] },
  { name: '锐满分教育', aliases: ['锐满分教育', '锐满分'] },
  { name: '沈阳韦德教育', aliases: ['沈阳韦德教育'] },
  { name: '师大中高教育', aliases: ['师大中高教育'] },
  { name: '思而锐教育', aliases: ['思而锐教育'] },
  { name: '天星教育', aliases: ['天星教育'] },
  { name: '物理超哥王永超', aliases: ['物理超哥王永超'] },
  { name: '小凡公学', aliases: ['小凡公学'] },
  { name: '星火教育', aliases: ['星火教育'] },
  { name: '星精锐教育', aliases: ['星精锐教育'] },
  { name: '学牛教育', aliases: ['学牛教育'] },
  { name: '有志记忆教育', aliases: ['有志记忆教育'] },
  { name: '悦来教育', aliases: ['悦来教育'] },
  { name: '争流教育', aliases: ['争流教育'] },
  { name: '钟书教育', aliases: ['钟书教育'] },
 ]

const existing = REFERENCE_BRANDS.find(b => b.name === brandName || b.aliases.includes(brandName));
const BRANDS = [{name:brandName, aliases:existing ? [...new Set([brandName,...existing.aliases])] : [brandName]}, ...REFERENCE_BRANDS.filter(b => b !== existing)];
// 构建快速查找表
const BRAND_MAP = {}; // alias → canonical name
const CANONICAL_NAMES = []; // 正名列表（按顺序）
const ALL_ALIASES = []; // 所有别名扁平列表

BRANDS.forEach(b => {
  CANONICAL_NAMES.push(b.name);
  b.aliases.forEach(a => {
    BRAND_MAP[a] = b.name;
    ALL_ALIASES.push(a);
  });
});

// 跳过前言:第一个 ##/### 标题或 |---| 表格分隔符或中文编号(一、二、等)之前的内容
function skipPreface(text) {
  var minIdx = text.length;
  var markers = ['\n##', '\n###'];
  // 同时检测表格分隔行（支持 |---|、| :--- | 等变体）作为内容起始
  var tableSepMatch = text.match(/\n\|[-:\s|]+\|/);
  if (tableSepMatch) markers.push(tableSepMatch[0]);
  for (var i = 0; i < markers.length; i++) {
    var idx = text.indexOf(markers[i]);
    if (idx >= 0 && idx < minIdx) minIdx = idx;
  }
  // 中文编号章节检测:一、二、三、... 十、
  var cnHeadRe = /\\n([一二三四五六七八九十]{1,2}[、,]|[\\u4e00-\\u9fff]{2,4}[、:(])\s*[^\n]+/;
  var m = cnHeadRe.exec(text);
  if (m && m.index < minIdx) minIdx = m.index;
  if (minIdx < text.length * 0.3) return text.substring(minIdx);
  return text;
}

// 解析回答文本的章节结构
// 识别所有结构性标题行，返回 section 数组 [{ heading, text }]
// 前言（第一个标题之前的内容）被丢弃，不做品牌判断
function parseSections(text) {
  if (!text) return [];

  // 标题匹配模式（与 findSectionFor / checkFirstInAnySection 对齐）
  // Markdown ##/###/####、中文编号一、二、**加粗**、【方括号】、▶箭头、- xxx:分类标题
  // 数字列表标题(1. 2) 3、)单独用更宽松的前置匹配，见 numListPattern
  var headingPattern = /(?:^|\n)(?:#{1,4}\s+[^\n]+|[\u4e00-\u9fff]{1,4}[、:]\s*[^\n]+|\*\*[^*\n]{1,80}\*\*|【[^\n】]{1,80}】|[▶►▸]\s*[^\n]+|[-*+]\s*(?![\u4e00-\u9fff]{2,4}[:：])[^\n]{3,40}[:：])\s*/gu;
  // 数字列表标题：前置允许行首/换行/中文句末标点（。！？；：，、），解决千问等平台列表项之间无换行(如 "供您参考：1. 品牌")导致的漏识别
  var numListPattern = /(?:^|[\n。！？；：，、])\s*(\d+[.、)]\s*[^\n\u4e00-\u9fff]{0,5}[\u4e00-\u9fff])/gu;

  var matches = [];
  var m;
  while ((m = headingPattern.exec(text)) !== null) {
    // 假标题过滤（仅对非 Markdown 标题生效，##/### 开头的始终是结构标题）
    if (!/^#{1,4}\s/.test(m[0].trim())) {
      var stripped = m[0].replace(/^[\s\n]*/, '')
        .replace(/[-*+·•◆◇●○▶►▸\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+/gu, '')
        .replace(/[*_~`#]+/g, '').trim();
      // 看起来像老师名字的假标题（纯2~4汉字，如 ·胡源、-白瑞芳）
      if (/^[\u4e00-\u9fff]{2,4}$/.test(stripped)) continue;
    }

    matches.push({ index: m.index, heading: m[0].trim() });
  }
  // 数字列表标题（放宽前置，不经过假标题过滤）
  while ((m = numListPattern.exec(text)) !== null) {
    var numIdx = m.index + m[0].indexOf(m[1]);
    matches.push({ index: numIdx, heading: m[1].trim() });
  }

  if (matches.length === 0) return [];

  // 按出现位置排序并去重（同一位置只保留一个标题）
  matches.sort(function(a, b) { return a.index - b.index; });
  var deduped = [];
  for (var i = 0; i < matches.length; i++) {
    if (deduped.length === 0 || matches[i].index !== deduped[deduped.length - 1].index) {
      deduped.push(matches[i]);
    }
  }
  matches = deduped;

  // 从第一个标题开始切分 sections（前言被丢弃）
  var sections = [];
  for (var i = 0; i < matches.length; i++) {
    var start = matches[i].index;
    var end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    sections.push({
      heading: matches[i].heading,
      text: text.substring(start, end)
    });
  }

  return sections;
}

// 文本去重：检测回答末尾是否有重复的纯文本副本（DeepSeek等平台偶发）
// 策略：找到第一次出现的开场短语，若文本后半段再次出现则截断
function deduplicateAnswerText(text) {
  if (!text) return text;
  var openingPhrases = ['为你整理', '给高中生', '市面上', '我帮你', '为你梳理', '以下是', '为你推荐', '帮你整理', '我给你推荐'];
  for (var i = 0; i < openingPhrases.length; i++) {
    var firstIdx = text.indexOf(openingPhrases[i]);
    if (firstIdx >= 0) {
      var secondIdx = text.indexOf(openingPhrases[i], firstIdx + openingPhrases[i].length);
      // 第二次出现必须在文本后半段（>40%位置），避免误判正常重复
      if (secondIdx > text.length * 0.4) {
        return text.substring(0, secondIdx);
      }
    }
  }
  return text;
}

// 截断回答末尾的"相关推荐"区段（短视频/文章推荐标题流），避免误抓其中的品牌名
// 特征：千问推荐卡片固定标题、追问句、视频时长标记（\d{1,2}:\d{2}）
function stripRelatedRecommendations(text) {
  if (!text) return text;
  var cut = text.length;
  function consider(idx) { if (idx >= 0 && idx < cut) cut = idx; }
  // 1. 千问"相关推荐"卡片固定标题（最强特征）
  consider(text.indexOf('几款热门线上辅导'));
  consider(text.indexOf('热门线上辅导'));
  // 2. 追问句（正文结束标志）
  consider(text.indexOf('方便说一下'));
  consider(text.indexOf('需要帮您查'));
  consider(text.indexOf('方便带孩子'));
  // 3. 视频时长标记兜底
  var timeRe = /\d{1,2}:\d{2}/g;
  var m;
  while ((m = timeRe.exec(text)) !== null) consider(m.index);
  if (cut >= text.length) return text;
  return text.substring(0, cut);
}

// 表格品牌提取：在文本中查找 Markdown 表格，按行序提取第一列的已知品牌
// 支持两种格式：有 |---| 分隔行的标准表格、无分隔行直接表头+数据的表格
function extractBrandsFromTables(text) {
  var lines = text.split('\n');
  var result = [];
  var seen = {};

  // 先按连续管道行分块，然后对每个块判断是否有分隔行
  var blocks = [];
  var currentBlock = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.startsWith('|') && line.indexOf('|', 1) > 0) {
      currentBlock.push(line);
    } else {
      if (currentBlock.length >= 2) blocks.push(currentBlock);
      currentBlock = [];
    }
  }
  if (currentBlock.length >= 2) blocks.push(currentBlock);

  // 处理每个表格块
  for (var b = 0; b < blocks.length; b++) {
    var block = blocks[b];
    var dataStartIdx = -1;

    // 查找分隔行: |---|---| 或 | :--- | :--- | 等
    for (var j = 0; j < block.length; j++) {
      if (/^\|[-:\s|]+\|$/.test(block[j])) {
        dataStartIdx = j + 1; // 分隔行之后开始
        break;
      }
    }

    // 无分隔行：第1行是表头，从第2行开始是数据
    if (dataStartIdx < 0) {
      dataStartIdx = 1; // 跳过表头行
    }

    // 提取数据行第一列
    for (var k = dataStartIdx; k < block.length; k++) {
      var cells = block[k].split('|');
      if (cells.length >= 2) {
        var cellText = cells[1].trim();
        // 去除 Markdown 加粗/斜体标记
        cellText = cellText.replace(/\*\*/g, '').replace(/\*/g, '').trim();
        var canonical = findBrandInCell(cellText);
        if (canonical && !seen[canonical]) {
          result.push(canonical);
          seen[canonical] = true;
        }
      }
    }
  }

  return result;
}

// 检查单元格文本是否包含已知品牌别名，返回 canonical name 或 null
function findBrandInCell(cellText) {
  if (!cellText) return null;
  for (var i = 0; i < ALL_ALIASES.length; i++) {
    if (cellText.indexOf(ALL_ALIASES[i]) >= 0) {
      return BRAND_MAP[ALL_ALIASES[i]];
    }
  }
  return null;
}

// 在单段文本中扫描品牌：优先按表格行序提取，再兜底全文扫描
function scanBrandsInText(text) {
  // 1. 从表格中提取品牌（表格行序优先）
  var tableBrands = extractBrandsFromTables(text);
  var tableBrandSet = {};
  tableBrands.forEach(function(b) { tableBrandSet[b] = true; });

  // 2. 从全文扫描剩余品牌（兜底）
  var positions = {};
  ALL_ALIASES.forEach(function(alias) {
    var idx = text.indexOf(alias);
    if (idx >= 0) {
      var canonical = BRAND_MAP[alias];
      if (!(canonical in positions) || idx < positions[canonical]) {
        positions[canonical] = idx;
      }
    }
  });
  var textBrands = Object.entries(positions)
    .sort(function(a, b) { return a[1] - b[1]; })
    .map(function(e) { return e[0]; });

  // 3. 合并：表格品牌在前，文本品牌在后（去重）
  var result = tableBrands.slice();
  textBrands.forEach(function(b) {
    if (!tableBrandSet[b]) {
      result.push(b);
      tableBrandSet[b] = true;
    }
  });

  return result;
}

// 按 H-H1-H2-H3-H4... 章节层级顺序提取品牌
// 段间：按章节出现顺序（H → H1 → H2 → ...）
// 段内：表格行序优先，再按首次出现位置排序
// 前言区域（第一个标题之前的内容）不做判断
function getBrand(text) {
  // ① 去重：移除回答末尾的重复纯文本副本
  text = deduplicateAnswerText(text);
  // ①.5 截断末尾"相关推荐"区段，避免误抓其中的品牌名
  text = stripRelatedRecommendations(text);

  var sections = parseSections(text);

  if (sections.length === 0) {
    // 无结构性标题：跳过前言后扫描全文（兜底）
    var body = skipPreface(text);
    return scanBrandsInText(body);
  }

  // ② 表格优先：第一个标题之前的表格区域不能被丢弃，提取其中品牌作为第0节
  var firstHeadingIdx = text.indexOf(sections[0].heading);
  if (firstHeadingIdx > 0) {
    var prefaceText = text.substring(0, firstHeadingIdx);
    var prefaceTableBrands = extractBrandsFromTables(prefaceText);
    if (prefaceTableBrands.length > 0) {
      // 前言包含表格：整个前言区作为第0节，品牌来自表格行序
      sections.unshift({ heading: '', text: prefaceText });
    }
  }

  var result = [];
  var seenCanonical = {}; // canonical name → true（全局去重）

  for (var i = 0; i < sections.length; i++) {
    var brands = scanBrandsInText(sections[i].text);
    for (var j = 0; j < brands.length; j++) {
      if (!seenCanonical[brands[j]]) {
        result.push(brands[j]);
        seenCanonical[brands[j]] = true;
      }
    }
  }

  return result;
}


return function rankCurrentBrand(text) {
  const names = getBrand(String(text || ''));
  const index = names.indexOf(brandName);
  return index < 0 ? -1 : index + 1;
};
};
