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

// Target pipeline endpoint - configured via environment variable for security
const PIPELINE_TARGET = (process.env.DATA_PIPELINE_TARGET || "").replace(/\/$/, "");

// Headers that should be filtered out for security and compliance
// These are internal Vercel or connection-specific headers that
// should not be forwarded to downstream services
const FILTERED_HEADERS = new Set([
  "host",                    // Origin host
  "connection",              // Connection management
  "keep-alive",              // Persistence control
  "proxy-authenticate",      // Internal proxy auth
  "proxy-authorization",     // Internal proxy credentials
  "te",                      // Transfer encoding negotiation
  "trailer",                 // Trailers control
  "transfer-encoding",       // Chunked encoding flag
  "upgrade",                 // Protocol upgrade requests
  "forwarded",               // Proxy forwarding info
  "x-forwarded-host",        // Original host header
  "x-forwarded-proto",       // Original protocol
  "x-forwarded-port",        // Original port
]);

/**
 * Main request handler - processes incoming analytics requests
 * Validates configuration, extracts client metadata, and forwards
 * to the configured data processing pipeline.
 * 
 * @param {Request} req - Incoming HTTP request from analytics collector
 * @returns {Response} - Processed response from data pipeline
 */
export default async function handler(req) {
  // Validate pipeline configuration exists
  if (!PIPELINE_TARGET) {
    console.error("Pipeline configuration missing: DATA_PIPELINE_TARGET not set");
    return new Response("Service Configuration Error: Pipeline target not configured", { 
      status: 500,
      headers: { "Content-Type": "text/plain" }
    });
  }

  try {
    // Construct target URL by appending path and query from original request
    const url = new URL(req.url);
    const destinationUrl = PIPELINE_TARGET + url.pathname + url.search;

    // Build clean headers for forwarding
    const sanitizedHeaders = new Headers();
    let clientIdentifier = null;

    // Process and filter incoming headers
    for (const [key, value] of req.headers) {
      const normalizedKey = key.toLowerCase();

      // Skip filtered internal headers
      if (FILTERED_HEADERS.has(normalizedKey)) continue;
      
      // Skip Vercel-specific headers
      if (normalizedKey.startsWith("x-vercel-")) continue;

      // Extract client identification from proxy headers
      if (normalizedKey === "x-real-ip") { 
        clientIdentifier = value; 
        continue; 
      }
      if (normalizedKey === "x-forwarded-for") { 
        if (!clientIdentifier) clientIdentifier = value; 
        continue; 
      }

      sanitizedHeaders.set(key, value);
    }

    // Forward client identity if available
    if (clientIdentifier) {
      sanitizedHeaders.set("x-forwarded-for", clientIdentifier);
    }

    const httpMethod = req.method;
    const hasPayload = httpMethod !== "GET" && httpMethod !== "HEAD";

    // Prepare fetch configuration for pipeline request
    const fetchConfiguration = {
      method: httpMethod,
      headers: sanitizedHeaders,
      redirect: "manual",  // Don't auto-follow redirects
    };

    // Attach body for methods that support payload
    if (hasPayload) {
      fetchConfiguration.body = req.body;
      fetchConfiguration.duplex = "half";
    }

    // Execute pipeline request
    const pipelineResponse = await fetch(destinationUrl, fetchConfiguration);

    // Build response headers, excluding chunked transfer encoding
    const responseHeaders = new Headers();
    for (const [headerName, headerValue] of pipelineResponse.headers) {
      if (headerName.toLowerCase() === "transfer-encoding") continue;
      responseHeaders.set(headerName, headerValue);
    }

    // Return processed response
    return new Response(pipelineResponse.body, {
      status: pipelineResponse.status,
      headers: responseHeaders,
    });

  } catch (processingError) {
    console.error("Pipeline processing failed:", processingError.message);
    return new Response("Service Unavailable: Data pipeline unreachable", { 
      status: 502,
      headers: { "Content-Type": "text/plain" }
    });
  }
}
