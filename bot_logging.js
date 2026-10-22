const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const logDir = process.env.LOG_DIR || path.join(__dirname, "logs");
fs.mkdirSync(logDir, { recursive: true });
const file = path.join(logDir, "bot.log");
function requestId() {
	return crypto.randomBytes(4).toString("hex");
}
function getLogger(name) {
	const write = (level, message) => {
		let line = String(message);
		for (const key of ["BALE_BOT_TOKEN", "AI_API_KEY"]) {
			const secret = process.env[key];
			if (secret) line = line.split(secret).join("<redacted>");
		}
		line = line
			.replace(/\/bot\d+:[A-Za-z0-9_-]+/g, "/bot<redacted>")
			.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-<redacted>");
		const entry = `${new Date().toISOString()} | ${level} | req=${requestId()} | ${name} | ${line}\n`;
		fs.appendFileSync(file, entry, "utf8");
		if (level === "ERROR") console.error(entry.trim());
	};
	return { info: (m) => write("INFO", m), error: (m) => write("ERROR", m) };
}
module.exports = { getLogger, requestId };
