const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { app } = require("electron");
const log = require("./logger");
const config = require("./config");
const packageJson = require("../package.json");

const REQUEST_REDIRECT_LIMIT = 5;

const state = {
  status: "idle",
  currentVersion: packageJson.version,
  latestVersion: null,
  updateContent: "",
  isForceUpdate: false,
  releaseDate: "",
  fileSize: null,
  expectedSha512: "",
  downloadUrl: "",
  fileName: "",
  downloadedFilePath: "",
  downloadProgress: 0,
  message: "",
  checkedAt: "",
  source: "",
};

let stateListener = null;
let forceUpdateListener = null;
let activeCheckPromise = null;
let activeDownloadPromise = null;
let isInstalling = false;

/**
 * 合并更新状态并触发状态监听器。
 * @param {Partial<typeof state>} patch - 要合并的状态片段
 */
function setState(patch) {
  Object.assign(state, patch);
  state.checkedAt = new Date().toISOString();

  if (typeof stateListener === "function") {
    stateListener(getState());
  }
}

/**
 * 返回当前状态的浅拷贝。
 * @returns {typeof state}
 */
function getState() {
  return { ...state };
}

/**
 * 注册状态变更监听器，每次调用 setState 后触发。
 * @param {(state: typeof state) => void} listener
 */
function setStateListener(listener) {
  stateListener = listener;
}

/**
 * 注册强制更新监听器，强制更新下载完成后由 checkForUpdates 触发。
 * @param {(state: typeof state) => void} listener
 */
function setForceUpdateListener(listener) {
  forceUpdateListener = listener;
}

/**
 * 比较两个语义化版本号字符串。
 * @param {string} a
 * @param {string} b
 * @returns {1 | 0 | -1} a > b 返回 1，a === b 返回 0，a < b 返回 -1
 */
function compareVersions(a, b) {
  const left = String(a || "")
    .split(".")
    .map((part) => parseInt(part, 10) || 0);
  const right = String(b || "")
    .split(".")
    .map((part) => parseInt(part, 10) || 0);
  const maxLength = Math.max(left.length, right.length);

  for (let i = 0; i < maxLength; i += 1) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }

  return 0;
}

/**
 * 构造 HTTP 请求头，若配置了鉴权 Token 则自动附加。
 * @param {Record<string, string>} [extraHeaders={}] - 额外请求头
 * @returns {Record<string, string>}
 */
function buildHeaders(extraHeaders = {}) {
  const headers = {
    Accept: "application/json",
    ...extraHeaders,
  };

  if (config.UPDATE_REQUEST_TOKEN) {
    const headerName = config.UPDATE_REQUEST_TOKEN_HEADER || "Authorization";
    const prefix = config.UPDATE_REQUEST_TOKEN_PREFIX || "";
    const normalizedPrefix = prefix
      ? /\s$/.test(prefix)
        ? prefix
        : `${prefix} `
      : "";
    headers[headerName] = `${normalizedPrefix}${config.UPDATE_REQUEST_TOKEN}`;
  }

  return headers;
}

/**
 * 发起 HTTP/HTTPS GET 请求并解析 JSON 响应，支持自动重定向。
 * @param {string} url - 请求地址
 * @param {{ headers?: Record<string, string> }} [options={}]
 * @param {number} [redirectCount=0] - 当前重定向次数（内部递归使用）
 * @returns {Promise<any>}
 */
function requestJson(url, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url);
    const client = requestUrl.protocol === "https:" ? https : http;

    log.info(`Requesting update metadata: ${requestUrl.toString()}`);

    const req = client.request(
      requestUrl,
      {
        method: "GET",
        timeout: config.UPDATE_REQUEST_TIMEOUT,
        headers: buildHeaders(options.headers),
      },
      (res) => {
        const { statusCode = 0, headers } = res;

        if (
          [301, 302, 303, 307, 308].includes(statusCode) &&
          headers.location
        ) {
          if (redirectCount >= REQUEST_REDIRECT_LIMIT) {
            reject(new Error("Update metadata redirect limit exceeded"));
            return;
          }

          const redirectUrl = new URL(headers.location, requestUrl).toString();
          res.resume();
          resolve(requestJson(redirectUrl, options, redirectCount + 1));
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          const errorChunks = [];
          res.on("data", (chunk) => errorChunks.push(chunk));
          res.on("end", () => {
            const errorText = Buffer.concat(errorChunks)
              .toString("utf8")
              .trim();
            const detail = errorText
              ? `, response: ${errorText.slice(0, 300)}`
              : "";
            reject(
              new Error(
                `Update metadata request failed: HTTP ${statusCode}${detail}`,
              ),
            );
          });
          return;
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve(JSON.parse(text));
          } catch (error) {
            reject(
              new Error(`Failed to parse update metadata: ${error.message}`),
            );
          }
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("Update metadata request timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * 将附件字段标准化为统一格式 { url, name, size }。
 * 支持字符串 URL 或对象格式。
 * @param {string | object | null} entry
 * @returns {{ url: string, name: string, size: number | null } | null}
 */
function normalizeAttachmentEntry(entry) {
  if (!entry) return null;

  if (typeof entry === "string") {
    return {
      url: entry,
      name: path.basename(entry),
      size: null,
    };
  }

  const url = entry.url || "";
  const name =
    entry.filename ||
    entry.name ||
    entry.title ||
    (url ? path.basename(url) : "");
  const size = entry.size || entry.byteSize || entry.fileSize || null;

  if (!url) return null;

  return { url, name, size };
}

/**
 * 从更新记录中解析下载地址、文件名和文件大小。
 * @param {object} record - 服务端返回的更新记录
 * @returns {{ downloadUrl: string, fileName: string, fileSize: number | null, hasPackage: boolean }}
 */
function resolveDownloadInfo(record) {
  const attachmentValue = record.path || "";
  let attachment = null;

  if (Array.isArray(attachmentValue)) {
    attachment = normalizeAttachmentEntry(attachmentValue[0]);
  } else if (attachmentValue && typeof attachmentValue === "object") {
    attachment = normalizeAttachmentEntry(attachmentValue);
  } else if (typeof attachmentValue === "string") {
    attachment = normalizeAttachmentEntry(attachmentValue);
  }

  if (!attachment || !attachment.url) {
    return {
      downloadUrl: "",
      fileName: "",
      fileSize: Number(record.size || 0) || null,
      hasPackage: false,
    };
  }

  const metadataUrl = config.UPDATE_METADATA_URL
    ? new URL(config.UPDATE_METADATA_URL)
    : null;
  const downloadUrl = metadataUrl
    ? new URL(attachment.url, metadataUrl).toString()
    : attachment.url;

  return {
    downloadUrl,
    fileName:
      attachment.name ||
      path.basename(new URL(downloadUrl).pathname) ||
      `installer-${record.version}.exe`,
    fileSize: Number(record.size || attachment.size || 0) || null,
    hasPackage: true,
  };
}

/**
 * 判断当前状态是否属于未完成的强制更新（仅内部使用）。
 * @param {typeof state} [updateState]
 * @returns {boolean}
 */
function shouldBlockForForceUpdate(updateState = state) {
  return Boolean(
    updateState.isForceUpdate &&
      updateState.latestVersion &&
      ["available", "downloading", "downloaded", "error"].includes(
        updateState.status,
      ),
  );
}

/**
 * 若文件存在则删除，错误时仅记录日志不抛出。
 * @param {string} filePath
 */
function removeFileIfExists(filePath) {
  if (!filePath) return;

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    log.error(`Failed to remove file ${filePath}:`, error.message);
  }
}

/**
 * 根据版本号和原始文件名生成本地安装包文件名。
 * @param {string} version
 * @param {string} [originalFileName=""]
 * @returns {string} 例如 "PrintHelper-1.2.3.exe"
 */
function buildLocalInstallerFileName(version, originalFileName = "") {
  const normalizedVersion = String(version || "update").replace(
    /[^0-9A-Za-z._-]+/g,
    "-",
  );
  const extension = path.extname(String(originalFileName || "").trim()) || ".exe";

  return `PrintHelper-${normalizedVersion}${extension}`;
}

/**
 * 从服务端获取最新的更新记录（列表第一条）。
 * @returns {Promise<object | null>} 更新记录对象，无记录时返回 null
 * @throws {Error} 更新功能未启用或地址未配置时抛出
 */
async function fetchLatestRecord() {
  if (!config.UPDATE_ENABLED) {
    throw new Error("更新功能已禁用");
  }

  if (!config.UPDATE_METADATA_URL) {
    throw new Error("更新地址未配置");
  }

  const response = await requestJson(config.UPDATE_METADATA_URL);
  const list = Array.isArray(response?.data) ? response.data : [];

  if (list.length === 0) {
    return null;
  }

  return list[0];
}

/**
 * 检查是否有新版本可用，并更新内部状态。
 * 若存在强制更新则自动触发下载流程。
 * 并发调用时会复用同一个 Promise。
 * @param {{ source?: 'manual' | 'startup' }} [options]
 * @returns {Promise<typeof state>}
 */
async function checkForUpdates({ source = "manual" } = {}) {
  if (activeCheckPromise) {
    return activeCheckPromise;
  }

  activeCheckPromise = (async () => {
    try {
      setState({
        status: "checking",
        message: "正在检查更新",
        source,
      });

      const record = await fetchLatestRecord();

      if (!record) {
        setState({
          status: "not-available",
          latestVersion: state.currentVersion,
          updateContent: "",
          isForceUpdate: false,
          releaseDate: "",
          fileSize: null,
          expectedSha512: "",
          downloadUrl: "",
          fileName: "",
          downloadedFilePath: "",
          downloadProgress: 0,
          message: "暂无更新",
          source,
        });

        log.info(`No update records found. Current: ${state.currentVersion}`);
        return getState();
      }

      const remoteVersion = String(record.version || "").trim();
      if (!remoteVersion) {
        throw new Error("更新版本号未配置");
      }

      const { downloadUrl, fileName, fileSize, hasPackage } =
        resolveDownloadInfo(record);
      const hasUpdate =
        compareVersions(remoteVersion, state.currentVersion) > 0;

      if (!hasUpdate) {
        setState({
          status: "not-available",
          latestVersion: remoteVersion,
          updateContent: record.updateContent || "",
          isForceUpdate: Boolean(record.isForceUpdate),
          releaseDate:
            record.releaseDate || record.updatedAt || record.createdAt || "",
          fileSize,
          expectedSha512: String(record.sha512 || "").trim(),
          downloadUrl,
          fileName,
          downloadedFilePath: "",
          downloadProgress: 0,
          message: source === "manual" ? "当前已是最新版本" : "暂无更新",
          source,
        });

        log.info(
          `No update available. Current: ${state.currentVersion}, Latest: ${remoteVersion}`,
        );
        return getState();
      }

      // Check if the update was already downloaded
      const alreadyDownloaded =
        state.downloadedFilePath &&
        fs.existsSync(state.downloadedFilePath) &&
        state.latestVersion === remoteVersion;

      setState({
        status: alreadyDownloaded ? "downloaded" : "available",
        latestVersion: remoteVersion,
        updateContent: record.updateContent || "",
        isForceUpdate: Boolean(record.isForceUpdate),
        releaseDate:
          record.releaseDate || record.updatedAt || record.createdAt || "",
        fileSize,
        expectedSha512: String(record.sha512 || "").trim(),
        downloadUrl,
        fileName,
        downloadedFilePath: alreadyDownloaded ? state.downloadedFilePath : "",
        downloadProgress: alreadyDownloaded ? 100 : 0,
        message: alreadyDownloaded
          ? "更新已下载完成"
          : hasPackage
            ? `发现新版本 ${remoteVersion}`
            : `发现新版本 ${remoteVersion}，但未找到安装包`,
        source,
      });

      log.info(
        `Update available. Current: ${state.currentVersion}, Latest: ${remoteVersion}, URL: ${downloadUrl}`,
      );

      const currentState = getState();

      // Force update: auto-download and notify main process
      if (currentState.isForceUpdate && hasPackage) {
        if (currentState.status === "downloaded") {
          // Already downloaded, notify immediately
          log.info("Force update: installer already downloaded, notifying...");
          if (typeof forceUpdateListener === "function") {
            forceUpdateListener(currentState);
          }
        } else {
          // Start download automatically
          log.info("Force update detected, starting automatic download...");
          downloadUpdate()
            .then((downloadedState) => {
              if (
                downloadedState.status === "downloaded" &&
                typeof forceUpdateListener === "function"
              ) {
                forceUpdateListener(downloadedState);
              }
            })
            .catch((err) => {
              log.error("Force update auto-download failed:", err.message);
            });
        }
      }

      return currentState;
    } catch (error) {
      log.error("Check update failed:", error.message);
      setState({
        status: "error",
        latestVersion: null,
        updateContent: "",
        isForceUpdate: false,
        releaseDate: "",
        fileSize: null,
        expectedSha512: "",
        downloadUrl: "",
        fileName: "",
        downloadedFilePath: "",
        downloadProgress: 0,
        message: error.message,
        source,
      });
      return getState();
    } finally {
      activeCheckPromise = null;
    }
  })();

  return activeCheckPromise;
}

/**
 * 确保下载目录存在，不存在则创建。
 * @returns {string} 下载目录绝对路径
 */
function ensureDownloadDirectory() {
  const downloadDir = path.join(
    app.getPath("userData"),
    config.UPDATE_DOWNLOAD_DIR_NAME,
  );
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }
  return downloadDir;
}

/**
 * 将远程文件下载到本地路径，支持重定向，下载过程中实时更新进度状态。
 * @param {string} url - 下载地址
 * @param {string} destination - 本地保存路径
 * @param {number | null} expectedSize - 预期文件大小（字节），用于进度计算
 * @param {number} [redirectCount=0] - 当前重定向次数（内部递归使用）
 * @returns {Promise<string>} 下载完成的本地路径
 */
function downloadFile(url, destination, expectedSize, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url);
    const client = requestUrl.protocol === "https:" ? https : http;

    const request = client.get(
      requestUrl,
      {
        headers: buildHeaders(),
        timeout: Math.max(config.UPDATE_REQUEST_TIMEOUT, 30000),
      },
      (response) => {
        const { statusCode = 0, headers } = response;

        if (
          [301, 302, 303, 307, 308].includes(statusCode) &&
          headers.location
        ) {
          if (redirectCount >= REQUEST_REDIRECT_LIMIT) {
            reject(new Error("Installer download redirect limit exceeded"));
            return;
          }

          response.resume();
          const redirectUrl = new URL(headers.location, requestUrl).toString();
          resolve(
            downloadFile(
              redirectUrl,
              destination,
              expectedSize,
              redirectCount + 1,
            ),
          );
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`Installer download failed: HTTP ${statusCode}`));
          return;
        }

        const totalBytes =
          Number(headers["content-length"] || expectedSize || 0) || 0;
        const fileStream = fs.createWriteStream(destination);
        let downloadedBytes = 0;

        response.on("data", (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const progress = Math.min(
              100,
              Math.round((downloadedBytes / totalBytes) * 100),
            );
            setState({
              status: "downloading",
              downloadProgress: progress,
              message: `正在下载更新 ${progress}%`,
            });
          }
        });

        response.on("error", (error) => {
          fileStream.destroy();
          reject(error);
        });

        fileStream.on("error", (error) => {
          response.destroy(error);
          reject(error);
        });

        fileStream.on("finish", () => {
          fileStream.close(() => resolve(destination));
        });

        response.pipe(fileStream);
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("Installer download timed out"));
    });
    request.on("error", reject);
  });
}

/**
 * 计算文件的 SHA-512 哈希值（Base64 编码）。
 * @param {string} filePath
 * @returns {Promise<string>}
 */
function calculateSha512(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("base64")));
    stream.on("error", reject);
  });
}

/**
 * 下载更新安装包到本地，含文件大小和 SHA-512 校验。
 * 若已下载且文件完整则直接返回当前状态，不重复下载。
 * 并发调用时会复用同一个 Promise。
 * @returns {Promise<typeof state>}
 */
async function downloadUpdate() {
  if (activeDownloadPromise) {
    return activeDownloadPromise;
  }

  activeDownloadPromise = (async () => {
    let destination = "";

    try {
      if (
        !["available", "downloaded", "error"].includes(state.status)
      ) {
        throw new Error("暂无更新可下载");
      }

      if (!state.downloadUrl) {
        throw new Error("当前更新记录不包含安装包 URL");
      }

      if (
        state.status === "downloaded" &&
        state.downloadedFilePath &&
        fs.existsSync(state.downloadedFilePath)
      ) {
        return getState();
      }

      const downloadDir = ensureDownloadDirectory();
      const safeFileName = buildLocalInstallerFileName(
        state.latestVersion,
        state.fileName,
      );
      destination = path.join(downloadDir, safeFileName);

      if (fs.existsSync(destination)) {
        fs.unlinkSync(destination);
      }

      setState({
        status: "downloading",
        downloadProgress: 0,
        message: "正在下载更新 0%",
      });

      await downloadFile(state.downloadUrl, destination, state.fileSize);

      if (state.fileSize) {
        const stat = fs.statSync(destination);
        if (stat.size !== Number(state.fileSize)) {
          throw new Error(
            `Downloaded file size mismatch: expected ${state.fileSize}, got ${stat.size}`,
          );
        }
      }

      const expectedSha512 = String(state.expectedSha512 || "").trim();
      if (expectedSha512) {
        const actualSha512 = await calculateSha512(destination);
        if (actualSha512 !== expectedSha512) {
          throw new Error("Downloaded installer checksum verification failed");
        }
      }

      setState({
        status: "downloaded",
        downloadedFilePath: destination,
        downloadProgress: 100,
        message: "更新已下载完成",
      });

      log.info(`Update downloaded successfully: ${destination}`);
      return getState();
    } catch (error) {
      log.error("Download update failed:", error.message);
      removeFileIfExists(destination);

      const currentState = getState();
      setState({
        status: "error",
        downloadedFilePath: "",
        downloadProgress: 0,
        message: error.message,
      });
      return getState();
    } finally {
      activeDownloadPromise = null;
    }
  })();

  return activeDownloadPromise;
}

/**
 * 启动安装程序并退出当前应用。
 * 使用 shell.openPath 委托 Windows Shell 启动安装器，
 * 绕过 Electron Job Object 限制，无需 UAC（用户级安装）。
 * 并发调用时第二次会直接跳过。
 * @returns {Promise<true>}
 * @throws {Error} 安装包不存在或启动失败时抛出
 */
async function installUpdate() {
  if (isInstalling) {
    log.info("installUpdate called while already installing, skipping.");
    return true;
  }

  if (!state.downloadedFilePath || !fs.existsSync(state.downloadedFilePath)) {
    throw new Error("下载的安装包未找到");
  }

  isInstalling = true;

  setState({
    status: "installing",
    message: "正在关闭应用并准备启动安装程序，请稍候...",
  });

  log.info(`Launching installer via shell: ${state.downloadedFilePath}`);

  const { shell } = require("electron");

  // shell.openPath 内部调用 Windows ShellExecuteEx，由 Windows Shell（explorer.exe）
  // 负责启动安装进程，完全在 Electron 的 Job Object 之外。
  // 用户级安装（perMachine: false）无需 UAC，可直接执行。
  const openError = await shell.openPath(state.downloadedFilePath);
  if (openError) {
    isInstalling = false;
    setState({
      status: "downloaded",
      message: "安装包已下载完成，可以立即安装",
    });
    log.error("Failed to launch installer via shell:", openError);
    throw new Error(`启动安装程序失败：${openError}`);
  }

  log.info("Installer launched via shell successfully.");

  app.isQuitting = true;

  // 用 setImmediate 让当前 IPC 响应先回到渲染进程，
  // 然后下一个事件循环立即退出。这样 app 在安装器
  // 做「检测运行中进程」之前就已经退出，不会弹提示框。
  setImmediate(() => {
    app.exit(0);
  });

  return true;
}

/**
 * 清空下载目录中所有安装包文件。
 * 通常在应用启动时调用，清理上次更新遗留的安装包。
 */
function cleanDownloadDirectory() {
  try {
    const downloadDir = path.join(
      app.getPath("userData"),
      config.UPDATE_DOWNLOAD_DIR_NAME,
    );
    if (!fs.existsSync(downloadDir)) return;

    const files = fs.readdirSync(downloadDir);
    for (const file of files) {
      const filePath = path.join(downloadDir, file);
      fs.unlinkSync(filePath);
      log.info(`Cleaned up old installer: ${filePath}`);
    }
  } catch (err) {
    log.error("Failed to clean download directory:", err.message);
  }
}

module.exports = {
  checkForUpdates,
  cleanDownloadDirectory,
  downloadUpdate,
  getState,
  installUpdate,
  setStateListener,
  setForceUpdateListener,
};
