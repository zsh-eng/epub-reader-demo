from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  title={'/one':'The shape of a quiet morning','/two':'A small library of attention','/three':'Keeping what matters'}.get(self.path,'A place for thought')
  body='<html><head><meta charset="utf-8"><title>'+title+'</title><meta property="og:title" content="'+title+'"><meta name="description" content="An Arctic desktop replay. Local pages, no publisher requests."></head><body><article><h1>'+title+'</h1>'
  body+=''.join('<p>A good tool leaves room for the work. The winter light falls slowly across the water, and a few quiet minutes become enough to read, to think, and to keep a thought for another day. This is passage '+str(i)+'.</p>' for i in range(30))
  body+='<p><a href="/two">A small library of attention</a></p></article></body></html>'
  b=body.encode();self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
ThreadingHTTPServer(('127.0.0.1',8766),Handler).serve_forever()
