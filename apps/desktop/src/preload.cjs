const { contextBridge, ipcRenderer } = require("electron");
const { createGraneriDesktopApi } = require("./preload-api.cjs");

contextBridge.exposeInMainWorld(
	"graneriDesktop",
	createGraneriDesktopApi({
		ipcRenderer,
		platform: process.platform,
		env: process.env,
	}),
);
