import { Activity, Download, Pause, Play, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AlignedData } from "uplot";
import uPlot from "uplot";
import UplotReact from "uplot-react";
import "uplot/dist/uPlot.min.css";

const MAX_DATA_POINTS = 500;

export function SerialPlotter() {
	const [isPaused, setIsPaused] = useState(false);
	const [seriesNames, setSeriesNames] = useState<string[]>(["Time"]);

	// Data for uPlot: [ [x1, x2...], [y11, y12...], [y21, y22...], ... ]
	// Initial state has just time array.
	const [data, setData] = useState<number[][]>([[]]);

	const dataRef = useRef<number[][]>([[]]);
	const isPausedRef = useRef(false);

	useEffect(() => {
		isPausedRef.current = isPaused;
	}, [isPaused]);

	const processIncomingData = useCallback((line: string) => {
		// Basic CSV/Space parsing:
		// If we receive "12 34 56", we map them to lines.
		const nums = line
			.split(/[,\s]+/)
			.map(Number.parseFloat)
			.filter((n) => !Number.isNaN(n));
		if (nums.length === 0) {
			return;
		}

		const currentData = [...dataRef.current];
		const now = Date.now() / 1000;

		// Expand series dimensions if we received more values than we're tracking
		if (nums.length + 1 > currentData.length) {
			const needed = nums.length + 1 - currentData.length;
			for (let i = 0; i < needed; i++) {
				currentData.push([]);
				setSeriesNames((prev) => [...prev, `Value ${prev.length}`]);
			}
		}

		// Push X (Time)
		currentData[0].push(now);

		// Push Y values
		for (let i = 0; i < nums.length; i++) {
			currentData[i + 1].push(nums[i]);
		}

		// Trim arrays to max data points
		if (currentData[0].length > MAX_DATA_POINTS) {
			for (const series of currentData) {
				series.shift();
			}
		}

		dataRef.current = currentData;
		// Debounce state update or let uplot handle it ideally.
		setData([...currentData]);
	}, []);

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data;
			if (message.type === "SERIAL_DATA") {
				if (isPausedRef.current) {
					return;
				}

				// Expected format: "var1: 10, var2: 20" or just "10,20"
				processIncomingData(message.data);
			}
		};

		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [processIncomingData]);

	const handleClear = () => {
		const emptyData: number[][] = new Array(seriesNames.length)
			.fill(0)
			.map(() => []);
		dataRef.current = emptyData;
		setData(emptyData);
	};

	// uPlot Options
	const options: uPlot.Options = {
		width: window.innerWidth - 32, // Accommodate padding
		height: window.innerHeight - 150,
		title: "",
		tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), "UTC"),
		series: seriesNames.map((name, i) => {
			// Generate some standard dark mode readable colors for series
			const colors = ["#00979C", "#FF5722", "#4CAF50", "#E040FB", "#FFEB3B"];
			if (i === 0) {
				return {
					label: "Time",
					value: (_u, v) =>
						v == null ? "--" : new Date(v * 1000).toLocaleTimeString(),
				};
			}

			return {
				label: name,
				stroke: colors[(i - 1) % colors.length],
				width: 2,
			};
		}),
		axes: [
			{
				stroke: "#888888",
				grid: { stroke: "#222222", width: 1 },
			},
			{
				stroke: "#888888",
				grid: { stroke: "#222222", width: 1 },
			},
		],
		scales: {
			x: { time: false },
		},
	};

	// Handle window resize dynamically later if needed, but uplot-react handles standard rerenders.

	return (
		<div className="flex h-full flex-col bg-black">
			{/* Header & Controls */}
			<div className="mb-4 flex items-center justify-between">
				<h1 className="flex items-center gap-2 font-bold text-arduino-text text-xl">
					<Activity className="text-[#00979C]" size={24} />
					Serial Plotter
				</h1>

				<div className="flex items-center gap-2">
					<button
						className="oled-btn"
						onClick={() => setIsPaused(!isPaused)}
						type="button"
					>
						{isPaused ? <Play size={16} /> : <Pause size={16} />}
						{isPaused ? "Resume" : "Pause"}
					</button>

					<button className="oled-btn" onClick={handleClear} type="button">
						<Trash2 size={16} />
						Clear
					</button>

					<button className="oled-btn" type="button">
						<Download size={16} />
						Export
					</button>
				</div>
			</div>

			{/* Plot Area */}
			<div className="oled-card relative flex flex-1 items-center justify-center overflow-hidden p-2">
				<style>
					{`
            .u-legend { color: #e0e0e0; }
            .u-time { padding-bottom: 5px; }
            .uplot { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; }
          `}
				</style>
				{data[0].length > 0 ? (
					<UplotReact
						data={data as unknown as AlignedData}
						options={options}
						target={document.createElement("div")} // Let wrapper create element
					/>
				) : (
					<div className="flex flex-col items-center text-[#555555]">
						<Activity className="mb-4 opacity-20" size={48} />
						<p>Waiting for serial data...</p>
						<p className="mt-2 text-xs">
							Print numbers separated by commas or spaces.
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
