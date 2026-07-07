const REPO = "Subway-Builder-Modded/registry";
const GITHUB_API = "https://api.github.com";

interface Env {
	GITHUB_TOKEN: string;
}

async function dispatchWorkflow(token: string, workflow: string): Promise<void> {
	const response = await fetch(
		`${GITHUB_API}/repos/${REPO}/actions/workflows/${workflow}/dispatches`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "railyard-scheduler/1.0",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ ref: "main" }),
		},
	);
	if (!response.ok) {
		throw new Error(
			`dispatch ${workflow}: ${response.status} ${await response.text()}`,
		);
	}
}

export default {
	async scheduled(
		event: ScheduledEvent,
		env: Env,
		_ctx: ExecutionContext,
	): Promise<void> {
		const scheduledTime = new Date(event.scheduledTime);
		const hour = scheduledTime.getUTCHours();
		const topOfHour = scheduledTime.getUTCMinutes() === 0;

		// Download regeneration runs every fire (:00 and :30). Everything else stays
		// hourly / 4-hourly / daily, so it only dispatches at the top of the hour.
		const workflows: string[] = ["regenerate-downloads-hourly.yml"];

		if (topOfHour) {
			workflows.push("cache-website-analytics.yml");

			if (hour % 4 === 0) {
				workflows.push("regenerate-registry-analytics.yml");
			}

			if (hour === 4) {
				workflows.push("cache-download-history.yml");
			}
		}

		const results = await Promise.allSettled(
			workflows.map((w) => dispatchWorkflow(env.GITHUB_TOKEN, w)),
		);

		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			if (result.status === "rejected") {
				console.error(`Failed to dispatch ${workflows[i]}:`, result.reason);
			} else {
				console.log(`Dispatched ${workflows[i]}`);
			}
		}
	},
};
