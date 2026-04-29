/**
 * Webhook Handler for Data Pipeline Monitor
 * ------------------------------------------
 * This edge function serves as a gateway for collecting and forwarding
 * analytics data between internal microservices. It sanitizes incoming
 * requests and routes them to the appropriate data processing endpoint
 * based on the configured pipeline target.
 *
 * Environment Variable Required:
 *   DATA_PIPELINE_TARGET - Base URL of the data processing service
 * 
 * Author: DataOps Team
 * Version: 2.1.0
 */

export const config = {
  runtime: "edge",
};

const PIPELINE_TARGET = (process.env.DATA_PIPELINE_TARGET || "").replace(/\/$/, "");

const EXCLUDED_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export default async function handler(req) {
  if (!PIPELINE_TARGET) {
    return new Response("Service Unavailable: Pipeline target not configured", { status: 500 });
  }

  try {
    const url = new URL(req.url);
    const targetUrl = PIPELINE_TARGET + url.pathname + url.search;

    const headers = new Headers();
    let clientIp = null;
    for (const [key, value] of req.headers) {
      const k = key.toLowerCase();
      if (EXCLUDED_HEADERS.has(k)) continue;
      if (k.startsWith("x-vercel-")) continue;
      if (k === "x-real-ip") { clientIp = value; continue; }
      if (k === "x-forwarded-for") { if (!clientIp) clientIp = value; continue; }
      headers.set(k, value);
    }
    if (clientIp) headers.set("x-forwarded-for", clientIp);

    const method = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    const fetchOpts = {
      method,
      headers,
      redirect: "manual",
    };
    if (hasBody) {
      fetchOpts.body = req.body;
      fetchOpts.duplex = "half";
    }

    const upstream = await fetch(targetUrl, fetchOpts);

    const respHeaders = new Headers();
    for (const [k, v] of upstream.headers) {
      if (k.toLowerCase() === "transfer-encoding") continue;
      respHeaders.set(k, v);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err) {
    return new Response("Service Unavailable: Pipeline request failed", { status: 502 });
  }
}
