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
const prompt = `
شما دستیار هستید و می‌توانید به کاربر پاسخ دهید و در صورت درخواست، یک فایل دادهٔ JSON را ویرایش کنید. دقیقاً یک شیء JSON معتبر با همین دو کلید برگردانید: {"answer":"پاسخ به کاربر","datas":null}. داده‌های فعلی و برنامهٔ درسیِ فقط‌خواندنی در اختیار شما قرار می‌گیرند. فقط در صورت درخواست صریح، فایل دادهٔ قابل‌تنظیم را تغییر دهید. اگر درخواستی برای تغییر وجود ندارد، مقدار datas را null بگذارید؛ در غیر این صورت، مقدار کامل JSON به‌روزشده را برگردانید. پاسخ را کوتاه نگه دارید و از حصارهای قالب‌بندی Markdown استفاده نکنید.

فایل current_datas که قابل‌تنظیم است، آرایه‌ای از تکالیف با قالب دقیق زیر است:
{"id": number, "title": string, "subject": string, "description": string, "due_date": "YYYY-MM-DD", "priority": string, "status": string,"announced_at": "YYYY-MM-DD"}.
معنای دقیق فیلدها: title نام تکلیف، subject درس مربوط به آن، description جزئیات کار، due_date مهلت انجام به تقویم هجری شمسی با قالب YYYY-MM-DD، priority میزان اهمیت و status وضعیت فعلی آن است (معمولاً pending یا in_progress) و همچنین announced_at نیز تاریخ اعلام تکلیف به هجری شمسی است(زمانی که معلم اون تکلیف رو داده و اون تکلیف رو اعلام کرده). دادهٔ سطح بالا آرایه است، نه شیئی که کلیدهایش شناسه‌ها باشند. دنبال ویژگی‌های دیگری نگردید و از school_schedule برای ساختن رکوردهای تکلیف استفاده  بکنید(به صورت پیشرفض وقتی زمان دریافت تکلیف داده نشده یعنی این که زمان انجام تا جلسه ی بعدی اون درس می باشد).

اگر پیام کاربر دقیقاً یکی از دکمه‌های تکالیف بله باشد، با استفاده از رکوردهای current_datas یک پیام کوتاه فارسی و آمادهٔ اشتراک‌گذاری در کانال بنویسید:
- «نوشتن تکالیف امروز برای کانال»: تکالیفی را وارد کنید که announced_at آن ها امروز هست.
- «نوشتن تکالیف فردا برای کانال»: تکالیفی را وارد کنید که due_date آن‌ها فرداست.
- «نوشتن تکالیف جاری برای کانال»: تکالیفی را وارد کنید که due_date آن‌ها مؤکداً بعد از امروز باشد و وضعیتشان تکمیل‌شده، انجام‌شده، لغوشده یا معادل یکی از این وضعیت‌های نهایی نباشد. تکالیف pending و in_progress، در صورتی که مهلتشان در آینده باشد، واجد شرایط‌اند. تکالیفی را که مهلتشان گذشته  است حذف کنید.

مقدار today و مقادیر due_date و announced_at  هر سه تاریخ هجری شمسی برای منطقهٔ زمانی Asia/Tehran هستند. آن‌ها را به‌عنوان تاریخ‌هایی در یک تقویم مقایسه کنید و فردا را روز تقویمی بعدی در تهران در نظر بگیرید. آن‌ها را به میلادی تبدیل نکنید و تقویم‌ها را با هم ترکیب نکنید. این قالب داده فقط تکالیف را نشان می‌دهد و فیلد صریحی برای نوع رکورد، تاریخ امتحان، تاریخ رویداد یا تاریخ اعلام ندارد؛ بنابراین امتحان یا رویدادی نسازید و تکلیفی را امتحان یا رویداد دسته‌بندی نکنید. در خروجی از title، subject، description، due_date و در صورت مفید بودن priority استفاده کنید؛ شناسهٔ داخلی id را نمایش ندهید. اگر هیچ رکوردی منطبق نبود، کوتاه اعلام کنید.

این متن پیش‌نویسی است که به‌صورت خصوصی برای کاربر درخواست‌کننده برگردانده می‌شود؛ ادعا نکنید که در کانال منتشر شده است.
`;

// Removes assignment records with valid Jalali due dates earlier than today and saves the filtered array.
// Step 1: Leave non-array data unchanged because the configured assignment file is expected to be an array.
// Step 2: Build today's zero-padded Solar Hijri date in the Asia/Tehran timezone.
// Step 3: Normalize supported date digits and separators, removing only valid dates strictly before today.
// Step 4: Atomically write the filtered array only when one or more records were removed.
function removeExpiredAssignments(data, filePath) {
	if (!Array.isArray(data)) return data;

	const todayParts = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
		timeZone: "Asia/Tehran",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date());
	const todayValues = {};
	for (const part of todayParts) {
		if (part.type !== "literal") todayValues[part.type] = part.value;
	}
	const today = `${todayValues.year.padStart(4, "0")}-${todayValues.month.padStart(2, "0")}-${todayValues.day.padStart(2, "0")}`;
	const remaining = [];
	for (const record of data) {
		if (!record || typeof record !== "object" || typeof record.due_date !== "string") {
			remaining.push(record);
			continue;
		}
		let dueDate = "";
		for (const digit of record.due_date.trim()) {
			const code = digit.charCodeAt(0);
			if ((code >= 0x06f0 && code <= 0x06f9) || (code >= 0x0660 && code <= 0x0669)) {
				dueDate += String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
			} else {
				dueDate += digit;
			}
		}
		dueDate = dueDate.replace(/[/.]/g, "-");
		if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
			remaining.push(record);
			continue;
		}
		const dateParts = dueDate.split("-");
		const month = Number(dateParts[1]);
		const day = Number(dateParts[2]);
		if (month < 1 || month > 12 || day < 1 || day > 31 || dueDate >= today) {
			remaining.push(record);
		}
	}
	if (remaining.length === data.length) return data;

	const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	try {
		fs.writeFileSync(temp, JSON.stringify(remaining, null, 2) + "\n", "utf8");
		fs.renameSync(temp, filePath);
		logger.info(`Removed ${data.length - remaining.length} expired assignment(s)`);
	} finally {
		if (fs.existsSync(temp)) fs.rmSync(temp);
	}
	return remaining;
}

// Reads the configured assignment file and removes expired Jalali-dated records.
// Step 1: Resolve FILE_PATH and log a clear error if it is unavailable.
// Step 2: Parse the current JSON array and pass it to the expiry filter.
// Step 3: Catch and log cleanup failures so a scheduled cleanup does not crash the bot.
function cleanupExpiredAssignments() {
	const filePath = (process.env.FILE_PATH || "").trim();
	if (!filePath) {
		logger.error("Cannot clean expired assignments: FILE_PATH is not configured");
		return;
	}
	try {
		const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
		removeExpiredAssignments(data, filePath);
	} catch (e) {
		logger.error(`Could not clean expired assignments: ${e.message}`);
	}
}

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
		data = removeExpiredAssignments(data, filePath);
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
module.exports = { getAiReply, cleanupExpiredAssignments };
