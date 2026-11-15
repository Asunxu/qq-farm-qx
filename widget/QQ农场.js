// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: green; icon-glyph: leaf;
//
// QQ农场面板 · 桌面小组件
// 显示面板上有几个账号、谁在线、跑多久、金币、今日收偷浇水
//
// 用法：
//   1. Scriptable 里新建脚本，把本文件内容粘进去，命名「QQ农场」
//   2. 在 App 里运行一次 → 填面板地址 / 用户名 / 密码（只存本机钥匙串）
//   3. 回桌面长按 → 编辑 → 添加 Scriptable 小组件 → 选「QQ农场」
//   4. 点小组件打开面板网页
//
// 说明：面板只有 IPv6 时，手机要连有 IPv6 的 Wi-Fi，蜂窝不一定通。

// ============ 配置键 ============
const K_BASE = 'qqfarm_w_base';
const K_USER = 'qqfarm_w_user';
const K_PASS = 'qqfarm_w_pass';
const K_TOKEN = 'qqfarm_w_token';
const K_TITLE = 'qqfarm_w_title';
const K_COOL = 'qqfarm_w_cool';
const K_GOLD = 'qqfarm_w_gold';
const K_COUPON = 'qqfarm_w_coupon';
const K_DIAMOND = 'qqfarm_w_diamond';
const K_BEAN = 'qqfarm_w_bean';
const K_TODAY = 'qqfarm_w_today';

// ============ 配色 ============
const C = {
  bg1: '#0B2B22',
  bg2: '#123F35',
  title: '#EAF7EF',
  name: '#FFFFFF',
  sub: '#9CC7B4',
  dim: '#5F7D71',
  online: '#5BE38A',
  offline: '#4E6159',
  accent: '#7BE495',
  gold: '#FFD666',
  coupon: '#8FB8FF',
  diamond: '#9EE7FF',
  bean: '#FFB86B',
  warn: '#FF8A8A',
};

// UITable 用的系统语义色。
// 不同 Scriptable 版本暴露的静态方法不一样（有的没有 secondaryLabel），
// 所以这里按名字逐个试，全都没有就退回手写 hex，保证不会崩。
function sysColor(names, darkHex, lightHex) {
  for (let i = 0; i < names.length; i++) {
    try {
      if (typeof Color[names[i]] === 'function') return Color[names[i]]();
    } catch (e) {}
  }
  let dark = true;
  try {
    if (typeof Device !== 'undefined' && typeof Device.isUsingDarkAppearance === 'function') {
      dark = Device.isUsingDarkAppearance();
    }
  } catch (e) {}
  return new Color(dark ? darkHex : lightHex);
}
function uiSub() {
  return sysColor(['secondaryLabel', 'systemGray'], '#98989F', '#8A8A8E');
}
function uiRed() {
  return sysColor(['systemRed', 'red'], '#FF453A', '#FF3B30');
}
function uiGreen() {
  return sysColor(['systemGreen', 'green'], '#32D74B', '#34C759');
}

// 字体同理：不同版本暴露的静态方法不同（有的没有 fontWithName、
// 有的没有 *Monospaced*），这里按优先级逐个试，最后一定退回 systemFont。
function font(size, kind) {
  const chain = {
    plain: ['systemFont'],
    semibold: ['semiboldSystemFont', 'boldSystemFont', 'systemFont'],
    bold: ['boldSystemFont', 'semiboldSystemFont', 'systemFont'],
    mono: ['regularMonospacedSystemFont', 'systemFont'],
    boldMono: ['boldMonospacedSystemFont', 'boldSystemFont', 'regularMonospacedSystemFont', 'systemFont'],
  }[kind] || ['systemFont'];
  for (let i = 0; i < chain.length; i++) {
    try {
      if (typeof Font[chain[i]] === 'function') return Font[chain[i]](size);
    } catch (e) {}
  }
  return Font.systemFont(size);
}

const MAX_STATUS = 6; // 最多并发查询几个在跑账号的详细状态

// ============ 钥匙串读写 ============
function cfgGet(k, fb) {
  try {
    return Keychain.contains(k) ? Keychain.get(k) : fb;
  } catch (e) {
    return fb;
  }
}
function cfgSet(k, v) {
  try {
    if (v === null || v === undefined || v === '') Keychain.remove(k);
    else Keychain.set(k, String(v));
  } catch (e) {}
}

// ============ 格式化 ============
function fmtGold(n) {
  n = Number(n) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
  return String(Math.round(n));
}

function fmtDur(sec) {
  let s = Number(sec) || 0;
  if (s > 1e9) s = Math.round(s / 1000); // 兼容毫秒
  if (s <= 0) return '';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return d + '天' + (h ? h + 'h' : '');
  if (h > 0) return h + 'h' + (m ? m + 'm' : '');
  return Math.max(1, m) + 'm';
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function fmtTime(ts) {
  const d = new Date(ts);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// ============ 网络 ============
let BASE = '';
let USER = '';
let PASS = '';
let TOKEN = '';

async function http(path, opt) {
  opt = opt || {};
  let req;
  try {
    req = new Request(BASE + path);
  } catch (e) {
    throw new Error('面板地址格式不对');
  }
  req.method = opt.method || 'GET';
  req.timeoutInterval = opt.timeout || 12;
  // 注意：Scriptable 的 headers 是 Swift 值类型字典，拿到的 getter 是副本。
  // 写成 req.headers = {} 再 req.headers['x-admin-token'] = ... 会被静默丢弃，
  // 结果是 token 头从来没发出去（服务端一直 401）。必须一次性整体赋值。
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['x-admin-token'] = String(TOKEN);
  if (opt.accountId !== undefined && opt.accountId !== null) {
    headers['x-account-id'] = String(opt.accountId);
  }
  req.headers = headers;
  if (opt.body) req.body = JSON.stringify(opt.body);

  let text = '';
  try {
    text = await req.loadString();
  } catch (e) {
    throw new Error('连不上面板');
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {}
  return { status: req.response ? req.response.statusCode : 0, json: json, text: text };
}

async function login() {
  if (!PASS) throw new Error('没有配置密码');
  // 面板每分钟只允许 10 次登录、连错 5 次锁 15 分钟，失败后先冷却
  const cool = Number(cfgGet(K_COOL, '0')) || 0;
  if (Date.now() < cool) {
    const left = Math.ceil((cool - Date.now()) / 60000);
    throw new Error('登录失败冷却中（' + left + ' 分钟）');
  }
  const r = await http('/api/login', {
    method: 'POST',
    body: { username: USER, password: PASS },
    timeout: 15,
  });
  if (r.status === 200 && r.json && r.json.ok && r.json.data && r.json.data.token) {
    TOKEN = r.json.data.token;
    cfgSet(K_TOKEN, TOKEN);
    cfgSet(K_COOL, '');
    return TOKEN;
  }
  const msg = r.json && r.json.error ? String(r.json.error) : 'HTTP ' + r.status;
  if (r.status === 423) throw new Error('IP 被锁，稍后再试');
  if (r.status === 429) throw new Error('登录太频繁，等一分钟');
  if (r.status === 0) throw new Error('连不上面板');
  cfgSet(K_COOL, String(Date.now() + 5 * 60 * 1000));
  throw new Error('登录失败：' + msg);
}

async function fetchData() {
  TOKEN = cfgGet(K_TOKEN, '');
  if (!TOKEN) await login();

  let r = await http('/api/accounts');
  if (r.status === 401) {
    TOKEN = '';
    cfgSet(K_TOKEN, '');
    await login();
    r = await http('/api/accounts');
  }
  if (!(r.json && r.json.ok)) {
    const err = (r.json && r.json.error) || ('HTTP ' + r.status);
    throw new Error('账号列表读取失败：' + err);
  }

  const payload = (r.json.data && (r.json.data.accounts || r.json.data)) || [];
  const list = (Array.isArray(payload) ? payload : []).map(function (a) {
    a = a || {};
    return {
      id: String(a.id === undefined || a.id === null ? '' : a.id),
      name: a.nick || a.name || ('账号' + a.id),
      remark: a.name || '',
      platform: a.platform || 'qq',
      level: Number(a.level) || 0,
      gold: 0,
      coupon: 0,
      diamond: 0,
      goldBean: 0,
      exp: 0,
      lvPct: 0,
      uptime: 0,
      ops: null,
      connected: false,
      running: !!a.running,
      updatedAt: Number(a.updatedAt) || 0,
      note: '',
    };
  });

  const targets = list.filter(function (x) {
    return x.running;
  }).slice(0, MAX_STATUS);

  const results = await Promise.all(
    targets.map(async function (x) {
      try {
        const s = await http('/api/status', { accountId: x.id, timeout: 10 });
        return s.json && s.json.ok ? s.json.data : null;
      } catch (e) {
        return null;
      }
    })
  );

  targets.forEach(function (x, i) {
    const s = results[i];
    if (!s) {
      x.note = '状态读取失败';
      return;
    }
    const st = s.status || {};
    x.connected = !!(s.connection && s.connection.connected);
    x.uptime = Number(s.uptime) || 0;
    x.gold = Number(st.gold) || 0;
    x.coupon = Number(st.coupon) || 0;
    x.diamond = Number(st.diamond) || 0;
    x.goldBean = Number(st.goldBean) || 0;
    x.exp = Number(st.exp) || 0;
    const lp = s.levelProgress || null;
    if (lp && Number(lp.needed)) {
      x.lvPct = Math.max(0, Math.min(100, Math.round((Number(lp.current) || 0) * 100 / Number(lp.needed))));
    }
    if (Number(st.level)) x.level = Number(st.level);
    if (st.name) x.name = st.name;
    x.ops = s.operations || null;
    x.gainGold = Number(s.sessionGoldGained) || 0;
    x.gainCoupon = Number(s.sessionCouponGained) || 0;
    if (s.wsError) x.note = String(typeof s.wsError === 'string' ? s.wsError : (s.wsError.message || '连接异常'));
  });

  const today = { harvest: 0, stealth: 0, water: 0, plant: 0, gift: 0 };
  let goldTotal = 0;
  let couponTotal = 0;
  let diamondTotal = 0;
  let beanTotal = 0;
  let gainGoldTotal = 0;
  let gainCouponTotal = 0;
  let online = 0;
  list.forEach(function (x) {
    if (x.connected) online += 1;
    goldTotal += x.gold || 0;
    couponTotal += x.coupon || 0;
    diamondTotal += x.diamond || 0;
    beanTotal += x.goldBean || 0;
    gainGoldTotal += x.gainGold || 0;
    gainCouponTotal += x.gainCoupon || 0;
    if (x.ops) {
      today.harvest += Number(x.ops.harvest) || 0;
      today.stealth += Number(x.ops.steal) || 0;
      today.water += Number(x.ops.helpWater) || 0;
      today.plant += Number(x.ops.farming) || Number(x.ops.plant) || 0;
      today.gift += Number(x.ops.tongQiGift) || 0;
    }
  });

  return {
    total: list.length,
    online: online,
    running: list.filter(function (x) {
      return x.running;
    }).length,
    accounts: list,
    today: today,
    goldTotal: goldTotal,
    couponTotal: couponTotal,
    diamondTotal: diamondTotal,
    beanTotal: beanTotal,
    gainGoldTotal: gainGoldTotal,
    gainCouponTotal: gainCouponTotal,
    updatedAt: Date.now(),
  };
}

// ============ 渲染 ============
function addIcon(w, size) {
  try {
    const sym = SFSymbol.named('leaf.fill');
    sym.applyFont(Font.systemFont(size));
    const img = w.addImage(sym.image);
    img.tintColor = new Color(C.accent);
    img.imageSize = new Size(size, size);
  } catch (e) {}
}

function buildHeader(w, data) {
  const h = w.addStack();
  h.centerAlignContent();
  addIcon(h, 12);
  h.addSpacer(5);
  const t = h.addText(cfgGet(K_TITLE, 'QQ农场'));
  t.font = font(13, 'semibold');
  t.textColor = new Color(C.title);
  t.lineLimit = 1;
  h.addSpacer();

  const live = data.online > 0;
  const dot = h.addText('●');
  dot.font = font(10, 'plain');
  dot.textColor = new Color(live ? C.online : C.offline);
  h.addSpacer(3);
  const num = h.addText(data.online + '/' + data.total);
  num.font = font(12, 'mono');
  num.textColor = new Color(live ? C.online : C.sub);
}

function buildAccountRow(w, acc) {
  const row = w.addStack();
  row.centerAlignContent();

  const dot = row.addText('●');
  dot.font = font(9, 'plain');
  dot.textColor = new Color(acc.connected ? C.online : C.offline);
  row.addSpacer(5);

  const n = row.addText(acc.name);
  n.font = font(13, 'semibold');
  n.textColor = new Color(acc.running ? C.name : C.dim);
  n.lineLimit = 1;

  row.addSpacer(6);

  if (acc.level) {
    const lv = row.addText('Lv' + acc.level);
    lv.font = font(11, 'mono');
    lv.textColor = new Color(C.accent);
    lv.lineLimit = 1;
  }

  row.addSpacer();

  let right = '';
  let color = C.sub;
  if (!acc.running) {
    right = '未运行';
    color = C.dim;
  } else if (acc.connected) {
    right = acc.uptime ? fmtDur(acc.uptime) : '在线';
    color = C.sub;
  } else {
    right = acc.note ? '异常' : '连接中';
    color = acc.note ? C.warn : C.sub;
  }
  const r = row.addText(right);
  r.font = font(11, 'plain');
  r.textColor = new Color(color);
  r.lineLimit = 1;
}

function showGold() {
  return cfgGet(K_GOLD, '1') !== '0';
}
function showCoupon() {
  return cfgGet(K_COUPON, '1') !== '0';
}
function showDiamond() {
  return cfgGet(K_DIAMOND, '1') !== '0';
}
function showBean() {
  return cfgGet(K_BEAN, '1') !== '0';
}
function showToday() {
  return cfgGet(K_TODAY, '1') !== '0';
}

// 四类货币：金币 / 点券 / 钻石 / 金豆（对应服务端 status.gold / coupon / diamond / goldBean）
function currencyList(obj, max) {
  const out = [];
  if (showGold() && Number(obj.gold)) out.push({ k: '金币', v: fmtGold(obj.gold), c: C.gold });
  if (showCoupon() && Number(obj.coupon)) out.push({ k: '点券', v: fmtGold(obj.coupon), c: C.coupon });
  if (showDiamond() && Number(obj.diamond)) out.push({ k: '钻石', v: fmtGold(obj.diamond), c: C.diamond });
  if (showBean() && Number(obj.goldBean)) out.push({ k: '金豆', v: fmtGold(obj.goldBean), c: C.bean });
  return max ? out.slice(0, max) : out;
}

function buildCurrencyRow(w, acc) {
  const items = currencyList(acc);
  if (!items.length) return false;
  const s = w.addStack();
  s.centerAlignContent();
  s.addSpacer(14);
  items.forEach(function (it, i) {
    if (i > 0) {
      const sep = s.addText(' · ');
      sep.font = font(9, 'plain');
      sep.textColor = new Color(C.dim);
    }
    const t = s.addText(it.k + ' ' + it.v);
    t.font = font(10, 'plain');
    t.textColor = new Color(it.c);
    t.lineLimit = 1;
    t.textOpacity = 0.9;
  });
  return true;
}

function buildOpsRow(w, acc) {
  if (!showToday() || !acc.ops) return false;
  const bits = [];
  if (Number(acc.ops.harvest)) bits.push('收' + Number(acc.ops.harvest));
  if (Number(acc.ops.steal)) bits.push('偷' + Number(acc.ops.steal));
  if (Number(acc.ops.helpWater)) bits.push('水' + Number(acc.ops.helpWater));
  if (Number(acc.ops.tongQiGift)) bits.push('同气' + Number(acc.ops.tongQiGift));
  if (!bits.length) return false;

  const s = w.addStack();
  s.centerAlignContent();
  s.addSpacer(14);
  const t = s.addText('今 ' + bits.join(' '));
  t.font = font(10, 'plain');
  t.textColor = new Color(C.sub);
  t.textOpacity = 0.8;
  t.lineLimit = 1;
  return true;
}

function buildToday(w, data) {
  const s = w.addStack();
  s.centerAlignContent();
  if (showToday()) {
    const bits = [];
    if (data.today.harvest) bits.push('收 ' + data.today.harvest);
    if (data.today.stealth) bits.push('偷 ' + data.today.stealth);
    if (data.today.water) bits.push('水 ' + data.today.water);
    if (data.today.gift) bits.push('同气 ' + data.today.gift);
    const label = bits.length ? '今日 ' + bits.join('  ') : '今日暂无操作';
    const t = s.addText(label);
    t.font = font(10, 'plain');
    t.textColor = new Color(C.sub);
    t.textOpacity = 0.75;
    t.lineLimit = 1;
  }
  s.addSpacer();
  const u = s.addText(fmtTime(data.updatedAt) + ' 更新');
  u.font = font(9, 'mono');
  u.textColor = new Color(C.sub);
  u.textOpacity = 0.55;
}

function buildSmall(w, data) {
  const head = w.addStack();
  head.centerAlignContent();
  addIcon(head, 12);
  head.addSpacer(5);
  const t = head.addText(cfgGet(K_TITLE, 'QQ农场'));
  t.font = font(12, 'semibold');
  t.textColor = new Color(C.title);
  t.lineLimit = 1;

  w.addSpacer();

  const num = w.addStack();
  num.centerAlignContent();
  const big = num.addText(String(data.online));
  big.font = font(30, 'boldMono');
  big.textColor = new Color(data.online > 0 ? C.online : C.offline);
  num.addSpacer(3);
  const of = num.addText('/ ' + data.total);
  of.font = font(14, 'mono');
  of.textColor = new Color(C.sub);
  num.addSpacer(4);

  const one = data.accounts.length === 1 ? data.accounts[0] : null;
  if (one) {
    const info = w.addStack();
    info.centerAlignContent();
    const n = info.addText(one.name);
    n.font = font(12, 'semibold');
    n.textColor = new Color(C.name);
    n.lineLimit = 1;
    const lv = info.addText(one.level ? '  Lv' + one.level : '');
    lv.font = font(10, 'mono');
    lv.textColor = new Color(C.accent);
  } else {
    const lab = w.addText(data.total === 0 ? '暂无账号' : (data.online > 0 ? '账号在线' : '全部离线'));
    lab.font = font(11, 'plain');
    lab.textColor = new Color(C.sub);
  }

  // 小尺寸只放得下两行货币：优先金币、点券
  const totals = {
    gold: data.goldTotal,
    coupon: data.couponTotal,
    diamond: data.diamondTotal,
    goldBean: data.beanTotal,
  };
  const cur = currencyList(totals, 2);
  if (cur.length) {
    w.addSpacer(2);
    cur.forEach(function (it) {
      const line = w.addText(it.k + ' ' + it.v);
      line.font = font(11, 'plain');
      line.textColor = new Color(it.c);
      line.lineLimit = 1;
    });
  }

  w.addSpacer();

  const foot = w.addStack();
  foot.centerAlignContent();
  const g = foot.addText(data.running + ' 个在跑');
  g.font = font(10, 'plain');
  g.textColor = new Color(C.sub);
  g.textOpacity = 0.7;
  g.lineLimit = 1;
  foot.addSpacer();
  const u = foot.addText(fmtTime(data.updatedAt));
  u.font = font(9, 'plain');
  u.textColor = new Color(C.sub);
  u.textOpacity = 0.5;
}

function buildMedium(w, data) {
  buildHeader(w, data);
  w.addSpacer(4);

  // 中尺寸一行一个账号，右侧放金币；点券/钻石/金豆合计放底部一行
  const list = data.accounts.slice(0, 4);
  if (!list.length) {
    const e = w.addText('面板上还没有账号');
    e.font = font(12, 'plain');
    e.textColor = new Color(C.sub);
  }

  list.forEach(function (acc, i) {
    if (i > 0) w.addSpacer(3);
    buildAccountRowGold(w, acc);
  });

  if (data.accounts.length > list.length) {
    w.addSpacer(3);
    const more = w.addText('还有 ' + (data.accounts.length - list.length) + ' 个账号 · 大尺寸全显示');
    more.font = font(10, 'plain');
    more.textColor = new Color(C.dim);
    more.lineLimit = 1;
  }

  w.addSpacer();
  const totals = currencyList(
    { gold: data.goldTotal, coupon: data.couponTotal, diamond: data.diamondTotal, goldBean: data.beanTotal },
    4
  );
  if (totals.length) {
    const s = w.addStack();
    s.centerAlignContent();
    totals.forEach(function (it, i) {
      if (i > 0) {
        const sep = s.addText(' · ');
        sep.font = font(9, 'plain');
        sep.textColor = new Color(C.dim);
      }
      const t = s.addText(it.k + ' ' + it.v);
      t.font = font(10, 'plain');
      t.textColor = new Color(it.c);
      t.lineLimit = 1;
    });
    w.addSpacer(2);
  }
  buildToday(w, data);
}

// 中尺寸用的紧凑行：左边名字+等级，右边金币
function buildAccountRowGold(w, acc) {
  const row = w.addStack();
  row.centerAlignContent();

  const dot = row.addText('●');
  dot.font = font(9, 'plain');
  dot.textColor = new Color(acc.connected ? C.online : C.offline);
  row.addSpacer(5);

  const n = row.addText(acc.name);
  n.font = font(13, 'semibold');
  n.textColor = new Color(acc.running ? C.name : C.dim);
  n.lineLimit = 1;

  row.addSpacer(6);

  if (acc.level) {
    const lv = row.addText('Lv' + acc.level);
    lv.font = font(11, 'mono');
    lv.textColor = new Color(C.accent);
    lv.lineLimit = 1;
  }

  row.addSpacer();

  let right = '';
  let color = C.sub;
  if (showGold() && acc.gold) {
    right = fmtGold(acc.gold);
    color = C.gold;
  } else if (!acc.running) {
    right = '未运行';
    color = C.dim;
  } else if (!acc.connected) {
    right = acc.note ? '异常' : '连接中';
    color = acc.note ? C.warn : C.sub;
  } else {
    right = '在线';
  }
  const r = row.addText(right);
  r.font = font(12, 'plain');
  r.textColor = new Color(color);
  r.lineLimit = 1;
}

function buildLarge(w, data) {
  buildHeader(w, data);
  w.addSpacer(6);

  const list = data.accounts.slice(0, 5);
  list.forEach(function (acc, i) {
    if (i > 0) w.addSpacer(6);
    buildAccountRow(w, acc);
    w.addSpacer(1);
    buildCurrencyRow(w, acc);
    if (showToday() && acc.ops) {
      w.addSpacer(1);
      buildOpsRow(w, acc);
    }
  });

  if (data.accounts.length > list.length) {
    w.addSpacer(4);
    const more = w.addText('还有 ' + (data.accounts.length - list.length) + ' 个账号未显示');
    more.font = font(10, 'plain');
    more.textColor = new Color(C.dim);
  }

  w.addSpacer();

  const sum = w.addStack();
  sum.centerAlignContent();
  const a = sum.addText(data.running + ' 个在跑 · ' + data.online + ' 个在线');
  a.font = font(11, 'semibold');
  a.textColor = new Color(C.accent);
  sum.addSpacer();
  const g = sum.addText(showGold() && data.goldTotal ? '金币 ' + fmtGold(data.goldTotal) : '');
  g.font = font(11, 'plain');
  g.textColor = new Color(C.gold);

  if (showCoupon() && data.couponTotal) {
    sum.addSpacer(6);
    const c = sum.addText('点券 ' + fmtGold(data.couponTotal));
    c.font = font(11, 'plain');
    c.textColor = new Color(C.coupon);
  }

  w.addSpacer(3);
  buildToday(w, data);
}

function buildError(w, msg) {
  const head = w.addStack();
  head.centerAlignContent();
  addIcon(head, 12);
  head.addSpacer(5);
  const t = head.addText(cfgGet(K_TITLE, 'QQ农场'));
  t.font = font(13, 'semibold');
  t.textColor = new Color(C.title);

  w.addSpacer();
  const e = w.addText(String(msg || '读取失败'));
  e.font = font(12, 'plain');
  e.textColor = new Color(C.warn);
  e.lineLimit = 3;
  w.addSpacer(4);
  const hint = w.addText('点开小组件运行一次可修改配置');
  hint.font = font(10, 'plain');
  hint.textColor = new Color(C.sub);
  hint.textOpacity = 0.8;
  w.addSpacer();
}

function newWidget(family) {
  const w = new ListWidget();
  try {
    const g = new LinearGradient();
    g.colors = [new Color(C.bg1), new Color(C.bg2)];
    g.locations = [0, 1];
    w.backgroundGradient = g;
  } catch (e) {
    try {
      w.backgroundColor = new Color(C.bg1);
    } catch (e2) {}
  }
  try {
    if (family === 'small') w.setPadding(10, 12, 10, 12);
    else if (family === 'large') w.setPadding(14, 14, 12, 14);
    else w.setPadding(11, 14, 10, 14);
  } catch (e) {}
  return w;
}

function render(data, family) {
  const w = newWidget(family);
  if (family === 'small') buildSmall(w, data);
  else if (family === 'large') buildLarge(w, data);
  else buildMedium(w, data);
  return w;
}

function renderError(msg, family) {
  const w = newWidget(family);
  buildError(w, msg);
  return w;
}

// ============ App 内设置界面 ============
const VER = '1.1';

function loadCfg() {
  BASE = String(cfgGet(K_BASE, '') || '').replace(/\/+$/, '');
  USER = String(cfgGet(K_USER, '') || '');
  PASS = String(cfgGet(K_PASS, '') || '');
}

async function editField(title, current, secure) {
  const a = new Alert();
  a.title = title;
  if (secure) a.addSecureTextField('', current);
  else a.addTextField('', current);
  a.addAction('保存');
  a.addCancelAction('取消');
  const i = await a.presentAlert();
  if (i !== 0) return null;
  return String(a.textFieldValue(0) || '');
}

async function appUI() {
  let data = null;
  let err = '';
  let note = '';

  const table = new UITable();
  table.showSeparators = false;

  function sectionRow(title) {
    const r = new UITableRow();
    r.height = 36;
    const c = r.addText(title);
    c.titleFont = font(12, 'semibold');
    c.titleColor = uiSub();
    r.dismissOnSelect = false;
    table.addRow(r);
  }

  function valueRow(title, value, onSelect, color, weight) {
    const r = new UITableRow();
    r.height = 52;
    const a = r.addText(String(title));
    a.titleFont = font(16, 'plain');
    a.widthWeight = weight || 38;
    const b = r.addText(String(value === undefined || value === null ? '' : value));
    b.titleFont = font(15, 'plain');
    b.titleColor = color || uiSub();
    b.widthWeight = 62;
    // 不同 Scriptable 版本这里的方法名不一致，兜一下
    try {
      b.rightAligned();
    } catch (e) {}
    r.dismissOnSelect = false;
    if (onSelect) r.didSelect = onSelect;
    table.addRow(r);
    return r;
  }

  function draw() {
    table.removeAllRows();

    const head = new UITableRow();
    head.height = 92;
    const hc = head.addText(cfgGet(K_TITLE, 'QQ农场'),
      data
        ? (data.online + '/' + data.total + ' 在线 · ' + data.running + ' 个在跑'
          + (data.goldTotal ? ' · 金 ' + fmtGold(data.goldTotal) : '')
          + (data.couponTotal ? ' · 券 ' + fmtGold(data.couponTotal) : ''))
        : (err ? '连接失败' : '未配置面板'));
    hc.titleFont = font(24, 'bold');
    hc.subtitleFont = font(13, 'plain');
    hc.subtitleColor = err ? uiRed() : uiSub();
    head.dismissOnSelect = false;
    if (data) {
      head.didSelect = async function () {
        const w = render(data, 'medium');
        await w.presentMedium();
      };
    }
    table.addRow(head);

    sectionRow('面板');
    valueRow('服务器地址', BASE || '点此填写', async function () {
      const v = await editField('面板地址', BASE, false);
      if (v === null) return;
      cfgSet(K_BASE, String(v).trim().replace(/\/+$/, ''));
      cfgSet(K_TOKEN, '');
      loadCfg();
      await refresh();
    });
    valueRow('用户名', USER || '点此填写', async function () {
      const v = await editField('用户名', USER, false);
      if (v === null || !String(v).trim()) return;
      cfgSet(K_USER, String(v).trim());
      cfgSet(K_TOKEN, '');
      loadCfg();
      await refresh();
    });
    valueRow('密码', PASS ? '••••••' : '点此填写', async function () {
      const v = await editField('密码', PASS, true);
      if (v === null || !v) return;
      cfgSet(K_PASS, v);
      cfgSet(K_TOKEN, '');
      loadCfg();
      await refresh();
    });
    valueRow(
      '连接测试',
      note || (err ? '失败 · 点此重试' : (data ? '正常' : '点此测试')),
      async function () {
        await refresh();
      },
      err ? uiRed() : (data ? uiGreen() : uiSub())
    );

    sectionRow('显示');
    valueRow('标题', cfgGet(K_TITLE, 'QQ农场'), async function () {
      const v = await editField('小组件标题', cfgGet(K_TITLE, 'QQ农场'), false);
      if (v === null || !String(v).trim()) return;
      cfgSet(K_TITLE, String(v).trim());
      draw();
      table.reload();
    });
    [
      ['金币', K_GOLD],
      ['点券', K_COUPON],
      ['钻石', K_DIAMOND],
      ['金豆', K_BEAN],
    ].forEach(function (pair) {
      valueRow('显示' + pair[0], cfgGet(pair[1], '1') === '1' ? '开' : '关', function () {
        cfgSet(pair[1], cfgGet(pair[1], '1') === '1' ? '0' : '1');
        draw();
        table.reload();
      });
    });
    valueRow('显示今日统计', cfgGet(K_TODAY, '1') === '1' ? '开' : '关', function () {
      cfgSet(K_TODAY, cfgGet(K_TODAY, '1') === '1' ? '0' : '1');
      draw();
      table.reload();
    });

    sectionRow('操作');
    valueRow('刷新数据', data ? fmtTime(data.updatedAt) + ' 更新' : '未读取', async function () {
      await refresh();
    });
    valueRow('打开面板网页', BASE ? 'Safari' : '未配置', function () {
      if (BASE) Safari.open(BASE);
    });
    valueRow('关于', 'v' + VER, async function () {
      const a = new Alert();
      a.title = 'QQ农场小组件 v' + VER;
      a.message = '数据来自面板接口：\nGET /api/accounts\nGET /api/status\n\n显示的字段：等级、在线时长、金币、点券、钻石、金豆、今日收获/偷取/浇水/同气礼包。\n\n账号密码存在本机钥匙串，不会写进脚本。\n小组件每 5 分钟请求刷新一次，实际由 iOS 决定。';
      a.addAction('好');
      await a.presentAlert();
    });

    const tail = new UITableRow();
    tail.height = 30;
    tail.dismissOnSelect = false;
    table.addRow(tail);
  }

  async function refresh() {
    note = '连接中…';
    draw();
    table.reload();
    await new Promise(function (r) {
      setTimeout(r, 60);
    });
    note = '';
    try {
      data = await fetchData();
      err = '';
    } catch (e) {
      data = null;
      err = String((e && e.message) || e);
    }
    draw();
    table.reload();
  }

  draw();
  if (BASE && USER && PASS) {
    try {
      data = await fetchData();
      err = '';
    } catch (e) {
      data = null;
      err = String((e && e.message) || e);
    }
    draw();
  }
  await table.present();
}

// ============ 脚本入口 ============
async function main() {
  loadCfg();
  const inWidget = config.runsInWidget;
  const family = inWidget ? (config.widgetFamily || 'medium') : 'medium';

  if (!inWidget) {
    await appUI();
    return;
  }

  if (!(BASE && USER && PASS)) {
    const w = renderError('还没配置面板地址和账号', family);
    w.url = 'scriptable:///run/' + encodeURIComponent(Script.name());
    Script.setWidget(w);
    Script.complete();
    return;
  }

  let data = null;
  let err = null;
  try {
    data = await fetchData();
  } catch (e) {
    err = e;
  }

  let w;
  if (err) w = renderError(err.message || '读取失败', family);
  else w = render(data, family);
  w.url = BASE;
  if (!err) w.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);
  Script.setWidget(w);
  Script.complete();
}

await main();
Script.complete();
