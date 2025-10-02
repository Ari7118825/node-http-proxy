const http = require('http');
// The library is already in the project, so we can require it by name
const httpProxy = require('http-proxy');

const proxy = httpProxy.createProxyServer({});

const server = http.createServer(function (req, res) {
  // The target URL is the path from the request
  const target = req.url.slice(1);

  console.log(`Proxying request to: ${target}`);

  proxy.web(req, res, {
    target: target,
    changeOrigin: true,
    secure: false
  });
});

proxy.on('error', function (err, req, res) {
  console.error('Proxy Error:', err);
  res.writeHead(500, { 'Content-Type': 'text/plain' });
  res.end('An error occurred while proxying the request.');
});

// This is VERY important for Render
const port = process.env.PORT || 8080;

server.listen(port, () => {
  console.log(`Proxy server listening on port ${port}`);
});
