# dsh-bun-pkg

通过一层薄薄的兼容垫片在 Bun 下运行 `@deepseek-ai/dsh`，并把整个产物打包成一个独立可执行文件。垫片（`lib/preload.js`）负责构造一份「影子化的」`node_modules`，把 dsh 依赖的几个 Node-only API（`node:module.stripTypeScriptTypes`、`node:worker_threads`）重定向到真实的 Node 子进程，让 `dsh` 在 Bun 里的启动方式跟 Node 下一模一样。

## 架构

```
main.ts                # 入口 / 启动器
scripts/embed.ts         # 把 node_modules + lib 打成单个 zstd archive
.dsh-archive.bin       # 产物 archive（DSHA magic + 索引 + 单个 zstd frame）
lib/                   # preload 兼容层及其辅助（preload.js）
                       # 也是首次启动时从 archive 里还原出来的 lib 副本
node_modules/          # 源码树（仅 dev 模式使用）
target/dsh             # `bun build --compile` 的最终产物
```

archive 的二进制格式：

```
[DSHA][u32 entryCount][index: (u32 nameLen, name, u64 size, u32 mode) * N][zstd(payload)]
```

payload 是 `node_modules/` 和 `lib/` 下所有常规文件（`.map` 和 preload 自己 build 产物除外）的拼接结果，作为**单个 zstd frame** 压缩——这样 zstd 字典能跨文件复用，压缩率明显更好。

## 启动流程

1. **dev 模式（`bun main.ts`）** — 源码树就在工作目录里，`main.ts` 直接用，**完全不碰 archive、不建临时目录、不复制文件**。冷启动 ≈ 250ms。
2. **二进制模式（`target/dsh`）** — `main.ts` 对 archive 做 sha256，定位 `~/.cache/dsh/<hash>/`。如果 marker 文件存在就直接复用缓存、把控制权交给 dsh；否则把 archive 解压到缓存目录并写 marker。

冷启动 ≈ 5–6s（一次性 zstd 解压 + 33k 个文件解压到磁盘）；**热启动 ≈ 400ms**（命中 cache 后只剩 Bun 加载 + shadow 构造）。

archive 内容不变缓存就一直有效。要强制重新解压：删 `~/.cache/dsh/` 即可。

## 脚本

```bash
bun run prepare-runtime   # 重新构建 .dsh-archive.bin 和 lib/.dsh-preload.js
bun run dev               # prepare + 从源码启动
bun run scripts             # prepare + 编译 target/dsh
```

## 为什么要自研 archive

之前的版本用两个 `tar.gz`（一个装 `node_modules`，一个装 `lib`），启动时调系统 `tar` 解压。冷启动要花 9s 解包 + 多次 `spawn tar` 的进程往返，二进制里还要装两份压缩字典互相重复。

现在的 archive 用 Bun 自带的 zstd，读写用 `Bun.write`——**build 只依赖 Bun 自身**；热启动时启动器只剩「打开 archive → 算 hash → 把控制权交给 dsh」这三步。

`lib/preload.js` 做的 shadow 构造（大部分 `node_modules` 用 junction 软链 + 四个真正需要 patch 的包做深拷贝）保持不变。