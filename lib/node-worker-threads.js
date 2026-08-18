// @bun
// src/node-worker-threads.ts
import { EventEmitter } from "events";
import { fileURLToPath } from "url";

class ReadableBridge extends EventEmitter {
  readable = true;
  readableEnded = false;
  end() {
    if (this.readableEnded)
      return;
    this.readableEnded = true;
    this.readable = false;
    this.emit("end");
  }
}
function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

class Worker extends EventEmitter {
  stdout = new ReadableBridge;
  stderr = new ReadableBridge;
  performance;
  process;
  lastElu = { idle: 0, active: 0, utilization: 0 };
  requestId = 0;
  constructor(filename, options = {}) {
    super();
    this.performance = {
      eventLoopUtilization: (previous) => {
        this.send({ t: "elu", id: ++this.requestId, previous: previous ?? null });
        return this.lastElu;
      }
    };
    const target = filename instanceof URL ? fileURLToPath(filename) : filename;
    const bootstrap = fileURLToPath(new URL("./worker-bootstrap.js", import.meta.url));
    this.process = Bun.spawn(["node", bootstrap, target, encode({
      workerData: options.workerData,
      resourceLimits: options.resourceLimits,
      env: options.env,
      execArgv: options.execArgv
    })], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    this.read(this.process.stdout, true);
    this.read(this.process.stderr, false);
    this.process.exited.then((code) => {
      this.stdout.end();
      this.stderr.end();
      this.emit("exit", code);
    });
  }
  postMessage(value) {
    this.send({ t: "post", d: value });
  }
  terminate() {
    this.send({ t: "terminate" });
    return this.process.kill();
  }
  send(value) {
    try {
      this.process.stdin.write(`${JSON.stringify(value)}
`);
    } catch {}
  }
  async read(stream, control) {
    if (!stream || typeof stream === "number")
      return;
    const reader = stream.getReader();
    const decoder = new TextDecoder;
    let pending = "";
    for (;; ) {
      const { value, done } = await reader.read();
      if (done)
        break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(`
`);
      pending = lines.pop() ?? "";
      for (const line of lines)
        if (line)
          this.handleFrame(line, control);
    }
    if (pending)
      this.handleFrame(pending, control);
  }
  handleFrame(line, control) {
    if (!control) {
      this.stderr.emit("data", Buffer.from(`${line}
`));
      return;
    }
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      this.stderr.emit("data", Buffer.from(`${line}
`));
      return;
    }
    if (frame.t === "message")
      this.emit("message", frame.d);
    else if (frame.t === "stdout" || frame.t === "stderr") {
      this[frame.t].emit("data", Buffer.from(String(frame.d), "base64"));
    } else if (frame.t === "elu")
      this.lastElu = frame.d;
    else if (frame.t === "error") {
      this.emit("error", Object.assign(new Error(frame.message), { stack: frame.stack }));
    }
  }
}
var workerData = null;
var parentPort = null;

class MessagePort {
}

class MessageChannel {
  constructor() {
    throw new Error("dsh-bun-compat-patch \u5C1A\u672A\u5B9E\u73B0 MessageChannel");
  }
}
export {
  workerData,
  parentPort,
  Worker,
  MessagePort,
  MessageChannel
};

//# debugId=11BC1C3FAE76E7BF64756E2164756E21
