import { useEffect, useState } from "react";
import { LibraryExplorer } from "./panels/library-explorer";
import { PlatformManager } from "./panels/platform-manager";
import { SerialPlotter } from "./panels/serial-plotter";

function App() {
	const [panelMode, setPanelMode] = useState<string | null>(null);

	useEffect(() => {
		// Determine which panel to render based on the dataset property
		// injected by the VSCode extension in index.html
		const rootElement = document.getElementById("root");
		if (rootElement?.dataset.panelMode) {
			setPanelMode(rootElement.dataset.panelMode);
		}

		// Also listen for mode updates from VSCode (for dev/debugging)
		const handleMessage = (event: MessageEvent) => {
			const message = event.data;
			if (message.type === "SET_MODE") {
				setPanelMode(message.mode);
			}
		};

		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, []);

	if (!panelMode) {
		return (
			<div className="flex h-screen w-screen items-center justify-center bg-black text-arduino-text">
				<div className="animate-pulse">Loading panel...</div>
			</div>
		);
	}

	return (
		<div className="h-screen w-screen overflow-hidden bg-black p-4 text-white">
			{panelMode === "libraries" && <LibraryExplorer />}
			{panelMode === "platforms" && <PlatformManager />}
			{panelMode === "plotter" && <SerialPlotter />}
			{panelMode !== "libraries" &&
				panelMode !== "platforms" &&
				panelMode !== "plotter" && (
					<div className="flex h-full items-center justify-center text-red-500">
						Unknown panel mode: {panelMode}
					</div>
				)}
		</div>
	);
}

export default App;
