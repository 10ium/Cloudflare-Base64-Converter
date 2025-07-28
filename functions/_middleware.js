// functions/_middleware.js
// This file acts as a middleware for Cloudflare Pages Functions.
// It allows you to define custom routing logic or apply transformations before
// requests reach your specific functions (like api/process-link.js).

// In this case, we're simply passing the request through to the next function
// or asset, which will be our api/process-link.js for matching routes.

export async function onRequest(context) {
  // The `context` object contains information about the request,
  // including `request`, `env` (environment variables), `params`, and `next`.
  // `next()` calls the next middleware or the Page Function that matches the route.
  return await context.next();
}
