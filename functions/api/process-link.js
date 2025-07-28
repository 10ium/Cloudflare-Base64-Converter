// This Cloudflare Pages Function processes link content for Base64 operations.
// It's designed to be deployed as a Pages Function within a Cloudflare Pages project.

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);

  // Extract parameters from the URL's query string
  const targetUrlParam = url.searchParams.get('url'); // The original URL provided by the user
  const operation = url.searchParams.get('operation'); // The desired operation: 'encode' or 'decode'

  // Validate required parameters
  if (!targetUrlParam || !operation) {
    return new Response('Missing "url" or "operation" parameters.', { status: 400 });
  }

  let finalTargetUrl = targetUrlParam;

  // Step 1: Convert GitHub blob URLs to raw format
  // Example: https://github.com/user/repo/blob/main/file.txt
  // Becomes: https://raw.githubusercontent.com/user/repo/main/file.txt
  if (finalTargetUrl.includes('github.com') && finalTargetUrl.includes('/blob/')) {
    finalTargetUrl = finalTargetUrl
      .replace('github.com', 'raw.githubusercontent.com')
      .replace('/blob/', '/');
  }

  let content;
  try {
    // Step 2: Fetch content from the target URL
    const response = await fetch(finalTargetUrl);

    // Check if content fetching was successful
    if (!response.ok) {
      if (response.status === 404) {
        return new Response(`File not found at the specified link: ${finalTargetUrl}`, { status: 404 });
      }
      return new Response(`Error fetching content from link: ${finalTargetUrl} - Status: ${response.status}`, { status: response.status });
    }

    content = await response.text(); // Get content as text
  } catch (error) {
    // Handle network errors or invalid URLs
    return new Response(`Error fetching content: ${error.message}`, { status: 500 });
  }

  let processedContent;
  // Step 3: Process content (Base64 encode or decode)
  if (operation === 'encode') {
    // Encode content to Base64 (handling UTF-8 characters)
    processedContent = btoa(unescape(encodeURIComponent(content)));
  } else if (operation === 'decode') {
    try {
      // Decode content from Base64 (handling UTF-8 characters)
      processedContent = decodeURIComponent(escape(atob(content)));
    } catch (e) {
      // Handle invalid Base64 string errors
      return new Response('Received content is not a valid Base64 string and cannot be decoded.', { status: 400 });
    }
  } else {
    // Handle invalid operation
    return new Response('Invalid operation. Please choose "encode" or "decode".', { status: 400 });
  }

  // Step 4: Return the processed content to the client
  return new Response(processedContent, {
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      // Add CORS headers to allow access from your Pages domain
      'Access-Control-Allow-Origin': '*', // Be more specific in production if possible
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
