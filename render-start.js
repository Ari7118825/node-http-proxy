const http = require('http');
const httpProxy = require('http-proxy');

const proxy = httpProxy.createProxyServer({
  // This setting helps with websites that have strict security
  changeOrigin: true,
});

const server = http.createServer(function (req, res) {
  // Get the target URL by removing the first character '/'
  const target = req.url.slice(1);

  // **NEW:** Check if the target is a valid URL before proxying
  if (target.startsWith('http://') || target.startsWith('https://')) {
    console.log(`Proxying valid request to: ${target}`);
    proxy.web(req, res, { target: target, secure: false });
  } else {
    // **NEW:** If not a valid URL, send a helpful error message
    console.log(`Blocked invalid request for: ${target}`);
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Please provide a valid, absolute URL as the path. Example: /https://www.google.com');
  }
});

proxy.on('error', function (err, req, res) {
  console.error('Proxy Error:', err);
  res.writeHead(502, { 'Content-Type': 'text/plain' });
  res.end('An error occurred with the proxy.');
});

const port = process.env.PORT || 8080;

server.listen(port, () => {
  console.log(`Proxy server listening on port ${port}`);
});
