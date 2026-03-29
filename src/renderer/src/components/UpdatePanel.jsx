const STATUS_LABELS = {
  idle: "未检查",
  checking: "检查中",
  available: "发现新版本",
  "not-available": "暂无更新",
  downloading: "下载中",
  downloaded: "已下载",
  installing: "准备安装",
  error: "出错了",
};

const STATUS_TEXT = {
  idle: "等待检查更新",
  checking: "正在检查更新，请稍候",
  downloaded: "安装包已下载完成，可以立即安装",
  installing: "正在关闭应用并准备启动安装程序，请稍候...",
};

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatFileSize(value) {
  const size = Number(value || 0);
  if (!size) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function UpdatePanel({ updateState, installError, isInstalling, onCheck, onDownload, onInstall }) {
  const status = updateState.status || "idle";
  const progress = Number(updateState.downloadProgress || 0);
  const hasForceUpdate = Boolean(updateState.isForceUpdate && updateState.latestVersion);
  const isForceUpdate = hasForceUpdate && ["available", "downloading", "downloaded", "installing", "error"].includes(status);
  const canRetryDownload = status === "error" && Boolean(updateState.downloadUrl);
  const statusText =
    {
      available: isForceUpdate
        ? `发现强制更新 ${updateState.latestVersion || ""}，需立即更新`.trim()
        : `发现新版本 ${updateState.latestVersion || ""}`.trim(),
      "not-available": updateState.message || "暂无更新",
      downloading: updateState.message || "正在下载更新",
      downloaded: isForceUpdate
        ? "强制更新已下载完成，请点击立即安装，安装完成后会自动重启"
        : "安装包已下载完成，点击立即安装后会自动重启",
      installing: updateState.message || "正在关闭应用并准备启动安装程序，请稍候...",
      error: updateState.message || "检查更新失败",
      ...STATUS_TEXT,
    }[status] || "等待检查更新";

  const installHint =
    status === "installing"
      ? "应用即将自动退出，随后会弹出安装器。若数秒后仍无反应，再重新打开程序查看日志。"
      : "";

  return (
    <section className="section">
      {/* <div className="section-header">
        <h2>更新状态</h2>
        <span className={`badge ${["available", "downloaded"].includes(status) ? "badge-active" : ""}`}>
          {STATUS_LABELS[status] || status}
        </span>
      </div> */}

      <div className="panel update-panel">
        <div className="update-status">{statusText}</div>

        <div className="update-meta">
          {/* <div>当前版本：{updateState.currentVersion || "-"}</div> */}
          <div>最新版本：{updateState.latestVersion || "-"}</div>
          <div>发布时间：{formatDate(updateState.releaseDate)}</div>
          <div>安装包大小：{formatFileSize(updateState.fileSize)}</div>
        </div>

        <div className={`progress ${status === "downloading" || status === "downloaded" ? "progress-show" : ""}`}>
          <div className="progress-bar" style={{ width: `${progress}%` }} />
        </div>

        <div className="update-content">{updateState.updateContent || "暂无更新说明"}</div>

        {installHint ? <div className="update-install-hint">{installHint}</div> : null}

        {installError ? <div className="update-install-error">{installError}</div> : null}

        <div className="button-row">
          <button className="btn btn-primary" onClick={onCheck} disabled={isForceUpdate || status === "checking" || status === "downloading" || status === "installing"}>
            检查更新
          </button>
          <button className="btn btn-secondary" onClick={onDownload} disabled={status === "installing" || (status !== "available" && !canRetryDownload)}>
            {status === "downloading"
              ? `下载中 ${progress}%`
              : canRetryDownload
                ? "重新下载"
                : "下载更新"}
          </button>
          <button className="btn btn-warning" onClick={onInstall} disabled={status !== "downloaded" || isInstalling}>
            {isInstalling ? "正在准备安装" : "立即安装"}
          </button>
        </div>
      </div>
    </section>
  );
}
