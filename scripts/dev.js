const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const isWindows = process.platform === "win32";
const viteBin = path.join(
  rootDir,
  "node_modules",
  ".bin",
  isWindows ? "vite.cmd" : "vite",
);
const electronBin = path.join(
  rootDir,
  "node_modules",
  ".bin",
  isWindows ? "electron.cmd" : "electron",
);

function spawnProcess(command, args, label) {
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: isWindows,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: "http://127.0.0.1:5173",
    },
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${label} exited with code ${code}`);
      process.exit(code || 1);
    }
  });

  return child;
}

let electronProcess = null;
const viteProcess = spawnProcess(viteBin, ["--config", "vite.renderer.config.js"], "vite");

setTimeout(() => {
  electronProcess = spawnProcess(electronBin, ["."], "electron");
}, 2500);

process.on("SIGINT", () => {
  if (viteProcess) {
    viteProcess.kill("SIGINT");
  }
  if (electronProcess) {
    electronProcess.kill("SIGINT");
  }
  process.exit(0);
});
