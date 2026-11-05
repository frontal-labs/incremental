// Test double for the engine: answers hello, then never answers anything
// else. Used to prove the client's request timeout (test/supervision.test.ts).
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  if (req.method === "hello") {
    const result = {
      protocol: 1,
      engine: { name: "silent", version: "0" },
      capabilities: [],
      store: "silent",
    };
    process.stdout.write(JSON.stringify({ id: req.id, result }) + "\n");
  }
});
