import { BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import {
	type PackageItem,
	PackageManager,
} from "../components/package-manager";
import { vscode } from "../vscode";

interface LibraryItem {
	author: string;
	category: string;
	installed?: boolean;
	installedVersion?: string;
	name: string;
	sentence: string;
	version: string;
}

export function LibraryExplorer() {
	const [results, setResults] = useState<LibraryItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [installing, setInstalling] = useState<string | null>(null);
	const [uninstalling, setUninstalling] = useState<string | null>(null);

	useEffect(() => {
		// Initial fetch
		setLoading(true);
		vscode.postMessage({ type: "LIBRARY_SEARCH", query: "" });

		const handleMessage = (event: MessageEvent) => {
			const message = event.data;
			if (message.type === "LIBRARY_SEARCH_RESULTS") {
				setResults(message.data);
				setLoading(false);
			} else if (message.type === "LIBRARY_INSTALL_COMPLETE") {
				setInstalling(null);
				setResults((prev) =>
					prev.map((lib) =>
						lib.name === message.name
							? {
									...lib,
									installed: true,
									installedVersion: lib.version,
								}
							: lib,
					),
				);
			} else if (message.type === "LIBRARY_UNINSTALL_COMPLETE") {
				setUninstalling(null);
				setResults((prev) =>
					prev.map((lib) =>
						lib.name === message.name
							? {
									...lib,
									installed: false,
									installedVersion: undefined,
								}
							: lib,
					),
				);
			}
		};
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, []);

	const handleSearch = (query: string) => {
		setLoading(true);
		vscode.postMessage({ type: "LIBRARY_SEARCH", query });
	};

	const handleInstall = (id: string, _isUpdate: boolean) => {
		setInstalling(id);
		vscode.postMessage({
			type: "LIBRARY_INSTALL",
			name: id,
		});
	};

	const handleUninstall = (id: string) => {
		setUninstalling(id);
		vscode.postMessage({
			type: "LIBRARY_UNINSTALL",
			name: id,
			version: results.find((l) => l.name === id)?.version,
		});
	};

	const items: PackageItem[] = results.map((lib) => {
		// Build metadata object, only including non-empty values
		const metadata: Record<string, string> = {};
		metadata.Author = lib.author || "Unknown";
		if (lib.category) {
			metadata.Category = lib.category;
		}

		return {
			id: lib.name,
			name: lib.name,
			version: lib.version || "", // Empty string if no version
			description: lib.sentence,
			installed: lib.installed,
			installedVersion: lib.installedVersion,
			latestVersion: lib.version || "",
			metadata,
		};
	});

	return (
		<PackageManager
			title="Library Manager"
			icon={<BookOpen className="text-[#00979C]" size={24} />}
			placeholder="Search libraries (e.g., DHT11, WiFi)..."
			results={items}
			loading={loading}
			installingId={installing}
			uninstallingId={uninstalling}
			emptyIcon={<BookOpen size={48} />}
			emptyMessage="No libraries found. Try searching for something else."
			onSearch={handleSearch}
			onInstall={handleInstall}
			onUninstall={handleUninstall}
		/>
	);
}
