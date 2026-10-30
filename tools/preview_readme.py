#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 README.md 渲染成 GitHub 风格的 HTML，便于本地预览排版效果。
用法：python3 tools/preview_readme.py   → 在仓库根目录生成 readme_preview.html
注意：这是本地预览近似，以 GitHub 真实渲染为准；GitHub 对 <details> 内 Markdown 有特殊处理。
"""
import os, pathlib, re
import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'README.md'
OUT = ROOT / 'readme_preview.html'   # 输出到仓库根，相对图片路径才能解析

t = SRC.read_text(encoding='utf-8')

# GitHub 风格的细节：把 <details> 内部的内容也当作 markdown 解析（GitHub 实际会这样）
def expand_details(md):
    out = []
    lines = md.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r'^<details>', line)
        if m:
            out.append(line); i += 1
            # 收集直到 </details>
            buf = []
            closed = False
            while i < len(lines):
                l = lines[i]
                if l.strip().startswith('</details>'):
                    # 先渲染 buf 里的 markdown
                    inner = markdown.markdown('\n'.join(buf), extensions=['extra','md_in_html','tables','fenced_code'])
                    out.append(inner)
                    out.append(l); i += 1; closed = True; break
                buf.append(l); i += 1
            if not closed:
                out.extend(buf)
        else:
            out.append(line); i += 1
    return '\n'.join(out)

t2 = expand_details(t)

html = markdown.markdown(t2, extensions=['extra', 'md_in_html', 'tables', 'fenced_code', 'toc'])

css = """
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
 max-width:1012px;margin:0 auto;padding:32px;color:#1f2328;background:#fff;line-height:1.6;font-size:16px;}
h1,h2,h3,h4{margin-top:28px;border-bottom:1px solid #d8dee4;padding-bottom:.3em;}
code{background:rgba(175,184,193,.2);border-radius:6px;padding:.2em .4em;font-size:85%;}
pre{background:#f6f8fa;border-radius:6px;padding:16px;overflow:auto;}
pre code{background:none;padding:0;}
table{border-collapse:collapse;width:100%;margin:16px 0;display:block;overflow:auto;}
th,td{border:1px solid #d0d7de;padding:6px 13px;}
tr:nth-child(2n){background:#f6f8fa;}
blockquote{border-left:4px solid #d0d7de;color:#656d76;padding:0 1em;margin:0;}
img{max-width:100%;}
a{color:#0969da;text-decoration:none;}
a:hover{text-decoration:underline;}
hr{border:0;border-top:1px solid #d8dee4;margin:24px 0;}
details{border:1px solid #d0d7de;border-radius:6px;padding:8px 12px;margin:12px 0;}
summary{cursor:pointer;font-weight:600;}
"""

page = f"<!DOCTYPE html><html><head><meta charset='utf-8'><style>{css}</style></head><body>{html}</body></html>"
OUT.write_text(page, encoding='utf-8')
print('written', OUT)
