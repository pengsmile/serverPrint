import { useEffect, useState } from "react";
import InfoPanel from "./components/InfoPanel";
import UpdatePanel from "./components/UpdatePanel";
import EntityList from "./components/EntityList";

const defaultStatus = {
  version: "1.0.0",
  port: "-",
  defaultPrinter: "未设置",
  clients: [],
  printers: [],
};

const defaultUpdateState = {
  status: "idle",
  currentVersion: "1.0.0",
  latestVersion: "",
  releaseDate: "",
  fileSize: null,
  updateContent: "",
  downloadProgress: 0,
  message: "",
};

export default function App() {
  const [status, setStatus] = useState(defaultStatus);
  const [updateState, setUpdateState] = useState(defaultUpdateState);
  const [installError, setInstallError] = useState("");
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    let removeClientsListener = null;
    let removeUpdateListener = null;

    async function loadInitialData() {
      const api = window.electronAPI;
      if (!api) return;

      try {
        const [serviceStatus, latestUpdateState] = await Promise.all([
          api.getStatus(),
          api.getUpdateState(),
        ]);

        setStatus((prev) => ({ ...prev, ...serviceStatus }));
        setUpdateState((prev) => ({ ...prev, ...latestUpdateState }));
      } catch (error) {
        console.error("Failed to initialize renderer state", error);
      }

      removeClientsListener = api.onClientsChanged((clients) => {
        setStatus((prev) => ({ ...prev, clients }));
      });

      removeUpdateListener = api.onUpdateStateChanged((nextState) => {
        setUpdateState((prev) => ({ ...prev, ...nextState }));
        if (!["downloaded", "installing"].includes(nextState.status)) {
          setInstallError("");
          setIsInstalling(false);
        }

        if (nextState.status === "installing") {
          setIsInstalling(true);
        }
      });
    }

    loadInitialData();

    return () => {
      if (typeof removeClientsListener === "function") removeClientsListener();
      if (typeof removeUpdateListener === "function") removeUpdateListener();
    };
  }, []);

  const infoItems = [
    { label: "服务版本", value: status.version || "1.0.0" },
    { label: "服务端口", value: String(status.port || "-") },
    { label: "默认打印机", value: status.defaultPrinter || "未设置" },
  ];

  async function handleCheck() {
    setInstallError("");
    return window.electronAPI?.checkUpdate();
  }

  async function handleDownload() {
    setInstallError("");
    return window.electronAPI?.downloadUpdate();
  }

  async function handleInstall() {
    const api = window.electronAPI;
    if (!api || isInstalling) return;

    setInstallError("");
    setIsInstalling(true);

    try {
      await api.installUpdate();
    } catch (error) {
      const message = error?.message || "启动安装程序失败，请重试。";
      console.error("Failed to start installer", error);
      setInstallError(message);
      setIsInstalling(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="hero">
        <div>
          <p className="eyebrow">Print Service Console</p>
          <h1>Print Helper</h1>
          <p className="hero-copy">打印助手</p>
        </div>
        <div className="hero-pill">服务运行中</div>
      </div>

      <InfoPanel items={infoItems} />

      <UpdatePanel
        updateState={updateState}
        installError={installError}
        isInstalling={isInstalling}
        onCheck={handleCheck}
        onDownload={handleDownload}
        onInstall={handleInstall}
      />

      <div className="grid-layout">
        <EntityList
          title="已连接客户端"
          badge={status.clients.length}
          badgeActive={status.clients.length > 0}
          items={status.clients}
          emptyText="暂无客户端连接"
          renderItem={(client) => {
            const title =
              client.title && client.title !== "Unknown Client"
                ? client.title
                : `客户端 ${client.id.substring(0, 8)}`;
            const subtitle = client.url || `ID: ${client.id.substring(0, 8)}`;

            return (
              <div className="list-item" key={client.id} title={subtitle}>
                <span className="list-icon list-icon-green">C</span>
                <div className="list-text">
                  <div className="list-title">{title}</div>
                  <div className="list-subtitle">{subtitle}</div>
                </div>
                <span className="list-tag list-tag-green">在线</span>
              </div>
            );
          }}
        />

        <EntityList
          title="可用打印机"
          badge={status.printers.length}
          badgeActive={status.printers.length > 0}
          items={status.printers}
          emptyText="未找到打印机"
          renderItem={(printer) => (
            <div className="list-item" key={printer.name}>
              <span className="list-icon">P</span>
              <div className="list-text">
                <div className="list-title">{printer.name || ""}</div>
              </div>
              {printer.isDefault ? <span className="list-tag">默认</span> : null}
            </div>
          )}
        />
      </div>

      <div className="footer-bar">
        <button className="btn btn-secondary btn-wide" onClick={() => window.electronAPI?.openLog()}>
          查看日志
        </button>
      </div>
    </div>
  );
}
