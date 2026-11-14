// QQ农场 · QX 配置助手（Scriptable）
//
// 作用：弹表单填 4 个值 → 生成一条链接 → 用 Safari 打开
//       → QX 里的 qq-farm-code-v8.js 收到后把配置写进 $prefs。
// 不需要 BoxJs，也不需要面板能连外网。
//
// 安装：Scriptable 新建脚本 → 把本文件内容整段粘贴进去 → 命名「QQ农场配置」
// 用法：点运行，填完四个值选「写入并自动上传」，Safari 会自动打开并弹通知

const PRESET_KEY = 'qqfarm.setup.preset';
const DEFAULTS = {
  base: '',
  user: 'admin',
  pass: '',
  name: 'Windows QQ',
};

function loadPreset() {
  const preset = { ...DEFAULTS };
  try {
    if (Keychain.contains(PRESET_KEY)) {
      Object.assign(preset, JSON.parse(Keychain.get(PRESET_KEY)));
    }
  } catch (e) {}
  return preset;
}

async function tip(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction('好');
  await a.presentAlert();
}

const prev = loadPreset();

const form = new Alert();
form.title = 'QQ农场 · 面板配置';
form.message = '填好点按钮，会打开 Safari 完成写入。QX 必须处于运行状态。';
form.addTextField('面板地址', prev.base);
form.addTextField('管理员账号', prev.user);
form.addSecureTextField('密码');
form.addTextField('账号备注', prev.name);
form.addAction('写入并自动上传');
form.addAction('写入，只抓码不上传');
form.addCancelAction('取消');

const picked = await form.present();
if (picked === -1) {
  return;
}

const base = form.textFieldValue(0).trim().replace(/\/+$/, '');
const user = form.textFieldValue(1).trim();
const pass = form.textFieldValue(2);
const name = form.textFieldValue(3).trim();

if (!base) {
  await tip('填错了', '面板地址不能为空，例：https://你的面板域名:4007');
  return;
}
if (!base.startsWith('http://') && !base.startsWith('https://')) {
  await tip('填错了', '面板地址要以 http:// 或 https:// 开头');
  return;
}
if (!pass) {
  await tip('还差一步', '密码不能为空，否则脚本没法登录面板换取上传权限');
  return;
}

Keychain.set(PRESET_KEY, JSON.stringify({ base, user, pass, name }));

const auto = picked === 0 ? '1' : '0';
const url =
  'https://gate-obt.nqf.qq.com/prod/ws?platform=qq&ver=1.0.0_20260101&code=QXSETUP' +
  '&base=' + encodeURIComponent(base) +
  '&user=' + encodeURIComponent(user) +
  '&pass=' + encodeURIComponent(pass) +
  '&name=' + encodeURIComponent(name) +
  '&auto=' + auto;

Safari.open(url);
