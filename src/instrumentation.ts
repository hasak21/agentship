// Runs once when the Next.js server starts.
// If a proxy is configured in the environment (common on local dev machines
// behind a VPN/Clash proxy), route Node's global fetch through it.
// On a normal server or in production (no proxy env var), this does nothing.

export async function register() {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  if (!proxyUrl) return;

  const { setGlobalDispatcher, ProxyAgent } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`[AgentShip] Routing outbound fetch through proxy: ${proxyUrl}`);
}
