// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: orange; icon-glyph: stethoscope;
//
// QQ农场小组件 · 连通性诊断
// 只读，不改配置。跑完把弹窗内容截图发我。

const K_BASE = 'qqfarm_w_base';
const K_USER = 'qqfarm_w_user';
const K_PASS = 'qqfarm_w_pass';

function kv(k) {
  try {
    return Keychain.contains(k) ? Keychain.get(k) : '';
  } catch (e) {
    return '';
  }
}

const base = String(kv(K_BASE) || '').replace(/\/+$/, '');
const user = String(kv(K_USER) || '');
const pass = String(kv(K_PASS) || '');

const out = [];
out.push('地址 ' + (base || '(未配置)'));
out.push('用户 ' + (user || '(空)') + ' · 密码 ' + (pass ? pass.length + '位' : '(空)'));
out.push('');

// mode: 'once' = 一次性整体赋值（新版）；'item' = 逐项赋值（旧版，怀疑丢头）
async function call(path, opt) {
  opt = opt || {};
  const req = new Request(base + path);
  req.method = opt.method || 'GET';
  req.timeoutInterval = 15;

  if (opt.mode === 'item') {
    req.headers = { 'Content-Type': 'application/json' };
    if (opt.token) req.headers['x-admin-token'] = String(opt.token);
  } else {
    const h = { 'Content-Type': 'application/json' };
    if (opt.token) h['x-admin-token'] = String(opt.token);
    req.headers = h;
  }

  if (opt.body) req.body = JSON.stringify(opt.body);

  let text = '';
  let st = 0;
  try {
    text = await req.loadString();
    st = req.response ? req.response.statusCode : 0;
  } catch (e) {
    return { st: -1, text: 'ERR ' + (e && e.message ? e.message : e) };
  }
  return { st: st, text: String(text) };
}

let token = '';

if (!base) {
  out.push('没有配置地址，先跑一次主脚本填配置');
} else {
  const login = await call('/api/login', {
    method: 'POST',
    body: { username: user, password: pass },
  });
  out.push('login → ' + login.st + ' ' + login.text.slice(0, 100));

  try {
    const j = JSON.parse(login.text);
    token = (j && j.data && j.data.token) || '';
  } catch (e) {}

  out.push('token ' + (token ? token.length + ' 位' : '空'));
  out.push('');

  if (token) {
    const meOnce = await call('/api/user/me', { token: token, mode: 'once' });
    out.push('me(整体赋值) → ' + meOnce.st);

    const accOnce = await call('/api/accounts', { token: token, mode: 'once' });
    out.push('accounts(整体赋值) → ' + accOnce.st + ' ' + accOnce.text.slice(0, 80));

    const accItem = await call('/api/accounts', { token: token, mode: 'item' });
    out.push('accounts(逐项赋值) → ' + accItem.st + ' ' + accItem.text.slice(0, 80));

    if (accOnce.st === 200) {
      try {
        const d = JSON.parse(accOnce.text).data;
        const list = (d && (d.accounts || d)) || [];
        out.push('');
        out.push('读到 ' + list.length + ' 个账号');
        list.slice(0, 4).forEach(function (a) {
          out.push('  #' + a.id + ' ' + (a.nick || a.name) + (a.running ? ' 运行中' : ' 未运行'));
        });
      } catch (e) {}
    }
  }
}

const msg = out.join('\n');
Pasteboard.copy(msg);
const a = new Alert();
a.title = 'QQ农场诊断';
a.message = msg + '\n\n（已复制到剪贴板）';
a.addAction('好');
await a.presentAlert();
