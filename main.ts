import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import archiveBlob from "./.dsh-archive.bin" with {type: "file"};
import preloadAsset from "./lib/.dsh-preload.js" with {type: "file"};

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const hasRuntime = existsSync(path.join(sourceRoot, "node_modules", "@deepseek-ai", "dsh", "package.json"));

let root: string;
if (hasRuntime) {
    root = sourceRoot;
} else {
    const archiveBytes = await Bun.file(archiveBlob).arrayBuffer();
    const archiveHash = createHash("sha256").update(new Uint8Array(archiveBytes)).digest("hex");
    const cacheRoot = path.join(homedir(), ".cache", "dsh", archiveHash);
    const cacheMarker = path.join(cacheRoot, ".dsh-extracted");
    if (existsSync(cacheMarker)) {
        root = cacheRoot;
    } else {
        if (existsSync(cacheRoot)) rmSync(cacheRoot, {recursive: true, force: true});
        mkdirSync(cacheRoot, {recursive: true});
        const archive = decodeArchive(new Uint8Array(archiveBytes));
        writeArchiveFiles(cacheRoot, archive);
        writeFileSync(cacheMarker, new TextEncoder().encode(archiveHash));
        root = cacheRoot;
    }
}

if (!hasRuntime) {
    writeFileSync(path.join(root, "lib", ".dsh-preload.js"), await Bun.file(preloadAsset).arrayBuffer());
}

const preloadPath = path.join(root, "lib", ".dsh-preload.js");
if (!existsSync(preloadPath)) {
    throw new Error(`找不到兼容预加载脚本：${preloadPath}`);
}

process.env.DSH_BUN_COMPAT_ROOT = root;
const arg = process.argv.slice(2);
const child = Bun.spawnSync(["bun", "--preload", preloadPath, path.join(root, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"), ...arg], {
    env: {...process.env, DSH_BUN_COMPAT_ROOT: root},
    stdio: ["inherit", "inherit", "inherit"],
});
process.exit(child.exitCode ?? 1);

interface ArchiveEntry {
    path: string;
    bytes: Uint8Array;
}

function decodeArchive(blob: Uint8Array): ArchiveEntry[] {
    const decoder = new TextDecoder();
    const magic = decoder.decode(blob.subarray(0, 4));
    if (magic !== "DSHA") throw new Error(`archive magic mismatch: ${JSON.stringify(magic)}`);
    const view = new DataView(blob.buffer, blob.byteOffset);
    const entryCount = view.getUint32(4, false);

    let cursor = 8;
    const paths: string[] = [];
    const lengths: number[] = [];
    for (let i = 0; i < entryCount; i++) {
        const nameLength = view.getUint32(cursor, false);
        cursor += 4;
        paths.push(decoder.decode(blob.subarray(cursor, cursor + nameLength)));
        cursor += nameLength;
        const payloadByteLength = view.getUint32(cursor, false) * 0x100000000 + view.getUint32(cursor + 4, false);
        cursor += 8;
        const mode = view.getUint32(cursor, false);
        cursor += 4;
        lengths.push(payloadByteLength);
    }
    const compressedPayload = blob.subarray(cursor);
    const payload = Bun.zstdDecompressSync(compressedPayload, {fuzzy: true});

    const entries: ArchiveEntry[] = [];
    let payloadCursor = 0;
    for (let i = 0; i < entryCount; i++) {
        const bytes = payload.subarray(payloadCursor, payloadCursor + lengths[i]!);
        payloadCursor += lengths[i]!;
        entries.push({path: paths[i]!, bytes: new Uint8Array(bytes)});
    }
    return entries;
}

function writeArchiveFiles(root: string, entries: ArchiveEntry[]): void {
    let pendingDir: string | null = null;
    for (const entry of entries) {
        const absolute = path.join(root, entry.path);
        const parent = path.dirname(absolute);
        if (parent !== pendingDir) {
            mkdirSync(parent, {recursive: true});
            pendingDir = parent;
        }
        Bun.write(Bun.file(absolute), entry.bytes);
    }
}