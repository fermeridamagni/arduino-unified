// VSCode API wrapper for Webviews
// Type definitions for the VSCode API injected in webviews
export interface WebviewApi<StateType> {
	getState(): StateType | undefined;
	postMessage(message: unknown): void;
	setState(newState: StateType): void;
}

declare global {
	function acquireVsCodeApi<StateType = unknown>(): WebviewApi<StateType>;
}

/**
 * A utility wrapper around the acquireVsCodeApi() function, which enables
 * message passing and state management between the webview and extension.
 *
 * This utility also enables an environment fallback for when the webview is
 * running in a normal browser (e.g. during development).
 */
class VSCodeAPIWrapper {
	private readonly vsCodeApi: WebviewApi<unknown> | undefined;

	constructor() {
		if (typeof acquireVsCodeApi === "function") {
			this.vsCodeApi = acquireVsCodeApi();
		}
	}

	/**
	 * Post a message (i.e. send arbitrary data) to the owner extension.
	 */
	postMessage(message: unknown) {
		if (this.vsCodeApi) {
			this.vsCodeApi.postMessage(message);
		} else {
			console.log("Would have posted message to VSCode:", message);
		}
	}

	/**
	 * Get the persistent state stored for this webview.
	 */
	getState(): unknown | undefined {
		if (this.vsCodeApi) {
			return this.vsCodeApi.getState();
		}
		const state = localStorage.getItem("vscodeState");
		return state ? JSON.parse(state) : undefined;
	}

	/**
	 * Set the persistent state stored for this webview.
	 */
	setState<T extends unknown | undefined>(newState: T): T {
		if (this.vsCodeApi) {
			this.vsCodeApi.setState(newState);
			return newState;
		}
		localStorage.setItem("vscodeState", JSON.stringify(newState));
		return newState;
	}
}

// Export a robust singleton for the API
export const vscode = new VSCodeAPIWrapper();
