import { Search } from "lucide-react";
import { type FormEvent, useState } from "react";

export interface PackageItem {
	id: string;
	name: string;
	version: string; // Often the latest version or just "version"
	description: string;
	installed?: boolean;
	installedVersion?: string;
	latestVersion?: string;
	metadata: Record<string, string>;
}

export interface PackageManagerProps {
	title: string;
	icon: React.ReactNode;
	placeholder: string;
	results: PackageItem[];
	loading: boolean;
	installingId: string | null;
	uninstallingId: string | null;
	emptyIcon: React.ReactNode;
	emptyMessage: string;
	onSearch: (query: string) => void;
	onInstall: (id: string, isUpdate: boolean) => void;
	onUninstall: (id: string) => void;
}

export function PackageManager({
	title,
	icon,
	placeholder,
	results,
	loading,
	installingId,
	uninstallingId,
	emptyIcon,
	emptyMessage,
	onSearch,
	onInstall,
	onUninstall,
}: PackageManagerProps) {
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<"all" | "installed" | "updatable">(
		"all",
	);

	const handleSearch = (e: FormEvent) => {
		e.preventDefault();
		onSearch(query);
	};

	// Local filtering based on active states
	const filteredResults = results.filter((item) => {
		if (filter === "installed") {
			return item.installed;
		}
		if (filter === "updatable") {
			return (
				item.installed &&
				item.installedVersion &&
				item.latestVersion &&
				item.installedVersion !== item.latestVersion
			);
		}
		return true; // "all"
	});

	return (
		<div className="flex h-full flex-col bg-black">
			{/* Header */}
			<div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<h1 className="flex items-center gap-2 font-bold text-arduino-text text-xl">
					{icon}
					{title}
				</h1>

				{/* Filters */}
				<div className="flex rounded-md bg-[#111] p-1 border border-arduino-border">
					<button
						type="button"
						onClick={() => setFilter("all")}
						className={`px-3 py-1 rounded bg-transparent font-medium text-xs transition-colors cursor-pointer ${
							filter === "all"
								? "bg-[#333] text-white"
								: "text-[#888] hover:text-[#bbb]"
						}`}
					>
						All
					</button>
					<button
						type="button"
						onClick={() => setFilter("installed")}
						className={`px-3 py-1 rounded bg-transparent font-medium text-xs transition-colors cursor-pointer ${
							filter === "installed"
								? "bg-[#333] text-white"
								: "text-[#888] hover:text-[#bbb]"
						}`}
					>
						Installed
					</button>
					<button
						type="button"
						onClick={() => setFilter("updatable")}
						className={`px-3 py-1 rounded bg-transparent font-medium text-xs transition-colors cursor-pointer ${
							filter === "updatable"
								? "bg-[#333] text-white"
								: "text-[#888] hover:text-[#bbb]"
						}`}
					>
						Updatable
					</button>
				</div>
			</div>

			{/* Search Input */}
			<form className="relative mb-6" onSubmit={handleSearch}>
				<input
					className="oled-input pl-10"
					onChange={(e) => setQuery(e.target.value)}
					placeholder={placeholder}
					type="text"
					value={query}
				/>
				<Search className="absolute top-3 left-3 text-[#555555]" size={18} />
			</form>

			{/* Results */}
			<div className="flex-1 space-y-4 overflow-y-auto pr-2">
				{loading ? (
					<div className="animate-pulse text-center text-arduino-text-muted">
						Searching...
					</div>
				) : filteredResults.length > 0 ? (
					filteredResults.map((item) => {
						const isUpdatable =
							item.installed && item.installedVersion && item.latestVersion
								? item.installedVersion !== item.latestVersion
								: false;

						return (
							<div
								className="oled-card flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center"
								key={item.id}
							>
								<div className="flex-1">
									<div className="flex items-center gap-2">
										<h3 className="font-semibold text-lg text-white">
											{item.name}
										</h3>
										{item.installed && (
											<span className="rounded-full border border-[#00979C] bg-[#002a2c] px-2 py-0.5 font-bold text-[#00979C] text-[10px] uppercase">
												Installed
											</span>
										)}
									</div>
									<div className="mb-1 text-[#444] text-[10px] font-mono leading-none tracking-widest uppercase">
										{item.id}
									</div>
									<div className="mb-2 w-max rounded-full border border-[#333] bg-[#111] px-2 py-0.5 text-[#aaa] text-[11px] font-mono">
										v{item.version}
									</div>
									<p className="text-arduino-text-muted text-sm border-l-2 border-[#222] pl-3 my-2 md:pl-4">
										{item.description}
									</p>

									<div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[#666] text-xs font-medium">
										{Object.entries(item.metadata).map(([key, value]) => (
											<div key={key} className="flex gap-1">
												<span className="text-[#444]">{key}:</span>
												<span className="text-[#bbb]">{value}</span>
											</div>
										))}

										{item.installedVersion && item.latestVersion && (
											<>
												<div className="flex gap-1">
													<span className="text-[#444]">Installed:</span>
													<span className="text-[#00979C]">
														{item.installedVersion}
													</span>
												</div>
												<div className="flex gap-1">
													<span className="text-[#444]">Latest:</span>
													<span className="text-[#bbb]">
														{item.latestVersion}
													</span>
												</div>
											</>
										)}
									</div>
								</div>
								<div className="ml-4 flex min-w-max gap-2 sm:self-center">
									{item.installed && (
										<button
											type="button"
											className="oled-btn min-w-[90px] disabled:opacity-50 disabled:cursor-not-allowed"
											disabled={
												Boolean(uninstallingId) || Boolean(installingId)
											}
											onClick={() => onUninstall(item.id)}
										>
											{uninstallingId === item.id ? (
												<div className="h-4 w-4 animate-spin rounded-full border-2 border-[#fff]/30 border-t-[#fff]" />
											) : (
												"Uninstall"
											)}
										</button>
									)}
									<button
										type="button"
										className="oled-btn-primary min-w-[90px] disabled:opacity-50 disabled:cursor-not-allowed"
										disabled={
											Boolean(installingId) ||
											Boolean(uninstallingId) ||
											(item.installed && !isUpdatable)
										}
										onClick={() => onInstall(item.id, isUpdatable)}
									>
										{installingId === item.id ? (
											<div className="h-4 w-4 animate-spin rounded-full border-2 border-[#fff]/30 border-t-[#fff]" />
										) : isUpdatable ? (
											"Update"
										) : item.installed ? (
											"Installed"
										) : (
											"Install"
										)}
									</button>
								</div>
							</div>
						);
					})
				) : (
					<div className="flex h-full flex-col items-center justify-center text-[#555555]">
						<div className="mb-4 opacity-20">{emptyIcon}</div>
						<p>{emptyMessage}</p>
					</div>
				)}
			</div>
		</div>
	);
}
