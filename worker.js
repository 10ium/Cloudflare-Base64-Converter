// This Cloudflare Worker processes content (link, text, or file) for Base64 operations.
// It's designed to be deployed as a standalone Cloudflare Worker.

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // Allow CORS preflight requests
  if (request.method === 'OPTIONS') {
    return handleOptions(request);
  }

  // Ensure it's a POST request for processing content
  if (request.method !== 'POST') {
    // If it's a GET request, it means the user is trying to access a generated link
    const url = new URL(request.url);
    const targetUrlParam = url.searchParams.get('url');
    const operation = url.searchParams.get('operation');
    const downloadFlag = url.searchParams.get('download');
    const pathFromWorkerUrl = url.pathname.substring(1); // Get path like 'output' or 'my-content'

    if (targetUrlParam && operation) {
      // This is a request to serve content on demand
      return processContentOnDemand(targetUrlParam, operation, downloadFlag, pathFromWorkerUrl);
    } else {
      return new Response('Method Not Allowed or Missing Parameters. Use POST for processing content, or GET with url/operation for on-demand serving.', { status: 405 });
    }
  }

  try {
    const { inputType, content, operation, path, mimeType } = await request.json();

    if (!inputType || !content || !operation || !path) {
      return new Response('Missing required fields (inputType, content, operation, path).', { status: 400 });
    }

    let rawContentToProcess;
    let finalMimeType = mimeType; // Use provided MIME type or infer

    // Step 1: Get the raw content based on inputType
    if (inputType === 'link') {
      let targetUrl = content;
      // Convert GitHub blob URLs to raw format
      if (targetUrl.includes('github.com') && targetUrl.includes('/blob/')) {
        targetUrl = targetUrl
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/');
      }

      const fetchResponse = await fetch(targetUrl);
      if (!fetchResponse.ok) {
        return new Response(`Error fetching content from link: ${fetchResponse.status} - ${await fetchResponse.text()}`, { status: fetchResponse.status });
      }
      rawContentToProcess = await fetchResponse.text();
      // Try to infer MIME type for links if not provided or generic
      const contentTypeHeader = fetchResponse.headers.get('Content-Type');
      if (contentTypeHeader && !mimeType) {
          finalMimeType = contentTypeHeader.split(';')[0]; // Get only the type, not charset
      } else if (!mimeType) {
          finalMimeType = 'text/plain'; // Default for links if no specific MIME
      }

    } else if (inputType === 'text') {
      rawContentToProcess = content; // Content is already raw text
    } else if (inputType === 'file') {
      // Content is Base64 encoded ArrayBuffer from frontend. Decode it to binary string.
      rawContentToProcess = atob(content);
    } else {
      return new Response('Invalid inputType.', { status: 400 });
    }

    let processedContent;
    // Step 2: Perform Base64 operation
    if (operation === 'encode') {
      // For text, encodeURIComponent + unescape for UTF-8 safety
      // For binary (from file), btoa directly on the binary string
      processedContent = btoa(unescape(encodeURIComponent(rawContentToProcess)));
    } else if (operation === 'decode') {
      try {
        // For text, decodeURIComponent + escape for UTF-8 safety
        // For binary (from file), atob directly on the Base64 string
        processedContent = decodeURIComponent(escape(atob(rawContentToProcess)));
      } catch (e) {
        return new Response('Content is not a valid Base64 string for decoding.', { status: 400 });
      }
    } else {
      return new Response('Invalid operation. Choose "encode" or "decode".', { status: 400 });
    }

    // Step 3: Return the result based on inputType
    const headers = { 'Content-Type': 'application/json' };
    const origin = request.headers.get('Origin') || '*'; // Get origin for CORS
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';

    if (inputType === 'link') {
      // For links, return a URL to this worker itself, with query params for on-demand processing
      const resultUrl = `${url.origin}/${path}?url=${encodeURIComponent(content)}&operation=${operation}`;
      return new Response(JSON.stringify({ url: resultUrl }), { headers });
    } else {
      // For text/file, return the processed content directly in the JSON response
      return new Response(JSON.stringify({ content: processedContent, mimeType: finalMimeType }), { headers });
    }

  } catch (error) {
    console.error('Error in worker:', error);
    return new Response(`Internal Server Error: ${error.message}`, { status: 500 });
  }
}

// Handles GET requests to serve content on demand
async function processContentOnDemand(targetUrlParam, operation, downloadFlag, pathFromWorkerUrl) {
  let finalTargetUrl = targetUrlParam;
  if (finalTargetUrl.includes('github.com') && finalTargetUrl.includes('/blob/')) {
    finalTargetUrl = finalTargetUrl
      .replace('github.com', 'raw.githubusercontent.com')
      .replace('/blob/', '/');
  }

  let content;
  let mimeType = 'text/plain';
  let filename = pathFromWorkerUrl || 'download'; // Use path from URL or generic

  try {
    const fetchResponse = await fetch(finalTargetUrl);
    if (!fetchResponse.ok) {
      return new Response(`Error fetching content: ${fetchResponse.status} - ${await fetchResponse.text()}`, { status: fetchResponse.status });
    }
    content = await fetchResponse.text();
    const contentTypeHeader = fetchResponse.headers.get('Content-Type');
    if (contentTypeHeader) {
        mimeType = contentTypeHeader.split(';')[0];
    }
    // Try to get a more meaningful filename from the original URL if possible
    try {
        const originalUrlObj = new URL(targetUrlParam);
        const pathSegments = originalUrlObj.pathname.split('/');
        const lastSegment = pathSegments[pathSegments.length - 1];
        if (lastSegment && lastSegment.includes('.')) { // If it looks like a filename
            filename = lastSegment;
        }
    } catch (e) {
        // Ignore URL parsing errors, use default filename
    }

  } catch (error) {
    return new Response(`Error fetching content: ${error.message}`, { status: 500 });
  }

  let processedContent;
  if (operation === 'encode') {
    processedContent = btoa(unescape(encodeURIComponent(content)));
  } else if (operation === 'decode') {
    try {
      processedContent = decodeURIComponent(escape(atob(content)));
    } catch (e) {
      return new Response('Content is not a valid Base64 string for decoding.', { status: 400 });
    }
  } else {
    return new Response('Invalid operation.', { status: 400 });
  }

  const headers = {
    'Content-Type': mimeType,
    'Access-Control-Allow-Origin': '*',
  };

  if (downloadFlag === 'true') {
    headers['Content-Disposition'] = `attachment; filename="${filename}"`;
  }

  return new Response(processedContent, { headers });
}

// Handles CORS preflight requests
function handleOptions(request) {
  const headers = {
    'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400', // Cache preflight response for 24 hours
  };
  return new Response(null, { headers, status: 204 });
}
