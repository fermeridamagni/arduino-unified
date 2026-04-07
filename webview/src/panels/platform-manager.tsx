import { Cpu } from "lucide-react";
import { useEffect, useState } from "react";
import {
	type PackageItem,
	PackageManager,
} from "../components/package-manager";
import { vscode } from "../vscode";

interface PlatformItem {
	description: string;
	id: string;
	installed?: boolean;
	installedVersion?: string;
	latestVersion: string;
	maintainer: string;
	name: string;
}

export function PlatformManager() {
	const [results, setResults] = useState<PlatformItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [installing, setInstalling] = useState<string | null>(null);
	const [uninstalling, setUninstalling] = useState<string | null>(null);

	useEffect(() => {
		// Initial fetch
		setLoading(true);
		vscode.postMessage({ type: "PLATFORM_SEARCH", query: "" });

		const handleMessage = (event: MessageEvent) => {
			const message = event.data;
			if (message.type === "PLATFORM_SEARCH_RESULTS") {
				setResults(message.data);
				setLoading(false);
			} else if (message.type === "PLATFORM_INSTALL_COMPLETE") {
				setInstalling(null);
				setResults((prev) =>
					prev.map((plat) =>
						plat.id === message.id
							? {
									...plat,
									installed: true,
									installedVersion: plat.latestVersion,
								}
							: plat,
					),
				);
			} else if (message.type === "PLATFORM_UNINSTALL_COMPLETE") {
				setUninstalling(null);
				setResults((prev) =>
					prev.map((plat) =>
						plat.id === message.id
							? {
									...plat,
									installed: false,
									installedVersion: undefined,
								}
							: plat,
					),
				);
			}
		};
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, []);

	const handleSearch = (query: string) => {
		setLoading(true);
		vscode.postMessage({ type: "PLATFORM_SEARCH", query });
	};

	const handleInstall = (id: string, _isUpdate: boolean) => {
		setInstalling(id);
		vscode.postMessage({
			type: "PLATFORM_INSTALL",
			id: id,
		});
	};

	const handleUninstall = (id: string) => {
		setUninstalling(id);
		vscode.postMessage({
			type: "PLATFORM_UNINSTALL",
			id: id,
		});
	};

	const items: PackageItem[] = results.map((plat) => ({
		id: plat.id,
		name: plat.name,
		version: plat.latestVersion,
		description: plat.description,
		installed: plat.installed,
		installedVersion: plat.installedVersion,
		latestVersion: plat.latestVersion,
		metadata: {
			Maintainer: plat.maintainer,
		},
	}));

	return (
		<PackageManager
			title="Board Manager"
			icon={<Cpu className="text-[#00979C]" size={24} />}
			placeholder="Search platforms (e.g., AVR, ESP32)..."
			results={items}
			loading={loading}
			installingId={installing}
			uninstallingId={uninstalling}
			emptyIcon={<Cpu size={48} />}
			emptyMessage="No platforms found. Try updating your core index."
			onSearch={handleSearch}
			onInstall={handleInstall}
			onUninstall={handleUninstall}
		/>
	);
}
