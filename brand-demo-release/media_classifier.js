// The source archive did not include its media dictionary. Classify known hosts;
// retain unknown domains explicitly rather than inventing classifications.
function classifyMedia(value) {
  let host;
  try { const u = new URL(value); if (!['https:','http:'].includes(u.protocol)) return null; host = u.hostname.replace(/^www\./,''); } catch { return null; }
  const entries = [['zhihu.com','知乎','社区'],['sohu.com','搜狐','门户'],['163.com','网易','门户'],['qq.com','腾讯','门户'],['toutiao.com','今日头条','资讯平台'],['bilibili.com','哔哩哔哩','视频平台'],['douyin.com','抖音','视频平台'],['weixin.qq.com','微信公众号','自媒体'],['sina.com.cn','新浪','门户']];
  const item = entries.find(([domain]) => host === domain || host.endsWith('.'+domain));
  return item ? {name:item[1],cat:item[2],matched:true} : {name:host,cat:'其他',matched:false};
}
module.exports = {classifyMedia};
