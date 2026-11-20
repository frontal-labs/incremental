import serverEntry from "@tanstack/react-start/server-entry";

const REVALIDATION_URL = "https://oss.frontal.dev/api/revalidate/";

type WorkerEnvironment = Record<string, unknown> & {
  CRON_SECRET?: string;
};

const fetchApplication = (request: Request): Promise<Response> | Response =>
  serverEntry.fetch(request);

export default {
  fetch: fetchApplication,
  async scheduled(
    _controller: ScheduledController,
    env: WorkerEnvironment
  ): Promise<void> {
    const response = await fetchApplication(
      new Request(REVALIDATION_URL, {
        headers: {
          authorization: `Bearer ${env.CRON_SECRET ?? ""}`,
        },
      })
    );

    if (!response.ok) {
      throw new Error(
        `Content revalidation failed with status ${response.status}`
      );
    }
  },
};
