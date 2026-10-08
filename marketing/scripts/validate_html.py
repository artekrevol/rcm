"""Reject implicit browser repairs that can silently change layout containment."""
from html.parser import HTMLParser
from pathlib import Path
VOID=set('area base br col embed hr img input link meta param source track wbr'.split())
class Structure(HTMLParser):
 def __init__(self): super().__init__(); self.stack=[]; self.errors=[]
 def handle_starttag(self,tag,attrs):
  if tag not in VOID:self.stack.append(tag)
 def handle_startendtag(self,tag,attrs):pass
 def handle_endtag(self,tag):
  if not self.stack or self.stack[-1]!=tag:self.errors.append(f'Unexpected </{tag}> inside {self.stack[-4:]}')
  elif self.stack:self.stack.pop()
 def finish(self):
  if self.stack:self.errors.append(f'Unclosed tags: {self.stack}')
def validate(text):
 parser=Structure();parser.feed(text);parser.finish();return parser.errors
if __name__=='__main__':
 failures=[]
 for path in (Path(__file__).resolve().parents[1]/'public').rglob('*.html'):
  failures.extend(f'{path.name}: {error}' for error in validate(path.read_text()))
 if failures:raise SystemExit('\n'.join(failures))
 print('All public HTML structures are explicitly balanced.')
