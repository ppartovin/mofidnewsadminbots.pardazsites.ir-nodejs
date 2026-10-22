const express = require("express");
const { getAiReply } = require("./ai_responder");
const { getLogger, requestId } = require("./bot_logging");
const {
	asDict,
	asText,
	baleRequest,
	fitBaleText,
	userMessageFor,
} = require("./error_handling");

const app = express();
const logger = getLogger("webhook");
const token = (process.env.BALE_BOT_TOKEN || "").trim();
const apiUrl = `https://tapi.bale.ai/bot${token}`;
const bale_secret=process.env.BALE_SECRETE;
app.use(express.json({ limit: "1mb" }));

app.post(`/webhook/${bale_secret}`, async (req, res) => {
	const id = requestId();
	try {
		const update = asDict(req.body);
		const message = asDict(update.message);
		const chatId = asDict(message.chat).id;
		if (!token) return res.status(500).send("Token is missing");
		if (chatId == null) return res.status(200).send("ok");
		const userText = asText(message.text) || asText(message.caption);
		if (!userText) {
			await baleRequest(apiUrl, "sendMessage", {
				chat_id: chatId,
				text: "فعلاً فقط پیام‌های متنی را می‌توانم پاسخ بدهم.",
			}).catch((e) => logger.error(e.message));
			return res.status(200).send("ok");
		}
		let status;
		try {
			status = await baleRequest(apiUrl, "sendMessage", {
				chat_id: chatId,
				text: "در حال پردازش...",
			});
		} catch (e) {
			logger.error(`Status send failed: ${e.message}`);
			return res.status(200).send("ok");
		}
		const messageId = asDict(status.result).message_id;
		if (messageId == null) return res.status(200).send("ok");
		let reply;
		try {
			reply = await getAiReply(userText);
		} catch (e) {
			logger.error(`AI failed: ${e.stack || e}`);
			reply = userMessageFor(e);
		}
		await baleRequest(apiUrl, "editMessageText", {
			chat_id: chatId,
			message_id: messageId,
			text: fitBaleText(reply),
		}).catch((e) => logger.error(`Bale edit failed: ${e.message}`));
		res.status(200).send("ok");
	} catch (e) {
		logger.error(
			`Unhandled webhook error request_id=${id}: ${e.stack || e}`,
		);
		res.status(200).send("ok");
	}
});
app.get("/", (_req, res) => res.status(200).send("Bot is running"));


const port = Number(process.env.PORT || 5000);


app.listen(port, "0.0.0.0", () =>
	logger.info(`Express server listening on ${port}`),
);
