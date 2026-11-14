/**
 * QQ经典农场 · 登录 Code 抓取（Quantumult X）
 * ---------------------------------------------------------------------------
 * 原理：手机 QQ 里打开「QQ经典农场」小程序时，客户端会把 qq.login() 拿到的
 *       一次性 code 直接拼在网关 WebSocket 地址上：
 *
 *       wss://gate-obt.nqf.qq.com/prod/ws?platform=qq&os=ios&ver=xxx&code=<CODE>
 *
 *       本脚本只「读」这个 URL 里的 code，取出后通知 + 落盘 +（可选）自动
 *       上传到面板添加账号，全程不修改请求头、请求体、响应 —— 只是旁路观察。
 *
 * 类型：http-request（写成 http-response 也能用，脚本会自动识别上下文）
 * 规则：
 *   ^https?://gate-obt\.nqf\.qq\.com/ url script-request-header qq-farm-code.js
 *   若命中时上报的 URL 以 wss:// 开头（个别 QX 版本），改用：
 *   ^(https?|wss?)://gate-obt\.nqf\.qq\.com/ url script-request-header qq-farm-code.js
 *
 * 注意：code 是一次性的、有效期很短（分钟级）。重新进入小程序会刷新 code。
 *
 * 配置：不要改这里的 CFG.panel。在 BoxJs 里添加订阅（订阅地址见 README，
 *       文件是 qqfarm.boxjs.json），打开「QQ经典农场 · 抓码设置」填开关 /
 *       面板账号 / 目标账号，保存即生效 —— BoxJs 写的键与本脚本读的键同名，
 *       都在 QX 的 $prefs 里，中间不经过任何服务器。
 * ---------------------------------------------------------------------------
 */

/* 脚本版本号。只用于自检通知的标题，方便一眼认出手机上跑的是哪一版：
 * 标题里带 v5 = 新代码在跑；不带版本号 = QX 还在用缓存的旧文件。 */
var SCRIPT_VER = 'v8.20261114b';

var CFG = {
    /* 抓包总开关。false 时脚本在读到域名后立刻放行，不做任何解析、不发通知、
     * 不写历史 —— 相当于临时把这条重写规则「静音」，但不用去 QX 里关开关。
     * BoxJs 里「抓包开关」保存即生效，下一次请求就按新值走。 */
    capture: true,
    /* 抓到后是否弹通知（建议开，QX 通知可长按复制） */
    notify: true,
    /* 同一个 code 在多少毫秒内不重复处理/通知 */
    dedupMs: 60 * 1000,
    /* 非网关域名上，code 至少这么长才认（防止 URL 里的追踪参数误报） */
    minLen: 16,
    /* 本地保留最近多少条历史（存 $prefs） */
    historyLimit: 10,
    /* 调试日志：默认开。
     * 打开后每一步都会渲染成纯文本写进 $prefs 的 qqfarm_log_view，
     * 也就是 BoxJs 里那一栏「运行日志」，不用开任何 QX 开关。
     * 同时也会 console.log 一份，方便在 QX 设置页最下面那组（新版叫「调试记录」）里对照。 */
    debug: true,

    /* ------------------------- 自动上传到面板 -------------------------
     * enabled 打开后：抓到时先用面板账号换 token，再 POST /api/accounts
     * 把 code 写进面板并启动账号。改完保存到 QX 脚本目录即可生效。
     */
    panel: {
        enabled: false,
        /* 面板地址，别带结尾斜杠。留空表示只能在 BoxJs 里填 */
        baseUrl: '',
        /* 面板管理员账号（就是登录网页的那套） */
        username: 'admin',
        password: '',
        /* 账号备注：面板里同名账号会被当成「重新登录」覆盖旧 code，不会重复建号。
         * v7 起这段只在「没匹配到已有账号」时作为新建账号的名字，不再盲目覆盖。 */
        accountName: 'QQ农场',
        /* qq = QQ小程序，wx = 微信小程序 */
        platform: 'qq',
        /* 上传前先 GET /api/user/me 校验身份：换到的 token 属于哪个用户，
         * 拿不到用户名就中止，避免把 code 写进别人的账号列表。 */
        verifyUser: true,
        /* 匹配到已有账号就复用它的 id（按 GID / openId / QQ号 / 备注名依次比对），
         * 匹配不上才新建，避免同名账号互相覆盖。 */
        autoMatch: true,
        /* 上传后确认账号在跑：服务端 startAfterSave 没生效时，再补一次
         * POST /api/accounts/{id}/start。QX 单次脚本有时限，所以只确认一次、
         * 不做桌面助手那种轮询。 */
        autoStart: true
    },
    /* 单次上传最多等多久（毫秒）。登录 + 上传是两次串行请求，移动网络下
     * 很容易超过 4 秒；超时太短会在 $done 放行后把请求掐掉，表现就是
     * 「日志里啥也没有」。9 秒接近 QX 对单次脚本的上限。 */
    uploadWaitMs: 9000
};

var KEY_LAST = 'qqfarm_code_last';
var KEY_LAST_AT = 'qqfarm_code_last_at';
var KEY_CODE = 'qqfarm_code';
var KEY_OPENID = 'qqfarm_openid';
var KEY_VER = 'qqfarm_ver';
/* QX 拿不到 WebSocket 帧，GID / QQ号 / 昵称一般抓不到；
 * 只有握手 URL 里真带了才会写入，供精确匹配用。 */
var KEY_GID = 'qqfarm_gid';
var KEY_UIN = 'qqfarm_uin';
var KEY_NICK = 'qqfarm_nick';
var KEY_AVATAR = 'qqfarm_avatar';
var KEY_HISTORY = 'qqfarm_code_history';
var KEY_TOKEN = 'qqfarm_panel_token';
var KEY_UPLOADED = 'qqfarm_uploaded_code';
var KEY_DEBUG = 'qqfarm_cfg_debug';
var KEY_LOG = 'qqfarm_dbg_log';
var KEY_LAST_ERROR = 'qqfarm_last_error';
var KEY_LAST_RESULT = 'qqfarm_last_result';
/* 下面三个是给 BoxJs 看的：订阅里 qq-farm.boxjs.json 把它们做成只读文本项，
 * 打开 BoxJs 应用就能看到结论和日志，不用去 QX 的日志页翻。 */
var KEY_STATUS = 'qqfarm_status';
var KEY_LOG_VIEW = 'qqfarm_log_view';
/* 单行版镜像：BoxJs 的 textarea 在个别版本上不渲染值，
 * 这里额外把前 3 条各写一个 text 项，保证任何版本都能看到。 */
var KEY_LOG_1 = 'qqfarm_log_1';
var KEY_LOG_2 = 'qqfarm_log_2';
var KEY_LOG_3 = 'qqfarm_log_3';
var KEY_TOUCH = 'qqfarm_last_touch';
var KEY_TOUCH_AT = 'qqfarm_last_touch_at';
/* 抓包开关的可视化状态：BoxJs 里那栏「抓包状态」直接读这两个键。
 * _state 是人看的字符串，_count 存 {"d":"MM-DD","n":次数} 做当日计数。 */
var KEY_CAPTURE_STATE = 'qqfarm_capture_state';
var KEY_CAPTURE_COUNT = 'qqfarm_capture_count';
/* 暂停态写盘的节流时间戳，避免重写规则每命中一次就写一次存储 */
var KEY_PAUSE_AT = 'qqfarm_pause_at';
/* 旧版：一个 JSON 存全部配置（保留兼容，优先级最低） */
var KEY_CFG = 'qqfarm_cfg';

/* BoxJs 设置页写的键（订阅文件 web/public/qqfarm.boxjs.json）。
 * BoxJs 用 $prefs.setValueForKey 落盘，键名与设置项 id 完全一致，
 * 所以这里直接读同名键即可，无需经过 BoxJs 本身。
 */
var BOX_KEYS = {
    capture: 'qqfarm_cfg_capture',
    enabled: 'qqfarm_cfg_enabled',
    baseUrl: 'qqfarm_cfg_baseUrl',
    username: 'qqfarm_cfg_username',
    password: 'qqfarm_cfg_password',
    target: 'qqfarm_cfg_target',
    accountName: 'qqfarm_cfg_accountName',
    accountId: 'qqfarm_cfg_accountId',
    platform: 'qqfarm_cfg_platform',
    notify: 'qqfarm_cfg_notify',
    debug: 'qqfarm_cfg_debug',
    verifyUser: 'qqfarm_cfg_verifyUser',
    autoMatch: 'qqfarm_cfg_autoMatch',
    autoStart: 'qqfarm_cfg_autoStart'
};

/* ----------------------------- 基础工具 ----------------------------- */

/* 日志：一条 line 同时进 QX 日志和本地环形缓冲。
 * 缓冲不依赖 QX 的日志开关，qq-farm-log.js 能随时弹出来看。 */
function pushLogLine(line) {
    var list = [];
    try {
        var raw = $prefs.valueForKey(KEY_LOG);
        if (raw) list = JSON.parse(String(raw)) || [];
        if (!(list instanceof Array)) list = [];
    } catch (e) {
        list = [];
    }
    list.unshift(line);
    if (list.length > 30) list = list.slice(0, 30);
    try {
        $prefs.setValueForKey(JSON.stringify(list), KEY_LOG);
    } catch (e) {}
    renderLogView(list);
}

/* 把「结论 + 最近日志」渲染成一段纯文本，写进 qqfarm_log_view。
 * BoxJs 订阅里这一项是 textarea（只读展示），手机上打开应用即可看到，
 * 不必再去 QX → 日志 里翻。每次写缓冲都会顺带刷新一次。 */
function renderLogView(list) {
    var lines = list;
    if (!(lines instanceof Array)) {
        lines = [];
        try {
            lines = JSON.parse(kvGet(KEY_LOG) || '[]') || [];
        } catch (e) {
            lines = [];
        }
        if (!(lines instanceof Array)) lines = [];
    }

    /* 成功/失败两串都以 "MM-DD HH:mm:ss" 开头，同一年内字典序即时间序 */
    var ok = kvGet(KEY_LAST_RESULT);
    var bad = kvGet(KEY_LAST_ERROR);
    var last = !ok ? bad : (!bad ? ok : (ok >= bad ? ok : bad));
    kvSet(KEY_STATUS, last || '还没有上传记录');

    var out = [];
    out.push('最近结果 ' + (last || '还没有上传记录'));
    out.push('最后触发 ' + (kvGet(KEY_TOUCH) || '还没被触发过'));
    out.push('-------------- 最近日志（新→旧） --------------');
    if (!lines.length) {
        out.push('（空：脚本还没抓到过任何 code）');
    } else {
        var n = lines.length > 20 ? 20 : lines.length;
        for (var i = 0; i < n; i++) out.push(lines[i]);
    }

    var text = out.join('\n');
    if (text.length > 1800) text = text.slice(0, 1800) + '\n…（已截断）';
    kvSet(KEY_LOG_VIEW, text);

    /* 单行镜像：每条独立落一个键，单行文本框一定能显示 */
    kvSet(KEY_LOG_1, lines[0] || '');
    kvSet(KEY_LOG_2, lines[1] || '');
    kvSet(KEY_LOG_3, lines[2] || '');
}

/* 记下「脚本被触发过」。未命中时 5 秒内不重复写盘，避免网关心跳把存储写爆；
 * 命中时一定写，这样 BoxJs 里的「最后触发」永远反映最新一次真实抓取。 */
function markTouch(host, hit) {
    var now = Date.now();
    var last = parseInt(kvGet(KEY_TOUCH_AT), 10) || 0;
    if (!hit && now - last < 5000) return;
    kvSet(KEY_TOUCH_AT, now);
    kvSet(KEY_TOUCH, timeText(now) + ' ' + (host || '(无域名)') + ' 抓到=' + (hit ? '是' : '否'));
    renderLogView();
}

/* quiet=true 的日志只进 QX 日志，不写本地缓冲，避免高频未命中把缓冲刷满 */
function log(msg, quiet) {
    var line = timeText(Date.now()) + ' ' + msg;
    if (!quiet) {
        try {
            pushLogLine(line);
        } catch (e) {}
    }
    if (!CFG.debug) return;
    try {
        console.log('[QQFarm] ' + line);
    } catch (e) {}
}

function kvGet(key) {
    try {
        var v = $prefs.valueForKey(key);
        return v === null || v === undefined ? '' : String(v);
    } catch (e) {
        return '';
    }
}

function kvSet(key, value) {
    try {
        $prefs.setValueForKey(String(value), key);
    } catch (e) {}
}

function pad2(n) {
    return n < 10 ? '0' + n : String(n);
}

function timeText(ms) {
    var d = new Date(ms);
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
        pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

/* 取 URL 主机（去掉端口），失败返回空串 */
function hostOf(url) {
    var m = /^[a-z][a-z0-9+.\-]*:\/\/([^\/?#]+)/i.exec(String(url || ''));
    if (!m) return '';
    return String(m[1]).replace(/:\d+$/, '').toLowerCase();
}

/* 取 URL 查询参数（同名取第一个），失败返回空串 */
function getParam(url, name) {
    var re = new RegExp('[?&]' + name + '=([^&#\\s]*)', 'i');
    var m = re.exec(String(url || ''));
    if (!m) return '';
    var v = m[1];
    try {
        v = decodeURIComponent(v);
    } catch (e) {}
    return v;
}

/* 网关域名：*.nqf.qq.com（含裸域） */
function isGatewayHost(host) {
    if (!host) return false;
    return host === 'nqf.qq.com' || /\.nqf\.qq\.com$/.test(host);
}

/* code 合法性判断：网关域名放宽，其他域名要求长度 >= minLen */
function isValidCode(code, gateway) {
    if (!code || typeof code !== 'string') return false;
    if (code.length < 4 || code.length > 1024) return false;
    if (/^(0|1|true|false|null|undefined|none)$/i.test(code)) return false;
    /* 只接受可见 ASCII，防止把中文/换行之类的东西当 code */
    if (!/^[\x21-\x7e]+$/.test(code)) return false;
    if (gateway) return true;
    return code.length >= CFG.minLen;
}

/* 从 JSON 文本里深扫 code / openid 字段 */
function scanJson(text) {
    var out = { code: '', openID: '' };
    if (!text) return out;
    var parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        var mc = /"code"\s*:\s*"([^"\\]{4,1024})"/i.exec(text);
        if (mc) out.code = mc[1];
        var mo = /"open_?id"\s*:\s*"([^"\\]{4,128})"/i.exec(text);
        if (mo) out.openID = mo[1];
        return out;
    }
    var stack = [parsed];
    var guard = 0;
    while (stack.length > 0 && guard < 5000) {
        guard += 1;
        var cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        var keys = Object.keys(cur);
        for (var i = 0; i < keys.length; i += 1) {
            var k = keys[i];
            var v = cur[k];
            if (typeof v === 'string') {
                var lk = k.toLowerCase();
                if (!out.code && lk === 'code' && v.length >= 4 && v.length <= 1024) out.code = v;
                if (!out.openID && (lk === 'openid' || lk === 'open_id')) out.openID = v;
            } else if (v && typeof v === 'object') {
                stack.push(v);
            }
        }
    }
    return out;
}

/* ----------------------------- 历史记录 ----------------------------- */

function pushHistory(item) {
    var list = [];
    try {
        var raw = kvGet(KEY_HISTORY);
        if (raw) list = JSON.parse(raw) || [];
        if (!(list instanceof Array)) list = [];
    } catch (e) {
        list = [];
    }
    var next = [item];
    for (var i = 0; i < list.length; i += 1) {
        if (list[i] && list[i].code !== item.code) next.push(list[i]);
    }
    if (next.length > CFG.historyLimit) next = next.slice(0, CFG.historyLimit);
    try {
        kvSet(KEY_HISTORY, JSON.stringify(next));
    } catch (e) {}
}

/* --------------------------- 面板接口调用 --------------------------- */

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

function statusOf(resp) {
    if (!resp) return 0;
    return Number(resp.statusCode || resp.status || 0) || 0;
}

/* 取生效配置：配置页写入的 qqfarm_cfg 覆盖文件里的默认值 */
/* BoxJs 保存的布尔值是字符串 "true"/"false"，这里统一宽松解析 */
function boolOf(value, dft) {
    if (value === '' || value === null || value === undefined) return dft;
    var s = String(value).toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
    return dft;
}

/* --------------------- 抓包开关（BoxJs 可视化） --------------------- */

/* 只读一个键，读不到就用脚本里的默认值。
 * 这个函数在 main() 最前面调用，关闭时整条链路直接短路，开销就是一次 $prefs 读。 */
function captureEnabled() {
    var v = kvGet(BOX_KEYS.capture);
    if (v === '') return CFG.capture !== false;
    return boolOf(v, CFG.capture !== false);
}

/* 当日抓取计数，跨天自动归零。返回今天的累计次数。 */
function bumpCaptureCount() {
    var today = timeText(Date.now()).slice(0, 5);
    var raw = parseJson(kvGet(KEY_CAPTURE_COUNT));
    var n = 0;
    if (raw && typeof raw === 'object' && String(raw.d) === today) {
        n = parseInt(raw.n, 10) || 0;
    }
    n += 1;
    kvSet(KEY_CAPTURE_COUNT, JSON.stringify({ d: today, n: n }));
    return n;
}

function todayCount() {
    var today = timeText(Date.now()).slice(0, 5);
    var raw = parseJson(kvGet(KEY_CAPTURE_COUNT));
    if (raw && typeof raw === 'object' && String(raw.d) === today) {
        return parseInt(raw.n, 10) || 0;
    }
    return 0;
}

/* 把「现在在抓还是在停」写成一栏人话，给 BoxJs 直接显示。
 * 暂停态下重写规则每命中一次都会进来，所以按 300 秒节流，
 * 既不丢「脚本还活着」的证据，也不至于把 $prefs 写爆。 */
function writeCaptureState(on, host) {
    var now = Date.now();
    if (on) {
        kvSet(KEY_CAPTURE_STATE,
            '抓包中 · 今日 ' + todayCount() + ' 次 · 最近 ' + timeText(now) +
            (host ? ' · ' + host : ''));
        return;
    }
    var last = parseInt(kvGet(KEY_PAUSE_AT), 10) || 0;
    if (now - last < 300000) return;
    kvSet(KEY_PAUSE_AT, now);
    kvSet(KEY_CAPTURE_STATE,
        '已暂停 · ' + timeText(now) + ' 仍在监听' + (host ? '（' + host + '）' : '') +
        ' · 去上面打开「抓包开关」恢复');
}

/* 配置来源优先级：BoxJs 设置页 > 旧版 qqfarm_cfg JSON > 本文件 CFG.panel 默认值 */
function loadPanelCfg() {
    var p = {
        capture: captureEnabled(),
        enabled: CFG.panel.enabled === true,
        baseUrl: CFG.panel.baseUrl,
        username: CFG.panel.username,
        password: CFG.panel.password,
        mode: 'name',
        accountId: '',
        accountName: CFG.panel.accountName,
        platform: CFG.panel.platform || 'qq',
        notify: CFG.notify !== false,
        verifyUser: CFG.panel.verifyUser !== false,
        autoMatch: CFG.panel.autoMatch !== false,
        autoStart: CFG.panel.autoStart !== false
    };

    var stored = parseJson(kvGet(KEY_CFG));
    if (stored && typeof stored === 'object') {
        var keys = Object.keys(p);
        for (var i = 0; i < keys.length; i += 1) {
            var k = keys[i];
            if (stored[k] !== undefined && stored[k] !== null && stored[k] !== '') p[k] = stored[k];
        }
        p.enabled = stored.enabled === true || stored.enabled === 'true';
        if (stored.accountName) p.accountName = stored.accountName;
    }

    /* BoxJs 设置页：只覆盖用户真正填过的项（空值表示没填，保留上一级的值） */
    var boxEnabled = kvGet(BOX_KEYS.enabled);
    if (boxEnabled !== '') p.enabled = boolOf(boxEnabled, p.enabled);
    var boxNotify = kvGet(BOX_KEYS.notify);
    if (boxNotify !== '') p.notify = boolOf(boxNotify, p.notify);
    var boxBaseUrl = kvGet(BOX_KEYS.baseUrl);
    if (boxBaseUrl !== '') p.baseUrl = boxBaseUrl.replace(/\/+$/, '');
    var boxUser = kvGet(BOX_KEYS.username);
    if (boxUser !== '') p.username = boxUser;
    var boxPass = kvGet(BOX_KEYS.password);
    if (boxPass !== '') p.password = boxPass;
    var boxName = kvGet(BOX_KEYS.accountName);
    if (boxName !== '') p.accountName = boxName;
    var boxId = kvGet(BOX_KEYS.accountId);
    if (boxId !== '') p.accountId = boxId;
    var boxPlatform = kvGet(BOX_KEYS.platform);
    if (boxPlatform !== '') p.platform = boxPlatform;
    var boxTarget = kvGet(BOX_KEYS.target);
    if (boxTarget !== '') p.mode = boxTarget === 'account' ? 'account' : 'name';
    var boxDebug = kvGet(BOX_KEYS.debug);
    if (boxDebug !== '') CFG.debug = boolOf(boxDebug, CFG.debug);
    var boxVerify = kvGet(BOX_KEYS.verifyUser);
    if (boxVerify !== '') p.verifyUser = boolOf(boxVerify, p.verifyUser);
    var boxAutoMatch = kvGet(BOX_KEYS.autoMatch);
    if (boxAutoMatch !== '') p.autoMatch = boolOf(boxAutoMatch, p.autoMatch);
    var boxAutoStart = kvGet(BOX_KEYS.autoStart);
    if (boxAutoStart !== '') p.autoStart = boolOf(boxAutoStart, p.autoStart);

    /* 「指定账号」必须真有 id，否则退回按备注名，避免提交一个空 id 被服务端当新增 */
    if (p.mode === 'account' && !p.accountId) p.mode = 'name';

    /* 通知开关同样作用于上传结果提示 */
    CFG.notify = p.notify !== false;
    /* 抓包开关以独立键为准（上面那段旧 JSON 兼容逻辑不该动它） */
    p.capture = captureEnabled();
    return p;
}

/* 配置快照，日志里只露密码长度，不落明文 */
function describePanel(p) {
    var pwd = p.password ? ('已填(' + p.password.length + '位)') : '未填';
    var tk = kvGet(KEY_TOKEN) ? '有缓存' : '无';
    return 'capture=' + (p.capture ? 'on' : 'off') +
        ' enabled=' + (p.enabled ? 'on' : 'off') +
        ' baseUrl=' + (p.baseUrl || '(空)') +
        ' user=' + (p.username || '(空)') +
        ' pass=' + pwd + ' token=' + tk +
        ' mode=' + p.mode + (p.accountId ? '/' + p.accountId : '') +
        ' name=' + (p.accountName || '(空)') +
        ' platform=' + p.platform + ' notify=' + (p.notify ? 'on' : 'off') +
        ' verifyUser=' + (p.verifyUser ? 'on' : 'off') +
        ' autoMatch=' + (p.autoMatch ? 'on' : 'off') +
        ' autoStart=' + (p.autoStart ? 'on' : 'off');
}

function apiRequest(baseUrl, path, payload, token, method) {
    var base = String(baseUrl || '').replace(/\/+$/, '');
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-admin-token'] = token;
    var opts = {
        url: base + path,
        method: method || 'POST',
        headers: headers,
        timeout: CFG.uploadWaitMs
    };
    if (payload && opts.method !== 'GET') opts.body = JSON.stringify(payload);
    return $task.fetch(opts);
}

/* 服务端字段一律按字符串比对，避免 1000120075 与 "1000120075" 判不相等 */
function normId(value) {
    return String(value === null || value === undefined ? '' : value).trim();
}

/* GET /api/user/me —— 确认当前 token 属于哪个用户。
 * 拿不到用户名就中止：宁可这次不上传，也不要把 code 写进别人的账号里。 */
function fetchMe(panel, token) {
    return apiRequest(panel.baseUrl, '/api/user/me', null, token, 'GET').then(function (resp) {
        var status = statusOf(resp);
        var body = parseJson(resp && resp.body);
        if (status === 401) return { unauthorized: true, status: status, body: body };
        if (status !== 200 || !body || !body.ok || !body.data) {
            throw new Error('身份校验失败: HTTP ' + status +
                ((body && body.error) ? ' ' + body.error : ''));
        }
        var username = normId(body.data.username);
        if (!username) throw new Error('身份校验失败：服务端没有返回用户名');
        log('身份校验通过 user=' + username + ' role=' + normId(body.data.role));
        return { username: username, role: normId(body.data.role) };
    });
}

/* GET /api/accounts —— 拿账号列表用于精确匹配，返回 {accounts:[...], nextId} */
function fetchAccounts(panel, token) {
    return apiRequest(panel.baseUrl, '/api/accounts', null, token, 'GET').then(function (resp) {
        var status = statusOf(resp);
        var body = parseJson(resp && resp.body);
        if (status === 401) return { unauthorized: true, status: status, body: body };
        if (status !== 200 || !body || !body.ok) {
            throw new Error('拉取账号列表失败: HTTP ' + status +
                ((body && body.error) ? ' ' + body.error : ''));
        }
        var data = body.data || {};
        var list = Array.isArray(data.accounts) ? data.accounts
            : (Array.isArray(data) ? data : []);
        log('账号列表 ' + list.length + ' 个');
        return { accounts: list };
    });
}

/* POST /api/accounts/{id}/start —— startAfterSave 没生效时兜底启动一次 */
function startAccount(panel, token, id) {
    var path = '/api/accounts/' + encodeURIComponent(normId(id)) + '/start';
    return apiRequest(panel.baseUrl, path, {}, token, 'POST').then(function (resp) {
        var status = statusOf(resp);
        var body = parseJson(resp && resp.body);
        log('启动账号 id=' + id + ' → HTTP ' + status + ' ' + String((resp && resp.body) || '').slice(0, 120));
        return { status: status, body: body };
    });
}

/* 从账号列表里挑出这次要更新的账号。
 * 顺序：指定 id → openId → GID → QQ号/uin → 备注名（同平台）。
 * 命中多条同名时直接中止，宁可让用户去改备注，也不猜一个覆盖掉。 */
function pickTargetAccount(accounts, panel, capture) {
    var list = Array.isArray(accounts) ? accounts : [];
    var i;

    if (panel.mode === 'account' && panel.accountId) {
        for (i = 0; i < list.length; i += 1) {
            if (normId(list[i] && list[i].id) === normId(panel.accountId)) {
                return { account: list[i], reason: '指定账号 id=' + normId(list[i].id) };
            }
        }
        return { account: null, reason: '指定账号 id=' + panel.accountId + ' 不在列表里', error: true };
    }

    if (!panel.autoMatch) return { account: null, reason: '未启用自动匹配，按备注名处理' };

    if (capture.openID) {
        for (i = 0; i < list.length; i += 1) {
            var oid = normId(list[i] && (list[i].openId || list[i].open_id || list[i].openid));
            if (oid && oid === normId(capture.openID)) {
                return { account: list[i], reason: 'openId 匹配' };
            }
        }
    }

    if (capture.gid) {
        for (i = 0; i < list.length; i += 1) {
            var gid = normId(list[i] && list[i].gid);
            if (gid && gid === normId(capture.gid)) {
                return { account: list[i], reason: 'GID 匹配' };
            }
        }
    }

    var qq = normId(capture.uin || capture.qq);
    if (qq) {
        for (i = 0; i < list.length; i += 1) {
            var accQq = normId(list[i] && (list[i].qq || list[i].uin));
            if (accQq && accQq === qq) {
                return { account: list[i], reason: 'QQ号匹配' };
            }
        }
    }

    var wantName = normId(panel.accountName);
    if (wantName) {
        var named = [];
        for (i = 0; i < list.length; i += 1) {
            var acc = list[i] || {};
            if (normId(acc.name) !== wantName) continue;
            if (normId(acc.platform || 'qq') !== normId(panel.platform || 'qq')) continue;
            named.push(acc);
        }
        if (named.length === 1) return { account: named[0], reason: '备注名匹配' };
        if (named.length > 1) {
            return {
                account: null,
                reason: '有 ' + named.length + ' 个同名账号(' + wantName + ')，无法确定覆盖哪一个',
                error: true
            };
        }
    }

    return { account: null, reason: '列表里没有匹配账号，按新建处理' };
}

/* 登录换 token。面板 token 存在内存里，服务一重启就失效，所以按需登录。 */
function loginPanel(panel) {
    if (!panel.password) {
        throw new Error('未配置面板密码');
    }
    var started = Date.now();
    log('登录 → POST ' + panel.baseUrl + '/api/login user=' + panel.username);
    return apiRequest(panel.baseUrl, '/api/login', {
        username: panel.username,
        password: panel.password
    }).then(function (resp) {
        var status = statusOf(resp);
        var body = parseJson(resp && resp.body);
        var cost = Date.now() - started;
        if (status === 200 && body && body.ok && body.data && body.data.token) {
            kvSet(KEY_TOKEN, body.data.token);
            log('登录成功 ' + status + ' ' + cost + 'ms token=' + String(body.data.token).slice(0, 8) + '…');
            return body.data.token;
        }
        /* 面板对同 IP 有节流：每分钟 10 次，连续失败 5 次锁 15 分钟 */
        var msg = (body && body.error) || ('HTTP ' + status);
        if (status === 423) msg = 'IP 被锁，稍后再试（' + msg + '）';
        if (status === 429) msg = '请求太频繁（' + msg + '）';
        if (status === 0) msg = '连不上面板，检查地址/端口/手机网络';
        log('登录失败 ' + status + ' ' + cost + 'ms msg=' + msg);
        kvSet(KEY_LAST_ERROR, timeText(Date.now()) + ' 登录失败: ' + msg + ' (HTTP ' + status + ')');
        throw new Error('登录失败: ' + msg);
    });
}

/* 把 code 写进面板。
 * - 命中已有账号：带 id 走更新分支，只动 code（和补上缺失的 openId/GID）
 * - 没命中：按备注名新建
 * - startAfterSave=true：服务端落盘后在后台启动（正在跑的账号会自动重启），
 *   不用客户端再等一次请求，省 QX 的时间预算。
 */
function addAccount(panel, capture, target, token) {
    var existing = target && target.account ? target.account : null;
    var payload = {
        name: existing ? (normId(existing.name) || panel.accountName || 'QQ农场')
            : (panel.accountName || 'QQ农场'),
        platform: panel.platform || 'qq',
        code: capture.code,
        loginType: 'manual',
        startAfterSave: true
    };
    if (existing) payload.id = normId(existing.id);
    /* 服务端只认 openId / open_id（models/store.js 的 addOrUpdateAccount），
     * v6 发的小写 openid 会被丢掉，这里两个都带上。 */
    if (capture.openID) {
        payload.openId = capture.openID;
        payload.open_id = capture.openID;
    }
    if (capture.gid) payload.gid = normId(capture.gid);
    if (capture.uin || capture.qq) {
        payload.uin = normId(capture.uin || capture.qq);
        payload.qq = normId(capture.qq || capture.uin);
    }
    if (capture.nick) payload.nick = capture.nick;
    if (capture.avatar) payload.avatar = capture.avatar;

    var started = Date.now();
    log('上传 → POST ' + panel.baseUrl + '/api/accounts ' +
        (payload.id ? 'id=' + payload.id : '新建') +
        ' name=' + payload.name + ' code=' + String(capture.code).slice(0, 8) + '…');
    return apiRequest(panel.baseUrl, '/api/accounts', payload, token).then(function (resp) {
        var status = statusOf(resp);
        var body = parseJson(resp && resp.body);
        var cost = Date.now() - started;
        log('上传响应 ' + status + ' ' + cost + 'ms body=' +
            String((resp && resp.body) || '').slice(0, 200));
        var data = (body && body.data) || {};
        var list = Array.isArray(data.accounts) ? data.accounts
            : (Array.isArray(data) ? data : []);
        var picked = null;
        var i;
        if (payload.id) {
            for (i = 0; i < list.length; i += 1) {
                if (normId(list[i] && list[i].id) === payload.id) { picked = list[i]; break; }
            }
        } else {
            /* 新建：服务端返回全量列表，取同名同平台里 id 最大的那个 */
            var bestId = -1;
            for (i = 0; i < list.length; i += 1) {
                var item = list[i] || {};
                if (normId(item.name) !== normId(payload.name)) continue;
                if (normId(item.platform || 'qq') !== normId(payload.platform)) continue;
                var num = parseInt(normId(item.id), 10);
                if (!(num > bestId)) continue;
                bestId = num;
                picked = item;
            }
        }
        return {
            status: status,
            body: body,
            account: picked,
            startup: body && body.startup ? body.startup : null
        };
    });
}

function notifyUploadOk(panel, code, extra) {
    if (!CFG.notify) return;
    try {
        $notify('QQ农场 Code 已上传', (extra || panel.accountName || 'QQ农场') + ' · 面板已开始登录', code);
    } catch (e) {}
}

function notifyUploadFail(code, reason) {
    if (!CFG.notify) return;
    try {
        $notify('QQ农场 上传失败', String(reason || '未知原因').slice(0, 60) + ' · 可手动复制', code);
    } catch (e) {}
}

/* 自检通道：Safari 打开带 code=QXTEST 的网关地址时走这里（不上传）。
 * 作用是把「脚本有没有在跑 / 配置读到没 / 缓冲里有什么」直接用通知弹出来，
 * 不依赖 BoxJs 是否渲染那一栏，也不依赖 QX 的日志开关。
 * 弹不出来 = 脚本压根没被触发（重写没启用 / MITM 没开 / 证书没信任）。 */
function selfTestReport(code, host) {
    var lines = [];
    try {
        var raw = $prefs.valueForKey(KEY_LOG);
        if (raw) lines = JSON.parse(String(raw)) || [];
    } catch (e) {
        lines = [];
    }
    if (!(lines instanceof Array)) lines = [];

    var panel = loadPanelCfg();
    /* 自检也算一次"被触发"，让 BoxJs 里的「最后触发」能立刻反映出来 */
    var nowMs = Date.now();
    kvSet(KEY_TOUCH_AT, nowMs);
    kvSet(KEY_TOUCH, timeText(nowMs) + ' ' + (host || '(无域名)') + ' 抓到=是（自检 ' + SCRIPT_VER + '）');
    renderLogView(lines);

    /* 写读回测：把一串带时间戳的值写进 $prefs 再读回来比对。
     * BoxJs 那几栏空白时，这一项能把「脚本根本没写进去」和
     * 「脚本写了但 BoxJs 读的键不对」两种情况分开，不用再猜。 */
    var probeKey = 'qqfarm_probe';
    var probeVal = 'P' + nowMs;
    kvSet(probeKey, probeVal);
    var probeBack = kvGet(probeKey);
    var probeOk = (probeBack === probeVal);
    var viewLen = kvGet(KEY_LOG_VIEW).length;
    var log1 = kvGet(KEY_LOG_1);

    var cfgLine = '抓包开关=' + (panel.capture ? '开（正在抓）' : '关（已暂停）') +
        ' · 今日 ' + todayCount() + ' 次' +
        '\nenabled=' + (panel.enabled ? 'on' : 'off') +
        '\nbaseUrl=' + (panel.baseUrl || '未填') +
        '\nuser=' + (panel.username || '未填') +
        '\npass=' + (panel.password ? '已填(' + panel.password.length + '位)' : '未填') +
        '\nmode=' + panel.mode + ' name=' + (panel.accountName || '未填');

    var ioLine = '写读回测 ' + (probeOk ? 'OK（存储可读写）' : '失败，读回=' + (probeBack || '空')) +
        '\n运行日志全文：' + viewLen + ' 字符' +
        '\n日志1：' + (log1 || '(空)') +
        '\n脚本版本：' + SCRIPT_VER;

    try {
        $notify('QQ农场自检 ' + SCRIPT_VER + ' · 脚本在跑',
            '命中 ' + (host || '(无域名)') + ' · 缓冲 ' + lines.length + ' 条',
            ioLine + '\n\n配置快照：\n' + cfgLine);
    } catch (e) {}

    var body = lines.length
        ? lines.slice(0, 5).join('\n')
        : '缓冲是空的：脚本能跑，但还没抓到过 code';
    try {
        $notify('QQ农场自检 · 最近日志',
            lines.length + ' 条（新→旧，最多显示 5 条）',
            body);
    } catch (e) {}

    log('自检触发 ' + SCRIPT_VER + ' host=' + (host || '(无)') +
        ' 缓冲=' + lines.length + ' 条 写读回测=' + (probeOk ? 'OK' : '失败'));
}

/* 一次完整推送：登录 → 校验身份 → 拉账号 → 精确匹配 → 写 code → 确认启动。
 * 返回 { unauthorized:true } 时由调用方重登后整条重跑一次。 */
function pushOnce(panel, capture, token) {
    var auth = token ? Promise.resolve(token) : loginPanel(panel);
    return auth.then(function (t) {
        /* 身份校验与账号列表互不依赖，并行发，省一半等待时间 */
        return Promise.all([
            panel.verifyUser ? fetchMe(panel, t) : Promise.resolve(null),
            fetchAccounts(panel, t)
        ]).then(function (results) {
            var me = results[0];
            var snapshot = results[1];
            if ((me && me.unauthorized) || (snapshot && snapshot.unauthorized)) {
                return { unauthorized: true };
            }
            var list = (snapshot && snapshot.accounts) || [];
            var pick = pickTargetAccount(list, panel, capture);
            log('目标账号：' + pick.reason +
                (pick.account ? ' → id=' + normId(pick.account.id) + ' name=' + normId(pick.account.name) : ''));
            if (pick.error) throw new Error(pick.reason);

            return addAccount(panel, capture, pick, t).then(function (res) {
                res.pick = pick;
                if (res.status === 401) return { unauthorized: true };
                if (!res.body || !res.body.ok) {
                    throw new Error('上传失败 HTTP ' + res.status + ' ' +
                        ((res.body && (res.body.error || res.body.message)) || ''));
                }
                var acc = res.account;
                var queued = !!(res.startup && res.startup.queued);
                var running = !!(acc && acc.running === true);
                if (panel.autoStart && acc && !running && !queued && normId(acc.id)) {
                    /* startAfterSave 没生效（例如队列被跳过）时兜底启动一次 */
                    return startAccount(panel, t, acc.id).then(function () {
                        res.startFallback = true;
                        return res;
                    });
                }
                res.accountRunning = running || queued;
                return res;
            });
        });
    });
}

function upload(code, openID) {
    var panel = loadPanelCfg();
    log('配置 ' + describePanel(panel));
    if (!panel.enabled) {
        log('自动上传未开启（qqfarm_cfg_enabled），只通知');
        return null;
    }
    /* 同一条 code 只上传一次，QX 重启/重连也不会重复推 */
    if (kvGet(KEY_UPLOADED) === code) {
        log('该 code 已上传过，跳过');
        return null;
    }
    if (!panel.baseUrl) {
        log('中止：未配置面板地址');
        kvSet(KEY_LAST_ERROR, timeText(Date.now()) + ' 未配置面板地址');
        notifyUploadFail(code, '未配置面板地址');
        return null;
    }
    if (!panel.password && !kvGet(KEY_TOKEN)) {
        log('中止：未配置面板密码');
        kvSet(KEY_LAST_ERROR, timeText(Date.now()) + ' 未配置面板密码');
        notifyUploadFail(code, '未配置面板密码');
        return null;
    }

    /* QX 只能读到握手 URL，拿不到 WebSocket 帧，所以 GID / QQ 号 / 昵称
     * 通常是空的；留在 capture 里是为了将来 URL 里带了就直接用上。 */
    var capture = {
        code: code,
        openID: openID || kvGet(KEY_OPENID),
        gid: kvGet(KEY_GID),
        uin: kvGet(KEY_UIN),
        qq: kvGet(KEY_UIN),
        nick: kvGet(KEY_NICK),
        avatar: kvGet(KEY_AVATAR)
    };

    var token = kvGet(KEY_TOKEN);
    log(token ? '复用缓存 token' : '无缓存 token，先登录');

    return pushOnce(panel, capture, token)
        .then(function (res) {
            /* token 过期（服务重启/改密清空）时自动重登一次再试 */
            if (res && res.unauthorized) {
                log('token 失效(401)，重新登录后重试');
                kvSet(KEY_TOKEN, '');
                return loginPanel(panel).then(function (t) { return pushOnce(panel, capture, t); });
            }
            return res;
        })
        .then(function (res) {
            if (res && res.body && res.body.ok) {
                var acc = res.account || {};
                var accName = normId(acc.name) || panel.accountName;
                var extra = accName + (acc.id ? ' #' + normId(acc.id) : '') +
                    (res.accountRunning ? ' · 运行中' : (res.startFallback ? ' · 已补启动' : ''));
                kvSet(KEY_UPLOADED, code);
                kvSet(KEY_LAST_RESULT, timeText(Date.now()) + ' 上传成功 · ' + extra);
                log('上传成功，已记录：' + extra);
                notifyUploadOk(panel, code, extra);
                return res;
            }
            var reason = (res && res.unauthorized)
                ? 'token 失效：重新登录后仍被拒绝（401）'
                : ((res && res.body && (res.body.error || res.body.message))
                    || ('HTTP ' + (res ? res.status : 0)));
            kvSet(KEY_LAST_ERROR, timeText(Date.now()) + ' 上传失败: ' + reason +
                ' (HTTP ' + (res ? res.status : 0) + ')');
            log('上传失败: ' + reason);
            notifyUploadFail(code, reason);
            return res;
        }, function (err) {
            var reason = String((err && err.message) || err || '网络异常');
            kvSet(KEY_LAST_ERROR, timeText(Date.now()) + ' 上传异常: ' + reason);
            log('上传异常: ' + reason);
            notifyUploadFail(code, reason);
            return null;
        });
}

/* 配置模式：完全不依赖 BoxJs。
 *
 * Safari 打开下面这种链接（由配套的 Scriptable 脚本「QQ农场配置」生成）：
 *   https://gate-obt.nqf.qq.com/prod/ws?platform=qq&ver=1&code=QXSETUP
 *     &base=<面板地址>&user=<账号>&pass=<密码>&name=<备注>
 * 脚本把值写进 $prefs 就结束：不抓码、不上传、不写历史。
 *
 * 写完立刻返回一个假响应，让这次请求根本不出网——密码不会跟着请求
 * 打到腾讯网关上。真正的配置源始终是 $prefs，跟 BoxJs 写的是同一批键，
 * 所以装了 BoxJs 的用户照样能在 BoxJs 里看到并修改。
 */
var setupResponse = null;

function applySetup(url) {
    var base = getParam(url, 'base').replace(/\/+$/, '');
    var user = getParam(url, 'user');
    var pass = getParam(url, 'pass');
    var name = getParam(url, 'name');
    var plat = getParam(url, 'plat') || 'qq';
    var target = getParam(url, 'target') || 'name';
    var auto = getParam(url, 'auto');

    if (!base) {
        try {
            $notify('QQ农场 配置未保存', '链接里没有面板地址', '用 Scriptable 的「QQ农场配置」重新生成');
        } catch (e) {}
        setupResponse = {
            status: 'HTTP/1.1 200 OK',
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            body: '<meta name="viewport" content="width=device-width"><h3>缺少面板地址</h3>'
        };
        return;
    }

    kvSet(BOX_KEYS.baseUrl, base);
    if (user) kvSet(BOX_KEYS.username, user);
    if (pass) kvSet(BOX_KEYS.password, pass);
    if (name) kvSet(BOX_KEYS.accountName, name);
    kvSet(BOX_KEYS.platform, plat);
    kvSet(BOX_KEYS.target, target);
    /* 其余开关直接拉满：抓包开、自动上传开、三个 v7 校验项开 */
    kvSet(BOX_KEYS.capture, 'true');
    kvSet(BOX_KEYS.enabled, auto === '0' ? 'false' : 'true');
    kvSet(BOX_KEYS.verifyUser, 'true');
    kvSet(BOX_KEYS.autoMatch, 'true');
    kvSet(BOX_KEYS.autoStart, 'true');
    kvSet(BOX_KEYS.notify, 'true');

    /* 读回来确认真的落盘了，别只写不验 */
    var savedBase = kvGet(BOX_KEYS.baseUrl);
    var savedPass = kvGet(BOX_KEYS.password);
    var ok = (savedBase === base);

    var nowMs = Date.now();
    kvSet(KEY_TOUCH_AT, nowMs);
    kvSet(KEY_TOUCH, timeText(nowMs) + ' 写入配置 ' + base);
    log('配置写入 base=' + base + ' user=' + (user || '(空)') +
        ' pass=' + (pass ? pass.length + '位' : '空') +
        ' name=' + (name || '(空)') + ' 回读=' + (ok ? '正常' : '失败'));

    var detail = [
        '地址 ' + base,
        '账号 ' + (kvGet(BOX_KEYS.username) || '(未填)'),
        '密码 ' + (savedPass ? '已写入 ' + savedPass.length + ' 位' : '(未填)'),
        '备注 ' + (kvGet(BOX_KEYS.accountName) || '(未填)'),
        '自动上传 ' + (kvGet(BOX_KEYS.enabled) === 'false' ? '关' : '开'),
        '回读 ' + (ok ? '正常' : '失败，请重试')
    ].join('\n');

    try {
        $notify(ok ? 'QQ农场 配置已保存' : 'QQ农场 配置异常',
            SCRIPT_VER + ' · 不用 BoxJs 也能配', detail);
    } catch (e) {}

    setupResponse = {
        status: 'HTTP/1.1 200 OK',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: '<meta name="viewport" content="width=device-width">' +
            '<body style="font:16px/1.7 -apple-system;padding:24px">' +
            '<h3>' + (ok ? '配置已保存' : '配置写入异常') + '</h3>' +
            '<p>' + base + '</p>' +
            '<p>账号：' + (kvGet(BOX_KEYS.username) || '(未填)') + '<br>' +
            '密码：' + (savedPass ? '已写入 ' + savedPass.length + ' 位' : '(未填)') + '<br>' +
            '备注：' + (kvGet(BOX_KEYS.accountName) || '(未填)') + '</p>' +
            '<p style="color:#888">可以关掉本页，去打开 QQ经典农场了。建议清一下 Safari 历史记录。</p>' +
            '</body>'
    };
}

/* ----------------------------- 主流程 ----------------------------- */

function main() {
    var url = '';
    var reqBody = '';
    var respBody = '';
    var hasResponse = (typeof $response !== 'undefined') && !!$response;

    if (typeof $request !== 'undefined' && $request) {
        url = String($request.url || '');
        if ($request.body) reqBody = String($request.body);
    }
    if (hasResponse) {
        if (!url) url = String($response.url || '');
        if ($response.body) respBody = String($response.body);
    }

    var host = hostOf(url);
    var gateway = isGatewayHost(host);
    var code = getParam(url, 'code');
    var openID = getParam(url, 'openID') || getParam(url, 'openid') || '';
    var ver = getParam(url, 'ver') || getParam(url, 'version') || '';

    /* 配置模式最先判断：它只写配置，跟抓码/上传完全无关。
     * 链接由 Scriptable 脚本生成，见文件顶部 applySetup 的说明。 */
    if (code === 'QXSETUP') {
        applySetup(url);
        return null;
    }

    /* 自检最先判断，且不受抓包开关影响 —— 它是排查通道，
     * Safari 打开下面这个地址就能看脚本状态，即使平时把抓包关掉了也能用：
     * https://gate-obt.nqf.qq.com/prod/ws?platform=qq&ver=1.0.0_20260101&code=QXTEST-0000-1111-2222
     * 立这条的原因：URL 里的 code 参数是唯一入口，不需要扫 body。 */
    if (code && code.indexOf('QXTEST') === 0) {
        selfTestReport(code, host);
        return null;
    }

    /* 抓包总开关：关闭时这里就返回。
     * 往下（读 body、扫 JSON、写历史、弹通知、上传）全部不执行，
     * 只按 5 分钟节流写一行「已暂停」，让 BoxJs 能区分
     * 「我主动关的」和「脚本压根没跑」。 */
    if (!captureEnabled()) {
        writeCaptureState(false, host);
        return null;
    }

    /* 每次触发都留一行：没抓到的时候，靠这行判断「脚本到底有没有跑」 */
    log('触发 ' + (hasResponse ? 'response' : 'request') +
        ' host=' + (host || '(无)') + ' gateway=' + gateway +
        ' 参数code=' + (code ? '有' : '无'), true);

    if (!code && reqBody) {
        var fromReq = scanJson(reqBody);
        if (fromReq.code) {
            code = fromReq.code;
            if (!openID) openID = fromReq.openID;
        }
    }
    if (!code && respBody) {
        var fromResp = scanJson(respBody);
        if (fromResp.code) {
            code = fromResp.code;
            if (!openID) openID = fromResp.openID;
        }
    }

    if (!isValidCode(code, gateway)) {
        markTouch(host, false);
        log('未命中 host=' + (host || '(无)') + ' gateway=' + gateway +
            ' code=' + (code ? code.slice(0, 8) + '…' : '(空)'), true);
        return null;
    }
    markTouch(host, true);
    /* 抓到真 code 才计数，未命中的心跳不算「抓了 N 次」 */
    bumpCaptureCount();
    writeCaptureState(true, host);

    var now = Date.now();
    var lastCode = kvGet(KEY_LAST);
    var lastAt = parseInt(kvGet(KEY_LAST_AT), 10) || 0;
    var isDup = (code === lastCode) && (now - lastAt < CFG.dedupMs);

    kvSet(KEY_CODE, code);
    kvSet(KEY_LAST, code);
    kvSet(KEY_LAST_AT, now);
    if (openID) kvSet(KEY_OPENID, openID);
    if (ver) kvSet(KEY_VER, ver);
    /* 极少数情况下网关 URL 会带 gid / uin，带上就能做精确匹配 */
    var gidParam = getParam(url, 'gid') || getParam(url, 'GID') || '';
    var uinParam = getParam(url, 'uin') || getParam(url, 'qq') || '';
    if (gidParam) kvSet(KEY_GID, gidParam);
    if (uinParam) kvSet(KEY_UIN, uinParam);

    if (isDup) {
        log('重复 code（' + Math.round((now - lastAt) / 1000) + 's 内），只更新落盘', true);
        return null;
    }

    pushHistory({ code: code, openID: openID, ver: ver, host: host, at: now });
    log('抓到 code=' + code.slice(0, 8) + '… len=' + code.length +
        (openID ? ' openid=' + openID.slice(-6) : '') + (ver ? ' ver=' + ver : '') + ' host=' + host);

    /* 开了自动上传就只发一条「已上传/失败」通知；没开才发「已捕获」 */
    if (!loadPanelCfg().enabled && CFG.notify) {
        var sub = timeText(now) + ' · 长按可复制';
        if (host) sub = host + ' · ' + sub;
        try {
            $notify('QQ农场 Code 已捕获', sub, code);
        } catch (e) {}
    }

    return upload(code, openID);
}

var startedAt = Date.now();
var pending = main();

/* 收尾：请求/响应原样放行，绝不改写。
 * 上传是异步的，所以加一个超时兜底，面板不通时最多等 uploadWaitMs 就放行，
 * 避免把 QQ 的 WebSocket 握手拖到超时。 */
var finished = false;

function finish() {
    if (finished) return;
    finished = true;
    log('放行请求，本次耗时 ' + (Date.now() - startedAt) + 'ms', true);
    try {
        /* 配置模式：直接把这次请求短路成一个网页，别让它带着密码出网 */
        $done(setupResponse || {});
    } catch (e) {}
}

if (pending && typeof pending.then === 'function') {
    pending.then(finish, function (e) {
        log('收尾异常: ' + e);
        finish();
    });
    try {
        if (typeof setTimeout === 'function') setTimeout(finish, CFG.uploadWaitMs);
    } catch (e) {}
} else {
    finish();
}
