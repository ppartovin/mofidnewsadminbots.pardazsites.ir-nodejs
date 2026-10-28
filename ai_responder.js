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
const prompt = `You are an assistant that answers the user and may edit one JSON data file. Return exactly one valid JSON object with exactly these keys: {"answer":"reply to the user","datas":null}. Current data and the read-only school schedule will be provided. Only the configurable data file may be changed, only when explicitly requested. If no change is requested set datas to null; otherwise return the complete updated JSON value. Keep answer concise and do not include markdown fences.

If the user's message is exactly one of these Bale homework buttons, create one concise Persian message ready to share in a channel, using only records in current_datas:
- "نوشتن تکالیف امروز برای کانال": list records whose announcement/start date is today. Check explicit fields such as announced_at, announcement_date, created_at, or start_date. Do not treat due_date as the announcement date. If the data has no announcement/start date, say no matching record can be identified from the available dates.
- "نوشتن تکالیف فردا برای کانال": list assignments due tomorrow using due_date, exams scheduled tomorrow using their explicit exam/test date, and events occurring tomorrow using their explicit event date.
- "نوشتن تکالیف جاری برای کانال": include assignments, exams, and events that have been announced and whose due/scheduled/event date is strictly after today. Exclude completed/cancelled records (including status completed/done/cancelled); do not treat past-due records as current. Use explicit type and date fields and never infer a missing type or date.
Use Asia/Tehran calendar dates. For records with no explicit relevant date or type, do not guess or include them in a dated list. Include useful available title, subject, description, and date. If nothing matches or the needed fields are absent, clearly say so briefly. This is a draft returned privately to the requesting user; do not claim it was published to a channel.`;

// Generates the AI response using the requesting user's optional fixed system prompt.
// Step 1: Load credentials and the current data and schedule files.
// Step 2: Read the user's fixed prompt, treating missing or blank entries as empty text.
// Step 3: Send the combined system instructions and request data to the AI service.
// Step 4: Validate the response, persist explicitly requested data changes, and return the answer.
async function getAiReply(userText, userId) {
	const apiKey = (process.env.AI_API_KEY || "").trim();
	const filePath = (process.env.FILE_PATH || "").trim();
	if (!apiKey) throw new ConfigError("AI_API_KEY is not configured");
	if (!filePath) throw new ConfigError("FILE_PATH is not configured");
	let data, schedule, fixedPrompts;
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
	try {
		fixedPrompts = JSON.parse(
			fs.readFileSync(path.join(__dirname, "fixed_prompt.json"), "utf8"),
		);
	} catch (e) {
		logger.error(`Could not read fixed_prompt.json: ${e.message}`);
		fixedPrompts = {};
	}
	const userPrompt =
		fixedPrompts && typeof fixedPrompts === "object" && !Array.isArray(fixedPrompts) &&
		typeof fixedPrompts[String(userId)] === "string"
			? fixedPrompts[String(userId)].trim()
			: "";
	const client = new OpenAI({
		apiKey,
		baseURL: process.env.AI_BASE_URL || "https://api.gapgpt.app/v1",
	});
	let response;
	try {
		response = await client.chat.completions.create({
			model: (process.env.AI_MODEL || "gpt-6-luna").trim(),
			messages: [
				{ role: "system", content: userPrompt ? `${prompt}\n\nUser-specific instructions:\n${userPrompt}` : prompt },
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
