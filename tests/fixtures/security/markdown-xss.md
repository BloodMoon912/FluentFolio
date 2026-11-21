# Sanitizer fixture

<script>alert('xss')</script>
<script src="https://evil.example/x.js"></script>

[bad javascript link](javascript:alert(1))
![bad javascript image](javascript:alert(1))
<a href="javascript:alert(1)">raw javascript anchor</a>
<img src="x" onerror="alert(1)" />
<img src="https://evil.example/pixel.png" onload="alert(2)" />
<iframe src="https://evil.example/frame"></iframe>
<span style="background:url(javascript:alert(1))">raw style</span>
<div onclick="alert(3)">raw onclick</div>

## Safe content still works

A normal [safe link](https://example.com) and **bold** text.

Code that merely *shows* a script must stay escaped:

```html
<script>alert('not executed')</script>
```

The dictionary marker must survive sanitization:

- Defined: [[test-word]]
- Undefined: [[not-in-the-dictionary]]
