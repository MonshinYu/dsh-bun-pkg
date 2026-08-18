// src/worker-bootstrap.ts
import { Worker } from "node:worker_threads";
import { createInterface } from "node:readline";
var target = process.argv[2];
var config = JSON.parse(Buffer.from(process.argv[3], "base64").toString());
var send = (value) => {
  process.stdout.write(`${JSON.stringify(value)}
`);
};
var worker = new Worker(target, {
  workerData: config.workerData,
  resourceLimits: config.resourceLimits,
  env: config.env,
  execArgv: config.execArgv,
  stdout: true,
  stderr: true
});
var input = createInterface({ input: process.stdin });
worker.on("message", (data) => send({ t: "message", d: data }));
worker.on("error", (error) => send({ t: "error", message: error.message, stack: error.stack }));
worker.on("exit", (code) => {
  input.close();
  process.exit(code);
});
worker.stdout.on("data", (data) => send({ t: "stdout", d: data.toString("base64") }));
worker.stderr.on("data", (data) => send({ t: "stderr", d: data.toString("base64") }));
input.on("line", (line) => {
  try {
    const message = JSON.parse(line);
    if (message.t === "post")
      worker.postMessage(message.d);
    else if (message.t === "terminate")
      worker.terminate();
    else if (message.t === "elu")
      send({
        t: "elu",
        d: worker.performance.eventLoopUtilization(message.previous || undefined)
      });
  } catch (error) {
    send({
      t: "error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
});

//# debugId=BE36A3CB6745B31564756E2164756E21
