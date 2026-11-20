import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const runnerPath = resolve(
  "node_modules/@cloudflare/vite-plugin/dist/workers/runner-worker/index.js"
);
const marker =
  "async function createModuleRunner(env, webSocket, environmentName) {";
const compatibility = `
function installReactEvalCompatibility(env) {
  const unsafeEval = env.__VITE_UNSAFE_EVAL__;
  if (!unsafeEval || typeof unsafeEval.eval !== "function") return;

  globalThis.eval = (code) => {
    if (typeof code !== "string") return code;
    return unsafeEval.eval(code, "react-flight-development-eval")();
  };
}
`;
const flightClientPath = resolve(
  "node_modules/react-server-dom-webpack/cjs/react-server-dom-webpack-client.edge.development.js"
);
const flightCheckStart = "    function checkEvalAvailabilityOnceDev() {";
const flightCheckEnd = "    function resolveClientReference";

const patchFlightClient = () => {
  if (!existsSync(flightClientPath)) {
    return;
  }

  const source = readFileSync(flightClientPath, "utf8");
  if (!source.includes(flightCheckStart)) {
    return;
  }

  const start = source.indexOf(flightCheckStart);
  const end = source.indexOf(flightCheckEnd, start);
  if (end === -1 || source.slice(start, end).includes("Cloudflare")) {
    return;
  }

  const replacement = `${flightCheckStart}\n      hasConfirmedEval = !0;\n    }\n`;
  writeFileSync(
    flightClientPath,
    `${source.slice(0, start)}${replacement}${source.slice(end)}`
  );
};

if (existsSync(runnerPath)) {
  const source = readFileSync(runnerPath, "utf8");

  if (
    source.includes(marker) &&
    !source.includes("installReactEvalCompatibility(env);")
  ) {
    const patchedSource = source.includes("react-flight-development-eval")
      ? source.replace(
          marker,
          `${marker}\n  installReactEvalCompatibility(env);`
        )
      : source.replace(
          marker,
          `${compatibility}${marker}\n  installReactEvalCompatibility(env);`
        );

    writeFileSync(runnerPath, patchedSource);
  }
}

patchFlightClient();
