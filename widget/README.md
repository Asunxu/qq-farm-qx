# QQ农场 · Scriptable 小组件

在 iPhone 桌面看面板状态：几个账号、谁在线、等级、四类货币（金币/点券/钻石/金豆）、今日收偷浇水和同气礼包。

三种尺寸都支持：

- **小**：在线数 / 总数 + 金币、点券合计 + 在跑数
- **中**：最多 3 个账号，每个两行（状态行 + 这个账号自己的四类货币）+ 今日统计，右下角「↻ 刷新」可点
- **大**：最多 5 个账号，每个三行（状态、四类货币、今日操作）+ 汇总

App 里运行脚本会打开设置菜单（原生 Alert 列表），不用改代码也能改地址、密码、标题、开关。点小组件右下角的「↻ 刷新」会重取一次数据；点其他地方打开面板网页。

## 安装

1. 手机 Scriptable → 右上角 `+` → 新建脚本
2. 把 `QQ农场.js` 全部内容粘进去
3. 脚本名改成 `QQ农场`（点小组件跳转时按名字找，别留成 `QQ农场 1`）
4. 在 Scriptable 里运行一次 → 设置界面里填面板地址、用户名、密码
5. 回桌面长按空白 → 左上 `+` → 搜 Scriptable → 选尺寸 → 添加
6. 长按小组件 → 编辑小组件 → Script 选 `QQ农场`

面板地址要带协议和端口，例如 `https://example.com:4007`，结尾斜杠会自动去掉。

## 设置界面

运行脚本（App 内）看到的是：

一条条列出来，当前值直接写在标题里，点哪条改哪条：

| 项目 | 说明 |
|---|---|
| 面板地址 · host:4007 | 点开是输入框 |
| 用户名 · admin | 点开是输入框 |
| 密码 · 已设置 | 点开是密码输入框 |
| 连接测试 · 正常 / 失败 | 重连一次并刷新摘要 |
| 显示金币 / 点券 / 钻石 / 金豆 / 今日统计 | 点一下开 → 关 → 开 |
| 小组件标题 | 点开是输入框 |
| 预览小组件 | 弹出中尺寸预览 |
| 刷新数据 | 重新拉接口 |
| 打开面板网页 | Safari 打开 |
| 关于 | 版本与字段说明 |

改完立刻写进钥匙串，小组件下次刷新就用新设置。

## 刷新按钮

中号/大号右下角那行 `12:07 更新 │ ↻ 刷新`，**只有「↻ 刷新」这几个字是可点的**（Scriptable 的 `WidgetText.url` 支持中/大尺寸单独设点击目标；小号只能是整个组件一个目标）。

点它会用 URL scheme 拉起本脚本：

```
scriptable:///run/QQ农场?action=refresh
```

脚本读到 `args.queryParameters.action === 'refresh'` 就只重取数据、弹出刷新后的中号预览，不弹设置菜单。

两个前提：

- 脚本名必须是 `QQ农场`。名字改了，URL 找不到脚本，点了没反应（`Script.name()` 会自动跟着改，所以复制改名也 OK，只要和桌面组件里选的那个一致）

- 点组件其他地方仍然是打开面板网页；小号组件没有单独的刷新按钮，整块点击 = 打开面板

## 账号密码存在哪

Keychain：

| 键 | 内容 |
|---|---|
| `qqfarm_w_base` | 面板地址 |
| `qqfarm_w_user` | 用户名 |
| `qqfarm_w_pass` | 密码 |
| `qqfarm_w_token` | 登录 token 缓存 |
| `qqfarm_w_title` | 小组件标题 |
| `qqfarm_w_gold` | 1/0 显示金币 |
| `qqfarm_w_coupon` | 1/0 显示点券 |
| `qqfarm_w_diamond` | 1/0 显示钻石 |
| `qqfarm_w_bean` | 1/0 显示金豆 |
| `qqfarm_w_today` | 1/0 显示今日统计 |

不写进脚本文件，也不上传。token 失效（服务重启）时会自动重登一次。

## 数据来源

| 用途 | 接口 |
|---|---|
| 登录换 token | `POST /api/login` |
| 账号列表 | `GET /api/accounts`（含 `running`、`level`、`nick`） |
| 账号详情 | `GET /api/status`（header `x-account-id`） |

`/api/status` 里用到的字段：

| 字段 | 含义 |
|---|---|
| `connection.connected` | WebSocket 是否真连上 |
| `status.gold` / `status.coupon` / `status.diamond` / `status.goldBean` | 金币 / 点券 / 钻石 / 金豆 |
| `status.level`、`status.exp`、`levelProgress` | 等级与经验进度 |
| `uptime` | 本次上线时长（worker 启动至今） |
| `operations.harvest` / `steal` / `helpWater` | 今日收获 / 偷取 / 浇水 |
| `operations.tongQiGift` | 今日同气连枝礼包数量 |

绿点 = `running` 且 `connection.connected` 为真。灰点 = 没在跑或断线。

## 踩过的坑

**`req.headers` 不能逐项赋值。** Scriptable 的 headers 底层是 Swift `Dictionary`（值类型），这样写 token 会静默丢失：

```js
req.headers = { 'Content-Type': 'application/json' };
req.headers['x-admin-token'] = token;   // ❌ 丢
```

必须一次性整体赋值：

```js
const h = { 'Content-Type': 'application/json', 'x-admin-token': token };
req.headers = h;                         // ✅
```

**字体没有 `monospacedSystemFont`。** 正确名字是 `Font.regularMonospacedSystemFont(size)`，写成 `monospacedSystemFont` 会 `TypeError`。可用的是：

- `Font.systemFont` / `semiboldSystemFont` / `boldSystemFont`
- `Font.regularMonospacedSystemFont` / `boldMonospacedSystemFont`
- `Font.fontWithName(name, size)`

**`Color.secondaryLabel()` 不一定存在。** 老版本 Scriptable 只给基础色（`Color.red()` / `Color.green()`），`secondaryLabel` 一调就 `TypeError: Color.secondaryLabel is not a function`。所以脚本里没有直接调，而是走 `sysColor()`：按名字逐个试，全都没有就按深浅色模式退回手写 hex。

**字体也别直接点名。** 有的版本没有 `Font.fontWithName`、也没有 `*Monospaced*` 系列。脚本里统一走 `font(size, kind)`，按 `semibold` / `bold` / `mono` / `boldMono` 的候选链逐个试，最后退回 `Font.systemFont`，不会再因为字体名字报错。

## 更新到最新版

手机 Safari 打开下面任一个，全选复制，回 Scriptable 粘进脚本（整份替换），名字保持 `QQ农场`：

- GitHub：`https://raw.githubusercontent.com/Asunxu/qq-farm-qx/main/widget/qqfarm-widget.js`
- 面板备用：`https://<你的面板地址>/qqfarm-widget.txt`

粘完直接运行一次，能进设置界面就说明版本对了。

## 注意

- **只有 IPv6 的面板**：手机得连有 IPv6 的 Wi-Fi，蜂窝数据大概率不通。连不上时小组件显示「连不上面板」。
- **刷新频率由 iOS 决定**：脚本请求 5 分钟刷新一次，系统可能压到几十分钟。右下角时间戳是上次取数的时刻。
- **登录节流**：面板每分钟 10 次登录、连错 5 次锁 15 分钟。脚本登录失败后会冷却 5 分钟不再重试。
- **账号数量**：中尺寸最多 4 个，大尺寸 6 个；超出显示「还有 N 个账号」。
- 点小组件是**用 Safari 打开面板网页**，不是打开脚本。要改设置请回 Scriptable 里运行。
