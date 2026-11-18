// Settings for the tagging agent (the Cloud Run service in agent/). Leave `url` empty to run on the
// built-in keyword rules only, which is also what the tests and a fresh clone do.
//
// This file is public in a static site, so `secret` is not a real secret: it only keeps casual traffic
// out. The limits that actually cap cost are the Cloud Run max instances and the maxCalls below.
export const AGENT = {
  url: "", // e.g. "https://tag-agent-326624205371.us-central1.run.app"
  secret: "", // the APP_SECRET set on the Cloud Run service
  timeoutMs: 8000, // give up and use the keyword rules after this long
  maxCalls: 150, // agent calls allowed per page load; after that the keyword rules are used
  contextLines: 2, // earlier lines sent along with the new member line, for meaning only
};
