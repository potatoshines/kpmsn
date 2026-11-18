// Settings for the tagging agent (the Cloud Run service in agent/). Leave `url` empty to run on the
// built-in keyword rules only, which is also what the tests and a fresh clone do.
//
// There is no secret here. This file is public, and the service only answers requests that carry the
// admin code, which the team types into the admin panel and which never appears in this repo. The public
// site never calls the agent: it replays runs saved in src/data/recorded/.
export const AGENT = {
  url: "https://tag-agent-326624205371.us-central1.run.app",
  timeoutMs: 8000, // give up and use the keyword rules after this long
  maxCalls: 150, // agent calls allowed per page load; after that the keyword rules are used
  contextLines: 2, // earlier lines sent along with the new member line, for meaning only
};
