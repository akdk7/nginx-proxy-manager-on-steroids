import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("DateFormatter", () => {
	let formatDateTime: (value: string | number) => string;
	// Keep a reference to the real Intl to restore later
	const RealIntl = global.Intl;
	const desiredTimeZone = "Europe/London";
	const desiredLocale = "en-GB";

	beforeAll(async () => {
		const localStorage = {
			getItem: vi.fn().mockReturnValue(null),
			setItem: vi.fn(),
			removeItem: vi.fn(),
		};

		vi.stubGlobal("window", { localStorage });
		vi.stubGlobal("document", { documentElement: { lang: desiredLocale } });
		vi.stubGlobal("navigator", { language: desiredLocale });

		// Ensure Node-based libs using TZ behave deterministically
		try {
			process.env.TZ = desiredTimeZone;
		} catch {
			// ignore if not available
		}

		// Mock Intl.DateTimeFormat so formatting is stable regardless of host
		const MockedDateTimeFormat = class extends RealIntl.DateTimeFormat {
			constructor(_locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
				super(desiredLocale, {
					...options,
					timeZone: desiredTimeZone,
				});
			}
		} as unknown as typeof Intl.DateTimeFormat;

		global.Intl = {
			...RealIntl,
			DateTimeFormat: MockedDateTimeFormat,
		};

		const localeModule = await import("src/locale");
		formatDateTime = localeModule.formatDateTime;
	});

	afterAll(() => {
		// Restore original Intl after tests
		global.Intl = RealIntl;
		vi.unstubAllGlobals();
	});

	it("format date from iso date", () => {
		const value = "2024-01-01T00:00:00.000Z";
		const text = formatDateTime(value);
		expect(text).toBe("Monday, 01/01/2024, 12:00:00 am");
	});

	it("format date from unix timestamp number", () => {
		const value = 1762476112;
		const text = formatDateTime(value);
		expect(text).toBe("Friday, 07/11/2025, 12:41:52 am");
	});

	it("format date from unix timestamp string", () => {
		const value = "1762476112";
		const text = formatDateTime(value);
		expect(text).toBe("Friday, 07/11/2025, 12:41:52 am");
	});

	it("catch bad format from string", () => {
		const value = "this is not a good date";
		const text = formatDateTime(value);
		expect(text).toBe("this is not a good date");
	});

	it("catch bad format from number", () => {
		const value = -100;
		const text = formatDateTime(value);
		expect(text).toBe("-100");
	});

	it("catch bad format from number as string", () => {
		const value = "-100";
		const text = formatDateTime(value);
		expect(text).toBe("-100");
	});
});
