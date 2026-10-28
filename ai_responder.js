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

The configurable current_datas file is a JSON array of assignment objects. Each object has this exact schema:
{"id": number, "title": string, "subject": string, "description": string, "due_date": "YYYY-MM-DD", "priority": string, "status": string}.
Use these exact field meanings: title is the assignment name, subject is its class subject, description is the work details, due_date is the deadline in the Solar Hijri (Jalali) calendar using YYYY-MM-DD format, priority is its importance, and status is its current state (commonly pending or in_progress). The top-level data is an array, not an object keyed by id. Do not look for other properties or use school_schedule to invent assignment records.

If the user's message is exactly one of these Bale homework buttons, create one concise Persian message ready to share in a channel, using only current_datas records:
- "نوشتن تکالیف امروز برای کانال": the schema has no announcement/assigned/created date, so it cannot establish which assignments were announced today. Do not substitute due_date for announcement date and do not claim any assignment was assigned today. Say the available data does not contain announcement dates.
- "نوشتن تکالیف فردا برای کانال": include assignment records whose due_date is tomorrow.
- "نوشتن تکالیف جاری برای کانال": include assignment records whose due_date is strictly later than today and whose status is not completed, done, cancelled, or an equivalent final state. Pending and in_progress records qualify if their due_date is still in the future. Exclude records with past or today's due_date.

The supplied today value and due_date values are both Solar Hijri (Jalali) dates for Asia/Tehran. Compare them as dates in the same calendar, and determine tomorrow as the next Tehran calendar day. Do not convert them to Gregorian or mix calendar systems. This file schema represents assignments only: it has no explicit record type, exam date, event date, or announcement date, so do not invent exams/events or classify an assignment as an exam/event. In the output, use title, subject, description, due_date, and optionally priority when useful; do not expose internal id unless useful for disambiguation. If no record matches, say so briefly. This is a draft returned privately to the requesting user; do not claim it was published to a channel.`;

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
