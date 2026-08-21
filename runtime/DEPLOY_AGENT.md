# Taliabu Spider Runtime Gateway 部署指南

## 目标

这个服务不是影视源，它只是把 **影视-K(Android/FongMi)** 已经具备的 TVBox JAR Spider 能力转换成 WebTV 可调用的 HTTP API。

最终链路：

```text
Taliabu WebTV (Cloudflare Pages)
        |
        | HTTPS API
        v
Spider Runtime Gateway (本服务，Debian/Windows均可)
        ^
        | WebSocket / KebSocket
        |
影视-K Android
        |
        v
饭太硬 fan.txt / csp_* Spider
```

只有当影视-K成功连接 Runtime 后，饭太硬中的 `厂长/海绵/糯米/热播/...` 等 `type=3 / csp_*` 源才能真正执行搜索、详情和 playerContent。

---

## 一、Debian 12/13 一键部署

建议服务器与运行影视-K的手机处于同一个局域网。下面默认端口 `35066`。

```bash
set -e
apt-get update
apt-get install -y ca-certificates curl git openssl

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

rm -rf /tmp/LibreTV-spider

git clone --depth=1 --branch feature/taliabu-webtv https://github.com/cjl88615/LibreTV.git /tmp/LibreTV-spider

rm -rf /opt/taliabu-spider-gateway
mkdir -p /opt/taliabu-spider-gateway
cp -a /tmp/LibreTV-spider/runtime/. /opt/taliabu-spider-gateway/
cd /opt/taliabu-spider-gateway
npm install --omit=dev

TOKEN="$(openssl rand -hex 32)"
cat >/opt/taliabu-spider-gateway/.env <<EOF
HOST=0.0.0.0
PORT=35066
RUNTIME_TOKEN=${TOKEN}
TOPIC_TIMEOUT_MS=25000
EOF

cp /opt/taliabu-spider-gateway/taliabu-spider-gateway.service /etc/systemd/system/taliabu-spider-gateway.service
systemctl daemon-reload
systemctl enable --now taliabu-spider-gateway.service

sleep 2
systemctl --no-pager --full status taliabu-spider-gateway.service || true
ss -lntp | grep ':35066' || true

echo
echo "============================================================"
echo "Runtime Token: ${TOKEN}"
echo "影视-K 配对地址: 本机局域网IP"
echo "影视-K WebSocket端口: 35066"
echo "============================================================"
```

systemd 已设置 `Restart=always`，服务异常退出会自动重启。

---

## 二、影视-K 配对

1. 手机上安装/打开 **影视-K**。
2. 给影视-K配置同一份 TVBox 源：`https://tvsource.taliabu.kdns.fr`。
3. 影视-K → 设置 → **FreeBox配对**。
4. IP 填 Runtime 所在服务器的局域网 IP，例如 `192.168.2.171`。
5. WebSocket 端口填写 `35066`。
6. 点击连接/重连。

Runtime 日志验证：

```bash
journalctl -u taliabu-spider-gateway -n 100 --no-pager
```

成功时应出现类似：

```text
[TV-K] registered from 192.168.x.x
```

---

## 三、本机验证 Runtime

先从 `.env` 读取 Token：

```bash
TOKEN="$(grep '^RUNTIME_TOKEN=' /opt/taliabu-spider-gateway/.env | cut -d= -f2-)"
```

健康检查：

```bash
curl -sS -H "Authorization: Bearer ${TOKEN}" http://127.0.0.1:35066/health
```

正常且影视-K已连接时关键字段应为：

```json
{
  "ok": true,
  "connected": true
}
```

测试源列表：

```bash
curl -sS -H "Authorization: Bearer ${TOKEN}" http://127.0.0.1:35066/api/sources
```

测试“厂长”搜索：

```bash
curl -sS \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"sourceKey":"厂长","keyword":"哪吒"}' \
  http://127.0.0.1:35066/api/search
```

如果返回 `items`，说明 JAR Spider 已真正工作。

---

## 四、把 HTTP API 暴露给 Cloudflare Pages

推荐使用 **Cloudflare Tunnel**，不要直接把 35066 端口暴露公网。

例如给 Runtime 建一个域名：

```text
https://spider.taliabu.site
```

Tunnel origin 指向：

```text
http://127.0.0.1:35066
```

注意：影视-K仍然使用局域网 IP + 35066 配对；Cloudflare Tunnel只给 WebTV/Pages 调 HTTP API。

---

## 五、Cloudflare Pages 环境变量

LibreTV Pages 项目 → Settings → Variables and Secrets，为 Preview 和 Production（后续合并时）配置：

```text
SPIDER_RUNTIME_URL=https://spider.taliabu.site
SPIDER_RUNTIME_TOKEN=<上面生成的RUNTIME_TOKEN>
```

`SPIDER_RUNTIME_URL` 不要带最后的 `/`。

重新部署后，浏览器打开：

```text
https://你的WebTV域名/tvbox/spider/health
```

如果配置正确，应看到：

```json
{
  "ok": true,
  "configured": true,
  "connected": true
}
```

---

## 六、验证完整调用链

依次验证：

```text
1. /tvbox/config
   → 能看到饭太硬 sites

2. /tvbox/spider/health
   → configured=true, connected=true

3. WebTV 点击一部电影
   → 出现饭太硬来源选择器

4. 点击“厂长/海绵/糯米/热播”等
   → 能返回该源自己的搜索结果

5. 点搜索结果
   → 能返回该源自己的详情和剧集

6. 点某一集
   → WebTV调用 playerContent
   → 如果返回 127.0.0.1:9978/proxy，Gateway自动替换成影视-K手机局域网IP
   → /tvbox/spider/media 负责 HLS/分片代理
```

---

## 七、排错

### Runtime显示 connected=false

检查：

```bash
journalctl -u taliabu-spider-gateway -f
```

确认手机和服务器互通：

```bash
ping <手机IP>
```

确认端口监听：

```bash
ss -lntp | grep 35066
```

### 某一个饭太硬源搜不到

这不代表 Runtime 故障。TVBox里的源本身可能临时失效。换其他源测试。

### 搜索、详情正常，但播放失败

重点查看 `/api/play` 返回的 `url`、`headers`、`parse`、`jx`、`format`。

如果 URL 是手机本地代理地址，Gateway会自动将 `127.0.0.1/localhost` 改成影视-K连接时的真实局域网 IP。

### 回滚

停止 Runtime：

```bash
systemctl disable --now taliabu-spider-gateway.service
rm -f /etc/systemd/system/taliabu-spider-gateway.service
systemctl daemon-reload
```

WebTV 若没有配置 `SPIDER_RUNTIME_URL/SPIDER_RUNTIME_TOKEN`，直播和首页推荐仍可使用，只是饭太硬 JAR Spider 点播会显示 Runtime 未连接。
