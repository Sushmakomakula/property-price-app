// Connector between the Property Price Finder website and PropertyLayer.
// PropertyLayer does not accept calls from web pages on other sites, so the website asks this
// Cloudflare Worker, which adds your secret key and passes the request on.
//
// Setup (free Cloudflare account, no card): see "PropertyLayer connector" in README.md.
// Secrets/variables to set on the worker:
//   PL_KEY          your PropertyLayer API key (Settings → Variables → add as a Secret)
//   ALLOWED_ORIGIN  https://sushmakomakula.github.io   (only your website may use it)

const ALLOWED_PATHS = ["/properties/address", "/properties/point", "/properties/usage"];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "https://sushmakomakula.github.io";
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, X-PL-Key",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (origin !== allowed) return new Response(JSON.stringify({ detail: "This connector only works for its own website." }), { status: 403, headers: { "Content-Type": "application/json" } });
    if (request.method !== "GET") return new Response(JSON.stringify({ detail: "Only GET is allowed." }), { status: 405, headers: cors });

    const url = new URL(request.url);
    if (!ALLOWED_PATHS.includes(url.pathname)) return new Response(JSON.stringify({ detail: "Not available." }), { status: 404, headers: cors });

    const key = env.PL_KEY || request.headers.get("X-PL-Key");
    if (!key) return new Response(JSON.stringify({ detail: "The connector has no PropertyLayer key." }), { status: 401, headers: cors });

    const upstream = await fetch("https://api.propertylayer.com" + url.pathname + url.search, {
      headers: { Authorization: "Bearer " + key, Accept: "application/json" },
    });
    const body = await upstream.text();
    return new Response(body, { status: upstream.status, headers: { ...cors, "Content-Type": "application/json" } });
  },
};
