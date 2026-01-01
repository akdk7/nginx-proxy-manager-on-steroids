import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkProxyHostHeartbeats } from "src/api/backend";
import { heartbeatDebounceMs, useDebouncedHeartbeats } from "./useDebouncedHeartbeats";

vi.mock("src/api/backend", () => ({
	checkProxyHostHeartbeats: vi.fn(),
}));

const target = {
	forwardScheme: "http",
	forwardHost: "example.com",
	forwardPort: 80,
};

describe("useDebouncedHeartbeats", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("stays idle when no targets are provided", () => {
		const { result } = renderHook(() => useDebouncedHeartbeats([], 0));
		expect(result.current.status).toBe("idle");
		expect(checkProxyHostHeartbeats).not.toHaveBeenCalled();
	});

	it("runs a heartbeat check after the debounce window", async () => {
		const mockCheck = vi.mocked(checkProxyHostHeartbeats);
		mockCheck.mockResolvedValueOnce([{ ok: true, latencyMs: 12 }]);

		const { result } = renderHook(({ refreshKey }) => useDebouncedHeartbeats([target], refreshKey), {
			initialProps: { refreshKey: 0 },
		});

		await act(async () => {
			vi.advanceTimersByTime(heartbeatDebounceMs);
			await vi.runAllTimersAsync();
		});
		expect(result.current.status).toBe("success");

		expect(mockCheck).toHaveBeenCalledTimes(1);
	});

	it("re-runs when refreshKey changes", async () => {
		const mockCheck = vi.mocked(checkProxyHostHeartbeats);
		mockCheck.mockResolvedValue([{ ok: true }]);

		const { rerender } = renderHook(
			({ refreshKey }) => useDebouncedHeartbeats([target], refreshKey),
			{ initialProps: { refreshKey: 0 } },
		);

		await act(async () => {
			vi.advanceTimersByTime(heartbeatDebounceMs);
			await vi.runAllTimersAsync();
		});
		expect(mockCheck).toHaveBeenCalledTimes(1);

		rerender({ refreshKey: 1 });
		await act(async () => {
			vi.advanceTimersByTime(heartbeatDebounceMs);
			await vi.runAllTimersAsync();
		});
		expect(mockCheck).toHaveBeenCalledTimes(2);
	});

	it("stores the error message when the check fails", async () => {
		const mockCheck = vi.mocked(checkProxyHostHeartbeats);
		mockCheck.mockRejectedValueOnce(new Error("Boom"));

		const { result } = renderHook(() => useDebouncedHeartbeats([target], 0));

		await act(async () => {
			vi.advanceTimersByTime(heartbeatDebounceMs);
			await vi.runAllTimersAsync();
		});
		expect(result.current.status).toBe("error");

		expect(result.current.error).toBe("Boom");
	});
});
