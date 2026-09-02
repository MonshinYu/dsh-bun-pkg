import {readdirSync, readFileSync, statSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const preloadPath = path.join(projectRoot, "lib", "preload.js");
const archivePath = path.join(projectRoot, ".dsh-archive.bin");

console.time("build preload");
{
    const result = await Bun.build({
        entrypoints: [preloadPath],
        target: "bun",
        outdir: path.join(projectRoot, "lib"),
        naming: ".dsh-preload.js",
        minify: true,
    });
    if (!result.success) {
        for (const log of result.logs) console.error(log);
        throw new Error("preload bundle failed");
    }
}
console.timeEnd("build preload");

console.time("scan files");
const inputs: string[] = [];
for (const entry of walk(path.join(projectRoot, "node_modules"))) inputs.push(entry);
for (const entry of walk(path.join(projectRoot, "lib"))) {
    if (entry.endsWith(".map") || entry.endsWith(".dsh-preload.js")) continue;
    inputs.push(entry);
}
console.timeEnd("scan files");
console.log(`  scanned ${inputs.length} files`);

console.time("encode archive");
const encoded = encodeArchive(inputs);
console.timeEnd("encode archive");
console.log(`  archive: ${encoded.byteLength} bytes (${(encoded.byteLength / 1024 / 1024).toFixed(2)} MB)`);

console.time("write archive");
writeFileSync(archivePath, encoded);
console.timeEnd("write archive");

function* walk(root: string): Generator<string> {
    const stack: string[] = [root];
    while (stack.length > 0) {
        const current = stack.pop()!;
        const stat = statSync(current);
        if (stat.isFile()) {
            yield current;
            continue;
        }
        if (!stat.isDirectory()) continue;
        for (const name of readdirSync(current)) {
            const child = path.join(current, name);
            const childStat = statSync(child, {throwIfNoEntry: false});
            if (!childStat) continue;
            if (childStat.isFile()) yield child;
            else if (childStat.isDirectory()) stack.push(child);
        }
    }
}

interface Entry {
    path: string;
    bytes: Uint8Array;
    mode?: number;
}

function encodeArchive(files: string[]): Uint8Array {
    const entries: Entry[] = [];
    for (const file of files) {
        const relative = path.relative(projectRoot, file).split(path.sep).join("/");
        const stat = statSync(file);
        const payload = readFileSync(file);
        const entry: Entry = {path: relative, bytes: payload};
        if ((stat.mode & 0o111) !== 0) entry.mode = stat.mode & 0o7777;
        entries.push(entry);
    }

    const indexBytes: Uint8Array[] = [];
    const encoder = new TextEncoder();
    const header = new Uint8Array(8);
    header.set(encoder.encode("DSHA"), 0);
    new DataView(header.buffer).setUint32(4, entries.length, false);
    indexBytes.push(header);

    const payloadChunks: Uint8Array[] = [];
    let payloadLength = 0;

    for (const entry of entries) {
        const nameBytes = encoder.encode(entry.path);
        const entryIndex = new Uint8Array(4 + nameBytes.length + 8 + 4);
        const v = new DataView(entryIndex.buffer);
        let c = 0;
        v.setUint32(c, nameBytes.length, false);
        c += 4;
        entryIndex.set(nameBytes, c);
        c += nameBytes.length;
        v.setUint32(c, Math.floor(entry.bytes.byteLength / 0x100000000), false);
        v.setUint32(c + 4, entry.bytes.byteLength >>> 0, false);
        c += 8;
        v.setUint32(c, entry.mode ?? 0, false);
        c += 4;
        indexBytes.push(entryIndex);
        payloadChunks.push(entry.bytes);
        payloadLength += entry.bytes.byteLength;
    }

    const indexConcat = concat(indexBytes);
    const payloadConcat = concat(payloadChunks);

    const compressedPayload = Bun.zstdCompressSync(payloadConcat, {level: 3});
    const finalChunks: Uint8Array[] = [indexConcat, compressedPayload];
    return concat(finalChunks);
}

function concat(chunks: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const c of chunks) total += c.byteLength;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
    }
    return out;
}
