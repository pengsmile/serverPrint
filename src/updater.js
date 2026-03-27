const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { app, shell } = require("electron");
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

function setState(patch) {
  Object.assign(state, patch);
  state.checkedAt = new Date().toISOString();

  if (typeof stateListener === "function") {
    stateListener(getState());
  }
}

function getState() {
  return { ...state };
}

function setStateListener(listener) {
  stateListener = listener;
}

function setForceUpdateListener(listener) {
  forceUpdateListener = listener;
}

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

function buildHeaders(extraHeaders = {}) {
  const headers = {
    Accept: "application/json",
    ...extraHeaders,
  };

  if (config.UPDATE_REQUEST_TOKEN) {
    const headerName = config.UPDATE_REQUEST_TOKEN_HEADER || "Authorization";
    const prefix = config.UPDATE_REQUEST_TOKEN_PREFIX || "";
    headers[headerName] = `${prefix} ${config.UPDATE_REQUEST_TOKEN}`;
  }

  return headers;
}

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

function calculateSha512(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("base64")));
    stream.on("error", reject);
  });
}

async function downloadUpdate() {
  if (activeDownloadPromise) {
    return activeDownloadPromise;
  }

  activeDownloadPromise = (async () => {
    try {
      if (state.status !== "available" && state.status !== "downloaded") {
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
      const safeFileName =
        state.fileName || `PrintHelper-${state.latestVersion || "update"}.exe`;
      const destination = path.join(downloadDir, safeFileName);

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

      const latestRecord = await fetchLatestRecord();
      const expectedSha512 = String(latestRecord?.sha512 || "").trim();
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
      setState({
        status: "error",
        message: error.message,
      });
      return getState();
    } finally {
      activeDownloadPromise = null;
    }
  })();

  return activeDownloadPromise;
}

async function installUpdate() {
  if (!state.downloadedFilePath || !fs.existsSync(state.downloadedFilePath)) {
    throw new Error("下载的安装包未找到");
  }

  log.info(`Launching installer: ${state.downloadedFilePath}`);

  // Use shell.openPath to properly trigger Windows UAC elevation
  // for NSIS installers that require admin privileges (perMachine install)
  const error = await shell.openPath(state.downloadedFilePath);
  if (error) {
    throw new Error(`Failed to launch installer: ${error}`);
  }

  // Mark as quitting immediately so before-quit won't block the exit
  app.isQuitting = true;

  // Delay quit to ensure the installer process has fully started
  return new Promise((resolve) => {
    setTimeout(() => {
      app.quit();
      resolve(true);
    }, 1500);
  });
}

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
