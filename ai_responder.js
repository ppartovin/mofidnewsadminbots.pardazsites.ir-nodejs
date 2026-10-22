const fs = require("node:fs");
const path = require("node:path");
const OpenAI = require("openai");
const {
	parseAiResult,
	ConfigError,
	AIServiceError,
} = require("./error_handling");
const { getLogger } = require("./bot_logging");
const logger = getLogger("ai");
const prompt = `You are an assistant that answers the user and may edit one JSON data file. Return exactly one valid JSON object with exactly these keys: {"answer":"reply to the user","datas":null}. Current data and the read-only school schedule will be provided. Only the configurable data file may be changed, only when explicitly requested. If no change is requested set datas to null; otherwise return the complete updated JSON value. Keep answer concise and do not include markdown fences.`;

async function getAiReply(userText) {
	const apiKey = (process.env.AI_API_KEY || "").trim();
	const filePath = (process.env.FILE_PATH || "").trim();
	if (!apiKey) throw new ConfigError("AI_API_KEY is not configured");
	if (!filePath) throw new ConfigError("FILE_PATH is not configured");
	let data, schedule;
	try {
		data = JSON.parse(fs.readFileSync(filePath, "utf8"));
		schedule = JSON.parse(
			fs.readFileSync(
				path.join(__dirname, "school_schedule.json"),
				"utf8",
			),
		);
	} catch (e) {
		throw new Error(`Could not read JSON data: ${e.message}`, { cause: e });
	}
	const client = new OpenAI({
		apiKey,
		baseURL: process.env.AI_BASE_URL || "https://api.gapgpt.app/v1",
	});
	let response;
	try {
		response = await client.chat.completions.create({
			model: (process.env.AI_MODEL || "gpt-6-luna").trim(),
			messages: [
				{ role: "system", content: prompt },
				{
					role: "user",
					content: JSON.stringify({
						message: userText,
						current_datas: data,
						school_schedule: schedule,
						today: new Intl.DateTimeFormat("fa-IR", {
							timeZone: "Asia/Tehran",
							dateStyle: "short",
						}).format(new Date()),
					}),
				},
			],
		});
	} catch (e) {
		throw new AIServiceError(`AI request failed: ${e.constructor.name}`, {
			cause: e,
		});
	}
	const result = parseAiResult(response.choices?.[0]?.message?.content || "");
	if (result.datas !== null) {
		const temp = `${filePath}.${process.pid}.tmp`;
		try {
			fs.writeFileSync(
				temp,
				JSON.stringify(result.datas, null, 2) + "\n",
				"utf8",
			);
			fs.renameSync(temp, filePath);
		} finally {
			if (fs.existsSync(temp)) fs.rmSync(temp);
		}
	}
	return result.answer;
}
module.exports = { getAiReply };
