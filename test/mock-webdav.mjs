// 最小 WebDAV mock 服务器，用于本地测试客户端层（不做认证、不做锁）
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

function decode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function localPath(rootDir, urlPath) {
  const rel = decode(urlPath).split('?')[0].replace(/^\/+/, '');
  const abs = path.join(rootDir, rel);
  if (!abs.startsWith(rootDir) && abs !== rootDir) throw new Error('path escapes root');
  return abs;
}

function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

function statToXml(href, name, type, size, mtime) {
  const coll = type === 'directory' ? '<D:collection/>' : '';
  const len = type === 'directory' ? '' : `<D:getcontentlength>${size}</D:getcontentlength>`;
  const ctype = type === 'directory' ? 'httpd/unix-directory' : 'text/markdown';
  return `<D:response>
  <D:href>${xmlEscape(href)}</D:href>
  <D:propstat>
    <D:prop>
      <D:displayname>${xmlEscape(name)}</D:displayname>
      ${len}
      <D:getlastmodified>${new Date(mtime).toUTCString()}</D:getlastmodified>
      <D:getcontenttype>${ctype}</D:getcontenttype>
      <D:resourcetype>${coll}</D:resourcetype>
    </D:prop>
    <D:status>HTTP/1.1 200 OK</D:status>
  </D:propstat>
</D:response>`;
}

function propfind(rootDir, urlPath, depth) {
  const abs = localPath(rootDir, urlPath);
  const hrefBase = urlPath.endsWith('/') ? urlPath : urlPath + '/';
  const parts = [];
  const selfStat = fs.statSync(abs);
  const selfName = urlPath === '/' ? '' : path.basename(abs);
  parts.push(statToXml(hrefBase, selfName, selfStat.isDirectory() ? 'directory' : 'file', selfStat.size, selfStat.mtimeMs));
  if (depth === '1' && selfStat.isDirectory()) {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, entry.name);
      const childHref = hrefBase + encodeURIComponent(entry.name) + (entry.isDirectory() ? '/' : '');
      const st = fs.statSync(childAbs);
      parts.push(statToXml(childHref, entry.name, entry.isDirectory() ? 'directory' : 'file', st.size, st.mtimeMs));
    }
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">${parts.join('')}</D:multistatus>`;
}

export async function startWebDAVServer(rootDir) {
  await fsp.mkdir(rootDir, { recursive: true });

  const handler = async (req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    const method = req.method;
    try {
      if (method === 'OPTIONS') {
        res.setHeader('DAV', '1,2');
        res.setHeader('Allow', 'OPTIONS, PROPFIND, GET, PUT, DELETE, MKCOL, MOVE');
        res.statusCode = 200;
        res.end();
        return;
      }
      if (method === 'PROPFIND') {
        const depth = (req.headers.depth || '0').toString();
        const xml = propfind(rootDir, urlPath, depth);
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.statusCode = 207;
        res.end(xml);
        return;
      }
      if (method === 'GET') {
        const abs = localPath(rootDir, urlPath);
        const buf = await fsp.readFile(abs);
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.statusCode = 200;
        res.end(buf);
        return;
      }
      if (method === 'PUT') {
        const abs = localPath(rootDir, urlPath);
        if (req.headers['if-none-match'] === '*' && fs.existsSync(abs)) {
          res.statusCode = 412;
          res.end();
          return;
        }
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', async () => {
          try {
            await fsp.writeFile(abs, Buffer.concat(chunks));
            res.statusCode = 201;
            res.end();
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e.message || e));
          }
        });
        return;
      }
      if (method === 'MKCOL') {
        const abs = localPath(rootDir, urlPath);
        await fsp.mkdir(abs, { recursive: true });
        res.statusCode = 201;
        res.end();
        return;
      }
      if (method === 'DELETE') {
        const abs = localPath(rootDir, urlPath);
        await fsp.rm(abs, { recursive: true, force: true });
        res.statusCode = 204;
        res.end();
        return;
      }
      if (method === 'MOVE') {
        const abs = localPath(rootDir, urlPath);
        const dest = (req.headers.destination || '');
        const destAbs = localPath(rootDir, new URL(dest).pathname);
        if (req.headers.overwrite === 'F' && fs.existsSync(destAbs)) {
          res.statusCode = 412;
          res.end();
          return;
        }
        await fsp.mkdir(path.dirname(destAbs), { recursive: true });
        await fsp.rename(abs, destAbs);
        res.statusCode = 201;
        res.end();
        return;
      }
      res.statusCode = 405;
      res.end('Method not allowed: ' + method);
    } catch (e) {
      res.statusCode = 404;
      res.end(String(e && e.message || e));
    }
  };

  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
