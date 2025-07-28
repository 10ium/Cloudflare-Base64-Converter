// This Cloudflare Worker processes content (link, text, or file) for Base64 operations.
// It's designed to be deployed as a standalone Cloudflare Worker.

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // --- START CORS HANDLING ---
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Origin': origin || '*', // Allow the specific origin or all if not present
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400', // Cache preflight response for 24 hours
  };

  // Handle CORS preflight requests (OPTIONS method)
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers, status: 204 });
  }
  // --- END CORS HANDLING ---

  let url; // متغیر url را اینجا تعریف می‌کنیم تا در تمام تابع قابل دسترسی باشد.
  try {
    url = new URL(request.url); // ساخت URL را در try-catch قرار می‌دهیم.
  } catch (e) {
    console.error("Error parsing request URL:", e);
    return new Response("Invalid request URL.", { status: 400, headers }); // اگر URL نامعتبر بود، خطا برمی‌گردانیم.
  }

  // Now proceed with the actual request logic (GET or POST)
  if (request.method === 'POST') {
    try {
      const { inputType, content, operation, path, mimeType } = await request.json();

      if (!inputType || !content || !operation || !path) {
        return new Response('Missing required fields (inputType, content, operation, path).', { status: 400, headers });
      }

      let rawContentToProcess;
      let finalMimeType = mimeType;

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
          return new Response(`Error fetching content from link: ${fetchResponse.status} - ${await fetchResponse.text()}`, { status: fetchResponse.status, headers });
        }
        rawContentToProcess = await fetchResponse.text();
        const contentTypeHeader = fetchResponse.headers.get('Content-Type');
        if (contentTypeHeader && !mimeType) {
            finalMimeType = contentTypeHeader.split(';')[0];
        } else if (!mimeType) {
            finalMimeType = 'text/plain';
        }

      } else if (inputType === 'text') {
        rawContentToProcess = content;
      } else if (inputType === 'file') {
        rawContentToProcess = atob(content);
      } else {
        return new Response('Invalid inputType.', { status: 400, headers });
      }

      let processedContent;
      // Step 2: Perform Base64 operation
      if (operation === 'encode') {
        processedContent = btoa(unescape(encodeURIComponent(rawContentToProcess)));
      } else if (operation === 'decode') {
        try {
          processedContent = decodeURIComponent(escape(atob(rawContentToProcess)));
        } catch (e) {
          return new Response('Content is not a valid Base64 string for decoding.', { status: 400, headers });
        }
      } else {
        return new Response('Invalid operation. Choose "encode" or "decode".', { status: 400, headers });
      }

      // Step 3: Return the result based on inputType
      const jsonResponseHeaders = { ...headers, 'Content-Type': 'application/json' }; // Merge CORS headers
      
      if (inputType === 'link') {
        // For links, return a URL to this worker itself, with query params for on-demand processing
        const resultUrl = `${url.origin}/${path}?url=${encodeURIComponent(content)}&operation=${operation}`;
        return new Response(JSON.stringify({ url: resultUrl }), { headers: jsonResponseHeaders });
      } else {
        // For text/file, return the processed content directly in the JSON response
        return new Response(JSON.stringify({ content: processedContent, mimeType: finalMimeType }), { headers: jsonResponseHeaders });
      }

    } catch (error) {
      console.error('Error in worker POST:', error);
      return new Response(`Internal Server Error: ${error.message}`, { status: 500, headers });
    }
  } else { // GET request for on-demand serving
    // url is already defined and validated above
    const targetUrlParam = url.searchParams.get('url');
    const operation = url.searchParams.get('operation');
    const downloadFlag = url.searchParams.get('download');
    const pathFromWorkerUrl = url.pathname.substring(1);

    if (targetUrlParam && operation) {
      // This is a request to serve content on demand
      return processContentOnDemand(targetUrlParam, operation, downloadFlag, pathFromWorkerUrl, headers); // Pass headers to inner function
    } else {
      return new Response('Method Not Allowed or Missing Parameters. Use POST for processing content, or GET with url/operation for on-demand serving.', { status: 405, headers });
    }
  }
}

// Handles GET requests to serve content on demand
async function processContentOnDemand(targetUrlParam, operation, downloadFlag, pathFromWorkerUrl, corsHeaders) {
  let finalTargetUrl = targetUrlParam;
  if (finalTargetUrl.includes('github.com') && finalTargetUrl.includes('/blob/')) {
    finalTargetUrl = finalTargetUrl
      .replace('github.com', 'raw.githubusercontent.com')
      .replace('/blob/', '/');
  }

  let content;
  let mimeType = 'text/plain';
  let filename = pathFromWorkerUrl || 'download';

  try {
    const fetchResponse = await fetch(finalTargetUrl);
    if (!fetchResponse.ok) {
      return new Response(`Error fetching content: ${fetchResponse.status} - ${await fetchResponse.text()}`, { status: fetchResponse.status, headers: corsHeaders });
    }
    content = await fetchResponse.text();
    const contentTypeHeader = fetchResponse.headers.get('Content-Type');
    if (contentTypeHeader) {
        mimeType = contentTypeHeader.split(';')[0];
    }
    try {
        const originalUrlObj = new URL(targetUrlParam);
        const pathSegments = originalUrlObj.pathname.split('/');
        const lastSegment = pathSegments[pathSegments.length - 1];
        if (lastSegment && lastSegment.includes('.')) {
            filename = lastSegment;
        }
    } catch (e) {
        // Ignore URL parsing errors
    }

  } catch (error) {
    return new Response(`Error fetching content: ${error.message}`, { status: 500, headers: corsHeaders });
  }

  let processedContent;
  if (operation === 'encode') {
    processedContent = btoa(unescape(encodeURIComponent(content)));
  } else if (operation === 'decode') {
    try {
      processedContent = decodeURIComponent(escape(atob(content)));
    } catch (e) {
      return new Response('Content is not a valid Base64 string for decoding.', { status: 400, headers: corsHeaders });
    }
  } else {
    return new Response('Invalid operation.', { status: 400, headers: corsHeaders });
  }

  // Merge CORS headers with content-specific headers
  const finalHeaders = {
    ...corsHeaders,
    'Content-Type': mimeType,
  };

  if (downloadFlag === 'true') {
    finalHeaders['Content-Disposition'] = `attachment; filename="${filename}"`;
  }

  return new Response(processedContent, { headers: finalHeaders });
}
