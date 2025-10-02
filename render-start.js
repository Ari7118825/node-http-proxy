const http = require('http');
const httpProxy = require('http-proxy');
const { URL } = require('url');
const zlib = require('zlib');

// --- Configuration ---
const PORT = process.env.PORT || 8080;

// The DEFAULT target if no hostname is specified in the URL path.
const DEFAULT_TARGET_URL = process.env.TARGET_URL;

// Render provides this automatically. It's the proxy's own public hostname.
const PROXY_HOSTNAME = process.env.RENDER_EXTERNAL_URL 
    ? new URL(process.env.RENDER_EXTERNAL_URL).hostname 
    : `localhost:${PORT}`;

// --- Validation ---
if (!DEFAULT_TARGET_URL) {
  console.error("FATAL ERROR: The 'TARGET_URL' environment variable is not set.");
  process.exit(1);
}

const defaultTarget = new URL(DEFAULT_TARGET_URL);

// --- Create the Proxy Server ---
const proxy = httpProxy.createProxyServer({
  // Don't auto-rewrite host headers; we'll manage them manually.
  changeOrigin: true,
  selfHandleResponse: true, // We need to modify the response.
});

/**
 * Injects the client-side URL rewriting script into an HTML body.
 * @param {Buffer} bodyBuffer - The HTML content as a buffer.
 * @param {string} targetHostname - The hostname of the original site (e.g., 'discord.com').
 * @returns {string} The modified HTML as a string.
 */
const injectScript = (bodyBuffer, targetHostname) => {
  let body = bodyBuffer.toString('utf-8');
  const clientScript = `
    <!-- PROXY-INJECTED-SCRIPT-START -->
    <script>
      (() => {
        const PROXY_CONFIG = {
          proxyHostname: '${PROXY_HOSTNAME}',
          targetHostname: '${targetHostname}'
        };

        const rewriteUrl = (url) => {
          if (!url || !url.startsWith('/') || url.startsWith('//')) {
            return url; // Not a relative path we should handle
          }
          // Construct the new URL: https://proxy.com/discord.com/assets/foo.png
          return \`//\${PROXY_CONFIG.proxyHostname}/\${PROXY_CONFIG.targetHostname}\${url}\`;
        };

        const processNode = (node) => {
          if (node.nodeType !== 1) return; // Not an element
          
          const attributes = ['src', 'href', 'action', 'data-src'];
          attributes.forEach(attr => {
            if (node.hasAttribute(attr)) {
              const originalUrl = node.getAttribute(attr);
              node.setAttribute(attr, rewriteUrl(originalUrl));
            }
          });
        };

        const observer = new MutationObserver((mutations) => {
          mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
              processNode(node);
              // Also process all children of the new node
              if (node.querySelectorAll) {
                node.querySelectorAll('img, script, link, a, form').forEach(processNode);
              }
            });
          });
        });

        // Start observing the document body for changes
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true
        });

        // Also process existing elements on initial load
        document.addEventListener('DOMContentLoaded', () => {
             document.querySelectorAll('img, script, link, a, form').forEach(processNode);
        });
      })();
    </script>
    <!-- PROXY-INJECTED-SCRIPT-END -->
  `;
  // Inject the script just before the closing </head> tag.
  return body.replace('</head>', `${clientScript}</head>`);
};


// --- Listen for the 'proxyRes' event to intercept and modify the response ---
proxy.on('proxyRes', (proxyRes, req, res) => {
  const isHtml = proxyRes.headers['content-type']?.includes('text/html');
  
  // Only modify HTML responses
  if (!isHtml) {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
    return;
  }
  
  const contentEncoding = proxyRes.headers['content-encoding'];
  const body = [];
  
  proxyRes.on('data', (chunk) => body.push(chunk));
  
  proxyRes.on('end', () => {
    let buffer = Buffer.concat(body);

    const decompress = (buf) => {
        if (contentEncoding === 'gzip') return zlib.gunzipSync(buf);
        if (contentEncoding === 'deflate') return zlib.inflateSync(buf);
        return buf;
    };

    const compress = (str) => {
        const buf = Buffer.from(str, 'utf-8');
        if (contentEncoding === 'gzip') return zlib.gzipSync(buf);
        if (contentEncoding === 'deflate') return zlib.deflateSync(buf);
        return buf;
    };
    
    try {
        const decompressedBuffer = decompress(buffer);
        const modifiedHtml = injectScript(decompressedBuffer, req.targetHostname);
        const finalBuffer = compress(modifiedHtml);

        // Update headers and send the modified response
        const headers = { ...proxyRes.headers };
        delete headers['content-length']; // Length has changed
        res.writeHead(proxyRes.statusCode, headers);
        res.end(finalBuffer);

    } catch (err) {
        console.error("Error processing response:", err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error modifying proxied response.');
    }
  });
});


// --- Create the Main Server ---
const server = http.createServer((req, res) => {
  let targetUrl = defaultTarget.href;
  req.targetHostname = defaultTarget.hostname;

  // Dynamic Routing Logic: Check for URLs like /discord.com/assets/...
  const match = req.url.match(/^\/([a-zA-Z0-9.-]+)(\/.*)/);
  if (match) {
    const targetHostname = match[1];
    const newPath = match[2];
    
    // Check if the first part looks like a valid hostname
    if (targetHostname.includes('.')) {
        targetUrl = `https://${targetHostname}`;
        req.url = newPath; // The proxy will request the correct sub-path
        req.targetHostname = targetHostname;
    }
  }

  // Forward the request to the determined target
  proxy.web(req, res, { target: targetUrl }, (err) => {
      console.error("Proxy Main Error:", err.message);
      if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end("Bad Gateway");
      }
  });
});

// Handle WebSocket connections using the same routing logic
server.on('upgrade', (req, socket, head) => {
  let targetUrl = defaultTarget.href;

  const match = req.url.match(/^\/([a-zA-Z0-9.-]+)(\/.*)/);
  if (match && match[1].includes('.')) {
    targetUrl = `wss://${match[1]}`;
    req.url = match[2];
  }

  console.log(`Proxying WebSocket to ${targetUrl}${req.url}`);
  proxy.ws(req, socket, head, { target: targetUrl });
});

server.listen(PORT, () => {
  console.log(`🚀 Advanced Proxy Server listening on port ${PORT}`);
  console.log(`Default target: ${DEFAULT_TARGET_URL}`);
  console.log(`Proxy public hostname: ${PROXY_HOSTNAME}`);
});
