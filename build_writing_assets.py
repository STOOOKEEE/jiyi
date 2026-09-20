"""Fetch pinned Hanzi Writer assets and only the characters used by our deck."""
from pathlib import Path
import urllib.request,tarfile,io,hashlib,base64,json
root=Path(__file__).resolve().parent/'public';(root/'vendor').mkdir(exist_ok=True)
for name,version in [('hanzi-writer','3.7.3'),('hanzi-writer-data','2.0.1')]:
 meta=json.load(urllib.request.urlopen(f'https://registry.npmjs.org/{name}/{version}'))
 raw=urllib.request.urlopen(meta['dist']['tarball'],timeout=40).read()
 assert 'sha512-'+base64.b64encode(hashlib.sha512(raw).digest()).decode()==meta['dist']['integrity']
 archive=tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz')
 names=archive.getnames();print(name,'files',len(names),'licenses',[n for n in names if 'licen' in n.lower() or 'arphic' in n.lower()])
 if name=='hanzi-writer':
  for src,dest in [('package/dist/hanzi-writer.min.js','hanzi-writer.min.js'),('package/LICENSE','HANZI-WRITER-LICENSE.txt')]:
   (root/'vendor'/dest).write_bytes(archive.extractfile(src).read())
 else:
  chars=sorted(set(''.join(c['hanzi'] for c in json.loads((root/'deck.json').read_text()))))
  data={c:json.load(archive.extractfile('package/'+c+'.json')) for c in chars}
  data['_notice']='Jiyi subset, 2026-09-20: 526 characters selected from Hanzi Writer Data 2.0.1; individual paths and medians unchanged. Copyright (C) 1999 Arphic Technology Co., Ltd. ARPHIC Public License: vendor/ARPHICPL-English.txt. No warranty.'
  (root/'strokes.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
  for src,dest in [('package/ARPHICPL.TXT','ARPHICPL.TXT'),('package/APL/english/ARPHICPL.TXT','ARPHICPL-English.txt')]:
   (root/'vendor'/dest).write_bytes(archive.extractfile(src).read())
  print(len(chars),'characters', (root/'strokes.json').stat().st_size,'bytes')
