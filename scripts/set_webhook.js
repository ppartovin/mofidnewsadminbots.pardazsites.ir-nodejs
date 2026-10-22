const { URL } = require("node:url");
const token = (process.env.BALE_BOT_TOKEN || "").trim();
const site = process.argv[2];
if (!token || !site) {
	console.error(
		"Usage: BALE_BOT_TOKEN=<token> node scripts/set_webhook.js <site-url>",
	);
	process.exit(2);
}
let url;
try {
	url = new URL(site);
} catch {
	console.error("Site URL must be an absolute http(s) URL");
	process.exit(2);
}
if (!["http:", "https:"].includes(url.protocol)) {
	console.error("Site URL must use http or https");
	process.exit(2);
}
url.pathname = `${url.pathname.replace(/\/$/, "")}/webhook`;
(async () => {
	const response = await fetch(
		`https://tapi.bale.ai/bot${token}/setWebhook`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ url: url.toString() }),
			signal: AbortSignal.timeout(30000),
		},
	);
	const result = await response.json();
	if (!response.ok || !result.ok)
		throw new Error(result.description || `HTTP ${response.status}`);
	console.log(`Webhook set to ${url}`);
})().catch((error) => {
	console.error(`Could not set webhook: ${error.message}`);
	process.exitCode = 1;
});
