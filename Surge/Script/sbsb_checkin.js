/*
------------------------------------------
@Author: StarYunLee
@Title: 烧饼论坛 (sb.sb) 自动签到
@Description: 抓取 Cookie + 每日定时签到
------------------------------------------
*/
const $ = new Env("烧饼论坛");
const ckName = "sbsb_cookie_data";
const userCookie = $.toObj($.isNode() ? process.env[ckName] : $.getdata(ckName)) || [];

$.userIdx = 0, $.userList = [], $.notifyMsg = [];
const notify = $.isNode() ? require('./sendNotify') : '';
$.is_debug = ($.isNode() ? process.env.IS_DEBUG : $.getdata('is_debug')) || 'false';

async function main() {
    const isMultiUser = $.userList.length > 1;
    for (let user of $.userList) {
        $.notifyMsg = [], $.title = "";
        try {
            $.log(`[${user.userName || user.index}][INFO] 开始执行签到...\n`);
            const signResult = await user.signin();
            $.title = signResult?.title ?? "签到结果";
            
            if (user.ckStatus) {
                let stats = await user.userAccount();
                $.log(`[${user.userName || user.index}][INFO] 查询签到状态成功...\n`);
                
                if (isMultiUser) {
                    DoubleLog(`👤 ${user.userName || `账号${user.index}`}`);
                }
                
                if (stats) {
                    DoubleLog(`连续签到：${stats.streak} 天${stats.hint ? `（${stats.hint}）` : ""}`);
                    DoubleLog(`最长连续：${stats.maxStreak || "-"} 天 ｜ 累计签到：${stats.totalStreak || "-"} 天`);
                }
            } else {
                $.title = "⛔️ 登录凭据 Cookie 失效";
                DoubleLog(isMultiUser ? `👤 ${user.userName || `账号${user.index}`}：请在浏览器中打开烧饼论坛「每日签到」页面以更新凭据。` : "请在浏览器中打开烧饼论坛「每日签到」页面以更新凭据。");
            }
            await sendMsg($.notifyMsg.join("\n"));
        }
        catch (e) {
            DoubleLog(`[ERROR] ${e.message || e}`);
        }
    }
}

class UserInfo {
    constructor(user) {
        this.index = ++$.userIdx;
        this.token = "" || user.token || user;
        this.userId = "" || user.userId;
        this.userName = user.userName;
        this.ckStatus = true;
        this.baseUrl = `https://sb.sb`;
        this.headers = {
            'Connection': 'keep-alive',
            'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
            'Cookie': this.token,
            'Referer': 'https://sb.sb/',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
        };
        this.fetch = async (o) => {
            try {
                if (typeof o === 'string') o = { url: o };
                if (o?.url?.startsWith("/") || o?.url?.startsWith(":")) o.url = this.baseUrl + o.url;
                const res = await Request({ ...o, headers: o.headers || this.headers, url: o.url, resultType: "all" });
                debug(res?.body || res, o?.url?.replace(/\/+$/, '').substring(o?.url?.lastIndexOf('/') + 1));
                return res;
            } catch (e) {
                this.ckStatus = false;
                $.log(`[${this.userName || this.index}][ERROR] 请求发起失败! ${e}\n`);
            }
        };
    }

    async userAccount() {
        try {
            const opts = {
                url: "/checkin/",
                type: "get"
            };
            let res = await this.fetch(opts);
            const html = typeof res?.body === "string" ? res.body : "";
            if (html.includes("登录 - 烧饼论坛") || html.includes("/login/")) {
                this.ckStatus = false;
                return null;
            }

            const streakMatch = html.match(/class="signin-streak-num">(\d+)<\/div>/);
            const hintMatch = html.match(/class="signin-hint">(.*?)<\/div>/);

            let maxStreak = "", totalStreak = "";
            const statRegex = /class="signin-stat-value">(\d+)<\/span>\s*<span class="signin-stat-label">(.*?)<\/span>/g;
            let m;
            while ((m = statRegex.exec(html)) !== null) {
                if (m[2].indexOf("最长") !== -1) maxStreak = m[1];
                if (m[2].indexOf("累计") !== -1) totalStreak = m[1];
            }

            return {
                streak: streakMatch ? streakMatch[1] : "未知",
                hint: hintMatch ? hintMatch[1].trim() : "",
                maxStreak: maxStreak,
                totalStreak: totalStreak
            };
        } catch (e) {
            this.ckStatus = false;
            $.log(`[${this.userName || this.index}][ERROR] 查询状态: ${e}\n`);
        }
    }

    async signin() {
        try {
            const getOpts = {
                url: "/checkin/",
                type: "get"
            };
            let res = await this.fetch(getOpts);
            const html = typeof res?.body === "string" ? res.body : "";

            if (html.includes("登录 - 烧饼论坛") || html.includes("/login/")) {
                this.ckStatus = false;
                return { title: "⛔️ 登录凭据 Cookie 失效" };
            }

            if (html.includes("今日已签到")) {
                $.log(`[${this.userName || this.index}][INFO] 今日已签到\n`);
                return { title: "📋 今日已完成签到" };
            }

            const csrfMatch = html.match(/name="_csrf"\s+value="([^"]+)"/);
            if (!csrfMatch) {
                $.log(`[${this.userName || this.index}][ERROR] 未能获取 CSRF\n`);
                return { title: "⚠️ 获取 CSRF Token 失败" };
            }

            const csrfToken = csrfMatch[1];
            const postOpts = {
                url: "/checkin/",
                type: "post",
                headers: {
                    'Origin': 'https://sb.sb',
                    'Referer': 'https://sb.sb/checkin/',
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: `_csrf=${encodeURIComponent(csrfToken)}`
            };

            let postRes = await this.fetch(postOpts);
            if (postRes?.status === 200 || postRes?.statusCode === 200) {
                $.log(`[${this.userName || this.index}][INFO] 签到成功\n`);
                return { title: "🎉 每日签到成功" };
            } else {
                return { title: `❌ 签到异常（状态码 ${postRes?.status || postRes?.statusCode}）` };
            }
        } catch (e) {
            this.ckStatus = false;
            $.log(`[${this.userName || this.index}][ERROR] 签到: ${e}\n`);
            return { title: "❌ 签到出错" };
        }
    }
}

async function getCookie() {
    try {
        if ($request && $request.method === 'OPTIONS') return;
        const header = ObjectKeys2LowerCase($request.headers) ?? $.msg($.name, `⛔️ script run error!`, `错误的运行方式，请切换到cron环境`);
        let cookieHeader = header.cookie;
        if (!cookieHeader || cookieHeader.indexOf("__Host-bbs_session") === -1) return;

        // 规范化提取核心 Session，避免其他随机键值或顺序变化导致全字符串比对失效
        const sessionMatch = cookieHeader.match(/__Host-bbs_session=([^;]+)/);
        if (!sessionMatch) return;
        const cleanToken = `__Host-bbs_session=${sessionMatch[1].trim()}`;

        let userName = "烧饼用户";
        const newData = {
            "userId": userName,
            "token": cleanToken,
            "userName": userName,
        };

        // 每次重新从 persistentStore 实时读取最新数据，避免并发请求读到过期内存缓存
        const currentStored = $.toObj($.isNode() ? process.env[ckName] : $.getdata(ckName)) || [];
        const index = currentStored.findIndex(e => e.userName == newData.userName || e.userId == newData.userId);
        
        // 核心凭据一致时静默放行
        if (index !== -1 && currentStored[index].token === newData.token) {
            return;
        }

        currentStored[index !== -1 ? index : currentStored.length] = newData;
        $.setjson(currentStored, ckName);
        $.msg($.name, `🎉 登录凭据 Cookie 捕获成功！`, `已保存至本地存储，每日定时签到将自动生效。`);
    } catch (e) {
        throw e;
    }
}

!(async () => {
    try {
        if (typeof $request != "undefined") {
            await getCookie();
        } else {
            await checkEnv();
            await main();
        }
    } catch (e) {
        throw e;
    }
})()
    .catch((e) => { $.logErr(e), $.msg($.name, `⛔️ script run error!`, e.message || e) })
    .finally(async () => {
        $.done({ ok: 1 });
    });

/** ---------------------------------固定不动区域----------------------------------------- */
//prettier-ignore
async function sendMsg(a) { a && ($.isNode() ? await notify.sendNotify($.name, a) : $.msg($.name, $.title || "", a, { "media-url": $.avatar })) }
function DoubleLog(o) { o && ($.log(`${o}`), $.notifyMsg.push(`${o}`)) };
async function checkEnv() { try { if (!userCookie?.length) throw new Error("未检测到有效账号数据！请先在浏览器中打开烧饼论坛「每日签到」页面捕获 Cookie。"); $.log(`\n[INFO] 检测到 ${userCookie?.length ?? 0} 个账号\n`), $.userList.push(...userCookie.map((o => new UserInfo(o))).filter(Boolean)) } catch (o) { throw o } }
function debug(g, e = "debug") { "true" === $.is_debug && ($.log(`\n-----------${e}------------\n`), $.log("string" == typeof g ? g : $.toStr(g) || `debug error => t=${g}`), $.log(`\n-----------${e}------------\n`)) }
//From xream's ObjectKeys2LowerCase
function ObjectKeys2LowerCase(obj) { return !obj ? {} : Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v])) };
//From sliverkiss's Request
async function Request(t) { "string" == typeof t && (t = { url: t }); try { if (!t?.url) throw new Error("[URL][ERROR]缺少 url 参数"); let { url: o, type: e, headers: r = {}, body: s, params: a, dataType: n = "form", resultType: u = "data" } = t; const p = e ? e?.toLowerCase() : "body" in t ? "post" : "get", c = o.concat("post" === p && a ? "?" + $.queryStr(a) : ""), i = t.timeout ? $.isSurge() ? t.timeout / 1e3 : t.timeout : 1e4; "json" === n && (r["Content-Type"] = "application/json;charset=UTF-8"); const y = s && "form" == n ? (typeof s === "string" ? s : $.queryStr(s)) : $.toStr(s), l = { ...t, ...t?.opts ? t.opts : {}, url: c, headers: r, ...("post" === p && { body: y }), ...("get" === p && a && { params: a }), timeout: i }, m = $.http[p.toLowerCase()](l).then((t => "data" == u ? $.toObj(t.body) || t.body : "all" == u ? t : $.toObj(t) || t)).catch((t => $.log(`[${p.toUpperCase()}][ERROR]${t}\n`))); return Promise.race([new Promise(((t, o) => setTimeout((() => o("当前请求已超时")), i))), m]) } catch (t) { console.log(`[${p.toUpperCase()}][ERROR]${t}\n`) } }
//From chavyleung's Env.js
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }
