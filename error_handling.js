class BotError extends Error {
	constructor(message, userMessage) {
		super(message);
		this.userMessage = userMessage;
	}
}
class ConfigError extends BotError {}
class AIServiceError extends BotError {}
const defaultMessage =
	"در دریافت پاسخ از هوش مصنوعی خطایی رخ داد. لطفاً بعداً تلاش کنید.";
function asDict(v) {
	return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function asText(v) {
	return typeof v === "string" ? v.trim() : "";
}
function parseAiResult(raw) {
	let text = String(raw || "")
		.trim()
		.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
	let result;
	try {
		result = JSON.parse(text);
	} catch {
		throw new AIServiceError(
			"AI response was invalid JSON",
			"پاسخ هوش مصنوعی نامعتبر بود. لطفاً دوباره تلاش کنید.",
		);
	}
	if (
		!result ||
		typeof result.answer !== "string" ||
		!Object.hasOwn(result, "datas")
	)
		throw new AIServiceError(
			"AI response missing required fields",
			"پاسخ هوش مصنوعی نامعتبر بود. لطفاً دوباره تلاش کنید.",
		);
	return result;
}
function fitBaleText(text) {
	const chars = Array.from(text);
	return chars.length <= 4096 ? text : chars.slice(0, 4095).join("") + "…";
}
async function baleRequest(base, method, payload) {
	let response;
	try {
		response = await fetch(`${base}/${method}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(20000),
		});
	} catch (e) {
		throw new Error(`${method} request failed: ${e.message}`, { cause: e });
	}
	if (!response.ok)
		throw new Error(`${method} returned HTTP ${response.status}`);
	const body = await response.json();
	if (!body || body.ok === false)
		throw new Error(`${method} was rejected by Bale`);
	return body;
}
function userMessageFor(e) {
	return e?.userMessage || defaultMessage;
}
module.exports = {
	BotError,
	ConfigError,
	AIServiceError,
	asDict,
	asText,
	parseAiResult,
	fitBaleText,
	baleRequest,
	userMessageFor,
};
